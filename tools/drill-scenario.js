(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  try {
    const devs = Object.values(__app.state.devices);
    const srv = devs.filter((d) => d.kind === 'server1u');
    const stor = devs.find((d) => d.kind === 'storage4u');
    const sw = devs.find((d) => d.kind === 'switch48' && d.slot > 30);

    __app.select({ type: 'device', id: sw.id });
    __app.inject(sw, 'loss');
    __app.select({ type: 'device', id: srv[0].id });
    __app.inject(srv[0], 'fan');
    __app.select({ type: 'device', id: srv[1].id });
    __app.inject(srv[1], 'overheat');
    await sleep(1600);

    // acknowledge one alarm to show the acked state
    const first = [...__app.sim.alarms.values()][0];
    if (first) __app.ackAlarm(first.id);

    // open the doors of the first rack as an ops action
    __app.toggleDoor(__app.state.racks[0]);

    document.querySelector('#panel-tabs [data-tab="alarms"]').click();
    await sleep(400);

    out.alarms = __app.sim.alarms.size;
    out.alarmCards = document.querySelectorAll('#alarm-list .alarm').length;
    out.severe = __app.sim.stats.critical;
    out.acked = [...document.querySelectorAll('#alarm-list .alarm')].filter((n) => n.textContent.includes('已确认')).length;
    out.stats = __app.sim.stats;
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  }
  return out;
})()
