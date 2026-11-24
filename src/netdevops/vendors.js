/**
 * Vendor identities and naming conventions for the NetDevOps console.
 * The vendor split mirrors the multi-vendor support of NetDevOps-Toolbox-V1
 * (H3C / Huawei / Cisco), with a Linux profile for the compute nodes.
 */

export const VENDORS = {
  h3c: {
    key: 'h3c',
    label: 'H3C',
    full: '华三 H3C',
    family: 'comware',
    os: 'Comware 7.1.070, Release 3506P02',
    promptSuffix: '>',
    cli: true,
  },
  huawei: {
    key: 'huawei',
    label: 'HUAWEI',
    full: '华为 Huawei',
    family: 'comware',
    os: 'VRP V200R019C10SPC800',
    promptSuffix: '>',
    cli: true,
  },
  cisco: {
    key: 'cisco',
    label: 'CISCO',
    full: '思科 Cisco',
    family: 'ios',
    os: 'IOS XE 17.09.04a',
    promptSuffix: '#',
    cli: true,
  },
  linux: {
    key: 'linux',
    label: 'LINUX',
    full: 'Linux',
    family: 'linux',
    os: 'Ubuntu 22.04.4 LTS',
    promptSuffix: '#',
    cli: true,
  },
  none: {
    key: 'none',
    label: '—',
    full: '无管理平面',
    family: 'none',
    os: '—',
    promptSuffix: '>',
    cli: false,
  },
};

const KIND_VENDOR = {
  switch48: 'h3c',
  switch24: 'h3c',
  router: 'huawei',
  firewall: 'huawei',
  server1u: 'linux',
  server2u: 'linux',
  storage4u: 'linux',
  patch24: 'none',
  pdu1u: 'none',
};

export function vendorKey(dev) {
  return dev?.vendor || KIND_VENDOR[dev?.kind] || 'none';
}

export function vendor(dev) {
  return VENDORS[vendorKey(dev)] || VENDORS.none;
}

export function hasCli(dev) {
  return vendor(dev).cli;
}

const PREFIX = {
  switch48: 'SW', switch24: 'SW', router: 'RT', firewall: 'FW',
  server1u: 'SRV', server2u: 'SRV', storage4u: 'SAN', patch24: 'PP', pdu1u: 'PDU',
};

export function hostName(dev, state) {
  const rack = state?.racks?.find((r) => r.id === dev?.rackId);
  const base = `${PREFIX[dev?.kind] || 'DEV'}-${rack ? rack.name : 'X'}-${String(dev?.slot || 1).padStart(2, '0')}`;
  return base.replace(/[^A-Za-z0-9-]/g, '');
}

export function mgmtIp(dev, state) {
  const rack = state?.racks?.find((r) => r.id === dev?.rackId);
  const ri = rack ? state.racks.indexOf(rack) + 1 : 1;
  const di = rack ? Math.max(1, rack.devices.indexOf(dev.id) + 1) : 1;
  return `10.10.${ri}.${10 + di}`;
}

export const MGMT_GATEWAY = '10.10.0.1';
export const NTP_SERVER = '10.10.0.10';
export const SYSLOG_SERVER = '10.10.0.20';

/** Vendor-style interface name for a catalogue port. */
export function portName(port, index) {
  const n = index + 1;
  if (port.kind === 'qsfp' || port.speed >= 100) return `HundredGigE1/0/${n}`;
  if (port.kind === 'sfp' && port.speed >= 25) return `Twenty-FiveGigE1/0/${n}`;
  if (port.kind === 'sfp') return `Ten-GigabitEthernet1/0/${n}`;
  if (port.kind === 'power') return `Power1/0/${n}`;
  return `GigabitEthernet1/0/${n}`;
}

export function shortPortName(port, index) {
  if (port.kind === 'qsfp' || port.speed >= 100) return `Hu${index + 1}`;
  if (port.kind === 'sfp' && port.speed >= 25) return `25GE${index + 1}`;
  if (port.kind === 'sfp') return `Te${index + 1}`;
  return `GE${index + 1}`;
}

export const VLAN = {
  MGMT: 10,
  WEB: 20,
  DB: 30,
  STORAGE: 40,
  DMZ: 50,
  TRANSIT: 99,
};

export const VLAN_NAMES = {
  10: 'MGMT',
  20: 'PROD-WEB',
  30: 'PROD-DB',
  40: 'STORAGE',
  50: 'DMZ',
  99: 'TRANSIT',
};

/** Access VLAN implied by the device on the other end of a patch cable. */
export function vlanForPeer(peer) {
  if (!peer) return null;
  switch (peer.kind) {
    case 'server1u': return VLAN.WEB;
    case 'server2u': return VLAN.DB;
    case 'storage4u': return VLAN.STORAGE;
    case 'firewall': return VLAN.DMZ;
    case 'router': return VLAN.TRANSIT;
    default: return null;
  }
}

export function describePort(app, dev, port) {
  const cable = port.cable ? app.state.cables[port.cable] : null;
  if (!cable) return 'unused';
  const other = cable.a.devId === dev.id ? cable.b : cable.a;
  const peer = app.state.devices[other.devId];
  if (!peer) return 'unused';
  return `To-${hostName(peer, app.state)}:${peer.ports.find((p) => p.id === other.portId)?.label || ''}`;
}

export function peerOf(app, dev, port) {
  const cable = port.cable ? app.state.cables[port.cable] : null;
  if (!cable) return null;
  const other = cable.a.devId === dev.id ? cable.b : cable.a;
  return app.state.devices[other.devId] || null;
}

/** Stable pseudo-random derived from a device id (for uptime, serials…). */
export function pseudo(dev, salt = 0) {
  let h = 2166136261;
  const s = `${dev.id}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
