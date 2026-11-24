(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    await sleep(900);
    out.batches = __app.cableSys.batchMeshes.length;
    out.connectors = !!__app.cableSys.connMesh;
    out.entries = __app.cableSys.entries.size;

    // pick a cable at its curve midpoint
    const first = [...__app.cableSys.entries.values()][0];
    const p = first.curve.getPoint(0.5).project(__app.camera);
    const cv = document.querySelector('#stage canvas:not(#flat)');
    const r = cv.getBoundingClientRect();
    const o = {
      clientX: r.left + (p.x * 0.5 + 0.5) * r.width,
      clientY: r.top + (-p.y * 0.5 + 0.5) * r.height,
      button: 0, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
    };
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    cv.dispatchEvent(new PointerEvent('pointerup', o));
    await sleep(300);
    out.picked = __app.state.selection?.type;
    out.selectedId = __app.state.selection?.id;
    out.highlight = !!__app.cableSys.hiMesh;

    // perf HUD draw calls
    __app.openSettings();
    const hud = document.getElementById('set-hud');
    hud.checked = true;
    hud.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('set-close').click();
    await sleep(900);
    out.hud = document.getElementById('perf-hud').textContent;
    const m = /(\d+) calls/.exec(out.hud);
    out.calls = m ? Number(m[1]) : null;

    // cleanup
    __app.select(null);
    hud.checked = false;
    hud.dispatchEvent(new Event('change', { bubbles: true }));
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
