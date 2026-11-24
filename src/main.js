import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import {
  U, U_COUNT, RACK_W, RACK_D, FRONT_Z, clamp, uid,
} from './util.js';
import { CATALOG, createDeviceData, BUILD_LIST } from './catalog.js';
import { initMaterials, MAT, UNIT_BOX } from './materials.js';
import { buildWorld, buildLights, ROOM } from './world.js';
import {
  createRackModel, createDeviceModel, refreshBlankPanels,
  updateDeviceStatusColor, updateRackHealth,
} from './models.js';
import { PortPool } from './portpool.js';
import { CableSystem } from './cables.js';
import { Simulation, rackDeviceList } from './sim.js';
import { UI } from './ui.js';
import { FlatView } from './flat.js';
import { Toolbox } from './toolbox.js';
import { createExtNode } from './extnet.js';
import { ExtUI } from './extui.js';
import { RealNet } from './realnet.js';
import { RealUI } from './realui.js';
import { History } from './history.js';
import { Settings } from './settings.js';
import { Templates } from './templates.js';
import { FrontEditor } from './frontedit.js';
import { Cabling } from './cabling.js';
import { Analytics } from './analytics.js';
import { WorkOrders } from './workorders.js';
import { Thermal } from './thermal.js';
import { Playbook } from './playbook.js';
import { WalkMode } from './walk.js';
import { Props } from './props.js';

/* Local gateway token: injected into index.html by server.mjs.
 * Added to every same-origin /api request so a DNS-rebound page cannot use it. */
const NEXUS_TOKEN = document.querySelector('meta[name="nexus-token"]')?.content || '';
if (NEXUS_TOKEN && NEXUS_TOKEN !== '__NEXUS_TOKEN__') {
  const baseFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('/api/')) {
      const headers = new Headers(init.headers || {});
      headers.set('X-Nexus-Token', NEXUS_TOKEN);
      init = { ...init, headers };
    }
    return baseFetch(input, init);
  };
}

/* ==================================================================== *
 *  STATE
 * ==================================================================== */
const state = {
  racks: [],
  devices: {},
  cables: {},
  ext: [],
  real: [],
  dataMode: 'sim',
  perf: 'high',
  selection: null,
  selectionSet: [],
  layoutVersion: 0,
  mode: 'inspect',
  pendingKind: null,
  pendingCable: null,
  nextDev: 0,
};

initMaterials();

/* ==================================================================== *
 *  RENDERER / SCENE
 * ==================================================================== */
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Static scene: refresh the shadow map only when geometry changes.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.info.autoReset = false;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080c);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.05, 140);
camera.position.set(-4.6, 1.88, 0.02);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 1.1;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.495;
controls.panSpeed = 0.8;

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.45, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const world = buildWorld(scene);
const lights = buildLights(scene);

// image-based lighting for believable brushed metal
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const cableSys = new CableSystem(scene);
const portPool = new PortPool(scene, state);
const sim = new Simulation(state);

/* ==================================================================== *
 *  SELECTION / GHOST HELPERS
 * ==================================================================== */
function touchShadows() {
  renderer.shadowMap.needsUpdate = true;
}

const selBoxes = new Map();

function selectionBox(key) {
  let box = selBoxes.get(key);
  if (!box) {
    box = new THREE.BoxHelper(new THREE.Object3D(), 0x35d6ff);
    box.material.depthTest = false;
    box.material.transparent = true;
    box.material.opacity = 0.95;
    box.renderOrder = 6;
    box.visible = false;
    scene.add(box);
    selBoxes.set(key, box);
  }
  return box;
}

function updateSelectionVisuals() {
  const keep = new Set();
  for (const t of state.selectionSet) {
    if (t.type !== 'device' && t.type !== 'rack') continue;
    const key = `${t.type}:${t.id}`;
    const obj = t.type === 'device' ? state.devices[t.id]?.group : state.racks.find((r) => r.id === t.id)?.group;
    if (!obj) continue;
    keep.add(key);
    const box = selectionBox(key);
    box.setFromObject(obj);
    box.visible = true;
  }
  for (const [key, box] of selBoxes) if (!keep.has(key)) box.visible = false;
}

const ghost = new THREE.Mesh(UNIT_BOX, MAT.ghostOk);
ghost.visible = false;
ghost.renderOrder = 4;
scene.add(ghost);

const portMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.014, 14, 14),
  new THREE.MeshBasicMaterial({ color: 0x35d6ff, toneMapped: false }),
);
portMarker.visible = false;
scene.add(portMarker);

/* ==================================================================== *
 *  BUILD API
 * ==================================================================== */
function rackOverlaps(x, z) {
  return state.racks.some((r) => Math.abs(r.x - x) < RACK_W + 0.04 && Math.abs(r.z - z) < RACK_D + 0.1);
}

function canPlaceRack(x, z) {
  if (Math.abs(x) > ROOM.w / 2 - 0.9 || Math.abs(z) > ROOM.d / 2 - 0.9) return false;
  return !rackOverlaps(x, z);
}

function makeRack(name, x, z, rotY = 0, id = uid('rack')) {
  const rack = {
    id, name, x, z, rotY,
    devices: [], powerCap: 8, power: 0, temp: 21.5, coolingBoost: 0,
  };
  state.racks.push(rack);
  createRackModel(rack);
  scene.add(rack.group);
  refreshBlankPanels(rack, []);
  touchShadows();
  return rack;
}

function findFreeSlot(rack, u) {
  const used = new Set();
  for (const id of rack.devices) {
    const d = state.devices[id];
    if (!d) continue;
    for (let i = 0; i < d.u; i++) used.add(d.slot + i);
  }
  for (let s = 1; s <= U_COUNT - u + 1; s++) {
    let ok = true;
    for (let i = 0; i < u; i++) if (used.has(s + i)) { ok = false; break; }
    if (ok) return s;
  }
  return null;
}

function addDevice(rack, kind, opts = {}) {
  const spec = CATALOG[kind];
  if (!spec || spec.kind !== 'device') return null;
  const slot = opts.slot ?? findFreeSlot(rack, spec.u);
  if (!slot) { toast('机柜剩余 U 位不足', 'warn'); return null; }

  const idx = ++state.nextDev;
  const dev = createDeviceData(kind, {
    id: opts.id,
    name: opts.name || `${spec.short}-${String(idx).padStart(2, '0')}`,
    slot, rackId: rack.id,
  });
  dev.phase = Math.random() * 100;
  dev.metrics.mem = 25 + Math.random() * 40;
  state.devices[dev.id] = dev;
  rack.devices.push(dev.id);

  createDeviceModel(dev);
  dev.group.position.set(0, 0.06 + (slot - 1) * U + (spec.u * U) / 2, FRONT_Z);
  rack.deviceGroup.add(dev.group);

  refreshBlankPanels(rack, rackDeviceList(state, rack));
  portPool.scheduleRebuild();
  touchShadows();
  return dev;
}

function removeDevice(dev) {
  if (!dev) return;
  for (const c of Object.values(state.cables)) {
    if (c.a.devId === dev.id || c.b.devId === dev.id) removeCable(c);
  }
  const rack = state.racks.find((r) => r.id === dev.rackId);
  if (rack) {
    rack.devices = rack.devices.filter((id) => id !== dev.id);
    refreshBlankPanels(rack, rackDeviceList(state, rack));
  }
  dev.group?.parent?.remove(dev.group);
  delete state.devices[dev.id];
  portPool.scheduleRebuild();
  touchShadows();
  if (state.selection?.id === dev.id) select(null);
}

function addCable(devA, portA, devB, portB, opts = {}) {
  if (!devA || !devB || devA.id === devB.id) return null;
  const usedA = Object.values(state.cables).some(
    (c) => (c.a.devId === devA.id && c.a.portId === portA.id) || (c.b.devId === devA.id && c.b.portId === portA.id),
  );
  if (usedA) { toast(`${portA.label} 已有跳线`, 'warn'); return null; }
  const usedB = Object.values(state.cables).some(
    (c) => (c.a.devId === devB.id && c.a.portId === portB.id) || (c.b.devId === devB.id && c.b.portId === portB.id),
  );
  if (usedB) { toast(`${portB.label} 已有跳线`, 'warn'); return null; }

  const cable = {
    id: opts.id || uid('cab'),
    a: { devId: devA.id, portId: portA.id, label: portA.label },
    b: { devId: devB.id, portId: portB.id, label: portB.label },
    speed: Math.min(portA.speed || 1, portB.speed || 1),
  };
  const mesh = cableSys.add(cable, devA, devB);
  if (!mesh) return null;
  portA.cable = cable.id;
  portB.cable = cable.id;
  state.cables[cable.id] = cable;
  return cable;
}

function removeCable(cable) {
  if (!cable) return;
  const da = state.devices[cable.a.devId];
  const db = state.devices[cable.b.devId];
  if (da) {
    const p = da.ports.find((x) => x.id === cable.a.portId);
    if (p) p.cable = null;
  }
  if (db) {
    const p = db.ports.find((x) => x.id === cable.b.portId);
    if (p) p.cable = null;
  }
  cableSys.remove(cable.id);
  delete state.cables[cable.id];
  if (state.selection?.id === cable.id) select(null);
}

function removeRack(rack) {
  for (const id of [...rack.devices]) removeDevice(state.devices[id]);
  scene.remove(rack.group);
  state.racks = state.racks.filter((r) => r.id !== rack.id);
  if (state.selection?.id === rack.id) select(null);
}

/* ----------------------------- external nodes -------------------------- */
function addExtNode(kind = 'router', patch = {}) {
  const n = createExtNode(app, kind, { x: 0, y: 0 });
  Object.assign(n, patch);
  state.ext.push(n);
  flat.lastLayoutKey = '';
  flat.needFit = true;
  return n;
}

function removeExtNode(id) {
  state.ext = state.ext.filter((e) => e.id !== id);
  for (const e of state.ext) if (e.uplink === id) e.uplink = null;
  flat.lastLayoutKey = '';
  flat.needFit = true;
  if (extUI?.ext?.id === id) extUI.close();
  flat.draw();
  saveLayout(true);
}

/* ------------------------- rack / device edit helpers ------------------ */
function slotFits(rack, slot, u, ignoreId = null) {
  if (!rack || slot < 1 || slot + u - 1 > U_COUNT) return false;
  const used = new Set();
  for (const id of rack.devices) {
    if (id === ignoreId) continue;
    const d = state.devices[id];
    if (!d) continue;
    for (let i = 0; i < d.u; i++) used.add(d.slot + i);
  }
  for (let i = 0; i < u; i++) if (used.has(slot + i)) return false;
  return true;
}

function findFreeSlotIn(rack, u, ignoreId = null) {
  for (let s = 1; s <= U_COUNT - u + 1; s++) {
    if (slotFits(rack, s, u, ignoreId)) return s;
  }
  return null;
}

function moveDeviceTo(dev, slot) {
  const rack = state.racks.find((r) => r.id === dev.rackId);
  if (!rack || !slotFits(rack, slot, dev.u, dev.id) || slot === dev.slot) return false;
  history.push(`移动 ${dev.name} 到 U${slot}`);
  dev.slot = slot;
  dev.group.position.set(0, 0.06 + (slot - 1) * U + (dev.u * U) / 2, FRONT_Z);
  refreshBlankPanels(rack, rackDeviceList(state, rack));
  portPool.scheduleRebuild();
  touchShadows();
  sim.tick();
  saveLayout(true);
  ui.refresh();
  flat.lastLayoutKey = '';
  flat.draw();
  return true;
}

function addDeviceAt(rack, kind, slot) {
  const spec = CATALOG[kind];
  if (!spec || spec.kind !== 'device') return null;
  if (!slotFits(rack, slot, spec.u)) return null;
  history.push(`上架 ${spec.short}`);
  const dev = addDevice(rack, kind, { slot });
  if (dev) {
    sim.tick();
    saveLayout(true);
    ui.refresh();
    flat.lastLayoutKey = '';
    flat.needFit = true;
    flat.draw();
  }
  return dev;
}

function removeDeviceById(id) {
  const dev = state.devices[id];
  if (!dev) return;
  history.push(`移除 ${dev.name}`);
  removeDevice(dev);
  saveLayout(true);
  ui.refresh();
  flat.lastLayoutKey = '';
  flat.needFit = true;
  flat.draw();
}

function connectPairs(pairs) {
  if (!pairs?.length) return 0;
  history.push(`批量布线 ${pairs.length} 对`);
  let n = 0;
  for (const c of pairs) {
    if (addCable(c.a, c.pa, c.b, c.pb)) n++;
  }
  if (n) {
    sim.tick();
    saveLayout(true);
    ui.refresh();
    flat.lastLayoutKey = '';
    flat.needFit = true;
    flat.draw();
  }
  return n;
}

function applyTemplate(tpl, rack) {
  history.push(`应用模板 ${tpl.name}`);
  let added = 0;
  let skipped = 0;
  for (const item of tpl.devices) {
    const spec = CATALOG[item.kind];
    if (!spec || spec.kind !== 'device') { skipped++; continue; }
    const slot = slotFits(rack, item.slot, spec.u) ? item.slot : findFreeSlotIn(rack, spec.u);
    if (!slot) { skipped++; continue; }
    if (addDevice(rack, item.kind, { slot })) added++;
  }
  refreshBlankPanels(rack, rackDeviceList(state, rack));
  sim.tick();
  saveLayout(true);
  ui.refresh();
  flat.lastLayoutKey = '';
  flat.needFit = true;
  flat.draw();
  return { added, skipped };
}

function findRackSpot(x, z) {
  for (let i = 0; i < 12; i++) {
    const dx = 0.62 * Math.ceil(i / 2) * (i % 2 ? 1 : -1);
    for (const dz of [0, 1.3, -1.3]) {
      if (canPlaceRack(x + dx, z + dz)) return { x: x + dx, z: z + dz };
    }
  }
  return null;
}

function createRackNearSelection() {
  const base = state.selection?.type === 'rack'
    ? state.racks.find((r) => r.id === state.selection.id)
    : state.racks[0];
  const spot = base ? findRackSpot(base.x + 0.62, base.z) : findRackSpot(2.6, -3.4);
  if (!spot) { toast('附近没有可放置机柜的空位', 'warn'); return null; }
  history.push('新建机柜');
  const rack = makeRack(nextRackName(), spot.x, spot.z, base?.rotY || 0);
  ui.refresh();
  flat.lastLayoutKey = '';
  flat.needFit = true;
  flat.draw();
  return rack;
}

function duplicateRack(rack) {
  const spot = findRackSpot(rack.x + 0.62, rack.z);
  if (!spot) { toast('附近没有空位复制机柜', 'warn'); return null; }
  history.push(`复制机柜 ${rack.name}`);
  const nr = makeRack(nextRackName(), spot.x, spot.z, rack.rotY);
  for (const id of [...rack.devices]) {
    const d = state.devices[id];
    if (d) addDevice(nr, d.kind, { slot: d.slot });
  }
  refreshBlankPanels(nr, rackDeviceList(state, nr));
  sim.tick();
  select({ type: 'rack', id: nr.id });
  saveLayout(true);
  ui.refresh();
  flat.lastLayoutKey = '';
  flat.needFit = true;
  flat.draw();
  toast(`已复制为 ${nr.name}`, 'ok');
  return nr;
}

/* ==================================================================== *
 *  SELECTION
 * ==================================================================== */
function select(target, opts = {}) {
  const add = !!opts.add;
  if (!target) {
    state.selectionSet = [];
  } else if (add) {
    const i = state.selectionSet.findIndex((t) => t.type === target.type && t.id === target.id);
    if (i >= 0) state.selectionSet.splice(i, 1);
    else state.selectionSet.push(target);
  } else {
    state.selectionSet = [target];
  }

  const valid = state.selectionSet.filter((t) => {
    if (t.type === 'device') return !!state.devices[t.id];
    if (t.type === 'rack') return state.racks.some((r) => r.id === t.id);
    if (t.type === 'cable') return !!state.cables[t.id];
    return false;
  });
  state.selectionSet = valid;
  state.selection = valid.length ? valid[valid.length - 1] : null;

  updateSelectionVisuals();
  cableSys.setSelected(state.selection?.type === 'cable' ? state.selection.id : null);
  ui.showSelection(state.selection, valid.slice());
  toolbox?.onSelection(state.selection);
  realUI?.onSelection?.(state.selection);
}

function selectAllDevices() {
  state.selectionSet = Object.values(state.devices).map((d) => ({ type: 'device', id: d.id }));
  state.selection = state.selectionSet[state.selectionSet.length - 1] || null;
  updateSelectionVisuals();
  cableSys.setSelected(null);
  ui.showSelection(state.selection, state.selectionSet.slice());
}

/* ==================================================================== *
 *  BATCH OPS
 * ==================================================================== */

function batchAction(act) {
  const set = state.selectionSet.slice();
  const devs = set.filter((t) => t.type === 'device').map((t) => state.devices[t.id]).filter(Boolean);
  const racks = set.filter((t) => t.type === 'rack').map((t) => state.racks.find((r) => r.id === t.id)).filter(Boolean);

  if (act === 'delete') {
    if (!devs.length && !racks.length) return toast('没有可删除的对象', 'warn');
    history?.push(`批量删除 ${devs.length + racks.length} 项`);
    devs.forEach((d) => removeDevice(d));
    racks.forEach((r) => removeRack(r));
    select(null);
    ui.refresh();
    flat.lastLayoutKey = '';
    flat.needFit = true;
    flat.draw();
    saveLayout(true);
    toast(`已删除 ${devs.length} 台设备、${racks.length} 个机柜`, 'ok');
    return;
  }
  if (act === 'door') {
    racks.forEach((r) => { r.doorTarget = r.doorTarget ? 0 : -Math.PI * 0.62; });
    ui.refresh();
    return;
  }
  if (act === 'cool') {
    racks.forEach((r) => sim.coolRack(r));
    sim.tick();
    ui.refresh();
    return;
  }
  if (!devs.length) return toast('批量操作仅支持设备', 'warn');
  devs.forEach((d) => sim.deviceAction(d, act));
  sim.tick();
  ui.refresh();
  ui.showSelection(state.selection, state.selectionSet.slice());
}

/* ==================================================================== *
 *  CAMERA
 * ==================================================================== */
let camTween = null;
function flyTo(pos, target, dur = 0.9) {
  camTween = {
    fromPos: camera.position.clone(), toPos: pos.clone(),
    fromTgt: controls.target.clone(), toTgt: target.clone(),
    t: 0, dur,
  };
}

const PRESET = {
  overview: { pos: new THREE.Vector3(-4.6, 1.88, 0.02), tgt: new THREE.Vector3(0.6, 1.15, 0) },
  aisle: { pos: new THREE.Vector3(-1.5, 1.55, 0.0), tgt: new THREE.Vector3(1.9, 1.2, 0) },
  top: { pos: new THREE.Vector3(0.0, 8.4, 3.6), tgt: new THREE.Vector3(0, 0.5, -0.2) },
  rack: { pos: new THREE.Vector3(-1.2, 1.55, 2.4), tgt: new THREE.Vector3(-1.55, 1.15, -1.25) },
};

function cameraPreset(name) {
  if (app.view === '2d') {
    if (state.selection) flat.focus(state.selection);
    return;
  }
  if (name === 'rack') {
    const rack = state.selection?.type === 'rack'
      ? state.racks.find((r) => r.id === state.selection.id)
      : state.racks[0];
    if (rack) return focusRack(rack);
  }
  const p = PRESET[name] || PRESET.overview;
  flyTo(p.pos, p.tgt, 1.0);
}

/* ---------------------------- quality presets --------------------------- */
const PERF_PRESETS = {
  low: { dpr: 1, shadow: false, shadowSize: 512, bloom: false, bloomScale: 0.5, ledMs: 320 },
  mid: { dpr: 1.5, shadow: true, shadowSize: 1024, bloom: true, bloomScale: 0.6, ledMs: 220 },
  high: { dpr: 2, shadow: true, shadowSize: 2048, bloom: true, bloomScale: 1, ledMs: 160 },
};
let ledInterval = 160;

function applyPerf(level) {
  const p = PERF_PRESETS[level] || PERF_PRESETS.high;
  state.perf = PERF_PRESETS[level] ? level : 'high';
  ledInterval = p.ledMs;
  const dpr = Math.min(window.devicePixelRatio || 1, p.dpr);
  renderer.setPixelRatio(dpr);
  composer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = p.shadow;
  renderer.shadowMap.needsUpdate = p.shadow;
  if (lights?.key) {
    lights.key.castShadow = p.shadow;
    if (lights.key.shadow.mapSize.x !== p.shadowSize) {
      lights.key.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      if (lights.key.shadow.map) {
        lights.key.shadow.map.dispose();
        lights.key.shadow.map = null;
      }
    }
  }
  bloom.enabled = p.bloom;
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloom.setSize(window.innerWidth * p.bloomScale, window.innerHeight * p.bloomScale);
}

/* ---------------------------- data source mode -------------------------- */
function setDataMode(mode) {
  const m = mode === 'real' ? 'real' : 'sim';
  state.dataMode = m;
  document.body.classList.toggle('real-mode', m === 'real');
  document.querySelectorAll('#data-mode [data-dmode]').forEach((b) => {
    b.classList.toggle('on', b.dataset.dmode === m);
  });
  if (m === 'real') {
    realNet.start();
    realNet.applyToModel();
    realUI.open();
  } else {
    realNet.stop();
    for (const d of Object.values(state.devices)) {
      if (d.realSource) {
        delete d.realSource;
        if (d.adminPower) d.status = 'online';
      }
    }
    sim.tick();
  }
  flat.draw();
  ui.refresh();
}

/* ---------------------------- view switching --------------------------- */
function setViewMode(v) {
  app.view = v;
  const is2d = v === '2d';
  document.body.classList.toggle('view-2d', is2d);
  renderer.domElement.style.display = is2d ? 'none' : 'block';
  controls.enabled = !is2d;
  document.querySelectorAll('#view-toggle [data-view]').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === v);
  });
  document.getElementById('flat-bar').hidden = !is2d;
  if (is2d) flat.show();
  else flat.hide();
}

function focusRack(rack) {
  const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rack.rotY || 0);
  const devs = rackDeviceList(state, rack);
  let cy = 1.0;
  if (devs.length) {
    let lo = 99, hi = 0;
    for (const d of devs) { lo = Math.min(lo, d.slot); hi = Math.max(hi, d.slot + d.u - 1); }
    cy = clamp(0.06 + ((lo - 1 + hi) / 2) * U, 0.26, 1.62);
  }
  const pos = new THREE.Vector3(rack.x, cy + 0.28, rack.z + n.z * 1.52);
  flyTo(pos, new THREE.Vector3(rack.x, cy, rack.z));
}

function focusTarget(target) {
  if (!target) return;
  if (app.view === '2d') { flat.focus(target); return; }
  if (target.type === 'device') {
    const d = state.devices[target.id];
    if (!d) return;
    const p = new THREE.Vector3();
    d.group.getWorldPosition(p);
    const rack = state.racks.find((r) => r.id === d.rackId);
    const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rack?.rotY || 0);
    const pos = new THREE.Vector3(p.x, p.y + 0.12, p.z + n.z * 0.42);
    flyTo(pos, p);
  } else if (target.type === 'rack') {
    const r = state.racks.find((x) => x.id === target.id);
    if (r) focusRack(r);
  }
}

/* ==================================================================== *
 *  INTERACTION
 * ==================================================================== */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.03);

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function pickAt(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const objs = state.racks.map((r) => r.group);
  objs.push(cableSys.group);
  const hits = raycaster.intersectObjects(objs, true);
  const out = {};
  let rackFallback = null;
  for (const h of hits) {
    const o = h.object;
    if (o.userData.pickCable) {
      if (o.userData.cableRanges && h.faceIndex != null) {
        const v = h.faceIndex * 3;
        const range = o.userData.cableRanges.find((r) => v >= r.start && v < r.start + r.count);
        if (range) out.cable = range.id;
      } else if (o.userData.cableId) {
        out.cable = o.userData.cableId;
      }
      if (out.cable) break;
    }
    if (o.userData.isPortPool && h.instanceId !== undefined && h.instanceId !== null) {
      const hitPort = o.userData.pool.pick(h.instanceId);
      if (hitPort) {
        out.port = hitPort;
        out.device = hitPort.devId;
        break;
      }
      continue;
    }
    let p = o;
    while (p && !p.userData.deviceId && !p.userData.rackId) p = p.parent;
    if (p?.userData.deviceId) { out.device = p.userData.deviceId; break; }
    if (p?.userData.rackId && !rackFallback) rackFallback = p.userData.rackId;
  }
  if (!out.device && !out.port && !out.cable && rackFallback) out.rack = rackFallback;
  const pt = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(floorPlane, pt)) out.point = pt;
  return out;
}

function portOf(devId, index) {
  const d = state.devices[devId];
  if (!d) return null;
  return d.ports[index] || null;
}

/**
 * Screen-space snap for port picking: 2 mm connectors are impossible to hit
 * precisely from the overview camera, so we look for the closest visible port.
 */
function nearestPortAt(clientX, clientY, maxPx = 14) {
  const rect = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector3();
  const camPos = camera.position;
  let best = null;
  let bestD = maxPx;
  const q = new THREE.Quaternion();
  for (const d of Object.values(state.devices)) {
    if (!d.adminPower || d.status !== 'online') continue;
    d.group.getWorldQuaternion(q);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (let i = 0; i < d.ports.length; i++) {
      const p = d.ports[i];
      v.set(p.x, p.y, 0.02);
      d.group.localToWorld(v);
      const toCam = camPos.clone().sub(v);
      if (toCam.dot(n) <= 0) continue;           // back-facing
      v.project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const dist = Math.hypot(sx - clientX, sy - clientY);
      if (dist < bestD) { bestD = dist; best = { devId: d.id, index: i }; }
    }
  }
  return best;
}

function onPointerDown(e) {
  if (walk.active) { walk.onDown(e); return; }
  down = { x: e.clientX, y: e.clientY };
}

function onPointerUp(e) {
  if (walk.active) { walk.onUp(e); return; }
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 6) return;
  if (e.button !== 0) return;
  onClick(e);
}

function onClick(e) {
  const hit = pickAt(e);

  if (state.mode === 'place') {
    if (state.pendingKind === 'rack') {
      const p = hit.point;
      if (!p || !canPlaceRack(p.x, p.z)) { toast('此处无法放置机柜', 'warn'); return; }
      history.push('放置机柜');
      const rack = makeRack(nextRackName(), snap(p.x), snap(p.z), 0);
      toast(`已放置机柜 ${rack.name}`, 'ok');
      sim.log('info', `新机柜 ${rack.name} 完成上架与接地`);
      exitMode();
      select({ type: 'rack', id: rack.id });
      ui.refresh();
      return;
    }
    const rack = state.racks.find((r) => r.id === hit.rack);
    if (!rack) { toast('请点击一个机柜以安装设备', 'warn'); return; }
    history.push('上架设备');
    const dev = addDevice(rack, state.pendingKind);
    if (dev) {
      toast(`${dev.name} 已安装至 ${rack.name} U${dev.slot}`, 'ok');
      sim.log('info', `${rack.name} 上架 ${dev.name}（U${dev.slot}）`);
      exitMode();
      select({ type: 'device', id: dev.id });
      ui.refresh();
    }
    return;
  }

  if (state.mode === 'cable') {
    const port = hit.port || nearestPortAt(e.clientX, e.clientY);
    if (!port) { toast('请点击设备端口进行布线', 'warn'); return; }
    handlePortClick(port);
    return;
  }

  if (state.mode === 'delete') {
    if (hit.device) {
      const d = state.devices[hit.device];
      history.push(`拆除 ${d.name}`);
      removeDevice(d);
      toast(`已拆除 ${d.name}`, 'ok');
      sim.log('warn', `${d.name} 已下架，相关跳线已拆除`);
      ui.refresh();
    } else if (hit.cable) {
      history.push('拆除跳线');
      removeCable(state.cables[hit.cable]);
      toast('跳线已拆除', 'ok');
    } else if (hit.rack) {
      const r = state.racks.find((x) => x.id === hit.rack);
      if (r) { history.push(`移除机柜 ${r.name}`); removeRack(r); toast(`机柜 ${r.name} 已移除`, 'ok'); ui.refresh(); }
    }
    return;
  }

  // inspect
  if (hit.port) {
    const d = state.devices[hit.port.devId];
    const p = d.ports[hit.port.index];
    select({ type: 'device', id: d.id }, { add: e.shiftKey });
    ui.focusPort(p);
    return;
  }
  if (hit.device) return select({ type: 'device', id: hit.device }, { add: e.shiftKey });
  if (hit.cable) return select({ type: 'cable', id: hit.cable });
  if (hit.rack) return select({ type: 'rack', id: hit.rack }, { add: e.shiftKey });
  if (!e.shiftKey) select(null);
}

function handlePortClick(hitPort) {
  const d = state.devices[hitPort.devId];
  const p = d?.ports[hitPort.index];
  if (!d || !p) return;

  if (!state.pendingCable) {
    state.pendingCable = { devId: d.id, portIndex: hitPort.index };
    const w = new THREE.Vector3(p.x, p.y, 0.012);
    d.group.localToWorld(w);
    portMarker.position.copy(w);
    portMarker.visible = true;
    toast(`已选择 ${d.name} · ${p.label}，请点击对端端口`, 'ok');
    return;
  }
  if (state.pendingCable.devId === d.id && state.pendingCable.portIndex === hitPort.index) {
    state.pendingCable = null;
    portMarker.visible = false;
    return;
  }
  const a = state.devices[state.pendingCable.devId];
  const ap = a.ports[state.pendingCable.portIndex];
  history.push('布放跳线');
  const cable = addCable(a, ap, d, p);
  if (cable) {
    sim.log('info', `布放跳线 ${a.name}:${ap.label} ↔ ${d.name}:${p.label}`);
    toast(`跳线完成 ${ap.label} ↔ ${p.label}`, 'ok');
  }
  state.pendingCable = null;
  portMarker.visible = false;
}

/* ==================================================================== *
 *  MODES / GHOST
 * ==================================================================== */
function snap(v) { return Math.round(v * 10) / 10; }

function nextRackName() {
  let i = 1;
  const row = 'ABCDEFGH';
  while (state.racks.some((r) => r.name === `A${String(i).padStart(2, '0')}`)) i++;
  return `A${String(i).padStart(2, '0')}`;
}

function setMode(mode, kind = null) {
  state.mode = mode;
  state.pendingKind = kind;
  state.pendingCable = null;
  portMarker.visible = false;
  ghost.visible = false;
  document.body.className = `mode-${mode}`;
  ui.setMode(mode, kind);
  if (mode === 'place') {
    ghost.material = MAT.ghostOk;
    ghost.visible = false;
  }
}

function exitMode() {
  setMode('inspect');
}

let toastTimer = null;
function toast(text, type = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

function updateGhost(e) {
  if (state.mode !== 'place') return;
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const kind = state.pendingKind;

  if (kind === 'rack') {
    const pt = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(floorPlane, pt)) { ghost.visible = false; return; }
    const x = snap(pt.x);
    const z = snap(pt.z);
    const ok = canPlaceRack(x, z);
    ghost.visible = true;
    ghost.material = ok ? MAT.ghostOk : MAT.ghostBad;
    ghost.scale.set(RACK_W, 2.0, RACK_D);
    ghost.position.set(x, 1.0, z);
    showCrosshair(`${ok ? '放置机柜' : '位置冲突'} · ${x.toFixed(1)}, ${z.toFixed(1)}`, e);
    return;
  }

  const spec = CATALOG[kind];
  const hits = raycaster.intersectObjects(state.racks.map((r) => r.group), true);
  let rackId = null;
  for (const h of hits) {
    let p = h.object;
    while (p && !p.userData.rackId) p = p.parent;
    if (p) { rackId = p.userData.rackId; break; }
  }
  const rack = rackId ? state.racks.find((r) => r.id === rackId) : null;
  if (!rack) { ghost.visible = false; hideCrosshair(); return; }
  const slot = findFreeSlot(rack, spec.u);
  if (!slot) { ghost.visible = false; showCrosshair('U 位不足', e); return; }
  const y = 0.06 + (slot - 1) * U + (spec.u * U) / 2;
  const local = new THREE.Vector3(0, y, FRONT_Z - spec.depth / 2 + 0.02);
  rack.group.localToWorld(local);
  ghost.visible = true;
  ghost.material = MAT.ghostOk;
  ghost.scale.set(0.48, spec.u * U, spec.depth);
  ghost.position.copy(local);
  showCrosshair(`${rack.name} · U${slot} · ${CATALOG[kind].short}`, e);
}

function showCrosshair(text, e) {
  const el = document.getElementById('crosshair-hint');
  el.textContent = text;
  el.style.left = `${e.clientX}px`;
  el.style.top = `${e.clientY}px`;
  el.classList.remove('hidden');
}
function hideCrosshair() {
  document.getElementById('crosshair-hint').classList.add('hidden');
}

/* ==================================================================== *
 *  HOVER TOOLTIP
 * ==================================================================== */
const tooltip = document.getElementById('tooltip');
let lastHover = 0;
let down = null;

function onPointerMove(e) {
  if (walk.active) { walk.onMove(e); return; }
  if (state.mode === 'place') {
    updateGhost(e);
  } else {
    hideCrosshair();
  }
  const now = performance.now();
  if (now - lastHover < 80) return;
  lastHover = now;

  if (state.mode === 'place') return;
  const hit = pickAt(e);
  const dEl = renderer.domElement;

  let text = null;
  if (hit.port) {
    const d = state.devices[hit.port.devId];
    const p = d?.ports[hit.port.index];
    if (d && p) {
      const st = p.state === 'up' ? 'up' : p.state === 'err' ? 'errors' : 'down';
      text = `${d.name} · ${p.label}\n${p.kind.toUpperCase()} ${p.speed}G · ${st} · util ${Math.round(p.util * 100)}%`;
    }
  } else if (hit.device) {
    const d = state.devices[hit.device];
    if (d) text = `${d.name} · ${d.model}\n${d.status === 'online' ? '在线' : d.status} · CPU ${Math.round(d.metrics.cpu)}% · ${d.metrics.power.toFixed(0)}W`;
  } else if (hit.cable) {
    const c = state.cables[hit.cable];
    if (c) text = `跳线 ${c.speed}G · ${c.a.label} ↔ ${c.b.label}\n点击查看详情`;
  } else if (hit.rack) {
    const r = state.racks.find((x) => x.id === hit.rack);
    if (r) text = `${r.name} · 42U 机柜\n${r.devices.length} 台设备 · ${(r.power || 0).toFixed(2)}kW · ${(r.temp || 22).toFixed(1)}℃`;
  }

  if (text) {
    tooltip.textContent = text;
    tooltip.classList.remove('hidden');
    tooltip.style.left = `${Math.min(e.clientX + 16, window.innerWidth - 300)}px`;
    tooltip.style.top = `${Math.min(e.clientY + 16, window.innerHeight - 90)}px`;
    dEl.style.cursor = 'pointer';
  } else {
    tooltip.classList.add('hidden');
    dEl.style.cursor = 'default';
  }
}

function onPointerLeave() {
  tooltip.classList.add('hidden');
  hideCrosshair();
}

/* ==================================================================== *
 *  LAYOUT PERSISTENCE
 * ==================================================================== */
const STORAGE_KEY = 'nexusdc.layout.v2';

function serialize() {
  return {
    v: 2,
    racks: state.racks.map((r) => ({ id: r.id, name: r.name, x: r.x, z: r.z, rotY: r.rotY })),
    devices: Object.values(state.devices).map((d) => ({
      id: d.id, kind: d.kind, name: d.name, slot: d.slot, rackId: d.rackId,
    })),
    cables: Object.values(state.cables).map((c) => ({ id: c.id, a: c.a, b: c.b })),
    ext: state.ext.map((e) => ({ ...e })),
  };
}

function clearLayout() {
  for (const rack of [...state.racks]) removeRack(rack);
  cableSys.clear();
  state.racks = [];
  state.devices = {};
  state.cables = {};
  state.ext = [];
  state.nextDev = 0;
  extUI?.close();
  select(null);
  touchShadows();
}

function loadLayout(data) {
  clearLayout();
  if (!data) return;
  const rackMap = new Map();
  for (const r of data.racks || []) {
    const rack = makeRack(r.name, r.x, r.z, r.rotY || 0, r.id);
    rackMap.set(r.id, rack);
  }
  for (const d of data.devices || []) {
    const rack = rackMap.get(d.rackId);
    if (!rack) continue;
    addDevice(rack, d.kind, { id: d.id, name: d.name, slot: d.slot });
    state.nextDev = Math.max(state.nextDev, 1);
  }
  for (const c of data.cables || []) {
    const da = state.devices[c.a.devId];
    const db = state.devices[c.b.devId];
    if (!da || !db) continue;
    const pa = da.ports.find((p) => p.id === c.a.portId);
    const pb = db.ports.find((p) => p.id === c.b.portId);
    if (pa && pb) addCable(da, pa, db, pb, { id: c.id });
  }
  sim.history.thr = [];
  sim.history.temp = [];
  sim.history.power = [];
  state.ext = Array.isArray(data.ext) ? data.ext.map((e) => ({ ...e })) : [];
  flat.needFit = true;
  flat.lastLayoutKey = '';
  sim.tick();
}

function saveLayout(quiet = false) {
  try {
    state.layoutVersion = (state.layoutVersion || 0) + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
    if (!quiet) toast('机房布局已保存到本地', 'ok');
  } catch (err) {
    toast('保存失败：浏览器存储不可用', 'err');
  }
}

function exportLayout() {
  const data = JSON.stringify(serialize(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nexusdc-layout-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('布局 JSON 已导出', 'ok');
}

/* ==================================================================== *
 *  SAMPLE DATACENTER
 * ==================================================================== */
function seedSample() {
  clearLayout();
  const rows = [
    { z: -1.55, rot: 0, prefix: 'A' },
    { z: 1.55, rot: Math.PI, prefix: 'B' },
  ];
  const racks = {};
  for (const row of rows) {
    for (let i = 0; i < 6; i++) {
      const x = -1.55 + i * 0.62;
      const name = `${row.prefix}${String(i + 1).padStart(2, '0')}`;
      racks[name] = makeRack(name, x, row.z, row.rot);
    }
  }

  const N = (rack, n, kind) => Array.from({ length: n }, () => addDevice(racks[rack], kind));

  N('A01', 6, 'server1u');
  N('A02', 4, 'server2u');
  N('A03', 2, 'storage4u');
  N('A03', 2, 'server1u');
  N('A04', 6, 'server1u');
  N('A05', 3, 'storage4u');
  N('A06', 5, 'server2u');

  addDevice(racks.B01, 'router', { slot: 38 });
  addDevice(racks.B01, 'switch48', { slot: 35 });
  addDevice(racks.B01, 'patch24', { slot: 33 });
  for (const r of ['B02', 'B03', 'B04']) {
    addDevice(racks[r], 'switch48', { slot: 38 });
    addDevice(racks[r], 'switch48', { slot: 35 });
    addDevice(racks[r], 'patch24', { slot: 33 });
  }
  addDevice(racks.B05, 'firewall', { slot: 38 });
  addDevice(racks.B05, 'patch24', { slot: 36 });
  addDevice(racks.B06, 'switch24', { slot: 38 });
  addDevice(racks.B06, 'patch24', { slot: 36 });
  addDevice(racks.B06, 'pdu1u', { slot: 34 });

  const byRack = (name) => rackDeviceList(state, racks[name]);
  const tors = ['B03', 'B04'].flatMap((r) => byRack(r).filter((d) => d.kind === 'switch48'));
  let torIdx = 0;
  let portIdx = 1;

  // servers → top-of-rack switches (1G copper)
  for (const r of ['A01', 'A02', 'A03', 'A04', 'A05', 'A06']) {
    for (const d of byRack(r)) {
      if (d.kind !== 'server1u' && d.kind !== 'server2u') continue;
      const p1 = d.ports.find((p) => p.id === 'eno1');
      if (!p1) continue;
      const tor = tors[torIdx % tors.length];
      const rj = tor.ports.filter((p) => p.kind === 'rj45');
      const target = rj[(portIdx - 1) % rj.length];
      addCable(d, p1, tor, target);
      portIdx++;
      if (portIdx % 8 === 0) torIdx++;
    }
  }

  // top-of-rack uplinks → core switches
  const core = byRack('B02').filter((d) => d.kind === 'switch48');
  let coreIdx = 0;
  for (const tor of tors) {
    for (const lbl of ['Te0/51', 'Te0/52']) {
      const pa = tor.ports.find((p) => p.id === lbl);
      const c = core[coreIdx % core.length];
      const pb = c.ports.find((p) => p.kind === 'sfp' && !p.cable);
      if (pa && pb && !pa.cable) addCable(tor, pa, c, pb);
    }
    coreIdx++;
  }

  // storage controllers → dedicated 10G ports on the ToR
  let si = 0;
  for (const r of ['A03', 'A05']) {
    for (const d of byRack(r)) {
      if (d.kind !== 'storage4u') continue;
      const p = d.ports.find((x) => x.id === 'ctr0-a');
      const tor = tors[si % tors.length];
      const tp = tor.ports.find((x) => x.id === 'Te0/49');
      if (p && tp && !tp.cable) { addCable(d, p, tor, tp); si++; }
    }
  }

  // core → router (10G/25G), router → firewall
  const router = byRack('B01').find((d) => d.kind === 'router');
  if (router) {
    const rp = router.ports.filter((p) => p.kind === 'sfp');
    core.forEach((c, i) => {
      const cp = c.ports.find((p) => p.kind === 'sfp' && !p.cable);
      if (cp && rp[i]) addCable(c, cp, router, rp[i]);
    });
    const fw = byRack('B05').find((d) => d.kind === 'firewall');
    if (fw) {
      const mg = router.ports.find((p) => p.id === 'Mg0/1');
      if (mg) addCable(router, mg, fw, fw.ports[0]);
    }
  }

  // external edge: internet cloud + branch router wired into the core router
  const cloud = addExtNode('cloud', { name: '互联网出口', protocol: 'sim' });
  const branch = addExtNode('router', { name: '分支出口', host: '10.20.0.1', protocol: 'sim' });
  branch.uplink = router ? router.id : null;
  cloud.uplink = branch.id;

  state.racks.forEach((r) => refreshBlankPanels(r, rackDeviceList(state, r)));
  sim.log('ok', '示例机房已生成：2 排 × 6 机柜，含 45 台设备与全量跳线');
  flat.needFit = true;
  flat.lastLayoutKey = '';
  sim.tick();
}

/* ==================================================================== *
 *  BOOT
 * ==================================================================== */
function boot() {
  let loaded = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.racks) && data.racks.length) {
        loadLayout(data);
        loaded = true;
        sim.log('ok', `已恢复本地布局：${data.racks.length} 台机柜`);
      }
    }
  } catch (err) {
    loaded = false;
  }
  if (!loaded) seedSample();

  sim.tick();
  setMode('inspect');
  select(null);
  ui.refresh();
  setViewMode('3d');
  setTimeout(() => document.getElementById('loading').classList.add('done'), 250);
  if (location.hostname.endsWith('.github.io')) {
    setTimeout(() => toast('在线演示：构建 / 2D / 模拟运维可用；真实设备、SNMP/Redfish 与命令下发需在本地运行 server.mjs', 'ok'), 1500);
  }
}

/* ==================================================================== *
 *  APP FACADE FOR UI
 * ==================================================================== */
const app = {
  state, sim, camera, controls, scene, cableSys,
  view: '3d',
  setView: setViewMode,
  toggleView() { setViewMode(app.view === '3d' ? '2d' : '3d'); },
  setDataMode(mode) { setDataMode(mode); },
  openReal() { realUI.open(); },
  openToolbox(devId, tab) { toolbox.open(devId || null, tab || null); },
  openExt(id) { extUI.openProfile(id); },
  addExt(kind = 'router') {
    const n = addExtNode(kind, {});
    saveLayout(true);
    flat.draw();
    extUI.openProfile(n.id);
    return n;
  },
  removeExtNode(id) { removeExtNode(id); },
  persistLayout() { saveLayout(true); },
  serialize: () => serialize(),
  loadLayout: (data) => loadLayout(data),
  batch: batchAction,
  moveDeviceTo,
  addDeviceAt,
  slotFits,
  findFreeSlotIn,
  removeDeviceById,
  connectPairs,
  duplicateRack,
  createRackNearSelection,
  applyTemplate,
  applyPerf,
  openFront(rackId) { frontEditor.open(rackId || (state.selection?.type === 'rack' ? state.selection.id : null)); },
  openTemplates(rackId) { templates.open(rackId || (state.selection?.type === 'rack' ? state.selection.id : null)); },
  openCabling() { cabling.open(); },
  openSettings() { settings.open(); },
  openOrders() { ui.switchTab('orders'); },
  createWorkOrder(payload) { return workorders.create(payload); },
  openPlaybook() { playbook.open(); },
  openReport() { analytics.openReport(); },
  toggleHeat(on) {
    const v = typeof on === 'boolean' ? on : !thermal.group.visible;
    thermal.setHeat(v);
    settings.data.heat = v;
    settings.save();
    const cb = document.getElementById('set-heat');
    if (cb) cb.checked = v;
  },
  toggleShafts(on) {
    const v = typeof on === 'boolean' ? on : !thermal.shafts.visible;
    thermal.setShafts(v);
    settings.data.shafts = v;
    settings.save();
    const cb = document.getElementById('set-shafts');
    if (cb) cb.checked = v;
  },
  clearLocalData() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('nexusdc.')) localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
    window.location.reload();
  },
  placeKind(kind) {
    if (app.view === '2d') setViewMode('3d');
    setMode('place', kind);
    ui.toast(kind === 'rack' ? '点击地面放置机柜 · Esc 取消' : `点击机柜安装${CATALOG[kind].label} · Esc 取消`, 'ok');
  },
  select,
  focusTarget,
  cameraPreset,
  setMode,
  exitMode,
  deviceAction(dev, action) {
    sim.deviceAction(dev, action);
    sim.tick();
    ui.refresh();
    ui.showSelection(state.selection, state.selectionSet.slice());
  },
  togglePort(dev, port) {
    sim.togglePort(dev, port);
    sim.tick();
    ui.showSelection(state.selection, state.selectionSet.slice());
  },
  inject(dev, kind) {
    sim.inject(dev, kind);
    sim.tick();
    ui.refresh();
    ui.showSelection(state.selection, state.selectionSet.slice());
  },
  coolRack(rack) {
    sim.coolRack(rack);
    sim.tick();
    ui.refresh();
  },
  toggleDoor(rack) {
    rack.doorTarget = rack.doorTarget ? 0 : -Math.PI * 0.62;
    sim.log('info', `${rack.name} 前门${rack.doorTarget ? '打开' : '关闭'}`);
    ui.refresh();
  },
  ackAlarm(id) {
    sim.ack(id);
    ui.refresh();
  },
  ackAll() {
    sim.ackAll();
    ui.refresh();
  },
  setAutoHeal(v) {
    sim.autoHeal = v;
    sim.log('info', `自动处置已${v ? '开启' : '关闭'}`);
  },
  save: () => saveLayout(),
  export: exportLayout,
  reset() {
    if (!window.confirm('重置为示例机房？当前布局会丢失（已保存的布局不受影响）。')) return;
    seedSample();
    ui.refresh();
    select(null);
    toast('已重置为示例机房', 'ok');
  },
  removeSelection() {
    const s = state.selection;
    if (!s) return;
    if (s.type === 'device') removeDevice(state.devices[s.id]);
    else if (s.type === 'rack') removeRack(state.racks.find((r) => r.id === s.id));
    else if (s.type === 'cable') removeCable(state.cables[s.id]);
    ui.refresh();
  },
  refreshAll() {
    state.racks.forEach((r) => refreshBlankPanels(r, rackDeviceList(state, r)));
  },
  toast,
  racks: () => state.racks,
};

const ui = new UI(app);
const flat = new FlatView(app);
const toolbox = new Toolbox(app);
const extUI = new ExtUI(app);
const realNet = new RealNet(app);
realNet.restore();
app.real = realNet;
const realUI = new RealUI(app);
app.flat = flat;
app.toolbox = toolbox;
app.extUI = extUI;
app.realUI = realUI;
app.ui = ui;
window.__app = app;

const history = new History(app);
const settings = new Settings(app);
const analytics = new Analytics(app);
const workorders = new WorkOrders(app);
const thermal = new Thermal(app);
const playbook = new Playbook(app);
const templates = new Templates(app);
const frontEditor = new FrontEditor(app);
const cabling = new Cabling(app);
const walk = new WalkMode(app);
app.history = history;
app.settings = settings;
app.analytics = analytics;
app.workorders = workorders;
app.thermal = thermal;
app.playbook = playbook;
app.templates = templates;
app.frontEditor = frontEditor;
app.cabling = cabling;
app.walk = walk;
app.kick = markActive;
app.touchShadows = touchShadows;
app.pickAtCenter = () => pickAt({ clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 });
const props = new Props(app);
app.props = props;
if (settings.data.heat) thermal.setHeat(true);
if (settings.data.shafts) thermal.setShafts(true);
analytics.ready.then(() => ui.refresh());
sim.onAlarm = (alarm) => settings.notify(alarm);
history.sync();

/* ==================================================================== *
 *  EVENTS
 * ==================================================================== */
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerleave', onPointerLeave);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyPerf(state.perf);
  flat.resize();
});

/* view + 2D toolbar */
document.getElementById('btn-toolbox').addEventListener('click', () => toolbox.toggle());
document.getElementById('btn-walk').addEventListener('click', () => walk.toggle());
document.getElementById('btn-settings').addEventListener('click', () => settings.open());
document.getElementById('hist-undo').addEventListener('click', () => history.undo());
document.getElementById('hist-redo').addEventListener('click', () => history.redo());
document.querySelectorAll('#edit-tools [data-panel]').forEach((b) => {
  b.addEventListener('click', () => {
    const p = b.dataset.panel;
    if (p === 'front') app.openFront();
    if (p === 'templates') app.openTemplates();
    if (p === 'cabling') app.openCabling();
  });
});
document.getElementById('data-mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dmode]');
  if (b) setDataMode(b.dataset.dmode);
});
document.getElementById('view-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b) setViewMode(b.dataset.view);
});
document.getElementById('flat-bar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-flat]');
  if (!b) return;
  const k = b.dataset.flat;
  if (k === 'fit') { flat.needFit = true; flat.draw(); return; }
  if (k === 'ext') { app.addExt('router'); return; }
  flat.setMode(k);
  document.querySelectorAll('#flat-bar [data-flat]').forEach((x) => {
    if (x.dataset.flat === 'plan' || x.dataset.flat === 'topo') x.classList.toggle('on', x.dataset.flat === k);
  });
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (walk.active) {
    if (e.key === 'Escape' || e.code === 'KeyP') { walk.exit(); return; }
    walk.keydown(e);
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) history.redo();
    else history.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    history.redo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAllDevices();
    return;
  }
  if (e.key === 'Escape') {
    if (!document.getElementById('set-overlay').hidden) { settings.close(); return; }
    if (!document.getElementById('fe-overlay').hidden) { frontEditor.close(); return; }
    if (!document.getElementById('tpl-overlay').hidden) { templates.close(); return; }
    if (!document.getElementById('cab-overlay').hidden) { cabling.close(); return; }
    if (!realUI.root.hidden) { realUI.close(); return; }
    if (toolbox.open_) { toolbox.close(); return; }
    if (state.pendingCable) { state.pendingCable = null; portMarker.visible = false; }
    exitMode();
  } else if (e.key.toLowerCase() === 't') {
    toolbox.toggle();
  } else if (e.key.toLowerCase() === 'r') {
    setDataMode(state.dataMode === 'real' ? 'sim' : 'real');
  } else if (e.key.toLowerCase() === 'f') {
    app.openFront();
  } else if (e.key.toLowerCase() === 'h') {
    app.toggleHeat();
  } else if (e.key.toLowerCase() === 'p') {
    walk.toggle();
  } else if (e.key.toLowerCase() === 'v') {
    app.toggleView();
  } else if (e.key === '1' && app.view === '3d') cameraPreset('overview');
  else if (e.key === '2' && app.view === '3d') cameraPreset('aisle');
  else if (e.key === '3' && app.view === '3d') cameraPreset('top');
  else if (e.key === '4' && app.view === '3d') cameraPreset('rack');
  else if (e.key.toLowerCase() === 'e' && app.view === '3d') setMode('cable');
  else if (e.key.toLowerCase() === 'x' && app.view === '3d') setMode('delete');
  else if (e.key === 'Delete' || e.key === 'Backspace') app.removeSelection();
});

window.addEventListener('beforeunload', () => saveLayout(true));
window.addEventListener('keyup', (e) => walk.keyup(e));

/* ==================================================================== *
 *  LOOP
 * ==================================================================== */
let last = performance.now();
let ledAcc = 0;
let ledCursor = 0;
let saveAcc = 0;
let frames = 0;
let fpsAt = performance.now();
let nextRenderAt = 0;
let activeUntil = performance.now() + 4000;
let lastFlatAt = 0;
const perfHud = document.getElementById('perf-hud');

function markActive(ms = 1200) {
  activeUntil = performance.now() + ms;
}
controls.addEventListener('start', () => markActive(4000));
controls.addEventListener('change', () => markActive(1200));
renderer.domElement.addEventListener('pointerdown', () => markActive(2500));
renderer.domElement.addEventListener('pointermove', () => markActive(500));
window.addEventListener('visibilitychange', () => { if (!document.hidden) markActive(1500); });

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.06, (now - last) / 1000);
  last = now;

  if (app.view === '2d') {
    if (now - lastFlatAt > 50) {
      flat.frame(now);
      lastFlatAt = now;
    }
    saveAcc += dt;
    if (saveAcc > 45) { saveAcc = 0; saveLayout(true); }
    return;
  }

  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
    const e = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTgt, camTween.toTgt, e);
    if (camTween.t >= 1) camTween = null;
  }

  // doors
  let doorsMoving = false;
  for (const r of state.racks) {
    if (Math.abs(r.doorOpen - r.doorTarget) > 0.001) {
      r.doorOpen += (r.doorTarget - r.doorOpen) * Math.min(1, dt * 7);
      r.door.rotation.y = r.doorOpen;
      doorsMoving = true;
    }
  }
  if (doorsMoving) renderer.shadowMap.needsUpdate = true;

  // LEDs
  ledAcc += dt;
  if (ledAcc > ledInterval / 1000) {
    ledAcc = 0;
    const ids = Object.keys(state.devices);
    const chunk = Math.max(4, Math.ceil(ids.length / 3));
    for (let k = 0; k < chunk && ids.length; k++) {
      const d = state.devices[ids[(ledCursor + k) % ids.length]];
      if (d?.ports.length) portPool.updateDeviceLeds(d, now);
    }
    ledCursor = (ledCursor + chunk) % Math.max(1, ids.length);
    for (const id in state.devices) updateDeviceStatusColor(state.devices[id]);
  }

  if (portMarker.visible) {
    const s = 1 + Math.sin(now * 0.008) * 0.35;
    portMarker.scale.setScalar(s);
  }

  cableSys.tick(dt, sim.stats.throughput);
  world.overhead.visible = camera.position.y < 5.4;
  if (walk.active) walk.update(dt);
  else controls.update();
  props.update(dt, now / 1000);

  // Render on demand: full rate while interacting, ~12 fps when idle.
  const idle = now > activeUntil;
  if (!document.hidden && now >= nextRenderAt) {
    nextRenderAt = now + (idle ? 80 : 0);
    renderer.info.reset();
    composer.render();

    frames++;
    if (now - fpsAt >= 500) {
      const fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
      if (perfHud && !perfHud.hidden) {
        perfHud.textContent = `${fps} FPS · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris · LED ${ledInterval}ms`;
      }
    }
  }

  saveAcc += dt;
  if (saveAcc > 45) { saveAcc = 0; saveLayout(true); }
}

boot();
requestAnimationFrame(animate);

/* ==================================================================== *
 *  OPS TICK (1 Hz)
 * ==================================================================== */
setInterval(() => {
  sim.tick();
  if (state.dataMode === 'real') realNet.applyToModel();
  analytics.push();
  thermal.update();
  for (const r of state.racks) {
    const devs = rackDeviceList(state, r);
    const hasCrit = devs.some((d) => d.status === 'offline' || (d.flags.overheat > 0));
    const hot = r.temp > 32;
    updateRackHealth(r, hasCrit ? 'critical' : hot ? 'major' : 'none');
  }
  ui.refresh();
}, 1000);
