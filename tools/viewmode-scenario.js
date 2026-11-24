(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    const cam = __app.camera;
    const before = { x: cam.position.x, y: cam.position.y, z: cam.position.z };

    // 2D → 3D must stay in third-person inspection
    __app.setView('2d');
    out.in2d = __app.view === '2d';
    out.walkAfter2d = __app.walk.active;
    __app.setView('3d');
    out.back3d = __app.view === '3d';
    out.controls3d = __app.controls.enabled;
    out.camY3d = Number(cam.position.y.toFixed(2));

    // enter patrol, then switch to 2D from the top bar
    __app.walk.enter();
    await sleep(300);
    out.walkEntered = __app.walk.active;
    out.hudOn = document.getElementById('walk-hud').classList.contains('on');
    out.eye = Number(cam.position.y.toFixed(2));

    __app.setView('2d');
    await sleep(300);
    out.exitedOn2d = !__app.walk.active;
    out.hudOff = !document.getElementById('walk-hud').classList.contains('on');
    out.controls2d = __app.controls.enabled;
    out.restoredY = Number(cam.position.y.toFixed(2));

    __app.setView('3d');
    await sleep(300);
    out.controlsBack = __app.controls.enabled;
    out.walkStillOff = !__app.walk.active;
    out.finalY = Number(cam.position.y.toFixed(2));
    out.restored =
      Math.abs(cam.position.x - before.x) < 0.01 &&
      Math.abs(cam.position.y - before.y) < 0.01 &&
      Math.abs(cam.position.z - before.z) < 0.01;

    // entering patrol from 2D should switch to 3D and still be first-person
    __app.setView('2d');
    __app.walk.enter();
    await sleep(300);
    out.from2dView = __app.view;
    out.from2dWalk = __app.walk.active;
    out.from2dEye = Number(cam.position.y.toFixed(2));
    __app.walk.exit();
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
