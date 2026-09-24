// Owls that turn their heads to watch the riders pass, and crows circling
// ominously over the cornfield or perched on the scarecrow.

import * as THREE from 'three';
import { mergeAll, paint, taperedTube } from '../util/geom.js';
import { Rng } from '../util/rng.js';
import { BUILDINGS, CLEARINGS } from '../world/layout.js';

const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// ---------------------------------------------------------------------------
// Owls
//
// Carved like the riders and horses rather than stacked from balls: a lofted,
// flat-shaded body with broad shoulders, folded wings ending in a row of
// feather-tip facets, a fanned tail and talons curled round the perch; and a
// separate head, swivelling on the shoulders, with a dished facial disc inside
// a raised rim and a small hooked beak. Vertex colours carry the big shapes (a
// pale breast and face against darker wings) so the owl reads by moonlight; a
// small canvas texture adds the barring (or a barn owl's specks) up close.

const OWL_KINDS = {
  // great horned owl: tawny face in a black rim, white throat, barred breast
  horned: {
    plumage: '#5a4735',
    face: '#d2ab80',
    tufts: true,
    chest: '#bca787',
    rim: '#1f1812',
    brow: '#eee6d6',
    bib: '#e8e1d2',
    beak: '#2e2925',
    feet: '#b09c7c',
    pattern: 'bars',
    heart: false,
    slim: 0.96,
    legs: 0,
    head: { rx: 0.049, ry: 0.036, rz: 0.036, discW: 0.04, discH: 0.032 },
    eye: { x: 0.0182, r: 0.0085, pupil: 0.0057 },
    mantle: 0.8,
    dish: 0,
  },
  // barn owl: white heart-shaped face, snowy breast, golden-buff back, and
  // eyes that are nearly all pupil
  barn: {
    plumage: '#ad7a45',
    face: '#fbf9f4',
    tufts: false,
    chest: '#e2d4b9',
    rim: '#6e4528',
    brow: '#eee8dc',
    bib: '#efe8da',
    beak: '#d9c4b0',
    feet: '#e6dbc6',
    pattern: 'specks',
    heart: true,
    slim: 0.85,
    legs: 0.012,
    head: { rx: 0.041, ry: 0.038, rz: 0.034, discW: 0.035, discH: 0.033 },
    eye: { x: 0.0135, r: 0.0066, pupil: 0.0052 },
    mantle: 0,
    dish: 0.0025,
  },
};

// torso cross-sections, bottom to top: [y, centre z, half width, front depth, back depth]
const OWL_TORSO = [
  [0.003, 0.008, 0.005, 0.005, 0.005],
  [0.012, 0.008, 0.022, 0.025, 0.02],
  [0.028, 0.006, 0.033, 0.038, 0.03],
  [0.047, 0.003, 0.043, 0.043, 0.036],
  [0.067, 0.0, 0.048, 0.042, 0.038],
  [0.086, -0.002, 0.048, 0.039, 0.038],
  [0.1, -0.003, 0.043, 0.036, 0.031],
  [0.11, -0.004, 0.032, 0.03, 0.022],
  [0.118, -0.004, 0.016, 0.016, 0.011],
];
// facial disc, centre to outer edge: [fraction of the outline, height off the face]
const OWL_DISC = [[0, 0.006], [0.3, 0.002], [0.6, 0.0005], [0.86, 0.002], [1, 0.0065], [1.14, -0.003]];
// head centre above the neck pivot
const OWL_HEAD_C = [0, 0.026, 0.003];

const smooth = (e0, e1, x) => THREE.MathUtils.smoothstep(x, e0, e1);
/** Cheap deterministic noise for mottling, 0..1. */
const hash = (a, b, c = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Quad-grid surface over (u, v) in [0, 1]: pos(u, v, i, j) -> [x, y, z],
 * color(u, v, i, j) -> THREE.Color (copied at once, so it may be reused) and
 * uv(u, v, i, j) -> [s, t]. Seam vertices are kept apart so the UVs never
 * wrap across a face; `flip` reverses the winding for grids that run the
 * other way round.
 */
function gridSurface(nu, nv, { pos, color, uv = (u, v) => [u, v], flip = false }) {
  const P = [];
  const C = [];
  const T = [];
  const I = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      P.push(...pos(u, v, i, j));
      const c = color(u, v, i, j);
      C.push(c.r, c.g, c.b);
      T.push(...uv(u, v, i, j));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      if (flip) I.push(a, d, b, a, c, d);
      else I.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  return g;
}

/** Colour a tube ring by ring (colorAt(ring) -> THREE.Color) and park its UVs on unmarked texture. */
function paintRings(g, ringSize, colorAt) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const uv = g.attributes.uv;
  for (let q = 0; q < n; q++) {
    const c = colorAt(Math.floor(q / ringSize));
    arr[q * 3] = c.r;
    arr[q * 3 + 1] = c.g;
    arr[q * 3 + 2] = c.b;
    if (uv) uv.setXY(q, 0.5, 0.99);
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const owlTextures = new Map();

/**
 * Breast markings as a multiply map on white: wavy, broken cross-bars for the
 * horned owl or a scatter of fine specks for the barn owl. u wraps round the
 * body; v runs up it, and the top is left clean for the pale throat.
 */
function owlPlumageTexture(pattern) {
  if (owlTextures.has(pattern)) return owlTextures.get(pattern);
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  const rng = new Rng(pattern === 'bars' ? 41 : 43);
  // every mark is drawn three times across so the pattern wraps seamlessly
  const wrapped = (draw) => {
    for (const dx of [-S, 0, S]) draw(dx);
  };
  if (pattern === 'bars') {
    // bold streaks and blotches across the upper breast...
    for (let k = 0; k < 26; k++) {
      const x = rng.float(0, S);
      const y = rng.float(S * 0.26, S * 0.5);
      const w = rng.float(3, 7);
      const tilt = rng.float(-0.2, 0.2);
      g.fillStyle = `rgba(52, 38, 26, ${rng.float(0.25, 0.45).toFixed(3)})`;
      wrapped((dx) => {
        g.beginPath();
        g.ellipse(x + dx, y, w, w * 0.45, tilt, 0, Math.PI * 2);
        g.fill();
      });
    }
    // ...then fine, close, slightly wavy cross-bars down the belly
    const rows = 20;
    for (let r = 0; r < rows; r++) {
      // canvas y runs down from the throat (v = 1) to the belly (v = 0)
      const y0 = S * 0.27 + (r + 0.5) * ((S * 0.73) / rows);
      const fade = Math.min(1, (y0 - S * 0.25) / (S * 0.12));
      let x = rng.float(0, 8);
      while (x < S) {
        const len = rng.float(14, 30);
        const phase = rng.float(0, Math.PI * 2);
        g.lineWidth = rng.float(0.9, 1.6);
        g.strokeStyle = `rgba(56, 42, 30, ${((0.4 + rng.float(0, 0.25)) * fade).toFixed(3)})`;
        const x0 = x;
        wrapped((dx) => {
          g.beginPath();
          for (let k = 0; k <= 8; k++) {
            const px = x0 + (len * k) / 8;
            const py = y0 + 0.8 * Math.sin(px * 0.3 + phase);
            if (k) g.lineTo(px + dx, py);
            else g.moveTo(px + dx, py);
          }
          g.stroke();
        });
        x += len + rng.float(2, 6);
      }
    }
  } else {
    for (let k = 0; k < 90; k++) {
      const x = rng.float(0, S);
      const y = rng.float(S * 0.3, S);
      const r = rng.float(0.6, 1.3);
      g.fillStyle = `rgba(62, 46, 34, ${rng.float(0.5, 0.85).toFixed(3)})`;
      wrapped((dx) => {
        g.beginPath();
        g.arc(x + dx, y, r, 0, Math.PI * 2);
        g.fill();
      });
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  owlTextures.set(pattern, tex);
  return tex;
}

/** Interpolated torso cross-section at height y: [centre z, half width, front depth, back depth]. */
function torsoSection(y) {
  const T = OWL_TORSO;
  if (y <= T[0][0]) return T[0].slice(1);
  for (let k = 0; k < T.length - 1; k++) {
    const a = T[k];
    const b = T[k + 1];
    if (y <= b[0]) {
      const t = (y - a[0]) / (b[0] - a[0]);
      return [1, 2, 3, 4].map((n) => a[n] + (b[n] - a[n]) * t);
    }
  }
  return T[T.length - 1].slice(1);
}

/** Point on the torso at angle psi round from the breast (+z) and height y, `out` proud of the surface. */
function torsoPoint(psi, y, out = 0) {
  const [zc, w, front, back] = torsoSection(y);
  const s = Math.sin(psi);
  const c = Math.cos(psi);
  // a little squarer than an ellipse: broad shoulders and a full breast
  const sx = Math.sign(s) * Math.abs(s) ** 0.85;
  const cz = Math.sign(c) * Math.abs(c) ** 0.85;
  return [(w + out) * sx, y, zc + ((c > 0 ? front : back) + out) * cz];
}

/** Torso, folded wings and tail (owl units, perch top at y = 0, facing +z). */
function owlBody(k, P) {
  const c = new THREE.Color();
  const parts = [];
  const top = OWL_TORSO[OWL_TORSO.length - 1][0];
  const rows = OWL_TORSO.length - 1;
  const around = (u) => Math.PI + 2 * Math.PI * u; // seam down the back, under the wings

  // torso: pale barred breast in front, plumage behind, a white throat
  parts.push(gridSurface(12, rows, {
    pos: (u, v, i, j) => torsoPoint(around(u), OWL_TORSO[j][0]),
    color: (u, v, i, j) => {
      const y = OWL_TORSO[j][0];
      const front = smooth(0.1, 0.65, Math.cos(around(u)));
      c.copy(P.plumage).lerp(P.chest, front);
      // the upper breast is darker and streaky under a white throat patch
      c.lerp(P.plumage, k.mantle * smooth(0.07, 0.1, y));
      c.lerp(P.bib, smooth(0.78, 0.95, Math.cos(around(u))) * smooth(0.098, 0.106, y));
      c.lerp(P.feet, (1 - smooth(0.006, 0.024, y)) * 0.6);
      return c.multiplyScalar(0.9 + 0.2 * hash(i, j, 1));
    },
    uv: (u, v, i, j) => [u * 3, OWL_TORSO[j][0] / top],
  }));

  // folded wings: from the shoulder down the flanks to primaries crossed over
  // the tail, standing proud of the body, with a step where the coverts lie
  // over the flight feathers and a row of feather tips along the lower edge
  const WU = 6;
  const WV = 4;
  const proud = [0.001, 0.0075, 0.0085, 0.006, 0.0045];
  for (const sx of [-1, 1]) {
    parts.push(gridSurface(WU, WV, {
      flip: sx > 0,
      pos: (u, v, i, j) => {
        // the wrists come forward at the shoulders; the leading edge sweeps back below
        const lead = 0.21 + 0.19 * v * v;
        const psi = Math.PI * (lead + (1.04 - lead) * u);
        const yTop = 0.107 + 0.007 * Math.sin(Math.PI * u) + 0.003 * u;
        const yBot = 0.042 - 0.054 * u;
        let y = yTop + (yBot - yTop) * v;
        if (j === WV && i % 2 === 0) y -= 0.007;
        // below the belly the primaries sweep back and in over the tail
        const floor = 0.026;
        const [x, , z] = torsoPoint(psi, Math.max(y, floor), proud[j]);
        const d = Math.max(0, floor - y);
        return [sx * x * (1 - d * 12), y, z - d * 0.6];
      },
      color: (u, v, i, j) => {
        const n = hash(i, j, sx + 3);
        c.copy(P.plumage).multiplyScalar(0.8 + 0.36 * n);
        if (j === 1 && n > 0.55) c.lerp(P.chest, 0.4); // pale spots on the coverts
        if (i === 0 && j < WV) c.lerp(P.chest, 0.18); // paler leading edge
        if (j === WV) c.multiplyScalar(i % 2 === 0 ? 0.62 : 1.1); // dark feather tips
        return c;
      },
      uv: (u, v) => [u * 0.9, 0.1 + (1 - v) * 0.55],
    }));
  }

  // tail: a short fan below the wing tips, its end cut into feathers
  parts.push(gridSurface(4, 2, {
    pos: (u, v, i, j) => {
      const a = 2 * u - 1;
      let y = 0.03 - 0.066 * v;
      if (j === 2 && i % 2 === 1) y -= 0.006;
      return [a * (0.011 + 0.011 * v), y, -0.022 - 0.03 * v - 0.004 * (1 - a * a)];
    },
    color: (u, v, i, j) => c.copy(P.plumage).multiplyScalar(j === 2 ? (i % 2 ? 0.7 : 1.05) : 0.85 + 0.2 * hash(i, j, 9)),
    uv: (u, v) => [u * 0.5, 0.08 + (1 - v) * 0.4],
  }));

  for (const g of parts) {
    g.scale(k.slim, 1, 1);
    g.translate(0, k.legs, 0);
  }
  return parts;
}

/**
 * Feathered feet (and a barn owl's long legs) with talons curled round a perch
 * of radius r along x that rises `slope` per unit x, so both feet are on the bark.
 */
function owlFeet(k, P, r, slope = 0) {
  const parts = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const talon = new THREE.Color('#1b1714');
  const R = r + 0.0021;
  // a toe follows the perch from angle a0 (from the top, + toward the front) for `len`
  const toe = (x, a0, len) => {
    const pts = [];
    for (let q = 0; q < 5; q++) {
      const a = a0 + (len / R) * (q / 4);
      pts.push(V(x, x * slope - r + R * Math.cos(a), R * Math.sin(a)));
    }
    const g = taperedTube(pts, [0.0025, 0.0023, 0.002, 0.0013, 0.0003], 3);
    return paintRings(g, 4, (q) => (q < 3 ? P.feet : talon));
  };
  for (const sx of [-1, 1]) {
    const fx = sx * 0.012;
    const lump = new THREE.IcosahedronGeometry(0.0072, 0);
    lump.scale(1.1, 0.75, 1.2);
    lump.translate(fx, fx * slope + 0.004, 0.005);
    parts.push(paintRings(lump, 1, () => P.feet));
    if (k.legs > 0) {
      const leg = taperedTube([V(fx * 0.9, k.legs + 0.014, 0.002), V(fx, fx * slope + 0.004, 0.005)], [0.0048, 0.0036], 5);
      parts.push(paintRings(leg, 6, () => P.feet));
    }
    const len = k.legs > 0 ? 0.013 : 0.016;
    parts.push(toe(fx - 0.0035, 0.18, len), toe(fx + 0.0035, 0.18, len), toe(fx, -0.2, -0.011));
  }
  return parts;
}

/** Eye cone: a faceted cornea rising h above its rim (radius r), lifted off the face by `lift`. */
function eyeCone(r, h, segs, lift = 0) {
  const g = new THREE.CircleGeometry(r, segs);
  const p = g.attributes.position;
  for (let q = 0; q < p.count; q++) {
    const rho = Math.hypot(p.getX(q), p.getY(q));
    p.setZ(q, lift + h * (1 - rho / r));
  }
  g.computeVertexNormals();
  return g;
}

/** Head (in head space, pivot at the neck): shell, facial disc, beak, tufts, and the eyes. */
function owlHead(k, P) {
  const c = new THREE.Color();
  const parts = [];
  const { rx, ry, rz, discW, discH } = k.head;
  const [cx, cy, cz] = OWL_HEAD_C;
  // the face is a plane this far forward; the shell is pressed flat behind it
  const f = 0.45 * rz;
  const shellFace = f - 0.005;

  parts.push(gridSurface(12, 7, {
    pos: (u, v) => {
      const psi = Math.PI + 2 * Math.PI * u;
      const th = Math.PI * (1 - v);
      // the lower half is full and flattish, and the nape falls straight down
      // into the shoulders, so the head sits on the body with no neck showing
      const nape = 1 - smooth(-0.7, -0.1, Math.cos(psi));
      const lower = Math.sin(th) ** 0.55;
      const s = th > Math.PI / 2 ? lower + (Math.min(1, lower * 1.6) - lower) * nape : Math.sin(th);
      let y = ry * Math.cos(th) * (th > Math.PI / 2 ? 0.85 : 1);
      if (y > 0.6 * ry) y = 0.6 * ry + (y - 0.6 * ry) * 0.55; // flat-topped between the tufts
      let z = rz * s * Math.cos(psi);
      if (z > shellFace) z = shellFace + (z - shellFace) * 0.1;
      else if (z < 0) z *= 1.15 - 0.1 * Math.cos(th); // a full nape, down over the shoulders
      return [cx + rx * s * Math.sin(psi), cy + y, cz + z];
    },
    color: (u, v, i, j) => {
      const front = smooth(0.2, 0.8, Math.cos(Math.PI + 2 * Math.PI * u));
      const up = Math.cos(Math.PI * (1 - v));
      const middle = smooth(0.75, 0.97, Math.cos(Math.PI + 2 * Math.PI * u));
      c.copy(P.plumage).multiplyScalar(0.85 + 0.3 * hash(i, j, 5));
      c.lerp(P.brow, middle * smooth(0.45, 0.8, up) * (k.tufts ? 0.8 : 0)); // pale brows over the disc
      c.lerp(P.bib, front * (1 - smooth(-0.9, -0.6, up))); // white chin
      return c;
    },
  }));

  // facial disc: a dish round each eye, a pale ridge down the middle over the
  // beak and a raised rim (black on the horned owl, dark ochre on the barn owl)
  const dy = cy - 0.003;
  const outline = (phi) => {
    const sn = Math.sin(phi);
    const cs = Math.cos(phi);
    let R = 1 / Math.sqrt((sn / discW) ** 2 + (cs / discH) ** 2);
    const a = Math.atan2(sn, cs);
    if (k.heart) {
      R *= 1 - 0.3 * Math.exp(-((a / 0.4) ** 2)); // notch at the top of the heart
      R *= 1 + 0.26 * Math.exp(-(((Math.abs(a) - Math.PI) / 0.55) ** 2)); // point at the chin
    } else {
      R *= 1 - 0.1 * Math.exp(-((a / 0.35) ** 2)); // the brows dip into a shallow V
    }
    return R;
  };
  const discZ = (x, y, lift) => cz + f + lift - 0.005 * (x / discW) ** 2 - 0.004 * ((y - dy) / discH) ** 2;
  const discLift = (s) => {
    for (let q = 0; q < OWL_DISC.length - 1; q++) {
      const [s0, z0] = OWL_DISC[q];
      const [s1, z1] = OWL_DISC[q + 1];
      // a barn owl's heart is dished deeper than a horned owl's face
      if (s <= s1) return z0 + ((z1 - z0) * (s - s0)) / (s1 - s0) - k.dish * Math.sin(Math.PI * Math.min(1, s));
    }
    return OWL_DISC[OWL_DISC.length - 1][1];
  };
  parts.push(gridSurface(16, OWL_DISC.length - 1, {
    pos: (u, v, i, j) => {
      const phi = 2 * Math.PI * u;
      const R = outline(phi) * OWL_DISC[j][0];
      const x = R * Math.sin(phi);
      const y = dy + R * Math.cos(phi);
      return [x, y, discZ(x, y, discLift(OWL_DISC[j][0]))];
    },
    color: (u, v, i, j) => {
      const s = OWL_DISC[j][0];
      const upper = Math.cos(2 * Math.PI * u);
      if (s <= 0.3) c.copy(P.brow);
      else if (s < 0.9) c.copy(P.face);
      else if (s <= 1) c.copy(P.rim).lerp(P.brow, k.tufts ? smooth(0.85, 0.97, upper) : 0);
      else c.copy(k.tufts ? P.rim : P.plumage);
      return c.multiplyScalar(0.94 + 0.12 * hash(i, j, 7));
    },
  }));

  // small hooked beak, mostly buried in the feathers between the eyes
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const by = dy - 0.0045;
  const bz = cz + f + 0.005;
  const beak = taperedTube([V(0, by + 0.001, bz - 0.002), V(0, by, bz + 0.003), V(0, by - 0.004, bz + 0.0065), V(0, by - 0.0085, bz + 0.0065)], [0.0042, 0.0034, 0.0019, 0.0003], 5);
  beak.scale(0.75, 1, 1);
  const beakTip = P.beak.clone().multiplyScalar(0.6);
  parts.push(paintRings(beak, 6, (q) => (q < 2 ? P.beak : beakTip)));

  // ear tufts: each a pair of flattened feather plumes, swept up, out and back
  if (k.tufts) {
    const tuftTip = P.rim.clone().lerp(P.plumage, 0.35);
    for (const sx of [-1, 1]) {
      // a broad plume with a shorter one tucked in front of it, for a ragged tip
      for (const [len, base, lean, back, dx, dz] of [[0.027, 0.0064, 0.42, 0.28, 0, 0], [0.017, 0.0042, 0.2, 0.12, -0.004, 0.003]]) {
        const t = taperedTube([V(0, 0, 0), V(sx * 0.001, len * 0.36, 0), V(sx * 0.003, len * 0.7, 0), V(sx * 0.0062, len, 0)], [base, base * 0.85, base * 0.55, 0.0003], 4);
        t.scale(1, 1, 0.42);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-back, 0, -sx * lean));
        t.applyMatrix4(new THREE.Matrix4().compose(V(sx * (0.026 + dx), cy + 0.02, cz - 0.003 + dz), q, V(1, 1, 1)));
        parts.push(paintRings(t, 5, (ring) => (ring === 0 ? P.plumage : tuftTip)));
      }
    }
  }

  // eyes: amber iris under a big night-dilated pupil, a dark lid rim and a
  // pinpoint of reflected moonlight. Each eye is its own group so it can blink.
  const { x: ex, r: ri, pupil: rp } = k.eye;
  const eyes = [];
  const lidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
  const irisMat = new THREE.MeshStandardMaterial({ color: 0x6e4414, emissive: 0xe0902e, emissiveIntensity: 0.42, roughness: 0.3 });
  const glintMat = new THREE.MeshBasicMaterial({ color: 0x8c96a6 });
  const h = 0.3 * ri;
  const lid = new THREE.RingGeometry(ri * 0.96, ri * 1.3, 12);
  const pupil = eyeCone(rp, 0.3 * rp, 10, 0.3 * (ri - rp) + 0.0005);
  const dark = mergeAll([paint(lid, 0x17110c), paint(pupil, 0x040302)]);
  const glint = new THREE.CircleGeometry(ri * 0.14, 6);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    const ey = dy + 0.003;
    eye.position.set(sx * ex, ey, discZ(sx * ex, ey, discLift(ex / discW)) + 0.0007);
    eye.add(new THREE.Mesh(eyeCone(ri, h, 12), irisMat));
    eye.add(new THREE.Mesh(dark, lidMat));
    const g = new THREE.Mesh(glint, glintMat);
    g.position.set(-sx * rp * 0.35, rp * 0.4, h + 0.0009);
    eye.add(g);
    eyes.push(eye);
  }
  return { parts, eyes };
}

/**
 * One owl, facing +z with its feet on a perch of radius `perchRadius` (owl
 * units) running along x under y = 0 and rising `perchSlope` per unit x.
 * Returns the owl, its head (swivel with rotation.y, tilt with rotation.z) and
 * the two eye groups (squash scale.y to blink).
 */
function makeOwl(spec) {
  const k = { ...OWL_KINDS.horned, ...spec };
  const col = (h) => new THREE.Color(h);
  const P = {
    plumage: col(k.plumage),
    face: col(k.face),
    chest: col(k.chest),
    rim: col(k.rim),
    brow: col(k.brow),
    bib: col(k.bib),
    beak: col(k.beak),
    feet: col(k.feet),
  };
  const owl = new THREE.Group();
  const bodyGeo = mergeAll([...owlBody(k, P), ...owlFeet(k, P, k.perchRadius ?? 0.02, k.perchSlope ?? 0)]);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: owlPlumageTexture(k.pattern),
    flatShading: true,
    roughness: 0.92,
    side: THREE.DoubleSide,
  }));
  body.castShadow = true;
  body.receiveShadow = true;
  owl.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.102 + k.legs, 0.01);
  owl.add(head);
  const { parts, eyes } = owlHead(k, P);
  const skull = new THREE.Mesh(mergeAll(parts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  skull.castShadow = true;
  skull.receiveShadow = true;
  head.add(skull, ...eyes);
  return { owl, head, eyes };
}

const OWL_SCALE = 1.15;

// Where the horned owls sit: out on level, sturdy stretches of limb clear of
// any fork, so they show against the sky instead of hiding in a crotch of the
// tree. Read off the seeded trees in trees.js (Major André's tree by the front
// road, and the dead tree in the churchyard by the right-hand glass): `at` is
// the top of the bark under the owl, `r` the limb's radius there, `yaw` turns
// the owl square across the limb, facing out of the case, and `slope` is how
// much the limb rises toward the owl's left.
const OWL_PERCHES = [
  // faces the front glass
  { kind: 'horned', at: [2.12, 2.016, 5.21], r: 0.0235, yaw: -0.38, slope: -0.06 },
  // high in the churchyard tree, out along a limb reaching for the right-hand
  // glass: clear of the church and the foreground maples, it shows against the
  // dark from the default view, and looks out toward the front-right corner
  { kind: 'horned', at: [9.212, 1.983, 1.04], r: 0.011, yaw: 0.68, slope: -0.26 },
];

function buildOwls(world) {
  const { scene } = world;
  const rng = new Rng(31);
  const barn = BUILDINGS.find((b) => b.id === 'barn');
  const spots = OWL_PERCHES.map((p) => ({ ...p, pos: new THREE.Vector3(...p.at) }));
  // the barn owl stands on the ridge board (0.058 above the roof's peak) near the east gable
  spots.push({ kind: 'barn', pos: new THREE.Vector3(barn.x + 0.72, barn.y + 0.82 + 0.78 + 0.058, barn.z), r: 0.022, yaw: 0 });

  const owls = spots.map((s) => {
    const o = makeOwl({ ...OWL_KINDS[s.kind], perchRadius: s.r / OWL_SCALE, perchSlope: s.slope ?? 0 });
    o.owl.position.copy(s.pos);
    o.owl.rotation.y = s.yaw;
    o.owl.scale.setScalar(OWL_SCALE);
    scene.add(o.owl);
    return { ...o, yaw: 0, nextBlink: rng.float(1, 4), blink: 0, baseYaw: s.yaw };
  });

  const tmp = new THREE.Vector3();
  world.addUpdater((dt, t) => {
    if (dt <= 0) return;
    const riders = [world.actors.ichabod?.(), world.actors.horseman?.()].filter(Boolean);
    for (const o of owls) {
      // watch whichever rider is closer
      let target = null;
      let best = 6;
      for (const r of riders) {
        const d = r.distanceTo(o.owl.position);
        if (d < best) {
          best = d;
          target = r;
        }
      }
      let want = 0.35 * Math.sin(t * 0.3 + o.baseYaw * 3);
      if (target) {
        tmp.subVectors(target, o.owl.position);
        want = Math.atan2(tmp.x, tmp.z) - o.baseYaw;
        want = Math.atan2(Math.sin(want), Math.cos(want));
        want = Math.max(-2.3, Math.min(2.3, want));
      }
      o.yaw += (want - o.yaw) * Math.min(1, dt * 3.5);
      o.head.rotation.y = o.yaw;
      o.head.rotation.z = 0.12 * Math.sin(t * 0.8 + o.baseYaw);
      o.nextBlink -= dt;
      if (o.nextBlink <= 0) {
        o.blink = 0.16;
        o.nextBlink = rng.float(2.5, 6);
      }
      o.blink = Math.max(0, o.blink - dt);
      const open = o.blink > 0 ? 0.12 : 1;
      for (const e of o.eyes) e.scale.y = open;
    }
  });
}

// ---------------------------------------------------------------------------
// Crows

function crowParts() {
  const body = new THREE.SphereGeometry(0.022, 10, 8);
  body.scale(0.9, 0.85, 2.1);
  const head = new THREE.SphereGeometry(0.016, 10, 8);
  head.translate(0, 0.012, 0.05);
  const beak = new THREE.ConeGeometry(0.006, 0.026, 5);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.009, 0.075);
  const tail = new THREE.BoxGeometry(0.03, 0.004, 0.04);
  tail.translate(0, 0.0, -0.058);
  const bodyGeo = mergeAll([body, head, beak, tail]);
  paint(bodyGeo, 0xffffff);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.012);
  wingShape.lineTo(0.03, -0.02);
  wingShape.lineTo(0.075, -0.03);
  wingShape.lineTo(0.085, -0.012);
  wingShape.lineTo(0.06, 0.004);
  wingShape.lineTo(0, 0.016);
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  wingGeo.rotateX(Math.PI / 2); // lie flat, span along +x, leading edge forward
  return { bodyGeo, wingGeo };
}

function makeCrow(parts, mat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(parts.bodyGeo, mat);
  g.add(body);
  const wings = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.012, 0.008, 0.008);
    const w = new THREE.Mesh(parts.wingGeo, mat);
    w.scale.x = side;
    pivot.add(w);
    g.add(pivot);
    return pivot;
  });
  return { g, wings };
}

function buildCrows(world) {
  const { scene, layout } = world;
  const rng = new Rng(13);
  const parts = crowParts();
  // matte feathers: the flat wings used to catch the moon on every flap and flash
  const mat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  const center = world.scarecrow?.head ?? new THREE.Vector3(-1, 1.5, 1);
  const ground = layout.heightAt(center.x, center.z);

  const flyers = [];
  for (let i = 0; i < 8; i++) {
    const c = makeCrow(parts, mat);
    c.g.scale.setScalar(1.3);
    scene.add(c.g);
    flyers.push({
      ...c,
      r: rng.float(0.7, 2.1),
      h: ground + rng.float(1.6, 2.8),
      speed: rng.float(0.35, 0.6) * (rng.chance(0.25) ? -1 : 1),
      a: rng.float(0, Math.PI * 2),
      cx: center.x + rng.float(-0.5, 0.5),
      cz: center.z + rng.float(-0.4, 0.4),
      flapT: rng.float(0, 3),
      bob: rng.float(0, 6),
    });
  }

  const perchSpots = [];
  if (world.scarecrow) {
    perchSpots.push({ p: world.scarecrow.arms[0], yaw: 1.2 }, { p: world.scarecrow.arms[1], yaw: -2.0 });
    perchSpots.push({ p: world.scarecrow.head.clone(), yaw: 0.4 });
  }
  const perched = perchSpots.map(({ p, yaw }) => {
    const c = makeCrow(parts, mat);
    c.g.scale.setScalar(1.3);
    // lift by the crow's belly depth so it stands on the perch, not above it
    c.g.position.copy(p).add(new THREE.Vector3(0, 0.022, 0));
    c.g.rotation.y = yaw;
    c.g.rotation.x = -0.25;
    // wings folded back along the body
    c.wings.forEach((w, k) => w.rotation.set(0, k ? -1.3 : 1.3, 0));
    scene.add(c.g);
    return { ...c, base: c.g.position.clone(), yaw, next: rng.float(1, 4), hop: 0, look: 0 };
  });

  world.addUpdater((dt, t) => {
    if (dt <= 0) return;
    for (const f of flyers) {
      f.a += (f.speed / f.r) * dt * 1.2;
      const x = f.cx + Math.cos(f.a) * f.r;
      const z = f.cz + Math.sin(f.a) * f.r;
      const y = f.h + 0.12 * Math.sin(t * 0.9 + f.bob);
      f.g.position.set(x, y, z);
      // heading along the circle
      const dir = Math.sign(f.speed);
      f.g.rotation.set(0, Math.atan2(-Math.sin(f.a) * dir, Math.cos(f.a) * dir), dir * 0.35, 'YXZ');
      // flap in bursts, then glide
      f.flapT += dt;
      const cycle = f.flapT % 3.4;
      const flapping = cycle < 1.3;
      const wingAngle = flapping ? 0.7 * Math.sin(t * 17 + f.bob) : 0.12 + 0.03 * Math.sin(t * 3);
      f.wings[0].rotation.z = wingAngle;
      f.wings[1].rotation.z = -wingAngle;
    }
    for (const p of perched) {
      p.next -= dt;
      if (p.next <= 0) {
        p.next = rng.float(1.5, 5);
        if (rng.chance(0.35)) p.hop = 1;
        p.look = rng.float(-0.8, 0.8);
      }
      p.hop = Math.max(0, p.hop - dt * 3);
      p.g.position.y = p.base.y + 0.03 * Math.sin(p.hop * Math.PI);
      p.g.rotation.y += (p.yaw + p.look - p.g.rotation.y) * Math.min(1, dt * 6);
      // folded at rest; half-open and fluttering during a hop
      const open = p.hop > 0 ? 0.8 : 0;
      const flutter = p.hop > 0 ? 0.6 * Math.sin(t * 30) : 0;
      p.wings[0].rotation.set(0, 1.3 - open, flutter);
      p.wings[1].rotation.set(0, -1.3 + open, -flutter);
    }
  });
}

// ---------------------------------------------------------------------------
// A little frog on a mossy stone beside the cornfield's east wall, set back
// from the road where the wall runs down toward the woods, watching the chase.

const FROG_SPOT = { ...CLEARINGS.frog, yaw: 0.15 };

function makeFrog() {
  const frog = new THREE.Group();
  const skin = std('#5d7d2c', 0.55);
  const belly = std('#c4c27a', 0.7);
  const dark = std('#2f4518', 0.6);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.028, 16, 12), skin);
  body.scale.set(1.12, 0.72, 1.3);
  body.position.set(0, 0.02, 0);
  body.rotation.x = -0.28; // sits up, nose raised
  body.castShadow = true;
  frog.add(body);
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 8), belly);
  chin.scale.set(1.15, 0.55, 1.0);
  chin.position.set(0, 0.012, 0.018);
  frog.add(chin);
  // throat sac that puffs out now and then
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), belly);
  throat.position.set(0, 0.011, 0.03);
  frog.add(throat);
  // a little smile
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.019, 0.0016, 4, 16, Math.PI * 0.75), dark);
  smile.rotation.set(-0.35, 0, Math.PI * 1.125);
  smile.position.set(0, 0.024, 0.024);
  frog.add(smile);

  // big eyes up top, gold with a catch of light so they gleam at night
  const irisMat = new THREE.MeshStandardMaterial({ color: 0xd8a830, emissive: 0x8a5a10, emissiveIntensity: 0.6, roughness: 0.25 });
  const pupilMat = std('#050505', 0.2);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 12, 8), skin);
    socket.position.set(sx * 0.016, 0.036, 0.012);
    frog.add(socket);
    const eye = new THREE.Group();
    eye.position.copy(socket.position).add(new THREE.Vector3(sx * 0.002, 0.003, 0.003));
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0098, 12, 8), irisMat);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), pupilMat);
    pupil.scale.set(1.5, 0.8, 0.6);
    pupil.position.z = 0.0072;
    iris.add(pupil);
    eye.add(iris);
    frog.add(eye);
    eyes.push({ eye, iris });
  }

  // folded back legs and little front legs
  for (const sx of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), skin);
    thigh.scale.set(0.75, 0.7, 1.55);
    thigh.position.set(sx * 0.026, 0.011, -0.012);
    thigh.rotation.y = sx * 0.35;
    frog.add(thigh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), dark);
    foot.scale.set(1.3, 0.35, 1.8);
    foot.position.set(sx * 0.03, 0.002, 0.004);
    foot.rotation.y = sx * -0.5;
    frog.add(foot);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.004, 0.02, 6), skin);
    arm.position.set(sx * 0.014, 0.008, 0.024);
    arm.rotation.set(0.35, 0, sx * 0.25);
    frog.add(arm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), dark);
    hand.scale.set(1.4, 0.4, 1.4);
    hand.position.set(sx * 0.016, 0.0, 0.028);
    frog.add(hand);
  }
  return { frog, throat, eyes };
}

function buildFrog(world) {
  const { scene, layout } = world;
  const rng = new Rng(7);
  const ground = layout.heightAt(FROG_SPOT.x, FROG_SPOT.z);

  // mossy flat stone for him to sit on
  const stoneGeo = new THREE.DodecahedronGeometry(0.05, 0);
  stoneGeo.scale(1.4, 0.45, 1.15);
  const stone = new THREE.Mesh(stoneGeo, new THREE.MeshStandardMaterial({ color: 0x77766a, roughness: 0.95, flatShading: true }));
  stone.position.set(FROG_SPOT.x, ground + 0.008, FROG_SPOT.z);
  stone.rotation.y = 0.6;
  stone.castShadow = true;
  stone.receiveShadow = true;
  scene.add(stone);
  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), std('#4b5d2a', 1));
  moss.scale.set(1.3, 0.25, 1.0);
  moss.position.set(FROG_SPOT.x - 0.03, ground + 0.028, FROG_SPOT.z - 0.02);
  scene.add(moss);

  const { frog, throat, eyes } = makeFrog();
  const seatY = ground + 0.026;
  frog.position.set(FROG_SPOT.x + 0.01, seatY, FROG_SPOT.z + 0.005);
  frog.rotation.y = FROG_SPOT.yaw;
  frog.scale.setScalar(1.15);
  scene.add(frog);

  let yaw = FROG_SPOT.yaw;
  let nextCroak = rng.float(2, 5);
  let croak = 0;
  let nextBlink = rng.float(1.5, 4);
  let blink = 0;
  let hop = 0;
  let startled = false;
  const tmp = new THREE.Vector3();
  const local = new THREE.Vector3();

  world.addUpdater((dt, t) => {
    if (dt <= 0) return;
    const riders = [world.actors.ichabod?.(), world.actors.horseman?.()].filter(Boolean);
    let target = null;
    let best = 7;
    for (const r of riders) {
      const d = Math.hypot(r.x - frog.position.x, r.z - frog.position.z);
      if (d < best) {
        best = d;
        target = r;
      }
    }
    // turn (in little shuffles) to face whoever is nearest
    let want = FROG_SPOT.yaw + 0.3 * Math.sin(t * 0.2);
    if (target) {
      tmp.subVectors(target, frog.position);
      want = Math.atan2(tmp.x, tmp.z);
    }
    const diff = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
    yaw += diff * Math.min(1, dt * 2.5);
    frog.rotation.y = yaw;

    // eyes follow the rider a little further than the body turns
    if (target) {
      local.copy(target);
      frog.worldToLocal(local);
      const look = Math.atan2(local.x, local.z);
      for (const e of eyes) e.iris.rotation.y = Math.max(-0.6, Math.min(0.6, look));
    }

    // a startled hop when the Horseman thunders past
    const hm = world.actors.horseman?.();
    if (hm) {
      const dh = Math.hypot(hm.x - frog.position.x, hm.z - frog.position.z);
      if (dh < 0.9 && !startled) {
        startled = true;
        hop = 1;
      } else if (dh > 2.5) {
        startled = false;
      }
    }
    if (hop > 0) hop = Math.max(0, hop - dt * 2.8);
    frog.position.y = seatY + 0.07 * Math.sin(hop * Math.PI);

    // throat puffs out as he croaks
    nextCroak -= dt;
    if (nextCroak <= 0) {
      croak = 1;
      nextCroak = rng.float(2.5, 6);
    }
    croak = Math.max(0, croak - dt * 1.6);
    const puff = 1 + 0.9 * Math.sin(croak * Math.PI);
    throat.scale.set(puff, puff * 0.85, puff);

    nextBlink -= dt;
    if (nextBlink <= 0) {
      blink = 0.15;
      nextBlink = rng.float(2, 6);
    }
    blink = Math.max(0, blink - dt);
    for (const e of eyes) e.eye.scale.y = blink > 0 ? 0.2 : 1;
  });
}

export function buildWildlife(world) {
  buildOwls(world);
  buildCrows(world);
  buildFrog(world);
}
