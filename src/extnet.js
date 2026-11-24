/**
 * External / edge network: nodes that live outside the 3D hall plus the
 * command gateway used to push CLI to them.
 *
 * Two execution paths:
 *  - simulate: deterministic multi-vendor output generated in the browser
 *  - real:     POST /api/dispatch → local Node gateway → ssh / http device
 */
import { hostName as dcHost } from './netdevops/vendors.js';

export const EXT_KINDS = {
  router: { label: '外部路由器', color: '#8b7bff', prefix: 'EXT-RT', icon: '⤯' },
  switch: { label: '外部交换机', color: '#35d6ff', prefix: 'EXT-SW', icon: '⇄' },
  firewall: { label: '外部防火墙', color: '#ff4d63', prefix: 'EXT-FW', icon: '◈' },
  server: { label: '外部主机', color: '#3ddc97', prefix: 'EXT-SRV', icon: '▤' },
  cloud: { label: '云 / 互联网', color: '#ffb020', prefix: 'CLOUD', icon: '☁' },
};

export const EXT_VENDORS = {
  h3c: 'H3C',
  huawei: 'Huawei',
  cisco: 'Cisco',
  linux: 'Linux',
  generic: '通用',
};

let seq = 0;
export function newExtId() {
  seq += 1;
  return `ext_${Date.now().toString(36)}_${seq}`;
}

export function createExtNode(app, kind = 'router', pos = {}) {
  const meta = EXT_KINDS[kind] || EXT_KINDS.router;
  const n = (app.state.ext || []).length + 1;
  return {
    id: newExtId(),
    kind,
    name: `${meta.prefix}-${String(n).padStart(2, '0')}`,
    vendor: kind === 'server' ? 'linux' : 'h3c',
    host: '',
    port: 22,
    protocol: kind === 'cloud' ? 'sim' : 'ssh',
    user: 'netops',
    note: '',
    uplink: null,
    x: pos.x || 0,
    y: pos.y || 0,
    status: 'unknown',
    lastAt: 0,
    lastLatency: 0,
  };
}

export function extNodeLabel(ext) {
  return ext.host ? `${ext.name} · ${ext.host}` : ext.name;
}

/* ------------------------------------------------------------------ *
 *  Command execution
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function banner(ext) {
  const v = ext.vendor;
  if (v === 'cisco') return `Cisco IOS XE Software, Version 17.09.04a\n${ext.name} uptime is 4 weeks, 2 days`;
  if (v === 'huawei') return `Huawei VRP (R) software, Version 8.180\nHUAWEI ${ext.name} uptime is 4 weeks, 2 days`;
  if (v === 'linux') return `Linux ${ext.name.toLowerCase()} 5.15.0-105-generic x86_64`;
  if (v === 'generic') return `${ext.name} · generic device · firmware 1.0.0`;
  return `H3C Comware Software, Version 7.1.070, Release 3506P02\nH3C ${ext.name} uptime is 4 weeks, 2 days`;
}

export function simulateExt(ext, lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const l = line.toLowerCase();
    const isCisco = ext.vendor === 'cisco';
    out.push(`${ext.name}> ${line}`);
    if (l.includes('version')) {
      out.push(banner(ext));
    } else if (l.includes('interface brief') || l.includes('ip interface brief') || l.includes('ip a')) {
      out.push('Interface   IP Address       Status  Speed  Description');
      out.push('GE0/1       10.0.0.1/30      up      10G    to-DC-core');
      out.push('GE0/2       192.168.10.1/24  up      1G     LAN');
      out.push('GE0/3       unassigned       down    auto   —');
    } else if (l.includes('routing-table') || l.includes('ip route')) {
      out.push('Destination/Mask   Proto   NextHop        Interface');
      out.push('0.0.0.0/0          Static  10.10.0.1      GE0/1');
      out.push('10.0.0.0/30        Direct  10.0.0.1       GE0/1');
    } else if (l.includes('cpu')) {
      out.push('CPU usage: 8% (5s), 9% (1m), 7% (5m)');
    } else if (l.includes('memory')) {
      out.push('Memory: 2048 MB total, 812 MB used (39.6%)');
    } else if (l.includes('environment')) {
      out.push('Inlet 23.4 C · Outlet 29.1 C · Fan Normal · Power Normal');
    } else if (l.startsWith('ping')) {
      const ip = line.split(/\s+/)[1] || '10.0.0.2';
      out.push(`PING ${ip}: 56 data bytes`);
      out.push(`Reply from ${ip}: bytes=56 ttl=254 time=1 ms`);
      out.push(`Reply from ${ip}: bytes=56 ttl=254 time=2 ms`);
      out.push(`--- ${ip} ping statistics ---`);
      out.push('2 packet(s) transmitted, 2 packet(s) received, 0.0% packet loss');
    } else if (l === 'save' || l === 'write memory') {
      out.push('Configuration is saved to device successfully.');
    } else if (isCisco) {
      out.push(`% Invalid input detected at '^' marker.`);
    } else {
      out.push(`% Unrecognized command found at '^' position.`);
    }
    out.push('');
  }
  return out.join('\n');
}

export async function dispatchCommands(app, ext, commands, { real = false } = {}) {
  const list = commands.map((c) => String(c)).filter((c) => c.trim());
  if (!list.length) throw new Error('没有可执行命令');
  const t0 = performance.now();

  if (!real) {
    await sleep(220 + Math.random() * 260);
    const text = simulateExt(ext, list);
    ext.status = 'sim';
    ext.lastAt = Date.now();
    ext.lastLatency = Math.round(performance.now() - t0);
    return { ok: true, adapter: 'simulate', stdout: text, stderr: '', ms: ext.lastLatency };
  }

  if (!ext.host) throw new Error('请先填写设备管理地址');
  const res = await fetch('/api/dispatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocol: ext.protocol === 'http' ? 'http' : 'ssh',
      host: ext.host,
      port: Number(ext.port) || (ext.protocol === 'http' ? 80 : 22),
      user: ext.user,
      commands: list,
    }),
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  ext.lastAt = Date.now();
  ext.lastLatency = data.ms || Math.round(performance.now() - t0);
  if (!data.ok) {
    ext.status = 'error';
    return {
      ok: false,
      adapter: data.adapter || ext.protocol,
      stdout: data.stdout || '',
      stderr: data.stderr || data.error || '网关返回失败',
      ms: ext.lastLatency,
    };
  }
  ext.status = 'online';
  return {
    ok: true,
    adapter: data.adapter || ext.protocol,
    stdout: data.stdout || '',
    stderr: data.stderr || '',
    ms: ext.lastLatency,
  };
}

/** Human readable hint for the dispatch modal. */
export function gatewayHint(ext) {
  if (ext.protocol === 'sim') return '模拟模式：不会连接任何真实设备。';
  if (ext.protocol === 'http') return `将以 POST http://${ext.host || '<host>'}:${ext.port}/api/exec 下发 JSON 命令。`;
  return `将通过本机 ssh（BatchMode，密钥/agent 认证）连接 ${ext.user || 'netops'}@${ext.host || '<host>'}:${ext.port}。`;
}

export function deviceChoiceLabel(app) {
  return Object.values(app.state.devices)
    .map((d) => ({ id: d.id, label: `${d.name} · ${dcHost(d, app.state)}` }));
}
