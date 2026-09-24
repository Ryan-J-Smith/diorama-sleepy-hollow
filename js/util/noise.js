// Seeded 2D Perlin noise with fractal helpers, used for terrain, wood grain,
// texture painting and candle flicker.

import { mulberry32 } from './rng.js';

const perm = new Uint8Array(512);
{
  const rand = mulberry32(1820);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

function grad(hash, x, y) {
  switch (hash & 7) {
    case 0: return x + y;
    case 1: return -x + y;
    case 2: return x - y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

/** Perlin noise, roughly in [-1, 1]. */
export function perlin2(x, y) {
  let X = Math.floor(x);
  let Y = Math.floor(y);
  x -= X;
  y -= Y;
  X &= 255;
  Y &= 255;
  const u = fade(x);
  const v = fade(y);
  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];
  return lerp(
    lerp(grad(aa, x, y), grad(ba, x - 1, y), u),
    lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u),
    v,
  );
}

/** Fractal Brownian motion built on perlin2, roughly in [-1, 1]. */
export function fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2(x, y);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

/** Smooth 1D noise in [-1, 1] — handy for flicker and sway. */
export function noise1(x, seed = 0) {
  return perlin2(x, seed * 17.13 + 0.5) * 1.4;
}

/** Perlin noise that tiles with period (px, py) in lattice units. */
export function perlin2Periodic(x, y, px, py) {
  const Xf = Math.floor(x);
  const Yf = Math.floor(y);
  x -= Xf;
  y -= Yf;
  const X0 = ((Xf % px) + px) % px;
  const Y0 = ((Yf % py) + py) % py;
  const X1 = (X0 + 1) % px;
  const Y1 = (Y0 + 1) % py;
  const u = fade(x);
  const v = fade(y);
  const aa = perm[perm[X0] + Y0];
  const ab = perm[perm[X0] + Y1];
  const ba = perm[perm[X1] + Y0];
  const bb = perm[perm[X1] + Y1];
  return lerp(
    lerp(grad(aa, x, y), grad(ba, x - 1, y), u),
    lerp(grad(ab, x, y - 1), grad(bb, x - 1, y - 1), u),
    v,
  );
}

/** Tileable fBm over the unit square: (u, v) in [0, 1), base period in cells. */
export function fbmTile(u, v, period = 4, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin2Periodic(u * p, v * p, p, p);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}
