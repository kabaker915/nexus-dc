/** Lightweight work orders tied to devices / alarms, persisted locally. */
const KEY = 'nexusdc.workorders.v1';

export class WorkOrders {
  constructor(app) {
    this.app = app;
    this.list = this.load();
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
    try { localStorage.setItem(KEY, JSON.stringify(this.list.slice(0, 300))); } catch { /* ignore */ }
  }

  create({ title, deviceId = null, level = 'P2', source = 'manual', note = '' }) {
    const dev = deviceId ? this.app.state.devices[deviceId] : null;
    const rack = dev ? this.app.state.racks.find((r) => r.id === dev.rackId) : null;
    const order = {
      id: `wo_${Date.now().toString(36)}`,
      title: title || (dev ? `检修 ${dev.name}` : '新建工单'),
      deviceId,
      deviceName: dev?.name || '',
      rack: rack?.name || '',
      level,
      status: 'open',
      source,
      note,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.list.unshift(order);
    this.persist();
    this.app.ui?.refresh?.();
    this.app.toast?.(`工单已创建：${order.title}`, 'ok');
    return order;
  }

  setStatus(id, status) {
    const o = this.list.find((x) => x.id === id);
    if (!o) return;
    o.status = status;
    o.updatedAt = Date.now();
    this.persist();
    this.app.ui?.refresh?.();
  }

  remove(id) {
    this.list = this.list.filter((o) => o.id !== id);
    this.persist();
    this.app.ui?.refresh?.();
  }

  get openCount() {
    return this.list.filter((o) => o.status !== 'done').length;
  }

  bind() {
    const list = document.getElementById('order-list');
    if (!list) return;
    list.addEventListener('click', (e) => {
      const go = e.target.closest('[data-order-go]');
      if (go) {
        const o = this.list.find((x) => x.id === go.dataset.orderGo);
        if (o?.deviceId && this.app.state.devices[o.deviceId]) {
          this.app.select({ type: 'device', id: o.deviceId });
          this.app.focusTarget({ type: 'device', id: o.deviceId });
        }
        return;
      }
      const st = e.target.closest('[data-order-status]');
      if (st) return this.setStatus(st.dataset.id, st.dataset.orderStatus);
      const del = e.target.closest('[data-order-del]');
      if (del) return this.remove(del.dataset.orderDel);
    });
  }
}
