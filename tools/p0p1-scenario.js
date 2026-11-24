(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  const snapshot = JSON.stringify(__app.serialize());

  try {
    // ---------- 1. undo / redo ----------
    const rack = __app.state.racks[0];
    const before = rack.devices.length;
    const free = __app.findFreeSlotIn(rack, 1);
    __app.addDeviceAt(rack, 'server1u', free);
    out.added = __app.state.racks.find((r) => r.id === rack.id).devices.length === before + 1;

    __app.history.undo();
    await sleep(250);
    out.undoWorks = __app.state.racks.find((r) => r.id === rack.id).devices.length === before;

    __app.history.redo();
    await sleep(250);
    out.redoWorks = __app.state.racks.find((r) => r.id === rack.id).devices.length === before + 1;
    __app.history.undo();
    await sleep(250);

    // ---------- 2. multi select + batch ----------
    const devs = Object.values(__app.state.devices);
    const a = devs[0];
    const b = devs.find((d) => d.id !== a.id && d.adminPower);
    __app.select({ type: 'device', id: a.id });
    __app.select({ type: 'device', id: b.id }, { add: true });
    out.selCount = __app.state.selectionSet.length;
    out.batchButtons = document.querySelectorAll('[data-batch]').length;
    __app.batch('powerOff');
    await sleep(200);
    out.batchOff = !a.adminPower && !b.adminPower;
    __app.batch('powerOn');
    await sleep(200);
    out.batchOn = a.adminPower && b.adminPower;
    __app.select(null);

    // ---------- 3. rack front editor ----------
    const r0 = __app.state.racks[0];
    const n0 = r0.devices.length;
    __app.openFront(r0.id);
    await sleep(250);
    out.feOpen = !document.getElementById('fe-overlay').hidden;
    out.feBlocks = document.querySelectorAll('.fe-dev').length;
    const addBtn = document.querySelector('.fe-add[data-kind="switch24"]');
    addBtn?.click();
    await sleep(250);
    out.feAdded = __app.state.racks.find((r) => r.id === r0.id).devices.length === n0 + 1;
    document.getElementById('fe-close').click();

    // ---------- 4. templates + apply ----------
    const src = __app.state.racks.find((r) => (r.devices || []).length > 2);
    __app.templates.open(src.id);
    document.getElementById('tpl-name').value = '自动化测试模板';
    document.getElementById('tpl-save').click();
    await sleep(200);
    out.tplSaved = __app.templates.list.some((t) => t.name === '自动化测试模板');
    const target = __app.state.racks.find((r) => r.id !== src.id);
    __app.templates.el.target.value = target.id;
    document.querySelector('[data-apply]')?.click();
    await sleep(300);
    out.tplApplied = __app.state.racks.find((r) => r.id === target.id).devices.length > 0;
    document.getElementById('tpl-close').click();

    // ---------- 5. cabling assistant ----------
    __app.openCabling();
    await sleep(350);
    out.cabRows = document.querySelectorAll('.cab-row:not(.head)').length;
    const beforeCables = Object.keys(__app.state.cables).length;
    document.getElementById('cab-connect')?.click();
    await sleep(350);
    out.cablesAdded = Object.keys(__app.state.cables).length - beforeCables;
    document.getElementById('cab-close').click();

    // ---------- 6. performance preset ----------
    __app.openSettings();
    const low = document.querySelector('input[name="perf"][value="low"]');
    low.checked = true;
    low.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    out.perf = __app.state.perf;
    out.perfStored = JSON.parse(localStorage.getItem('nexusdc.settings.v1') || '{}').perf;
    const high = document.querySelector('input[name="perf"][value="high"]');
    high.checked = true;
    high.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('set-close').click();

    // ---------- 7. alarm persistence + notify validation ----------
    const victim = Object.values(__app.state.devices).find((d) => d.kind === 'server1u');
    __app.inject(victim, 'fan');
    await sleep(1200);
    out.alarmPersisted = !!localStorage.getItem('nexusdc.alarms.v1');
    __app.deviceAction(victim, 'repair');

    const bad = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'ftp://x', payload: {} }) }).then((r) => r.json());
    out.notifyValidates = bad.ok === false;

    // ---------- 8. restore original layout & cleanup ----------
    __app.loadLayout(JSON.parse(snapshot));
    localStorage.removeItem('nexusdc.templates.v1');
    __app.templates.list = [];
    __app.persistLayout();
    __app.select(null);
    out.restored = __app.state.racks.length === 12;
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
