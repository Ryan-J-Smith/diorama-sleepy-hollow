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

/** Tileable value-noise fBm on an n x n grid, roughly in [-1, 1]. */
function periodicNoise(rng, n, period, octaves) {
  const out = new Float32Array(n * n);
  const rows = new Float32Array(n * period * (1 << (octaves - 1)));
  let amp = 1 / (2 - 2 ** (1 - octaves)); // octave weights 1, 1/2, ... normalized
  let p = period;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.float(-1, 1);
    // interpolate each lattice row along x once...
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * p;
      const x0 = Math.floor(fx);
      const x1 = x0 + 1 === p ? 0 : x0 + 1;
      let t = fx - x0;
      t = t * t * (3 - 2 * t);
      for (let r = 0; r < p; r++) rows[r * n + x] = lat[r * p + x0] + (lat[r * p + x1] - lat[r * p + x0]) * t;
    }
    // ...then blend neighbouring rows down y
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * p;
      const y0 = Math.floor(fy);
      let t = fy - y0;
      t = t * t * (3 - 2 * t) * amp;
      const r0 = y0 * n;
      const r1 = (y0 + 1 === p ? 0 : y0 + 1) * n;
      const row = y * n;
      for (let x = 0; x < n; x++) out[row + x] += rows[r0 + x] * amp + (rows[r1 + x] - rows[r0 + x]) * t;
    }
    amp *= 0.5;
    p *= 2;
  }
  return out;
}

// Hudson Valley fieldstone: grey gneiss and schist, buff sandstone, a few
// rusty iron-stained and pinkish granite stones. [weight, sRGB]
const FIELDSTONE = [
  [0.25, [146, 144, 139]],
  [0.14, [124, 128, 131]],
  [0.13, [98, 95, 90]],
  [0.17, [158, 147, 127]],
  [0.12, [128, 112, 97]],
  [0.1, [166, 162, 153]],
  [0.09, [146, 133, 126]],
];

// One stone's record in a flat Float32Array (typed arrays keep the per-pixel
// loop monomorphic, so the JIT optimizes it once and early).
const ST = 26;
const S_CX = 0;
const S_CY = 1;
const S_A = 2; // half width, px
const S_B = 3; // half height, px
const S_SHEAR = 4;
const S_TAPER = 5;
const S_TILT = 6;
const S_R = 7; // four corner radii
const S_IBEVEL = 11;
const S_TOP = 12;
const S_DOME = 13;
const S_TX = 14;
const S_TY = 15;
const S_COL = 16; // rgb
const S_LICH = 19; // rgb
const S_LAMT = 22;
const S_LOFF = 23;
const S_IA = 24;
const S_IB = 25;

/**
 * Rough-coursed rubble fieldstone, like the Old Dutch Church: flattish stones
 * of mixed size in wandering courses, some running up through two courses,
 * small ones stacked as chinking, set in thick recessed lime mortar, with
 * lichen on some stones and moss in the damp joints.
 *
 * Each stone is a rounded trapezoid inside its slot (the side joints slant),
 * so a pixel only has to test the one stone its slot holds. The same pass
 * writes a height field that becomes a tangent-space normal map, so moonlight
 * and lanterns pick out the stones. Tiles both ways.
 * Returns { map, normalMap }; the map is tinted by the material color.
 */
export function stoneMaps() {
  return cached('stoneMaps', () => {
    const S = 512;
    // noise: edge wobble at half resolution, the slow fields at quarter; the
    // warp and mottle tables are each read twice, at an offset, for x and y
    // (and for mottle and moss), which halves the cost of making them
    const nrng = new Rng(5);
    const n = S >> 1;
    const q = S >> 2;
    const warp = periodicNoise(nrng, q, 3, 2);
    const edgeN = periodicNoise(nrng, n, 22, 1);
    const mottle = periodicNoise(nrng, q, 8, 2);
    const rng = new Rng(4);

    const pickColor = () => {
      let r = rng.next();
      let c = FIELDSTONE[0][1];
      for (const [w, col] of FIELDSTONE) {
        if ((r -= w) < 0) {
          c = col;
          break;
        }
      }
      const v = rng.float(0.88, 1.08);
      return [c[0] * v, c[1] * v, c[2] * v];
    };

    // Stone 0 is "no stone": a slot too cramped for one stays mortar.
    const stones = [new Float32Array(ST)];
    stones[0][S_A] = -1e4;
    stones[0][S_B] = -1e4;
    // One stone in the slot between two slanted joints x = L + sL * (y - ym)
    // and x = R + sR * (y - ym), bedded between y0 and y1. Returns its index.
    const makeStone = (L, sL, R, sR, ym, y0, y1) => {
      const hh = y1 - y0;
      const iL = rng.float(3.2, 6);
      const iR = rng.float(3.2, 6);
      let iT = Math.max(2.8, rng.float(0.09, 0.18) * hh);
      let iB = Math.max(2.8, rng.float(0.09, 0.18) * hh);
      if (hh > 28 && rng.chance(0.3)) {
        // a smaller stone that leaves a fat mortar joint above or below
        const extra = rng.float(0.05, 0.16) * hh;
        if (rng.chance(0.5)) iT += extra;
        else iB += extra;
      }
      const cy = (y0 + iT + y1 - iB) / 2;
      const b = (y1 - iB - y0 - iT) / 2;
      const l0 = L + sL * (cy - ym) + iL;
      const r0 = R + sR * (cy - ym) - iR;
      const a = (r0 - l0) / 2;
      if (a < 4 || b < 4) return 0;
      const m = Math.min(a, b);
      const s = new Float32Array(ST);
      s[S_CX] = (l0 + r0) / 2;
      s[S_CY] = cy;
      s[S_A] = a;
      s[S_B] = b;
      s[S_SHEAR] = (sL + sR) / 2;
      s[S_TAPER] = (sR - sL) / 2 / a; // change of half width per px of y, relative
      s[S_TILT] = rng.float(-1, 1) * Math.min(0.09, Math.max(0, Math.min(iT, iB) - 2.6) / a);
      for (let c = 0; c < 4; c++) s[S_R + c] = rng.float(0.12, 0.6) * m;
      s[S_IBEVEL] = 1 / rng.float(2.5, 6);
      s[S_TOP] = rng.float(0.6, 1.0);
      s[S_DOME] = rng.float(0, 0.15);
      s[S_TX] = rng.float(-0.2, 0.2) / a;
      s[S_TY] = rng.float(-0.16, 0.16) / b;
      s.set(pickColor(), S_COL);
      if (rng.chance(0.3)) {
        s.set(rng.chance(0.7) ? [166, 170, 144] : [174, 162, 112], S_LICH);
        s[S_LAMT] = 0.6;
      }
      s[S_LOFF] = rng.float(-0.3, 0.05);
      s[S_IA] = 1 / a;
      s[S_IB] = 1 / b;
      stones.push(s);
      return stones.length - 1;
    };

    // --- lay the courses ------------------------------------------------------
    const heights = [];
    let sum = 0;
    while (sum < S - 24) {
      const h = rng.float(24, 44);
      heights.push(h);
      sum += h;
    }
    const fit = S / sum;
    const courseOf = new Int16Array(S);
    const courses = [];
    let y0 = 0;
    let reserved = []; // tall stones from the course below
    heights.forEach((h0, k) => {
      const H = h0 * fit;
      const y1 = y0 + H;
      const ym = y0 + H / 2;
      const last = k === heights.length - 1;
      const joints = []; // { x (on the course centre line), s (slant) }
      const fills = []; // per slot: { a, b, split } stone indices, or { tall }
      const nextReserved = [];
      const slant = () => rng.float(-0.32, 0.32);
      // fill [from, to) with ordinary slots; the joints at both ends are given
      const fillRun = (from, sFrom, to, sTo) => {
        const len = to - from;
        if (len < 1) return; // two tall stones share this joint
        const widths = [];
        let x = 0;
        while (x < len - H * 0.8) {
          const r = rng.next();
          const w = H * (r < 0.16 ? rng.float(0.8, 1.1) : r < 0.72 ? rng.float(1.2, 2.1) : rng.float(2.1, 3.2));
          widths.push(w);
          x += w;
        }
        if (!widths.length) widths.push(len);
        const f = len / widths.reduce((p, w) => p + w, 0);
        let at = from;
        let sPrev = sFrom;
        widths.forEach((w0, j) => {
          const w = w0 * f;
          // keep both ends of the stone a decent width
          const lim = (0.9 * w) / H;
          const sNext = j === widths.length - 1 ? sTo : Math.max(sPrev - lim, Math.min(sPrev + lim, slant()));
          const L = at;
          const R = at + w;
          joints.push({ x: L, s: sPrev });
          if (!last && w > H * 1.15 && w < H * 2.6 && rng.chance(0.13)) {
            // a tall stone that runs up through the next course
            const t = { L, sL: sPrev, R, sR: sNext, ym, y0, stone: 0 };
            nextReserved.push(t);
            fills.push({ tall: t });
          } else if (w < H * 1.9 && H > 33 && rng.chance(0.2)) {
            // two small stones stacked in one slot
            const split = y0 + H * rng.float(0.4, 0.6);
            fills.push({ a: makeStone(L, sPrev, R, sNext, ym, y0, split), b: makeStone(L, sPrev, R, sNext, ym, split, y1), split });
          } else {
            const a = makeStone(L, sPrev, R, sNext, ym, y0, y1);
            fills.push({ a, b: a, split: 1e9 });
          }
          at = R;
          sPrev = sNext;
        });
      };
      if (reserved.length) {
        // carry the tall stones' joints up into this course and fill between them
        const res = reserved
          .map((t) => ({ t, Lc: t.L + t.sL * (ym - t.ym), Rc: t.R + t.sR * (ym - t.ym) }))
          .sort((p, r) => p.Lc - r.Lc);
        res.forEach(({ t, Lc, Rc }, j) => {
          joints.push({ x: Lc, s: t.sL });
          t.stone = makeStone(t.L, t.sL, t.R, t.sR, t.ym, t.y0, y1);
          fills.push({ a: t.stone, b: t.stone, split: 1e9 });
          const next = res[(j + 1) % res.length];
          fillRun(Rc, t.sR, j + 1 < res.length ? next.Lc : next.Lc + S, next.t.sL);
        });
      } else {
        const start = rng.float(0, S);
        const s0 = slant();
        fillRun(start, s0, start + S, s0);
      }
      const shift = Math.floor(joints[0].x / S) * S;
      if (shift) for (const jt of joints) jt.x -= shift;
      courses.push({ ym, joints, fills });
      for (let py = Math.floor(y0); py < Math.min(S, Math.ceil(y1)); py++) courseOf[py] = k;
      reserved = nextReserved;
      y0 = y1;
    });
    // Pack each course into typed arrays, slots numbered 1..m with a sentinel
    // at each end (slot 0 = slot m moved left by S, slot m + 1 = slot 1 moved
    // right), so the per-pixel step across a slanted joint never wraps.
    const packed = courses.map((c) => {
      const m = c.joints.length;
      const jx = new Float32Array(m + 3);
      const js = new Float32Array(m + 3);
      const fab = new Int32Array((m + 2) * 2); // stone below / above a split
      const fs = new Float32Array(m + 2);
      for (let j = 0; j < m + 3; j++) {
        const src = c.joints[(j - 1 + m) % m];
        jx[j] = src.x + (j === 0 ? -S : j > m ? S : 0);
        js[j] = src.s;
      }
      for (let j = 0; j < m + 2; j++) {
        const f = c.fills[(j - 1 + m) % m];
        // the lower half of a tall stone is the stone built with the course above
        fab[j * 2] = f.tall ? f.tall.stone : f.a;
        fab[j * 2 + 1] = f.tall ? f.tall.stone : f.b;
        fs[j] = f.tall ? 1e9 : f.split;
      }
      const slotOf = new Int16Array(S);
      for (let j = 1; j <= m; j++) {
        for (let px = Math.ceil(jx[j]); px < jx[j + 1]; px++) slotOf[((px % S) + S) % S] = j;
      }
      return { ym: c.ym, base: jx[1], jx, js, fab, fs, slotOf };
    });
    const st = new Float32Array(stones.length * ST);
    stones.forEach((s, i) => st.set(s, i * ST));

    // --- paint colour and height, and normals a row behind ------------------------
    const map = makeCanvas(S, S);
    const mctx = map.getContext('2d');
    const img = mctx.createImageData(S, S);
    const nmap = makeCanvas(S, S);
    const nctx = nmap.getContext('2d');
    const nimg = nctx.createImageData(S, S);
    const height = new Float32Array(S * S);
    // fine grain in the stone and sand, from a small tile of random values
    const grain = new Float32Array(4096);
    for (let i = 0; i < grain.length; i++) grain[i] = nrng.next() - 0.5;
    const env = { S, n, q, warp, edgeN, mottle, grain, courseOf, packed, st, height, rgba: img.data };
    for (let y = 0; y < S; y++) {
      paintStoneRow(y, env);
      if (y >= 2) stoneNormalRow(y - 1, S, height, nimg.data);
    }
    stoneNormalRow(S - 1, S, height, nimg.data);
    stoneNormalRow(0, S, height, nimg.data);
    mctx.putImageData(img, 0, 0);
    nctx.putImageData(nimg, 0, 0);
    return { map: toTexture(map), normalMap: toTexture(nmap, { srgb: false }) };
  });
}

/** One row of the fieldstone: color into env.rgba, relief into env.height. */
function paintStoneRow(y, env) {
  const { S, n, q, warp, edgeN, mottle, grain, courseOf, packed, st, height, rgba } = env;
  const qh = q >> 1;
  const qm = q - 1;
  const nrow = (y >> 1) * n;
  const qy = y >> 2;
  const qrow = qy * q;
  const qrow2 = ((qy + qh) & qm) * q;
  const qrow3 = ((qy + (qh >> 1)) & qm) * q;
  const invS = 1 / S;
  const grow = (y & 63) << 6;
  for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const ni = nrow + (x >> 1);
    const qx = x >> 2;
    const qi = qrow + qx;
    const gr = grain[grow + (x & 63)];
    // wander the courses and joints a little
    let yy = y + warp[qrow2 + ((qx + qh) & qm)] * 6;
    yy -= S * Math.floor(yy * invS);
    let xx = x + warp[qi] * 9;
    xx -= S * Math.floor(xx * invS);
    // slot on the course centre line, then step across a slanted joint
    const C = packed[courseOf[yy | 0]];
    const dyc = yy - C.ym;
    const jx = C.jx;
    const js = C.js;
    let j = C.slotOf[xx | 0];
    const u = xx < C.base ? xx + S : xx;
    if (u < jx[j] + js[j] * dyc) j--;
    else if (u >= jx[j + 1] + js[j + 1] * dyc) j++;
    const k = C.fab[j * 2 + (yy >= C.fs[j] ? 1 : 0)] * ST;
    // stone-local coordinates (wrapped), with the trapezoid and bed tilt undone
    let dx = u - st[k + S_CX];
    dx -= S * Math.round(dx * invS);
    let dy = yy - st[k + S_CY];
    dy -= S * Math.round(dy * invS);
    const sx = (dx - st[k + S_SHEAR] * dy) / (1 + st[k + S_TAPER] * dy);
    const sy = dy - st[k + S_TILT] * sx;
    // signed distance to a rounded rectangle, px (negative inside)
    const cr = st[k + S_R + (sx > 0 ? 0 : 2) + (sy > 0 ? 0 : 1)];
    const ax = (sx < 0 ? -sx : sx) - (st[k + S_A] - cr);
    const ay = (sy < 0 ? -sy : sy) - (st[k + S_B] - cr);
    const d = (ax > 0 && ay > 0 ? Math.sqrt(ax * ax + ay * ay) : ax > ay ? ax : ay) - cr + edgeN[ni] * 2.4;

    const mt = mottle[qi];
    const mz = mottle[qrow3 + ((qx + qh) & qm)]; // damp patches: moss, and no lichen
    // mortar: lime and sand with moss in damp patches, shadowed beside stones
    const ao = d <= 0 ? 0 : d < 3.4 ? d * 0.294 : 1;
    const mossT = mz <= 0.16 ? 0 : mz > 0.577 ? 0.6 : (mz - 0.16) * 1.44;
    const mShade = 0.6 + 0.26 * ao + mt * 0.08 + gr * 0.1;
    let red = (156 - 76 * mossT) * mShade;
    let grn = (148 - 58 * mossT) * mShade;
    let blu = (132 - 76 * mossT) * mShade;
    let h = 0.06 + gr * 0.03 + mt * 0.02 + ao * 0.04;
    if (d < 0.5) {
      // a rounded edge rising to a flattish, slightly tilted face
      const e = -d * st[k + S_IBEVEL];
      const prof = e <= 0 ? 0 : e >= 1 ? 1 : Math.sqrt(e * (2 - e));
      const ux = sx * st[k + S_IA];
      const uy = sy * st[k + S_IB];
      const dome = st[k + S_DOME] * (1 - ux * ux) * (1 - uy * uy);
      const hs = 0.1 + (st[k + S_TOP] - 0.1 + dome + sx * st[k + S_TX] + sy * st[k + S_TY] + mt * 0.07) * prof + gr * 0.012;
      const shade = (0.86 + 0.14 * prof) * (1 + mt * 0.13 + gr * 0.08);
      // lichen on the faces of some stones, where the growth field is low
      const l = st[k + S_LOFF] - mz;
      const lt = (l <= 0.1 ? 0 : l > 0.433 ? 1 : (l - 0.1) * 3) * st[k + S_LAMT] * prof;
      const sr = st[k + S_COL] * shade;
      const sg = st[k + S_COL + 1] * shade;
      const sb = st[k + S_COL + 2] * shade;
      // one-pixel blend across the edge
      const t = d < -0.5 ? 1 : 0.5 - d;
      red += (sr + (st[k + S_LICH] - sr) * lt - red) * t;
      grn += (sg + (st[k + S_LICH + 1] - sg) * lt - grn) * t;
      blu += (sb + (st[k + S_LICH + 2] - sb) * lt - blu) * t;
      h += (hs - h) * t;
    }
    height[i] = h;
    const o = i * 4;
    rgba[o] = red;
    rgba[o + 1] = grn;
    rgba[o + 2] = blu;
    rgba[o + 3] = 255;
  }
}

/** Tangent-space normals for one row of the height field (+v is up the canvas). */
function stoneNormalRow(y, S, height, out) {
  const relief = 3.2;
  const up = ((y - 1 + S) % S) * S;
  const dn = ((y + 1) % S) * S;
  const row = y * S;
  for (let x = 0; x < S; x++) {
    const nx = -(height[row + (x === S - 1 ? 0 : x + 1)] - height[row + (x === 0 ? S - 1 : x - 1)]) * relief;
    const ny = (height[dn + x] - height[up + x]) * relief;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    const o = (row + x) * 4;
    out[o] = (nx * inv * 0.5 + 0.5) * 255;
    out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
    out[o + 2] = (inv * 0.5 + 0.5) * 255;
    out[o + 3] = 255;
  }
}

export function stoneTexture() {
  return stoneMaps().map;
}

export function stoneNormalTexture() {
  return stoneMaps().normalMap;
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
