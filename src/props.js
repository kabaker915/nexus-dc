import * as THREE from 'three';
import { ROOM } from './world.js';
import {
  ROOM as PACK, materials, buildCeiling, buildPower, buildFireSystem,
  buildVideoWall, buildEntrance, buildProps, buildContainment,
  buildWallBranding, buildAtmosphere,
} from './roompack.js';
import * as TX from './paneltex.js';

/**
 * Infrastructure props from the DCIM modeling pack, re-fitted into our hall:
 * ceiling + light panels, UPS/battery room, fire suppression, NOC video wall,
 * entrance, storage/tool props, cold-aisle end door and atmosphere particles.
 */
export class Props {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group();
    this.root.name = 'room-props';
    app.scene.add(this.root);
    this.ctx = {};
    this.groups = {};
    this.lastDash = 0;
    this.obstacles = [
      { x1: -6.55, x2: -5.75, z1: -3.7, z2: 4.1 },   // UPS / battery / distribution
      { x1: -6.25, x2: -5.55, z1: -4.9, z2: -3.5 },  // gas cylinders
      { x1: -6.15, x2: -4.35, z1: 3.55, z2: 4.55 },  // spare-parts shelf
      { x1: -4.7, x2: -3.8, z1: 2.85, z2: 3.85 },    // tool cart
      // Cold-aisle end door: only the two posts collide, the open doorway is walkable.
      { x1: 1.95, x2: 2.15, z1: -1.1, z2: -0.86 },
      { x1: 1.95, x2: 2.15, z1: 0.86, z2: 1.1 },
    ];

    const mat = materials();
    const add = (name, builder, transform) => {
      const g = new THREE.Group();
      builder(g, mat, this.ctx);
      transform?.(g);
      g.name = `props-${name}`;
      this.root.add(g);
      this.groups[name] = g;
      return g;
    };

    // Ceiling scale follows our 13.2 × 11.2 hall instead of the pack's 15 × 10.2.
    const ceiling = add('ceiling', buildCeiling, (g) => {
      g.scale.set(ROOM.w / PACK.w, 1, ROOM.d / PACK.d);
    });
    // Blend the pack's bright office ceiling into our dark hall.
    mat.ceiling.color.setHex(0x39434c);
    ceiling.traverse((o) => {
      const c = o.isMesh ? o.material?.color : null;
      if (!c) return;
      const hex = c.getHex();
      if (hex === 0xc9ced2) c.setHex(0x6f7981);
      if (hex === 0xbfd8e6) c.setHex(0x9fb8c6);
    });

    this.lights = [
      new THREE.PointLight(0xffdcb8, 18, 6.0, 2),
      new THREE.PointLight(0xbfe8ff, 14, 4.8, 2),
      new THREE.PointLight(0xffb7a0, 8, 4.0, 2),
    ];
    this.lights[0].position.set(-5.9, 2.35, 0.5);
    this.lights[1].position.set(0, 2.55, -4.95);
    this.lights[2].position.set(-5.8, 2.2, -4.1);
    for (const l of this.lights) app.scene.add(l);
    add('power', buildPower, (g) => { g.position.x = 1.0; });
    add('fire', buildFireSystem, (g) => { g.position.x = 0.95; });
    const video = add('video', buildVideoWall, (g) => { g.position.z = -0.5; });
    video.traverse((o) => {
      if (o.isMesh && o.material?.blending === THREE.AdditiveBlending) o.material.opacity = 0.06;
    });
    add('entrance', buildEntrance, (g) => { g.position.z = 0.42; });
    add('props', buildProps, (g) => { g.scale.set(0.9, 1, 0.95); g.position.x = 0.08; });
    add('containment', buildContainment, (g) => {
      g.position.x = 5.68;
      g.rotation.y = Math.PI;
    });
    add('branding', buildWallBranding, (g) => { g.position.x = 1.0; });
    add('atmosphere', buildAtmosphere);

    this.app.touchShadows?.();
    this.drawDashboard();
  }

  setCamera(cam) {
    if (this.groups.ceiling) this.groups.ceiling.visible = cam.position.y < 5.0;
  }

  drawDashboard() {
    const dash = this.ctx.dash;
    if (!dash) return;
    const { sim, state } = this.app;
    const st = sim.stats;
    const hist = (sim.history?.power || []).slice(-40);
    const racks = state.racks.slice(0, 10).map((r) => Math.min(1, (r.power || 0) / (r.powerCap || 8)));
    const events = sim.events.slice(0, 5).map((e) => ({
      time: new Date(e.t).toLocaleTimeString('zh-CN', { hour12: false }),
      text: String(e.text).slice(0, 30),
      level: e.level === 'error' ? 'crit' : e.level === 'warn' ? 'warn' : 'info',
    }));
    TX.drawDashboard(dash, {
      clock: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      online: st.online,
      total: st.devices,
      power: st.power,
      temp: st.avgTemp,
      pue: st.pue,
      history: hist.length > 1 ? hist : [st.power, st.power],
      racks: racks.length ? racks : [0.2],
      events,
    });
  }

  update(dt, t) {
    this.setCamera(this.app.camera);
    const ctx = this.ctx;
    if (ctx.coldAir) {
      for (const p of ctx.coldAir) {
        p.life += dt * p.speed;
        if (p.life > 1) {
          p.life = 0;
          p.sprite.position.x = p.x + (Math.random() - 0.5) * 0.32;
          p.sprite.position.z = p.z + (Math.random() - 0.5) * 0.3;
        }
        p.sprite.position.y = 0.02 + p.life * 1.1;
        p.sprite.material.opacity = Math.sin(p.life * Math.PI) * 0.16;
        p.sprite.scale.setScalar(0.16 + p.life * 0.3);
      }
    }
    if (ctx.dust) {
      ctx.dust.rotation.y += dt * 0.004;
      ctx.dust.position.y = Math.sin(t * 0.12) * 0.05;
    }
    if (ctx.lightPanels) {
      const glow = 0.72 + Math.sin(t * 0.7) * 0.03;
      for (let i = 0; i < ctx.lightPanels.length; i++) {
        const p = ctx.lightPanels[i];
        p.material.color.setHSL(0.55, 0.18, glow * 0.82);
      }
    }
    if (ctx.dash && performance.now() - this.lastDash > 2000) {
      this.lastDash = performance.now();
      this.drawDashboard();
    }
  }
}
