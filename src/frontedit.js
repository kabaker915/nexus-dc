import { CATALOG, BUILD_LIST } from './catalog.js';
import { U_COUNT } from './util.js';

const ROW = 18;

const TPL = `
<div class="fe-overlay" id="fe-overlay" hidden>
  <div class="fe-window">
    <header class="fe-head">
      <div><b>机柜正面编辑</b><small>拖拽调整 U 位 · 点击空位上架 · 模板与复制</small></div>
      <label class="fe-rack-pick">机柜<select id="fe-rack-select"></select></label>
      <button class="fe-close" id="fe-close">✕</button>
    </header>
    <div class="fe-body">
      <div class="fe-rack-wrap">
        <div class="fe-scale" id="fe-scale"></div>
        <div class="fe-rack" id="fe-rack"></div>
      </div>
      <aside class="fe-side" id="fe-side"></aside>
    </div>
  </div>
</div>
`;

export class FrontEditor {
  constructor(app) {
    this.app = app;
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('fe-overlay');
    this.el = {
      select: document.getElementById('fe-rack-select'),
      scale: document.getElementById('fe-scale'),
      rack: document.getElementById('fe-rack'),
      side: document.getElementById('fe-side'),
    };
    this.rackId = null;
    this.devId = null;
    this.slotPick = null;
    this.drag = null;
    this.bind();
  }

  get rack() {
    return this.app.state.racks.find((r) => r.id === this.rackId);
  }

  get devices() {
    const rack = this.rack;
    return (rack?.devices || []).map((id) => this.app.state.devices[id]).filter(Boolean);
  }

  open(rackId) {
    const racks = this.app.state.racks;
    if (!racks.length) return this.app.toast('还没有机柜', 'warn');
    this.rackId = racks.some((r) => r.id === rackId) ? rackId : racks[0].id;
    this.el.select.innerHTML = racks.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
    this.el.select.value = this.rackId;
    this.root.hidden = false;
    this._scrollTo = true;
    this.render();
  }

  close() {
    this.root.hidden = true;
    this.drag = null;
  }

  render() {
    const rack = this.rack;
    if (!rack) return;
    this.el.select.value = rack.id;
    const h = U_COUNT * ROW;
    this.el.rack.style.height = `${h}px`;
    this.el.scale.style.height = `${h}px`;

    // U scale
    let scale = '';
    for (let u = U_COUNT; u >= 1; u--) {
      scale += `<div class="fe-u" style="top:${(U_COUNT - u) * ROW}px">${u % 2 === 0 ? u : ''}</div>`;
    }
    this.el.scale.innerHTML = scale;

    const devs = this.devices;
    const blocks = devs.map((d) => {
      const top = (U_COUNT - (d.slot + d.u - 1)) * ROW;
      const kind = CATALOG[d.kind];
      const sel = d.id === this.devId ? 'sel' : '';
      const down = d.status === 'offline' ? 'off' : '';
      return `<div class="fe-dev ${sel} ${down}" data-dev="${d.id}"
        style="top:${top}px;height:${d.u * ROW - 2}px;border-left-color:${kind.accent}">
        <span class="fe-dev-name">${escapeHtml(d.name)}</span>
        ${d.u > 1 ? `<span class="fe-dev-meta">${kind.short} · ${d.u}U · ${Math.round(d.metrics.temp)}℃</span>` : ''}
      </div>`;
    }).join('');

    const pick = this.slotPick
      ? `<div class="fe-pick" style="top:${(U_COUNT - this.slotPick) * ROW}px;height:${ROW}px">U${this.slotPick} 空位</div>`
      : '';

    this.el.rack.innerHTML = `${pick}${blocks}`;

    if (this._scrollTo) {
      const wrap = this.el.rack.parentElement;
      const maxU = devs.reduce((m, d) => Math.max(m, d.slot + d.u - 1), 8);
      wrap.scrollTop = Math.max(0, (U_COUNT - maxU) * ROW - 48);
      this._scrollTo = false;
    }

    this.renderSide(rack);
  }

  renderSide(rack) {
    const devs = this.devices;
    const used = devs.reduce((n, d) => n + d.u, 0);
    const d = devs.find((x) => x.id === this.devId);
    const free = U_COUNT - used;
    const palette = BUILD_LIST.filter((k) => CATALOG[k].kind === 'device').map((k) => {
      const s = CATALOG[k];
      return `<button class="fe-add" data-kind="${k}" ${s.u > free ? 'disabled' : ''}>
        <i>${s.icon}</i><span>${s.short}</span><em>${s.u}U</em></button>`;
    }).join('');

    this.el.side.innerHTML = `
      <div class="fe-sum">
        <div><label>机柜</label><b>${rack.name}</b></div>
        <div><label>U 位</label><b>${used}/42</b></div>
        <div><label>功率</label><b>${(rack.power || 0).toFixed(2)}kW</b></div>
        <div><label>温度</label><b>${(rack.temp || 22).toFixed(1)}℃</b></div>
      </div>

      <div class="fe-block">
        <h5>${this.slotPick ? `在 U${this.slotPick} 上架` : '选择空位或直接添加'}</h5>
        <div class="fe-palette">${palette}</div>
      </div>

      ${d ? `
      <div class="fe-block">
        <h5>${escapeHtml(d.name)} <em>${CATALOG[d.kind].label} · U${d.slot}</em></h5>
        <div class="fe-actions">
          <button class="tb-btn tiny" data-act="up" ${d.slot + d.u > U_COUNT ? 'disabled' : ''}>上移 1U</button>
          <button class="tb-btn tiny" data-act="down" ${d.slot <= 1 ? 'disabled' : ''}>下移 1U</button>
          <button class="tb-btn tiny ghost" data-act="power">${d.adminPower ? '断电' : '上电'}</button>
          <button class="tb-btn tiny ghost" data-act="remove">移除</button>
          <button class="tb-btn tiny ghost" data-act="focus">在 3D 定位</button>
        </div>
      </div>` : '<div class="fe-block fe-tip">点击机柜中的设备可编辑 U 位与电源状态。</div>'}

      <div class="fe-block">
        <h5>整柜操作</h5>
        <div class="fe-actions">
          <button class="tb-btn tiny" data-rack="template">另存为模板</button>
          <button class="tb-btn tiny ghost" data-rack="duplicate">复制机柜</button>
          <button class="tb-btn tiny ghost" data-rack="cool">应急制冷</button>
        </div>
      </div>`;
  }

  selectDevice(id) {
    this.devId = id;
    this.slotPick = null;
    this.render();
  }

  bind() {
    document.getElementById('fe-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    this.el.select.addEventListener('change', () => {
      this.rackId = this.el.select.value;
      this.devId = null;
      this.slotPick = null;
      this.render();
    });

    this.el.rack.addEventListener('pointerdown', (e) => {
      const block = e.target.closest('[data-dev]');
      if (block) {
        const dev = this.devices.find((d) => d.id === block.dataset.dev);
        if (!dev) return;
        this.drag = {
          dev, startY: e.clientY, moved: false,
          startSlot: dev.slot, el: block,
        };
        block.classList.add('dragging');
        block.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }
    });

    this.el.rack.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dy = e.clientY - this.drag.startY;
      if (Math.abs(dy) > 3) this.drag.moved = true;
      this.drag.el.style.transform = `translateY(${dy}px)`;
    });

    this.el.rack.addEventListener('pointerup', (e) => {
      if (!this.drag) return;
      const { dev, startSlot, el, moved, startY } = this.drag;
      this.drag = null;
      el.classList.remove('dragging');
      el.style.transform = '';
      if (!moved) return this.selectDevice(dev.id);
      const delta = Math.round((startY - e.clientY) / ROW);
      const slot = Math.max(1, Math.min(U_COUNT - dev.u + 1, startSlot + delta));
      if (slot === dev.slot) return;
      const ok = this.app.moveDeviceTo(dev, slot);
      if (!ok) this.app.toast(`U${slot} 放不下（空间不足）`, 'warn');
      this.render();
    });

    // empty slot click
    this.el.rack.addEventListener('click', (e) => {
      if (e.target.closest('[data-dev]')) return;
      const rect = this.el.rack.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const u = U_COUNT - Math.floor(y / ROW);
      this.slotPick = Math.max(1, Math.min(U_COUNT, u));
      this.devId = null;
      this.render();
    });

    this.el.side.addEventListener('click', (e) => {
      const add = e.target.closest('[data-kind]');
      if (add) {
        const kind = add.dataset.kind;
        let slot = this.slotPick;
        if (!slot || !this.app.slotFits(this.rack, slot, CATALOG[kind].u)) {
          slot = this.app.findFreeSlotIn(this.rack, CATALOG[kind].u);
        }
        if (!slot) return this.app.toast('机柜已满', 'warn');
        const dev = this.app.addDeviceAt(this.rack, kind, slot);
        if (dev) {
          this.slotPick = null;
          this.devId = dev.id;
          this.render();
        }
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      const d = this.devices.find((x) => x.id === this.devId);
      if (act && d) {
        if (act === 'up') this.app.moveDeviceTo(d, Math.min(U_COUNT - d.u + 1, d.slot + 1));
        else if (act === 'down') this.app.moveDeviceTo(d, Math.max(1, d.slot - 1));
        else if (act === 'power') this.app.deviceAction(d, d.adminPower ? 'powerOff' : 'powerOn');
        else if (act === 'remove') { this.app.removeDeviceById(d.id); this.devId = null; }
        else if (act === 'focus') { this.close(); this.app.focusTarget({ type: 'device', id: d.id }); this.app.select({ type: 'device', id: d.id }); }
        this.render();
        return;
      }
      const rackAct = e.target.closest('[data-rack]')?.dataset.rack;
      if (rackAct) {
        if (rackAct === 'template') {
          this.close();
          this.app.templates?.open(this.rack.id);
        } else if (rackAct === 'duplicate') {
          this.close();
          this.app.duplicateRack(this.rack);
        } else if (rackAct === 'cool') {
          this.app.coolRack(this.rack);
          this.render();
        }
      }
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
