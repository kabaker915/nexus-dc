/**
 * Telemetry history (IndexedDB), capacity forecast and printable report.
 */
const DB_NAME = 'nexusdc-telemetry';
const STORE = 'samples';
const RETENTION_MS = 7 * 24 * 3600 * 1000;

export class Analytics {
  constructor(app) {
    this.app = app;
    this.db = null;
    this.samples = [];
    this.ready = this.open();
    this._lastPush = 0;
  }

  open() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 't' });
        };
        req.onsuccess = () => {
          this.db = req.result;
          this.load().then(resolve);
        };
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async load() {
    if (!this.db) return;
    this.samples = await new Promise((resolve) => {
      try {
        const tx = this.db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result || []).filter((s) => Date.now() - s.t < RETENTION_MS));
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }

  push() {
    if (!this.db) return;
    const now = Date.now();
    if (now - this._lastPush < 5000) return;
    this._lastPush = now;
    const st = this.app.sim.stats;
    const rec = {
      t: now,
      thr: st.throughput,
      temp: st.avgTemp,
      power: st.power,
      online: st.online,
      devices: st.devices,
      portsUp: st.portsUp,
    };
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(rec);
    } catch { /* ignore */ }
    this.samples.push(rec);
    if (this.samples.length > 4000) this.samples.shift();
    // occasional prune
    if (Math.random() < 0.01) this.prune();
  }

  prune() {
    if (!this.db) return;
    const cutoff = Date.now() - RETENTION_MS;
    try {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        if (cur.value.t < cutoff) cur.delete();
        cur.continue();
      };
    } catch { /* ignore */ }
  }

  /** Last N hours, bucketed to `bucketMs` for drawing. */
  series(hours = 24, bucketMs = 5 * 60 * 1000) {
    const since = Date.now() - hours * 3600 * 1000;
    const buckets = new Map();
    for (const s of this.samples) {
      if (s.t < since) continue;
      const k = Math.floor(s.t / bucketMs) * bucketMs;
      if (!buckets.has(k)) buckets.set(k, { t: k, thr: 0, temp: 0, power: 0, n: 0 });
      const b = buckets.get(k);
      b.thr += s.thr;
      b.temp += s.temp;
      b.power += s.power;
      b.n++;
    }
    return [...buckets.values()].sort((a, b) => a.t - b.t).map((b) => ({
      t: b.t, thr: b.thr / b.n, temp: b.temp / b.n, power: b.power / b.n,
    }));
  }

  capacity() {
    const racks = this.app.state.racks;
    const devices = Object.values(this.app.state.devices);
    const usedU = devices.reduce((n, d) => n + d.u, 0);
    const capU = racks.length * 42;
    const power = this.app.sim.stats.power;
    const capPower = racks.reduce((n, r) => n + (r.powerCap || 8), 0);
    const ports = devices.reduce((n, d) => n + d.ports.length, 0);
    const usedPorts = devices.reduce((n, d) => n + d.ports.filter((p) => p.cable).length, 0);

    // growth per day from stored samples (last 24h)
    const day = this.samples.filter((s) => Date.now() - s.t < 24 * 3600 * 1000);
    let powerGrowth = 0;
    let portGrowth = 0;
    if (day.length > 4) {
      const spanH = Math.max(0.25, (day[day.length - 1].t - day[0].t) / 3600000);
      powerGrowth = ((day[day.length - 1].power - day[0].power) / spanH) * 24;
      portGrowth = ((day[day.length - 1].portsUp - day[0].portsUp) / spanH) * 24;
    }
    const daysToPower = powerGrowth > 0.001 ? Math.max(0, (capPower - power) / powerGrowth) : null;
    const daysToU = portGrowth > 0.001 ? Math.max(0, (ports - usedPorts) / portGrowth) : null;

    return {
      u: { used: usedU, cap: capU, pct: capU ? usedU / capU : 0 },
      power: { used: power, cap: capPower, pct: capPower ? power / capPower : 0 },
      ports: { used: usedPorts, cap: ports, pct: ports ? usedPorts / ports : 0 },
      powerGrowth,
      portGrowth,
      daysToPower,
      daysToU,
      samples: this.samples.length,
    };
  }

  /** Printable HTML report (open in a new window → Ctrl+P / 另存为 PDF). */
  reportHtml() {
    const app = this.app;
    const st = app.sim.stats;
    const cap = this.capacity();
    const racks = app.state.racks;
    const devices = Object.values(app.state.devices);
    const alarms = app.sim.alarmsList;
    const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
    const rows = racks.map((r) => {
      const ds = (r.devices || []).map((id) => app.state.devices[id]).filter(Boolean);
      return `<tr><td>${r.name}</td><td>${ds.length}</td><td>${(r.power || 0).toFixed(2)}</td><td>${fmt(r.temp)}</td>
        <td>${ds.filter((d) => d.status === 'online').length}</td></tr>`;
    }).join('');
    const alarmRows = alarms.length
      ? alarms.slice(0, 20).map((a) => `<tr><td>${a.sev}</td><td>${a.title}</td><td>${a.desc}</td></tr>`).join('')
      : '<tr><td colspan="3">无活跃告警</td></tr>';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>NEXUS DC 机房运维报告</title>
<style>
 body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#1b2430;margin:30px;font-size:12px}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#667;margin-bottom:18px}
 h2{font-size:14px;margin:22px 0 8px;border-left:3px solid #1a7cff;padding-left:8px}
 table{width:100%;border-collapse:collapse;margin-top:6px}
 th,td{border:1px solid #d5dde6;padding:5px 7px;text-align:left}
 th{background:#eef3f8}
 .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px}
 .kpi{border:1px solid #d5dde6;border-radius:6px;padding:8px 10px}
 .kpi b{display:block;font-size:18px;color:#0b4a8f}
 .kpi span{color:#667;font-size:10px}
 .foot{margin-top:26px;color:#889;font-size:10px}
</style></head><body>
<h1>NEXUS DC · 机房运维报告</h1>
<div class="sub">生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })} · 3D/2D 数字孪生平台</div>
<div class="kpis">
 <div class="kpi"><b>${st.devices}</b><span>设备总数 / 在线 ${st.online}</span></div>
 <div class="kpi"><b>${fmt(st.throughput)} Gbps</b><span>网络吞吐</span></div>
 <div class="kpi"><b>${fmt(st.power, 2)} kW</b><span>总功耗 · 容量 ${fmt(cap.power.cap, 0)} kW</span></div>
 <div class="kpi"><b>${fmt(st.avgTemp)} ℃</b><span>平均温度 · 健康分 ${Math.round(st.health)}</span></div>
</div>
<h2>机柜</h2>
<table><tr><th>机柜</th><th>设备数</th><th>功率(kW)</th><th>温度(℃)</th><th>在线</th></tr>${rows || '<tr><td colspan="5">—</td></tr>'}</table>
<h2>容量</h2>
<table>
<tr><th>指标</th><th>已用</th><th>容量</th><th>占比</th><th>趋势</th></tr>
<tr><td>U 位</td><td>${cap.u.used}</td><td>${cap.u.cap}</td><td>${Math.round(cap.u.pct * 100)}%</td><td>—</td></tr>
<tr><td>功率</td><td>${fmt(cap.power.used, 2)} kW</td><td>${fmt(cap.power.cap, 0)} kW</td><td>${Math.round(cap.power.pct * 100)}%</td><td>${cap.daysToPower == null ? '稳定' : `约 ${Math.round(cap.daysToPower)} 天到上限`}</td></tr>
<tr><td>端口</td><td>${cap.ports.used}</td><td>${cap.ports.cap}</td><td>${Math.round(cap.ports.pct * 100)}%</td><td>${cap.daysToU == null ? '稳定' : `约 ${Math.round(cap.daysToU)} 天用尽`}</td></tr>
</table>
<h2>活跃告警（${alarms.length}）</h2>
<table><tr><th>级别</th><th>标题</th><th>描述</th></tr>${alarmRows}</table>
<h2>设备清单</h2>
<table><tr><th>设备</th><th>类型</th><th>机柜/U</th><th>状态</th><th>CPU</th><th>温度</th></tr>
${devices.slice(0, 120).map((d) => {
  const rack = app.state.racks.find((r) => r.id === d.rackId);
  return `<tr><td>${d.name}</td><td>${d.kind}</td><td>${rack ? rack.name : ''} U${d.slot}</td>
    <td>${d.status}</td><td>${Math.round(d.metrics.cpu)}%</td><td>${fmt(d.metrics.temp)} ℃</td></tr>`;
}).join('')}
</table>
<div class="foot">由 NEXUS DC 生成 · 数据为仿真/接入运行态快照 · ${devices.length} 台设备</div>
</body></html>`;
  }

  openReport() {
    const html = this.reportHtml();
    const w = window.open('', '_blank');
    if (!w) return this.app.toast?.('浏览器拦截了报告窗口，请允许弹窗', 'warn');
    w.document.write(html);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 350);
  }
}
