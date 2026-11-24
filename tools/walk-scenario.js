(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    const cam = __app.camera;
    const before = { x: cam.position.x, z: cam.position.z };
    __app.walk.enter();
    out.active = __app.walk.active;
    out.eye = Number(cam.position.y.toFixed(2));
    out.hud = document.getElementById('walk-hud').classList.contains('on');
    out.lamp = __app.walk.lamp.visible;

    // walk forward into the A row: collision should stop before the rack
    cam.position.set(0, 1.62, 0);
    __app.walk.yaw = 0;
    __app.walk.pitch = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await sleep(1400);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    out.walkZ = Number(cam.position.z.toFixed(2));
    out.collision = out.walkZ > -0.72;

    // crosshair pick: aim at a rack front
    cam.position.set(-0.31, 1.62, 0.35);
    __app.walk.yaw = 0;
    __app.walk.pitch = -0.45;
    await sleep(200);
    cam.updateMatrixWorld();
    const hit = __app.pickAtCenter();
    out.pickRack = !!(hit && hit.rack);
    out.pickDevice = (hit && hit.device) || null;

    __app.walk.exit();
    out.exitRestored = Math.abs(cam.position.x - before.x) < 0.01 && Math.abs(cam.position.z - before.z) < 0.01;
    out.lampOff = !__app.walk.lamp.visible;
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
