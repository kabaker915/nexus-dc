/** Snapshot-based undo / redo for structural layout edits. */
export class History {
  constructor(app, limit = 30) {
    this.app = app;
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.suppress = false;
  }

  snapshot() {
    return JSON.stringify(this.app.serialize());
  }

  push(label = '编辑') {
    if (this.suppress) return;
    this.undoStack.push({ label, data: this.snapshot(), at: Date.now() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.sync();
  }

  undo() {
    if (!this.undoStack.length) return false;
    const cur = this.snapshot();
    const state = this.undoStack.pop();
    this.redoStack.push({ label: state.label, data: cur });
    this.restore(state, '撤销');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const cur = this.snapshot();
    const state = this.redoStack.pop();
    this.undoStack.push({ label: state.label, data: cur });
    this.restore(state, '重做');
    return true;
  }

  restore(entry, verb) {
    this.suppress = true;
    try {
      this.app.loadLayout(JSON.parse(entry.data));
      this.app.persistLayout?.();
      this.app.select?.(null);
      this.app.toast?.(`${verb}：${entry.label}`, 'ok');
    } catch (err) {
      this.app.toast?.(`${verb}失败：${err.message}`, 'err');
    } finally {
      this.suppress = false;
    }
    this.sync();
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.sync();
  }

  sync() {
    const u = document.getElementById('hist-undo');
    const r = document.getElementById('hist-redo');
    if (u) {
      u.disabled = !this.undoStack.length;
      u.title = this.undoStack.length ? `撤销：${this.undoStack[this.undoStack.length - 1].label} (Ctrl+Z)` : '没有可撤销的操作';
    }
    if (r) {
      r.disabled = !this.redoStack.length;
      r.title = this.redoStack.length ? `重做：${this.redoStack[this.redoStack.length - 1].label} (Ctrl+Y)` : '没有可重做的操作';
    }
  }
}
