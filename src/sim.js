import { clamp, rand, fmt } from './util.js';

export const SEV = { critical: 3, major: 2, minor: 1 };
export const SEV_LABEL = { critical: '严重', major: '重要', minor: '提示' };
const ALARM_KEY = 'nexusdc.alarms.v1';

let seq = 0;

export class Simulation {
  constructor(state) {
    this.state = state;
    this.alarms = new Map();
    this.events = [];
    this.tickNo = 0;
    this.autoHeal = false;
    this.history = { thr: [], temp: [], power: [] };
    this.stats = {
      devices: 0, online: 0, portsUp: 0, portsTotal: 0, throughput: 0,
      power: 0, avgTemp: 22, critical: 0, major: 0, minor: 0,
      alarms: 0, health: 100, pue: 1.3,
    };
    this.onAlarm = null;
    this.loadPersisted();
    this.log('info', 'NEXUS DC 运维引擎已启动 · 遥测周期 1s');
  }

  loadPersisted() {
    try {
      const d = JSON.parse(localStorage.getItem(ALARM_KEY) || '{}');
      for (const a of d.alarms || []) {
        if (!a?.id) continue;
        this.alarms.set(a.id, { ...a, fix: null, ticks: a.ticks || 0 });
      }
      if (Array.isArray(d.events)) this.events = d.events.slice(0, 200);
    } catch { /* ignore */ }
  }

  persist() {
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => {
      try {
        const alarms = [...this.alarms.values()].map(({ fix, ...rest }) => rest);
        localStorage.setItem(ALARM_KEY, JSON.stringify({ alarms, events: this.events.slice(0, 200) }));
      } catch { /* quota */ }
    }, 400);
  }

  clearAllAlarms() {
    this.alarms.clear();
    this.events = [];
    try { localStorage.removeItem(ALARM_KEY); } catch { /* ignore */ }
    this.log('info', '告警与事件已清空');
  }

  /* ------------------------------ logging ------------------------------ */
  log(level, text) {
    this.events.unshift({ id: ++seq, t: Date.now(), level, text });
    if (this.events.length > 160) this.events.pop();
    this.persist();
  }

  /* ------------------------------ alarms ------------------------------- */
  raise(id, sev, title, desc, meta = {}) {
    if (this.alarms.has(id)) {
      const a = this.alarms.get(id);
      a.ticks++;
      if (desc) a.desc = desc;
      return a;
    }
    const a = {
      id, sev, title, desc, ticks: 0, since: Date.now(), ack: false,
      targetId: meta.targetId || null, targetType: meta.targetType || null,
      fix: meta.fix || null,
    };
    this.alarms.set(id, a);
    this.log(sev === 'critical' ? 'error' : 'warn', `[${SEV_LABEL[sev]}] ${title} — ${desc}`);
    try { this.onAlarm?.(a); } catch { /* ignore */ }
    this.persist();
    return a;
  }

  clear(id) {
    const a = this.alarms.get(id);
    if (!a) return;
    this.alarms.delete(id);
    this.log('ok', `告警恢复：${a.title}`);
    this.persist();
  }

  ack(id) {
    const a = this.alarms.get(id);
    if (a) a.ack = true;
    this.persist();
  }

  ackAll() {
    for (const a of this.alarms.values()) a.ack = true;
    this.persist();
  }

  /* ------------------------------ actions ------------------------------ */
  togglePort(dev, port) {
    port.adminUp = !port.adminUp;
    this.log('info', `${dev.name} ${port.label} 管理状态 ${port.adminUp ? 'up' : 'down'}`);
  }

  deviceAction(dev, action) {
    switch (action) {
      case 'powerOff':
        dev.adminPower = false;
        dev.status = 'offline';
        this.log('error', `${dev.name} 已强制断电`);
        break;
      case 'powerOn':
        dev.adminPower = true;
        dev.status = 'online';
        dev.flags.fanFail = false;
        dev.flags.overheat = 0;
        this.log('ok', `${dev.name} 已上电，自检通过`);
        break;
      case 'reboot':
        if (dev.status === 'rebooting') return;
        dev.status = 'rebooting';
        dev.rebootTick = this.tickNo + 7;
        this.log('warn', `${dev.name} 触发重启，业务切换中…`);
        break;
      case 'repair':
        dev.flags.fanFail = false;
        dev.flags.overheat = 0;
        dev.flags.congestion = false;
        dev.flags.loss = false;
        dev.flags.lossPort = null;
        dev.adminPower = true;
        dev.status = 'online';
        for (const p of dev.ports) { p.errors = 0; p.adminUp = true; }
        this.log('ok', `${dev.name} 故障已修复，端口恢复`);
        break;
      case 'isolate':
        dev.adminPower = false;
        dev.status = 'offline';
        this.log('warn', `${dev.name} 已隔离，等待现场处理`);
        break;
      default:
        break;
    }
  }

  inject(dev, kind) {
    if (!dev) return;
    switch (kind) {
      case 'power':
        dev.adminPower = false;
        dev.status = 'offline';
        this.log('error', `演练：${dev.name} 电源失效`);
        break;
      case 'fan':
        dev.flags.fanFail = true;
        this.log('warn', `演练：${dev.name} 风扇故障，散热能力下降`);
        break;
      case 'overheat':
        dev.flags.overheat = 15;
        this.log('warn', `演练：${dev.name} 进风温度飙升`);
        break;
      case 'loss': {
        const candidates = dev.ports.filter((p) => p.cable && p.kind !== 'power');
        const p = candidates[0] || dev.ports[0];
        dev.flags.loss = true;
        dev.flags.lossPort = p ? p.id : null;
        if (p) p.errors += 320;
        this.log('warn', `演练：${dev.name} ${p ? p.label : ''} 出现丢包与 CRC 错误`);
        break;
      }
      case 'congestion':
        dev.flags.congestion = true;
        this.log('warn', `演练：${dev.name} 流量拥塞，CPU 飙升`);
        break;
      default:
        break;
    }
  }

  coolRack(rack) {
    rack.coolingBoost = 14;
    this.log('info', `${rack.name} 启动应急制冷，目标温度 20℃`);
  }

  /* -------------------------------- tick ------------------------------- */
  tick() {
    this.tickNo++;
    const t = this.tickNo;
    const devs = Object.values(this.state.devices);

    // reboot completion
    for (const d of devs) {
      if (d.status === 'rebooting' && d.rebootTick && t >= d.rebootTick) {
        d.status = 'online';
        d.rebootTick = 0;
        this.log('ok', `${d.name} 重启完成，服务已恢复`);
      }
    }

    // 1) device workload + power
    for (const d of devs) {
      const online = d.adminPower && d.status === 'online';
      if (!online) {
        d.metrics.cpu = Math.max(0, d.metrics.cpu * 0.6);
        d.metrics.power = d.adminPower ? d.powerRated * 0.05 : 0;
        d.metrics.throughput = 0;
        continue;
      }
      if (d.phase === undefined) d.phase = Math.random() * 100;
      const wave = Math.sin((t + d.phase) / 16) * 7 + Math.sin((t + d.phase) / 5.3) * 3;
      const base = d.cpuBase + (d.flags.congestion ? 38 : 0);
      d.metrics.cpu = clamp(base + wave + rand(-3, 3), 2, 99);
      d.metrics.mem = clamp(d.metrics.mem + rand(-1.2, 1.2), 18, 96);
      d.metrics.power = d.powerRated * (0.34 + 0.62 * (d.metrics.cpu / 100));
    }

    // 2) racks: power / thermal
    let totalPower = 0;
    let tempSum = 0;
    let racksWithLoad = 0;

    for (const rack of this.state.racks) {
      const rd = (rack.devices || []).map((id) => this.state.devices[id]).filter(Boolean);
      let power = 0;
      let overheat = 0;
      let fanFail = 0;
      for (const d of rd) {
        power += d.metrics.power;
        overheat += d.flags.overheat || 0;
        if (d.flags.fanFail) fanFail++;
      }
      rack.power = power / 1000; // kW
      const cooling = rack.coolingBoost > 0 ? 2.6 : 0;
      if (rack.coolingBoost > 0) rack.coolingBoost--;
      const inlet = 21.2 + Math.sin((t + rack.x * 3) / 40) * 0.4;
      let temp = inlet + rack.power * 1.55 + overheat * 0.9 + fanFail * 2.2 - cooling;
      if (rack.temp === undefined) rack.temp = 22;
      rack.temp = rack.temp + (temp - rack.temp) * 0.35;
      rack.fanFail = fanFail;

      for (const d of rd) {
        d.metrics.temp = rack.temp + 3.5 + d.metrics.cpu * 0.07 + (d.flags.fanFail ? 3 : 0);
      }
      totalPower += power;
      tempSum += rack.temp;
      racksWithLoad++;

      // rack level alarms
      const tid = `rack-temp-${rack.id}`;
      if (rack.temp > 38) {
        this.raise(tid, 'critical', `${rack.name} 温度严重超限`, `出风温度 ${fmt(rack.temp)}℃，超过 38℃ 红线`, {
          targetId: rack.id, targetType: 'rack',
          fix: () => this.coolRack(rack),
        });
      } else if (rack.temp > 32) {
        this.raise(tid, 'major', `${rack.name} 温度偏高`, `当前 ${fmt(rack.temp)}℃，高于 32℃ 警戒线，建议检查制冷与盲板`, {
          targetId: rack.id, targetType: 'rack',
          fix: () => this.coolRack(rack),
        });
      } else {
        this.clear(tid);
      }

      const pid = `rack-pwr-${rack.id}`;
      if (rack.powerCap && rack.power > rack.powerCap * 0.9) {
        this.raise(pid, 'minor', `${rack.name} 功率接近上限`, `${fmt(rack.power, 2)}kW / ${rack.powerCap}kW`, {
          targetId: rack.id, targetType: 'rack',
        });
      } else {
        this.clear(pid);
      }
    }

    // 3) ports + cabling traffic
    let portsUp = 0;
    let portsTotal = 0;
    for (const d of devs) {
      const online = d.adminPower && d.status === 'online';
      for (const p of d.ports) {
        portsTotal++;
        p.tx = 0;
        p.rx = 0;
        p.util = 0;
        if (!online) { p.state = 'down'; continue; }
        if (d.flags.loss && d.flags.lossPort === p.id) {
          p.errors += rand(25, 90);
          p.state = 'err';
        } else if (!p.adminUp) {
          p.state = 'down';
        } else if (p.cable) {
          p.state = 'up';
        } else if (p.kind === 'power') {
          p.state = 'up';
        } else {
          p.state = 'down';
        }
        if (p.state === 'up') portsUp++;
      }
    }

    let throughput = 0;
    for (const c of Object.values(this.state.cables)) {
      const da = this.state.devices[c.a.devId];
      const db = this.state.devices[c.b.devId];
      if (!da || !db) continue;
      const pa = da.ports.find((p) => p.id === c.a.portId);
      const pb = db.ports.find((p) => p.id === c.b.portId);
      if (!pa || !pb) continue;
      if (pa.state !== 'up' || pb.state !== 'up') continue;

      const cap = Math.max(0.1, Math.min(pa.speed || 1, pb.speed || 1));
      const cpuF = (da.metrics.cpu + db.metrics.cpu) / 200;
      let load = clamp(0.08 + cpuF * 0.85 + rand(-0.07, 0.07) + (da.flags.congestion ? 0.2 : 0), 0.02, 0.96);
      const gbps = cap * load;
      pa.tx += gbps;
      pb.rx += gbps;
      pb.tx += gbps * 0.82;
      pa.rx += gbps * 0.82;
      throughput += gbps;
      if (da.flags.congestion && Math.random() < 0.02) {
        pa.errors += rand(1, 8);
      }
    }

    for (const d of devs) {
      let tput = 0;
      for (const p of d.ports) {
        const traffic = Math.max(p.tx, p.rx);
        if (traffic > 0 && p.speed) p.util = clamp(traffic / p.speed, 0, 1);
        tput += traffic;
        const aid = `port-err-${d.id}-${p.id}`;
        if (p.errors > 500) {
          this.raise(aid, 'major', `${d.name} ${p.label} 端口错误激增`, `累计 CRC/丢包 ${Math.round(p.errors)} 次`, {
            targetId: d.id, targetType: 'device', fix: () => this.deviceAction(d, 'repair'),
          });
        } else {
          this.clear(aid);
        }
      }
      d.metrics.throughput = tput;

      // device level alarms
      const did = `dev-${d.id}`;
      if (d.status === 'offline') {
        this.raise(did, d.adminPower ? 'major' : 'major', `${d.name} 离线`, '设备无心跳，业务可能中断', {
          targetId: d.id, targetType: 'device', fix: () => this.deviceAction(d, 'powerOn'),
        });
      } else if (d.status === 'rebooting') {
        this.raise(did, 'minor', `${d.name} 重启中`, '控制面正在重新加载配置', {
          targetId: d.id, targetType: 'device',
        });
      } else if (d.flags.fanFail) {
        this.raise(did, 'major', `${d.name} 风扇故障`, '散热风扇转速为 0，请注意温度', {
          targetId: d.id, targetType: 'device', fix: () => this.deviceAction(d, 'repair'),
        });
      } else {
        this.clear(did);
      }
    }

    // 4) auto remediation
    if (this.autoHeal) {
      for (const a of [...this.alarms.values()]) {
        if (a.fix && a.ticks >= 20) {
          this.log('info', `自愈引擎处置告警：${a.title}`);
          a.fix();
          this.alarms.delete(a.id);
        }
      }
    }

    // 5) aggregate stats
    const online = devs.filter((d) => d.status === 'online' && d.adminPower).length;
    let crit = 0, maj = 0, min = 0;
    for (const a of this.alarms.values()) {
      if (a.sev === 'critical') crit++;
      else if (a.sev === 'major') maj++;
      else min++;
    }
    const avgTemp = racksWithLoad ? tempSum / racksWithLoad : 22;
    const health = clamp(100 - crit * 26 - maj * 9 - min * 3 - Math.max(0, avgTemp - 26) * 2, 0, 100);

    this.stats = {
      devices: devs.length,
      online,
      portsUp,
      portsTotal,
      throughput,
      power: totalPower / 1000,
      avgTemp,
      critical: crit,
      major: maj,
      minor: min,
      alarms: this.alarms.size,
      health,
      pue: clamp(1.22 + Math.max(0, avgTemp - 24) * 0.018, 1.2, 1.9),
    };

    const h = this.history;
    h.thr.push(throughput);
    h.temp.push(avgTemp);
    h.power.push(this.stats.power);
    for (const k of ['thr', 'temp', 'power']) {
      if (h[k].length > 80) h[k].shift();
    }
    return this.stats;
  }

  get alarmsList() {
    return [...this.alarms.values()].sort((a, b) => (SEV[b.sev] - SEV[a.sev]) || (a.since - b.since));
  }
}

export function rackDeviceList(state, rack) {
  return (rack.devices || []).map((id) => state.devices[id]).filter(Boolean);
}
