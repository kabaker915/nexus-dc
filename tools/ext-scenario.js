(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  const cv = document.getElementById('flat');
  const clickAt = (x, y) => {
    const r = cv.getBoundingClientRect();
    const o = { clientX: r.left + x, clientY: r.top + y, button: 0, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' };
    cv.dispatchEvent(new PointerEvent('pointerdown', o));
    cv.dispatchEvent(new PointerEvent('pointerup', o));
  };

  try {
    __app.setView('2d');
    __app.flat.setMode('topo');
    await sleep(600);
    out.extCount = (__app.state.ext || []).length;
    out.extHits = __app.flat.hits.filter((h) => h.type === 'ext').length;

    // click the first external node
    const extHit = __app.flat.hits.find((h) => h.type === 'ext');
    clickAt(extHit.x + extHit.w / 2, extHit.y + extHit.h / 2);
    await sleep(300);
    out.profileOpen = !document.getElementById('ext-overlay').hidden;
    out.profileName = document.getElementById('f-name').value;
    out.profileHost = document.getElementById('f-host').value;

    // edit + save
    document.getElementById('f-host').value = '192.168.50.1';
    document.getElementById('f-port').value = '22';
    document.getElementById('f-save').click();
    await sleep(200);
    const ext = __app.state.ext.find((e) => e.name === out.profileName);
    out.savedHost = ext.host;

    // simulated dispatch
    document.getElementById('f-dispatch').click();
    await sleep(200);
    document.getElementById('ext-cmds').value = 'display version\ndisplay interface brief';
    document.getElementById('ext-run').click();
    await sleep(900);
    const res = document.querySelectorAll('.ext-res');
    out.resCards = res.length;
    out.resOut = res[0]?.querySelector('.ext-res-out')?.textContent.slice(0, 80) || '';
    out.extStatus = ext.status;

    // real dispatch to a closed port → gateway error surfaced in UI
    const realEl = document.getElementById('ext-real');
    realEl.checked = true;
    realEl.dispatchEvent(new Event('change'));
    document.getElementById('ext-ack').checked = true;
    ext.host = '127.0.0.1';
    ext.port = 2222;
    document.getElementById('ext-cmds').value = 'display version';
    document.getElementById('ext-run').click();
    await sleep(4200);
    out.realOut = document.querySelector('.ext-res-out')?.textContent.includes('refused') ? 'refused' : 'other';
    out.realStatus = ext.status;

    // add a firewall via API, wire it to a rack device
    const fw = __app.addExt('firewall');
    await sleep(250);
    out.afterAdd = __app.state.ext.length;
    const target = Object.values(__app.state.devices).find((d) => d.kind === 'router');
    document.getElementById('f-uplink').value = target.id;
    document.getElementById('f-save').click();
    await sleep(200);
    out.uplinkSet = __app.state.ext.find((e) => e.id === fw.id).uplink === target.id;

    document.getElementById('ext-close').click();
    out.closed = document.getElementById('ext-overlay').hidden;

    // drag an external node (should move, not open the profile)
    const node = __app.flat.hits.find((h) => h.type === 'ext');
    const exObj = __app.state.ext.find((e) => e.id === node.id);
    const before = exObj.x;
    const rect = cv.getBoundingClientRect();
    const pe = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, {
      clientX: rect.left + x, clientY: rect.top + y, button: 0, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse',
    }));
    pe('pointerdown', node.x + node.w / 2, node.y + node.h / 2);
    pe('pointermove', node.x + node.w / 2 + 50, node.y + node.h / 2 + 10);
    pe('pointerup', node.x + node.w / 2 + 50, node.y + node.h / 2 + 10);
    await sleep(200);
    out.dragMoved = Math.abs(exObj.x - before) > 10;
    out.profileAfterDrag = !document.getElementById('ext-overlay').hidden;

    __app.save();
    const saved = JSON.parse(localStorage.getItem('nexusdc.layout.v2') || '{}');
    out.savedExt = (saved.ext || []).length;
    out.view = __app.view;
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
