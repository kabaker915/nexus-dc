import * as THREE from 'three';
import { RACK_W, RACK_D, clamp } from './util.js';

/**
 * First-person inspection mode.
 * WASD / arrows walk, Shift sprints, drag looks around, click picks a device
 * under the crosshair. Collision is axis-aligned against racks + room bounds.
 */
export class WalkMode {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.saved = null;
    this.drag = null;
    this.eye = 1.62;
    this.radius = 0.26;
    this.boxes = [];
    this.hud = document.getElementById('walk-hud');
    this.btn = document.getElementById('btn-walk');
    this.lamp = new THREE.PointLight(0xffe9d2, 0, 6.5, 2);
    this.lamp.visible = false;
    app.scene.add(this.lamp);
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    if (this.active) return;
    const { app } = this;
    if (app.view !== '3d') app.setView('3d');
    const cam = app.camera;
    this.saved = {
      pos: cam.position.clone(),
      target: app.controls.target.clone(),
      fov: cam.fov,
      order: cam.rotation.order,
    };
    app.controls.enabled = false;
    cam.position.set(
      clamp(cam.position.x, -6.2, 6.2),
      this.eye,
      Math.abs(cam.position.z) < 2.35 ? 0 : clamp(cam.position.z, -3.6, 3.6),
    );
    cam.rotation.order = 'YXZ';
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = 0;
    cam.fov = 58;
    cam.updateProjectionMatrix();
    cam.rotation.set(0, this.yaw, 0);

    this.boxes = app.state.racks.map((r) => ({
      x1: r.x - RACK_W / 2 - 0.06,
      x2: r.x + RACK_W / 2 + 0.06,
      z1: r.z - RACK_D / 2 - 0.06,
      z2: r.z + RACK_D / 2 + 0.06,
    }));
    if (app.props?.obstacles) this.boxes.push(...app.props.obstacles);

    this.active = true;
    this.hud?.classList.add('on');
    this.btn?.classList.add('on');
    this.lamp.visible = true;
    this.lamp.intensity = 2.6;
    this.lamp.position.copy(cam.position);
    app.toast('第一人称巡检：WASD 移动 · Shift 加速 · 拖拽环视 · 左键查看设备', 'ok');
    app.kick?.(3000);
  }

  exit() {
    if (!this.active) return;
    const { app } = this;
    this.active = false;
    this.keys.clear();
    this.drag = null;
    this.hud?.classList.remove('on');
    this.btn?.classList.remove('on');
    this.lamp.visible = false;
    this.lamp.intensity = 0;
    app.controls.enabled = true;
    if (this.saved) {
      app.camera.position.copy(this.saved.pos);
      app.controls.target.copy(this.saved.target);
      app.camera.fov = this.saved.fov;
      app.camera.rotation.order = this.saved.order;
      app.camera.updateProjectionMatrix();
      app.camera.lookAt(this.saved.target);
      this.saved = null;
    }
    app.toast('已退出巡检模式', 'ok');
    app.kick?.(1200);
  }

  keydown(e) {
    this.keys.add(e.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  }

  keyup(e) {
    this.keys.delete(e.code);
  }

  onDown(e) {
    this.drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  }

  onMove(e) {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    if (Math.hypot(e.clientX - this.drag.sx, e.clientY - this.drag.sy) > 4) this.drag.moved = true;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.yaw -= dx * 0.0028;
    this.pitch = clamp(this.pitch - dy * 0.0024, -1.15, 1.15);
    this.app.camera.rotation.set(this.pitch, this.yaw, 0);
    this.app.kick?.(500);
  }

  onUp() {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved) return;
    const hit = this.app.pickAtCenter?.();
    if (!hit) return;
    if (hit.port) {
      this.app.select({ type: 'device', id: hit.port.devId });
      const dev = this.app.state.devices[hit.port.devId];
      const port = dev?.ports[hit.port.index];
      if (port) this.app.ui?.focusPort?.(port);
    } else if (hit.device) {
      this.app.select({ type: 'device', id: hit.device });
    } else if (hit.cable) {
      this.app.select({ type: 'cable', id: hit.cable });
    } else if (hit.rack) {
      this.app.select({ type: 'rack', id: hit.rack });
    }
  }

  update(dt) {
    if (!this.active) return;
    const cam = this.app.camera;
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = (sprint ? 4.0 : 1.85) * dt;
    let f = 0;
    let s = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) s += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) s -= 1;
    if (f || s) {
      const len = Math.hypot(f, s) || 1;
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      const dx = (fx * f + rx * s) / len * speed;
      const dz = (fz * f + rz * s) / len * speed;
      this.move(dx, dz);
      this.app.kick?.(400);
    }
    cam.rotation.set(this.pitch, this.yaw, 0);
    if (cam.position.y !== this.eye) cam.position.y = this.eye;
    this.lamp.position.copy(cam.position);
    this.lamp.position.y -= 0.08;
  }

  walkable(x, z) {
    // Room is 13.2 × 11.2 m: keep the player inside the real walls
    // (half w 6.6 / half d 5.6) minus body radius, not the old tight box.
    if (x < -6.3 || x > 6.3 || z < -5.2 || z > 5.2) return false;
    const r = this.radius;
    for (const b of this.boxes) {
      if (x > b.x1 - r && x < b.x2 + r && z > b.z1 - r && z < b.z2 + r) return false;
    }
    return true;
  }

  move(dx, dz) {
    const cam = this.app.camera;
    const nx = cam.position.x + dx;
    const nz = cam.position.z + dz;
    if (this.walkable(nx, cam.position.z)) cam.position.x = nx;
    if (this.walkable(cam.position.x, nz)) cam.position.z = nz;
  }
}
