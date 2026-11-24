/* ============================================================
   程序化贴图工厂 —— 全部由 canvas 生成，不依赖任何外部素材
   ============================================================ */
import * as THREE from 'three';

let ANISO = 8;
export function setAnisotropy(n) { ANISO = Math.min(16, n || 8); }

const cache = new Map();
function memo(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

/** 供其它模块复用的缓存画布贴图（自动按 sRGB 处理） */
export function cachedTexture(key, build) {
  return memo(`ct:${key}`, () => {
    const t = build();
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO;
    return t;
  });
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function ctxOf(c) { return c.getContext('2d'); }

function toTexture(cv, { srgb = false, repeat = null, clamp = false } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = ANISO;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ---------- 小工具 ---------- */
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}
function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([p, c]) => g.addColorStop(p, c));
  ctx.fillStyle = g;
}
function spacedText(ctx, text, x, y, spacing = 1) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
}
function sparkle(ctx, w, h, count, alpha, size = 1.2, seed = 1) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const a = alpha * (0.35 + rnd() * 0.65);
    ctx.fillStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},${a})`;
    ctx.fillRect(x, y, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
  ctx.restore();
}
function heightToNormal(srcCanvas, strength = 2.2, outSize = 512) {
  const size = outSize;
  const src = document.createElement('canvas');
  src.width = src.height = size;
  src.getContext('2d').drawImage(srcCanvas, 0, 0, size, size);
  const data = src.getContext('2d').getImageData(0, 0, size, size).data;
  const out = canvas(size, size);
  const octx = out.getContext('2d');
  const img = octx.createImageData(size, size);
  const H = (x, y) => {
    x = (x + size) % size; y = (y + size) % size;
    const i = (y * size + x) * 4;
    return (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ============================================================
   地面：防静电地板 / 架空地板
   ============================================================ */
export function floorTextures() {
  return memo('floor', () => {
    const S = 1024;
    const cv = canvas(S, S), ctx = ctxOf(cv);
    // 基色
    grad(ctx, 0, 0, S, S, [[0, '#7c8288'], [0.5, '#767c82'], [1, '#6f757b']]);
    ctx.fillRect(0, 0, S, S);
    // 细密颗粒
    let s = 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26000; i++) {
      const x = rnd() * S, y = rnd() * S;
      const v = 90 + Math.floor(rnd() * 80);
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.18 + rnd() * 0.3})`;
      ctx.fillRect(x, y, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
    // 大块云状污渍
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 160;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() > 0.5;
      g.addColorStop(0, dark ? 'rgba(58,62,66,0.09)' : 'rgba(200,206,212,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 四边缝隙（每块 600mm）
    ctx.strokeStyle = 'rgba(30,33,36,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
    ctx.strokeStyle = 'rgba(215,222,228,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, S - 10, S - 10);
    // 边缘磨损
    ctx.strokeStyle = 'rgba(38,41,44,0.16)';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, S - 16, S - 16);

    const map = toTexture(cv, { srgb: true });
    map.repeat.set(25, 17);

    // 高度图 → 法线
    const hv = canvas(512, 512), hc = ctxOf(hv);
    hc.fillStyle = '#8a8a8a'; hc.fillRect(0, 0, 512, 512);
    hc.strokeStyle = '#111'; hc.lineWidth = 3; hc.strokeRect(1, 1, 510, 510);
    sparkle(hc, 512, 512, 4000, 0.25, 1, 7);
    const normalMap = toTexture(heightToNormal(hv, 0.55), {});
    normalMap.repeat.set(25, 17);

    // 粗糙度：中间略亮（更粗糙），缝隙更暗（更光滑的灰）
    const rv = canvas(512, 512), rc = ctxOf(rv);
    rc.fillStyle = '#9d9d9d'; rc.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 60; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 20 + rnd() * 110;
      const g = rc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.05 + rnd() * 0.1})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      rc.fillStyle = g; rc.fillRect(x - r, y - r, r * 2, r * 2);
    }
    rc.strokeStyle = '#5a5a5a'; rc.lineWidth = 4; rc.strokeRect(0, 0, 512, 512);
    const roughnessMap = toTexture(rv, {});
    roughnessMap.repeat.set(25, 17);

    return { map, normalMap, roughnessMap };
  });
}

/* ============================================================
   通风地板（冷通道穿孔砖）
   ============================================================ */
export function perforatedTileTextures() {
  return memo('perfTile', () => {
    const S = 512;
    const cv = canvas(S, S), ctx = ctxOf(cv);
    ctx.fillStyle = '#5f656b';
    ctx.fillRect(0, 0, S, S);
    sparkle(ctx, S, S, 6000, 0.16, 1.2, 3);
    // 边框
    ctx.strokeStyle = '#3d4247'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, S - 8, S - 8);
    // 孔阵
    const pitch = 15, r = 4.4;
    for (let y = 30; y < S - 24; y += pitch) {
      for (let x = 30; x < S - 24; x += pitch) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0a0c0e';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x - 0.8, y - 0.8, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(20,24,28,0.85)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
    // 中心锁扣
    ctx.fillStyle = '#2b3035';
    ctx.beginPath(); ctx.arc(S / 2, S / 2, 9, 0, Math.PI * 2); ctx.fill();

    const hv = canvas(512, 512), hc = ctxOf(hv);
    hc.fillStyle = '#bdbdbd'; hc.fillRect(0, 0, 512, 512);
    hc.fillStyle = '#000';
    for (let y = 30; y < S - 24; y += pitch) {
      for (let x = 30; x < S - 24; x += pitch) {
        hc.beginPath(); hc.arc(x, y, r, 0, Math.PI * 2); hc.fill();
      }
    }
    const map = toTexture(cv, { srgb: true, clamp: true });
    const normalMap = toTexture(heightToNormal(hv, 2.6), { clamp: true });
    return { map, normalMap };
  });
}

/* ============================================================
   墙面 / 吊顶
   ============================================================ */
export function wallTextures() {
  return memo('wall', () => {
    const W = 1024, H = 1024;
    const cv = canvas(W, H), ctx = ctxOf(cv);
    grad(ctx, 0, 0, 0, H, [[0, '#c4cad0'], [0.55, '#bcc2c8'], [1, '#b3b9bf']]);
    ctx.fillRect(0, 0, W, H);
    sparkle(ctx, W, H, 9000, 0.05, 1.4, 11);
    // 竖向板缝
    ctx.strokeStyle = 'rgba(90,98,106,0.22)'; ctx.lineWidth = 2;
    for (let x = 0; x <= W; x += W / 4) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // 横向分缝
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(W, 8); ctx.stroke();
    // 轻微竖向流痕
    let rs = 90210;
    const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 40; i++) {
      const x = rnd() * W;
      const g = ctx.createLinearGradient(x, 0, x, H);
      g.addColorStop(0, 'rgba(120,126,132,0.05)');
      g.addColorStop(1, 'rgba(120,126,132,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 2 + rnd() * 16, H);
    }
    const map = toTexture(cv, { srgb: true });
    map.repeat.set(1, 1);
    const rv = canvas(256, 256), rc = ctxOf(rv);
    rc.fillStyle = '#c8c8c8'; rc.fillRect(0, 0, 256, 256);
    sparkle(rc, 256, 256, 900, 0.06, 2, 5);
    const roughnessMap = toTexture(rv, {});
    roughnessMap.repeat.set(4, 2);
    return { map, roughnessMap };
  });
}

export function ceilingTextures() {
  return memo('ceiling', () => {
    const S = 512;
    const cv = canvas(S, S), ctx = ctxOf(cv);
    ctx.fillStyle = '#9aa1a7'; ctx.fillRect(0, 0, S, S);
    sparkle(ctx, S, S, 12000, 0.09, 1.1, 17);
    // 矿棉板纹理
    let cs = 4477;
    const crnd = () => (cs = (cs * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 220; i++) {
      const x = crnd() * S, y = crnd() * S, r = 1 + crnd() * 3;
      ctx.fillStyle = `rgba(60,64,68,${0.04 + crnd() * 0.05})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(70,76,82,0.5)'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, S - 4, S - 4);
    const map = toTexture(cv, { srgb: true });
    map.repeat.set(12, 8);
    return { map };
  });
}

/* ============================================================
   拉丝金属（机柜顶板 / 侧板）
   ============================================================ */
export function brushedMetalTextures() {
  return memo('brushed', () => {
    const S = 512;
    const cv = canvas(S, S), ctx = ctxOf(cv);
    ctx.fillStyle = '#33383d'; ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const y = (i * 17) % S;
      const a = 0.02 + ((i * 13) % 10) / 10 * 0.05;
      ctx.fillStyle = `rgba(${140 + (i % 60)},${150 + (i % 50)},${160 + (i % 40)},${a})`;
      ctx.fillRect(0, y, S, 1);
    }
    const map = toTexture(cv, { srgb: true });
    map.repeat.set(2, 2);
    const rv = canvas(256, 256), rc = ctxOf(rv);
    rc.fillStyle = '#8c8c8c'; rc.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const y = (i * 11) % 256;
      rc.fillStyle = `rgba(255,255,255,${0.02 + ((i * 7) % 10) / 10 * 0.05})`;
      rc.fillRect(0, y, 256, 1);
    }
    const roughnessMap = toTexture(rv, {});
    roughnessMap.repeat.set(2, 2);
    return { map, roughnessMap };
  });
}

/* ============================================================
   机柜门：穿孔网板（alpha 裁剪）
   ============================================================ */
export function rackDoorTextures() {
  return memo('rackDoor', () => {
    const W = 384, H = 1024;
    // 颜色
    const cv = canvas(W, H), ctx = ctxOf(cv);
    grad(ctx, 0, 0, W, 0, [[0, '#23272c'], [0.35, '#1c2024'], [0.7, '#191d21'], [1, '#15181c']]);
    ctx.fillRect(0, 0, W, H);
    // 竖向拉丝
    for (let i = 0; i < 160; i++) {
      const x = ((i * 79) % W);
      const v = 120 + ((i * 31) % 60);
      ctx.fillStyle = `rgba(${v},${v + 10},${v + 20},${0.004 + ((i * 17) % 10) / 10 * 0.008})`;
      ctx.fillRect(x, 0, 1, H);
    }
    // 孔洞（颜色贴图上也画出，近看有网板质感）
    const holeCell = 7, holeR = 2.35;
    for (let y = 96; y < H - 54; y += holeCell) {
      for (let x = 30; x < W - 30; x += holeCell) {
        ctx.beginPath();
        ctx.arc(x + 3, y + 3, holeR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(4,6,8,0.92)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + 2.3, y + 2.3, holeR * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(58,66,74,0.5)';
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, W - 28, H - 28);

    // alpha：白色=实体
    const av = canvas(W, H), ac = ctxOf(av);
    ac.fillStyle = '#ffffff'; ac.fillRect(0, 0, W, H);
    const frame = 30;
    const topBand = 96;
    // 孔区
    ac.fillStyle = '#000';
    const x0 = frame, x1 = W - frame, y0 = topBand, y1 = H - 54;
    const pitch = 8, rad = 2.05;
    for (let y = y0; y < y1; y += pitch) {
      for (let x = x0; x < x1; x += pitch) {
        ac.beginPath(); ac.arc(x + 4, y + 4, rad, 0, Math.PI * 2); ac.fill();
      }
    }
    // 底部通风槽
    for (let i = 0; i < 3; i++) {
      ac.fillRect(frame + 10, H - 46 + i * 12, W - frame * 2 - 20, 6);
    }
    // 顶部铭牌区（保留实体）
    ac.fillStyle = '#ffffff';
    ac.fillRect(frame, 16, W - frame * 2, topBand - 22);
    // 门轴缺口
    ac.fillRect(0, 100, 12, H - 220);

    // 网孔法线，让门板在掠射光下有金属网质感
    const nv = canvas(512, 512), nc = ctxOf(nv);
    nc.fillStyle = '#9a9a9a'; nc.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 10) {
      for (let x = 0; x < 512; x += 10) {
        nc.beginPath(); nc.arc(x + 5, y + 5, 3.4, 0, Math.PI * 2);
        nc.fillStyle = '#242424'; nc.fill();
      }
    }
    const normalMap = toTexture(heightToNormal(nv, 1.6, 512), { clamp: true });

    return {
      map: toTexture(cv, { srgb: true, clamp: true }),
      alphaMap: toTexture(av, { clamp: true }),
      normalMap
    };
  });
}

/* ============================================================
   设备面板
   ============================================================ */
const P = {
  bg0: '#4c545f', bg1: '#333a42', edge: '#616c78',
  bay: '#1d2126', bayDark: '#0e1013', text: '#6f7b88', textDim: '#4b555f',
  brand: '#93a2b1'
};

function plate(ctx, w, h) {
  grad(ctx, 0, 0, 0, h, [[0, P.bg0], [0.45, '#39414a'], [1, P.bg1]]);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(0, 0, w, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, h - 2, w, 2);
  // 拉丝
  for (let i = 0; i < 70; i++) {
    const a = 0.008 + ((i * 37) % 13) / 13 * 0.012;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(0, ((i * 131) % Math.max(1, h - 1)), w, 1);
  }
}

function ventArea(ctx, x, y, w, h, pitch = 9, r = 2.6) {
  ctx.save();
  rr(ctx, x, y, w, h, 2); ctx.clip();
  ctx.fillStyle = '#0b0e12'; ctx.fillRect(x, y, w, h);
  for (let yy = y + 4; yy < y + h; yy += pitch) {
    for (let xx = x + 4; xx < x + w; xx += pitch) {
      ctx.beginPath();
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#242a31';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(xx - 0.5, yy - 0.5, r * 0.68, 0, Math.PI * 2);
      ctx.fillStyle = '#0d1013';
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function screws(ctx, w, h, inset = 10) {
  [[inset, inset], [w - inset, inset], [inset, h - inset], [w - inset, h - inset]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0c0e'; ctx.fill();
    ctx.beginPath(); ctx.arc(x - 0.4, y - 0.6, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#4a525b'; ctx.fill();
  });
}

function ledDot(ctx, x, y, color, r = 2.2) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, Math.PI * 2); ctx.fill();
}

function driveBay(ctx, x, y, w, h, dark = false) {
  rr(ctx, x, y, w, h, 2.5);
  grad(ctx, 0, y, 0, y + h, dark
    ? [[0, '#252a30'], [1, '#14171b']]
    : [[0, '#39414a'], [0.5, '#2a3037'], [1, '#1d2228']]);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
  // 拉手凹槽
  rr(ctx, x + 4, y + h * 0.36, w - 8, Math.max(3, h * 0.18), 1.5);
  ctx.fillStyle = '#080a0c'; ctx.fill();
  // 卡扣
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(x + w - 8, y + h * 0.18, 3, h * 0.22);
}

function brandBlock(ctx, x, y, brand, model, align = 'left') {
  ctx.textAlign = align;
  ctx.fillStyle = P.brand;
  ctx.font = '600 19px "Segoe UI", Arial, sans-serif';
  spacedText(ctx, brand, x, y, 2.4);
  ctx.fillStyle = P.textDim;
  ctx.font = '500 12px "Segoe UI", Arial, sans-serif';
  spacedText(ctx, model, x, y + 17, 0.9);
  ctx.textAlign = 'left';
}

function ioCluster(ctx, x, y, w, h) {
  // 电源按钮
  const cx = x + w - 26, cy = y + h * 0.38;
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.strokeStyle = '#3b434c'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 4.4, 0, Math.PI * 2);
  ctx.fillStyle = '#0a0c0e'; ctx.fill();
  // 两个 LED 底座
  [[cx - 22, cy - 7], [cx - 22, cy + 7]].forEach(([lx, ly]) => {
    ctx.beginPath(); ctx.arc(lx, ly, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#07090b'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.8; ctx.stroke();
  });
  // USB
  const uy = y + h * 0.72;
  [cx - 34, cx - 19].forEach((ux) => {
    rr(ctx, ux, uy, 11, 6, 1);
    ctx.fillStyle = '#050708'; ctx.fill();
    ctx.strokeStyle = '#2b3138'; ctx.lineWidth = 0.8; ctx.stroke();
  });
}

export function deviceFaceTexture(kind, variant = 0) {
  return memo(`face:${kind}:${variant}`, () => {
    const W = 1024;
    const H = kind === 'srv1u' || kind === 'sw1u' || kind === 'pp1u' || kind === 'pdu1u' || kind === 'kvm1u' || kind === 'blank1u' ? 96
      : kind === 'srv2u' ? 192
      : kind === 'srv4u' ? 384
      : kind === 'ups6u' ? 288 : 96;
    const cv = canvas(W, H), ctx = ctxOf(cv);
    const em = canvas(W, H), ec = ctxOf(em);
    ec.fillStyle = '#000'; ec.fillRect(0, 0, W, H);

    if (kind === 'blank1u' || kind === 'blank2u') {
      plate(ctx, W, H);
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      for (let x = 40; x < W - 40; x += 26) ctx.fillRect(x, 16, 12, H - 32);
      screws(ctx, W, H, 12);
    } else if (kind === 'srv1u') {
      plate(ctx, W, H);
      const count = 8 + (variant % 2);
      const bw = 44, gap = 3, startX = 22;
      for (let i = 0; i < count; i++) driveBay(ctx, startX + i * (bw + gap), 18, bw, 60);
      ventArea(ctx, startX + count * (bw + gap) + 8, 16, 290, 64);
      brandBlock(ctx, 786, 34, ['DELL', 'HPE', 'Lenovo', 'Inspur', 'H3C'][variant % 5],
        ['PowerEdge R650', 'ProLiant DL360 Gen10', 'ThinkSystem SR630', 'NF5180M6', 'UniServer R4900'][variant % 5]);
      ioCluster(ctx, 760, 20, 240, 58);
      screws(ctx, W, H, 8);
    } else if (kind === 'srv2u') {
      plate(ctx, W, H);
      const count = 8;
      const bw = 84, gap = 4, startX = 22;
      for (let i = 0; i < count; i++) {
        const x = startX + i * (bw + gap);
        driveBay(ctx, x, 22, bw, 148);
        // 3.5" 硬盘托架拉手
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x + 8, 40, bw - 16, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 8, 46, bw - 16, 2);
      }
      ventArea(ctx, 748, 20, 176, 152);
      brandBlock(ctx, 756, 46, ['DELL', 'HPE', 'Huawei', 'Inspur'][variant % 4],
        ['PowerEdge R750', 'ProLiant DL380', 'FusionServer 2288H', 'NF5280M6'][variant % 4]);
      ioCluster(ctx, 740, 100, 270, 80);
      screws(ctx, W, H, 8);
    } else if (kind === 'srv4u') {
      plate(ctx, W, H);
      const cols = 12, rows = 2;
      const bw = 78, bh = 148, gx = 3, gy = 6, sx = 22, sy = 20;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = sx + c * (bw + gx), y = sy + r * (bh + gy);
          driveBay(ctx, x, y, bw, bh);
          // 硬盘指示灯
          ledDot(ctx, x + bw - 12, y + bh - 12, r === 0 && c % 3 === 0 ? 'rgba(80,255,150,0.9)' : 'rgba(40,90,70,0.5)', 1.7);
          ctx.fillStyle = 'rgba(0,0,0,0.38)';
          ctx.fillRect(x + 10, y + bh - 34, bw - 20, 14);
        }
      }
      brandBlock(ctx, 1000 - 150, 26, 'OCEANSTOR', '5310 V6', 'left');
      screws(ctx, W, H, 8);
    } else if (kind === 'sw1u') {
      plate(ctx, W, H);
      // 24 × 2 RJ45
      const cols = 24, pw = 26, ph = 21, x0 = 18, y0 = 15;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < cols; c++) {
          const x = x0 + c * (pw + 1.6), y = y0 + r * (ph + 5);
          rr(ctx, x, y, pw, ph, 1.4);
          ctx.fillStyle = '#0a0c0d'; ctx.fill();
          ctx.strokeStyle = '#2c333a'; ctx.lineWidth = 0.8; ctx.stroke();
          // 金手指
          ctx.fillStyle = 'rgba(190,160,90,0.55)';
          ctx.fillRect(x + 4, y + 2, pw - 8, 2);
          // 端口灯（部分点亮）
          const lit = (c * 7 + r * 3 + variant) % 5 !== 0;
          const amber = (c + r + variant) % 11 === 0;
          if (lit) {
            ctx.fillStyle = amber ? '#ffb347' : '#48ff9a';
            ctx.fillRect(x + 4, y + ph - 3.5, 4, 2.4);
            ctx.fillStyle = amber ? '#ffd9a0' : '#b6ffd6';
            ctx.fillRect(x + pw - 8, y + ph - 3.5, 3, 2.4);
            ec.fillStyle = amber ? 'rgba(255,150,40,0.85)' : 'rgba(50,255,140,0.8)';
            ec.fillRect(x + 4, y + ph - 3.5, 4, 2.4);
            ec.fillRect(x + pw - 8, y + ph - 3.5, 3, 2.4);
          }
        }
      }
      // SFP 笼
      for (let i = 0; i < 6; i++) {
        const x = 690 + i * 40, y = 22;
        rr(ctx, x, y, 34, 52, 2);
        grad(ctx, 0, y, 0, y + 52, [[0, '#3a4149'], [0.5, '#23282e'], [1, '#12161a']]);
        ctx.fill();
        ctx.strokeStyle = '#4c545d'; ctx.lineWidth = 0.8; ctx.stroke();
        ctx.fillStyle = '#06080a';
        ctx.fillRect(x + 5, y + 8, 24, 12);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x + 5, y + 30, 24, 12);
      }
      brandBlock(ctx, 700, 88, ['CISCO', 'H3C', 'HUAWEI', 'RUIJIE'][variant % 4],
        ['Nexus 93180YC-FX', 'S6520X-54QC', 'CloudEngine 6865', 'RG-S6510-48VS8CQ'][variant % 4]);
      // 系统状态灯
      ledDot(ctx, 992, 30, 'rgba(60,255,140,0.9)', 2.4);
      ec.fillStyle = 'rgba(60,255,140,0.9)';
      ec.beginPath(); ec.arc(992, 30, 3.4, 0, Math.PI * 2); ec.fill();
      screws(ctx, W, H, 8);
    } else if (kind === 'pp1u') {
      plate(ctx, W, H);
      const cols = 24, pw = 32, x0 = 24;
      ctx.fillStyle = '#0d1013';
      ctx.fillRect(x0 - 10, 12, cols * pw + 12, 64);
      for (let c = 0; c < cols; c++) {
        const x = x0 + c * pw;
        // LC 双芯
        for (let d = 0; d < 2; d++) {
          rr(ctx, x + 3 + d * 13, 26, 10, 24, 2);
          ctx.fillStyle = '#07090b'; ctx.fill();
          ctx.strokeStyle = '#2e353c'; ctx.lineWidth = 0.8; ctx.stroke();
          ctx.fillStyle = d === 0 ? 'rgba(60,120,200,0.35)' : 'rgba(80,160,120,0.30)';
          ctx.fillRect(x + 5 + d * 13, 30, 6, 8);
        }
        ctx.fillStyle = 'rgba(200,210,220,0.5)';
        ctx.font = '8px "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(c + 1).padStart(2, '0'), x + pw / 2, 62);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = P.textDim;
      ctx.font = '600 11px "Segoe UI"';
      spacedText(ctx, 'FIBER PATCH PANEL · 24 LC DUPLEX', 792, 44, 1.2);
      ctx.fillStyle = 'rgba(80,200,255,0.55)';
      ctx.font = '9px "Consolas"';
      ctx.fillText('SM 9/125μm', 792, 62);
      screws(ctx, W, H, 8);
    } else if (kind === 'ups6u') {
      plate(ctx, W, H);
      // LCD
      rr(ctx, 42, 40, 340, 200, 5);
      ctx.fillStyle = '#05090c'; ctx.fill();
      ctx.strokeStyle = '#2b333c'; ctx.lineWidth = 2; ctx.stroke();
      const g = ctx.createLinearGradient(0, 40, 0, 240);
      g.addColorStop(0, 'rgba(20,90,120,0.55)');
      g.addColorStop(1, 'rgba(8,30,45,0.55)');
      ctx.fillStyle = g; ctx.fillRect(46, 44, 332, 192);
      ctx.fillStyle = '#8ff2ff';
      ctx.font = '600 26px "Consolas", monospace';
      ctx.fillText('ONLINE', 66, 92);
      ctx.font = '13px "Consolas", monospace';
      ctx.fillStyle = 'rgba(160,240,255,0.8)';
      ctx.fillText('LOAD  46%', 66, 120);
      ctx.fillText('BATT  100%', 66, 142);
      ctx.fillText('OUT   230.1V', 66, 164);
      // 负载条
      for (let i = 0; i < 20; i++) {
        ctx.fillStyle = i < 9 ? 'rgba(80,240,200,0.85)' : 'rgba(80,240,200,0.14)';
        ctx.fillRect(66 + i * 15, 182, 11, 8);
        if (i < 9) { ec.fillStyle = 'rgba(60,220,190,0.55)'; ec.fillRect(66 + i * 15, 182, 11, 8); }
      }
      ctx.fillStyle = 'rgba(140,220,240,0.55)';
      ctx.font = '11px "Segoe UI"';
      ctx.fillText('SMART-UPS SRT 5000VA', 66, 216);
      // 右侧散热
      ventArea(ctx, 420, 30, 560, 228, 12, 3.6);
      brandBlock(ctx, 430, 286, 'APC', 'by Schneider Electric');
      screws(ctx, W, H, 10);
    } else if (kind === 'pdu1u') {
      plate(ctx, W, H);
      // 8 × C13
      for (let i = 0; i < 8; i++) {
        const x = 30 + i * 84;
        rr(ctx, x, 22, 64, 52, 3);
        ctx.fillStyle = '#0a0c0e'; ctx.fill();
        ctx.strokeStyle = '#313841'; ctx.lineWidth = 1; ctx.stroke();
        // 三个插孔
        [[x + 20, 38], [x + 32, 38], [x + 26, 56]].forEach(([px, py]) => {
          rr(ctx, px - 5, py - 4, 10, 9, 2);
          ctx.fillStyle = '#040506'; ctx.fill();
        });
      }
      // 总开关
      rr(ctx, 726, 30, 34, 36, 3);
      ctx.fillStyle = '#1b2025'; ctx.fill();
      ctx.strokeStyle = '#3a424b'; ctx.stroke();
      ctx.fillStyle = '#ff5a4d';
      ctx.fillRect(736, 38, 14, 20);
      ctx.fillStyle = P.textDim;
      ctx.font = '10px "Consolas"';
      ctx.fillText('16A  C13×8', 790, 48);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(790, 56, 180, 1);
      screws(ctx, W, H, 8);
    } else if (kind === 'kvm1u') {
      plate(ctx, W, H);
      rr(ctx, 20, 18, 520, 60, 3);
      ctx.fillStyle = '#060a0d'; ctx.fill();
      ctx.strokeStyle = '#2c343c'; ctx.stroke();
      ctx.fillStyle = 'rgba(70,200,255,0.18)';
      ctx.fillRect(24, 22, 512, 52);
      ctx.fillStyle = 'rgba(150,235,255,0.75)';
      ctx.font = '14px "Consolas"';
      ctx.fillText('KVM  CONSOLE 01   →  A05-U18', 40, 55);
      ctx.fillStyle = P.textDim;
      ctx.font = '10px "Segoe UI"';
      spacedText(ctx, '16-PORT KVM SWITCH · 1920×1080', 570, 44, 1);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i === 0 ? 'rgba(60,255,160,0.7)' : 'rgba(255,255,255,0.08)';
        ctx.fillRect(576 + i * 18, 54, 10, 4);
      }
      ioCluster(ctx, 820, 20, 180, 58);
      screws(ctx, W, H, 8);
    } else {
      plate(ctx, W, H);
    }

    // 面板噪点
    ctx.globalAlpha = 0.5;
    sparkle(ctx, W, H, 500, 0.05, 1, variant + 3);
    ctx.globalAlpha = 1;

    return {
      map: toTexture(cv, { srgb: true, clamp: true }),
      emissiveMap: toTexture(em, { srgb: true, clamp: true })
    };
  });
}

/* ============================================================
   机柜铭牌 / 标识 / 警示牌
   ============================================================ */
export function nameplateTexture(id, name, meta, accent = '#38bdf8') {
  return memo(`plate:${id}:${name}`, () => {
    const W = 512, H = 112;
    const cv = canvas(W, H), ctx = ctxOf(cv);
    grad(ctx, 0, 0, 0, H, [[0, '#151b21'], [1, '#0a0e12']]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 96, H);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(88, 0, 8, H);
    ctx.fillStyle = '#04121a';
    ctx.font = '700 44px "Consolas", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(id, 48, 70);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8f4ff';
    ctx.font = '600 25px "Microsoft YaHei", sans-serif';
    ctx.fillText(name, 116, 50);
    ctx.fillStyle = 'rgba(140,170,200,0.62)';
    ctx.font = '13px "Consolas", monospace';
    ctx.fillText(meta, 116, 78);
    // 右侧指示
    ctx.fillStyle = 'rgba(120,170,210,0.28)';
    ctx.font = '10px "Consolas"';
    ctx.fillText('42U', 440, 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    return toTexture(cv, { srgb: true, clamp: true });
  });
}

export function signTexture(title, sub, kind = 'warn') {
  return memo(`sign:${title}:${sub}:${kind}`, () => {
    const W = 512, H = 320;
    const cv = canvas(W, H), ctx = ctxOf(cv);
    if (kind === 'danger') {
      ctx.fillStyle = '#f2c200'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#111'; ctx.fillRect(10, 10, W - 20, H - 20);
      ctx.fillStyle = '#f2c200'; ctx.fillRect(16, 16, W - 32, H - 32);
    } else if (kind === 'glass') {
      ctx.fillStyle = 'rgba(8,14,20,0.85)'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(120,200,255,0.5)'; ctx.lineWidth = 4; ctx.strokeRect(8, 8, W - 16, H - 16);
    } else {
      ctx.fillStyle = '#0b1116'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,180,60,0.55)'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, W - 12, H - 12);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = kind === 'danger' ? '#111' : (kind === 'glass' ? '#9fe8ff' : '#ffcf7a');
    ctx.font = `700 ${kind === 'danger' ? 64 : 52}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(title, W / 2, kind === 'danger' ? 140 : 132);
    ctx.fillStyle = kind === 'danger' ? '#111' : 'rgba(200,220,235,0.7)';
    ctx.font = '500 28px "Microsoft YaHei", sans-serif';
    if (sub) ctx.fillText(sub, W / 2, 200);
    if (kind === 'danger') {
      ctx.font = '700 44px "Segoe UI"';
      ctx.fillText('DANGER', W / 2, 270);
    }
    ctx.textAlign = 'left';
    return toTexture(cv, { srgb: true, clamp: true });
  });
}

export function aisleDecalTexture(label = 'A-AISLE 01', sub = 'COLD AISLE · 冷通道') {
  return memo(`decal:${label}`, () => {
    const W = 1024, H = 512;
    const cv = canvas(W, H), ctx = ctxOf(cv);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.strokeStyle = 'rgba(120,215,255,0.5)';
    ctx.lineWidth = 6;
    ctx.strokeRect(-460, -200, 920, 400);
    ctx.fillStyle = 'rgba(120,215,255,0.10)';
    ctx.fillRect(-460, -200, 920, 400);
    ctx.fillStyle = 'rgba(150,230,255,0.85)';
    ctx.textAlign = 'center';
    ctx.font = '700 96px "Consolas", monospace';
    ctx.fillText(label, 0, 10);
    ctx.font = '500 30px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = 'rgba(170,215,240,0.65)';
    ctx.fillText(sub, 0, 70);
    // 箭头
    ctx.fillStyle = 'rgba(120,215,255,0.45)';
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 150, 150);
      ctx.lineTo(i * 150 + 30, 120);
      ctx.lineTo(i * 150 + 60, 150);
      ctx.lineTo(i * 150 + 30, 180);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return toTexture(cv, { srgb: true, clamp: true });
  });
}

/* ============================================================
   CRAC / 环境面板
   ============================================================ */
export function lcdPanelTexture(kind = 'crac') {
  return memo(`lcd:${kind}`, () => {
    const W = 512, H = 320;
    const cv = canvas(W, H), ctx = ctxOf(cv);
    ctx.fillStyle = '#05090c'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(16,70,95,0.6)');
    g.addColorStop(1, 'rgba(6,22,32,0.6)');
    ctx.fillStyle = g; ctx.fillRect(6, 6, W - 12, H - 12);
    ctx.strokeStyle = '#2a343d'; ctx.lineWidth = 3; ctx.strokeRect(6, 6, W - 12, H - 12);
    if (kind === 'crac') {
      ctx.fillStyle = '#8ff0ff';
      ctx.font = '700 30px "Consolas"';
      ctx.fillText('CRAC-02', 28, 52);
      ctx.fillStyle = 'rgba(160,240,255,0.75)';
      ctx.font = '700 54px "Consolas"';
      ctx.fillText('22.4°C', 28, 118);
      ctx.font = '16px "Consolas"';
      ctx.fillStyle = 'rgba(150,210,230,0.7)';
      ctx.fillText('RETURN   26.8°C', 28, 152);
      ctx.fillText('HUMIDITY 45.2%RH', 28, 178);
      ctx.fillText('FAN      78%', 28, 204);
      ctx.fillText('MODE     COOL', 28, 230);
      // 条形
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i < 12 ? 'rgba(80,240,200,0.85)' : 'rgba(80,240,200,0.15)';
        ctx.fillRect(28 + i * 28, 252, 20, 12);
      }
      ctx.fillStyle = 'rgba(120,220,240,0.55)';
      ctx.font = '13px "Microsoft YaHei"';
      ctx.fillText('精密空调 · 风冷下送风', 28, 292);
    } else {
      ctx.fillStyle = '#8ff0ff';
      ctx.font = '700 30px "Consolas"';
      ctx.fillText('ENV-SENSOR 03', 28, 54);
      ctx.font = '700 48px "Consolas"';
      ctx.fillText('23.1°C', 28, 118);
      ctx.font = '16px "Consolas"';
      ctx.fillStyle = 'rgba(160,220,240,0.72)';
      ctx.fillText('HUMIDITY  44.8 %RH', 28, 154);
      ctx.fillText('DEW POINT 10.6 °C', 28, 180);
      ctx.fillText('WATER     NORMAL', 28, 206);
      ctx.fillText('SMOKE     NORMAL', 28, 232);
      ctx.fillStyle = 'rgba(60,255,150,0.85)';
      ctx.beginPath(); ctx.arc(34, 262, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(160,230,190,0.7)';
      ctx.font = '13px "Microsoft YaHei"';
      ctx.fillText('环境正常', 50, 267);
    }
    return toTexture(cv, { srgb: true, clamp: true });
  });
}

/* ============================================================
   监控大屏
   ============================================================ */
export function createDashboard() {
  const cv = canvas(1600, 900);
  return {
    canvas: cv,
    texture: toTexture(cv, { srgb: true, clamp: true }),
    history: [],
    last: 0
  };
}

export function drawDashboard(dash, d) {
  const { canvas: cv, texture } = dash;
  const ctx = ctxOf(cv);
  const W = 1600, H = 900;
  ctx.fillStyle = '#04080d';
  ctx.fillRect(0, 0, W, H);
  // 网格
  ctx.strokeStyle = 'rgba(50,140,180,0.09)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // 顶栏
  ctx.fillStyle = 'rgba(10,30,42,0.9)';
  ctx.fillRect(0, 0, W, 74);
  ctx.fillStyle = '#5fe6ff';
  ctx.font = '700 30px "Microsoft YaHei"';
  ctx.fillText('智能运维监控中心', 44, 48);
  ctx.fillStyle = 'rgba(130,180,210,0.55)';
  ctx.font = '15px "Consolas"';
  ctx.fillText('DCIM / IDC-02 / ZONE-A    REAL-TIME DIGITAL TWIN', 340, 46);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fe9ff';
  ctx.font = '600 22px "Consolas"';
  ctx.fillText(d.clock, W - 46, 46);
  ctx.textAlign = 'left';

  // KPI
  const kpis = [
    ['在线设备', `${d.online}/${d.total}`, '#41f0b0'],
    ['IT 负载', `${d.power.toFixed(1)} kW`, '#5fe6ff'],
    ['冷通道', `${d.temp.toFixed(1)} °C`, '#7fb6ff'],
    ['PUE', d.pue.toFixed(2), '#ffcf6b']
  ];
  kpis.forEach((k, i) => {
    const x = 44 + i * 300, y = 100, w = 278, h = 108;
    ctx.fillStyle = 'rgba(12,32,44,0.66)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(70,180,220,0.22)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = 'rgba(130,190,215,0.55)';
    ctx.font = '15px "Microsoft YaHei"';
    ctx.fillText(k[0], x + 20, y + 30);
    ctx.fillStyle = k[2];
    ctx.font = '700 40px "Consolas"';
    ctx.fillText(k[1], x + 20, y + 80);
    ctx.fillStyle = k[2];
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x + 20, y + 92, 60, 2);
    ctx.globalAlpha = 1;
  });

  // 功率趋势
  const px = 44, py = 236, pw = 1000, ph = 300;
  ctx.fillStyle = 'rgba(8,20,30,0.7)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = 'rgba(70,180,220,0.22)';
  ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  ctx.fillStyle = 'rgba(160,215,235,0.8)';
  ctx.font = '600 17px "Microsoft YaHei"';
  ctx.fillText('总功率趋势  (kW / 60s)', px + 20, py + 30);
  ctx.strokeStyle = 'rgba(70,150,180,0.16)';
  for (let i = 0; i <= 4; i++) {
    const y = py + 60 + i * (ph - 80) / 4;
    ctx.beginPath(); ctx.moveTo(px + 20, y); ctx.lineTo(px + pw - 20, y); ctx.stroke();
  }
  const hist = d.history;
  if (hist.length > 1) {
    const maxV = Math.max(...hist) * 1.15, minV = Math.min(...hist) * 0.85;
    const pts = hist.map((v, i) => [
      px + 20 + (i / (hist.length - 1)) * (pw - 40),
      py + ph - 24 - ((v - minV) / Math.max(0.001, maxV - minV)) * (ph - 90)
    ]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], py + ph - 24);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(pts[pts.length - 1][0], py + ph - 24);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, py + 40, 0, py + ph);
    g.addColorStop(0, 'rgba(60,220,255,0.42)');
    g.addColorStop(1, 'rgba(60,220,255,0.02)');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = '#4fe4ff';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(last[0], last[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = '#b9f6ff'; ctx.fill();
  }

  // 机柜负载
  const bx = 1078, by = 236, bw = 478, bh = 300;
  ctx.fillStyle = 'rgba(8,20,30,0.7)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(70,180,220,0.22)';
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  ctx.fillStyle = 'rgba(160,215,235,0.8)';
  ctx.font = '600 17px "Microsoft YaHei"';
  ctx.fillText('机柜负载分布', bx + 20, by + 30);
  const bars = d.racks;
  const bwid = (bw - 50) / bars.length;
  bars.forEach((v, i) => {
    const x = bx + 25 + i * bwid;
    const hgt = Math.max(2, v * (bh - 110));
    const g = ctx.createLinearGradient(0, by + bh - 30 - hgt, 0, by + bh - 30);
    const hot = v > 0.8;
    g.addColorStop(0, hot ? '#ff8a5c' : '#45e0ff');
    g.addColorStop(1, hot ? 'rgba(255,90,60,0.2)' : 'rgba(60,200,255,0.15)');
    ctx.fillStyle = g;
    ctx.fillRect(x, by + bh - 30 - hgt, bwid - 5, hgt);
  });
  ctx.fillStyle = 'rgba(130,180,205,0.45)';
  ctx.font = '11px "Consolas"';
  ctx.fillText('A01', bx + 22, by + bh - 12);
  ctx.fillText('B10', bx + bw - 52, by + bh - 12);

  // 告警
  const ax = 44, ay = 568, aw = 1000, ah = 292;
  ctx.fillStyle = 'rgba(8,20,30,0.7)';
  ctx.fillRect(ax, ay, aw, ah);
  ctx.strokeStyle = 'rgba(70,180,220,0.22)';
  ctx.strokeRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1);
  ctx.fillStyle = 'rgba(160,215,235,0.8)';
  ctx.font = '600 17px "Microsoft YaHei"';
  ctx.fillText('实时事件流', ax + 20, ay + 32);
  const rows = d.events.slice(0, 5);
  rows.forEach((e, i) => {
    const y = ay + 66 + i * 42;
    ctx.fillStyle = e.level === 'crit' ? '#ff5d6d' : e.level === 'warn' ? '#ffb347' : '#54e0ff';
    ctx.beginPath(); ctx.arc(ax + 30, y - 5, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,200,220,0.5)';
    ctx.font = '13px "Consolas"';
    ctx.fillText(e.time, ax + 44, y);
    ctx.fillStyle = 'rgba(210,230,245,0.88)';
    ctx.font = '14px "Microsoft YaHei"';
    ctx.fillText(e.text, ax + 130, y);
  });

  // 拓扑
  const tx = 1078, ty = 568, tw = 478, th = 292;
  ctx.fillStyle = 'rgba(8,20,30,0.7)';
  ctx.fillRect(tx, ty, tw, th);
  ctx.strokeStyle = 'rgba(70,180,220,0.22)';
  ctx.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th - 1);
  ctx.fillStyle = 'rgba(160,215,235,0.8)';
  ctx.font = '600 17px "Microsoft YaHei"';
  ctx.fillText('网络拓扑健康度', tx + 20, ty + 32);
  // 节点环
  const cx = tx + tw / 2, cy = ty + 165, R = 78;
  ctx.strokeStyle = 'rgba(70,200,240,0.24)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = i === 3 ? '#ffb347' : '#3fe0ff'; ctx.fill();
    ctx.strokeStyle = 'rgba(60,200,240,0.25)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,220,255,0.16)'; ctx.fill();
  ctx.strokeStyle = '#4fe4ff'; ctx.stroke();
  ctx.fillStyle = '#a9f4ff';
  ctx.font = '700 13px "Consolas"';
  ctx.textAlign = 'center';
  ctx.fillText('CORE', cx, cy + 5);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(140,190,215,0.55)';
  ctx.font = '12px "Consolas"';
  ctx.fillText('12 / 12 UP  ·  0.02% LOSS', tx + 24, ty + th - 18);

  texture.needsUpdate = true;
}
