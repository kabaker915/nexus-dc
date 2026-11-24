/**
 * Real-device mode: LAN discovery + SSH identification through the local
 * gateway, and the overlay that feeds real telemetry into the digital twin.
 */
import { createExtNode } from './extnet.js';
import { hostName } from './netdevops/vendors.js';

export const REAL_STORAGE_KEY = 'nexusdc.real.v1';

/* ------------------------------------------------------------------ *
 *  Parsing (pure functions, unit-testable)
 * ------------------------------------------------------------------ */
export function detectVendor(versionText) {
  const t = String(versionText || '');
  if (/H3C|Comware/i.test(t)) return 'h3c';
  if (/Huawei|VRP/i.test(t)) return 'huawei';
  if (/Cisco IOS|Cisco Internetwork|Cisco Nexus|IOS XE/i.test(t)) return 'cisco';
  if (/Linux/i.test(t)) return 'linux';
  return 'unknown';
}

function firstMatch(text, re) {
  const m = re.exec(String(text || ''));
  return m ? m[1] : null;
}

export function parseProbe(raw, family) {
  const version = raw?.version || '';
  const cpuText = raw?.cpu || '';
  const memText = raw?.mem || '';
  const envText = raw?.env || '';
  const intfText = raw?.intf || '';
  const vendor = detectVendor(version);

  let model = null;
  if (vendor === 'h3c' || vendor === 'huawei') {
    model = firstMatch(version, /(?:H3C|HUAWEI)\s+([A-Za-z0-9._-]+)\s+uptime/i);
  } else if (vendor === 'cisco') {
    model = firstMatch(version, /^cisco\s+([A-Z][A-Za-z0-9._-]+)\s+\(/m)
      || firstMatch(version, /^cisco\s+(C\d[A-Za-z0-9._-]*)/im);
  } else if (vendor === 'linux') {
    model = firstMatch(version, /Linux\s+([A-Za-z0-9._-]+)/i);
  }
  if (!model) model = firstMatch(version, /Version\s+([A-Za-z0-9._-]+)/i) || null;

  // CPU %
  let cpu = null;
  if (family === 'linux') {
    const us = firstMatch(cpuText, /%Cpu\(s\):\s*([\d.]+)\s*us/i);
    const sy = firstMatch(cpuText, /%Cpu\(s\):[\s\S]{0,60}?([\d.]+)\s*sy/i);
    if (us != null) cpu = Math.round(Number(us) + Number(sy || 0));
    else cpu = null;
  } else if (family === 'comware') {
    const v = firstMatch(cpuText, /(\d+)%\s*in last 5 seconds/i) || firstMatch(cpuText, /(\d+)%/);
    if (v != null) cpu = Number(v);
  } else {
    const v = firstMatch(cpuText, /five seconds:\s*(\d+)%/i) || firstMatch(cpuText, /(\d+)%/);
    if (v != null) cpu = Number(v);
  }

  // Memory %
  let mem = null;
  if (family === 'linux') {
    const m = /Mem:\s+(\d+)\s+(\d+)/.exec(memText || '');
    if (m) mem = Math.round((Number(m[2]) / Number(m[1])) * 100);
  } else if (family === 'comware') {
    const v = firstMatch(memText, /Used Rate:\s*(\d+)%/i);
    if (v != null) mem = Number(v);
  } else {
    const m = /Processor\s+\S+\s+(\d+)\s+(\d+)/.exec(memText || '');
    if (m) mem = Math.round((Number(m[2]) / Number(m[1])) * 100);
  }

  // Temperature — prefer sensor lines, ignore warning/alarm thresholds
  let temp = null;
  const temps = [];
  for (const line of String(envText || '').split('\n')) {
    if (!/(inlet|outlet|cpu|package|temp|sensor)/i.test(line)) continue;
    let m = /([+-]?\d+(?:\.\d+)?)\s*°?C\b/.exec(line);
    if (!m) m = /(?:normal|alarm|ok|up)\s+([+-]?\d+(?:\.\d+)?)/i.exec(line);
    if (!m) m = /temperature[^0-9-]*([+-]?\d+(?:\.\d+)?)/i.exec(line);
    if (m) temps.push(Number(m[1]));
  }
  if (temps.length) temp = Math.max(...temps);

  // Interface counters
  let portsUp = null;
  let portsDown = null;
  const lines = String(intfText || '').split('\n').filter((l) => l.trim());
  if (family === 'linux') {
    const rows = lines.filter((l) => /\bUP\b/.test(l));
    portsUp = rows.length;
    portsDown = lines.filter((l) => /\bDOWN\b/.test(l)).length;
  } else if (family === 'ios') {
    const rows = lines.filter((l) => /\s(up|down)\s+(up|down)\s*$/i.test(l));
    if (rows.length) {
      portsUp = rows.filter((l) => /\sup\s+up\s*$/i.test(l)).length;
      portsDown = rows.length - portsUp;
    }
  } else {
    const rows = lines.filter((l) => /^\S+\s+(UP|DOWN)\s/i.test(l));
    if (rows.length) {
      portsUp = rows.filter((l) => /^\S+\s+UP\s/i.test(l)).length;
      portsDown = rows.length - portsUp;
    }
  }

  const firstLine = version.split('\n').find((l) => l.trim()) || '';

  return {
    vendor,
    model,
    cpu,
    mem,
    temp,
    portsUp,
    portsDown,
    versionLine: firstLine.slice(0, 120),
    neighbors: parseLldp(raw.lldp),
    raw,
  };
}

export function parseLldp(text) {
  const out = [];
  const s = String(text || '');
  const cdp = /Device ID:\s*(\S+)[\s\S]*?Port ID \(outgoing port\):\s*(\S+)/g;
  let m;
  while ((m = cdp.exec(s))) out.push({ remote: m[1], remotePort: m[2] });
  if (out.length) return out;

  for (const line of s.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^(local|interface|chassis|port id|system name|neighbor)/i.test(t)) continue;
    const cols = t.split(/\s{2,}/).map((x) => x.trim());
    if (cols.length >= 4) {
      const name = cols[cols.length - 1];
      if (/^[A-Za-z][\w.-]{2,}$/.test(name)) out.push({ local: cols[0], remotePort: cols[2], remote: name });
    } else if (cols.length === 3 && /^[A-Za-z][\w.-]{2,}$/.test(cols[2])) {
      out.push({ local: cols[0], remotePort: cols[1], remote: cols[2] });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Real device controller
 * ------------------------------------------------------------------ */
let seq = 0;
const newId = () => `real_${Date.now().toString(36)}_${++seq}`;

export class RealNet {
  constructor(app) {
    this.app = app;
    if (!Array.isArray(app.state.real)) app.state.real = [];
    this.devices = app.state.real;
    this.timer = null;
    this.probing = new Set();
    this.lastScan = null;
  }

  persist() {
    try {
      const data = this.devices.map((d) => ({
        id: d.id, host: d.host, port: d.port, user: d.user, family: d.family,
        protocol: d.protocol || 'ssh',
        vendor: d.vendor, model: d.model, note: d.note || '',
        boundDeviceId: d.boundDeviceId || null, extId: d.extId || null,
      }));
      localStorage.setItem(REAL_STORAGE_KEY, JSON.stringify(data));
    } catch { /* quota */ }
  }

  restore() {
    try {
      const arr = JSON.parse(localStorage.getItem(REAL_STORAGE_KEY) || '[]');
      if (!Array.isArray(arr)) return;
      for (const d of arr) {
        if (!d.host || this.devices.some((x) => x.host === d.host && x.port === d.port)) continue;
        this.devices.push({
          id: d.id || newId(),
          host: d.host,
          port: d.port || 22,
          user: d.user || 'netops',
          family: d.family || 'auto',
          protocol: d.protocol || 'ssh',
          vendor: d.vendor || 'unknown',
          model: d.model || '',
          note: d.note || '',
          boundDeviceId: d.boundDeviceId || null,
          extId: d.extId || null,
          status: 'unknown',
          metrics: { cpu: null, mem: null, temp: null },
          lastAt: 0,
          latency: 0,
        });
      }
    } catch { /* ignore */ }
  }

  async netinfo() {
    const res = await fetch('/api/netinfo');
    return res.json();
  }

  async discover(cidr, port = 22, timeoutMs = 350) {
    const res = await fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cidr, port, timeoutMs }),
    });
    const data = await res.json();
    if (data.ok) this.lastScan = { at: Date.now(), ...data };
    return data;
  }

  addManual(host, user = 'netops', port = 22, family = 'auto', protocol = 'ssh') {
    if (!host || this.devices.some((d) => d.host === host && d.port === port)) return null;
    const dev = {
      id: newId(), host, port, user, family, protocol,
      vendor: 'unknown', model: '', note: '',
      boundDeviceId: null, extId: null,
      status: 'unknown', metrics: { cpu: null, mem: null, temp: null },
      lastAt: 0, latency: 0,
    };
    this.devices.push(dev);
    this.persist();
    return dev;
  }

  remove(dev) {
    this.devices = this.devices.filter((d) => d !== dev);
    this.app.state.real = this.devices;
    if (dev.extId) this.app.removeExtNode?.(dev.extId);
    this.persist();
    this.app.persistLayout?.();
  }

  async probe(dev) {
    if (this.probing.has(dev.id)) return null;
    this.probing.add(dev.id);
    try {
      if (dev.protocol === 'snmp') return await this.probeSnmp(dev);
      if (dev.protocol === 'redfish') return await this.probeRedfish(dev);
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: dev.host, port: dev.port, user: dev.user, family: dev.family === 'auto' ? undefined : dev.family }),
      });
      const data = await res.json();
      dev.lastAt = Date.now();
      dev.latency = data.ms || 0;
      if (data.ok) {
        const parsed = parseProbe(data.raw, data.family);
        dev.status = 'online';
        dev.family = data.family;
        dev.vendor = parsed.vendor;
        dev.model = parsed.model || dev.model;
        dev.metrics = { cpu: parsed.cpu, mem: parsed.mem, temp: parsed.temp };
        dev.portsUp = parsed.portsUp;
        dev.portsDown = parsed.portsDown;
        dev.versionLine = parsed.versionLine;
        dev.raw = parsed.raw;
        dev.error = '';
        this.syncExt(dev);
      } else {
        dev.status = /auth|permission|denied|banner/i.test(data.stderr || '') ? 'authfail' : 'error';
        dev.error = data.error || data.stderr || '探测失败';
        this.syncExt(dev);
      }
      this.persist();
      return data;
    } catch (err) {
      dev.status = 'error';
      dev.error = err.message;
      dev.lastAt = Date.now();
      return { ok: false, error: err.message };
    } finally {
      this.probing.delete(dev.id);
    }
  }

  async probeAll(list, onProgress) {
    const targets = list || this.devices.slice();
    const out = [];
    let i = 0;
    for (const dev of targets) {
      onProgress?.(i, targets.length, dev);
      // eslint-disable-next-line no-await-in-loop
      out.push(await this.probe(dev));
      i++;
      onProgress?.(i, targets.length, dev);
    }
    return out;
  }

  async probeSnmp(dev) {
    const t0 = Date.now();
    try {
      const res = await fetch('/api/snmp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: dev.host, port: dev.port || 161, community: dev.community || 'public' }),
      });
      const data = await res.json();
      dev.lastAt = Date.now();
      dev.latency = data.ms ?? (Date.now() - t0);
      if (data.ok) {
        const map = {};
        for (const v of data.varbinds) map[v.name] = v.value;
        const desc = String(map.sysDescr || 'SNMP 设备');
        dev.status = 'online';
        dev.vendor = detectVendor(desc);
        dev.model = desc.split(/\r?\n/)[0].slice(0, 48);
        dev.metrics = {
          cpu: Number.isFinite(map.hrProcessorLoad) ? Number(map.hrProcessorLoad) : null,
          mem: null,
          temp: null,
        };
        dev.portsUp = Number.isFinite(map.ifOperStatus) ? map.ifOperStatus : dev.portsUp;
        dev.versionLine = `SNMP · ${map.sysName || dev.host} · up ${Math.round((map.sysUpTime || 0) / 6000)}min`;
        dev.error = '';
        this.syncExt(dev);
      } else {
        dev.status = 'error';
        dev.error = data.error || 'SNMP 采集失败';
        this.syncExt(dev);
      }
      this.persist();
      return data;
    } catch (err) {
      dev.status = 'error';
      dev.error = err.message;
      this.syncExt(dev);
      return { ok: false, error: err.message };
    }
  }

  async probeRedfish(dev) {
    const t0 = Date.now();
    try {
      const res = await fetch('/api/redfish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: dev.host, port: dev.port || 443, user: dev.user, password: dev.password || '',
          secure: (dev.port || 443) === 443,
        }),
      });
      const data = await res.json();
      dev.lastAt = Date.now();
      dev.latency = data.ms ?? (Date.now() - t0);
      if (data.ok) {
        dev.status = data.powerState === 'On' ? 'online' : 'offline';
        dev.vendor = 'redfish';
        dev.model = data.model || 'Redfish 服务器';
        dev.metrics = { cpu: null, mem: null, temp: Number.isFinite(data.tempC) ? data.tempC : null };
        dev.redfish = {
          powerState: data.powerState, health: data.health,
          cpuCount: data.cpuCount, memGiB: data.memGiB, hostName: data.hostName,
        };
        dev.versionLine = `Redfish · ${data.powerState} · ${data.cpuCount ?? '?'} CPU · ${data.memGiB ?? '?'} GiB`;
        dev.error = '';
        this.syncExt(dev);
      } else {
        dev.status = 'error';
        dev.error = data.error || 'Redfish 采集失败';
        this.syncExt(dev);
      }
      this.persist();
      return data;
    } catch (err) {
      dev.status = 'error';
      dev.error = err.message;
      this.syncExt(dev);
      return { ok: false, error: err.message };
    }
  }

  /** Build topology links from LLDP/CDP neighbours collected during probing. */
  buildTopology() {
    const dc = Object.values(this.app.state.devices);
    const targets = dc.map((d) => ({
      id: d.id,
      names: [hostName(d, this.app.state), d.name, d.model].filter(Boolean).map((x) => String(x).toUpperCase()),
    }));
    let links = 0;
    for (const dev of this.devices) {
      if (!dev.extId || !dev.neighbors?.length) continue;
      const ext = (this.app.state.ext || []).find((e) => e.id === dev.extId);
      if (!ext) continue;
      for (const n of dev.neighbors) {
        const name = String(n.remote || '').toUpperCase();
        if (!name || name.length < 3) continue;
        let target = targets.find((t) => t.names.some((x) => x && (name.includes(x) || x.includes(name))))?.id;
        if (!target) {
          const other = this.devices.find((o) => o !== dev && o.extId && o.model
            && name.includes(String(o.model).toUpperCase()));
          if (other) target = other.extId;
        }
        if (target && ext.uplink !== target) {
          ext.uplink = target;
          links++;
        }
      }
    }
    if (links) {
      this.app.flat.lastLayoutKey = '';
      this.app.flat.needFit = true;
      this.app.flat.draw();
      this.app.persistLayout?.();
    }
    return links;
  }

  bind(dev, deviceId) {
    dev.boundDeviceId = deviceId || null;
    this.syncExt(dev);
    this.persist();
    this.app.persistLayout?.();
  }

  /** Mirror the real device in the 2D topology as an external node. */
  syncExt(dev) {
    const ext = this.app.state.ext || [];
    let node = dev.extId ? ext.find((e) => e.id === dev.extId) : null;
    if (!node) {
      node = createExtNode(this.app, ['linux', 'redfish'].includes(dev.vendor) ? 'server' : 'switch', { x: 0, y: 0 });
      node.protocol = 'ssh';
      ext.push(node);
      dev.extId = node.id;
      this.app.flat && (this.app.flat.lastLayoutKey = '', this.app.flat.needFit = true);
    }
    node.name = (dev.model || dev.vendor?.toUpperCase() || 'REAL') + ' · ' + dev.host;
    node.host = dev.host;
    node.port = dev.port;
    node.user = dev.user;
    node.vendor = dev.vendor === 'h3c' ? 'h3c' : dev.vendor === 'huawei' ? 'huawei' : dev.vendor === 'cisco' ? 'cisco' : 'linux';
    node.status = dev.status === 'online' ? 'online' : 'error';
    node.lastAt = dev.lastAt;
    node.lastLatency = dev.latency;
    node.uplink = dev.boundDeviceId || null;
    node.realId = dev.id;
    if (this.app.flat) this.app.flat.draw();
  }

  /** Feed real telemetry into bound model devices (real mode only). */
  applyToModel() {
    if (this.app.state.dataMode !== 'real') return;
    const devices = this.app.state.devices;
    for (const dev of this.devices) {
      if (!dev.boundDeviceId) continue;
      const model = devices[dev.boundDeviceId];
      if (!model) continue;
      if (dev.status === 'online') {
        model.status = 'online';
        model.adminPower = true;
        const m = dev.metrics || {};
        if (Number.isFinite(m.cpu)) model.metrics.cpu = m.cpu;
        if (Number.isFinite(m.mem)) model.metrics.mem = m.mem;
        if (Number.isFinite(m.temp)) model.metrics.temp = m.temp;
        if (Number.isFinite(dev.portsUp)) {
          const ports = model.ports.filter((p) => p.kind !== 'power');
          ports.forEach((p, i) => { p.state = i < dev.portsUp ? 'up' : (p.cable ? 'down' : p.state); });
        }
        model.realSource = { host: dev.host, at: dev.lastAt, latency: dev.latency };
      } else if (dev.status === 'authfail' || dev.status === 'error') {
        model.realSource = { host: dev.host, at: dev.lastAt, latency: dev.latency, error: dev.error };
      }
    }
  }

  start(intervalMs = 15000) {
    this.stop();
    this.timer = setInterval(() => {
      if (this.app.state.dataMode !== 'real') return;
      const targets = this.devices.filter((d) => d.status === 'online').slice(0, 4);
      targets.forEach((d) => { this.probe(d).then(() => this.app.ui?.refresh?.()); });
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
