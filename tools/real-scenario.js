(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    __app.setDataMode('real');
    await sleep(500);
    out.overlayOpen = !document.getElementById('real-overlay').hidden;
    out.bodyClass = document.body.classList.contains('real-mode');
    out.mode = __app.state.dataMode;

    // scan loopback where the web server listens
    document.getElementById('real-cidr').value = '127.0.0.1/32';
    document.getElementById('real-port').value = '5199';
    document.getElementById('real-scan').click();
    await sleep(1200);
    out.hostChips = document.querySelectorAll('.real-host').length;
    out.scanStatus = document.getElementById('real-scan-status').textContent;

    // adopt → probe fails (not an SSH device) but the flow completes
    document.querySelector('[data-adopt]').click();
    await sleep(3500);
    out.realDevices = __app.state.real.length;
    out.status = __app.state.real[0]?.status;
    out.hasError = !!__app.state.real[0]?.error;
    out.error = __app.state.real[0]?.error || '';
    out.lastAt = __app.state.real[0]?.lastAt || 0;
    out.extCreated = (__app.state.ext || []).some((e) => e.realId === __app.state.real[0]?.id);

    // bind to a model device
    const dev = __app.state.real[0];
    const model = Object.values(__app.state.devices).find((d) => d.kind === 'switch48');
    const sel = document.querySelector(`[data-bind="${dev.id}"]`);
    sel.value = model.id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    out.bound = dev.boundDeviceId === model.id;

    // switch back to simulation: overlay cleared
    __app.setDataMode('sim');
    await sleep(300);
    out.modeBack = __app.state.dataMode;
    out.bodyClassAfter = document.body.classList.contains('real-mode');
    out.modelSource = model.realSource || null;

    // cleanup so the demo is not polluted
    __app.real.remove(dev);
    localStorage.removeItem('nexusdc.real.v1');
    __app.save();
    document.getElementById('real-close').click();
    out.closed = document.getElementById('real-overlay').hidden;
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
