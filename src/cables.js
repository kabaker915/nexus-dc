import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { portWorld } from './models.js';

const SPEED_COLOR = { 1: 0x2fc8f0, 10: 0x4d7cff, 25: 0x8b7bff, 100: 0xffb020, 0: 0x7f93a8 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Overhead-routed patch cables.
 *
 * Performance: all tubes are merged per link speed (≈4 draw calls instead of
 * one per cable) and every connector is a single InstancedMesh. Picking is
 * resolved from the merged mesh's face index through vertex ranges.
 */
export class CableSystem {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'cables';
    scene.add(this.group);
    this.entries = new Map();
    this.mats = new Map();
    this.selectedId = null;
    this.flow = 0;
    this.batchMeshes = [];
    this.connMesh = null;
    this.hiMesh = null;
    this._timer = null;

    this.connMat = new THREE.MeshStandardMaterial({ color: 0x1d252e, metalness: 0.85, roughness: 0.4 });
    this.hiMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0x9fe9ff, emissiveIntensity: 1.6, roughness: 0.3,
    });
  }

  material(speed) {
    if (this.mats.has(speed)) return this.mats.get(speed);
    const color = new THREE.Color(SPEED_COLOR[speed] ?? 0x8fa4b8);
    const m = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.18, roughness: 0.55, metalness: 0.25,
    });
    this.mats.set(speed, m);
    return m;
  }

  buildCurve(a, b, devA, devB) {
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    devA.group.getWorldQuaternion(qa);
    devB.group.getWorldQuaternion(qb);
    const nA = new THREE.Vector3(0, 0, 1).applyQuaternion(qa);
    const nB = new THREE.Vector3(0, 0, 1).applyQuaternion(qb);
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    devA.group.getWorldPosition(pa);
    devB.group.getWorldPosition(pb);

    const sideA = pa.x + (a.x >= pa.x ? 0.262 : -0.262);
    const sideB = pb.x + (b.x >= pb.x ? 0.262 : -0.262);
    const trayY = 2.42;

    const a1 = a.clone().addScaledVector(nA, 0.045);
    a1.y += 0.012;
    const a2 = new THREE.Vector3(sideA, a.y + 0.05, a.z + nA.z * 0.055);
    const a3 = new THREE.Vector3(sideA, trayY, a.z + nA.z * 0.055);

    const b1 = b.clone().addScaledVector(nB, 0.045);
    b1.y += 0.012;
    const b2 = new THREE.Vector3(sideB, b.y + 0.05, b.z + nB.z * 0.055);
    const b3 = new THREE.Vector3(sideB, trayY, b.z + nB.z * 0.055);

    const mid = a3.clone().lerp(b3, 0.5);
    mid.y = trayY - 0.04;

    return new THREE.CatmullRomCurve3([a, a1, a2, a3, mid, b3, b2, b1, b], false, 'catmullrom', 0.4);
  }

  add(cable, devA, devB) {
    this.remove(cable.id, true);
    const pa = devA.ports.find((p) => p.id === cable.a.portId);
    const pb = devB.ports.find((p) => p.id === cable.b.portId);
    if (!pa || !pb) return null;

    const A = portWorld(devA, pa);
    const B = portWorld(devB, pb);
    const curve = this.buildCurve(A, B, devA, devB);
    const speed = Math.min(pa.speed || 1, pb.speed || 1);

    const qa = devA.group.getWorldQuaternion(new THREE.Quaternion());
    const qb = devB.group.getWorldQuaternion(new THREE.Quaternion());
    const nA = new THREE.Vector3(0, 0, 1).applyQuaternion(qa);
    const nB = new THREE.Vector3(0, 0, 1).applyQuaternion(qb);

    this.entries.set(cable.id, {
      curve,
      speed,
      ends: [
        { pos: A.clone(), quat: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, nA) },
        { pos: B.clone(), quat: new THREE.Quaternion().setFromUnitVectors(Y_AXIS, nB) },
      ],
    });
    this.scheduleRebuild();
    return { userData: { cableId: cable.id } };
  }

  remove(id, quiet = false) {
    if (!this.entries.has(id)) return;
    this.entries.delete(id);
    if (this.selectedId === id) this.setSelected(null);
    if (!quiet) this.scheduleRebuild();
  }

  clear() {
    this.entries.clear();
    this.setSelected(null);
    this.scheduleRebuild();
  }

  scheduleRebuild() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.rebuild();
    }, 0);
  }

  rebuild() {
    for (const m of this.batchMeshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.batchMeshes = [];
    if (this.connMesh) {
      this.group.remove(this.connMesh);
      this.connMesh.geometry.dispose();
      this.connMesh = null;
    }

    const groups = new Map();
    for (const [id, e] of this.entries) {
      if (!groups.has(e.speed)) groups.set(e.speed, []);
      const geo = new THREE.TubeGeometry(e.curve, 64, 0.0019, 6, false).toNonIndexed();
      groups.get(e.speed).push({ id, geo, count: geo.attributes.position.count });
    }

    for (const [speed, list] of groups) {
      const merged = mergeGeometries(list.map((x) => x.geo), false);
      for (const item of list) item.geo.dispose();
      if (!merged) continue;
      const ranges = [];
      let start = 0;
      for (const item of list) {
        ranges.push({ id: item.id, start, count: item.count });
        start += item.count;
      }
      const mesh = new THREE.Mesh(merged, this.material(speed));
      mesh.userData.pickCable = true;
      mesh.userData.cableRanges = ranges;
      this.group.add(mesh);
      this.batchMeshes.push(mesh);
    }

    const total = this.entries.size * 2;
    if (total) {
      const geo = new THREE.CylinderGeometry(0.005, 0.005, 0.018, 10);
      const inst = new THREE.InstancedMesh(geo, this.connMat, total);
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const dummy = new THREE.Object3D();
      let i = 0;
      for (const e of this.entries.values()) {
        for (const end of e.ends) {
          dummy.position.copy(end.pos);
          dummy.quaternion.copy(end.quat);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          inst.setMatrixAt(i++, dummy.matrix);
        }
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.count = i;
      inst.frustumCulled = false;
      this.group.add(inst);
      this.connMesh = inst;
    }
  }

  setSelected(id) {
    if (this.hiMesh) {
      this.group.remove(this.hiMesh);
      this.hiMesh.geometry.dispose();
      this.hiMesh = null;
    }
    this.selectedId = id || null;
    if (!id) return;
    const e = this.entries.get(id);
    if (!e) return;
    const geo = new THREE.TubeGeometry(e.curve, 80, 0.0042, 8, false);
    this.hiMesh = new THREE.Mesh(geo, this.hiMat);
    this.hiMesh.renderOrder = 3;
    this.group.add(this.hiMesh);
  }

  tick(dt, throughput) {
    this.flow += dt;
    const glow = 0.16 + Math.min(1.2, throughput / 140) * 0.26 + Math.sin(this.flow * 2.2) * 0.04;
    for (const m of this.mats.values()) m.emissiveIntensity = glow;
  }
}
