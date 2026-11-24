(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    const dev = Object.values(__app.state.devices).find((d) => d.kind === 'switch48');
    __app.select({ type: 'device', id: dev.id });
    __app.openToolbox(dev.id, 'term');
    await sleep(300);

    out.opened = !document.getElementById('tb-overlay').hidden;
    out.device = document.getElementById('tb-dev').value === dev.id;
    out.vendorPill = document.getElementById('tb-vendor').textContent;
    out.banner = document.getElementById('tb-out').textContent.slice(0, 60);

    const input = document.getElementById('tb-input');
    const type = async (cmd) => {
      input.value = cmd;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(80);
    };
    await type('display version');
    await type('display interface brief');
    await type('display ip routing-table');
    await type('display environment');
    const termText = document.getElementById('tb-out').textContent;
    out.hasVersion = /Comware|VRP|IOS|Linux/.test(termText);
    out.hasInterface = termText.includes('GE1/0/1');
    out.termChars = termText.length;

    // config tab
    document.querySelector('.tb-nav [data-tab="config"]').click();
    await sleep(200);
    const cfg = document.getElementById('tb-cfg').textContent;
    out.cfgHasHostname = /sysname|hostname/.test(cfg);
    out.cfgHasIf = cfg.includes('GigabitEthernet1/0/1');
    out.cfgLines = cfg.split('\n').length;
    out.cfgMeta = document.getElementById('tb-cfg-meta').textContent;

    // snapshot + diff
    document.getElementById('tb-snap').click();
    await sleep(150);
    out.snapshots = JSON.parse(localStorage.getItem('nexusdc.netdevops.snapshots.v1') || '[]').length;
    out.snapOptions = document.getElementById('tb-snap-list').options.length;

    // audit
    document.querySelector('.tb-nav [data-tab="audit"]').click();
    await sleep(400);
    out.auditRows = document.querySelectorAll('.tb-audit-row').length;
    out.auditCards = document.querySelectorAll('.tb-card').length;

    // templates
    document.querySelector('.tb-nav [data-tab="tpl"]').click();
    await sleep(200);
    out.templateRows = document.querySelectorAll('.tb-tpl-row').length;
    const tplBtn = document.querySelector('.tb-tpl-row');
    out.tplCmd = tplBtn?.dataset.cmd;
    tplBtn?.click();
    await sleep(200);
    out.afterTplTab = document.querySelector('.tb-nav button.on')?.dataset.tab;
    out.termAfterTpl = document.getElementById('tb-out').textContent.length > termText.length;

    // diagnosis
    document.querySelector('.tb-nav [data-tab="diag"]').click();
    await sleep(300);
    out.diagFindings = document.querySelectorAll('.tb-find').length;
    out.diagScore = document.querySelector('.tb-diag-score b')?.textContent;

    // inject a fault then diagnose again
    __app.inject(dev, 'fan');
    await sleep(1300);
    document.querySelector('[data-tab="diag"]').click();
    await sleep(300);
    out.diagAfterFault = document.querySelectorAll('.tb-find.critical').length;
    __app.deviceAction(dev, 'repair');
    await sleep(300);

    // switch device via select
    const other = Object.values(__app.state.devices).find((d) => d.kind === 'router');
    __app.select({ type: 'device', id: other.id });
    await sleep(300);
    out.deviceSwitched = document.getElementById('tb-dev').value === other.id;

    document.getElementById('tb-close').click();
    out.closed = document.getElementById('tb-overlay').hidden;
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
