import { CATALOG } from './catalog.js';

const KEY = 'nexusdc.templates.v1';

const TPL = `
<div class="tpl-overlay" id="tpl-overlay" hidden>
  <div class="tpl-window">
    <header class="tpl-head">
      <div><b>机柜模板与复制</b><small>保存 / 批量部署 / 整柜复制</small></div>
      <button class="tpl-close" id="tpl-close">✕</button>
    </header>
    <div class="tpl-body">
      <section class="tpl-top">
        <label class="tpl-field">名称<input id="tpl-name" placeholder="例如：Web 服务器标准柜" /></label>
        <label class="tpl-field">来源机柜<select id="tpl-source"></select></label>
        <button class="tb-btn" id="tpl-save">保存为模板</button>
        <button class="tb-btn ghost" id="tpl-dup">复制该机柜</button>
      </section>
      <section class="tpl-top">
        <label class="tpl-field">应用目标<select id="tpl-target"></select></label>
        <span class="tb-meta" id="tpl-count"></span>
      </section>
      <div class="tpl-list" id="tpl-list"></div>
    </div>
  </div>
</div>
`;

export class Templates {
  constructor(app) {
    this.app = app;
    this.list = this.load();
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('tpl-overlay');
    this.el = {
      name: document.getElementById('tpl-name'),
      source: document.getElementById('tpl-source'),
      target: document.getElementById('tpl-target'),
      list: document.getElementById('tpl-list'),
      count: document.getElementById('tpl-count'),
    };
    this.bind();
  }

  load() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.list)); } catch { /* quota */ }
  }

  open(rackId) {
    this.renderSelects(rackId);
    this.render();
    this.root.hidden = false;
  }

  close() {
    this.root.hidden = true;
  }

  renderSelects(rackId) {
    const racks = this.app.state.racks;
    const opts = racks.map((r) => `<option value="${r.id}">${r.name} · ${(r.devices || []).length} 台</option>`).join('');
    this.el.source.innerHTML = opts || '<option value="">暂无机柜</option>';
    this.el.target.innerHTML = `<option value="__new__">＋ 新建机柜（自动选位）</option>${opts}`;
    if (rackId) this.el.source.value = rackId;
    else if (this.app.state.selection?.type === 'rack') this.el.source.value = this.app.state.selection.id;
    if (this.app.state.selection?.type === 'rack') this.el.target.value = this.app.state.selection.id;
    this.el.count.textContent = `共 ${this.list.length} 个模板`;
  }

  render() {
    if (!this.list.length) {
      this.el.list.innerHTML = '<div class="tb-empty">还没有模板。选择机柜、命名后点「保存为模板」。</div>';
      return;
    }
    this.el.list.innerHTML = this.list.map((t) => {
      const used = t.devices.reduce((n, d) => n + (CATALOG[d.kind]?.u || 1), 0);
      const kinds = {};
      for (const d of t.devices) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
      const desc = Object.entries(kinds).map(([k, n]) => `${CATALOG[k]?.short || k}×${n}`).join(' · ');
      return `<div class="tpl-item" data-id="${t.id}">
        <div class="tpl-item-main">
          <b>${escapeHtml(t.name)}</b>
          <em>${t.devices.length} 台设备 · ${used}U · ${desc}</em>
        </div>
        <button class="tb-btn tiny" data-apply="${t.id}">应用到目标</button>
        <button class="tb-btn tiny ghost" data-del="${t.id}">删除</button>
      </div>`;
    }).join('');
  }

  bind() {
    document.getElementById('tpl-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });

    document.getElementById('tpl-save').addEventListener('click', () => this.saveFromRack());
    document.getElementById('tpl-dup').addEventListener('click', () => {
      const rack = this.app.state.racks.find((r) => r.id === this.el.source.value);
      if (rack) this.app.duplicateRack(rack);
    });

    this.el.list.addEventListener('click', (e) => {
      const apply = e.target.closest('[data-apply]');
      if (apply) return this.apply(apply.dataset.apply);
      const del = e.target.closest('[data-del]');
      if (del) {
        this.list = this.list.filter((t) => t.id !== del.dataset.del);
        this.persist();
        this.render();
      }
    });
  }

  saveFromRack() {
    const rack = this.app.state.racks.find((r) => r.id === this.el.source.value);
    if (!rack) return this.app.toast('请选择来源机柜', 'warn');
    const devices = (rack.devices || []).map((id) => this.app.state.devices[id]).filter(Boolean)
      .map((d) => ({ kind: d.kind, slot: d.slot, name: d.name }));
    if (!devices.length) return this.app.toast('该机柜还没有设备', 'warn');
    const name = this.el.name.value.trim() || `${rack.name} 模板`;
    this.list.unshift({ id: `tpl_${Date.now().toString(36)}`, name, devices, createdAt: Date.now() });
    this.persist();
    this.el.name.value = '';
    this.render();
    this.app.toast(`模板「${name}」已保存`, 'ok');
  }

  apply(id) {
    const tpl = this.list.find((t) => t.id === id);
    if (!tpl) return;
    let targetId = this.el.target.value;
    if (targetId === '__new__') {
      const rack = this.app.createRackNearSelection(tpl.name);
      if (!rack) return;
      targetId = rack.id;
    }
    const rack = this.app.state.racks.find((r) => r.id === targetId);
    if (!rack) return this.app.toast('目标机柜不存在', 'warn');
    const res = this.app.applyTemplate(tpl, rack);
    this.app.toast(`已应用到 ${rack.name}：新增 ${res.added} 台${res.skipped ? `，跳过 ${res.skipped} 台（U 位不足）` : ''}`, res.skipped ? 'warn' : 'ok');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
