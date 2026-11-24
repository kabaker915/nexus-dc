import { COMMAND_TEMPLATES } from './netdevops/templates.js';
import { hasCli, hostName, mgmtIp, vendor, vendorKey, VENDORS } from './netdevops/vendors.js';
import { buildConfig, diffLines } from './netdevops/config.js';
import { runCli } from './netdevops/cli.js';
import { auditAll, buildReport, diagnose } from './netdevops/audit.js';

const SNAP_KEY = 'nexusdc.netdevops.snapshots.v1';
const MAX_SNAPS = 6;

const TPL = `
<div class="tb-overlay" id="tb-overlay" hidden>
  <div class="tb-window">
    <header class="tb-head">
      <div class="tb-brand">
        <span class="tb-mark">◆</span>
        <div><b>NetDevOps 工具箱</b><small>多厂商统一运维 · 终端 / 配置 / 巡检 / 诊断</small></div>
      </div>
      <div class="tb-target">
        <label>目标设备</label>
        <select id="tb-dev"></select>
        <span id="tb-vendor" class="tb-pill">—</span>
      </div>
      <button class="tb-close" id="tb-close" title="关闭 (Esc)">✕</button>
    </header>

    <div class="tb-body">
      <nav class="tb-nav">
        <button data-tab="term" class="on"><i>▷</i>终端</button>
        <button data-tab="config"><i>≡</i>配置</button>
        <button data-tab="audit"><i>✓</i>巡检</button>
        <button data-tab="tpl"><i>⌘</i>模板</button>
        <button data-tab="diag"><i>◎</i>诊断</button>
        <div class="tb-src">
          命令模板 / 巡检模型参考<br/>
          <a href="https://github.com/lovekeven/NetDevOps-Toolbox-V1" target="_blank" rel="noreferrer">NetDevOps-Toolbox-V1</a> · MIT
        </div>
      </nav>

      <section class="tb-panel" id="tb-p-term">
        <div class="tb-out" id="tb-out"></div>
        <div class="tb-in">
          <span id="tb-prompt">&lt;device&gt;</span>
          <input id="tb-input" autocomplete="off" autocapitalize="off" spellcheck="false"
                 placeholder="输入命令，help 查看支持列表" />
        </div>
      </section>

      <section class="tb-panel" id="tb-p-config" hidden>
        <div class="tb-bar">
          <button id="tb-gen" class="tb-btn">重新生成</button>
          <button id="tb-copy" class="tb-btn ghost">复制配置</button>
          <button id="tb-snap" class="tb-btn ghost">备份全部配置</button>
          <select id="tb-snap-list" class="tb-select"><option value="">与历史快照对比…</option></select>
          <span id="tb-cfg-meta" class="tb-meta"></span>
        </div>
        <pre class="tb-pre" id="tb-cfg"></pre>
      </section>

      <section class="tb-panel" id="tb-p-audit" hidden>
        <div class="tb-bar">
          <button id="tb-run-audit" class="tb-btn">开始全量巡检</button>
          <button id="tb-export" class="tb-btn ghost">导出报告</button>
          <span id="tb-audit-sum" class="tb-meta"></span>
        </div>
        <div class="tb-audit-cards" id="tb-audit-cards"></div>
        <div class="tb-audit-list" id="tb-audit-list"></div>
      </section>

      <section class="tb-panel" id="tb-p-tpl" hidden>
        <div class="tb-bar">
          <span class="tb-meta">命令模板来自 NetDevOps-Toolbox-V1，点击即在该设备上执行</span>
        </div>
        <div class="tb-tpl" id="tb-tpl"></div>
      </section>

      <section class="tb-panel" id="tb-p-diag" hidden>
        <div class="tb-bar">
          <button id="tb-run-diag" class="tb-btn">诊断当前设备</button>
          <button id="tb-run-diag-all" class="tb-btn ghost">诊断全部告警</button>
          <span class="tb-meta">本地规则引擎，不调用外部大模型</span>
        </div>
        <div id="tb-diag-body"></div>
      </section>
    </div>
  </div>
</div>
`;

export class Toolbox {
  constructor(app) {
    this.app = app;
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('tb-overlay');
    this.el = {
      dev: document.getElementById('tb-dev'),
      vendor: document.getElementById('tb-vendor'),
      out: document.getElementById('tb-out'),
      input: document.getElementById('tb-input'),
      prompt: document.getElementById('tb-prompt'),
      cfg: document.getElementById('tb-cfg'),
      cfgMeta: document.getElementById('tb-cfg-meta'),
      snapList: document.getElementById('tb-snap-list'),
      auditCards: document.getElementById('tb-audit-cards'),
      auditList: document.getElementById('tb-audit-list'),
      auditSum: document.getElementById('tb-audit-sum'),
      tpl: document.getElementById('tb-tpl'),
      diag: document.getElementById('tb-diag-body'),
    };
    this.open_ = false;
    this.tab = 'term';
    this.devId = null;
    this.history = [];
    this.historyIdx = -1;
    this.snapshots = this.loadSnapshots();
    this.audit = null;
    this.bind();
  }

  /* ------------------------------ lifecycle --------------------------- */
  get devices() {
    return Object.values(this.app.state.devices).filter((d) => hasCli(d));
  }

  open(devId = null, tab = null) {
    const list = this.devices;
    if (!list.length) {
      this.app.toast('当前机房没有可管理的网络设备', 'warn');
      return;
    }
    this.root.hidden = false;
    this.open_ = true;
    document.body.classList.add('tb-open');
    this.renderDevices();
    const pick = devId && list.some((d) => d.id === devId) ? devId : (this.currentDevice()?.id || list[0].id);
    this.setDevice(pick, true);
    if (tab) this.switchTab(tab);
    else this.switchTab(this.tab || 'term');
    if (this.tab === 'term') setTimeout(() => this.el.input.focus(), 60);
  }

  close() {
    this.root.hidden = true;
    this.open_ = false;
    document.body.classList.remove('tb-open');
  }

  toggle() {
    if (this.open_) this.close();
    else this.open(this.app.state.selection?.type === 'device' ? this.app.state.selection.id : null);
  }

  onSelection(target) {
    if (!this.open_ || target?.type !== 'device') return;
    if (this.devices.some((d) => d.id === target.id) && target.id !== this.devId) this.setDevice(target.id);
  }

  /* ------------------------------- DOM -------------------------------- */
  renderDevices() {
    const list = this.devices.sort((a, b) => a.name.localeCompare(b.name));
    this.el.dev.innerHTML = list.map((d) => {
      const rack = this.app.state.racks.find((r) => r.id === d.rackId);
      return `<option value="${d.id}">${d.name} · ${rack?.name || '—'} U${d.slot} · ${vendor(d).label}</option>`;
    }).join('');
    if (this.devId) this.el.dev.value = this.devId;
  }

  currentDevice() {
    return this.app.state.devices[this.devId] || null;
  }

  setDevice(id, resetTerm = true) {
    this.devId = id;
    this.el.dev.value = id;
    const d = this.currentDevice();
    if (!d) return;
    const v = vendor(d);
    this.el.vendor.textContent = v.label;
    this.el.vendor.className = `tb-pill v-${v.key}`;
    this.updatePrompt();
    if (resetTerm) this.resetTerminal();
    if (this.tab === 'config') this.renderConfig();
    if (this.tab === 'tpl') this.renderTemplates();
    if (this.tab === 'diag') this.renderDiag();
    if (this.tab === 'audit' && this.audit) this.renderAudit();
  }

  updatePrompt() {
    const d = this.currentDevice();
    if (!d) return;
    const host = hostName(d, this.app.state);
    const k = vendorKey(d);
    this.el.prompt.textContent = k === 'linux' ? `root@${host.toLowerCase()}:~#` : k === 'cisco' ? `${host}#` : `<${host}>`;
  }

  switchTab(tab) {
    this.tab = tab;
    document.querySelectorAll('.tb-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    for (const t of ['term', 'config', 'audit', 'tpl', 'diag']) {
      const p = document.getElementById(`tb-p-${t}`);
      if (p) p.hidden = t !== tab;
    }
    if (tab === 'term') setTimeout(() => this.el.input.focus(), 30);
    if (tab === 'config') this.renderConfig();
    if (tab === 'tpl') this.renderTemplates();
    if (tab === 'diag') this.renderDiag();
    if (tab === 'audit' && !this.audit) this.runAudit();
  }

  /* ----------------------------- terminal ----------------------------- */
  resetTerminal() {
    const d = this.currentDevice();
    this.el.out.innerHTML = '';
    if (!d) return;
    const v = vendor(d);
    const rack = this.app.state.racks.find((r) => r.id === d.rackId);
    this.print(`NEXUS NetDevOps Console 1.0 — multi-vendor CLI (simulated)`, 'dim');
    this.print(`正在连接 ${mgmtIp(d, this.app.state)}:22 ...... 成功`, 'dim');
    this.print(`${v.full} · ${d.model} · ${rack?.name || '—'} U${d.slot} · ${d.status === 'online' ? '在线' : '离线'}`, 'ok');
    this.print(`Last login: ${new Date(Date.now() - 86400000).toLocaleString('zh-CN', { hour12: false })} from 10.10.0.100`, 'dim');
    this.print('');
    this.print(v.family === 'linux' ? 'Ubuntu 22.04.4 LTS · 输入 help 查看命令' : `输入 help 查看 ${v.label} 常用命令`, 'dim');
    this.print('');
  }

  print(text, cls = 'out') {
    if (text === undefined || text === null) return;
    const frag = document.createDocumentFragment();
    for (const line of String(text).split('\n')) {
      const div = document.createElement('div');
      div.className = `tb-line ${cls}`;
      div.textContent = line.length ? line : ' ';
      frag.appendChild(div);
    }
    this.el.out.appendChild(frag);
    this.el.out.scrollTop = this.el.out.scrollHeight;
  }

  echo(line) {
    const p = this.el.prompt.textContent;
    const div = document.createElement('div');
    div.className = 'tb-line cmd';
    div.textContent = `${p} ${line}`;
    this.el.out.appendChild(div);
    this.el.out.scrollTop = this.el.out.scrollHeight;
  }

  run(line) {
    const d = this.currentDevice();
    if (!d) return;
    const text = line.trim();
    if (!text) return;
    this.echo(text);
    this.history.push(text);
    if (this.history.length > 80) this.history.shift();
    this.historyIdx = this.history.length;

    if (['exit', 'quit', 'logout'].includes(text.toLowerCase())) {
      this.print('Connection closed.', 'dim');
      setTimeout(() => this.close(), 400);
      return;
    }

    const res = runCli(this.app, d, text);
    if (res.clear) {
      this.el.out.innerHTML = '';
      return;
    }
    const err = res.lines.some((l) => /Unrecognized|Invalid input|not found|command not found|Error:/.test(l));
    for (const l of res.lines) this.print(l, err ? 'err' : 'out');
    this.print('');
  }

  /* ------------------------------ config ------------------------------ */
  renderConfig() {
    const d = this.currentDevice();
    if (!d) return;
    const text = buildConfig(this.app, d);
    this.currentConfig = text;
    const snapId = this.el.snapList.value;
    const snap = this.snapshots.find((s) => s.id === snapId);
    const meta = [];
    meta.push(`${text.split('\n').length} 行`);
    meta.push(vendor(d).full);
    if (snap) {
      const old = snap.configs[d.id];
      if (old) {
        const diff = diffLines(old.cfg, text);
        const plus = diff.filter((x) => x.t === '+').length;
        const minus = diff.filter((x) => x.t === '-').length;
        meta.push(`对比 ${new Date(snap.ts).toLocaleString('zh-CN')}：+${plus} / -${minus}`);
        this.el.cfg.innerHTML = diff.map((x) => `<span class="d-${x.t === ' ' ? 'same' : x.t === '+' ? 'add' : 'del'}">${x.t === ' ' ? ' ' : x.t} ${escapeHtml(x.text)}</span>`).join('\n');
        this.el.cfgMeta.textContent = meta.join(' · ');
        return;
      }
      meta.push('该快照中没有此设备');
    }
    this.el.cfg.textContent = text;
    this.el.cfgMeta.textContent = meta.join(' · ');
  }

  loadSnapshots() {
    try {
      const arr = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  saveSnapshots() {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify(this.snapshots.slice(0, MAX_SNAPS)));
    } catch { /* ignore quota */ }
  }

  refreshSnapList() {
    const opts = ['<option value="">与历史快照对比…</option>'];
    for (const s of this.snapshots) {
      const dt = new Date(s.ts).toLocaleString('zh-CN', { hour12: false });
      opts.push(`<option value="${s.id}">${dt} · ${Object.keys(s.configs).length} 台</option>`);
    }
    this.el.snapList.innerHTML = opts.join('');
  }

  snapshotAll() {
    const configs = {};
    for (const d of this.devices) configs[d.id] = { name: d.name, host: hostName(d, this.app.state), cfg: buildConfig(this.app, d) };
    const snap = { id: `snap_${Date.now()}`, ts: Date.now(), configs };
    this.snapshots.unshift(snap);
    this.snapshots = this.snapshots.slice(0, MAX_SNAPS);
    this.saveSnapshots();
    this.refreshSnapList();
    this.app.toast(`已备份 ${Object.keys(configs).length} 台设备配置`, 'ok');
  }

  /* ------------------------------ audit ------------------------------- */
  runAudit() {
    this.audit = auditAll(this.app);
    this.renderAudit();
  }

  renderAudit() {
    const a = this.audit;
    if (!a) return;
    const s = a.summary;
    this.el.auditSum.textContent = `${s.total} 台 · 平均 ${s.avg} 分 · 异常 ${s.fail}`;
    this.el.auditCards.innerHTML = [
      ['设备总数', s.total, ''],
      ['通过', s.pass, 'ok'],
      ['关注', s.warn, 'warn'],
      ['异常', s.fail, 'bad'],
      ['平均分', s.avg, s.avg > 85 ? 'ok' : 'warn'],
    ].map(([k, v, c]) => `<div class="tb-card ${c}"><label>${k}</label><b>${v}</b></div>`).join('');

    this.el.auditList.innerHTML = a.rows.map((r) => `
      <div class="tb-audit-row" data-dev="${r.devId}">
        <span class="tb-score ${r.status}">${r.score}</span>
        <div class="tb-audit-name">
          <b>${r.name}</b>
          <em>${r.host} · ${r.ip} · ${r.rack} · ${r.vendor}</em>
        </div>
        <span class="tb-audit-issue">${r.findings[0] ? r.findings[0].label : '运行正常'}</span>
        <span class="tb-pill ${r.status === 'pass' ? 'ok' : r.status === 'warn' ? 'warn' : 'bad'}">
          ${r.status === 'pass' ? '通过' : r.status === 'warn' ? '关注' : '异常'}
        </span>
        <button class="tb-btn tiny" data-locate="${r.devId}">定位</button>
      </div>`).join('');
  }

  exportReport() {
    if (!this.audit) this.runAudit();
    const text = buildReport(this.app, this.audit);
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nexusdc-audit-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.app.toast('巡检报告已导出', 'ok');
  }

  /* ----------------------------- templates ---------------------------- */
  renderTemplates() {
    const d = this.currentDevice();
    if (!d) return;
    const key = vendorKey(d);
    const lib = COMMAND_TEMPLATES[key] || COMMAND_TEMPLATES.common;
    const common = COMMAND_TEMPLATES.common;
    const cats = Object.keys(lib.commands);
    const all = { ...lib.commands, ...common.commands };
    const catNames = [...cats, ...Object.keys(common.commands).filter((c) => !cats.includes(c))];

    this.el.tpl.innerHTML = catNames.map((cat) => `
      <div class="tb-tpl-cat">
        <h5>${cat}</h5>
        <div class="tb-tpl-rows">
          ${(all[cat] || []).map((t) => `
            <button class="tb-tpl-row" data-cmd="${escapeAttr(t.cmd)}">
              <code>${escapeHtml(t.cmd)}</code>
              <span>${escapeHtml(t.desc)}</span>
              <i>▷</i>
            </button>`).join('')}
        </div>
      </div>`).join('');
  }

  /* ------------------------------ diagnosis --------------------------- */
  renderDiag() {
    const d = this.currentDevice();
    if (!d) return;
    if (this.diagAll) {
      this.renderDiagList();
      return;
    }
    const r = diagnose(this.app, d);
    this.el.diag.innerHTML = this.diagHtml(r);
  }

  diagHtml(r) {
    const sevClass = r.sev === 'ok' ? 'ok' : r.sev === 'critical' ? 'bad' : 'warn';
    return `
      <div class="tb-diag-head">
        <div class="tb-diag-score ${sevClass}"><b>${r.score}</b><span>${r.verdict}</span></div>
        <div class="tb-diag-title">
          <b>${r.title}</b>
          <span>${r.ip} · ${r.device.model} · ${vendor(r.device).full}</span>
        </div>
        <div class="tb-diag-peers">影响链路 ${r.peers.length} 条${r.alarms.length ? ` · 关联告警 ${r.alarms.length} 条` : ''}</div>
      </div>
      ${r.findings.map((f) => `
        <div class="tb-find ${f.sev}">
          <div class="tb-find-top">
            <span class="tb-pill ${f.sev === 'ok' ? 'ok' : f.sev === 'critical' ? 'bad' : 'warn'}">${f.sev === 'ok' ? '正常' : f.sev === 'critical' ? '严重' : f.sev === 'major' ? '重要' : '提示'}</span>
            <b>${f.title}</b>
          </div>
          <div class="tb-find-ev">${f.evidence}</div>
          <div class="tb-find-cause">可能原因：${f.cause}</div>
          ${f.actions?.length ? `<div class="tb-find-acts">${f.actions.map((a) => `<button class="tb-btn tiny" data-fix="${a.act}">${a.label}</button>`).join('')}</div>` : ''}
        </div>`).join('')}
      <div class="tb-diag-cmds">
        <h5>建议排查命令</h5>
        ${r.commands.map((c) => `<button class="tb-cmd-chip" data-run="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join('') || '<span class="tb-meta">—</span>'}
      </div>
      ${r.peers.length ? `<div class="tb-diag-cmds"><h5>邻居</h5>${r.peers.map((p) => `<span class="tb-neighbor">${p.name}<em>${p.port}</em></span>`).join('')}</div>` : ''}
    `;
  }

  renderDiagList() {
    const alarms = this.app.sim.alarmsList;
    const seen = new Set();
    const devs = [];
    for (const a of alarms) {
      if (a.targetType !== 'device' || seen.has(a.targetId)) continue;
      const d = this.app.state.devices[a.targetId];
      if (!d || !hasCli(d)) continue;
      seen.add(a.targetId);
      devs.push(d);
    }
    if (!devs.length) {
      this.el.diag.innerHTML = '<div class="tb-empty">当前没有设备级告警，整机运行平稳。</div>';
      return;
    }
    this.el.diag.innerHTML = `<div class="tb-diag-list">${devs.map((d) => this.diagHtml(diagnose(this.app, d))).join('')}</div>`;
  }

  /* ------------------------------ actions ----------------------------- */
  refreshCurrent() {
    const t = this.tab;
    if (t === 'term') { /* keep scrollback */ }
    if (t === 'diag') this.renderDiag();
    if (t === 'audit') { this.runAudit(); }
    if (t === 'config') this.renderConfig();
    this.renderDevices();
  }

  bind() {
    document.getElementById('tb-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });

    this.el.dev.addEventListener('change', () => this.setDevice(this.el.dev.value));

    document.querySelectorAll('.tb-nav button').forEach((b) => {
      b.addEventListener('click', () => this.switchTab(b.dataset.tab));
    });

    this.el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = this.el.input.value;
        this.el.input.value = '';
        this.run(v);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!this.history.length) return;
        this.historyIdx = Math.max(0, this.historyIdx - 1);
        this.el.input.value = this.history[this.historyIdx] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIdx = Math.min(this.history.length, this.historyIdx + 1);
        this.el.input.value = this.history[this.historyIdx] || '';
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        this.el.out.innerHTML = '';
      }
    });

    document.getElementById('tb-gen').addEventListener('click', () => this.renderConfig());
    document.getElementById('tb-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.currentConfig || '');
        this.app.toast('配置已复制到剪贴板', 'ok');
      } catch {
        this.app.toast('浏览器拒绝了剪贴板访问', 'warn');
      }
    });
    document.getElementById('tb-snap').addEventListener('click', () => this.snapshotAll());
    this.el.snapList.addEventListener('change', () => this.renderConfig());

    document.getElementById('tb-run-audit').addEventListener('click', () => this.runAudit());
    document.getElementById('tb-export').addEventListener('click', () => this.exportReport());
    this.el.auditList.addEventListener('click', (e) => {
      const row = e.target.closest('[data-dev]');
      if (!row) return;
      this.app.select({ type: 'device', id: row.dataset.dev });
      this.setDevice(row.dataset.dev);
    });
    this.el.auditList.addEventListener('click', (e) => {
      const loc = e.target.closest('[data-locate]');
      if (!loc) return;
      this.app.select({ type: 'device', id: loc.dataset.locate });
      this.app.focusTarget({ type: 'device', id: loc.dataset.locate });
    });

    this.el.tpl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cmd]');
      if (!b) return;
      const cmd = b.dataset.cmd;
      this.switchTab('term');
      this.el.input.value = '';
      this.run(cmd.replace(/<[^>]+>/g, '10.10.0.1'));
    });

    document.getElementById('tb-run-diag').addEventListener('click', () => {
      this.diagAll = false;
      this.renderDiag();
    });
    document.getElementById('tb-run-diag-all').addEventListener('click', () => {
      this.diagAll = true;
      this.renderDiagList();
    });

    this.el.diag.addEventListener('click', (e) => {
      const fix = e.target.closest('[data-fix]');
      if (fix) {
        const d = this.currentDevice();
        if (!d) return;
        const act = fix.dataset.fix;
        if (act === 'cool') {
          const rack = this.app.state.racks.find((r) => r.id === d.rackId);
          if (rack) this.app.coolRack(rack);
        } else {
          this.app.deviceAction(d, act);
        }
        this.app.toast('处置指令已下发', 'ok');
        this.refreshCurrent();
        return;
      }
      const run = e.target.closest('[data-run]');
      if (run) {
        const cmd = run.dataset.run;
        this.switchTab('term');
        this.run(cmd);
      }
    });

    // keep the snapshot dropdown in sync
    this.refreshSnapList();
  }
}

/* helpers */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, '&#96;');
}
