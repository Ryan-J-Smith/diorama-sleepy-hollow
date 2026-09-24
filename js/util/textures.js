// Procedural canvas textures. Everything in the diorama is painted here at load
// time, so the site has no image assets to host.

import * as THREE from 'three';
import { perlin2, fbm2, fbmTile } from './noise.js';
import { Rng } from './rng.js';

let maxAnisotropy = 4;
export function setMaxAnisotropy(n) {
  maxAnisotropy = n;
}

const cache = new Map();
function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = true, anisotropy = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy ? maxAnisotropy : 1;
  return t;
}

const hex = (h) => {
  const c = new THREE.Color(h);
  return [c.r * 255, c.g * 255, c.b * 255];
};

// Colors used by the per-pixel painters are sRGB bytes, not linear.
function hexBytes(h) {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mixBytes(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ---------------------------------------------------------------------------
// Wood

/**
 * Figured hardwood grain running along the texture's u axis.
 * `tone` picks a palette: 'walnut' for the case, 'table' for the shelf below.
 */
export function woodTexture(tone = 'walnut') {
  return cached(`wood:${tone}`, () => {
    const palettes = {
      walnut: { light: '#6a4430', mid: '#432a1b', dark: '#22140c', pore: '#150b06' },
      table: { light: '#3a2618', mid: '#261810', dark: '#140c07', pore: '#0c0704' },
    };
    const pal = palettes[tone];
    const light = hexBytes(pal.light);
    const mid = hexBytes(pal.mid);
    const dark = hexBytes(pal.dark);
    const poreC = hexBytes(pal.pore);
    const w = 1024;
    const h = 256;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Sample noise on a cylinder so the pattern tiles along the grain (u).
        const a = (x / w) * Math.PI * 2;
        const cx = Math.cos(a);
        const cy = Math.sin(a);
        // long, gently drifting grain lines with uneven spacing
        const drift = fbm2(cx * 0.9 + y * 0.004, cy * 0.9 + 3.7, 3) * 0.9;
        const spacing = fbm2(y * 0.012 + 5.1, 1.3, 2) * 4.0;
        const lines = y * 0.16 + drift + spacing;
        const band = 0.5 + 0.5 * Math.sin(lines * Math.PI * 2);
        const grain = Math.pow(band, 3.0);
        // broad figure: lighter and darker boards
        const broad = 0.5 + 0.5 * fbm2(cx * 0.7 + 11, cy * 0.7 + y * 0.006, 2);
        let col = mixBytes(mid, light, broad * 0.6);
        col = mixBytes(col, dark, grain * 0.38);
        // open pores: thin dark streaks running along the grain
        const pore = perlin2(cx * 2.2 + 40 + y * 0.9, cy * 2.2 + y * 0.9);
        if (pore > 0.45) col = mixBytes(col, poreC, Math.min(1, (pore - 0.45) * 3) * 0.45);
        const fleck = perlin2(cx * 30 + 7, cy * 30 + y * 0.35);
        col = mixBytes(col, light, Math.max(0, fleck - 0.55) * 0.5);
        const i = (y * w + x) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------
// Building surfaces (grayscale, tinted by material color)

export function clapboardTexture() {
  return cached('clapboard', () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const board = 16;
    for (let y = 0; y < s; y++) {
      const t = (y % board) / board;
      // shadow right under the lap of the board above, brighter lower edge
      let shade = 0.72 + 0.26 * Math.min(1, t * 2.4);
      if (t > 0.9) shade = 0.98;
      for (let x = 0; x < s; x++) {
        const grain = 0.94 + 0.06 * perlin2(x * 0.03, y * 0.6);
        const wear = 0.95 + 0.05 * fbm2(x * 0.02, y * 0.02, 2);
        const v = 238 * shade * grain * wear;
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

export function boardBattenTexture() {
  return cached('boardBatten', () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const boardW = 32;
    for (let x = 0; x < s; x++) {
      const t = (x % boardW) / boardW;
      let shade = 0.82;
      if (t < 0.18) shade = 1.0; // batten
      else if (t < 0.24) shade = 0.55; // batten shadow
      for (let y = 0; y < s; y++) {
        const grain = 0.9 + 0.1 * perlin2(x * 0.5, y * 0.025);
        const weather = 0.92 + 0.08 * fbm2(x * 0.04 + 3, y * 0.01, 2);
        const v = 240 * shade * grain * weather;
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

export function shingleTexture() {
  return cached('shingles', () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const rng = new Rng(77);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, s, s);
    const rowH = 16;
    for (let row = 0; row < s / rowH; row++) {
      let x = row % 2 ? -rng.float(4, 12) : 0;
      const y = row * rowH;
      while (x < s) {
        const w = rng.float(12, 24);
        const v = Math.floor(rng.float(150, 215));
        const g = ctx.createLinearGradient(0, y, 0, y + rowH);
        g.addColorStop(0, `rgb(${v * 0.62},${v * 0.62},${v * 0.62})`);
        g.addColorStop(0.75, `rgb(${v},${v},${v})`);
        g.addColorStop(1, `rgb(${v * 0.9},${v * 0.9},${v * 0.9})`);
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, y, w - 1.5, rowH - 1);
        // wrap the last shingle so the texture tiles
        if (x + w > s) ctx.fillRect(x + 1 - s, y, w - 1.5, rowH - 1);
        x += w;
      }
    }
    return toTexture(c);
  });
}

export function stoneTexture() {
  return cached('stone', () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const rng = new Rng(4);
    ctx.fillStyle = '#4a4744';
    ctx.fillRect(0, 0, s, s);
    const cells = 7;
    const cw = s / cells;
    for (let gy = -1; gy <= cells; gy++) {
      for (let gx = -1; gx <= cells; gx++) {
        const cx = (gx + 0.5 + rng.float(-0.2, 0.2)) * cw + (gy % 2 ? cw * 0.5 : 0);
        const cy = (gy + 0.5 + rng.float(-0.15, 0.15)) * cw;
        const rx = cw * rng.float(0.38, 0.5);
        const ry = cw * rng.float(0.3, 0.44);
        const v = Math.floor(rng.float(120, 200));
        for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) {
          const g = ctx.createRadialGradient(cx + ox - rx * 0.3, cy + oy - ry * 0.3, 1, cx + ox, cy + oy, Math.max(rx, ry));
          g.addColorStop(0, `rgb(${v + 25},${v + 22},${v + 18})`);
          g.addColorStop(1, `rgb(${v * 0.7},${v * 0.68},${v * 0.64})`);
          ctx.fillStyle = g;
          ctx.beginPath();
          const steps = 9;
          for (let k = 0; k <= steps; k++) {
            const a = (k / steps) * Math.PI * 2;
            const r = 1 + 0.12 * perlin2(gx * 3.1 + k * 0.7, gy * 2.3);
            const px = cx + ox + Math.cos(a) * rx * r;
            const py = cy + oy + Math.sin(a) * ry * r;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.fill();
        }
      }
    }
    return toTexture(c);
  });
}

export function plankTexture() {
  return cached('planks', () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const plank = 32;
    for (let y = 0; y < s; y++) {
      const row = Math.floor(y / plank);
      const t = (y % plank) / plank;
      const edge = t < 0.06 ? 0.45 : 1;
      const tone = 0.8 + 0.2 * perlin2(row * 3.3, 0.5);
      for (let x = 0; x < s; x++) {
        const grain = 0.86 + 0.14 * perlin2(x * 0.02 + row * 7, y * 0.35);
        const v = 225 * edge * tone * grain;
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c);
  });
}

// ---------------------------------------------------------------------------
// Windows and doors

/**
 * Window atlas: four six-over-six sashes side by side, lit like a room with a
 * single candle rather than a lamp. Cell 0: candle close to the glass (a tiny
 * flame is the only part bright enough to bloom); cell 1: glow behind
 * curtains; cell 2: a dim room, the candle further back; cell 3: dark pane.
 * Returns { map, emissiveMap } for use on one material.
 */
export function windowAtlas() {
  return cached('windowAtlas', () => {
    const cw = 64;
    const h = 96;
    const map = makeCanvas(cw * 4, h);
    const emi = makeCanvas(cw * 4, h);
    const m = map.getContext('2d');
    const e = emi.getContext('2d');
    e.fillStyle = '#000';
    e.fillRect(0, 0, cw * 4, h);
    const glow = (ctx, x, y, r, stops) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      stops.forEach(([t, c]) => g.addColorStop(t, c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, h);
    };
    for (let cell = 0; cell < 4; cell++) {
      const x0 = cell * cw;
      for (const ctx of [m, e]) {
        ctx.save();
        ctx.translate(x0, 0);
        ctx.beginPath();
        ctx.rect(0, 0, cw, h);
        ctx.clip();
        const isMap = ctx === m;
        if (cell === 3) {
          if (isMap) {
            const g = ctx.createLinearGradient(0, 0, cw, h);
            g.addColorStop(0, '#46587a');
            g.addColorStop(0.45, '#151c2a');
            g.addColorStop(1, '#0b0f18');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, cw, h);
          }
        } else if (isMap) {
          ctx.fillStyle = '#2e1c0e';
          ctx.fillRect(0, 0, cw, h);
        } else if (cell === 0) {
          // candle on the sill: warm pool of light, a small bright flame
          const fx = cw * 0.56;
          const fy = h * 0.7;
          glow(ctx, fx, fy + 4, h * 0.85, [[0, '#f7c27e'], [0.14, '#e0934a'], [0.45, '#a24f1a'], [1, '#2e1005']]);
          ctx.fillStyle = '#d9b27a';
          ctx.fillRect(fx - 1.5, fy + 3, 3, 9);
          const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 8);
          halo.addColorStop(0, 'rgba(255,236,190,0.85)');
          halo.addColorStop(1, 'rgba(255,200,120,0)');
          ctx.fillStyle = halo;
          ctx.fillRect(fx - 8, fy - 8, 16, 16);
          ctx.fillStyle = '#fff6e2';
          ctx.beginPath();
          ctx.ellipse(fx, fy, 1.8, 3.6, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (cell === 1) {
          // candlelight filtering through drawn curtains
          glow(ctx, cw * 0.5, h * 0.62, h * 0.8, [[0, '#dc9a54'], [0.35, '#a85420'], [1, '#2a0f06']]);
          ctx.fillStyle = 'rgb(104,32,12)';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(cw * 0.36, 0);
          ctx.quadraticCurveTo(cw * 0.22, h * 0.5, cw * 0.14, h);
          ctx.lineTo(0, h);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cw, 0);
          ctx.lineTo(cw * 0.64, 0);
          ctx.quadraticCurveTo(cw * 0.78, h * 0.5, cw * 0.86, h);
          ctx.lineTo(cw, h);
          ctx.fill();
        } else {
          // a dim room: the candle is somewhere further in
          glow(ctx, cw * 0.32, h * 0.82, h * 0.9, [[0, '#c27438'], [0.4, '#7a3512'], [1, '#1c0a03']]);
        }
        // sash and muntins
        ctx.fillStyle = isMap ? '#1c130c' : '#000';
        ctx.fillRect(0, 0, cw, 4);
        ctx.fillRect(0, h - 4, cw, 4);
        ctx.fillRect(0, 0, 4, h);
        ctx.fillRect(cw - 4, 0, 4, h);
        ctx.fillRect(0, h / 2 - 2.5, cw, 5);
        ctx.fillRect(cw / 2 - 1.5, 0, 3, h);
        for (const fy of [1 / 6, 2 / 6, 4 / 6, 5 / 6]) ctx.fillRect(0, h * fy - 1, cw, 2);
        ctx.restore();
      }
    }
    const opts = { repeat: false };
    return { map: toTexture(map, opts), emissiveMap: toTexture(emi, opts) };
  });
}

export function doorTexture() {
  return cached('door', () => {
    const w = 64;
    const h = 128;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, w, h);
    // raised panels
    ctx.fillStyle = '#9a9a9a';
    for (const [x, y, pw, ph] of [[8, 8, 20, 48], [36, 8, 20, 48], [8, 66, 20, 54], [36, 66, 20, 54]]) {
      ctx.fillRect(x, y, pw, ph);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(x + 2, y + 2, pw - 4, ph - 4);
      ctx.fillStyle = '#9a9a9a';
    }
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(52, 66, 3, 0, Math.PI * 2);
    ctx.fill();
    return toTexture(c, { repeat: false });
  });
}

// ---------------------------------------------------------------------------
// Soft shapes

export function glowTexture() {
  return cached('glow', () => {
    const s = 128;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return toTexture(c, { srgb: false, repeat: false });
  });
}

export function puffTexture() {
  return cached('puff', () => {
    const s = 128;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x - s / 2) / (s / 2);
        const dy = (y - s / 2) / (s / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const n = 0.5 + 0.5 * fbm2(x * 0.05, y * 0.05, 3);
        const a = Math.max(0, 1 - r) ** 1.6 * (0.45 + 0.75 * n);
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = Math.min(255, a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false, repeat: false });
  });
}

// ---------------------------------------------------------------------------
// Moon, pumpkins, signage

export function moonTexture() {
  return cached('moon', () => {
    const w = 512;
    const h = 256;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const base = hexBytes('#f4efd9');
    const maria = hexBytes('#a9a48f');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = (x / w) * Math.PI * 2;
        const lat = (y / h) * Math.PI;
        const px = Math.cos(a) * Math.sin(lat) * 2;
        const pz = Math.sin(a) * Math.sin(lat) * 2;
        const py = Math.cos(lat) * 2;
        const m = fbm2(px + py * 0.7 + 4, pz - py * 0.4, 4);
        const t = Math.max(0, Math.min(1, (m + 0.05) * 2.2));
        const fine = 0.94 + 0.06 * perlin2(px * 9, pz * 9 + py * 5);
        const col = mixBytes(base, maria, t * 0.7);
        const i = (y * w + x) * 4;
        d[i] = col[0] * fine;
        d[i + 1] = col[1] * fine;
        d[i + 2] = col[2] * fine;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // a few craters
    const rng = new Rng(9);
    for (let k = 0; k < 26; k++) {
      const x = rng.float(0, w);
      const y = rng.float(h * 0.18, h * 0.82);
      const r = rng.float(2, 9);
      ctx.strokeStyle = 'rgba(120,115,100,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,245,0.25)';
      ctx.beginPath();
      ctx.arc(x - r * 0.2, y - r * 0.2, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(c, { repeat: false });
  });
}

/**
 * Jack-o'-lantern skin. Returns { map, emissiveMap } laid out for a
 * SphereGeometry (face centered at u = 0.25, which is the +z side).
 */
export function jackTextures(style = 'grin') {
  return cached(`jack:${style}`, () => {
    const w = 512;
    const h = 256;
    const map = makeCanvas(w, h);
    const emi = makeCanvas(w, h);
    const m = map.getContext('2d');
    const e = emi.getContext('2d');
    // ribbed orange skin
    const img = m.createImageData(w, h);
    const d = img.data;
    const orange = hexBytes('#e0761c');
    const deep = hexBytes('#9c3f0c');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rib = Math.pow(Math.abs(Math.cos((x / w) * Math.PI * 8)), 0.5);
        const n = 0.5 + 0.5 * perlin2(x * 0.03, y * 0.05);
        const col = mixBytes(deep, orange, 0.45 + 0.4 * rib + 0.15 * n);
        const i = (y * w + x) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255;
      }
    }
    m.putImageData(img, 0, 0);
    e.fillStyle = '#000';
    e.fillRect(0, 0, w, h);

    const cx = w * 0.25;
    const cy = h * 0.5;
    const shapes = [];
    if (style === 'fierce') {
      shapes.push([[cx - 50, cy - 40], [cx - 12, cy - 18], [cx - 44, cy - 8]]);
      shapes.push([[cx + 50, cy - 40], [cx + 12, cy - 18], [cx + 44, cy - 8]]);
      shapes.push([[cx - 5, cy - 4], [cx + 5, cy - 4], [cx, cy + 8]]);
      const mouth = [];
      const teeth = 5;
      for (let k = 0; k <= teeth * 2; k++) {
        const t = k / (teeth * 2);
        const x = cx - 58 + t * 116;
        const yTop = cy + 20 + Math.sin(t * Math.PI) * 10 + (k % 2 ? 10 : 0);
        mouth.push([x, yTop]);
      }
      for (let k = 12; k >= 0; k--) {
        const t = k / 12;
        mouth.push([cx - 58 + t * 116, cy + 26 + Math.sin(t * Math.PI) * 30]);
      }
      shapes.push(mouth);
    } else {
      shapes.push([[cx - 42, cy - 10], [cx - 26, cy - 40], [cx - 10, cy - 10]]);
      shapes.push([[cx + 42, cy - 10], [cx + 26, cy - 40], [cx + 10, cy - 10]]);
      shapes.push([[cx - 5, cy], [cx + 5, cy], [cx, cy + 10]]);
      const mouth = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        mouth.push([cx - 52 + t * 104, cy + 18 + Math.sin(t * Math.PI) * 14 + (k === 4 || k === 8 ? 8 : 0)]);
      }
      for (let k = 12; k >= 0; k--) {
        const t = k / 12;
        mouth.push([cx - 52 + t * 104, cy + 24 + Math.sin(t * Math.PI) * 28 - (k === 6 ? 9 : 0)]);
      }
      shapes.push(mouth);
    }
    for (const poly of shapes) {
      for (const ctx of [m, e]) {
        ctx.fillStyle = ctx === m ? '#5a2a08' : '#ffcc66';
        ctx.beginPath();
        poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
    }
    return { map: toTexture(map, { repeat: false }), emissiveMap: toTexture(emi, { repeat: false }) };
  });
}

function brassBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#b8893a');
  g.addColorStop(0.35, '#e7c77a');
  g.addColorStop(0.55, '#c99d4c');
  g.addColorStop(1, '#8e6428');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // brushed streaks
  const rng = new Rng(3);
  for (let i = 0; i < 400; i++) {
    const y = rng.float(0, h);
    ctx.strokeStyle = `rgba(${rng.chance(0.5) ? '255,240,200' : '90,60,20'},${rng.float(0.03, 0.08)})`;
    ctx.lineWidth = rng.float(0.5, 1.5);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + rng.float(-2, 2));
    ctx.stroke();
  }
}

function engrave(ctx, text, x, y, font) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,245,210,0.6)';
  ctx.fillText(text, x + 1.4, y + 1.8);
  ctx.fillStyle = '#160b03';
  ctx.fillText(text, x, y);
}

export function plaqueTexture(title, subtitle) {
  return cached(`plaque:${title}:${subtitle}`, () => {
    const w = 1536;
    const h = 256;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    brassBackground(ctx, w, h);
    ctx.strokeStyle = '#4a3010';
    ctx.lineWidth = 5;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.strokeStyle = 'rgba(255,240,200,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(26, 26, w - 52, h - 52);
    engrave(ctx, title, w / 2, h * 0.4, '98px "IM Fell English SC", "IM Fell English", Georgia, serif');
    engrave(ctx, subtitle, w / 2, h * 0.75, 'italic 60px "IM Fell English", Georgia, serif');
    return toTexture(c, { repeat: false });
  });
}

export function signTexture(lines, { w = 256, h = 128, bg = '#2d1d12', fg = '#e2c27a', font = 'IM Fell English SC', border = true, emblem = null } = {}) {
  return cached(`sign:${lines.join('|')}:${w}x${h}:${bg}`, () => {
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // weathered planks
    for (let y = 0; y < h; y += h / 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y, w, 2);
    }
    if (border) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(2, h * 0.04);
      ctx.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
    }
    if (emblem === 'tankard') {
      ctx.fillStyle = fg;
      const x = w * 0.5;
      const y = h * 0.3;
      ctx.fillRect(x - 12, y - 14, 24, 30);
      ctx.fillRect(x - 15, y - 17, 30, 6);
      ctx.lineWidth = 5;
      ctx.strokeStyle = fg;
      ctx.beginPath();
      ctx.arc(x + 14, y, 9, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length;
    const top = emblem ? h * 0.62 : h * 0.5 - ((n - 1) * h * 0.22) / 2;
    lines.forEach((line, i) => {
      const size = Math.floor(h * (n > 1 ? 0.26 : 0.36));
      ctx.font = `${size}px "${font}", Georgia, serif`;
      ctx.fillText(line, w / 2, top + i * h * 0.26, w * 0.86);
    });
    return toTexture(c, { repeat: false });
  });
}

export function soilTexture() {
  return cached('soil', () => {
    const w = 512;
    const h = 128;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    // v = 0 is the bottom of the cut, v = 1 the surface (texture is flipped)
    const layers = [
      [0.0, hexBytes('#3b2c20')],
      [0.35, hexBytes('#4d3826')],
      [0.62, hexBytes('#5c4430')],
      [0.82, hexBytes('#3a2718')],
      [0.93, hexBytes('#2a1d12')],
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 1 - y / h + 0.04 * perlin2(x * 0.02, y * 0.02);
        let col = layers[0][1];
        for (const [start, lc] of layers) if (v >= start) col = lc;
        const n = 0.85 + 0.15 * perlin2(x * 0.3, y * 0.3);
        const i = (y * w + x) * 4;
        d[i] = col[0] * n;
        d[i + 1] = col[1] * n;
        d[i + 2] = col[2] * n;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // pebbles
    const rng = new Rng(21);
    for (let k = 0; k < 160; k++) {
      const v = rng.float(80, 150);
      ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},0.8)`;
      ctx.beginPath();
      ctx.ellipse(rng.float(0, w), rng.float(h * 0.15, h), rng.float(1, 4), rng.float(1, 3), rng.float(0, 3), 0, Math.PI * 2);
      ctx.fill();
    }
    return toTexture(c);
  });
}

/** Tileable ripple normal map for water. */
export function waterNormalTexture() {
  return cached('waterNormal', () => {
    const s = 256;
    const c = makeCanvas(s, s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const height = new Float32Array(s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        height[y * s + x] = fbmTile(x / s, y / s, 6, 3);
      }
    }
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const hx = height[y * s + ((x + 1) % s)] - height[y * s + ((x - 1 + s) % s)];
        const hy = height[((y + 1) % s) * s + x] - height[((y - 1 + s) % s) * s + x];
        const nx = -hx * 6;
        const ny = -hy * 6;
        const len = Math.hypot(nx, ny, 1);
        const i = (y * s + x) * 4;
        d[i] = (nx / len * 0.5 + 0.5) * 255;
        d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
        d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { srgb: false });
  });
}

export { hex, hexBytes, mixBytes };
