import { EXT_KINDS, EXT_VENDORS, dispatchCommands, gatewayHint } from './extnet.js';

const TPL = `
<div class="ext-overlay" id="ext-overlay" hidden>
  <div class="ext-window">
    <header class="ext-head">
      <div class="ext-title">
        <span class="ext-mark" id="ext-icon">⤯</span>
        <div>
          <b id="ext-name-title">外部设备</b>
          <small id="ext-sub">外接设备 · 命令下发</small>
        </div>
      </div>
      <button class="ext-close" id="ext-close">✕</button>
    </header>

    <div class="ext-body">
      <section id="ext-form" class="ext-form">
        <div class="ext-grid">
          <label>名称<input id="f-name" /></label>
          <label>类型<select id="f-kind"></select></label>
          <label>厂商<select id="f-vendor"></select></label>
          <label>协议<select id="f-protocol">
            <option value="ssh">SSH（本机网关）</option>
            <option value="http">HTTP API</option>
            <option value="sim">仅模拟</option>
          </select></label>
          <label>管理地址<input id="f-host" placeholder="10.0.0.1 / hostname" /></label>
          <label>端口<input id="f-port" type="number" min="1" max="65535" /></label>
          <label>用户名<input id="f-user" placeholder="netops" /></label>
          <label>上联节点<select id="f-uplink"></select></label>
        </div>
        <label class="ext-wide">备注<input id="f-note" placeholder="位置 / 用途 / 维护窗口" /></label>
        <p class="ext-hint" id="ext-hint"></p>
        <div class="ext-actions">
          <button class="tb-btn" id="f-save">保存</button>
          <button class="tb-btn" id="f-dispatch">下发命令</button>
          <button class="tb-btn ghost" id="f-delete">删除节点</button>
          <button class="tb-btn ghost" id="f-cancel">关闭</button>
        </div>
      </section>

      <section id="ext-dispatch" class="ext-dispatch" hidden>
        <div class="ext-target" id="ext-target">目标：—</div>
        <textarea id="ext-cmds" spellcheck="false" placeholder="每行一条命令，例如：display version"></textarea>
        <div class="ext-opts">
          <label><input type="checkbox" id="ext-real" /> 真实下发（经本机 SSH / HTTP 网关）</label>
          <label class="ext-ack" hidden><input type="checkbox" id="ext-ack" /> 我确认对真实设备执行</label>
          <label><input type="checkbox" id="ext-all" /> 批量：下发给全部外部设备</label>
        </div>
        <div class="ext-actions">
          <button class="tb-btn" id="ext-run">执行</button>
          <button class="tb-btn ghost" id="ext-back">返回设备信息</button>
          <span class="ext-hint" id="ext-gw"></span>
        </div>
        <div class="ext-result" id="ext-result"></div>
      </section>
    </div>
  </div>
</div>
`;

export class ExtUI {
  constructor(app) {
    this.app = app;
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('ext-overlay');
    this.el = {
      icon: document.getElementById('ext-icon'),
      title: document.getElementById('ext-name-title'),
      sub: document.getElementById('ext-sub'),
      form: document.getElementById('ext-form'),
      dispatch: document.getElementById('ext-dispatch'),
      name: document.getElementById('f-name'),
      kind: document.getElementById('f-kind'),
      vendor: document.getElementById('f-vendor'),
      protocol: document.getElementById('f-protocol'),
      host: document.getElementById('f-host'),
      port: document.getElementById('f-port'),
      user: document.getElementById('f-user'),
      uplink: document.getElementById('f-uplink'),
      note: document.getElementById('f-note'),
      hint: document.getElementById('ext-hint'),
      target: document.getElementById('ext-target'),
      cmds: document.getElementById('ext-cmds'),
      real: document.getElementById('ext-real'),
      ack: document.getElementById('ext-ack'),
      all: document.getElementById('ext-all'),
      gw: document.getElementById('ext-gw'),
      result: document.getElementById('ext-result'),
    };
    this.ext = null;
    this.buildSelects();
    this.bind();
  }

  get exts() {
    return this.app.state.ext || [];
  }

  buildSelects() {
    this.el.kind.innerHTML = Object.entries(EXT_KINDS)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    this.el.vendor.innerHTML = Object.entries(EXT_VENDORS)
      .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  }

  renderUplinkOptions(current) {
    const opts = ['<option value="">（不连接机房）</option>'];
    for (const d of Object.values(this.app.state.devices)) {
      const rack = this.app.state.racks.find((r) => r.id === d.rackId);
      opts.push(`<option value="${d.id}">机房 · ${d.name} · ${rack?.name || ''} U${d.slot}</option>`);
    }
    for (const e of this.exts) {
      if (e.id === current?.id) continue;
      opts.push(`<option value="${e.id}">外部 · ${e.name}</option>`);
    }
    this.el.uplink.innerHTML = opts.join('');
  }

  openProfile(id) {
    const ext = this.exts.find((e) => e.id === id);
    if (!ext) return;
    this.ext = ext;
    this.root.hidden = false;
    this.el.form.hidden = false;
    this.el.dispatch.hidden = true;
    this.fill(ext);
    this.el.result.innerHTML = '';
  }

  fill(ext) {
    const kind = EXT_KINDS[ext.kind] || EXT_KINDS.router;
    this.el.icon.textContent = kind.icon;
    this.el.icon.style.color = kind.color;
    this.el.title.textContent = ext.name;
    this.el.sub.textContent = `${kind.label} · ${EXT_VENDORS[ext.vendor] || ext.vendor} · ${ext.status === 'online' ? '连通' : ext.status === 'error' ? '故障' : ext.status === 'sim' ? '模拟' : '未探测'}`;
    this.el.name.value = ext.name;
    this.el.kind.value = ext.kind;
    this.el.vendor.value = ext.vendor;
    this.el.protocol.value = ext.protocol;
    this.el.host.value = ext.host;
    this.el.port.value = ext.port;
    this.el.user.value = ext.user;
    this.el.note.value = ext.note || '';
    this.renderUplinkOptions(ext);
    this.el.uplink.value = ext.uplink || '';
    this.el.hint.textContent = gatewayHint(ext);
  }

  readForm() {
    const ext = this.ext;
    if (!ext) return;
    ext.name = this.el.name.value.trim() || ext.name;
    ext.kind = this.el.kind.value;
    ext.vendor = this.el.vendor.value;
    ext.protocol = this.el.protocol.value;
    ext.host = this.el.host.value.trim();
    ext.port = Math.max(1, Math.min(65535, Number(this.el.port.value) || 22));
    ext.user = this.el.user.value.trim() || 'netops';
    ext.note = this.el.note.value.trim();
    ext.uplink = this.el.uplink.value || null;
    this.app.persistLayout();
    this.app.flat?.draw();
  }

  close() {
    this.root.hidden = true;
    this.ext = null;
  }

  bind() {
    document.getElementById('ext-close').addEventListener('click', () => this.close());
    document.getElementById('f-cancel').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });

    document.getElementById('f-save').addEventListener('click', () => {
      this.readForm();
      this.fill(this.ext);
      this.app.toast('外部设备已保存', 'ok');
    });

    document.getElementById('f-delete').addEventListener('click', () => {
      const ext = this.ext;
      if (!ext) return;
      if (!window.confirm(`删除外部设备 ${ext.name}？其拓扑链路也会移除。`)) return;
      this.app.removeExtNode(ext.id);
      this.close();
    });

    document.getElementById('f-dispatch').addEventListener('click', () => {
      this.readForm();
      this.showDispatch();
    });

    document.getElementById('ext-back').addEventListener('click', () => {
      this.el.dispatch.hidden = true;
      this.el.form.hidden = false;
    });

    document.getElementById('ext-real').addEventListener('change', () => this.updateGw());
    document.getElementById('ext-all').addEventListener('change', () => this.updateGw());
    document.getElementById('ext-run').addEventListener('click', () => this.run());
  }

  showDispatch() {
    this.el.form.hidden = true;
    this.el.dispatch.hidden = false;
    this.el.result.innerHTML = '';
    this.updateGw();
    if (!this.el.cmds.value.trim()) {
      this.el.cmds.value = this.ext?.vendor === 'linux'
        ? 'uname -a\nip a'
        : 'display version\ndisplay interface brief';
    }
  }

  updateGw() {
    const all = this.el.all.checked;
    const targets = all ? this.exts : [this.ext].filter(Boolean);
    const real = this.el.real.checked;
    this.el.target.textContent = all
      ? `目标：全部 ${targets.length} 台外部设备`
      : `目标：${this.ext?.name || '—'}${this.ext?.host ? ` · ${this.ext.host}:${this.ext.port}` : ''}`;
    this.el.gw.textContent = real
      ? '真实模式：本机网关将发起 SSH/HTTP 连接，请确认地址与凭据。'
      : '模拟模式：本地生成多厂商回显，不触达真实网络。';
    this.el.ack.parentElement.hidden = !real;
    this.el.ack.parentElement.classList.toggle('danger', real);
    if (!real) this.el.ack.checked = false;
  }

  async run() {
    const all = this.el.all.checked;
    const targets = (all ? this.exts : [this.ext]).filter(Boolean);
    if (!targets.length) return;
    const commands = this.el.cmds.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!commands.length) {
      this.app.toast('请输入至少一条命令', 'warn');
      return;
    }
    const real = this.el.real.checked;
    if (real && !this.el.ack.checked) {
      this.app.toast('真实下发前请勾选确认', 'warn');
      return;
    }

    this.el.result.innerHTML = targets.map((t) => `
      <div class="ext-res" data-id="${t.id}">
        <div class="ext-res-head"><b>${t.name}</b><span>${t.host || '未配置地址'}</span><i class="pending">执行中…</i></div>
        <pre class="ext-res-out">$ ${commands.join('\n$ ')}</pre>
      </div>`).join('');

    await Promise.all(targets.map(async (t) => {
      const box = this.el.result.querySelector(`[data-id="${t.id}"]`);
      try {
        const r = await dispatchCommands(this.app, t, commands, { real });
        if (box) {
          box.querySelector('.ext-res-head i').className = r.ok ? 'ok' : 'bad';
          box.querySelector('.ext-res-head i').textContent = r.ok ? `${r.adapter} · ${r.ms}ms` : '失败';
          box.querySelector('.ext-res-out').textContent =
            `$ ${commands.join('\n$ ')}\n\n${r.stdout || ''}${r.stderr ? `\n[stderr]\n${r.stderr}` : ''}`;
        }
      } catch (err) {
        if (box) {
          box.querySelector('.ext-res-head i').className = 'bad';
          box.querySelector('.ext-res-head i').textContent = '异常';
          box.querySelector('.ext-res-out').textContent = String(err.message || err);
        }
      }
    }));

    this.fill(this.ext);
    this.app.persistLayout();
    this.app.flat?.draw();
  }
}
