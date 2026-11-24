import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5199);
const HOST = '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ------------------------------------------------------------------ *
 *  Command gateway
 *  POST /api/dispatch
 *  { protocol:'ssh'|'http', host, port, user, commands:[…] }
 *  - ssh : one exec channel per command (works for network CLIs and Linux)
 *  - http: POST {commands} to http://host:port/api/exec
 *  The gateway is a local convenience for lab devices — it is intentionally
 *  limited to loopback clients (the server binds 127.0.0.1) and short input.
 * ------------------------------------------------------------------ */
const EXEC_TIMEOUT = 12000;
const MAX_BODY = 64 * 1024;
const MAX_CMDS = 20;
const MAX_CMD_LEN = 400;

function json(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function sshExec({ host, port, user, command, timeoutMs = EXEC_TIMEOUT }) {
  return new Promise((resolve) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', `ConnectTimeout=6`,
      '-p', String(port || 22),
      `${user || 'netops'}@${host}`,
      command,
    ];
    let stdout = '';
    let stderr = '';
    let done = false;
    const child = spawn('ssh', args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill();
      resolve({ ok: false, stdout, stderr: `${stderr}\n[gateway] command timeout`, code: -1 });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 200000) child.kill();
    });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: `无法启动 ssh：${err.message}`, code: -1 });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });
  });
}

async function dispatchSsh({ host, port, user, commands }) {
  const parts = [];
  let ok = true;
  let lastErr = '';
  for (const cmd of commands) {
    const r = await sshExec({ host, port, user, command: cmd });
    parts.push(r.stdout.replace(/\s+$/, ''));
    if (!r.ok) {
      ok = false;
      lastErr = r.stderr || `exit code ${r.code}`;
      break;
    }
  }
  return { ok, stdout: parts.join('\n'), stderr: lastErr };
}

async function dispatchHttp({ host, port, commands }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), EXEC_TIMEOUT);
  try {
    const res = await fetch(`http://${host}:${port || 80}/api/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let stdout = text;
    try {
      const j = JSON.parse(text);
      stdout = j.stdout ?? j.output ?? text;
      return { ok: res.ok && j.ok !== false, stdout: String(stdout), stderr: j.stderr || '' };
    } catch {
      return { ok: res.ok, stdout: text, stderr: res.ok ? '' : `HTTP ${res.status}` };
    }
  } catch (err) {
    return { ok: false, stdout: '', stderr: `HTTP 网关请求失败：${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function handleDispatch(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    return json(res, 400, { ok: false, error: err.message });
  }

  const protocol = body.protocol === 'http' ? 'http' : 'ssh';
  const host = String(body.host || '').trim();
  const port = Number(body.port) || (protocol === 'http' ? 80 : 22);
  const user = String(body.user || 'netops').slice(0, 40);
  const commands = Array.isArray(body.commands) ? body.commands : [];

  if (!/^[A-Za-z0-9._:-]{1,253}$/.test(host)) {
    return json(res, 400, { ok: false, error: '设备地址不合法' });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return json(res, 400, { ok: false, error: '端口不合法' });
  }
  if (!commands.length || commands.length > MAX_CMDS) {
    return json(res, 400, { ok: false, error: `命令数量需在 1–${MAX_CMDS} 之间` });
  }
  if (commands.some((c) => typeof c !== 'string' || c.length > MAX_CMD_LEN)) {
    return json(res, 400, { ok: false, error: '单条命令过长' });
  }

  const t0 = Date.now();
  const result = protocol === 'http'
    ? await dispatchHttp({ host, port, commands })
    : await dispatchSsh({ host, port, user, commands });

  json(res, 200, {
    ok: result.ok,
    adapter: protocol,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ms: Date.now() - t0,
  });
}

/* ------------------------------------------------------------------ *
 *  Real-device discovery & identification
 * ------------------------------------------------------------------ */
const PROBE_SETS = {
  comware: {
    version: 'display version',
    cpu: 'display cpu-usage',
    mem: 'display memory',
    env: 'display environment',
    intf: 'display interface brief',
    lldp: 'display lldp neighbor-information',
  },
  ios: {
    version: 'show version',
    cpu: 'show processes cpu',
    mem: 'show memory statistics',
    env: 'show environment all',
    intf: 'show ip interface brief',
    lldp: 'show cdp neighbors detail',
  },
  linux: {
    version: 'uname -a',
    cpu: 'top -bn1',
    mem: 'free -m',
    env: 'sensors',
    intf: 'ip -br a',
    lldp: '',
  },
};

const BAD_OUTPUT = /Unrecognized|Invalid input|command not found|syntax error|Error:\s|not found/i;

function clampInt(v, dflt, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function ipToInt(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function intToIp(n) {
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

function parseCidr(cidr) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr || '').trim());
  if (!m) return null;
  const base = ipToInt(m[1]);
  const bits = Number(m[2]);
  if (base == null || bits < 24 || bits > 32) return null;
  const size = 2 ** (32 - bits);
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  const network = (base & mask) >>> 0;
  const hosts = [];
  if (bits >= 31) {
    for (let i = 0; i < size; i++) hosts.push(intToIp((network + i) >>> 0));
  } else {
    for (let i = 1; i < size - 1 && hosts.length < 254; i++) hosts.push(intToIp((network + i) >>> 0));
  }
  return hosts;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

function portOpen(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ms) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ms);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(Date.now() - t0));
    sock.once('timeout', () => finish(null));
    sock.once('error', () => finish(null));
  });
}

async function handleNetinfo(req, res) {
  const addresses = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      addresses.push({ iface, address: a.address, netmask: a.netmask, cidr: a.cidr });
    }
  }
  const virtual = /vEthernet|VMware|VirtualBox|Hyper-V|WSL|Loopback|Tailscale|ZeroTier/i;
  addresses.sort((a, b) => Number(virtual.test(a.iface)) - Number(virtual.test(b.iface)));
  const preferred = addresses.find((a) => !virtual.test(a.iface)) || addresses[0];
  const suggested = preferred
    ? `${preferred.address.split('.').slice(0, 3).join('.')}.0/24`
    : '127.0.0.1/32';
  json(res, 200, { ok: true, addresses, suggested, preferred: preferred?.address || null });
}

async function handleDiscover(req, res) {
  const body = await readBody(req);
  const cidr = String(body.cidr || '').trim();
  const port = clampInt(body.port, 22, 1, 65535);
  const timeoutMs = clampInt(body.timeoutMs, 350, 100, 2000);
  const hosts = parseCidr(cidr);
  if (!hosts) return json(res, 400, { ok: false, error: '网段需为 a.b.c.d/24–32（最多 254 个地址）' });

  const t0 = Date.now();
  const found = [];
  await mapLimit(hosts, 32, async (h) => {
    const ms = await portOpen(h, port, timeoutMs);
    if (ms != null) found.push({ host: h, ms });
  });
  found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
  json(res, 200, {
    ok: true,
    cidr,
    port,
    scanned: hosts.length,
    hosts: found,
    ms: Date.now() - t0,
  });
}

async function handleProbe(req, res) {
  const body = await readBody(req);
  const host = String(body.host || '').trim();
  const port = clampInt(body.port, 22, 1, 65535);
  const user = String(body.user || 'netops').slice(0, 40);
  const requested = String(body.family || '').toLowerCase();
  const family = requested === 'h3c' || requested === 'huawei' || requested === 'comware'
    ? 'comware'
    : requested === 'cisco' || requested === 'ios'
      ? 'ios'
      : requested === 'linux'
        ? 'linux'
        : null;

  if (!/^[A-Za-z0-9._:-]{1,253}$/.test(host)) {
    return json(res, 400, { ok: false, error: '设备地址不合法' });
  }

  const exec = (cmd) => sshExec({ host, port, user, command: cmd, timeoutMs: 9000 });
  const t0 = Date.now();
  let usedFamily = family;
  let versionRes = null;

  if (!usedFamily) {
    for (const candidate of ['comware', 'ios', 'linux']) {
      const r = await exec(PROBE_SETS[candidate].version);
      const text = `${r.stdout}${r.stderr}`;
      if (r.ok && r.stdout.trim() && !BAD_OUTPUT.test(text)) {
        usedFamily = candidate;
        versionRes = r;
        break;
      }
      versionRes = versionRes || r;
    }
  } else {
    versionRes = await exec(PROBE_SETS[usedFamily].version);
  }

  if (!usedFamily || !versionRes || !versionRes.ok || !versionRes.stdout.trim()) {
    return json(res, 200, {
      ok: false,
      error: '未能识别设备（SSH 认证失败或无可用命令）',
      stderr: (versionRes?.stderr || '').slice(0, 500),
      ms: Date.now() - t0,
    });
  }

  const raw = { version: versionRes.stdout };
  for (const key of ['cpu', 'mem', 'env', 'intf', 'lldp']) {
    if (!PROBE_SETS[usedFamily][key]) { raw[key] = ''; continue; }
    const r = await exec(PROBE_SETS[usedFamily][key]);
    raw[key] = r.ok ? r.stdout : '';
  }

  json(res, 200, {
    ok: true,
    family: usedFamily,
    raw,
    ms: Date.now() - t0,
  });
}

async function handleNotify(req, res) {
  const body = await readBody(req);
  const url = String(body.url || '');
  if (!/^https?:\/\//i.test(url)) {
    return json(res, 400, { ok: false, error: 'Webhook 地址必须是 http/https' });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload || {}),
      signal: ctrl.signal,
    });
    return json(res, 200, { ok: r.ok, status: r.status });
  } catch (err) {
    return json(res, 200, { ok: false, status: 0, error: err.message });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 *  SNMP v2c (GET) — minimal BER implementation
 * ------------------------------------------------------------------ */
const SNMP_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2.1',
};

function berLen(len) {
  if (len < 0x80) return Buffer.from([len]);
  const bytes = [];
  let n = len;
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), berLen(content.length), content]);
}

function encInt(n) {
  const bytes = [];
  let v = Math.max(0, Math.floor(n));
  if (v === 0) bytes.push(0);
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

function encOid(oid) {
  const parts = oid.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let v = parts[i];
    const tmp = [];
    do { tmp.unshift(v & 0x7f); v >>= 7; } while (v > 0);
    for (let j = 0; j < tmp.length - 1; j++) tmp[j] |= 0x80;
    out.push(...tmp);
  }
  return tlv(0x06, Buffer.from(out));
}

function buildSnmpGet(community, oids, reqId) {
  const vbs = oids.map((o) => tlv(0x30, Buffer.concat([encOid(o), tlv(0x05, Buffer.alloc(0))])));
  const pdu = tlv(0xA0, Buffer.concat([encInt(reqId), encInt(0), encInt(0), tlv(0x30, Buffer.concat(vbs))]));
  return tlv(0x30, Buffer.concat([encInt(1), tlv(0x04, Buffer.from(community, 'utf8')), pdu]));
}

function readTLV(buf, off) {
  const tag = buf[off++];
  let len = buf[off++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[off++];
  }
  return { tag, len, start: off, end: off + len };
}

function decodeOid(buf) {
  const parts = [Math.floor(buf[0] / 40), buf[0] % 40];
  let v = 0;
  for (let i = 1; i < buf.length; i++) {
    v = (v << 7) | (buf[i] & 0x7f);
    if (!(buf[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

function decodeSnmpValue(tag, buf) {
  if (tag === 0x04) return buf.toString('utf8');
  if (tag === 0x05) return null;
  if (tag === 0x40) return [...buf].join('.');
  if (tag === 0x02 || tag === 0x41 || tag === 0x42 || tag === 0x43) {
    let n = 0;
    for (const b of buf) n = (n << 8) | b;
    return n;
  }
  return buf.toString('hex');
}

function parseSnmpResponse(buf) {
  const msg = readTLV(buf, 0);
  let off = msg.start;
  const version = readTLV(buf, off); off = version.end;
  const community = readTLV(buf, off); off = community.end;
  const pdu = readTLV(buf, off);
  if (pdu.tag !== 0xa2) throw new Error('not a GET response');
  let p = pdu.start;
  const reqId = readTLV(buf, p); p = reqId.end;
  const errStatus = readTLV(buf, p); p = errStatus.end;
  const errIndex = readTLV(buf, p); p = errIndex.end;
  const vbl = readTLV(buf, p);
  const out = [];
  let q = vbl.start;
  while (q < vbl.end) {
    const vb = readTLV(buf, q);
    let r = vb.start;
    const oidT = readTLV(buf, r); r = oidT.end;
    const valT = readTLV(buf, r);
    out.push({
      oid: decodeOid(buf.subarray(oidT.start, oidT.end)),
      value: decodeSnmpValue(valT.tag, buf.subarray(valT.start, valT.end)),
    });
    q = vb.end;
  }
  return out;
}

function snmpGet(host, port, community, oids, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const reqId = Math.floor(Math.random() * 0x7fffffff);
    const msg = buildSnmpGet(community, oids, reqId);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'SNMP 超时（161/udp 无响应）' }), timeoutMs);
    socket.on('message', (buf) => {
      try {
        const vars = parseSnmpResponse(buf);
        finish({ ok: true, varbinds: vars });
      } catch (err) {
        finish({ ok: false, error: `响应解析失败：${err.message}` });
      }
    });
    socket.on('error', (err) => finish({ ok: false, error: err.message }));
    socket.send(msg, port, host, (err) => {
      if (err) finish({ ok: false, error: err.message });
    });
  });
}

async function handleSnmp(req, res) {
  const body = await readBody(req);
  const host = String(body.host || '').trim();
  const community = String(body.community || 'public').slice(0, 64);
  if (!/^[A-Za-z0-9._:-]{1,253}$/.test(host)) {
    return json(res, 400, { ok: false, error: '设备地址不合法' });
  }
  const requested = Array.isArray(body.oids) && body.oids.length ? body.oids.slice(0, 20) : Object.values(SNMP_OIDS);
  const udpPort = clampInt(body.port, 161, 1, 65535);
  const t0 = Date.now();
  const r = await snmpGet(host, udpPort, community, requested);
  if (!r.ok) return json(res, 200, { ...r, ms: Date.now() - t0 });
  const named = r.varbinds.map((v) => {
    const name = Object.keys(SNMP_OIDS).find((k) => SNMP_OIDS[k] === v.oid) || v.oid;
    return { ...v, name };
  });
  json(res, 200, { ok: true, varbinds: named, ms: Date.now() - t0 });
}

/* ------------------------------------------------------------------ *
 *  Redfish (systems + thermal)
 * ------------------------------------------------------------------ */
function redfishGet(host, port, pathName, user, password, secure = true) {
  return new Promise((resolve) => {
    const mod = secure ? https : http;
    const headers = { Accept: 'application/json' };
    if (user) headers.Authorization = `Basic ${Buffer.from(`${user}:${password || ''}`).toString('base64')}`;
    const req = mod.request({
      host, port, path: pathName, method: 'GET', headers,
      rejectUnauthorized: false, timeout: 8000,
    }, (resp) => {
      let data = '';
      resp.on('data', (c) => { data += c; });
      resp.on('end', () => {
        try { resolve({ status: resp.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: resp.statusCode, error: '响应不是 JSON' }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => resolve({ error: err.message }));
    req.end();
  });
}

async function handleRedfish(req, res) {
  const body = await readBody(req);
  const host = String(body.host || '').trim();
  const port = clampInt(body.port, 443, 1, 65535);
  const user = String(body.user || '').slice(0, 64);
  const password = String(body.password || '').slice(0, 128);
  const secure = body.secure === true || (body.secure !== false && port === 443);
  if (!/^[A-Za-z0-9._:-]{1,253}$/.test(host)) {
    return json(res, 400, { ok: false, error: '设备地址不合法' });
  }
  const t0 = Date.now();
  const systems = await redfishGet(host, port, '/redfish/v1/Systems', user, password, secure);
  if (systems.error) return json(res, 200, { ok: false, error: systems.error, ms: Date.now() - t0 });
  if (systems.status !== 200) return json(res, 200, { ok: false, error: `HTTP ${systems.status}`, ms: Date.now() - t0 });

  const member = systems.body?.Members?.[0]?.['@odata.id'];
  if (!member) return json(res, 200, { ok: false, error: '没有 Systems 成员', ms: Date.now() - t0 });
  const sys = await redfishGet(host, port, member, user, password, secure);
  if (sys.error || sys.status !== 200) {
    return json(res, 200, { ok: false, error: sys.error || `HTTP ${sys.status}`, ms: Date.now() - t0 });
  }
  const s = sys.body || {};
  let tempC = null;
  const chassis = await redfishGet(host, port, '/redfish/v1/Chassis', user, password, secure);
  const chMember = chassis.body?.Members?.[0]?.['@odata.id'];
  if (chMember) {
    const thermal = await redfishGet(host, port, `${chMember}/Thermal`, user, password, secure);
    if (thermal.status === 200 && Array.isArray(thermal.body?.Temperatures)) {
      const vals = thermal.body.Temperatures
        .map((x) => x.ReadingCelsius)
        .filter((v) => Number.isFinite(v));
      if (vals.length) tempC = Math.max(...vals);
    }
  }

  json(res, 200, {
    ok: true,
    ms: Date.now() - t0,
    model: s.Model || s.Manufacturer || 'Redfish 服务器',
    powerState: s.PowerState || 'Unknown',
    health: s.Status?.Health || 'Unknown',
    cpuCount: s.ProcessorSummary?.Count ?? null,
    memGiB: s.MemorySummary?.TotalSystemMemoryGiB ?? null,
    hostName: s.HostName || '',
    tempC,
  });
}

function localOnly(req) {
  const addr = req.socket.remoteAddress || '';
  return !addr || /^(127\.|::1|::ffff:127\.)/.test(addr);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}`);

  if (url.pathname.startsWith('/api/')) {
    if (!localOnly(req)) return json(res, 403, { ok: false, error: 'local access only' });
    try {
      if (url.pathname === '/api/netinfo') {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleNetinfo(req, res);
      }
      if (url.pathname === '/api/discover') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleDiscover(req, res);
      }
      if (url.pathname === '/api/probe') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleProbe(req, res);
      }
      if (url.pathname === '/api/dispatch') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleDispatch(req, res);
      }
      if (url.pathname === '/api/notify') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleNotify(req, res);
      }
      if (url.pathname === '/api/snmp') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleSnmp(req, res);
      }
      if (url.pathname === '/api/redfish') {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        return await handleRedfish(req, res);
      }
      return json(res, 404, { ok: false, error: 'unknown api' });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
    }
  }

  try {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NEXUS DC → http://${HOST}:${PORT}/  (root: ${ROOT})`);
});
