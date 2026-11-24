(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { errors: [] };
  try {
    // playbook
    __app.openPlaybook();
    await sleep(200);
    out.pbOpen = !document.getElementById('pb-overlay').hidden;
    out.pbCards = document.querySelectorAll('.pb-card').length;
    document.querySelector('.pb-card').click();
    await sleep(1200);
    out.pbSteps = document.querySelectorAll('.pb-step').length;
    out.pbDone = document.querySelectorAll('.pb-step.done').length;
    __app.playbook.stop();
    __app.playbook.close();
    out.pbClosed = document.getElementById('pb-overlay').hidden;

    // work orders
    const dev = Object.values(__app.state.devices)[0];
    const wo = __app.createWorkOrder({ title: '测试工单', deviceId: dev.id, level: 'P1', source: 'test' });
    out.woCount = __app.workorders.list.length;
    __app.ui.switchTab('orders');
    await sleep(200);
    out.woRows = document.querySelectorAll('.order').length;
    out.woBadge = document.getElementById('order-badge').textContent;
    document.querySelector('[data-order-status="doing"]')?.click();
    await sleep(150);
    out.woStatus = __app.workorders.list.find((o) => o.id === wo.id)?.status;
    __app.workorders.remove(wo.id);
    __app.ui.switchTab('dash');

    // capacity + day chart
    __app.analytics.push();
    await sleep(300);
    out.samples = __app.analytics.samples.length;
    out.capacityText = document.getElementById('capacity').textContent.slice(0, 40);
    out.dayMeta = document.getElementById('c-day').textContent;

    // thermal + shafts
    __app.toggleHeat(true);
    await sleep(300);
    out.heat = __app.thermal.group.visible;
    out.heatBoxes = __app.thermal.boxes.size;
    __app.toggleHeat(false);
    __app.toggleShafts(true);
    out.shafts = __app.thermal.shafts.visible;
    __app.toggleShafts(false);

    // report (string only, window.open may be blocked)
    out.reportLen = __app.analytics.reportHtml().length;
    out.reportHasRacks = __app.analytics.reportHtml().includes('机柜');

    // LLDP topology
    const dc = Object.values(__app.state.devices).find((d) => d.kind === 'switch48');
    const r1 = {
      id: 'real_test', host: '10.9.9.9', port: 22, user: 'x', family: 'auto', protocol: 'ssh',
      vendor: 'h3c', model: 'S5130', status: 'online', metrics: { cpu: 10, mem: 20, temp: 30 },
      neighbors: [{ remote: dc.name, remotePort: 'GE1/0/1' }], extId: null, boundDeviceId: null,
    };
    __app.real.devices.push(r1);
    __app.real.syncExt(r1);
    out.topoLinks = __app.real.buildTopology();
    const ext = __app.state.ext.find((e) => e.id === r1.extId);
    out.topoUplink = ext?.uplink === dc.id;
    __app.removeExtNode(r1.extId);
    __app.real.devices = __app.real.devices.filter((d) => d !== r1);

    // real UI protocol switch
    __app.realUI.open();
    await sleep(200);
    const proto = document.getElementById('real-protocol');
    proto.value = 'snmp';
    proto.dispatchEvent(new Event('change', { bubbles: true }));
    out.realPort = document.getElementById('real-mport').value;
    out.topoBtn = !!document.getElementById('real-topo');
    __app.realUI.close();
  } catch (e) {
    out.errors.push(String(e && e.stack ? e.stack : e));
  }
  return out;
})()
