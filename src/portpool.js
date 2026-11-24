import * as THREE from 'three';
import { portUpColor } from './catalog.js';

const localMatrix = new THREE.Matrix4();
const worldMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();

function portBaseColor(p) {
  switch (p.kind) {
    case 'sfp': return 0x3d4d61;
    case 'qsfp': return 0x484a66;
    case 'patch': return 0x5a6672;
    case 'power': return 0x6b4a33;
    default: return 0x4c5a67;
  }
}

/**
 * One global InstancedMesh for every port, one for every LED.
 * Replaces the per-device instanced meshes: ~45 + 45 draw calls become 2.
 * Device/port mapping is kept so picking and cable wiring still work.
 */
export class PortPool {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.capacity = 4096;
    this.portGeo = new THREE.BoxGeometry(1, 1, 1);
    this.ledGeo = new THREE.BoxGeometry(1, 1, 1);
    this.portMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.6 });
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.entries = new Map();
    this.indexMap = [];
    this._timer = null;
    this._color = new THREE.Color();
    this._buildMeshes(this.capacity);
  }

  _buildMeshes(capacity) {
    if (this.portMesh) {
      this.scene.remove(this.portMesh, this.ledMesh);
      this.portMesh.dispose();
      this.ledMesh.dispose();
    }
    this.capacity = capacity;
    this.portMesh = new THREE.InstancedMesh(this.portGeo, this.portMat, capacity);
    this.ledMesh = new THREE.InstancedMesh(this.ledGeo, this.ledMat, capacity);
    for (const m of [this.portMesh, this.ledMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
    }
    this.portMesh.userData.isPortPool = true;
    this.portMesh.userData.pool = this;
  }

  scheduleRebuild() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this.rebuild();
    }, 0);
  }

  rebuild() {
    const devices = Object.values(this.state.devices);
    let total = 0;
    for (const d of devices) total += d.ports.length;
    if (total > this.capacity) this._buildMeshes(Math.ceil(total * 1.5) + 1024);

    this.entries.clear();
    this.indexMap = [];
    let cursor = 0;
    for (const dev of devices) {
      const start = cursor;
      dev.group.updateWorldMatrix(true, false);
      for (let i = 0; i < dev.ports.length; i++) {
        const p = dev.ports[i];
        tmpPos.set(p.x, p.y, 0.0048);
        tmpQuat.identity();
        tmpScale.set(p.w, p.h, 0.0085);
        localMatrix.compose(tmpPos, tmpQuat, tmpScale);
        worldMatrix.multiplyMatrices(dev.group.matrixWorld, localMatrix);
        this.portMesh.setMatrixAt(cursor, worldMatrix);
        this.portMesh.setColorAt(cursor, this._color.setHex(portBaseColor(p)));

        tmpPos.set(p.x, p.y + p.h / 2 + 0.0034, 0.0095);
        tmpScale.set(0.0026, 0.0026, 0.0018);
        localMatrix.compose(tmpPos, tmpQuat, tmpScale);
        worldMatrix.multiplyMatrices(dev.group.matrixWorld, localMatrix);
        this.ledMesh.setMatrixAt(cursor, worldMatrix);
        this.ledMesh.setColorAt(cursor, this._color.setHex(0x080d12));

        this.indexMap[cursor] = { devId: dev.id, index: i };
        cursor++;
      }
      this.entries.set(dev.id, { start, count: dev.ports.length });
    }

    this.portMesh.count = cursor;
    this.ledMesh.count = cursor;
    this.portMesh.instanceMatrix.needsUpdate = true;
    this.portMesh.instanceColor.needsUpdate = true;
    this.ledMesh.instanceMatrix.needsUpdate = true;
    this.ledMesh.instanceColor.needsUpdate = true;
  }

  /** Resolve a raycast instanceId back to a device port. */
  pick(instanceId) {
    return this.indexMap[instanceId] || null;
  }

  updateDeviceLeds(dev, time) {
    const e = this.entries.get(dev.id);
    if (!e || !dev.ports.length) return;
    const online = dev.adminPower && dev.status !== 'offline';
    const booting = dev.status === 'rebooting';
    for (let i = 0; i < dev.ports.length; i++) {
      const p = dev.ports[i];
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
      this.ledMesh.setColorAt(e.start + i, this._color.setHex(hex).multiplyScalar(k));
    }
    this.ledMesh.instanceColor.needsUpdate = true;
  }
}
