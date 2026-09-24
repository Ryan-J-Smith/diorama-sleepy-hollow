// Shared dimensions for the diorama. World units are loosely "diorama inches":
// the landscape inside the glass is 18.8 x 11.2, +z is the front of the case.

export const TERRAIN = {
  hx: 9.4, // half-width of the landscape (x)
  hz: 5.6, // half-depth of the landscape (z)
  segX: 188,
  segZ: 112,
  base: 0.62, // resting height of the ground above the wooden base top
};

export const WATER_Y = 0.36;

export const ROAD_HALF = 0.3;

// Glass case, sitting on the base top (y = 0).
export const CASE = {
  hx: 9.56,
  hz: 5.76,
  height: 6.4,
  frame: 0.07, // thickness of the wooden frame members
};

// Wooden base: top surface half extents; the body extends downward from y = 0.
export const BASE = {
  hx: 9.95,
  hz: 6.15,
  height: 1.7,
  footHeight: 0.14,
};

export const TABLE_Y = -BASE.height - BASE.footHeight;

// Capture mode (?capture=1) renders fixed-size, deterministic frames for the
// promo video: no interface, no music, no wall clock (see js/capture.js).
export const CAPTURE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('capture');
export const CAPTURE_SIZE = { width: 1920, height: 1080 };

const coarse = !CAPTURE && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const small = !CAPTURE && typeof innerWidth === 'number' && Math.min(innerWidth, innerHeight) < 700;

export const QUALITY = {
  mobile: coarse || small,
  pixelRatio: CAPTURE ? 1 : Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, coarse || small ? 1.5 : 2),
  shadowSize: coarse || small ? 1024 : 2048,
  msaa: coarse || small ? 2 : 4,
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
