(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const cv = document.getElementById('flat');
  const clickAt = (x, y) => {
    const r = cv.getBoundingClientRect();
    const o = {
      clientX: r.left + x, clientY: r.top + y, button: 0, bubbles: true,
      pointerId: 1, isPrimary: true, pointerType: 'mouse',
    };
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    cv.dispatchEvent(new PointerEvent('pointerup', o));
  };

  try {
    __app.setView('2d');
    await sleep(700);
    out.visible = !cv.hidden;
    out.hits = __app.flat.hits.length;
    out.planRacks = __app.flat.hits.filter((h) => h.type === 'rack').length;

    const rackHit = __app.flat.hits.find((h) => h.type === 'rack');
    clickAt(rackHit.x + rackHit.w / 2, rackHit.y + rackHit.h / 2);
    await sleep(350);
    out.selAfterRack = __app.state.selection?.type;
    out.insVisible = !document.getElementById('view-inspector').hidden;
    out.insTitle = document.getElementById('ins-title').textContent;

    __app.flat.setMode('topo');
    await sleep(700);
    out.topoNodes = __app.flat.hits.filter((h) => h.type === 'node').length;
    out.topoLinks = __app.flat.hits.filter((h) => h.type === 'link').length;

    const node = __app.flat.hits.find((h) => h.type === 'node');
    clickAt(node.x + node.w / 2, node.y + node.h / 2);
    await sleep(350);
    out.selAfterNode = __app.state.selection?.type;
    out.nodeInsTitle = document.getElementById('ins-title').textContent;

    const dev = __app.state.devices[__app.state.selection.id];
    out.device = dev.name;
    __app.inject(dev, 'power');
    await sleep(1400);
    out.alarms = __app.sim.alarms.size;
    out.badge = document.getElementById('alarm-badge').textContent;
    out.insActions = document.querySelectorAll('#ins-actions button').length;

    // ops from the 2D inspector: repair
    __app.deviceAction(dev, 'powerOn');
    await sleep(600);
    out.alarmsAfterRepair = __app.sim.alarms.size;

    // back to 3D
    __app.setView('3d');
    await sleep(400);
    out.backTo3d = __app.view;
    out.flatHidden = cv.hidden;
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
