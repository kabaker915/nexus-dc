import * as THREE from 'three';
import {
  U, U_COUNT, RACK_W, RACK_D, RACK_H, DEV_W, faceplateTex, rackScaleTex, labelTex,
} from './util.js';
import { CATALOG, portUpColor } from './catalog.js';
import { MAT, UNIT_BOX, UNIT_PLANE } from './materials.js';

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
const faceMats = new Map();

function faceMaterial(kind) {
  if (faceMats.has(kind)) return faceMats.get(kind);
  const s = CATALOG[kind];
  const tex = faceplateTex(kind, {
    brand: s.brand, model: s.model, vent: s.vent, accent: s.accent,
    tone: kind === 'storage4u' ? '#2a2119' : undefined,
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.15, roughness: 0.72 });
  faceMats.set(kind, m);
  return m;
}

function portBaseColor(p) {
  switch (p.kind) {
    case 'sfp': return new THREE.Color(0x3d4d61);
    case 'qsfp': return new THREE.Color(0x484a66);
    case 'patch': return new THREE.Color(0x5a6672);
    case 'power': return new THREE.Color(0x6b4a33);
    default: return new THREE.Color(0x4c5a67);
  }
}

/* ================================================================== *
 *  RACK
 * ================================================================== */
export function createRackModel(rack) {
  const g = new THREE.Group();
  g.name = `rack:${rack.id}`;
  g.position.set(rack.x, 0, rack.z);
  g.rotation.y = rack.rotY || 0;
  g.userData.rackId = rack.id;
  g.userData.type = 'rack';

  const add = (mat, sx, sy, sz, x, y, z, shadow = false) => {
    const m = new THREE.Mesh(UNIT_BOX, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    g.add(m);
    return m;
  };

  // plinth + top
  add(MAT.frame, RACK_W - 0.02, 0.05, RACK_D - 0.02, 0, 0.025, 0, true);
  add(MAT.frame, RACK_W, 0.03, RACK_D, 0, 1.985, 0, true);
  add(MAT.frameLight, RACK_W - 0.05, 0.012, RACK_D - 0.08, 0, 1.966, 0);

  // corner posts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(MAT.frameLight, 0.028, 1.9, 0.028, sx * (RACK_W / 2 - 0.016), 1.0, sz * (RACK_D / 2 - 0.016), true);
    }
  }
  // side panels
  for (const sx of [-1, 1]) add(MAT.side, 0.01, 1.88, RACK_D - 0.07, sx * (RACK_W / 2 - 0.005), 1.0, 0, true);
  // rear
  add(MAT.side, RACK_W - 0.06, 1.86, 0.012, 0, 1.0, -RACK_D / 2 + 0.012);

  // vertical cable managers
  for (const sx of [-1, 1]) add(MAT.tray, 0.018, 1.84, 0.036, sx * 0.263, 1.0, 0.518);

  // U-number scale
  const scaleMat = new THREE.MeshBasicMaterial({ map: rackScaleTex(), transparent: true, toneMapped: false });
  const scale = new THREE.Mesh(UNIT_PLANE, scaleMat);
  scale.scale.set(0.026, U_COUNT * U, 1);
  scale.position.set(-0.272, 0.06 + (U_COUNT * U) / 2, 0.545 + 0.026);
  g.add(scale);

  // blanking panels
  const blanks = new THREE.InstancedMesh(UNIT_BOX, MAT.blank, U_COUNT);
  blanks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blanks.userData.rackId = rack.id;
  g.add(blanks);
  rack.blankMesh = blanks;

  // top status bar
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x3ddc97, toneMapped: true });
  const bar = new THREE.Mesh(UNIT_BOX, ledMat);
  bar.scale.set(0.18, 0.008, 0.008);
  bar.position.set(0, 1.952, 0.596);
  g.add(bar);
  rack.ledMat = ledMat;

  // front glass door
  const dw = RACK_W - 0.028;
  const dh = RACK_H - 0.13;
  const door = new THREE.Group();
  door.position.set(-RACK_W / 2 + 0.012, 0.075, RACK_D / 2 - 0.012);
  const glass = new THREE.Mesh(UNIT_PLANE, MAT.glass);
  glass.scale.set(dw - 0.026, dh - 0.05, 1);
  glass.position.set(dw / 2, dh / 2, 0.002);
  glass.renderOrder = 2;
  door.add(glass);

  const barMesh = (sx, sy, x, y) => {
    const m = new THREE.Mesh(UNIT_BOX, MAT.frameLight);
    m.scale.set(sx, sy, 0.012);
    m.position.set(x, y, 0.004);
    door.add(m);
  };
  barMesh(dw, 0.022, dw / 2, 0.011);
  barMesh(dw, 0.022, dw / 2, dh - 0.011);
  barMesh(0.02, dh, 0.01, dh / 2);
  barMesh(0.02, dh, dw - 0.01, dh / 2);

  const handle = new THREE.Mesh(UNIT_BOX, MAT.handle);
  handle.scale.set(0.014, 0.17, 0.018);
  handle.position.set(dw - 0.05, dh * 0.52, 0.016);
  door.add(handle);

  // per-rack name plate on the top rail
  const plate = new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({
    map: labelTex(rack.name, { size: 96 }), transparent: true, color: 0xbcd4e6,
  }));
  plate.scale.set(0.15, 0.038, 1);
  plate.position.set(0, 1.9, 0.607);
  g.add(plate);

  // roof identification plate (reads well in the aerial view)
  const roof = new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({
    map: labelTex(rack.name, { size: 96 }), transparent: true, color: 0x9fbcd2,
  }));
  roof.rotation.x = -Math.PI / 2;
  roof.scale.set(0.34, 0.085, 1);
  roof.position.set(0, 2.003, 0);
  g.add(roof);

  rack.group = g;
  rack.door = door;
  rack.doorOpen = 0;
  rack.doorTarget = 0;
  rack.deviceGroup = new THREE.Group();
  g.add(rack.deviceGroup);
  g.add(door);

  return g;
}

/* ================================================================== *
 *  DEVICE
 * ================================================================== */
export function createDeviceModel(dev) {
  const spec = CATALOG[dev.kind];
  const h = dev.u * U - 0.0045;
  const d = spec.depth;
  const g = new THREE.Group();
  g.userData.deviceId = dev.id;
  g.userData.type = 'device';
  g.name = `dev:${dev.id}`;

  // ear brackets
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(UNIT_BOX, MAT.handle);
    ear.scale.set(0.011, Math.min(h * 0.9, 0.032), 0.03);
    ear.position.set(sx * (DEV_W / 2 + 0.004), 0, 0.014);
    g.add(ear);
  }

  // chassis
  const body = new THREE.Mesh(UNIT_BOX, MAT.chassis);
  body.scale.set(DEV_W, h, d);
  body.position.set(0, 0, -d / 2);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.deviceId = dev.id;
  g.add(body);
  dev.bodyMesh = body;

  // faceplate
  const fp = new THREE.Mesh(UNIT_PLANE, faceMaterial(dev.kind));
  fp.scale.set(DEV_W - 0.004, h - 0.003, 1);
  fp.position.set(0, 0, 0.0016);
  fp.userData.deviceId = dev.id;
  g.add(fp);

  // drive bays
  if (spec.drives) {
    const dr = spec.drives;
    const total = dr.cols * dr.rows;
    const dm = new THREE.InstancedMesh(UNIT_BOX, MAT.chassisDark, total);
    const lm = new THREE.InstancedMesh(UNIT_BOX, MAT.led, total);
    for (let r = 0; r < dr.rows; r++) {
      for (let c = 0; c < dr.cols; c++) {
        const i = r * dr.cols + c;
        const x = dr.x0 + c * dr.gapX;
        const y = dr.rows > 1 ? (r === 0 ? dr.y : -dr.y) : (dr.y || 0);
        tmpObj.position.set(x, y, 0.0055);
        tmpObj.scale.set(dr.w, dr.h, 0.007);
        tmpObj.updateMatrix();
        dm.setMatrixAt(i, tmpObj.matrix);

        tmpObj.position.set(x - dr.w / 2 + 0.0032, y - dr.h / 2 + 0.0038, 0.0105);
        tmpObj.scale.set(0.0022, 0.0022, 0.0016);
        tmpObj.updateMatrix();
        lm.setMatrixAt(i, tmpObj.matrix);
        tmpColor.setHex(Math.random() < 0.25 ? 0x2a6cff : 0x1f8a5c).multiplyScalar(0.7 + Math.random() * 0.6);
        lm.setColorAt(i, tmpColor);
      }
    }
    dm.instanceMatrix.needsUpdate = true;
    lm.instanceMatrix.needsUpdate = true;
    lm.instanceColor.needsUpdate = true;
    g.add(dm, lm);
  }

  // ports + LEDs are rendered by the global PortPool (one instanced mesh each)

  // status LED
  const stMat = new THREE.MeshBasicMaterial({ color: 0x3ddc97, toneMapped: false });
  const st = new THREE.Mesh(UNIT_BOX, stMat);
  st.scale.set(0.004, 0.004, 0.0022);
  st.position.set(DEV_W / 2 - 0.022, h / 2 - 0.011, 0.006);
  g.add(st);
  dev.statusLed = st;
  dev.statusMat = stMat;

  // rear: fan grilles + PSUs
  const rear = new THREE.Mesh(UNIT_BOX, MAT.chassisDark);
  rear.scale.set(DEV_W - 0.01, h - 0.006, 0.006);
  rear.position.set(0, 0, -d - 0.002);
  g.add(rear);

  for (let i = 0; i < 2; i++) {
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.026, 18), MAT.fan);
    fan.position.set(-0.075 + i * 0.15, 0.004, -d - 0.006);
    fan.rotation.y = Math.PI;
    g.add(fan);
  }
  const psu = new THREE.Mesh(UNIT_BOX, MAT.handle);
  psu.scale.set(0.075, Math.min(h * 0.45, 0.024), 0.012);
  psu.position.set(-0.16, -h * 0.18, -d - 0.008);
  g.add(psu);

  dev.group = g;
  return g;
}

/* ------------------------------------------------------------------ *
 *  State → visuals
 * ------------------------------------------------------------------ */
export function refreshBlankPanels(rack, devices) {
  const used = new Set();
  for (const d of devices) {
    for (let i = 0; i < d.u; i++) used.add(d.slot + i);
  }
  for (let u = 1; u <= U_COUNT; u++) {
    tmpObj.rotation.set(0, 0, 0);
    tmpObj.position.set(0, 0.06 + (u - 1) * U + U / 2, 0.5415);
    const hidden = used.has(u);
    tmpObj.scale.set(hidden ? 0.0001 : DEV_W, hidden ? 0.0001 : U * 0.82, 0.006);
    tmpObj.updateMatrix();
    rack.blankMesh.setMatrixAt(u - 1, tmpObj.matrix);
  }
  rack.blankMesh.instanceMatrix.needsUpdate = true;
}

export function updateDeviceLeds(dev, time) {
  const mesh = dev.ledMesh;
  if (!mesh) return;
  const ports = dev.ports;
  const online = dev.adminPower && dev.status !== 'offline';
  const booting = dev.status === 'rebooting';
  for (let i = 0; i < ports.length; i++) {
    const p = ports[i];
    let hex = 0x080d12;
    let k = 1;
    if (booting) {
      hex = 0xffb020;
      k = Math.sin(time * 0.012 + i) > 0 ? 1 : 0.15;
    } else if (!online) {
      hex = 0x070b0f;
    } else if (p.state === 'err') {
      hex = 0xff4d63;
      k = Math.random() < 0.3 ? 0.3 : 1;
    } else if (p.state === 'up') {
      hex = portUpColor(p.speed);
      k = (0.4 + (Math.random() < 0.15 + p.util * 0.6 ? 0.35 : 0.1)) * 0.6;
    } else if (p.kind === 'power') {
      hex = 0xff8a3d;
      k = 0.45;
    }
    tmpColor.setHex(hex).multiplyScalar(k);
    mesh.setColorAt(i, tmpColor);
  }
  mesh.instanceColor.needsUpdate = true;
}

export function updateDeviceStatusColor(dev) {
  if (!dev.statusMat) return;
  if (!dev.adminPower) dev.statusMat.color.setHex(0x3a4550);
  else if (dev.status === 'rebooting') dev.statusMat.color.setHex(0xffb020);
  else if (dev.status === 'offline') dev.statusMat.color.setHex(0xff4d63);
  else dev.statusMat.color.setHex(0x3ddc97);
}

export function updateRackHealth(rack, level) {
  if (!rack.ledMat) return;
  const hex = level === 'critical' ? 0xff4d63 : level === 'major' ? 0xff8a3d
    : level === 'minor' ? 0xffb020 : 0x3ddc97;
  rack.ledMat.color.setHex(hex);
}

/** World-space anchor of a port connector. */
export function portWorld(dev, port) {
  const v = new THREE.Vector3(port.x, port.y, 0.012);
  dev.group.updateWorldMatrix(true, false);
  return dev.group.localToWorld(v);
}

