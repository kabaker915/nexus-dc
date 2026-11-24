(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { ok: true, errors: [] };
  const canvas = document.querySelector('#stage canvas:not(#flat)');
  const rect = canvas.getBoundingClientRect();

  const click = (x, y) => {
    const o = { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    canvas.dispatchEvent(new PointerEvent('pointerdown', o));
    canvas.dispatchEvent(new PointerEvent('pointerup', o));
  };
  const project = (v) => {
    const p = v.clone().project(__app.camera);
    return { x: rect.left + (p.x * 0.5 + 0.5) * rect.width, y: rect.top + (-p.y * 0.5 + 0.5) * rect.height };
  };
  const worldPoint = (x, y, z) => __app.camera.position.clone().set(x, y, z);

  try {
    // ---- 1. place a new rack on the floor --------------------------------
    out.racksBefore = __app.state.racks.length;
    __app.placeKind('rack');
    const empty = project(worldPoint(4.2, 0.02, -3.2));
    out.emptySpot = { x: Math.round(empty.x), y: Math.round(empty.y) };
    click(empty.x, empty.y);
    await sleep(300);
    out.racksAfterPlace = __app.state.racks.length;
    out.modeAfterPlace = __app.state.mode;

    // ---- 2. install a switch into rack A01 ------------------------------
    const rack = __app.state.racks[0];
    const front = worldPoint(0, 1.0, 0.55).applyMatrix4(rack.group.matrixWorld);
    const sp = project(front);
    __app.placeKind('switch48');
    click(sp.x, sp.y);
    await sleep(300);
    out.modeAfterInstall = __app.state.mode;
    out.a01Devices = __app.state.racks[0].devices.length;

    // ---- 3. patch a cable between two free ports ------------------------
    const devs = Object.values(__app.state.devices).filter((d) => d.rackId === rack.id);
    const a = devs.find((d) => d.kind === 'switch48' && d.ports.filter((p) => !p.cable).length > 1);
    const b = devs.find((d) => d !== a && d.ports.filter((p) => !p.cable).length > 1);
    out.cablePair = a && b ? `${a.name}/${b.name}` : 'none';
    if (a && b) {
      const pa = a.ports.find((p) => !p.cable);
      const pb = b.ports.find((p) => !p.cable);
      const wa = project(a.group.localToWorld(worldPoint(pa.x, pa.y, 0.02)));
      const wb = project(b.group.localToWorld(worldPoint(pb.x, pb.y, 0.02)));
      out.wa = { x: Math.round(wa.x), y: Math.round(wa.y) };
      out.wb = { x: Math.round(wb.x), y: Math.round(wb.y) };
      __app.setMode('cable');
      click(wa.x, wa.y);
      await sleep(150);
      out.pending1 = __app.state.pendingCable ? 'yes' : 'no';
      out.toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent).slice(-2);
      click(wb.x, wb.y);
      await sleep(250);
      out.cablesAfter = Object.keys(__app.state.cables).length;
      out.pendingCable = !!__app.state.pendingCable;
    }

    // ---- 4. ops: power loss -> alarm ------------------------------------
    __app.setMode('inspect');
    const victim = devs[devs.length - 1];
    __app.select({ type: 'device', id: victim.id });
    __app.deviceAction(victim, 'powerOff');
    await sleep(1300);
    out.alarmsAfterPowerOff = __app.sim.alarms.size;
    out.victimStatus = victim.status;
    out.insPortCells = document.querySelectorAll('#ins-body .port-cell').length;

    // alarm tab renders
    document.querySelector('#panel-tabs [data-tab="alarms"]').click();
    await sleep(200);
    out.alarmCards = document.querySelectorAll('#alarm-list .alarm').length;

    // acknowledge + repair
    __app.ackAll();
    __app.deviceAction(victim, 'powerOn');
    await sleep(1200);
    out.alarmsAfterRepair = __app.sim.alarms.size;
    out.victimStatusAfter = victim.status;

    // ---- 5. fault injection: fan failure on a server --------------------
    const srv = Object.values(__app.state.devices).find((d) => d.kind === 'server1u');
    __app.select({ type: 'device', id: srv.id });
    __app.inject(srv, 'fan');
    await sleep(1300);
    out.fanAlarm = __app.sim.alarms.has(`dev-${srv.id}`);
    __app.deviceAction(srv, 'repair');
    await sleep(300);

    // ---- 6. persistence --------------------------------------------------
    __app.save();
    const raw = localStorage.getItem('nexusdc.layout.v2');
    out.savedBytes = raw ? raw.length : 0;
    out.savedRacks = JSON.parse(raw || '{}').racks?.length || 0;
    out.rackCountLive = __app.state.racks.length;

    // ---- 7. dashboard numbers -------------------------------------------
    out.stats = {
      devices: __app.sim.stats.devices,
      throughput: Math.round(__app.sim.stats.throughput * 10) / 10,
      power: Math.round(__app.sim.stats.power * 100) / 100,
      health: Math.round(__app.sim.stats.health),
      alarms: __app.sim.stats.alarms,
    };
    out.historyLen = __app.sim.history.thr.length;

    // leave the browser clean for the next visual capture
    localStorage.removeItem('nexusdc.layout.v2');
  } catch (err) {
    out.ok = false;
    out.errors.push(String(err && err.stack ? err.stack : err));
  }
  return out;
})()
