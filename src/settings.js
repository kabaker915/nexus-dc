/**
 * System settings: performance profile, webhook notification, local data.
 */
const KEY = 'nexusdc.settings.v1';

const DEFAULTS = {
  perf: 'high',
  hud: false,
  heat: false,
  shafts: false,
  webhook: { enabled: false, url: '' },
};

const TPL = `
<div class="set-overlay" id="set-overlay" hidden>
  <div class="set-window">
    <header class="set-head">
      <div><b>系统设置</b><small>性能 / 告警通知 / 本地数据</small></div>
      <button class="set-close" id="set-close">✕</button>
    </header>
    <div class="set-body">
      <section class="set-sec">
        <h4>渲染性能</h4>
        <div class="set-perf" id="set-perf">
          <label><input type="radio" name="perf" value="low" /> <b>流畅</b><em>关阴影与 Bloom，1× 像素比，适合集显 / 大机房</em></label>
          <label><input type="radio" name="perf" value="mid" /> <b>均衡</b><em>1024 阴影 + 半分辨率 Bloom，1.5× 像素比</em></label>
          <label><input type="radio" name="perf" value="high" /> <b>画质</b><em>2048 阴影 + 全分辨率 Bloom，2× 像素比</em></label>
        </div>
        <label class="set-check"><input type="checkbox" id="set-hud" /> 显示帧率 / Draw Call</label>
        <label class="set-check"><input type="checkbox" id="set-heat" /> 机柜热力（3D 温度体） <kbd>H</kbd></label>
        <label class="set-check"><input type="checkbox" id="set-shafts" /> 顶部体积光（灯柱）</label>
        <p class="set-hint">切换立即生效；低档位会同时降低 LED 刷新频率与线缆高亮开销。</p>
      </section>

      <section class="set-sec">
        <h4>告警 Webhook</h4>
        <label class="set-check"><input type="checkbox" id="set-wh-on" /> 启用告警推送</label>
        <div class="set-row">
          <input id="set-wh-url" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
          <button class="tb-btn tiny ghost" id="set-wh-test">发送测试</button>
        </div>
        <p class="set-hint" id="set-wh-status">新告警产生时向该地址 POST JSON（经本机网关转发，避免浏览器跨域）。</p>
      </section>

      <section class="set-sec">
        <h4>本地数据</h4>
        <div class="set-row">
          <button class="tb-btn tiny ghost" id="set-report">导出 PDF 报告</button>
          <button class="tb-btn tiny ghost" id="set-clear-alarms">清空告警与事件</button>
          <button class="tb-btn tiny ghost" id="set-clear-all">清空全部本地数据</button>
          <span class="set-hint" id="set-storage"></span>
        </div>
      </section>
    </div>
  </div>
</div>
`;

export class Settings {
  constructor(app) {
    this.app = app;
    this.data = this.load();
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('set-overlay');
    this.el = {
      perf: document.getElementById('set-perf'),
      hud: document.getElementById('set-hud'),
      whOn: document.getElementById('set-wh-on'),
      whUrl: document.getElementById('set-wh-url'),
      whStatus: document.getElementById('set-wh-status'),
      storage: document.getElementById('set-storage'),
    };
    this.bind();
    this.syncUI();
    this.app.applyPerf(this.data.perf);
  }

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { ...DEFAULTS, ...raw, webhook: { ...DEFAULTS.webhook, ...(raw.webhook || {}) } };
    } catch {
      return { ...DEFAULTS };
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota */ }
  }

  syncUI() {
    this.root.querySelectorAll('input[name="perf"]').forEach((r) => { r.checked = r.value === this.data.perf; });
    this.el.hud.checked = !!this.data.hud;
    document.getElementById('set-heat').checked = !!this.data.heat;
    document.getElementById('set-shafts').checked = !!this.data.shafts;
    this.el.whOn.checked = !!this.data.webhook.enabled;
    this.el.whUrl.value = this.data.webhook.url || '';
    this.el.storage.textContent = this.storageText();
    document.getElementById('perf-hud').hidden = !this.data.hud;
  }

  storageText() {
    try {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('nexusdc.')) bytes += (localStorage.getItem(k) || '').length + k.length;
      }
      return `已用 ${(bytes / 1024).toFixed(1)} KB`;
    } catch {
      return '';
    }
  }

  open() {
    this.root.hidden = false;
    this.syncUI();
  }

  close() {
    this.root.hidden = true;
  }

  bind() {
    document.getElementById('set-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });

    this.el.perf.addEventListener('change', (e) => {
      if (e.target.name !== 'perf') return;
      this.data.perf = e.target.value;
      this.save();
      this.app.applyPerf(this.data.perf);
      this.app.toast?.(`已切换到「${e.target.parentElement.querySelector('b').textContent}」画质`, 'ok');
    });

    this.el.hud.addEventListener('change', () => {
      this.data.hud = this.el.hud.checked;
      this.save();
      document.getElementById('perf-hud').hidden = !this.data.hud;
    });

    document.getElementById('set-heat').addEventListener('change', (e) => {
      this.data.heat = e.target.checked;
      this.save();
      this.app.toggleHeat?.(e.target.checked);
    });

    document.getElementById('set-shafts').addEventListener('change', (e) => {
      this.data.shafts = e.target.checked;
      this.save();
      this.app.toggleShafts?.(e.target.checked);
    });

    this.el.whOn.addEventListener('change', () => {
      this.data.webhook.enabled = this.el.whOn.checked;
      this.save();
    });

    this.el.whUrl.addEventListener('change', () => {
      this.data.webhook.url = this.el.whUrl.value.trim();
      this.save();
    });

    document.getElementById('set-wh-test').addEventListener('click', () => this.testWebhook());

    document.getElementById('set-clear-alarms').addEventListener('click', () => {
      this.app.sim.clearAllAlarms?.();
      this.app.toast?.('告警与事件已清空', 'ok');
    });

    document.getElementById('set-report').addEventListener('click', () => {
      this.close();
      this.app.openReport?.();
    });

    document.getElementById('set-clear-all').addEventListener('click', () => {
      if (!window.confirm('清空本机保存的布局、快照、模板、告警与设置？')) return;
      this.app.clearLocalData?.();
    });
  }

  async testWebhook() {
    const url = this.el.whUrl.value.trim();
    if (!url) return this.app.toast?.('请先填写 Webhook 地址', 'warn');
    this.data.webhook.url = url;
    this.data.webhook = { ...this.data.webhook, enabled: this.el.whOn.checked, url };
    this.save();
    this.el.whStatus.textContent = '发送中…';
    const r = await sendWebhook(url, {
      event: 'test',
      title: 'NEXUS DC 测试通知',
      text: '如果你收到这条消息，说明 Webhook 配置成功。',
      at: new Date().toISOString(),
    });
    this.el.whStatus.textContent = r.ok ? `发送成功（HTTP ${r.status}）` : `发送失败：${r.error || r.status}`;
  }

  notify(alarm) {
    if (!this.data.webhook.enabled || !this.data.webhook.url) return;
    const payload = {
      event: 'alarm',
      site: 'NEXUS DC',
      level: alarm.sev,
      title: alarm.title,
      text: alarm.desc,
      target: alarm.targetId,
      at: new Date(alarm.since).toISOString(),
    };
    sendWebhook(this.data.webhook.url, payload).then((r) => {
      if (!r.ok) this.app.sim?.log?.('warn', `Webhook 推送失败：${r.error || r.status}`);
    });
  }
}

export async function sendWebhook(url, payload) {
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, payload }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: !!data.ok, status: data.status || res.status, error: data.error };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}
