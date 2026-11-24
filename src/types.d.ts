/**
 * Shared type contracts for the browser modules.
 *
 * The project runs as native ESM without a build step, so these interfaces are
 * consumed by editors / `tsc --noEmit` (see jsconfig.json) and by the gradual
 * `// @ts-check` rollout. They are the migration seam for a future TypeScript
 * conversion: modules already depend on these shapes rather than ad-hoc objects.
 */

export type DeviceKind =
  | 'rack' | 'switch48' | 'switch24' | 'router' | 'server1u' | 'server2u'
  | 'storage4u' | 'firewall' | 'patch24' | 'pdu1u';

export interface Port {
  id: string;
  label: string;
  kind: 'rj45' | 'sfp' | 'qsfp' | 'patch' | 'power';
  speed: number;
  x: number;
  y: number;
  w: number;
  h: number;
  state: 'up' | 'down' | 'err';
  adminUp: boolean;
  util: number;
  errors: number;
  cable: string | null;
}

export interface Metrics {
  cpu: number;
  mem: number;
  temp: number;
  power: number;
  throughput: number;
  errors: number;
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  model: string;
  u: number;
  slot: number;
  rackId: string;
  ports: Port[];
  metrics: Metrics;
  status: 'online' | 'offline' | 'rebooting' | 'error';
  adminPower: boolean;
  powerRated: number;
  flags: { fanFail: boolean; overheat: boolean; loss: boolean; congestion: boolean };
  realSource?: { host: string; at: number; latency: number; error?: string };
  group?: unknown;
}

export interface Rack {
  id: string;
  name: string;
  x: number;
  z: number;
  rotY: number;
  devices: string[];
  temp: number;
  power: number;
  powerCap: number;
  doorTarget: number;
}

export interface CableEnd { devId: string; portId: string }
export interface Cable {
  id: string;
  a: CableEnd;
  b: CableEnd;
  speed: number;
  lengthM: number;
}

export interface ExtNode {
  id: string;
  kind: 'router' | 'switch' | 'server' | 'cloud' | 'firewall';
  name: string;
  host: string;
  port: number;
  protocol: 'ssh' | 'telnet' | 'http';
  vendor: string;
  status: 'online' | 'offline' | 'error' | 'sim' | 'unknown';
  uplink: string | null;
  x: number;
  y: number;
  realId?: string;
}

export interface RealDevice {
  id: string;
  host: string;
  port: number;
  user: string;
  family: 'auto' | 'h3c' | 'huawei' | 'cisco' | 'linux';
  protocol: 'ssh' | 'snmp' | 'redfish';
  vendor: string;
  model: string;
  status: 'online' | 'offline' | 'error' | 'authfail' | 'unknown';
  metrics: { cpu: number | null; mem: number | null; temp: number | null };
  boundDeviceId: string | null;
  extId: string | null;
  neighbors?: Array<{ remote: string; remotePort?: string }>;
}

export interface Alarm {
  id: string;
  sev: 'critical' | 'major' | 'minor';
  title: string;
  desc: string;
  ack: boolean;
  since: number;
  ticks: number;
  targetId: string | null;
  targetType: 'device' | 'rack' | null;
}

export interface WorkOrder {
  id: string;
  title: string;
  deviceId: string | null;
  deviceName: string;
  rack: string;
  level: 'P1' | 'P2' | 'P3';
  status: 'open' | 'doing' | 'done';
  source: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface TelemetrySample {
  t: number;
  thr: number;
  temp: number;
  power: number;
  online: number;
  devices: number;
  portsUp: number;
}

export interface AppState {
  racks: Rack[];
  devices: Record<string, Device>;
  cables: Record<string, Cable>;
  ext: ExtNode[];
  real: RealDevice[];
  dataMode: 'sim' | 'real';
  perf: 'low' | 'mid' | 'high';
  selection: { type: 'device' | 'rack' | 'cable'; id: string } | null;
  selectionSet: Array<{ type: 'device' | 'rack' | 'cable'; id: string }>;
}
