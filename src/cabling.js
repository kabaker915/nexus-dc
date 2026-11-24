import { hostName } from './netdevops/vendors.js';
import { CATALOG } from './catalog.js';

const TPL = `
<div class="cab-overlay" id="cab-overlay" hidden>
  <div class="cab-window">
    <header class="cab-head">
      <div><b>布线助手</b><small>按速率与端口类型推荐空闲端口，一键成对连接</small></div>
      <button class="cab-close" id="cab-close">✕</button>
    </header>
    <div class="cab-body">
      <div class="cab-pick">
        <label class="tpl-field">源设备<select id="cab-a"></select></label>
        <span class="cab-arrow">↔</span>
        <label class="tpl-field">目标设备<select id="cab-b"></select></label>
        <button class="tb-btn" id="cab-suggest">生成推荐</button>
        <span class="tb-meta" id="cab-info"></span>
      </div>
      <div class="cab-list" id="cab-list"></div>
      <div class="cab-quick">
        <button class="tb-btn" id="cab-auto">自动连接未上联服务器</button>
        <span class="tb-meta" id="cab-auto-info"></span>
      </div>
    </div>
  </div>
</div>
`;

export class Cabling {
  constructor(app) {
    this.app = app;
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('cab-overlay');
    this.el = {
      a: document.getElementById('cab-a'),
      b: document.getElementById('cab-b'),
      info: document.getElementById('cab-info'),
      list: document.getElementById('cab-list'),
      autoInfo: document.getElementById('cab-auto-info'),
    };
    this.pairs = [];
    this.bind();
  }

  open(aId, bId) {
    const devs = Object.values(this.app.state.devices).filter((d) => d.ports.some((p) => !p.cable && p.kind !== 'power'));
    if (devs.length < 2) return this.app.toast('至少需要两台有空闲端口的设备', 'warn');
    const opts = devs.map((d) => {
      const rack = this.app.state.racks.find((r) => r.id === d.rackId);
      const free = d.ports.filter((p) => !p.cable && p.kind !== 'power').length;
      return `<option value="${d.id}">${d.name} · ${rack?.name || ''} · 空闲 ${free}</option>`;
    }).join('');
    this.el.a.innerHTML = opts;
    this.el.b.innerHTML = opts;
    const sel = this.app.state.selection;
    const pick = sel?.type === 'device' && devs.some((d) => d.id === sel.id) ? sel.id : devs[0].id;
    this.el.a.value = aId || pick;
    this.el.b.value = bId || devs.find((d) => d.id !== this.el.a.value)?.id || devs[1]?.id;
    this.pairs = [];
    this.el.list.innerHTML = '';
    this.el.info.textContent = '';
    this.root.hidden = false;
    this.suggest();
  }

  close() {
    this.root.hidden = true;
  }

  free(dev) {
    return dev.ports.filter((p) => !p.cable && p.kind !== 'power');
  }

  isSwitch(dev) {
    return dev.kind === 'switch48' || dev.kind === 'switch24';
  }

  candidates(a, b) {
    const A = this.free(a);
    const B = this.free(b);
    const all = [];
    for (const p of A) {
      for (const q of B) {
        let score = 0;
        if (p.speed === q.speed) score += 5;
        else score += Math.min(p.speed, q.speed) >= 1 ? 1 : 0;
        if (p.kind === q.kind) score += 2;
        if (this.isSwitch(a) && this.isSwitch(b)) {
          if (p.kind === 'sfp' && q.kind === 'sfp') score += 3;
          if (Math.min(p.speed, q.speed) >= 10) score += 1;
        }
        all.push({ a, b, p, q, score, gbps: Math.min(p.speed || 1, q.speed || 1) });
      }
    }
    all.sort((x, y) => y.score - x.score || y.gbps - x.gbps);
    const usedA = new Set();
    const usedB = new Set();
    const out = [];
    for (const c of all) {
      if (usedA.has(c.p.id) || usedB.has(c.q.id)) continue;
      usedA.add(c.p.id);
      usedB.add(c.q.id);
      out.push(c);
      if (out.length >= 8) break;
    }
    return out;
  }

  suggest() {
    const a = this.app.state.devices[this.el.a.value];
    const b = this.app.state.devices[this.el.b.value];
    if (!a || !b) return;
    if (a.id === b.id) {
      this.el.list.innerHTML = '<div class="tb-empty">源与目标不能是同一台设备。</div>';
      return;
    }
    this.pairs = this.candidates(a, b);
    const freeA = this.free(a).length;
    const freeB = this.free(b).length;
    this.el.info.textContent = `${a.name} 空闲 ${freeA} · ${b.name} 空闲 ${freeB} · 推荐 ${this.pairs.length} 对`;
    if (!this.pairs.length) {
      this.el.list.innerHTML = '<div class="tb-empty">两端没有可用端口。</div>';
      return;
    }
    this.el.list.innerHTML = `
      <div class="cab-row head"><span></span><span>A 端</span><span>B 端</span><span>速率</span><span>匹配</span></div>
      ${this.pairs.map((c, i) => `
        <label class="cab-row">
          <input type="checkbox" data-i="${i}" ${i < 2 ? 'checked' : ''} />
          <span><b>${a.name}</b><em>${c.p.label} · ${c.p.speed}G</em></span>
          <span><b>${b.name}</b><em>${c.q.label} · ${c.q.speed}G</em></span>
          <span class="mono">${c.gbps}G</span>
          <span class="cab-score">${c.score >= 8 ? '极佳' : c.score >= 5 ? '匹配' : '可用'}</span>
        </label>`).join('')}
      <div class="cab-actions">
        <button class="tb-btn" id="cab-connect">连接选中的 <span id="cab-count">2</span> 对</button>
      </div>`;

    this.el.list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => this.updateCount());
    });
    this.updateCount();
    document.getElementById('cab-connect').addEventListener('click', () => this.connectSelected());
  }

  updateCount() {
    const n = this.el.list.querySelectorAll('input[type="checkbox"]:checked').length;
    const el = document.getElementById('cab-count');
    if (el) el.textContent = String(n);
  }

  connectSelected() {
    const picks = [...this.el.list.querySelectorAll('input[type="checkbox"]:checked')]
      .map((cb) => this.pairs[Number(cb.dataset.i)])
      .filter(Boolean)
      .map((c) => ({ a: c.a, pa: c.p, b: c.b, pb: c.q }));
    if (!picks.length) return this.app.toast('请至少勾选一对端口', 'warn');
    const n = this.app.connectPairs(picks);
    this.app.toast(`已布放 ${n} 条跳线`, 'ok');
    this.suggest();
  }

  autoServers() {
    const devices = Object.values(this.app.state.devices);
    const servers = devices.filter((d) => (d.kind === 'server1u' || d.kind === 'server2u') && d.ports.every((p) => !p.cable));
    if (!servers.length) {
      this.el.autoInfo.textContent = '没有未上联的服务器。';
      return;
    }
    const switches = devices.filter((d) => this.isSwitch(d));
    const picks = [];
    for (const s of servers) {
      const freeS = this.free(s);
      const port = freeS.find((p) => p.kind === 'rj45') || freeS.find((p) => p.kind === 'sfp') || freeS[0];
      if (!port) continue;
      let best = null;
      for (const sw of switches) {
        const free = this.free(sw);
        const cand = free.find((p) => p.speed === port.speed) || free.find((p) => p.kind === 'rj45') || free[0];
        if (!cand) continue;
        const score = (cand.speed === port.speed ? 4 : 0) + free.length;
        if (!best || score > best.score) best = { sw, port: cand, score };
      }
      if (best) picks.push({ a: s, pa: port, b: best.sw, pb: best.port });
    }
    if (!picks.length) {
      this.el.autoInfo.textContent = '交换机没有空闲端口。';
      return;
    }
    const n = this.app.connectPairs(picks);
    this.el.autoInfo.textContent = `已为 ${n} 台服务器自动上联。`;
    this.app.toast(`自动连接 ${n} 台服务器`, 'ok');
  }

  bind() {
    document.getElementById('cab-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    document.getElementById('cab-suggest').addEventListener('click', () => this.suggest());
    document.getElementById('cab-auto').addEventListener('click', () => this.autoServers());
    this.el.a.addEventListener('change', () => this.suggest());
    this.el.b.addEventListener('change', () => this.suggest());
  }
}
