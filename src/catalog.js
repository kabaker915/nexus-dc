import { uid } from './util.js';

/* ------------------------------------------------------------------ *
 *  Hardware catalog — port layouts are metric, in device-local space
 *  (origin = centre of the front face, +x right, +y up).
 * ------------------------------------------------------------------ */

const P = (o) => ({
  id: o.id,
  label: o.label || o.id,
  kind: o.kind || 'rj45',
  speed: o.speed || 1,          // Gbps
  x: o.x, y: o.y,
  w: o.w || 0.0066,
  h: o.h || 0.0088,
  state: 'down',
  adminUp: true,
  util: 0,
  rx: 0,
  tx: 0,
  errors: 0,
  cable: null,
});

const rj = (id, x, y, speed = 1, w = 0.0066) => P({ id, x, y, speed, w, h: 0.0088, kind: 'rj45' });
const sfp = (id, x, y, speed = 10) => P({ id, x, y, speed, w: 0.0168, h: 0.0076, kind: 'sfp' });

function switch48Ports() {
  const p = [];
  for (let i = 0; i < 48; i++) {
    p.push(rj(`Gi0/${i + 1}`, -0.192 + i * 0.00755, 0, 1, 0.0064));
  }
  p.push(sfp('Te0/49', 0.198, 0.0095, 10));
  p.push(sfp('Te0/50', 0.217, 0.0095, 10));
  p.push(sfp('Te0/51', 0.198, -0.0095, 10));
  p.push(sfp('Te0/52', 0.217, -0.0095, 10));
  return p;
}

function switch24Ports() {
  const p = [];
  for (let i = 0; i < 24; i++) p.push(rj(`Gi1/0/${i + 1}`, -0.19 + i * 0.0152, 0, 1, 0.013));
  p.push(sfp('Te1/0/25', 0.198, 0.0095, 10));
  p.push(sfp('Te1/0/26', 0.217, 0.0095, 10));
  p.push(sfp('Te1/0/27', 0.198, -0.0095, 10));
  p.push(sfp('Te1/0/28', 0.217, -0.0095, 10));
  return p;
}

function routerPorts() {
  const p = [];
  for (let i = 0; i < 8; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    p.push(P({
      id: `Hu0/${i + 1}`, x: -0.205 + col * 0.0212, y: row === 0 ? 0.018 : -0.018,
      speed: 25, kind: 'sfp', w: 0.018, h: 0.008,
    }));
  }
  for (let i = 0; i < 4; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    p.push(P({
      id: `Hu1/${i + 1}`, x: -0.062 + col * 0.028, y: row === 0 ? 0.018 : -0.018,
      speed: 100, kind: 'qsfp', w: 0.025, h: 0.012,
    }));
  }
  for (let i = 0; i < 4; i++) p.push(rj(`Mg0/${i + 1}`, 0.018 + i * 0.0158, 0.018, 1));
  p.push(rj('Con0', 0.018, -0.018, 1));
  return p;
}

function server1uPorts() {
  const p = [];
  for (let i = 0; i < 4; i++) p.push(rj(`eno${i + 1}`, -0.058 + i * 0.0149, 0, 1));
  p.push(sfp('ens1f0', 0.012, 0, 10));
  p.push(sfp('ens1f1', 0.033, 0, 10));
  p.push(rj('ipmi', 0.075, 0, 1, 0.0062));
  return p;
}

function server2uPorts() {
  const p = [];
  p.push(rj('eno1', 0.058, 0.014, 1));
  p.push(rj('eno2', 0.077, 0.014, 1));
  p.push(sfp('ens1f0', 0.105, 0.014, 10));
  p.push(sfp('ens1f1', 0.128, 0.014, 10));
  p.push(rj('ipmi', 0.058, -0.018, 1, 0.0062));
  return p;
}

function storagePorts() {
  const p = [];
  p.push(sfp('ctr0-a', 0.176, 0.042, 25));
  p.push(sfp('ctr0-b', 0.198, 0.042, 25));
  p.push(sfp('ctr1-a', 0.176, 0.006, 25));
  p.push(sfp('ctr1-b', 0.198, 0.006, 25));
  p.push(rj('mgmt', 0.176, -0.04, 1, 0.0062));
  return p;
}

function patchPorts() {
  const p = [];
  for (let i = 0; i < 24; i++) {
    p.push(P({
      id: `K${String(i + 1).padStart(2, '0')}`,
      x: -0.205 + i * 0.0172, y: 0, w: 0.0138, h: 0.012, kind: 'patch', speed: 10,
    }));
  }
  return p;
}

function pduPorts() {
  const p = [];
  for (let i = 0; i < 8; i++) {
    p.push(P({
      id: `C13-${i + 1}`, x: -0.185 + i * 0.0455, y: 0,
      w: 0.029, h: 0.021, kind: 'power', speed: 0,
    }));
  }
  return p;
}

function firewallPorts() {
  const p = [];
  for (let i = 0; i < 8; i++) p.push(rj(`port${i + 1}`, -0.205 + i * 0.016, 0, 1, 0.0105));
  p.push(sfp('dmz1', 0.09, 0.0095, 10));
  p.push(sfp('dmz2', 0.109, 0.0095, 10));
  p.push(sfp('dmz3', 0.09, -0.0095, 10));
  p.push(sfp('dmz4', 0.109, -0.0095, 10));
  return p;
}

export const CATALOG = {
  rack: {
    label: '机柜 42U', short: '机柜', icon: '▯', group: 'build', kind: 'rack',
    desc: '600×1200×2000 标准服务器机柜，含前后门、理线器、竖直 PDU',
  },

  switch48: {
    label: '48 口交换机', short: '交换机', icon: '⇄', kind: 'device', u: 1, depth: 0.34,
    power: 165, brand: 'NEXUS', model: 'NX-4820T', vent: 'slots', accent: '#35d6ff',
    cpuBase: 22, desc: '48×GE + 4×10GE SFP+ 接入/汇聚交换机', ports: switch48Ports,
  },
  switch24: {
    label: '24 口交换机', short: '交换机', icon: '⇄', kind: 'device', u: 1, depth: 0.32,
    power: 120, brand: 'NEXUS', model: 'NX-2420T', vent: 'slots', accent: '#35d6ff',
    cpuBase: 18, desc: '24×GE + 4×10GE SFP+ 接入交换机', ports: switch24Ports,
  },
  router: {
    label: '核心路由器', short: '路由器', icon: '⤯', kind: 'device', u: 2, depth: 0.46,
    power: 380, brand: 'NEXUS', model: 'NX-R9600', vent: 'grill', accent: '#8b7bff',
    cpuBase: 31, desc: '8×25GE + 4×100GE QSFP28 核心路由设备', ports: routerPorts,
  },
  server1u: {
    label: '1U 服务器', short: '服务器', icon: '▤', kind: 'device', u: 1, depth: 0.62,
    power: 420, brand: 'NEXUS', model: 'R450-G6', vent: 'none', accent: '#3ddc97',
    cpuBase: 34, desc: '2×Xeon / 256GB / 8×2.5" 热插拔盘位的通用计算节点',
    ports: server1uPorts,
    drives: { cols: 8, rows: 1, w: 0.0128, h: 0.035, x0: -0.222, gapX: 0.0146, y: 0, gapY: 0 },
  },
  server2u: {
    label: '2U 数据库服务器', short: '2U 服务器', icon: '▥', kind: 'device', u: 2, depth: 0.68,
    power: 680, brand: 'NEXUS', model: 'R850-G6', vent: 'none', accent: '#3ddc97',
    cpuBase: 52, desc: '4×Xeon / 1TB / 12×3.5" 大容量存储计算节点',
    ports: server2uPorts,
    drives: { cols: 12, rows: 1, w: 0.0215, h: 0.066, x0: -0.228, gapX: 0.0232, y: 0, gapY: 0 },
  },
  storage4u: {
    label: '4U 存储阵列', short: '存储', icon: '▦', kind: 'device', u: 4, depth: 0.72,
    power: 950, brand: 'NEXUS', model: 'S8400', vent: 'none', accent: '#ffb020',
    cpuBase: 28, desc: '24×3.5" 盘位 + 双控制器，25GE 全闪/混闪存储',
    ports: storagePorts,
    drives: { cols: 12, rows: 2, w: 0.0275, h: 0.072, x0: -0.205, gapX: 0.0295, y: 0.041, gapY: 0.077 },
  },
  firewall: {
    label: '防火墙', short: '防火墙', icon: '◈', kind: 'device', u: 1, depth: 0.4,
    power: 210, brand: 'NEXUS', model: 'FW-3200', vent: 'mesh', accent: '#ff4d63',
    cpuBase: 41, desc: '8×GE + 4×10GE，下一代防火墙 / IPS / 应用识别',
    ports: firewallPorts,
  },
  patch24: {
    label: '24 口配线架', short: '配线架', icon: '▥', kind: 'device', u: 1, depth: 0.18,
    power: 0, brand: 'NEXUS', model: 'PP-24K', vent: 'none', accent: '#7f93a8',
    cpuBase: 0, desc: '24 口 Cat6A 屏蔽配线架，含理线环',
    ports: patchPorts,
  },
  pdu1u: {
    label: '1U PDU', short: 'PDU', icon: '⌁', kind: 'device', u: 1, depth: 0.2,
    power: 0, brand: 'NEXUS', model: 'PDU-8C13', vent: 'none', accent: '#ff8a3d',
    cpuBase: 0, desc: '8×C13 智能 PDU，支持分路计量与远程开关',
    ports: pduPorts,
  },
};

export const BUILD_LIST = ['rack', 'switch48', 'switch24', 'router', 'server1u', 'server2u', 'storage4u', 'firewall', 'patch24', 'pdu1u'];

export const PORT_COLORS = {
  up: 0x3ddc97,
  up10: 0x35d6ff,
  up25: 0x8b7bff,
  up100: 0xffb020,
  down: 0x16202a,
  err: 0xff4d63,
  patch: 0x6f8ba1,
  power: 0xff8a3d,
};

export function portUpColor(speed) {
  if (speed >= 100) return PORT_COLORS.up100;
  if (speed >= 25) return PORT_COLORS.up25;
  if (speed >= 10) return PORT_COLORS.up10;
  return PORT_COLORS.up;
}

/** Fresh runtime device record for a catalog kind. */
export function createDeviceData(kind, opts = {}) {
  const spec = CATALOG[kind];
  if (!spec) throw new Error(`unknown kind ${kind}`);
  const id = opts.id || uid('dev');
  return {
    id,
    kind,
    name: opts.name || `${spec.short}-${String(opts.index ?? 1).padStart(2, '0')}`,
    model: spec.model,
    u: spec.u,
    slot: opts.slot ?? 1,
    rackId: opts.rackId || null,
    status: 'online',
    adminPower: true,
    rebootingUntil: 0,
    powerRated: spec.power,
    cpuBase: spec.cpuBase,
    metrics: {
      cpu: spec.cpuBase, mem: 40, temp: 24, power: spec.power * 0.6, throughput: 0,
    },
    flags: { fanFail: false, overheat: 0, congestion: false, loss: false },
    ports: (spec.ports ? spec.ports() : []).map((p) => ({ ...p })),
    group: null,
    ledMesh: null,
    portMesh: null,
  };
}
