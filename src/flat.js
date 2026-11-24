import { clamp } from './util.js';
import { CATALOG } from './catalog.js';
import { EXT_KINDS } from './extnet.js';

const KIND_COLOR = {
  switch48: '#35d6ff', switch24: '#35d6ff', router: '#8b7bff',
  server1u: '#3ddc97', server2u: '#3ddc97', storage4u: '#ffb020',
  firewall: '#ff4d63', patch24: '#7f93a8', pdu1u: '#ff8a3d',
};
const ROOM = { w: 13.2, d: 11.2 };
const SEV_COLOR = { critical: '#ff4d63', major: '#ff8a3d', minor: '#ffb020' };

/**
 * 2D operations surface: floor plan + logical topology.
 * Shares the exact same state / simulation / selection as the 3D scene, so
 * every action (select, drill, port toggle, repair…) works here too.
 */
export class FlatView {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.sim = app.sim;
    this.canvas = document.getElementById('flat');
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'plan';
    this.visible = false;
    this.hits = [];
    this.hover = null;
    this.panning = false;
    this.needFit = true;
    this.lastDraw = 0;
    this.lastLayoutKey = '';
    this.tf = {
      plan: { k: 60, tx: 0, ty: 0 },
      topo: { k: 1, tx: 0, ty: 0 },
    };
    this.topo = null;
    this.bind();
  }

  /* ------------------------------- wiring ------------------------------ */
  bind() {
    const c = this.canvas;
    this.down = null;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      if (this.mode === 'topo') {
        const hit = this.pick(e);
        if (hit?.type === 'ext') {
          const ext = (this.app.state.ext || []).find((x) => x.id === hit.id);
          if (ext) {
            const t = this.tf.topo;
            const rect = c.getBoundingClientRect();
            this.dragExt = {
              id: ext.id,
              ox: (e.clientX - rect.left - t.tx) / t.k - ext.x,
              oy: (e.clientY - rect.top - t.ty) / t.k - ext.y,
            };
            this.down = { moved: false, x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
            return;
          }
        }
      }
      this.down = { x: e.clientX, y: e.clientY, tx: this.tf[this.mode].tx, ty: this.tf[this.mode].ty, moved: false };
    });

    c.addEventListener('pointermove', (e) => {
      if (this.dragExt) {
        const t = this.tf.topo;
        const rect = c.getBoundingClientRect();
        const ext = (this.app.state.ext || []).find((x) => x.id === this.dragExt.id);
        if (ext) {
          ext.x = (e.clientX - rect.left - t.tx) / t.k - this.dragExt.ox;
          ext.y = (e.clientY - rect.top - t.ty) / t.k - this.dragExt.oy;
          if (this.down) this.down.moved = true;
          this.draw();
        }
        return;
      }
      if (this.down) {
        const dx = e.clientX - this.down.x;
        const dy = e.clientY - this.down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.down.moved = true;
        if (this.down.moved) {
          this.panning = true;
          this.tf[this.mode].tx = this.down.tx + dx;
          this.tf[this.mode].ty = this.down.ty + dy;
          this.canvas.style.cursor = 'grabbing';
          this.draw();
        }
        return;
      }
      this.updateHover(e);
    });

    c.addEventListener('pointerup', (e) => {
      if (this.dragExt) {
        const id = this.dragExt.id;
        const moved = this.down?.moved;
        this.dragExt = null;
        this.down = null;
        this.canvas.style.cursor = 'default';
        if (moved) this.app.persistLayout?.();
        else this.app.extUI?.openProfile(id);
        return;
      }
      const wasClick = this.down && !this.down.moved;
      this.down = null;
      this.panning = false;
      this.canvas.style.cursor = 'default';
      if (wasClick) this.click(e);
    });

    c.addEventListener('pointerleave', () => {
      this.hover = null;
      document.getElementById('tooltip').classList.add('hidden');
      this.draw();
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const t = this.tf[this.mode];
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const k2 = clamp(t.k * Math.exp(-e.deltaY * 0.0015), this.minK(), this.maxK());
      t.tx = px - ((px - t.tx) * k2) / t.k;
      t.ty = py - ((py - t.ty) * k2) / t.k;
      t.k = k2;
      this.draw();
    }, { passive: false });
  }

  minK() { return this.mode === 'plan' ? 18 : 0.25; }
  maxK() { return this.mode === 'plan' ? 260 : 2.4; }

  /* ------------------------------ lifecycle ---------------------------- */
  show() {
    this.visible = true;
    this.canvas.hidden = false;
    this.needFit = true;
    this.resize();
    this.draw();
  }

  hide() {
    this.visible = false;
    this.canvas.hidden = true;
    document.getElementById('tooltip').classList.add('hidden');
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.dpr = dpr;
    this.needFit = true;
    if (this.visible) this.draw();
  }

  setMode(mode) {
    this.mode = mode;
    this.needFit = true;
    this.hover = null;
    this.draw();
  }

  focus(target) {
    if (!target) return;
    const vp = this.viewport();
    const cx = (vp.x0 + vp.x1) / 2;
    const cy = (vp.y0 + vp.y1) / 2;
    if (this.mode === 'plan') {
      const t = this.tf.plan;
      if (target.type === 'rack') {
        const r = this.state.racks.find((x) => x.id === target.id);
        if (!r) return;
        t.k = Math.max(t.k, 110);
        t.tx = cx - r.x * t.k;
        t.ty = cy - r.z * t.k;
      } else if (target.type === 'device') {
        const d = this.state.devices[target.id];
        const r = this.state.racks.find((x) => x.id === d?.rackId);
        if (!r) return;
        t.k = Math.max(t.k, 120);
        t.tx = cx - r.x * t.k;
        t.ty = cy - r.z * t.k;
      }
    } else {
      this.buildTopo();
      const node = this.topo?.nodes.find((n) => n.d.id === target.id);
      if (!node) return;
      const t = this.tf.topo;
      t.k = Math.max(t.k, 1.35);
      t.tx = cx - node.x * t.k;
      t.ty = cy - node.y * t.k;
    }
    this.draw();
  }

  /* -------------------------------- loop ------------------------------- */
  frame(now) {
    if (!this.visible) return;
    if (now - this.lastDraw < 110) return;
    this.lastDraw = now;
    this.draw();
  }

  /* -------------------------------- draw ------------------------------- */
  draw() {
    if (!this.visible || !this.w) return;
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = '#060a0e';
    g.fillRect(0, 0, this.w, this.h);

    if (this.needFit) {
      this.fit();
      this.needFit = false;
    }
    this.hits = [];
    if (this.mode === 'plan') this.drawPlan(g);
    else this.drawTopo(g);
  }

  /** Free area between the side panels / bars. */
  viewport() {
    const narrow = window.innerWidth < 1024;
    const left = narrow ? 16 : 286;
    const right = window.innerWidth < 1240 ? 322 : 366;
    return { x0: left, x1: this.w - right, y0: 84, y1: this.h - 78, cx: 0, cy: 0, w: 0, h: 0 };
  }

  fit() {
    const t = this.tf[this.mode];
    const vp = this.viewport();
    vp.cx = (vp.x0 + vp.x1) / 2;
    vp.cy = (vp.y0 + vp.y1) / 2;
    const availW = Math.max(200, vp.x1 - vp.x0);
    const availH = Math.max(160, vp.y1 - vp.y0);

    if (this.mode === 'plan') {
      // frame the racks (with breathing room), fall back to the whole room
      let cx = 0;
      let cz = 0;
      let bw;
      let bd;
      if (this.state.racks.length) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const r of this.state.racks) {
          minX = Math.min(minX, r.x - 0.35);
          maxX = Math.max(maxX, r.x + 0.35);
          minZ = Math.min(minZ, r.z - 0.65);
          maxZ = Math.max(maxZ, r.z + 0.65);
        }
        bw = maxX - minX + 1.2;
        bd = maxZ - minZ + 1.2;
        cx = (minX + maxX) / 2;
        cz = (minZ + maxZ) / 2;
      } else {
        bw = ROOM.w + 2.2;
        bd = ROOM.d + 2.2;
      }
      t.k = Math.min(availW / bw, availH / bd);
      t.tx = vp.cx - cx * t.k;
      t.ty = vp.cy - cz * t.k;
    } else {
      this.buildTopo();
      const W = this.topo.width || 900;
      const H = this.topo.height || 600;
      t.k = Math.min(availW / (W + 70), availH / (H + 70), 1.4);
      t.tx = vp.cx - (W / 2) * t.k;
      t.ty = vp.cy - (H / 2) * t.k;
    }
  }

  /* ------------------------------ floor plan --------------------------- */
  drawPlan(g) {
    const t = this.tf.plan;
    const X = (x) => t.tx + x * t.k;
    const Y = (z) => t.ty + z * t.k;
    const s = (v) => v * t.k;

    // room
    const rx = X(-ROOM.w / 2);
    const ry = Y(-ROOM.d / 2);
    g.fillStyle = '#080d12';
    g.strokeStyle = '#1b2a36';
    g.lineWidth = 1.5;
    g.fillRect(rx, ry, s(ROOM.w), s(ROOM.d));
    g.strokeRect(rx, ry, s(ROOM.w), s(ROOM.d));

    // tiles
    if (t.k > 26) {
      g.strokeStyle = 'rgba(120,170,210,.055)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = -6.6; x <= 6.6 + 0.01; x += 0.6) {
        g.moveTo(X(x), ry);
        g.lineTo(X(x), ry + s(ROOM.d));
      }
      for (let z = -5.6; z <= 5.6 + 0.01; z += 0.6) {
        g.moveTo(rx, Y(z));
        g.lineTo(rx + s(ROOM.w), Y(z));
      }
      g.stroke();
    }

    // cold aisle
    g.fillStyle = 'rgba(53,214,255,.055)';
    g.fillRect(X(-2.3), Y(-0.95), s(4.6), s(1.9));
    g.strokeStyle = 'rgba(53,214,255,.25)';
    g.setLineDash([6, 6]);
    g.strokeRect(X(-2.3), Y(-0.95), s(4.6), s(1.9));
    g.setLineDash([]);
    if (t.k > 40) {
      g.fillStyle = 'rgba(53,214,255,.45)';
      g.font = '600 10px ui-monospace,monospace';
      g.textAlign = 'center';
      g.fillText('COLD AISLE', X(0), Y(0) + 3);
    }

    const alarmByDevice = new Set();
    const alarmByRack = new Set();
    for (const a of this.sim.alarmsList) {
      if (a.targetType === 'device') alarmByDevice.add(a.targetId);
      if (a.targetType === 'rack') alarmByRack.add(a.targetId);
    }
    const sel = this.state.selection;
    const now = performance.now();

    // static CRAC units (room equipment, not part of the asset state)
    if (t.k > 24) {
      const cracs = [
        [-5.6, -2.35, 'CRAC-01'], [-5.6, 2.35, 'CRAC-02'],
        [5.6, -2.35, 'CRAC-03'], [5.6, 2.35, 'CRAC-04'],
      ];
      for (const [cx, cz, name] of cracs) {
        const w = s(0.8);
        const h = s(0.95);
        g.fillStyle = '#0b1218';
        g.strokeStyle = '#1d2b36';
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect(X(cx) - w / 2, Y(cz) - h / 2, w, h, 2);
        g.fill();
        g.stroke();
        g.strokeStyle = 'rgba(120,170,200,.14)';
        for (let i = 1; i < 5; i++) {
          const yy = Y(cz) - h / 2 + (h * i) / 5;
          g.beginPath();
          g.moveTo(X(cx) - w / 2 + 3, yy);
          g.lineTo(X(cx) + w / 2 - 3, yy);
          g.stroke();
        }
        if (t.k > 60) {
          g.fillStyle = 'rgba(130,165,190,.6)';
          g.font = '500 9px ui-monospace,monospace';
          g.textAlign = 'center';
          g.fillText(name.replace('CRAC-', 'C'), X(cx), Y(cz) + h / 2 + 11);
        }
      }
    }

    for (const rack of this.state.racks) {
      const w = s(0.6);
      const h = s(1.2);
      const x = X(rack.x) - w / 2;
      const y = Y(rack.z) - h / 2;
      const devs = (rack.devices || []).map((id) => this.state.devices[id]).filter(Boolean);
      const hot = alarmByRack.has(rack.id) || devs.some((d) => alarmByDevice.has(d.id));
      const isSel = sel && ((sel.type === 'rack' && sel.id === rack.id) || (sel.type === 'device' && this.state.devices[sel.id]?.rackId === rack.id));

      g.save();
      if (hot) {
        g.shadowColor = 'rgba(255,77,99,.9)';
        g.shadowBlur = 16 + Math.sin(now / 260) * 6;
      }
      g.fillStyle = hot ? 'rgba(58,16,22,.92)' : '#0f1d26';
      g.strokeStyle = isSel ? '#35d6ff' : hot ? '#ff4d63' : '#2b4757';
      g.lineWidth = isSel ? 2 : 1;
      g.beginPath();
      g.roundRect(x, y, w, h, 3);
      g.fill();
      g.stroke();
      g.restore();

      // installed devices as coloured U blocks
      if (t.k > 100) {
        for (const d of devs) {
          const dy = y + 4 + ((42 - (d.slot + d.u - 1)) / 42) * (h - 8);
          const dh = Math.max(1.5, (d.u / 42) * (h - 8) - 1);
          g.globalAlpha = d.status === 'offline' ? 0.22 : 0.62;
          g.fillStyle = KIND_COLOR[d.kind] || '#7f93a8';
          g.fillRect(x + 5, dy, w - 12, dh);
          g.globalAlpha = 1;
        }
      }

      // front edge (towards the cold aisle)
      const frontZ = rack.rotY ? rack.z - 0.6 : rack.z + 0.6;
      g.strokeStyle = hot ? '#ff4d63' : '#3a6c86';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + 2, Y(frontZ));
      g.lineTo(x + w - 2, Y(frontZ));
      g.stroke();

      // U occupancy strip
      if (t.k > 55) {
        const barX = x + w - 5;
        const barH = h - 8;
        const slotH = barH / 42;
        const used = new Set();
        for (const d of devs) for (let i = 0; i < d.u; i++) used.add(d.slot + i);
        for (let u = 1; u <= 42; u++) {
          g.fillStyle = used.has(u) ? '#3ddc97' : 'rgba(255,255,255,.07)';
          g.fillRect(barX, y + 4 + (42 - u) * slotH, 3, Math.max(1, slotH - 0.5));
        }
      }

      const canLabel = t.k > 42;
      if (canLabel) {
        g.fillStyle = hot ? '#ffd7dc' : '#c6dcec';
        g.font = `600 ${Math.min(13, Math.max(9, t.k * 0.09))}px ui-monospace,monospace`;
        g.textAlign = 'left';
        g.fillText(rack.name, x + 4, y - 6);
        if (t.k > 165) {
          g.fillStyle = 'rgba(160,190,210,.65)';
          g.font = '500 9px ui-monospace,monospace';
          g.fillText(`${devs.length}台 ${(rack.power || 0).toFixed(1)}kW ${(rack.temp || 22).toFixed(0)}℃`, x + 2, y + h + 12);
        }
      }

      this.hits.push({ type: 'rack', id: rack.id, x, y, w, h });
    }

    // scale bar + footer
    const barMeters = t.k > 90 ? 1 : 2;
    const barLen = barMeters * t.k;
    const bx = 18;
    const by = this.h - 48;
    g.strokeStyle = 'rgba(140,175,200,.55)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + barLen, by);
    g.moveTo(bx, by - 3);
    g.lineTo(bx, by + 3);
    g.moveTo(bx + barLen, by - 3);
    g.lineTo(bx + barLen, by + 3);
    g.stroke();
    g.fillStyle = 'rgba(140,175,200,.55)';
    g.font = '500 9px ui-monospace,monospace';
    g.textAlign = 'left';
    g.fillText(`${barMeters} m`, bx, by - 6);

    g.fillStyle = 'rgba(140,170,195,.55)';
    g.font = '500 10px ui-monospace,monospace';
    g.textAlign = 'left';
    g.fillText(`${this.state.racks.length} RACKS · ${Object.keys(this.state.devices).length} DEVICES`, 18, this.h - 16);
    g.textAlign = 'right';
    g.fillText('平面图 · 点击机柜进入运维', this.w - 18, this.h - 16);
  }

  /* ------------------------------ topology ----------------------------- */
  buildTopo() {
    const racks = this.state.racks;
    const devices = Object.values(this.state.devices);
    const key = `${devices.length}|${Object.keys(this.state.cables).length}|${racks.length}|` +
      Object.values(this.state.cables).map((c) => c.id).join(',');
    if (key === this.lastLayoutKey && this.topo) return;
    this.lastLayoutKey = key;

    const rackName = (id) => racks.find((r) => r.id === id)?.name || '';
    const layerOf = (d) => {
      if (d.kind === 'router') return 0;
      if (d.kind === 'firewall') return 1;
      if (d.kind === 'switch48' || d.kind === 'switch24') {
        const n = rackName(d.rackId);
        return n === 'B01' || n === 'B02' ? 2 : 3;
      }
      return 4;
    };

    const titles = ['出口路由', '安全边界', '核心交换', '接入交换', '服务器 / 存储 / 其它'];
    const layers = [[], [], [], [], []];
    for (const d of devices) layers[layerOf(d)].push(d);
    for (const arr of layers) {
      arr.sort((a, b) => (rackName(a.rackId) + String(a.slot).padStart(3, '0')).localeCompare(rackName(b.rackId) + String(b.slot).padStart(3, '0')));
    }

    const nodeW = 138;
    const nodeH = 42;
    const gapX = 14;
    const gapY = 14;
    const maxRow = 10;
    const titleH = 22;
    const layerGap = 30;

    const layout = [];
    let maxW = 0;
    for (let li = 0; li < layers.length; li++) {
      const arr = layers[li];
      if (!arr.length) continue;
      const rows = [];
      for (let i = 0; i < arr.length; i += maxRow) {
        const chunk = arr.slice(i, i + maxRow);
        const w = chunk.length * nodeW + (chunk.length - 1) * gapX;
        rows.push({ chunk, w });
        maxW = Math.max(maxW, w);
      }
      layout.push({ title: titles[li], rows });
    }

    let y = 34;
    const nodes = [];
    for (const layer of layout) {
      const layerTop = y;
      y += titleH;
      for (const row of layer.rows) {
        const x0 = (maxW - row.w) / 2;
        row.chunk.forEach((d, i) => {
          nodes.push({ d, x: x0 + i * (nodeW + gapX) + nodeW / 2, y: y + nodeH / 2 });
        });
        y += nodeH + gapY;
      }
      y += layerGap;
      layer.top = layerTop;
      layer.bottom = y - layerGap;
    }

    const byId = new Map(nodes.map((n) => [n.d.id, n]));
    const links = [];
    for (const c of Object.values(this.state.cables)) {
      const a = byId.get(c.a.devId);
      const b = byId.get(c.b.devId);
      if (a && b) links.push({ cable: c, a, b });
    }

    // external / edge nodes live in the same coordinate space, positioned manually
    const exts = this.state.ext || [];
    let extBottom = 0;
    let extRight = maxW;
    for (let i = 0; i < exts.length; i++) {
      const e = exts[i];
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || (e.x === 0 && e.y === 0)) {
        e.x = maxW + 90;
        e.y = 46 + i * 74;
      }
      extBottom = Math.max(extBottom, e.y + 34);
      extRight = Math.max(extRight, e.x + 78);
    }

    this.topo = {
      nodes, links, layers: layout,
      width: Math.max(maxW, extRight),
      height: Math.max(y, extBottom + 20),
      nodeW, nodeH,
      exts,
    };
  }

  drawTopo(g) {
    this.buildTopo();
    const t = this.tf.topo;
    const X = (x) => t.tx + x * t.k;
    const Y = (y) => t.ty + y * t.k;
    const sc = t.k;
    const nw = this.topo.nodeW;
    const nh = this.topo.nodeH;
    const sel = this.state.selection;

    const alarmDevices = new Set();
    for (const a of this.sim.alarmsList) if (a.targetType === 'device') alarmDevices.add(a.targetId);

    // layer bands
    for (const layer of this.topo.layers) {
      g.fillStyle = 'rgba(255,255,255,.014)';
      g.fillRect(X(0) - 30, Y(layer.top) - 8, this.topo.width * sc + 60, (layer.bottom - layer.top) * sc + 16);
      g.fillStyle = 'rgba(140,170,195,.5)';
      g.font = '600 10px ui-monospace,monospace';
      g.textAlign = 'left';
      g.fillText(layer.title, X(0) - 22, Y(layer.top) + 4);
    }

    // links
    const hoverLink = this.hover?.type === 'link' ? this.hover.id : null;
    const selCable = sel?.type === 'cable' ? sel.id : null;
    for (const link of this.topo.links) {
      const { a, b, cable } = link;
      const ax = X(a.x);
      const ay = Y(a.y) + (nh * sc) / 2;
      const bx = X(b.x);
      const by = Y(b.y) - (nh * sc) / 2;
      const down = by > ay;
      const sy = down ? ay : Y(a.y) - (nh * sc) / 2;
      const ey = down ? by : Y(b.y) + (nh * sc) / 2;
      const dy = Math.abs(ey - sy) * 0.45 + 18;
      const c1 = { x: ax, y: sy + (down ? dy : -dy) };
      const c2 = { x: bx, y: ey - (down ? dy : -dy) };

      const active = cable.id === hoverLink || cable.id === selCable;
      g.strokeStyle = active ? '#7fe7ff' : cable.speed >= 25 ? 'rgba(255,176,32,.28)'
        : cable.speed >= 10 ? 'rgba(77,124,255,.26)' : 'rgba(47,200,240,.2)';
      g.lineWidth = active ? 2.2 : 1;
      g.beginPath();
      g.moveTo(ax, sy);
      g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, bx, ey);
      g.stroke();

      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const x = (1 - u) ** 3 * ax + 3 * (1 - u) ** 2 * u * c1.x + 3 * (1 - u) * u ** 2 * c2.x + u ** 3 * bx;
        const y = (1 - u) ** 3 * sy + 3 * (1 - u) ** 2 * u * c1.y + 3 * (1 - u) * u ** 2 * c2.y + u ** 3 * ey;
        pts.push({ x, y });
      }
      this.hits.push({ type: 'link', id: cable.id, pts });
    }

    // external uplinks (dashed)
    const extById = new Map((this.topo.exts || []).map((e) => [e.id, e]));
    const nodeById = new Map(this.topo.nodes.map((n) => [n.d.id, n]));
    for (const e of this.topo.exts || []) {
      if (!e.uplink) continue;
      const targetNode = nodeById.get(e.uplink);
      const targetExt = extById.get(e.uplink);
      if (!targetNode && !targetExt) continue;
      const tx = targetNode ? targetNode.x : targetExt.x;
      const ty = targetNode ? targetNode.y : targetExt.y;
      const ax = X(e.x);
      const ay = Y(e.y);
      const bx = X(tx);
      const by = Y(ty);
      g.save();
      g.setLineDash([5, 5]);
      g.strokeStyle = e.status === 'error' ? 'rgba(255,77,99,.6)' : 'rgba(255,176,32,.5)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 - 26, bx, by);
      g.stroke();
      g.restore();
      g.fillStyle = 'rgba(255,176,32,.9)';
      g.beginPath();
      g.arc(bx, by, 2.4, 0, Math.PI * 2);
      g.fill();
    }

    // nodes
    for (const n of this.topo.nodes) {
      const d = n.d;
      const w = nw * sc;
      const h = nh * sc;
      const x = X(n.x) - w / 2;
      const y = Y(n.y) - h / 2;
      const alarm = alarmDevices.has(d.id);
      const isSel = sel?.type === 'device' && sel.id === d.id;
      const isHover = this.hover?.type === 'node' && this.hover.id === d.id;
      const color = KIND_COLOR[d.kind] || '#7f93a8';

      g.save();
      if (alarm) {
        g.shadowColor = 'rgba(255,77,99,.8)';
        g.shadowBlur = 14;
      } else if (isSel) {
        g.shadowColor = 'rgba(53,214,255,.8)';
        g.shadowBlur = 12;
      }
      g.fillStyle = d.status === 'offline' ? '#160d10' : isHover ? '#11202a' : '#0c141b';
      g.strokeStyle = alarm ? '#ff4d63' : isSel ? '#35d6ff' : isHover ? '#3f7f9c' : '#22404f';
      g.lineWidth = isSel || alarm ? 1.8 : 1;
      g.beginPath();
      g.roundRect(x, y, w, h, 5);
      g.fill();
      g.stroke();
      g.restore();

      // accent bar
      g.fillStyle = color;
      g.globalAlpha = d.status === 'offline' ? 0.3 : 0.9;
      g.beginPath();
      g.roundRect(x + 1, y + 6, 3, h - 12, 1.5);
      g.fill();
      g.globalAlpha = 1;

      if (sc > 0.55) {
        g.fillStyle = d.status === 'offline' ? '#8b6b72' : '#d7e8f4';
        g.font = `600 ${Math.max(9, 11 * sc)}px ui-monospace,monospace`;
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        const name = d.name.length > 14 ? d.name.slice(0, 13) + '…' : d.name;
        g.fillText(name, x + 10, y + h * 0.42);
        const up = d.ports.filter((p) => p.state === 'up').length;
        g.fillStyle = 'rgba(150,180,205,.7)';
        g.font = `500 ${Math.max(8, 9.5 * sc)}px ui-monospace,monospace`;
        g.fillText(`${up}/${d.ports.length} · ${Math.round(d.metrics.temp)}℃ · ${Math.round(d.metrics.cpu)}%`, x + 10, y + h * 0.78);
      }

      // status dot
      g.fillStyle = d.status === 'offline' ? '#ff4d63' : d.status === 'rebooting' ? '#ffb020' : alarm ? '#ff8a3d' : '#3ddc97';
      g.beginPath();
      g.arc(x + w - 9, y + 9, 2.6, 0, Math.PI * 2);
      g.fill();

      this.hits.push({ type: 'node', id: d.id, x, y, w, h });
    }

    // external / edge nodes (draggable, click for profile & command dispatch)
    for (const e of this.topo.exts || []) {
      const meta = EXT_KINDS[e.kind] || EXT_KINDS.router;
      const w = 140 * sc;
      const h = 44 * sc;
      const x = X(e.x) - w / 2;
      const y = Y(e.y) - h / 2;
      const isHover = this.hover?.type === 'ext' && this.hover.id === e.id;
      g.save();
      g.fillStyle = isHover ? '#1a1508' : '#0c1013';
      g.strokeStyle = isHover ? '#ffd27a' : meta.color;
      g.lineWidth = isHover ? 1.9 : 1.2;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.roundRect(x, y, w, h, 7);
      g.fill();
      g.stroke();
      g.restore();

      g.fillStyle = meta.color;
      g.font = `600 ${Math.max(10, 12 * sc)}px ui-monospace,monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(meta.icon, x + 15 * sc, y + h / 2);

      if (sc > 0.5) {
        g.textAlign = 'left';
        g.textBaseline = 'alphabetic';
        g.fillStyle = '#e6f1fa';
        g.font = `600 ${Math.max(9, 10.5 * sc)}px ui-monospace,monospace`;
        g.fillText(e.name.length > 16 ? `${e.name.slice(0, 15)}…` : e.name, x + 28 * sc, y + h * 0.42);
        g.fillStyle = 'rgba(170,195,215,.75)';
        g.font = `500 ${Math.max(8, 8.8 * sc)}px ui-monospace,monospace`;
        g.fillText(e.host ? `${e.host}:${e.port}` : '未配置地址', x + 28 * sc, y + h * 0.78);
      }

      const dot = e.status === 'online' ? '#3ddc97' : e.status === 'error' ? '#ff4d63' : e.status === 'sim' ? '#35d6ff' : '#7f93a8';
      g.fillStyle = dot;
      g.beginPath();
      g.arc(x + w - 8, y + 8, 2.4, 0, Math.PI * 2);
      g.fill();

      this.hits.push({ type: 'ext', id: e.id, x, y, w, h });
    }

    // footer
    g.fillStyle = 'rgba(140,170,195,.55)';
    g.font = '500 10px ui-monospace,monospace';
    g.textAlign = 'left';
    g.fillText(`拓扑 · ${this.topo.nodes.length} 机房节点 / ${this.topo.links.length} 链路 · ${(this.topo.exts || []).length} 外部设备`, 18, this.h - 16);
    g.textAlign = 'right';
    g.fillText('拖动外部设备调整位置 · 点击配置与下发命令', this.w - 18, this.h - 16);
  }

  /* ------------------------------- picking ----------------------------- */
  pick(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.type === 'link') {
        for (const p of h.pts) {
          if (Math.hypot(p.x - x, p.y - y) < 6) return h;
        }
      } else if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        return h;
      }
    }
    return null;
  }

  updateHover(e) {
    const hit = this.pick(e);
    const prev = this.hover;
    this.hover = hit ? { type: hit.type, id: hit.id } : null;
    this.canvas.style.cursor = hit ? (hit.type === 'ext' ? 'move' : 'pointer') : 'default';
    if (hit) this.showTooltip(e, hit);
    else document.getElementById('tooltip').classList.add('hidden');
    if (JSON.stringify(prev) !== JSON.stringify(this.hover)) this.draw();
  }

  showTooltip(e, hit) {
    const tip = document.getElementById('tooltip');
    let text = '';
    if (hit.type === 'node') {
      const d = this.state.devices[hit.id];
      if (!d) return;
      const rack = this.state.racks.find((r) => r.id === d.rackId);
      text = `${d.name} · ${CATALOG[d.kind].label}\n${rack ? rack.name : ''} U${d.slot} · ${d.status}\nCPU ${Math.round(d.metrics.cpu)}% · ${Math.round(d.metrics.power)}W · ${d.metrics.temp.toFixed(1)}℃`;
    } else if (hit.type === 'link') {
      const c = this.state.cables[hit.id];
      if (!c) return;
      const a = this.state.devices[c.a.devId];
      const b = this.state.devices[c.b.devId];
      text = `${c.speed}G 链路\n${a?.name || '?'}:${c.a.label}\n↔ ${b?.name || '?'}:${c.b.label}`;
    } else if (hit.type === 'rack') {
      const r = this.state.racks.find((x) => x.id === hit.id);
      if (!r) return;
      text = `${r.name} · 42U\n${(r.devices || []).length} 台设备 · ${(r.power || 0).toFixed(2)}kW · ${(r.temp || 22).toFixed(1)}℃`;
    } else if (hit.type === 'ext') {
      const ext = (this.state.ext || []).find((x) => x.id === hit.id);
      if (!ext) return;
      const st = ext.status === 'online' ? '连通' : ext.status === 'error' ? '故障' : ext.status === 'sim' ? '模拟' : '未探测';
      text = `${ext.name} · ${EXT_KINDS[ext.kind]?.label || ''}\n${ext.host || '未配置地址'}${ext.host ? ':' + ext.port : ''} · ${ext.protocol.toUpperCase()} · ${st}\n点击配置 / 下发命令 · 拖动调整位置`;
    }
    if (!text) return;
    tip.textContent = text;
    tip.classList.remove('hidden');
    tip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 280)}px`;
    tip.style.top = `${Math.min(e.clientY + 16, window.innerHeight - 90)}px`;
  }

  click(e) {
    const hit = this.pick(e);
    const add = !!e.shiftKey;
    if (!hit) return this.app.select(null);
    if (hit.type === 'node') this.app.select({ type: 'device', id: hit.id }, { add });
    else if (hit.type === 'link') this.app.select({ type: 'cable', id: hit.id });
    else if (hit.type === 'rack') this.app.select({ type: 'rack', id: hit.id }, { add });
    else if (hit.type === 'ext') this.app.extUI?.openProfile(hit.id);
  }
}
