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

    // no invisible walls: walk through the open aisle end door
    cam.position.set(0, 1.62, 0);
    __app.walk.yaw = -Math.PI / 2;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await sleep(1600);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    out.airX = Number(cam.position.x.toFixed(2));
    out.pastContainment = cam.position.x > 2.2;

    // and reach close to the real back/front wall
    cam.position.set(-3, 1.62, 0);
    __app.walk.yaw = Math.PI;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    await sleep(1600);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    out.airZ = Number(cam.position.z.toFixed(2));
    out.reachWall = cam.position.z > 4.5;

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
