/** Rack thermal heat volumes + cheap light shafts (P2 visual). */
import * as THREE from 'three';
import { RACK_W, RACK_D, clamp } from './util.js';

export class Thermal {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'thermal';
    this.group.visible = false;
    app.scene.add(this.group);
    this.boxes = new Map();
    this.shafts = new THREE.Group();
    this.shafts.visible = false;
    app.scene.add(this.shafts);
    this.shaftsBuilt = false;
    this._color = new THREE.Color();
  }

  ensureBoxes() {
    for (const rack of this.app.state.racks) {
      if (this.boxes.has(rack.id)) continue;
      const geo = new THREE.BoxGeometry(RACK_W + 0.16, 2.08, RACK_D + 0.16);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x35d6ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(rack.x, 1.02, rack.z);
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.boxes.set(rack.id, mesh);
    }
  }

  update() {
    if (!this.group.visible) return;
    this.ensureBoxes();
    for (const rack of this.app.state.racks) {
      const mesh = this.boxes.get(rack.id);
      if (!mesh) continue;
      const t = clamp(((rack.temp || 22) - 22) / 14, 0, 1);
      this._color.setHSL(0.55 - t * 0.55, 0.9, 0.5);
      mesh.material.color.copy(this._color);
      mesh.material.opacity = 0.07 + t * 0.13;
    }
  }

  setHeat(on) {
    this.group.visible = !!on;
    if (on) this.update();
  }

  buildShafts() {
    if (this.shaftsBuilt) return;
    this.shaftsBuilt = true;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfe4ff, transparent: true, opacity: 0.035,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 2; j++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.9, 16, 1, true), mat);
        cone.position.set(-4 + i * 2.0, 1.72, j === 0 ? -1.9 : 1.9);
        cone.rotation.x = Math.PI;
        this.shafts.add(cone);
      }
    }
  }

  setShafts(on) {
    if (on) this.buildShafts();
    this.shafts.visible = !!on;
  }
}
