import * as THREE from 'three';
import { TILE, RACK_W, RACK_D, canvasTex, aisleDecalTex, labelTex } from './util.js';
import { MAT, UNIT_BOX, UNIT_PLANE } from './materials.js';

export const ROOM = { w: 13.2, d: 11.2, h: 3.4 };

/** Floor tiling + walls + ceiling lighting of the data hall. */
export function buildWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  /* ---------------- floor ---------------- */
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x0b0f13, metalness: 0.2, roughness: 0.9 });
  const base = new THREE.Mesh(UNIT_BOX, baseMat);
  base.scale.set(ROOM.w + 2, 0.06, ROOM.d + 2);
  base.position.y = -0.031;
  base.receiveShadow = true;
  root.add(base);

  const cols = Math.floor(ROOM.w / TILE);
  const rows = Math.floor(ROOM.d / TILE);
  const count = cols * rows;
  const tiles = new THREE.InstancedMesh(UNIT_BOX, MAT.floorTile, count);
  tiles.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let idx = 0;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -((cols - 1) * TILE) / 2 + i * TILE;
      const z = -((rows - 1) * TILE) / 2 + j * TILE;
      dummy.position.set(x, 0.004, z);
      dummy.scale.set(TILE - 0.012, 0.03, TILE - 0.012);
      dummy.updateMatrix();
      tiles.setMatrixAt(idx, dummy.matrix);
      const cold = Math.abs(z) < 0.95 && Math.abs(x) < 3.2;
      const v = 0.85 + Math.random() * 0.3;
      col.setHex(cold ? 0x1d2a34 : 0x191f25).multiplyScalar(v);
      tiles.setColorAt(idx, col);
      idx++;
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  tiles.instanceColor.needsUpdate = true;
  root.add(tiles);

  // cold-aisle floor decal
  const decal = new THREE.Mesh(
    UNIT_PLANE,
    new THREE.MeshBasicMaterial({ map: aisleDecalTex('COLD AISLE · A1-A6 / B1-B6'), transparent: true, opacity: 0.32, depthWrite: false }),
  );
  decal.scale.set(2.2, 0.55, 1);
  decal.rotation.x = -Math.PI / 2;
  decal.rotation.z = -Math.PI / 2;
  decal.position.set(0, 0.021, 0);
  root.add(decal);

  /* ---------------- walls ---------------- */
  const wallMat = MAT.wall;
  const mk = (sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(UNIT_BOX, wallMat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  };
  mk(ROOM.w + 2, ROOM.h, 0.2, 0, ROOM.h / 2, -ROOM.d / 2);
  mk(ROOM.w + 2, ROOM.h, 0.2, 0, ROOM.h / 2, ROOM.d / 2);
  mk(0.2, ROOM.h, ROOM.d, -ROOM.w / 2, ROOM.h / 2, 0);
  mk(0.2, ROOM.h, ROOM.d, ROOM.w / 2, ROOM.h / 2, 0);

  // wall panel seams
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x121a21, metalness: 0.5, roughness: 0.6 });
  for (let x = -ROOM.w / 2 + 1.2; x < ROOM.w / 2; x += 1.2) {
    const m = new THREE.Mesh(UNIT_BOX, seamMat);
    m.scale.set(0.03, ROOM.h - 0.2, 0.03);
    m.position.set(x, (ROOM.h - 0.2) / 2, -ROOM.d / 2 + 0.12);
    root.add(m);
  }

  // glowing wall strip (accent light)
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x1e7fa8, toneMapped: false });
  for (const z of [-ROOM.d / 2 + 0.14, ROOM.d / 2 - 0.14]) {
    const s = new THREE.Mesh(UNIT_BOX, stripMat);
    s.scale.set(ROOM.w - 1.0, 0.018, 0.02);
    s.position.set(0, 2.62, z);
    root.add(s);
  }

  /* ---------------- ceiling (open-frame: no slab so the hall reads as a cutaway) ---------------- */
  const overhead = new THREE.Group();
  overhead.name = 'overhead';
  root.add(overhead);

  const beamMat = new THREE.MeshStandardMaterial({ color: 0x0d1218, metalness: 0.6, roughness: 0.6 });
  for (const z of [-ROOM.d / 2 + 0.4, ROOM.d / 2 - 0.4]) {
    const beam = new THREE.Mesh(UNIT_BOX, beamMat);
    beam.scale.set(ROOM.w, 0.08, 0.12);
    beam.position.set(0, ROOM.h + 0.02, z);
    overhead.add(beam);
  }
  for (let i = 0; i <= 6; i++) {
    const cross = new THREE.Mesh(UNIT_BOX, beamMat);
    cross.scale.set(0.1, 0.07, ROOM.d);
    cross.position.set(-ROOM.w / 2 + (i * ROOM.w) / 6, ROOM.h + 0.03, 0);
    overhead.add(cross);
  }

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x1a2026, emissive: 0xa8d4f0, emissiveIntensity: 1.1, roughness: 0.9,
  });
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 2; j++) {
      const lamp = new THREE.Mesh(UNIT_BOX, lampMat);
      lamp.scale.set(1.4, 0.05, 0.2);
      lamp.position.set(-4 + i * 2.0, ROOM.h - 0.12, j === 0 ? -1.9 : 1.9);
      overhead.add(lamp);
    }
  }

  /* ---------------- precision air conditioners (CRAC) ---------------- */
  const cracGrille = canvasTex('crac-grille', 256, 512, (g, w, h) => {
    g.fillStyle = '#151b21';
    g.fillRect(0, 0, w, h);
    for (let y = 26; y < h - 20; y += 16) {
      g.fillStyle = 'rgba(4,7,10,.85)';
      g.fillRect(18, y, w - 36, 8);
      g.fillStyle = 'rgba(190,215,235,.06)';
      g.fillRect(18, y + 8, w - 36, 1);
    }
    g.strokeStyle = 'rgba(120,170,200,.18)';
    g.lineWidth = 3;
    g.strokeRect(10, 10, w - 20, h - 20);
  });

  const cracPanel = canvasTex('crac-panel', 256, 96, (g, w, h) => {
    g.fillStyle = '#050a0f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2fd0ff';
    g.font = '600 30px ui-monospace,monospace';
    g.textBaseline = 'middle';
    g.fillText('18.6°C', 16, 32);
    g.fillStyle = '#3ddc97';
    g.font = '500 22px ui-monospace,monospace';
    g.fillText('AUTO · 45%RH', 16, 66);
    g.strokeStyle = 'rgba(47,208,255,.5)';
    g.lineWidth = 2;
    g.strokeRect(6, 6, w - 12, h - 12);
  });

  const cracBody = new THREE.MeshStandardMaterial({ color: 0x1b222a, metalness: 0.55, roughness: 0.5 });
  const cracGrilleMat = new THREE.MeshStandardMaterial({ map: cracGrille, metalness: 0.4, roughness: 0.65 });
  const cracPanelMat = new THREE.MeshBasicMaterial({ map: cracPanel, toneMapped: false });

  const buildCrac = (x, z, ry, name) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    const body = new THREE.Mesh(UNIT_BOX, cracBody);
    body.scale.set(0.95, 2.1, 0.8);
    body.position.y = 1.05;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    const grille = new THREE.Mesh(UNIT_PLANE, cracGrilleMat);
    grille.scale.set(0.72, 1.3, 1);
    grille.position.set(0, 0.95, 0.401);
    g.add(grille);

    const panel = new THREE.Mesh(UNIT_PLANE, cracPanelMat);
    panel.scale.set(0.3, 0.115, 1);
    panel.position.set(0, 1.82, 0.401);
    g.add(panel);

    const label = new THREE.Mesh(UNIT_PLANE, new THREE.MeshBasicMaterial({ map: labelTex(name, { size: 90 }), transparent: true, color: 0xb8d2e4 }));
    label.scale.set(0.26, 0.06, 1);
    label.position.set(0, 2.0, 0.402);
    g.add(label);

    const skirt = new THREE.Mesh(UNIT_BOX, MAT.frame);
    skirt.scale.set(0.98, 0.08, 0.84);
    skirt.position.y = 0.04;
    g.add(skirt);
    root.add(g);
  };

  buildCrac(-5.6, -2.35, Math.PI / 2, 'CRAC-01');
  buildCrac(-5.6, 2.35, Math.PI / 2, 'CRAC-02');
  buildCrac(5.6, -2.35, -Math.PI / 2, 'CRAC-03');
  buildCrac(5.6, 2.35, -Math.PI / 2, 'CRAC-04');

  /* ---------------- overhead cable trays ---------------- */
  const trayMat = MAT.tray;
  for (const z of [-1.92, 1.92]) {
    const bottom = new THREE.Mesh(UNIT_BOX, trayMat);
    bottom.scale.set(4.6, 0.02, 0.36);
    bottom.position.set(0, 2.34, z);
    bottom.castShadow = true;
    root.add(bottom);
    for (const s of [-1, 1]) {
      const lip = new THREE.Mesh(UNIT_BOX, trayMat);
      lip.scale.set(4.6, 0.1, 0.015);
      lip.position.set(0, 2.39, z + s * 0.18);
      root.add(lip);
    }
    for (let i = 0; i < 5; i++) {
      const hang = new THREE.Mesh(UNIT_BOX, MAT.frameLight);
      hang.scale.set(0.018, 0.9, 0.018);
      hang.position.set(-2 + i, 2.8, z);
      root.add(hang);
    }
  }

  return { root, tiles, overhead };
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0x9cc6ff, 0x121820, 0.85);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xdcecff, 1.95);
  key.position.set(4.5, 7.5, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 26;
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x6fa8ff, 0.9);
  fill.position.set(-6, 4.5, -5);
  scene.add(fill);

  const front = new THREE.DirectionalLight(0xbcd8ff, 0.5);
  front.position.set(0, 2.4, 7);
  scene.add(front);

  const aisle = new THREE.PointLight(0x4fd6ff, 2.2, 8, 2);
  aisle.position.set(0, 2.25, 0);
  scene.add(aisle);

  // aisle face wash — makes the rack fronts readable in the corridor view
  for (const x of [-2.2, 0, 2.2]) {
    const l = new THREE.PointLight(0xcfe6ff, 3.0, 6, 2);
    l.position.set(x, 1.7, 0.05);
    scene.add(l);
  }

  scene.fog = new THREE.FogExp2(0x05080c, 0.02);
  return { key, fill, aisle };
}

