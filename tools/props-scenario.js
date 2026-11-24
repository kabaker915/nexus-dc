(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    out.groups = Object.keys(__app.props.groups);
    __app.camera.position.set(0, 1.7, 0);
    __app.props.setCamera(__app.camera);
    out.ceilingLow = __app.props.groups.ceiling.visible;
    __app.camera.position.y = 8;
    __app.props.setCamera(__app.camera);
    out.ceilingHighHidden = !__app.props.groups.ceiling.visible;

    out.nocScreen = !!__app.props.ctx.dash;
    out.screenMap = !!__app.props.ctx.videoScreen?.material?.map;

    __app.camera.position.set(-4.6, 1.88, 0);
    __app.props.setCamera(__app.camera);
    __app.walk.enter();
    out.walkObstacles = __app.walk.boxes.length;
    out.powerBlocked = !__app.walk.walkable(-6.0, 0);
    await sleep(2200);
    out.dashUpdated = __app.props.lastDash > 0;
    __app.walk.exit();
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
