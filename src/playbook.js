/**
 * Multi-step drill playbooks: a scripted incident with timeline and recovery.
 */
const TPL = `
<div class="pb-overlay" id="pb-overlay" hidden>
  <div class="pb-window">
    <header class="pb-head">
      <div><b>演练剧本</b><small>按时间轴注入故障 → 观察告警 → 自动恢复</small></div>
      <button class="pb-close" id="pb-close">✕</button>
    </header>
    <div class="pb-body">
      <div class="pb-list" id="pb-list"></div>
      <div class="pb-run" id="pb-run" hidden>
        <div class="pb-run-head">
          <b id="pb-title">—</b>
          <span id="pb-state" class="tb-meta"></span>
          <button class="tb-btn tiny ghost" id="pb-stop">中止</button>
        </div>
        <div class="pb-steps" id="pb-steps"></div>
      </div>
    </div>
  </div>
</div>
`;

export class Playbook {
  constructor(app) {
    this.app = app;
    document.body.insertAdjacentHTML('beforeend', TPL);
    this.root = document.getElementById('pb-overlay');
    this.el = {
      list: document.getElementById('pb-list'),
      run: document.getElementById('pb-run'),
      title: document.getElementById('pb-title'),
      state: document.getElementById('pb-state'),
      steps: document.getElementById('pb-steps'),
    };
    this.timers = [];
    this.running = null;
    this.bind();
    this.renderList();
  }

  scenarios() {
    const app = this.app;
    const pickServers = () => Object.values(app.state.devices).filter((d) => d.kind === 'server1u').slice(0, 2);
    const pickCore = () => Object.values(app.state.devices).find((d) => d.kind === 'switch48' && d.slot > 30);
    return [
      {
        id: 'power',
        name: '市电中断 · UPS 接管',
        desc: '两台业务服务器断电，观察告警与恢复',
        steps: [
          { t: 0, text: '市电中断，A 区服务器掉电', run: () => pickServers().forEach((d) => app.inject(d, 'power')) },
          { t: 2500, text: 'UPS 电池接管，等待现场合闸' },
          { t: 5500, text: '市电恢复，服务器重新上电', run: () => pickServers().forEach((d) => app.deviceAction(d, 'powerOn')) },
          { t: 8000, text: '服务自检完成，告警自动恢复' },
        ],
      },
      {
        id: 'cooling',
        name: '制冷失效 · 温度飙升',
        desc: '机柜失去制冷，两台服务器过热后应急制冷',
        steps: [
          { t: 0, text: 'CRAC 停机，机柜开始升温', run: () => {
            const rack = app.state.racks.find((r) => (r.devices || []).length);
            if (rack) app.coolRack(rack);
            pickServers().forEach((d) => app.inject(d, 'overheat'));
          } },
          { t: 3000, text: '温度越限，产生重要告警' },
          { t: 6000, text: '启动应急制冷并修复服务器', run: () => {
            const rack = app.state.racks.find((r) => (r.devices || []).length);
            if (rack) app.coolRack(rack);
            pickServers().forEach((d) => app.deviceAction(d, 'repair'));
          } },
          { t: 9000, text: '温度回落，演练结束' },
        ],
      },
      {
        id: 'uplink',
        name: '核心上联中断',
        desc: '核心交换机链路丢包，验证告警与恢复',
        steps: [
          { t: 0, text: '核心交换机上联出现 CRC/丢包', run: () => {
            const sw = pickCore();
            if (sw) app.inject(sw, 'loss');
          } },
          { t: 3500, text: '端口错误告警触发，检查光模块' },
          { t: 6500, text: '更换光模块，端口恢复', run: () => {
            const sw = pickCore();
            if (sw) app.deviceAction(sw, 'repair');
          } },
          { t: 9000, text: '链路恢复，告警清除' },
        ],
      },
    ];
  }

  renderList() {
    this.el.list.innerHTML = this.scenarios().map((s) => `
      <button class="pb-card" data-start="${s.id}">
        <b>${s.name}</b><em>${s.desc}</em>
        <span>约 ${Math.round(s.steps[s.steps.length - 1].t / 1000)}s · ${s.steps.length} 步</span>
      </button>`).join('');
  }

  open() {
    this.root.hidden = false;
    this.renderList();
  }

  close() {
    this.stop(true);
    this.root.hidden = true;
  }

  start(id) {
    const sc = this.scenarios().find((s) => s.id === id);
    if (!sc) return;
    this.stop(true);
    this.running = sc;
    this.el.run.hidden = false;
    this.el.title.textContent = sc.name;
    this.el.state.textContent = '运行中…';
    this.el.steps.innerHTML = sc.steps.map((s, i) => `
      <div class="pb-step" data-step="${i}">
        <time>${(s.t / 1000).toFixed(1)}s</time>
        <span>${s.text}</span>
        <i>等待</i>
      </div>`).join('');
    this.app.sim.log('info', `演练开始：${sc.name}`);
    this.app.toast(`演练开始：${sc.name}`, 'ok');

    for (const [i, step] of sc.steps.entries()) {
      this.timers.push(setTimeout(() => {
        try { step.run?.(); } catch (e) { this.app.sim.log('warn', `演练步骤失败：${e.message}`); }
        const row = this.el.steps.querySelector(`[data-step="${i}"]`);
        if (row) {
          row.classList.add('done');
          row.querySelector('i').textContent = '完成';
        }
        this.app.sim.log('info', `演练：${step.text}`);
        if (i === sc.steps.length - 1) {
          this.el.state.textContent = '已完成';
          this.app.sim.log('ok', `演练结束：${sc.name}`);
        }
      }, step.t));
    }
  }

  stop(silent = false) {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    if (this.running && !silent) {
      this.el.state.textContent = '已中止';
      this.app.sim.log('warn', `演练中止：${this.running.name}`);
    }
    this.running = null;
  }

  bind() {
    document.getElementById('pb-close').addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (e) => { if (e.target === this.root) this.close(); });
    document.getElementById('pb-stop').addEventListener('click', () => this.stop());
    this.el.list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-start]');
      if (b) this.start(b.dataset.start);
    });
  }
}
