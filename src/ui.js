import { CATALOG, BUILD_LIST } from './catalog.js';
import { SEV_LABEL } from './sim.js';
import { vendor } from './netdevops/vendors.js';
import { fmt, clockStr, clamp } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const STATUS_TXT = { online: '在线', offline: '离线', rebooting: '重启中' };
const MODE_HINT = {
  inspect: '左键选择 · 拖动旋转 · 滚轮缩放 · E 布线 · X 删除',
  cable: '点击两个端口完成布线 · Esc 取消',
  delete: '点击设备 / 跳线 / 机柜进行拆除 · Esc 取消',
  place: '点击地面或机柜放置 · Esc 取消',
};

export class UI {
  constructor(app) {
    this.app = app;
    this.state = app.state;
    this.sim = app.sim;
    this.tab = 'dash';
    this.selection = null;
    this.lastPort = null;
    this.el = {
      tsDev: $('#ts-dev'), tsPort: $('#ts-port'), tsThr: $('#ts-thr'),
      tsAlarm: $('#ts-alarm'), tsTemp: $('#ts-temp'), tsAlarmBox: $('#ts-alarm-box'),
      catalog: $('#catalog'), rackList: $('#rack-list'), rackCount: $('#rack-count'),
      summary: $('#asset-summary'),
      tabButtons: $$('#panel-tabs [data-tab]'), tabBack: $('#tab-back'), badge: $('#alarm-badge'),
      viewDash: $('#view-dash'), viewAlarms: $('#view-alarms'), viewEvents: $('#view-events'),
      viewOrders: $('#view-orders'), viewIns: $('#view-inspector'),
      orderBadge: $('#order-badge'), orderList: $('#order-list'), orderSum: $('#order-sum'),
      chartDay: $('#chart-day'), cDay: $('#c-day'), capacity: $('#capacity'),
      kOnline: $('#k-online'), kOnlineS: $('#k-online-s'), kAlarm: $('#k-alarm'), kAlarmS: $('#k-alarm-s'),
      kPower: $('#k-power'), kTemp: $('#k-temp'), kPorts: $('#k-ports'), kHealth: $('#k-health'),
      chartThr: $('#chart-thr'), chartTemp: $('#chart-temp'),
      cThr: $('#c-thr'), cTemp: $('#c-temp'), cPower: $('#c-power'), cPorts: $('#c-ports'),
      rackBars: $('#rack-bars'), pbUp: $('#pb-up'), pbErr: $('#pb-err'), pbDown: $('#pb-down'),
      alarmList: $('#alarm-list'), alarmSummary: $('#alarm-summary'), eventList: $('#event-list'),
      insTitle: $('#ins-title'), insSub: $('#ins-sub'), insBadge: $('#ins-badge'),
      insActions: $('#ins-actions'), insBody: $('#ins-body'),
      modeHint: $('#mode-hint'), modeButtons: $$('#toolbar [data-mode]'),
      autoheal: $('#autoheal'),
    };

    this.renderCatalog();
    this.bind();
    this.switchTab('dash');
  }

  /* ------------------------------ setup ------------------------------ */
  renderCatalog() {
    this.el.catalog.innerHTML = BUILD_LIST.map((kind) => {
      const s = CATALOG[kind];
      const sub = kind === 'rack' ? '42U' : `${s.u}U · ${s.power}W`;
      return `<button class="cat-item" data-kind="${kind}">
        <span class="ic">${s.icon}</span>
        <span class="nm">${s.label}</span>
        <span class="u">${sub}</span>
      </button>`;
    }).join('');
  }

  bind() {
    const app = this.app;

    this.el.catalog.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-kind]');
      if (!btn) return;
      app.placeKind(btn.dataset.kind);
    });

    this.el.modeButtons.forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      if (m === 'inspect') app.exitMode();
      else app.setMode(m);
    }));

    $('#cams').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cam]');
      if (!b) return;
      $$('#cams [data-cam]').forEach((x) => x.classList.toggle('on', x === b));
      app.cameraPreset(b.dataset.cam);
    });

    $('#btn-save').addEventListener('click', () => app.save());
    $('#btn-export').addEventListener('click', () => app.export());
    $('#btn-reset').addEventListener('click', () => app.reset());

    this.el.tabButtons.forEach((b) => b.addEventListener('click', () => this.switchTab(b.dataset.tab)));
    this.el.tabBack.addEventListener('click', () => this.switchTab('dash'));

    $('#btn-ack-all').addEventListener('click', () => app.ackAll());
    $('#drill')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-drill]');
      if (!b) return;
      const sel = this.state.selection;
      if (!sel || sel.type !== 'device') {
        app.toast('请先在三维场景中选中一台设备', 'warn');
        return;
      }
      app.inject(this.state.devices[sel.id], b.dataset.drill);
    });

    this.el.autoheal.addEventListener('change', (e) => app.setAutoHeal(e.target.checked));

    document.getElementById('btn-playbook')?.addEventListener('click', () => app.openPlaybook());
    document.getElementById('btn-order-new')?.addEventListener('click', () => {
      const title = window.prompt('工单标题', '机房巡检 / 故障处理');
      if (title) app.createWorkOrder({ title, level: 'P2', source: 'manual' });
    });

    this.el.rackList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-rack]');
      if (!row) return;
      app.select({ type: 'rack', id: row.dataset.rack });
      app.cameraPreset('rack');
    });

    this.el.alarmList.addEventListener('click', (e) => {
      const ack = e.target.closest('[data-ack]');
      const fix = e.target.closest('[data-fix]');
      const go = e.target.closest('[data-go]');
      const order = e.target.closest('[data-order-alarm]');
      if (order) {
        const a = this.sim.alarms.get(order.dataset.orderAlarm);
        if (a) {
          this.app.createWorkOrder({
            title: a.title,
            deviceId: a.targetType === 'device' ? a.targetId : null,
            level: a.sev === 'critical' ? 'P1' : a.sev === 'major' ? 'P2' : 'P3',
            source: 'alarm',
            note: a.desc,
          });
          this.switchTab('orders');
        }
        return;
      }
      if (ack) app.ackAlarm(ack.dataset.ack);
      if (fix) {
        const a = this.sim.alarms.get(fix.dataset.fix);
        if (a?.fix) { a.fix(); this.sim.tick(); this.refresh(); }
      }
      if (go) {
        const target = { type: go.dataset.goType, id: go.dataset.go };
        app.select(target);
        app.focusTarget(target);
        this.switchTab('dash');
      }
    });

    this.el.insActions.addEventListener('click', (e) => {
      const batch = e.target.closest('[data-batch]');
      if (batch) {
        this.app.batch(batch.dataset.batch);
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      this.action(b.dataset.act);
    });

    this.el.insBody.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-port]');
      if (cell) {
        const d = this.state.devices[this.selection?.id];
        const p = d?.ports.find((x) => x.id === cell.dataset.port);
        if (d && p) this.app.togglePort(d, p);
        return;
      }
      const bdev = e.target.closest('[data-batch-dev]');
      if (bdev) {
        this.app.select({ type: 'device', id: bdev.dataset.batchDev });
        return;
      }
      const brack = e.target.closest('[data-batch-rack]');
      if (brack) {
        this.app.select({ type: 'rack', id: brack.dataset.batchRack });
        return;
      }
      const dev = e.target.closest('[data-dev]');
      if (dev) {
        this.app.select({ type: 'device', id: dev.dataset.dev });
        return;
      }
      const rack = e.target.closest('[data-rack]');
      if (rack) this.app.select({ type: 'rack', id: rack.dataset.rack });
    });
  }

  /* ------------------------------ helpers ---------------------------- */
  toast(text, type = '') {
    this.app.toast(text, type);
  }

  setMode(mode, kind) {
    this.el.modeButtons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $$('#catalog [data-kind]').forEach((b) => b.classList.toggle('on', mode === 'place' && b.dataset.kind === kind));
    this.el.modeHint.textContent = mode === 'place'
      ? (kind === 'rack' ? '点击地面放置机柜 · Esc 取消' : `点击机柜安装 ${CATALOG[kind].label} · Esc 取消`)
      : MODE_HINT[mode] || MODE_HINT.inspect;
  }

  switchTab(tab) {
    this.tab = tab;
    this.el.tabButtons.forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.el.tabBack.hidden = true;
    this.el.viewDash.hidden = tab !== 'dash';
    this.el.viewAlarms.hidden = tab !== 'alarms';
    this.el.viewEvents.hidden = tab !== 'events';
    this.el.viewOrders.hidden = tab !== 'orders';
    this.el.viewIns.hidden = true;
    this.selection = null;
    if (tab === 'alarms') this.renderAlarms();
    if (tab === 'events') this.renderEvents();
    if (tab === 'orders') this.renderOrders();
  }

  showSelection(target, set = []) {
    this.selection = target ? { ...target } : null;
    this.selectionSet = set || [];
    if (!target) {
      if (!this.el.viewIns.hidden) this.switchTab('dash');
      return;
    }
    this.el.viewDash.hidden = true;
    this.el.viewAlarms.hidden = true;
    this.el.viewEvents.hidden = true;
    this.el.viewIns.hidden = false;
    this.el.tabButtons.forEach((b) => b.classList.remove('on'));
    this.el.tabBack.hidden = false;
    if (this.selectionSet.length > 1) this.renderBatchInspector(this.selectionSet);
    else this.renderInspector();
  }

  renderBatchInspector(set) {
    const devs = set.filter((t) => t.type === 'device').map((t) => this.state.devices[t.id]).filter(Boolean);
    const racks = set.filter((t) => t.type === 'rack').map((t) => this.state.racks.find((r) => r.id === t.id)).filter(Boolean);
    this.el.insTitle.textContent = `已选择 ${set.length} 项`;
    this.el.insSub.textContent = `${devs.length} 台设备 · ${racks.length} 个机柜 · Shift+点击增减选择`;
    this.el.insBadge.textContent = '批量';
    this.el.insBadge.className = 'pill warn';
    this.el.insActions.innerHTML = `
      <button data-batch="powerOff">批量断电</button>
      <button data-batch="powerOn">批量上电</button>
      <button data-batch="reboot">批量重启</button>
      <button data-batch="repair">批量修复</button>
      <button data-batch="door">开 / 关门</button>
      <button data-batch="cool">应急制冷</button>
      <button data-batch="delete" class="danger">删除选中</button>`;

    const rows = [
      ...devs.map((d) => {
        const rack = this.state.racks.find((r) => r.id === d.rackId);
        return `<div class="batch-row" data-batch-dev="${d.id}">
          <span class="dot ${d.status === 'offline' ? 'bad' : d.flags.fanFail ? 'warn' : ''}"></span>
          <b>${d.name}</b><em>${rack ? rack.name : ''} U${d.slot}</em>
          <span>${Math.round(d.metrics.cpu)}% · ${Math.round(d.metrics.temp)}℃</span></div>`;
      }),
      ...racks.map((r) => `<div class="batch-row" data-batch-rack="${r.id}">
          <span class="dot"></span><b>${r.name}</b><em>机柜 · ${(r.devices || []).length} 台</em>
          <span>${(r.power || 0).toFixed(1)}kW · ${(r.temp || 22).toFixed(0)}℃</span></div>`),
    ];
    this.el.insBody.innerHTML = rows.length
      ? `<div class="ins-section"><h5>选中对象 <em>${set.length} 项</em></h5><div class="batch-list">${rows.slice(0, 30).join('')}${rows.length > 30 ? `<div class="empty">还有 ${rows.length - 30} 项…</div>` : ''}</div></div>`
      : '<div class="empty">没有有效对象</div>';
  }

  focusPort(port) {
    this.lastPort = port.id;
    const cell = this.el.insBody.querySelector(`[data-port="${CSS.escape(port.id)}"]`);
    if (cell) {
      cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      cell.classList.add('flash');
      setTimeout(() => cell.classList.remove('flash'), 900);
    }
  }

  action(act) {
    const app = this.app;
    const sel = this.selection;
    if (act.startsWith('batch:')) return app.batch(act.slice(6));
    if (!sel) return;
    if (act === 'terminal') return app.openToolbox(sel.id, 'term');
    if (act === 'gencfg') return app.openToolbox(sel.id, 'config');
    if (act === 'diag') return app.openToolbox(sel.id, 'diag');
    if (act === 'front') {
      if (sel.type === 'device') {
        const d = this.state.devices[sel.id];
        return app.openFront(d?.rackId);
      }
      return app.openFront(sel.id);
    }
    if (act === 'templates') return app.openTemplates(sel.type === 'rack' ? sel.id : undefined);
    if (act === 'cabling') return app.openCabling();
    if (act === 'order') {
      const d = this.state.devices[sel.id];
      if (d) app.createWorkOrder({ title: `${d.name} 报修`, deviceId: d.id, level: 'P2', source: 'device' });
      return;
    }
    if (act === 'focus') return app.focusTarget(sel);
    if (act === 'remove') return app.removeSelection();
    if (sel.type === 'device') {
      const d = this.state.devices[sel.id];
      if (!d) return;
      if (act === 'reboot') app.deviceAction(d, 'reboot');
      if (act === 'power') app.deviceAction(d, d.adminPower ? 'powerOff' : 'powerOn');
      if (act === 'repair') app.deviceAction(d, 'repair');
      if (act === 'isolate') app.deviceAction(d, 'isolate');
    } else if (sel.type === 'rack') {
      const r = this.state.racks.find((x) => x.id === sel.id);
      if (!r) return;
      if (act === 'door') app.toggleDoor(r);
      if (act === 'cool') app.coolRack(r);
    } else if (sel.type === 'cable') {
      if (act === 'remove') app.removeSelection();
    }
  }

  /* ------------------------------- refresh --------------------------- */
  refresh() {
    const st = this.sim.stats;
    const racks = this.state.racks;
    const devs = Object.values(this.state.devices);
    const ports = devs.reduce((n, d) => n + d.ports.length, 0);
    const up = devs.reduce((n, d) => n + d.ports.filter((p) => p.state === 'up').length, 0);

    this.el.tsDev.textContent = `${devs.length}`;
    this.el.tsPort.textContent = `${up}/${ports}`;
    this.el.tsThr.textContent = fmt(st.throughput, 1);
    this.el.tsAlarm.textContent = `${st.alarms}`;
    this.el.tsAlarmBox.classList.toggle('hot', st.alarms > 0);
    this.el.tsTemp.textContent = fmt(st.avgTemp, 1);
    this.el.badge.textContent = `${st.critical + st.major + st.minor}`;

    this.el.rackCount.textContent = `${racks.length} 台`;
    this.renderRackList();
    this.renderSummary(racks, devs, up, ports);
    this.renderDashboard(st, racks, devs);

    if (this.tab === 'alarms') this.renderAlarms();
    if (this.tab === 'events') this.renderEvents();
    if (this.tab === 'orders') this.renderOrders();
    if (this.el.orderBadge) this.el.orderBadge.textContent = `${this.app.workorders?.openCount || 0}`;
    this.renderCapacity();
    this.renderDayChart();
    if (!this.el.viewIns.hidden && this.selection) this.renderInspector();
  }

  renderOrders() {
    const list = this.app.workorders?.list || [];
    const open = this.app.workorders?.openCount || 0;
    this.el.orderSum.textContent = `${list.length} 张 · 未完成 ${open}`;
    this.el.orderList.innerHTML = list.length ? list.map((o) => {
      const cls = o.status === 'done' ? 'done' : o.status === 'doing' ? 'doing' : 'open';
      const t = new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false });
      return `<div class="order ${cls}">
        <div class="order-main">
          <b>${escapeHtml(o.title)}</b>
          <em>${o.level} · ${o.rack ? o.rack + ' · ' : ''}${escapeHtml(o.deviceName || '')} · ${o.source} · ${t}</em>
        </div>
        <span class="tb-pill ${o.status === 'done' ? 'ok' : o.status === 'doing' ? 'warn' : 'bad'}">${o.status === 'done' ? '已完成' : o.status === 'doing' ? '处理中' : '待处理'}</span>
        <div class="order-acts">
          ${o.deviceId ? `<button class="tb-btn tiny ghost" data-order-go="${o.id}">定位</button>` : ''}
          ${o.status === 'open' ? `<button class="tb-btn tiny" data-id="${o.id}" data-order-status="doing">处理</button>` : ''}
          ${o.status !== 'done' ? `<button class="tb-btn tiny ghost" data-order-status="done" data-id="${o.id}">完成</button>` : ''}
          <button class="tb-btn tiny ghost" data-order-del="${o.id}">✕</button>
        </div>
      </div>`;
    }).join('') : '<div class="tb-empty">暂无工单。可从告警卡片或设备检查器创建。</div>';
  }

  renderCapacity() {
    const cap = this.app.analytics?.capacity?.();
    if (!cap || !this.el.capacity) return;
    const row = (label, pct, text) => {
      const cls = pct > 0.9 ? 'bad' : pct > 0.75 ? 'warn' : '';
      return `<div class="cap-row"><label>${label}</label><span>${text}</span>
        <div class="gauge ${cls}"><i style="width:${Math.round(pct * 100)}%"></i></div></div>`;
    };
    const d = (v) => (v == null ? '稳定' : `约 ${Math.round(v)} 天`);
    this.el.capacity.innerHTML = `
      ${row('U 位', cap.u.pct, `${cap.u.used}/${cap.u.cap}`)}
      ${row('功率', cap.power.pct, `${cap.power.used.toFixed(2)}/${cap.power.cap.toFixed(0)} kW`)}
      ${row('端口', cap.ports.pct, `${cap.ports.used}/${cap.ports.cap}`)}
      <div class="cap-forecast">功率余量：${d(cap.daysToPower)} · 端口余量：${d(cap.daysToU)} · 样本 ${cap.samples}</div>`;
  }

  renderDayChart() {
    if (!this.el.chartDay) return;
    const series = this.app.analytics?.series?.(24, 5 * 60 * 1000) || [];
    const data = series.length >= 3 ? series.map((s) => s.thr) : this.sim.history.thr;
    drawLine(this.el.chartDay, data, '#8b7bff');
    if (this.el.cDay) {
      const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
      this.el.cDay.textContent = `均值 ${avg.toFixed(1)} Gbps · ${series.length >= 3 ? `${series.length} 个 5min 桶` : '实时'}`;
    }
  }

  renderRackList() {
    const rows = this.state.racks.map((r) => {
      const devs = (r.devices || []).map((id) => this.state.devices[id]).filter(Boolean);
      const used = devs.reduce((n, d) => n + d.u, 0);
      const pctU = clamp(used / 42, 0, 1);
      const crit = devs.some((d) => d.status === 'offline' || d.flags.overheat > 0);
      const warn = (r.temp || 22) > 32 || devs.some((d) => d.flags.fanFail);
      const dot = crit ? 'bad' : warn ? 'warn' : '';
      return `<div class="rack-row" data-rack="${r.id}">
        <span class="dot ${dot}"></span>
        <div class="meta">
          <span class="rid">${r.name}</span>
          <span class="mini-bar"><i style="width:${pctU * 100}%"></i></span>
        </div>
        <em>${devs.length} 台·${(r.power || 0).toFixed(1)}kW</em>
      </div>`;
    }).join('');
    this.el.rackList.innerHTML = rows || `<div class="empty">还没有机柜<br/>从左侧资源库放置第一台机柜</div>`;
  }

  renderSummary(racks, devs, up, ports) {
    const usedU = devs.reduce((n, d) => n + d.u, 0);
    const cap = racks.length * 42 || 1;
    this.el.summary.innerHTML = `
      <div>机柜<b>${racks.length}</b></div>
      <div>设备<b>${devs.length}</b></div>
      <div>跳线<b>${Object.keys(this.state.cables).length}</b></div>
      <div>U 位占用<b>${Math.round((usedU / cap) * 100)}%</b></div>
      <div>端口 up<b>${up}/${ports}</b></div>
      <div>在线率<b>${devs.length ? Math.round((this.sim.stats.online / devs.length) * 100) : 0}%</b></div>`;
  }

  renderDashboard(st, racks, devs) {
    const el = this.el;
    const ports = devs.reduce((n, d) => n + d.ports.length, 0);
    const up = devs.reduce((n, d) => n + d.ports.filter((p) => p.state === 'up').length, 0);
    const onlinePct = devs.length ? Math.round((st.online / devs.length) * 100) : 0;
    el.kOnline.textContent = `${onlinePct}%`;
    el.kOnline.className = onlinePct >= 99 ? 'good' : onlinePct >= 90 ? 'warn' : 'alert';
    el.kOnlineS.textContent = `${st.online}/${devs.length} 台`;

    el.kAlarm.textContent = `${st.alarms}`;
    el.kAlarm.className = st.critical ? 'alert' : st.major ? 'warn' : '';
    el.kAlarmS.textContent = `${st.critical}C / ${st.major}M / ${st.minor}W`;

    el.kPower.textContent = fmt(st.power, 2);
    el.kTemp.textContent = fmt(st.avgTemp, 1);
    el.kTemp.parentElement.classList.toggle('alert', st.avgTemp > 32);
    const portPct = st.portsTotal ? Math.round((st.portsUp / st.portsTotal) * 100) : 0;
    el.kPorts.textContent = `${portPct}`;
    el.kHealth.textContent = `${Math.round(st.health)}`;
    el.kHealth.className = st.health > 85 ? 'good' : st.health > 60 ? 'warn' : 'alert';

    el.cThr.textContent = `${fmt(st.throughput, 1)} Gbps`;
    el.cTemp.textContent = `${fmt(st.avgTemp, 1)} ℃ · PUE ${fmt(st.pue, 2)}`;
    el.cPower.textContent = `${fmt(st.power, 2)} / ${fmt(racks.reduce((n, r) => n + (r.powerCap || 8), 0), 0)} kW`;
    el.cPorts.textContent = `${st.portsUp} up / ${st.portsTotal} total`;

    drawLine(el.chartThr, this.sim.history.thr, '#35d6ff');
    drawLine(el.chartTemp, this.sim.history.temp, '#ffb020', { danger: 32, min: 18 });

    el.rackBars.innerHTML = racks.map((r) => {
      const cap = r.powerCap || 8;
      const pct = clamp((r.power || 0) / cap, 0, 1);
      return `<div class="rbar ${(r.temp || 0) > 32 ? 'hot' : ''}">
        <span>${r.name}</span><span class="t"><i style="width:${pct * 100}%"></i></span>
        <b>${(r.power || 0).toFixed(2)}</b>
      </div>`;
    }).join('') || '<div class="empty">暂无数据</div>';

    const err = devs.reduce((n, d) => n + d.ports.filter((p) => p.state === 'err').length, 0);
    const down = Math.max(0, ports - up - err);
    el.pbUp.style.width = `${(up / Math.max(ports, 1)) * 100}%`;
    el.pbErr.style.width = `${(err / Math.max(ports, 1)) * 100}%`;
    el.pbDown.style.width = `${(down / Math.max(ports, 1)) * 100}%`;
    $('#port-legend').innerHTML = `
      <span><i style="background:#3ddc97"></i>UP ${up}</span>
      <span><i style="background:#ff4d63"></i>ERR ${err}</span>
      <span><i style="background:#2b3a49"></i>DOWN ${down}</span>`;
  }

  renderAlarms() {
    const alarms = this.sim.alarmsList;
    const st = this.sim.stats;
    this.el.alarmSummary.textContent = alarms.length
      ? `${st.critical} 严重 · ${st.major} 重要 · ${st.minor} 提示`
      : '暂无告警，机房运行平稳';

    this.el.alarmList.innerHTML = alarms.map((a) => {
      const t = new Date(a.since);
      const label = SEV_LABEL[a.sev] || a.sev;
      return `<div class="alarm ${a.sev}">
        <div class="top">
          <span class="ttl">${a.title}${a.ack ? ' · 已确认' : ''}</span>
          <span class="sev">${label}</span>
        </div>
        <div class="desc">${a.desc}</div>
        <div class="foot">
          <span class="time">${clockStr(t)} · ${a.ticks}s</span>
          <span class="acts">
            ${a.targetId ? `<button data-go="${a.targetId}" data-go-type="${a.targetType}">定位</button>` : ''}
            ${a.fix ? `<button data-fix="${a.id}">处置</button>` : ''}
            <button data-order-alarm="${a.id}">工单</button>
            ${!a.ack ? `<button data-ack="${a.id}">确认</button>` : ''}
          </span>
        </div>
      </div>`;
    }).join('') || `<div class="empty">✓ 所有监控指标正常<br/>告警将在阈值触发时自动出现</div>`;
  }

  renderEvents() {
    this.el.eventList.innerHTML = this.sim.events.slice(0, 60).map((e) => {
      const t = new Date(e.t);
      return `<div class="ev">
        <time>${clockStr(t)}</time>
        <span class="lv ${e.level}">●</span>
        <p>${e.text}</p>
      </div>`;
    }).join('') || '<div class="empty">暂无事件</div>';
  }

  /* ----------------------------- inspector --------------------------- */
  renderInspector() {
    const sel = this.selection;
    if (!sel) return;
    if (this.selectionSet?.length > 1) {
      this.renderBatchInspector(this.selectionSet);
      return;
    }
    if (sel.type === 'device') this.renderDeviceInspector(this.state.devices[sel.id]);
    else if (sel.type === 'rack') this.renderRackInspector(this.state.racks.find((r) => r.id === sel.id));
    else if (sel.type === 'cable') this.renderCableInspector(this.state.cables[sel.id]);
  }

  renderDeviceInspector(d) {
    if (!d) return;
    const spec = CATALOG[d.kind];
    const rack = this.state.racks.find((r) => r.id === d.rackId);
    const upCount = d.ports.filter((p) => p.state === 'up').length;
    const errCount = d.ports.filter((p) => p.state === 'err').length;
    const online = d.status === 'online' && d.adminPower;

    this.el.insTitle.textContent = d.name;
    this.el.insSub.textContent = `${spec.label} · ${d.model} · ${rack ? rack.name : '--'} U${d.slot} · ${vendor(d).label}`;
    if (d.realSource && this.state.dataMode === 'real') {
      this.el.insSub.textContent += ` · 真实 ${d.realSource.host}${Number.isFinite(d.realSource.latency) ? ` · ${d.realSource.latency}ms` : ''}`;
    }
    this.el.insBadge.textContent = STATUS_TXT[d.status] + (d.adminPower ? '' : ' · 断电');
    this.el.insBadge.className = `pill ${online ? 'ok' : d.status === 'rebooting' ? 'warn' : 'bad'}`;

    this.el.insActions.innerHTML = `
      <button data-act="terminal">终端</button>
      <button data-act="gencfg">配置</button>
      <button data-act="diag">诊断</button>
      <button data-act="front">正面编辑</button>
      <button data-act="order">报修</button>
      <button data-act="reboot">重启设备</button>
      <button data-act="power">${d.adminPower ? '断电' : '上电'}</button>
      <button data-act="repair">故障修复</button>
      <button data-act="isolate" class="danger">隔离</button>
      <button data-act="focus">定位</button>
      <button data-act="remove" class="danger">下架</button>`;

    const cpu = clamp(d.metrics.cpu, 0, 100);
    const mem = clamp(d.metrics.mem, 0, 100);
    const tmp = d.metrics.temp;
    const tmpPct = clamp(((tmp - 18) / 30) * 100, 0, 100);

    const portCells = d.ports.map((p) => {
      const m = String(p.label).match(/(\d+)(?!.*\d)/);
      const num = m ? m[1] : String(p.label).charAt(0).toUpperCase();
      const cls = p.state === 'up' ? 'up' : p.state === 'err' ? 'err' : '';
      const linked = p.cable ? 'linked' : '';
      return `<div class="port-cell ${cls} ${linked}" data-port="${p.id}"
        title="${p.label} · ${p.speed}G · ${p.state} · ${p.cable ? '已布线' : '未布线'}"
        style="border-color:${p.adminUp ? '' : 'rgba(255,77,99,.35)'}">${num}</div>`;
    }).join('');

    this.el.insBody.innerHTML = `
      <div class="spec-grid">
        <div class="spec"><label>CPU</label><b>${Math.round(cpu)}%</b>
          <div class="gauge ${cpu > 85 ? 'warn' : ''}"><i style="width:${cpu}%"></i></div></div>
        <div class="spec"><label>内存</label><b>${Math.round(mem)}%</b>
          <div class="gauge"><i style="width:${mem}%"></i></div></div>
        <div class="spec"><label>温度</label><b>${fmt(tmp, 1)} ℃</b>
          <div class="gauge ${tmp > 38 ? 'bad' : tmp > 32 ? 'warn' : ''}"><i style="width:${tmpPct}%"></i></div></div>
        <div class="spec"><label>功率</label><b>${fmt(d.metrics.power, 0)} W</b>
          <div class="gauge"><i style="width:${clamp((d.metrics.power / d.powerRated) * 100, 0, 100)}%"></i></div></div>
        <div class="spec"><label>吞吐</label><b>${fmt(d.metrics.throughput, 1)} Gbps</b></div>
        <div class="spec"><label>端口</label><b>${upCount} up / ${d.ports.length}</b></div>
      </div>

      <div class="ins-section">
        <h5>端口状态 <em>${errCount ? `${errCount} 个错误` : '点击切换 admin 状态'}</em></h5>
        <div class="port-grid">${portCells}</div>
      </div>

      <div class="ins-section">
        <h5>设备信息</h5>
        <div class="spec-grid">
          <div class="spec"><label>型号</label><b>${d.model}</b></div>
          <div class="spec"><label>U 高</label><b>${d.u}U</b></div>
          <div class="spec"><label>额定功率</label><b>${d.powerRated} W</b></div>
          <div class="spec"><label>累计错误</label><b>${d.ports.reduce((n, p) => n + Math.round(p.errors), 0)}</b></div>
        </div>
        <p style="font-size:10px;color:#7d93a9;line-height:1.6;margin:7px 0 0">${spec.desc}</p>
      </div>`;
  }

  renderRackInspector(r) {
    if (!r) return;
    const devs = (r.devices || []).map((id) => this.state.devices[id]).filter(Boolean);
    const used = devs.reduce((n, d) => n + d.u, 0);
    const power = r.power || 0;
    const cap = r.powerCap || 8;

    this.el.insTitle.textContent = r.name;
    this.el.insSub.textContent = `42U 标准机柜 · ${r.rotY ? '面朝 -Z' : '面朝 +Z'} · ${devs.length} 台设备`;
    this.el.insBadge.textContent = r.temp > 38 ? '过热' : r.temp > 32 ? '温度偏高' : '正常';
    this.el.insBadge.className = `pill ${r.temp > 38 ? 'bad' : r.temp > 32 ? 'warn' : 'ok'}`;

    this.el.insActions.innerHTML = `
      <button data-act="front">正面编辑</button>
      <button data-act="templates">模板 / 复制</button>
      <button data-act="cabling">布线助手</button>
      <button data-act="door">${r.doorTarget ? '关闭前门' : '打开前门'}</button>
      <button data-act="cool">应急制冷</button>
      <button data-act="focus">定位</button>
      <button data-act="remove" class="danger">移除机柜</button>`;

    const rows = devs.sort((a, b) => b.slot - a.slot).map((d) => {
      const bad = d.status === 'offline' || d.flags.fanFail;
      return `<div class="rack-row" data-dev="${d.id}">
        <span class="dot ${bad ? 'bad' : d.status === 'rebooting' ? 'warn' : ''}"></span>
        <div class="meta"><span class="rid">U${d.slot} · ${d.name}</span>
          <em>${CATALOG[d.kind].short} · ${d.ports.length} 端口</em></div>
        <em>${fmt(d.metrics.temp, 0)}℃</em>
      </div>`;
    }).join('');

    this.el.insBody.innerHTML = `
      <div class="spec-grid">
        <div class="spec"><label>进风温度</label><b>${fmt(r.temp, 1)} ℃</b></div>
        <div class="spec"><label>功率</label><b>${fmt(power, 2)} kW</b>
          <div class="gauge ${power > cap * 0.9 ? 'warn' : ''}"><i style="width:${clamp((power / cap) * 100, 0, 100)}%"></i></div>
        </div>
        <div class="spec"><label>U 位占用</label><b>${used} / 42U</b>
          <div class="gauge"><i style="width:${(used / 42) * 100}%"></i></div></div>
        <div class="spec"><label>额定容量</label><b>${cap} kW</b></div>
      </div>
      <div class="ins-section">
        <h5>设备上架图 <em>点击查看设备</em></h5>
        <div style="display:flex;flex-direction:column;gap:4px">${rows || '<div class="empty">机柜为空</div>'}</div>
      </div>`;
  }

  renderCableInspector(c) {
    if (!c) return;
    const a = this.state.devices[c.a.devId];
    const b = this.state.devices[c.b.devId];
    const pa = a?.ports.find((p) => p.id === c.a.portId);
    const pb = b?.ports.find((p) => p.id === c.b.portId);

    this.el.insTitle.textContent = `跳线 ${c.a.label} ↔ ${c.b.label}`;
    this.el.insSub.textContent = `${c.speed}G 链路 · ${pa?.state || 'down'} / ${pb?.state || 'down'}`;
    this.el.insBadge.textContent = pa?.state === 'up' && pb?.state === 'up' ? '链路正常' : '未连通';
    this.el.insBadge.className = `pill ${pa?.state === 'up' && pb?.state === 'up' ? 'ok' : 'bad'}`;
    this.el.insActions.innerHTML = `<button data-act="remove" class="danger">拆除跳线</button>`;

    this.el.insBody.innerHTML = `
      <div class="spec-grid">
        <div class="spec"><label>A 端</label><b>${a?.name || '--'}</b><span class="u">${c.a.label}</span></div>
        <div class="spec"><label>B 端</label><b>${b?.name || '--'}</b><span class="u">${c.b.label}</span></div>
        <div class="spec"><label>链路速率</label><b>${c.speed} Gbps</b></div>
        <div class="spec"><label>当前流量</label><b>${fmt(Math.max(pa?.tx || 0, pb?.tx || 0), 2)} Gbps</b></div>
      </div>
      <div class="ins-section">
        <h5>链路质量</h5>
        <div class="spec-grid">
          <div class="spec"><label>A 端错误</label><b>${Math.round(pa?.errors || 0)}</b></div>
          <div class="spec"><label>B 端错误</label><b>${Math.round(pb?.errors || 0)}</b></div>
        </div>
      </div>`;
  }
}

/* ------------------------------------------------------------------ *
 *  helpers
 * ------------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ *
 *  Canvas charts
 * ------------------------------------------------------------------ */
function drawLine(cv, data, color, opts = {}) {
  if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 300;
  const h = cv.clientHeight || 74;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const pad = 4;
  g.strokeStyle = 'rgba(120,170,210,.09)';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = pad + ((h - pad * 2) * i) / 4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }

  const arr = data.length ? data : [0, 0];
  let min = opts.min !== undefined ? opts.min : Math.min(...arr);
  let max = Math.max(...arr);
  if (max - min < 1e-3) { max = min + 1; }
  if (opts.min === undefined) min = Math.max(0, min - (max - min) * 0.15);
  max = max + (max - min) * 0.12;

  const X = (i) => (i / Math.max(1, arr.length - 1)) * w;
  const Y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);

  if (opts.danger) {
    g.setLineDash([4, 4]);
    g.strokeStyle = 'rgba(255,77,99,.5)';
    g.beginPath();
    g.moveTo(0, Y(opts.danger));
    g.lineTo(w, Y(opts.danger));
    g.stroke();
    g.setLineDash([]);
  }

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `${color}55`);
  grad.addColorStop(1, `${color}00`);

  g.beginPath();
  arr.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.closePath();
  g.fillStyle = grad;
  g.fill();

  g.beginPath();
  arr.forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  g.shadowColor = color;
  g.shadowBlur = 6;
  g.stroke();
  g.shadowBlur = 0;

  const lx = X(arr.length - 1);
  const ly = Y(arr[arr.length - 1]);
  g.fillStyle = color;
  g.beginPath();
  g.arc(lx - 1.5, ly, 2.4, 0, Math.PI * 2);
  g.fill();
}
