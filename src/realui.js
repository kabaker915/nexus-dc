const TPL = `
<div class="real-overlay" id="real-overlay" hidden>
  <div class="real-window">
    <header class="real-head">
      <div class="real-title">
        <span class="real-mark">◎</span>
        <div>
          <b>真实设备接入</b>
          <small>局域网自动发现 · SSH 识别 · 实时状态回填</small>
        </div>
      </div>
      <div class="dmode" id="real-mode">
        <button data-dmode="sim">模拟</button>
        <button data-dmode="real" class="on">真实</button>
      </div>
      <button class="real-close" id="real-close">✕</button>
    </header>

    <div class="real-body">
      <section class="real-block">
        <div class="real-row">
          <label class="real-field">网段
            <input id="real-cidr" placeholder="192.168.1.0/24" />
          </label>
          <label class="real-field narrow">SSH 端口
            <input id="real-port" type="number" value="22" min="1" max="65535" />
          </label>
          <button class="tb-btn" id="real-scan">扫描局域网</button>
          <span id="real-scan-status" class="tb-meta"></span>
        </div>
        <p class="real-hint">扫描只做 TCP 端口探测；识别设备需要本机已配置 SSH 公钥信任（BatchMode）。</p>
        <div id="real-hosts" class="real-hosts"></div>
      </section>

      <section class="real-block grow">
        <div class="real-row">
          <b>已接入设备</b>
          <span id="real-count" class="tb-meta"></span>
          <button class="tb-btn ghost tiny" id="real-probe-all">全部探测</button>
          <button class="tb-btn ghost tiny" id="real-topo">拓扑发现</button>
          <button class="tb-btn ghost tiny" id="real-manual-toggle">手动添加</button>
        </div>
        <div class="real-manual" id="real-manual" hidden>
          <input id="real-host" placeholder="设备地址 10.0.0.1" />
          <input id="real-user" placeholder="用户名" value="netops" />
          <select id="real-protocol">
            <option value="ssh">SSH</option>
            <option value="snmp">SNMP v2c</option>
            <option value="redfish">Redfish</option>
          </select>
          <select id="real-family">
            <option value="auto">自动识别</option>
            <option value="h3c">H3C</option>
            <option value="huawei">Huawei</option>
            <option value="cisco">Cisco</option>
            <option value="linux">Linux</option>
          </select>
          <input id="real-mport" class="real-port" placeholder="端口" value="22" />
          <button class="tb-btn tiny" id="real-add-confirm">添加并探测</button>
        </div>
        <div id="real-list" class="real-list"></div>
      </section>
    </div>
  </div>
</div>
`;

const STATUS_TXT = {
  online: '在线', offline: '离线', error: '异常', authfail: '认证失败', unknown: '未探测',
};

export class RealUI {
  constructor(app) {
    this.app = app;
    this.real = app.real;
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('real-overlay');
    this.el = {
      cidr: document.getElementById('real-cidr'),
      port: document.getElementById('real-port'),
      scan: document.getElementById('real-scan'),
      status: document.getElementById('real-scan-status'),
      hosts: document.getElementById('real-hosts'),
      list: document.getElementById('real-list'),
      count: document.getElementById('real-count'),
      manual: document.getElementById('real-manual'),
      host: document.getElementById('real-host'),
      user: document.getElementById('real-user'),
      family: document.getElementById('real-family'),
      protocol: document.getElementById('real-protocol'),
      mport: document.getElementById('real-mport'),
      topo: document.getElementById('real-topo'),
      probeAll: document.getElementById('real-probe-all'),
    };
    this.foundHosts = [];
    this.bind();
  }

  async open() {
    this.root.hidden = false;
    if (!this.el.cidr.value) {
      try {
        const info = await this.real.netinfo();
        if (info.ok && info.suggested) this.el.cidr.value = info.suggested;
      } catch { /* gateway offline */ }
    }
    this.refresh();
  }

  close() {
    this.root.hidden = true;
  }

  refresh() {
    const list = this.real.devices;
    const online = list.filter((d) => d.status === 'online').length;
    this.el.count.textContent = `${list.length} 台 · 在线 ${online}`;
    this.el.list.innerHTML = list.length ? list.map((d) => this.rowHtml(d)).join('') : `
      <div class="tb-empty">
        还没有接入真实设备。<br/>
        输入网段后点「扫描局域网」，或手动添加设备地址。
      </div>`;

    document.querySelectorAll('#real-mode [data-dmode]').forEach((b) => {
      b.classList.toggle('on', b.dataset.dmode === this.app.state.dataMode);
    });
  }

  rowHtml(d) {
    const st = STATUS_TXT[d.status] || d.status;
    const cls = d.status === 'online' ? 'ok' : d.status === 'authfail' || d.status === 'error' ? 'bad' : 'warn';
    const model = d.model || d.vendor?.toUpperCase() || '未知型号';
    const m = d.metrics || {};
    const bound = this.app.state.devices[d.boundDeviceId];
    const opts = ['<option value="">不绑定</option>']
      .concat(Object.values(this.app.state.devices).map((x) =>
        `<option value="${x.id}" ${x.id === d.boundDeviceId ? 'selected' : ''}>${x.name}</option>`));
    return `<div class="real-dev" data-id="${d.id}">
      <span class="real-dot ${cls}"></span>
      <div class="real-dev-main">
        <b>${d.host}:${d.port}</b>
        <em>${model} · ${d.user} · ${d.latency ? d.latency + 'ms' : '—'} · ${this.timeAgo(d.lastAt)}</em>
      </div>
      <div class="real-metrics">
        <span>CPU <b>${num(m.cpu)}%</b></span>
        <span>内存 <b>${num(m.mem)}%</b></span>
        <span>温度 <b>${num(m.temp, 1)}℃</b></span>
        <span>端口 <b>${d.portsUp == null ? '—' : d.portsUp + '/' + ((d.portsUp || 0) + (d.portsDown || 0))}</b></span>
      </div>
      <span class="tb-pill ${cls}">${st}</span>
      <select class="real-bind" data-bind="${d.id}">${opts.join('')}</select>
      <button class="tb-btn tiny" data-probe="${d.id}">探测</button>
      <button class="tb-btn tiny ghost" data-cmd="${d.id}">命令</button>
      <button class="tb-btn tiny ghost" data-del="${d.id}">移除</button>
      ${d.error ? `<div class="real-err">${escapeHtml(d.error)}</div>` : ''}
    </div>`;
  }

  timeAgo(ts) {
    if (!ts) return '未探测';
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s 前`;
    if (s < 3600) return `${Math.round(s / 60)}m 前`;
    return `${Math.round(s / 3600)}h 前`;
  }

  renderHosts() {
    if (!this.foundHosts.length) {
      this.el.hosts.innerHTML = '';
      return;
    }
    this.el.hosts.innerHTML = `
      <div class="real-hosts-head">
        <span>发现 ${this.foundHosts.length} 个开放端口的主机</span>
        <button class="tb-btn tiny" id="real-adopt-all">全部探测并接入</button>
      </div>
      <div class="real-host-list">
        ${this.foundHosts.map((h) => `
          <span class="real-host">
            <b>${h.host}</b><em>:${this.el.port.value} · ${h.ms}ms</em>
            <button class="tb-btn tiny ghost" data-adopt="${h.host}">接入</button>
          </span>`).join('')}
      </div>`;
  }

  addDevice(host, user = this.el.user.value || 'netops', family = 'auto', protocol = 'ssh', port = null) {
    const fallback = this.el.manual.hidden ? this.el.port.value : this.el.mport?.value;
    const p = Number(port || fallback) || (protocol === 'redfish' ? 443 : protocol === 'snmp' ? 161 : 22);
    const dev = this.real.addManual(host, user, p, family, protocol);
    if (!dev) this.app.toast(`${host} 已在列表中`, 'warn');
    return dev;
  }

  async scan() {
    const cidr = this.el.cidr.value.trim();
    if (!cidr) return this.app.toast('请输入网段，例如 192.168.1.0/24', 'warn');
    this.el.scan.disabled = true;
    this.el.status.textContent = '扫描中…';
    try {
      const res = await this.real.discover(cidr, Number(this.el.port.value) || 22, 350);
      if (!res.ok) throw new Error(res.error || '扫描失败');
      this.foundHosts = res.hosts;
      this.el.status.textContent = `扫描 ${res.scanned} 个地址，${res.hosts.length} 个开放 SSH · ${res.ms}ms`;
      this.renderHosts();
      if (!res.hosts.length) this.el.hosts.innerHTML = '<p class="real-hint">该网段没有开放 SSH 的主机（可换端口或确认设备在线）。</p>';
    } catch (err) {
      this.el.status.textContent = '';
      this.app.toast(`扫描失败：${err.message}（需要从本地 server.mjs 打开页面）`, 'err');
    } finally {
      this.el.scan.disabled = false;
    }
  }

  async adopt(host) {
    const dev = this.addDevice(host, this.el.user.value || 'netops', 'auto', 'ssh', Number(this.el.port.value) || 22);
    if (!dev) return;
    this.app.toast(`正在探测 ${host} …`, 'ok');
    const r = await this.real.probe(dev);
    this.refresh();
    if (r?.ok) this.app.toast(`${host} 识别成功（${dev.vendor}）`, 'ok');
    else this.app.toast(`${host} 探测失败，见列表错误信息`, 'warn');
  }

  async adoptAll() {
    const hosts = this.foundHosts.slice();
    if (!hosts.length) return;
    this.el.status.textContent = `正在接入 ${hosts.length} 台设备…`;
    for (let i = 0; i < hosts.length; i++) {
      this.el.status.textContent = `探测 ${i + 1}/${hosts.length} · ${hosts[i].host}`;
      // eslint-disable-next-line no-await-in-loop
      await this.adopt(hosts[i].host);
    }
    this.el.status.textContent = `完成：${hosts.length} 台已接入`;
  }

  bind() {
    document.getElementById('real-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });

    this.el.scan.addEventListener('click', () => this.scan());

    this.el.hosts.addEventListener('click', (e) => {
      const adopt = e.target.closest('[data-adopt]');
      if (adopt) return this.adopt(adopt.dataset.adopt);
      if (e.target.id === 'real-adopt-all') return this.adoptAll();
    });

    document.getElementById('real-manual-toggle').addEventListener('click', () => {
      this.el.manual.hidden = !this.el.manual.hidden;
    });
    document.getElementById('real-add-confirm').addEventListener('click', async () => {
      const host = this.el.host.value.trim();
      if (!host) return;
      const protocol = this.el.protocol?.value || 'ssh';
      const port = Number(this.el.mport?.value) || (protocol === 'redfish' ? 443 : protocol === 'snmp' ? 161 : 22);
      const dev = this.addDevice(host, this.el.user.value || 'netops', this.el.family.value, protocol, port);
      if (dev) {
        await this.real.probe(dev);
        this.refresh();
      }
    });

    this.el.protocol?.addEventListener('change', () => {
      const p = this.el.protocol.value;
      if (this.el.mport) this.el.mport.value = p === 'redfish' ? '443' : p === 'snmp' ? '161' : '22';
      if (this.el.family) this.el.family.disabled = p !== 'ssh';
    });

    this.el.topo?.addEventListener('click', async () => {
      if (!this.real.devices.length) return this.app.toast('没有已接入设备', 'warn');
      this.el.topo.disabled = true;
      await this.real.probeAll(this.real.devices, (i, n) => {
        this.el.count.textContent = `探测中 ${i}/${n}`;
      });
      const links = this.real.buildTopology();
      this.el.topo.disabled = false;
      this.refresh();
      this.app.toast(links ? `LLDP 拓扑发现：新增 ${links} 条上联` : '未发现可匹配的 LLDP 邻居', links ? 'ok' : 'warn');
    });

    this.el.probeAll.addEventListener('click', async () => {
      if (!this.real.devices.length) return this.app.toast('没有已接入设备', 'warn');
      this.el.probeAll.disabled = true;
      await this.real.probeAll(this.real.devices, (i, n) => {
        this.el.count.textContent = `探测中 ${i}/${n}`;
      });
      this.el.probeAll.disabled = false;
      this.refresh();
    });

    this.el.list.addEventListener('change', (e) => {
      const sel = e.target.closest('[data-bind]');
      if (!sel) return;
      const dev = this.real.devices.find((d) => d.id === sel.dataset.bind);
      if (!dev) return;
      this.real.bind(dev, sel.value);
      this.app.toast(sel.value ? '已绑定到机房设备，真实模式下回填其状态' : '已取消绑定', 'ok');
      this.refresh();
    });

    this.el.list.addEventListener('click', async (e) => {
      const probe = e.target.closest('[data-probe]');
      if (probe) {
        const dev = this.real.devices.find((d) => d.id === probe.dataset.probe);
        if (!dev) return;
        probe.disabled = true;
        await this.real.probe(dev);
        probe.disabled = false;
        this.refresh();
        return;
      }
      const cmd = e.target.closest('[data-cmd]');
      if (cmd) {
        const dev = this.real.devices.find((d) => d.id === cmd.dataset.cmd);
        if (!dev) return;
        if (!dev.extId) this.real.syncExt(dev);
        this.close();
        this.app.openExt(dev.extId);
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const dev = this.real.devices.find((d) => d.id === del.dataset.del);
        if (dev) {
          this.real.remove(dev);
          this.refresh();
        }
      }
    });

    document.querySelectorAll('#real-mode [data-dmode]').forEach((b) => {
      b.addEventListener('click', () => this.app.setDataMode(b.dataset.dmode));
    });
  }
}

function num(v, d = 0) {
  return Number.isFinite(v) ? v.toFixed(d) : '—';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
