import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 *  Units — 1 world unit = 1 meter.  Standard 19" rack / 42U geometry.
 * ------------------------------------------------------------------ */
export const U = 0.04445;          // 1 rack unit in meters
export const U_COUNT = 42;
export const RACK_W = 0.6;
export const RACK_D = 1.2;
export const RACK_H = 2.0;
export const DEV_W = 0.4826;        // 19 inch
export const FRONT_Z = 0.55;        // front mounting plane (rack local z)
export const TILE = 0.6;

/* ---------------------------- helpers ----------------------------- */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const uid = (p = 'x') => `${p}_${Math.random().toString(36).slice(2, 8)}`;
export const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '--');
export const pct = (n) => `${Math.round(clamp(n, 0, 1) * 100)}%`;

export function clockStr(d = new Date(), withSec = true) {
  const p = (n) => String(n).padStart(2, '0');
  const s = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return withSec ? `${s}:${p(d.getSeconds())}` : s;
}

export function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/* --------------------------- textures ----------------------------- */
const texCache = new Map();

export function canvasTex(key, w, h, draw, opts = {}) {
  if (texCache.has(key)) return texCache.get(key);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  texCache.set(key, t);
  return t;
}

/** Device faceplate: brand, model, vent pattern, accent strip. */
export function faceplateTex(kind, cfg = {}) {
  const { brand = 'NEXUS', model = '', vent = 'slots', accent = '#35d6ff', tone = '#232a32' } = cfg;
  return canvasTex(`fp:${kind}:${model}:${vent}:${accent}`, 1024, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#2a3138');
    grad.addColorStop(0.06, tone);
    grad.addColorStop(0.94, '#111519');
    grad.addColorStop(1, '#0a0e11');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // brushed-metal streaks
    g.globalAlpha = 0.05;
    for (let i = 0; i < 90; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#000000';
      g.fillRect(0, Math.random() * h, w, 1);
    }
    g.globalAlpha = 1;

    // ventilation
    if (vent !== 'none') {
      const x0 = 300, x1 = 760;
      if (vent === 'slots') {
        for (let x = x0; x < x1; x += 15) {
          g.fillStyle = 'rgba(3,6,9,.82)';
          roundRect(g, x, 34, 7, 60, 3.5);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,.045)';
          g.fillRect(x, 34, 1.2, 60);
        }
      } else if (vent === 'mesh') {
        g.fillStyle = 'rgba(4,7,10,.8)';
        for (let y = 26; y < 108; y += 8) {
          for (let x = x0; x < x1; x += 8) {
            g.beginPath();
            g.arc(x, y, 2.1, 0, Math.PI * 2);
            g.fill();
          }
        }
      } else if (vent === 'grill') {
        for (let y = 30; y < 106; y += 9) {
          g.fillStyle = 'rgba(4,7,10,.75)';
          g.fillRect(x0, y, x1 - x0, 3);
        }
      }
    }

    // brand + model
    g.fillStyle = 'rgba(228,240,252,.9)';
    g.font = '700 27px "Segoe UI",sans-serif';
    g.textBaseline = 'middle';
    g.fillText(brand, 26, 44);
    g.font = '500 15px ui-monospace,monospace';
    g.fillStyle = 'rgba(160,186,208,.7)';
    g.fillText(model, 27, 76);

    // screws
    g.fillStyle = 'rgba(190,210,230,.22)';
    for (const x of [12, 1000]) {
      for (const y of [16, 112]) {
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
      }
    }
    // accent strip
    g.fillStyle = accent;
    g.globalAlpha = 0.55;
    g.fillRect(0, h - 3, w, 3);
    g.globalAlpha = 1;

    // right side handle marks
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.lineWidth = 2;
    g.strokeRect(9, 9, w - 18, h - 18);
  });
}

export function rackScaleTex() {
  return canvasTex('rack-scale', 96, 1024, (g, w, h) => {
    g.fillStyle = '#0a0e12';
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let u = U_COUNT; u >= 1; u--) {
      const y = ((U_COUNT - u + 0.5) / U_COUNT) * h;
      if (u % 2 === 0) {
        g.fillStyle = 'rgba(150,180,205,.55)';
        g.font = '500 26px ui-monospace,monospace';
        g.fillText(String(u), w / 2, y);
      }
      if (u % 4 === 0) {
        g.fillStyle = 'rgba(120,160,190,.2)';
        g.fillRect(0, y + 14, w, 1);
      }
    }
  });
}

export function labelTex(text, opts = {}) {
  const { color = '#dff2ff', bg = 'rgba(8,13,18,.9)', size = 64, font = '600' } = opts;
  return canvasTex(`label:${text}:${color}:${bg}:${size}`, 512, 128, (g, w, h) => {
    if (bg) {
      g.fillStyle = bg;
      roundRect(g, 4, 18, w - 8, h - 36, 22);
      g.fill();
      g.strokeStyle = 'rgba(90,200,255,.35)';
      g.lineWidth = 3;
      g.stroke();
    }
    g.fillStyle = color;
    g.font = `${font} ${size}px ui-monospace,monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
  });
}

/** Perforated floor tile (alpha map for holes). */
export function perfTileAlpha() {
  return canvasTex('perf-alpha', 128, 128, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    for (let y = 8; y < h - 6; y += 12) {
      for (let x = 8; x < w - 6; x += 12) {
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

export function aisleDecalTex(text) {
  return canvasTex(`decal:${text}`, 1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(53,214,255,.35)';
    g.lineWidth = 6;
    roundRect(g, 10, 10, w - 20, h - 20, 24);
    g.stroke();
    g.fillStyle = 'rgba(53,214,255,.55)';
    g.font = '600 84px ui-monospace,monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

export function disposeTree(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose?.();
    // materials may be shared — do not dispose here
  });
}
