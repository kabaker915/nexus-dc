/* ============================================================
   机房建筑与基础设施：地面 / 墙体 / 吊顶 / 制冷 / 电力 / 消防
   ============================================================ */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './paneltex.js';

export const ROOM = { w: 15, d: 10.2, h: 3.32 };

const M = {};
export function materials() {
  if (M.ceiling) return M;
  // Only materials used by the ported props; our own floor/walls stay untouched.
  const c = TX.ceilingTextures();
  M.ceiling = new THREE.MeshBasicMaterial({ map: c.map, color: 0x8f959b });
  M.metal = new THREE.MeshStandardMaterial({ color: 0x23272c, metalness: 0.88, roughness: 0.38, envMapIntensity: 1.0 });
  M.metalLight = new THREE.MeshStandardMaterial({ color: 0x5b636b, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.0 });
  M.dark = new THREE.MeshStandardMaterial({ color: 0x0c0e11, metalness: 0.5, roughness: 0.7 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, metalness: 0.05, roughness: 0.92 });
  M.white = new THREE.MeshStandardMaterial({ color: 0xd8dde1, metalness: 0.1, roughness: 0.62 });
  M.glass = new THREE.MeshPhysicalMaterial({
    color: 0x9dc9d8, metalness: 0.0, roughness: 0.04, transparent: true, opacity: 0.17,
    side: THREE.DoubleSide, envMapIntensity: 1.6, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.03
  });
  M.red = new THREE.MeshStandardMaterial({ color: 0x9e1a1a, metalness: 0.5, roughness: 0.42 });
  M.yellow = new THREE.MeshStandardMaterial({ color: 0xd9a516, metalness: 0.3, roughness: 0.55 });
  M.rubberMat = new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.1, roughness: 0.95 });
  return M;
}

const buf = {
  box(w, h, d, r = 0.004, seg = 2) { return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.05, h / 2.05, d / 2.05)); }
};

function addMesh(parent, geo, mat, pos, rot, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
}

/* ============================================================
   主入口
   ============================================================ */
export function buildRoom(scene, ctx) {
  const mat = materials();
  const root = new THREE.Group();
  root.name = 'room';
  scene.add(root);

  buildShell(root, mat, ctx);
  buildCeiling(root, mat, ctx);
  buildCooling(root, mat, ctx);
  buildPower(root, mat, ctx);
  buildFireSystem(root, mat, ctx);
  buildVideoWall(root, mat, ctx);
  buildEntrance(root, mat, ctx);
  buildProps(root, mat, ctx);
  buildTrays(root, mat, ctx);
  buildContainment(root, mat, ctx);
  buildWallBranding(root, mat, ctx);
  buildAtmosphere(root, ctx);
  return root;
}

/* ---------- 地面 / 墙体 ---------- */
function buildShell(root, mat, ctx) {
  const { w, d, h } = ROOM;
  // 地面
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  root.add(floor);
  ctx.floor = floor;

  // 地面接缝压条（架空地板收边）
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x4a5057, metalness: 0.7, roughness: 0.45 });
  const edgeH = 0.012;
  addMesh(root, new THREE.BoxGeometry(w, edgeH, 0.05), edgeMat, [0, edgeH / 2, -d / 2 + 0.025], null, false);
  addMesh(root, new THREE.BoxGeometry(w, edgeH, 0.05), edgeMat, [0, edgeH / 2, d / 2 - 0.025], null, false);

  // 墙体
  const wallGeoLR = new THREE.PlaneGeometry(d, h);
  const wallGeoFB = new THREE.PlaneGeometry(w, h);
  const left = new THREE.Mesh(wallGeoLR, mat.wall);
  left.rotation.y = Math.PI / 2; left.position.set(-w / 2, h / 2, 0);
  left.receiveShadow = true; root.add(left);
  const right = new THREE.Mesh(wallGeoLR, mat.wall);
  right.rotation.y = -Math.PI / 2; right.position.set(w / 2, h / 2, 0);
  right.receiveShadow = true; root.add(right);
  const back = new THREE.Mesh(wallGeoFB, mat.wall);
  back.position.set(0, h / 2, -d / 2);
  back.receiveShadow = true; root.add(back);
  const front = new THREE.Mesh(wallGeoFB, mat.wall);
  front.rotation.y = Math.PI; front.position.set(0, h / 2, d / 2);
  front.receiveShadow = true; root.add(front);

  // 踢脚线
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2d3338, metalness: 0.35, roughness: 0.7 });
  const bh = 0.1;
  addMesh(root, new THREE.BoxGeometry(w, bh, 0.025), baseMat, [0, bh / 2, -d / 2 + 0.013], null, false);
  addMesh(root, new THREE.BoxGeometry(w, bh, 0.025), baseMat, [0, bh / 2, d / 2 - 0.013], null, false);
  addMesh(root, new THREE.BoxGeometry(0.025, bh, d), baseMat, [-w / 2 + 0.013, bh / 2, 0], null, false);
  addMesh(root, new THREE.BoxGeometry(0.025, bh, d), baseMat, [w / 2 - 0.013, bh / 2, 0], null, false);

  // 墙面竖向铝型材
  for (let x = -w / 2 + 2.5; x < w / 2; x += 2.5) {
    addMesh(root, new THREE.BoxGeometry(0.04, h, 0.02), mat.metalLight, [x, h / 2, -d / 2 + 0.012], null, false);
  }
  // 墙面板缝阴影（顶部压条）
  addMesh(root, new THREE.BoxGeometry(w, 0.05, 0.06), mat.metalLight, [0, h - 0.06, -d / 2 + 0.03], null, false);
  addMesh(root, new THREE.BoxGeometry(0.06, 0.05, d), mat.metalLight, [-w / 2 + 0.03, h - 0.06, 0], null, false);

  // 顶部回风夹层阴影
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
  addMesh(root, new THREE.PlaneGeometry(w, 0.35), shadowMat, [0, h - 0.2, -d / 2 + 0.09], null, false, false);

  // 门口地垫
  const matMat = new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.95, metalness: 0 });
  addMesh(root, new THREE.BoxGeometry(2.2, 0.012, 1.2), matMat, [5.4, 0.006, 4.3], null, false);
}

/* ---------- 吊顶与灯具 ---------- */
function buildCeiling(root, mat, ctx) {
  const { w, d, h } = ROOM;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = h;
  root.add(ceil);

  // T 型龙骨
  const barMat = new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.55, roughness: 0.5 });
  for (let x = -w / 2; x <= w / 2; x += 1.2) {
    addMesh(root, new THREE.BoxGeometry(0.024, 0.05, d), barMat, [x, h - 0.026, 0], null, false, false);
  }
  for (let z = -d / 2; z <= d / 2; z += 1.2) {
    addMesh(root, new THREE.BoxGeometry(w, 0.05, 0.024), barMat, [0, h - 0.026, z], null, false, false);
  }

  ctx.lightPanels = [];
  const panelGeo = new THREE.BoxGeometry(1.22, 0.04, 0.32);
  const frameGeo = new THREE.BoxGeometry(1.28, 0.06, 0.38);
  const diffuserMat = new THREE.MeshBasicMaterial({ color: 0xbfd8e6 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, metalness: 0.8, roughness: 0.35 });

  const spots = [];
  for (let x = -3.0; x <= 3.01; x += 1.5) spots.push([x, 0]);
  for (let x = -4.5; x <= 4.51; x += 3.0) { spots.push([x, -3.6]); spots.push([x, 3.5]); }
  spots.forEach(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, h - 0.05, z);
    const fr = new THREE.Mesh(frameGeo, frameMat);
    fr.castShadow = false;
    g.add(fr);
    const diff = new THREE.Mesh(panelGeo, diffuserMat);
    diff.position.y = -0.02;
    g.add(diff);
    root.add(g);
    ctx.lightPanels.push(diff);
  });

  // 吊顶喷淋头
  const sprMat = new THREE.MeshStandardMaterial({ color: 0x7c838a, metalness: 0.85, roughness: 0.45 });
  for (let x = -6; x <= 6; x += 3) {
    for (let z = -3.6; z <= 3.6; z += 3.6) {
      const y = h - 0.1;
      addMesh(root, new THREE.CylinderGeometry(0.012, 0.012, 0.08, 8), sprMat, [x, y, z], null, false, false);
      addMesh(root, new THREE.CylinderGeometry(0.028, 0.014, 0.03, 10), sprMat, [x, y - 0.05, z], null, false, false);
    }
  }

  // 烟感
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.65, metalness: 0.05 });
  [[-4.5, -2.2], [4.5, -2.2], [-4.5, 2.2], [4.5, 2.2], [0, 0]].forEach(([x, z]) => {
    const g = new THREE.Group();
    g.position.set(x, h - 0.07, z);
    addMesh(g, new THREE.CylinderGeometry(0.09, 0.1, 0.04, 18), smokeMat, [0, 0, 0], null, false, false);
    addMesh(g, new THREE.CylinderGeometry(0.055, 0.075, 0.03, 18), smokeMat, [0, -0.035, 0], null, false, false);
    root.add(g);
  });

  // CCTV 球机
  const camBody = new THREE.MeshStandardMaterial({ color: 0xe4e8ea, roughness: 0.5, metalness: 0.1 });
  const camGlass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.08, metalness: 0.2, clearcoat: 1 });
  ctx.cameras = [];
  [[-6.2, -4.1, 0.6], [6.2, 4.1, -0.6], [-6.2, 4.1, -0.6], [6.2, -4.1, 0.6]].forEach(([x, z, ry]) => {
    const g = new THREE.Group();
    g.position.set(x, h - 0.22, z);
    g.rotation.y = ry;
    addMesh(g, new THREE.CylinderGeometry(0.13, 0.15, 0.08, 20), camBody, [0, 0.04, 0], null, false, false);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), camGlass);
    dome.rotation.x = Math.PI;
    dome.position.y = -0.01;
    g.add(dome);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2233 }));
    led.position.set(0.07, 0.01, 0.06);
    g.add(led);
    root.add(g);
    ctx.cameras.push(g);
  });
}

/* ---------- 精密空调 ---------- */
function buildCooling(root, mat, ctx) {
  const { h } = ROOM;
  ctx.fans = [];
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 0.45, roughness: 0.42, envMapIntensity: 0.7 });
  const grille = new THREE.Group();

  [-2.5, 1.7].forEach((z, idx) => {
    const g = new THREE.Group();
    g.position.set(7.06, 0, z);
    g.rotation.y = -Math.PI / 2;
    root.add(g);

    // 柜体
    addMesh(g, buf.box(1.5, 2.06, 0.82, 0.012), bodyMat, [0, 1.03, 0]);
    // 前面板分缝
    addMesh(g, new THREE.BoxGeometry(1.42, 0.02, 0.02), mat.metal, [0, 1.62, 0.415], null, false);
    addMesh(g, new THREE.BoxGeometry(1.42, 0.02, 0.02), mat.metal, [0, 0.55, 0.415], null, false);
    // 回风格栅
    const grilleTex = makeGrilleTexture();
    const gm = new THREE.MeshStandardMaterial({ map: grilleTex, color: 0xcfd4d8, metalness: 0.3, roughness: 0.65 });
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.92), gm);
    gr.position.set(0, 0.98, 0.416);
    g.add(gr);
    // 顶部出风口
    addMesh(g, new THREE.BoxGeometry(1.3, 0.06, 0.6), mat.metal, [0, 2.08, 0.02], null, false);
    const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 8, 28), mat.metalLight);
    fanRing.rotation.x = Math.PI / 2;
    fanRing.position.set(0, 2.1, 0.02);
    g.add(fanRing);
    const fan = new THREE.Group();
    fan.position.set(0, 2.09, 0.02);
    for (let i = 0; i < 6; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.006, 0.06), mat.dark);
      blade.position.set(Math.cos(i / 6 * Math.PI * 2) * 0.12, 0, Math.sin(i / 6 * Math.PI * 2) * 0.12);
      blade.rotation.y = -i / 6 * Math.PI * 2;
      blade.rotation.z = 0.35;
      fan.add(blade);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), mat.metalLight);
    fan.add(hub);
    g.add(fan);
    ctx.fans.push({ mesh: fan, speed: 2.6 + idx * 0.4 });

    // 显示屏
    const lcd = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({
      map: TX.lcdPanelTexture('crac'), toneMapped: true
    }));
    lcd.position.set(0.42, 1.72, 0.418);
    g.add(lcd);
    addMesh(g, new THREE.BoxGeometry(0.38, 0.26, 0.02), mat.dark, [0.42, 1.72, 0.405], null, false);

    // 品牌标识
    // 底部排水
    addMesh(g, new THREE.CylinderGeometry(0.022, 0.022, 0.4, 10), mat.metalLight, [-0.55, 0.2, 0.3], [0, 0, 0.3], false);
    // 顶部管路
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 12), mat.metalLight);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 2.24, -0.2);
    g.add(pipe);
  });
}

function makeGrilleTexture() {
  return TX.cachedTexture('cracGrille', () => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 384;
    const x = c.getContext('2d');
    x.fillStyle = '#c9ced2'; x.fillRect(0, 0, 512, 384);
    x.fillStyle = '#7c848b';
    for (let y = 10; y < 384; y += 12) {
      x.fillRect(14, y, 484, 4);
      x.fillStyle = 'rgba(255,255,255,0.5)';
      x.fillRect(14, y - 2, 484, 1);
      x.fillStyle = '#7c848b';
    }
    x.strokeStyle = 'rgba(40,44,48,0.5)'; x.lineWidth = 6; x.strokeRect(3, 3, 506, 378);
    return new THREE.CanvasTexture(c);
  });
}

/* ---------- 电力区 ---------- */
function buildPower(root, mat, ctx) {
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x2e363e, metalness: 0.55, roughness: 0.5, envMapIntensity: 0.5 });
  const faceMat = new THREE.MeshStandardMaterial({ color: 0x1a2026, metalness: 0.6, roughness: 0.5 });

  // UPS 柜 ×2
  [-2.9, -2.0].forEach((z, i) => {
    const g = new THREE.Group();
    g.position.set(-7.12, 0, z);
    g.rotation.y = Math.PI / 2;
    root.add(g);
    addMesh(g, buf.box(0.86, 1.96, 0.78, 0.01), cabMat, [0, 0.98, 0]);
    addMesh(g, new THREE.BoxGeometry(0.8, 0.05, 0.02), mat.metalLight, [0, 1.72, 0.4], null, false);
    // 前门分缝 + 把手
    [0.0, 0.32, -0.32].forEach((x) => {
      addMesh(g, new THREE.BoxGeometry(0.008, 1.5, 0.008), mat.dark, [x, 0.95, 0.402], null, false, false);
    });
    addMesh(g, new THREE.BoxGeometry(0.02, 0.24, 0.02), mat.metalLight, [0.36, 1.02, 0.405], null, false, false);
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.11), new THREE.MeshBasicMaterial({
      map: TX.nameplateTexture(`UPS-0${i + 1}`, '不间断电源', '5000VA · 在线式双变换', '#ff8a5c')
    }));
    lbl.position.set(0, 1.9, 0.405);
    g.add(lbl);
    // LCD
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ map: TX.lcdPanelTexture('ups'), toneMapped: true }));
    screen.position.set(0, 1.42, 0.402);
    g.add(screen);
    addMesh(g, new THREE.BoxGeometry(0.34, 0.24, 0.015), mat.dark, [0, 1.42, 0.394], null, false);
    // 散热孔
    for (let k = 0; k < 12; k++) {
      addMesh(g, new THREE.BoxGeometry(0.6, 0.012, 0.01), mat.dark, [0, 0.4 + k * 0.045, 0.399], null, false, false);
    }
    // 警示牌
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ map: TX.signTexture('高压危险', '禁止操作', 'danger') }));
    sign.position.set(0.26, 1.05, 0.4);
    g.add(sign);
    // 顶部桥架
    addMesh(g, new THREE.BoxGeometry(0.9, 0.06, 0.7), mat.metal, [0, 1.99, 0], null, false);
    // 编号
    ctx.upsLabels = ctx.upsLabels || [];
    ctx.upsLabels.push({ pos: new THREE.Vector3(-7.1, 1.9, z), text: `UPS-0${i + 1}` });
  });

  // 电池柜 ×3
  [0.4, 1.25, 2.1].forEach((z) => {
    const g = new THREE.Group();
    g.position.set(-7.14, 0, z);
    g.rotation.y = Math.PI / 2;
    root.add(g);
    addMesh(g, buf.box(0.8, 1.92, 0.72, 0.01), cabMat, [0, 0.96, 0]);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 4; c++) {
        addMesh(g, new THREE.BoxGeometry(0.15, 0.14, 0.02), faceMat, [-0.27 + c * 0.18, 0.35 + r * 0.3, 0.365], null, false);
      }
    }
    addMesh(g, new THREE.BoxGeometry(0.76, 0.03, 0.02), mat.metalLight, [0, 1.78, 0.4], null, false);
    const bl = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.1), new THREE.MeshBasicMaterial({
      map: TX.nameplateTexture('BATT', '蓄电池组', '12V 100Ah × 40', '#ffb347')
    }));
    bl.position.set(0, 1.88, 0.372);
    g.add(bl);
    // 电池端子母线
    addMesh(g, new THREE.BoxGeometry(0.03, 0.5, 0.03), mat.metalLight, [0.3, 1.5, 0.37], null, false);
  });

  // 配电柜
  const dist = new THREE.Group();
  dist.position.set(-7.15, 0, 3.5);
  dist.rotation.y = Math.PI / 2;
  root.add(dist);
  addMesh(dist, buf.box(1.2, 2.0, 0.6, 0.008), cabMat, [0, 1.0, 0]);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.6), faceMat);
  panel.position.set(0, 1.05, 0.305);
  dist.add(panel);
  for (let r = 0; r < 6; r++) {
    addMesh(dist, new THREE.BoxGeometry(0.96, 0.03, 0.012), mat.metalLight, [0, 0.45 + r * 0.23, 0.312], null, false, false);
    for (let c = 0; c < 8; c++) {
      addMesh(dist, new THREE.BoxGeometry(0.05, 0.09, 0.02), mat.dark, [-0.42 + c * 0.12, 0.5 + r * 0.23, 0.315], null, false, false);
    }
  }
  const dSign = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.19), new THREE.MeshBasicMaterial({ map: TX.signTexture('配电重地', '非专业人员禁止操作', 'danger') }));
  dSign.position.set(0, 1.78, 0.31);
  dist.add(dSign);
}

/* ---------- 气体灭火 ---------- */
function buildFireSystem(root, mat, ctx) {
  const cylMat = new THREE.MeshStandardMaterial({ color: 0xa11d1d, metalness: 0.35, roughness: 0.42, envMapIntensity: 0.7 });
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6f1a1a, metalness: 0.5, roughness: 0.5 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 0.9, roughness: 0.35 });

  [-4.55, -3.85].forEach((z) => {
    const g = new THREE.Group();
    g.position.set(-6.85, 0, z);
    root.add(g);
    addMesh(g, new THREE.CylinderGeometry(0.17, 0.17, 1.42, 20), cylMat, [0, 0.75, 0]);
    addMesh(g, new THREE.SphereGeometry(0.17, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), cylMat, [0, 1.46, 0]);
    addMesh(g, new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), brass, [0, 1.61, 0]);
    // 阀门
    addMesh(g, new THREE.BoxGeometry(0.12, 0.09, 0.12), brass, [0, 1.68, 0]);
    addMesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.2, 8), brass, [0.1, 1.68, 0], [0, 0, Math.PI / 2]);
    // 喷放管
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 8), pipeMat);
    p.rotation.z = Math.PI / 2;
    p.rotation.y = Math.PI / 2;
    p.position.set(-0.6, 1.8, 0);
    g.add(p);
    // 固定支架
    addMesh(g, new THREE.BoxGeometry(0.5, 0.04, 0.04), mat.metal, [-0.2, 1.12, 0], null, false);
  });

  // 顶部灭火管道
  [-0.9, 0.9].forEach((z) => {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 14.2, 10), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 3.02, z);
    root.add(pipe);
    for (let x = -6.4; x <= 6.4; x += 1.6) {
      addMesh(root, new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), pipeMat, [x, 2.98, z], null, false, false);
      addMesh(root, new THREE.CylinderGeometry(0.05, 0.02, 0.06, 10), brass, [x, 2.92, z], null, false, false);
    }
  });

  // 控制盘
  const panel = new THREE.Group();
  panel.position.set(-7.44, 1.55, -1.2);
  panel.rotation.y = Math.PI / 2;
  root.add(panel);
  addMesh(panel, new THREE.BoxGeometry(0.5, 0.7, 0.1), new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.55, metalness: 0.1 }), [0, 0, 0]);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ map: TX.lcdPanelTexture('env'), toneMapped: true }));
  scr.position.set(0, 0.12, 0.052);
  panel.add(scr);
  for (let i = 0; i < 3; i++) {
    addMesh(panel, new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10), i === 0 ? mat.red : mat.yellow, [-0.1 + i * 0.1, -0.12, 0.055], [Math.PI / 2, 0, 0], false, false);
  }
  // 标识
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshBasicMaterial({ map: TX.signTexture('气体灭火', '请勿遮挡喷头', 'warn') }));
  sign.position.set(-7.46, 2.45, -2.9);
  sign.rotation.y = Math.PI / 2;
  root.add(sign);
}

/* ---------- 监控大屏 + 值守台 ---------- */
function buildVideoWall(root, mat, ctx) {
  const g = new THREE.Group();
  g.position.set(0, 0, -4.98);
  root.add(g);

  // 屏幕框
  addMesh(g, new THREE.BoxGeometry(2.46, 1.46, 0.1), mat.dark, [0, 2.62, 0]);
  addMesh(g, new THREE.BoxGeometry(2.54, 1.54, 0.04), mat.metal, [0, 2.62, -0.05], null, false);

  const dash = TX.createDashboard();
  ctx.dash = dash;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.29), new THREE.MeshBasicMaterial({
    map: dash.texture, toneMapped: true
  }));
  screen.position.set(0, 2.62, 0.056);
  g.add(screen);
  ctx.videoScreen = screen;

  // 屏幕辉光
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.9), new THREE.MeshBasicMaterial({
    map: makeGlowTexture(), color: 0x2a8fb0, transparent: true, opacity: 0.18,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  glow.position.set(0, 2.62, 0.02);
  g.add(glow);

  // 屏幕上方标识
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.24), new THREE.MeshBasicMaterial({
    map: TX.signTexture('A 区 · 运维监控中心', 'ZONE A · NOC', 'glass'), transparent: true
  }));
  sign.position.set(0, 1.78, 0.06);
  g.add(sign);

  // 值守台
  const desk = new THREE.Group();
  desk.position.set(0.4, 0, -3.55);
  root.add(desk);
  const deskTop = new THREE.MeshStandardMaterial({ color: 0x2b3137, roughness: 0.55, metalness: 0.3 });
  addMesh(desk, new THREE.BoxGeometry(2.2, 0.05, 0.8), deskTop, [0, 0.76, 0]);
  addMesh(desk, new THREE.BoxGeometry(2.16, 0.02, 0.76), mat.dark, [0, 0.73, 0], null, false);
  [[-1.02, 0], [1.02, 0]].forEach(([x, z]) => {
    addMesh(desk, new THREE.BoxGeometry(0.05, 0.74, 0.7), mat.metal, [x, 0.37, z]);
  });
  addMesh(desk, new THREE.BoxGeometry(2.0, 0.25, 0.03), mat.metal, [0, 0.35, -0.3], null, false);

  // 双显示器
  [-0.5, 0.5].forEach((x) => {
    const mon = new THREE.Group();
    mon.position.set(x, 0.78, -0.15);
    mon.rotation.y = -x * 0.25;
    desk.add(mon);
    addMesh(mon, new THREE.BoxGeometry(0.62, 0.37, 0.02), mat.dark, [0, 0.28, 0]);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.33), new THREE.MeshBasicMaterial({ map: dash.texture, toneMapped: true }));
    s.position.set(0, 0.28, 0.012);
    mon.add(s);
    addMesh(mon, new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), mat.metalLight, [0, 0.1, 0], null, false);
    addMesh(mon, new THREE.BoxGeometry(0.2, 0.015, 0.14), mat.metalLight, [0, 0.005, 0.02], null, false);
  });
  // 键盘
  addMesh(desk, new THREE.BoxGeometry(0.42, 0.018, 0.15), mat.dark, [0, 0.79, 0.2], null, false);
  addMesh(desk, new THREE.BoxGeometry(0.07, 0.02, 0.1), mat.dark, [0.34, 0.79, 0.2], null, false);

  // 椅子
  const chair = new THREE.Group();
  chair.position.set(0.4, 0, -2.9);
  chair.rotation.y = Math.PI + 0.15;
  root.add(chair);
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.85, metalness: 0.05 });
  addMesh(chair, new THREE.BoxGeometry(0.48, 0.08, 0.46), chairMat, [0, 0.46, 0]);
  addMesh(chair, new THREE.BoxGeometry(0.46, 0.6, 0.07), chairMat, [0, 0.78, -0.21], [-0.12, 0, 0]);
  addMesh(chair, new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), mat.metalLight, [0, 0.24, 0], null, false);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.05), mat.metalLight);
    leg.position.set(Math.cos(a) * 0.16, 0.05, Math.sin(a) * 0.16);
    leg.rotation.y = -a;
    chair.add(leg);
    const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), mat.dark);
    wheel.position.set(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3);
    chair.add(wheel);
  }
}

/* ---------- 入口 / 标识 ---------- */
function buildEntrance(root, mat, ctx) {
  const d = ROOM.d;
  const g = new THREE.Group();
  g.position.set(5.4, 0, d / 2 - 0.02);
  root.add(g);

  // 门框
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4249, metalness: 0.85, roughness: 0.3 });
  addMesh(g, new THREE.BoxGeometry(2.0, 2.24, 0.12), frameMat, [0, 1.12, -0.02], null, false);
  // 双开玻璃门
  const glassMat = mat.glass;
  [-0.47, 0.47].forEach((x) => {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 2.1), glassMat);
    leaf.position.set(x, 1.08, 0.04);
    g.add(leaf);
    addMesh(g, new THREE.BoxGeometry(0.94, 0.04, 0.05), frameMat, [x, 2.14, 0.04], null, false);
    addMesh(g, new THREE.BoxGeometry(0.94, 0.04, 0.05), frameMat, [x, 0.03, 0.04], null, false);
    addMesh(g, new THREE.BoxGeometry(0.04, 2.12, 0.05), frameMat, [x - 0.45, 1.08, 0.04], null, false);
    addMesh(g, new THREE.BoxGeometry(0.04, 2.12, 0.05), frameMat, [x + 0.45, 1.08, 0.04], null, false);
    // 拉手
    addMesh(g, new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), mat.metalLight, [x - Math.sign(x) * 0.36, 1.05, 0.1], null, false);
  });

  // 门禁读卡器
  const reader = new THREE.Group();
  reader.position.set(6.62, 1.15, d / 2 - 0.09);
  root.add(reader);
  addMesh(reader, new THREE.BoxGeometry(0.11, 0.18, 0.03), new THREE.MeshStandardMaterial({ color: 0x1c2228, metalness: 0.4, roughness: 0.4 }), [0, 0, 0], null, false);
  const rled = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), new THREE.MeshBasicMaterial({ color: 0x3fffa0 }));
  rled.position.set(0, 0.05, 0.017);
  reader.add(rled);
  const rScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.03), new THREE.MeshBasicMaterial({ color: 0x0a2a3a }));
  rScreen.position.set(0, 0.0, 0.017);
  reader.add(rScreen);

  // 门头标识
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.34), new THREE.MeshBasicMaterial({
    map: TX.signTexture('机房重地 · 闲人免进', 'AUTHORIZED PERSONNEL ONLY', 'glass'), transparent: true
  }));
  sign.position.set(5.4, 2.62, d / 2 - 0.03);
  sign.rotation.y = Math.PI;
  root.add(sign);

  // 侧墙警示
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ map: TX.signTexture('注意安全', '请勿倚靠机柜', 'warn') }));
  warn.position.set(7.44, 1.55, 2.6);
  warn.rotation.y = -Math.PI / 2;
  root.add(warn);
  const warn2 = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshBasicMaterial({
    map: TX.signTexture('冷通道 COLD AISLE', '保持通道畅通', 'glass'), transparent: true
  }));
  warn2.position.set(3.85, 2.3, 0);
  warn2.rotation.y = -Math.PI / 2;
  root.add(warn2);
}

/* ---------- 杂物：货架 / 工具车 / 备件 ---------- */
function buildProps(root, mat, ctx) {
  // 备件货架
  const shelf = new THREE.Group();
  shelf.position.set(-5.9, 0, 4.2);
  root.add(shelf);
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x8b949c, metalness: 0.8, roughness: 0.42 });
  // 立柱
  [[-0.9, -0.28], [0.9, -0.28], [-0.9, 0.28], [0.9, 0.28]].forEach(([x, z]) => {
    addMesh(shelf, new THREE.BoxGeometry(0.035, 1.9, 0.035), shelfMat, [x, 0.95, z]);
  });
  [0.18, 0.78, 1.38].forEach((y) => {
    addMesh(shelf, new THREE.BoxGeometry(1.9, 0.03, 0.6), shelfMat, [0, y, 0]);
    // 货物
    for (let i = 0; i < 3; i++) {
      const bw = 0.3 + Math.random() * 0.2;
      addMesh(shelf, new THREE.BoxGeometry(bw, 0.22, 0.34), new THREE.MeshStandardMaterial({ color: [0x9a7b52, 0x6c7a86, 0x7d8c6a][i], roughness: 0.85 }),
        [-0.62 + i * 0.62, y + 0.135, 0], null, true);
    }
  });

  // 工具车
  const cart = new THREE.Group();
  cart.position.set(-4.6, 0, 3.35);
  root.add(cart);
  const cartMat = new THREE.MeshStandardMaterial({ color: 0xb23a2a, metalness: 0.5, roughness: 0.45 });
  addMesh(cart, new THREE.BoxGeometry(0.6, 0.06, 0.4), cartMat, [0, 0.92, 0]);
  addMesh(cart, new THREE.BoxGeometry(0.56, 0.44, 0.36), cartMat, [0, 0.68, 0]);
  addMesh(cart, new THREE.BoxGeometry(0.56, 0.06, 0.36), cartMat, [0, 0.44, 0]);
  [[-0.26, -0.16], [0.26, -0.16], [-0.26, 0.16], [0.26, 0.16]].forEach(([x, z]) => {
    addMesh(cart, new THREE.CylinderGeometry(0.04, 0.04, 0.02, 8), mat.rubber, [x, 0.05, z], [0, 0, Math.PI / 2], false);
  });

  // 灭火器
  const ext = new THREE.Group();
  ext.position.set(6.9, 0, -3.6);
  root.add(ext);
  addMesh(ext, new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), mat.red, [0, 0.21, 0]);
  addMesh(ext, new THREE.CylinderGeometry(0.028, 0.028, 0.09, 10), mat.dark, [0, 0.46, 0], null, false);
  addMesh(ext, new THREE.BoxGeometry(0.05, 0.02, 0.18), mat.dark, [0, 0.51, 0.06], null, false);

  // 地面走线槽（沿墙）
  const trunking = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.3, roughness: 0.5 });
  addMesh(root, new THREE.BoxGeometry(0.14, 0.05, 8.6), trunking, [-7.4, 0.026, 0.6], null, false);
  addMesh(root, new THREE.BoxGeometry(13.6, 0.05, 0.14), trunking, [0, 0.026, -4.72], null, false);
}

/* ---------- 顶部桥架 ---------- */
function buildTrays(root, mat, ctx) {
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x6d747b, metalness: 0.85, roughness: 0.38 });
  const railGeo = new THREE.BoxGeometry(8.6, 0.07, 0.05);
  const rungGeo = new THREE.BoxGeometry(0.04, 0.02, 0.5);
  const rungCount = 27;
  const rungMesh = new THREE.InstancedMesh(rungGeo, trayMat, rungCount * 2);
  rungMesh.castShadow = true;
  const dummy = new THREE.Object3D();

  [-1.5, 1.5].forEach((z, row) => {
    // 侧梁
    addMesh(root, railGeo, trayMat, [0, 2.63, z - 0.26], null, true);
    addMesh(root, railGeo, trayMat, [0, 2.63, z + 0.26], null, true);
    for (let i = 0; i < rungCount; i++) {
      const x = -4.2 + i * (8.4 / (rungCount - 1));
      dummy.position.set(x, 2.6, z);
      dummy.updateMatrix();
      rungMesh.setMatrixAt(row * rungCount + i, dummy.matrix);
    }
  });
  rungMesh.instanceMatrix.needsUpdate = true;
  root.add(rungMesh);

  // 桥架内线缆束
  const cableMats = [
    new THREE.MeshStandardMaterial({ color: 0x1b3a5c, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x6d5722, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x1b4a3a, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.85 })
  ];
  [-1.5, 1.5].forEach((z, row) => {
    for (let c = 0; c < 4; c++) {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const x = -4.2 + i * 0.84;
        pts.push(new THREE.Vector3(x, 2.585 + Math.sin(i * 0.7 + c) * 0.008, z - 0.15 + c * 0.1));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.007 + (c % 2) * 0.003, 6, false), cableMats[c]);
      tube.castShadow = false;
      root.add(tube);
    }
  });

  // 引下至机柜顶部
  for (let i = 0; i < 10; i++) {
    const x = -2.79 + i * 0.62;
    [-1.5, 1.5].forEach((z) => {
      const pts = [
        new THREE.Vector3(x, 2.6, z),
        new THREE.Vector3(x + 0.02, 2.36, z),
        new THREE.Vector3(x + 0.02, 2.14, z)
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.016, 6, false), cableMats[3]);
      tube.castShadow = false;
      root.add(tube);
    });
  }

  // 端部封板
  [-4.3, 4.3].forEach((x) => {
    [-1.5, 1.5].forEach((z) => {
      addMesh(root, new THREE.BoxGeometry(0.06, 0.1, 0.56), trayMat, [x, 2.6, z], null, false);
    });
  });

  // 冷通道上方标识牌
  const aisleSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicMaterial({
    map: TX.signTexture('A-AISLE 01', '冷通道 · 22.4°C', 'glass'), transparent: true
  }));
  aisleSign.position.set(0, 2.52, 0.02);
  aisleSign.rotation.y = Math.PI;
  root.add(aisleSign);
  const aisleSign2 = aisleSign.clone();
  aisleSign2.position.set(0, 2.52, -0.02);
  aisleSign2.rotation.y = 0;
  root.add(aisleSign2);
}

/* ---------- 冷通道封闭端门 ---------- */
function buildContainment(root, mat, ctx) {
  const x = -3.63;
  const g = new THREE.Group();
  g.position.set(x, 0, 0);
  root.add(g);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b333b, metalness: 0.5, roughness: 0.5, envMapIntensity: 0.4 });
  [-0.98, 0.98].forEach((z) => {
    addMesh(g, new THREE.BoxGeometry(0.07, 2.3, 0.07), frameMat, [0, 1.15, z], null, true);
  });
  addMesh(g, new THREE.BoxGeometry(0.09, 0.08, 2.06), frameMat, [0, 2.28, 0], null, true);
  addMesh(g, new THREE.BoxGeometry(0.09, 0.05, 2.06), frameMat, [0, 0.03, 0], null, false);

  // 双开玻璃门
  [-0.47, 0.47].forEach((z) => {
    // 门扇常开：仅保留边框与开启的门扇轮廓，避免玻璃反射遮挡视线
    addMesh(g, new THREE.BoxGeometry(0.045, 2.18, 0.04), frameMat, [0, 1.12, z - 0.46], null, false);
    addMesh(g, new THREE.BoxGeometry(0.045, 0.05, 0.94), frameMat, [0, 2.19, z], null, false);
    addMesh(g, new THREE.BoxGeometry(0.045, 0.05, 0.94), frameMat, [0, 0.04, z], null, false);
  });

  // 顶部标识
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.2), new THREE.MeshBasicMaterial({
    map: TX.signTexture('A-AISLE 01', 'COLD AISLE · 22.4°C', 'glass'), transparent: true, side: THREE.DoubleSide
  }));
  sign.rotation.y = Math.PI / 2;
  sign.scale.x = -1;
  sign.position.set(0.055, 2.16, 0);
  g.add(sign);

  // 地面过门条
  const th = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.014, 1.94), new THREE.MeshStandardMaterial({ color: 0x6c737a, metalness: 0.7, roughness: 0.4 }));
  th.position.set(0, 0.007, 0);
  g.add(th);
}

/* ---------- 墙面品牌 ---------- */
function buildWallBranding(root, mat, ctx) {
  const x = -7.475;
  // 大型区域标识
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(10,16,22,0.92)';
  c.fillRect(0, 0, 1024, 256);
  c.strokeStyle = 'rgba(63,224,255,0.5)'; c.lineWidth = 4;
  c.strokeRect(6, 6, 1012, 244);
  c.fillStyle = '#5fe6ff';
  c.font = '700 118px "Consolas", monospace';
  c.fillText('IDC-02', 60, 152);
  c.fillStyle = 'rgba(190,225,245,0.75)';
  c.font = '500 40px "Microsoft YaHei"';
  c.fillText('A 区 · 核心机房', 62, 210);
  c.fillStyle = 'rgba(120,190,220,0.45)';
  c.font = '500 26px "Consolas"';
  c.fillText('ZONE A  /  POWER 480kW  /  PUE 1.28', 470, 208);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map, transparent: true }));
  panel.rotation.y = Math.PI / 2;
  panel.position.set(x, 2.62, 0.4);
  root.add(panel);

  // 安全出口
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({
    map: TX.signTexture('安全出口 EXIT', '', 'glass'), transparent: true
  }));
  exitSign.position.set(5.4, 2.92, 5.06);
  exitSign.rotation.y = Math.PI;
  root.add(exitSign);
}

/* ---------- 通风地板 / 氛围 ---------- */
export function buildFloorDetails(root, ctx) {
  const t = TX.perforatedTileTextures();
  const gm = new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, color: 0x6f757c, metalness: 0.45, roughness: 0.62, envMapIntensity: 0.6
  });
  const tileGeo = new THREE.PlaneGeometry(0.58, 0.58);
  const xs = [];
  for (let i = 0; i < 10; i++) xs.push(-2.79 + i * 0.62);
  ctx.perfTiles = [];
  xs.forEach((x) => {
    const tile = new THREE.Mesh(tileGeo, gm);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(x, 0.002, 0);
    tile.receiveShadow = true;
    root.add(tile);
    ctx.perfTiles.push(tile);
  });

  // 冷通道地面标识
  [-4.15, 4.15].forEach((x) => {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({
      map: TX.aisleDecalTexture(), transparent: true, opacity: 0.42, depthWrite: false
    }));
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    decal.position.set(x, 0.004, 0);
    root.add(decal);
  });

  // 黄色警示线
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd9b02e, transparent: true, opacity: 0.6 });
  [-6.3, 6.35].forEach((x) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 3.2), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.005, 4.0);
    root.add(l);
  });
}

/* ---------- 空气 / 尘埃 ---------- */
function buildAtmosphere(root, ctx) {
  // 冷气
  const spriteTex = makeSoftTexture();
  ctx.coldAir = [];
  for (let i = 0; i < 10; i++) {
    const x = -2.79 + i * 0.62;
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: spriteTex, color: 0x9fe8ff, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      s.position.set(x + (Math.random() - 0.5) * 0.3, 0.02, (Math.random() - 0.5) * 0.3);
      s.scale.setScalar(0.22);
      root.add(s);
      ctx.coldAir.push({ sprite: s, life: Math.random(), speed: 0.09 + Math.random() * 0.1, x, z: s.position.z });
    }
  }

  // 尘埃
  const N = 420;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 13;
    pos[i * 3 + 1] = Math.random() * 3.1 + 0.15;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 9;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.008, color: 0xbfd8e8, transparent: true, opacity: 0.35,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  root.add(dust);
  ctx.dust = dust;
}

function makeSoftTexture() {
  return TX.cachedTexture('softGlow', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(200,245,255,0.85)');
    g.addColorStop(0.35, 'rgba(160,225,255,0.35)');
    g.addColorStop(1, 'rgba(120,200,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  });
}
function makeGlowTexture() {
  return TX.cachedTexture('screenGlow', () => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 64, 0, 128, 64, 120);
    g.addColorStop(0, 'rgba(80,210,255,0.55)');
    g.addColorStop(0.5, 'rgba(40,140,190,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 128);
    return new THREE.CanvasTexture(c);
  });
}

export {
  addMesh, buf, buildCeiling, buildPower, buildFireSystem, buildVideoWall,
  buildEntrance, buildProps, buildContainment, buildWallBranding, buildAtmosphere,
};
