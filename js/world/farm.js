// The Van Tassel acres: a freshly harvested cornfield with stubble and corn
// shocks, a last strip of standing stalks, pumpkins, haystacks, a scarecrow,
// New England dry-stone walls and a zig-zag split-rail fence.

import * as THREE from 'three';
import { jitter, mergeAll, taperedTube } from '../util/geom.js';
import { makeCanvas, toTexture } from '../util/textures.js';
import { Rng } from '../util/rng.js';
import { FIELD, CLEARINGS, BUILDINGS } from './layout.js';
import { ROAD_HALF } from '../config.js';
import { pumpkinGeometry, makeJack } from './props.js';
import { plain } from './kit.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const col = new THREE.Color();

function instanced(geo, mat, items, place, { cast = true, receive = true } = {}) {
  const inst = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    place(it, i);
    inst.setMatrixAt(i, m4);
    if (it.color) inst.setColorAt(i, it.color);
  });
  inst.castShadow = cast;
  inst.receiveShadow = receive;
  return inst;
}

// ---------------------------------------------------------------------------

function stalkGeometry(rng, height = 0.42) {
  const parts = [];
  const stalk = new THREE.CylinderGeometry(0.006, 0.009, height, 4);
  stalk.translate(0, height / 2, 0);
  parts.push(stalk.toNonIndexed());
  const leaves = 5;
  for (let k = 0; k < leaves; k++) {
    const y0 = height * (0.2 + (k / leaves) * 0.7);
    const len = rng.float(0.13, 0.2);
    const a = k * 2.4 + rng.float(-0.3, 0.3);
    const pos = [];
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const p = (t) => [t * len, y0 + 0.07 * t - 0.16 * t * t, 0];
      const w = (t) => 0.016 * (1 - t) + 0.002;
      const [x0, yy0] = p(t0);
      const [x1, yy1] = p(t1);
      pos.push(x0, yy0, -w(t0), x1, yy1, -w(t1), x1, yy1, w(t1));
      pos.push(x0, yy0, -w(t0), x1, yy1, w(t1), x0, yy0, w(t0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    g.rotateY(a);
    parts.push(g);
  }
  // tassel
  const tassel = new THREE.ConeGeometry(0.012, 0.06, 4);
  tassel.translate(0, height + 0.03, 0);
  parts.push(tassel.toNonIndexed());
  return mergeAll(parts);
}

// ---------------------------------------------------------------------------
// Corn shocks: bundles of dried stalks stood on end and tied at the waist.
// Each is a smooth core painted with packed stalks, dressed in alpha-cut cards
// of hanging leaves (like the trees' leaf cards), with a fanned crown of stalk
// tops, loose drooping leaves, splayed butts at the foot and two turns of
// twine. It all shares one small painted atlas and one material.

const SHOCK = { top: 0.52, tie: 0.33, baseR: 0.172, tieR: 0.048 };

// Straw atlas, 512 px square. The bottom half is a strip of packed stalks that
// wraps once around the core (seamless left to right); the top half holds four
// 128 px cells: 0 and 1 hanging leaves, 2 stalk tops for the crown, 3 a single
// long leaf (left) beside a plain patch for the twine (right).
const ATLAS = 512;
const CELL = 128;
const cellUV = (cell, u, v) => [(cell * CELL + 3 + u * (CELL - 6)) / ATLAS, 0.5 + (3 + v * 250) / ATLAS];
const leafUV = (u, v) => [(3 * CELL + 4 + u * 56) / ATLAS, 0.5 + (3 + v * 250) / ATLAS];
const PLAIN_UV = [480 / ATLAS, 1 - 130 / ATLAS];
// y runs 0 at the foot to 1 at the core's crest; stays clear of the cells above.
// The tie sits about three quarters of the way up (canvas row ~328).
const stripUV = (u, y) => [u, 0.006 + y * 0.46];

// Straw, pale, tan and grey-brown stalk tones (sRGB), weighted toward straw.
// The atlas is multiplied by the shock's (paled) straw instance color, so
// these stay light and close together.
const sRGBBytes = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const STRAW_TONES = ['#f6e8c6', '#f6e8c6', '#f4eee2', '#e8d3aa', '#e8d3aa', '#e0dbd0', '#cfcac0', '#bfb3a0'].map(sRGBBytes);
// per-card vertex tints: plain, warm straw, weathered grey, tan, dull grey
const STRAW_TINTS = [[1, 1, 1], [1.03, 1.01, 0.93], [0.94, 0.95, 0.97], [0.97, 0.95, 0.9], [0.88, 0.88, 0.9]];
const TWINE = [0.4, 0.31, 0.23];

const css = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;
const strawTone = (rng) => {
  const k = rng.float(0.86, 1.0);
  return rng.pick(STRAW_TONES).map((v) => v * k);
};
const easeStep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Quadratic Bezier from p0 through control p1 to p2, as n + 1 points. */
function bezier(p0, p1, p2, n = 12) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
  }
  return out;
}

/** Unit normals along a polyline. */
function sideways(pts) {
  return pts.map((_, i) => {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(x1 - x0, y1 - y0) || 1;
    return [-(y1 - y0) / l, (x1 - x0) / l];
  });
}

function polyline(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

/**
 * A dried corn leaf along `pts`: narrow where it leaves the stalk, widest a
 * third of the way, tapering to a ragged tip, with a curled pale edge, a dark
 * midrib and a split or two running up from the tip. `cut` tears the splits
 * out of the alpha (cards); otherwise they are painted dark (the opaque core).
 */
function paintLeaf(ctx, rng, pts, half, c, cut = true) {
  const n = pts.length - 1;
  const nrm = sideways(pts);
  // dried leaves curl and twist, pinching narrow here and there
  const twist = rng.float(0.3, 1.2);
  const phase = rng.float(0, Math.PI * 2);
  const hw = pts.map((_, i) => {
    const t = i / n;
    const pinch = 0.6 + 0.4 * Math.abs(Math.cos(t * Math.PI * twist + phase));
    return half * Math.min(1, 0.3 + t * 2.4) * (1 - t ** 2.5) * pinch + 0.4;
  });
  const offset = (k, from = 0) => pts.slice(from).map(([x, y], i) => [x + nrm[from + i][0] * hw[from + i] * k, y + nrm[from + i][1] * hw[from + i] * k]);
  const left = offset(1);
  const right = offset(-1);
  ctx.beginPath();
  left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = css(c);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = css(c, 0.55, 0.45);
  ctx.stroke();
  // the curled edge catches the light; the other half sits in shadow
  const side = rng.sign();
  polyline(ctx, offset(side * 0.5));
  ctx.strokeStyle = css(c, 1.12, 0.85);
  ctx.lineWidth = Math.max(1, half * 0.55);
  ctx.stroke();
  polyline(ctx, offset(-side * 0.6));
  ctx.strokeStyle = css(c, 0.72, 0.6);
  ctx.lineWidth = Math.max(1, half * 0.35);
  ctx.stroke();
  polyline(ctx, pts);
  ctx.strokeStyle = css(c, 0.62, 0.8);
  ctx.lineWidth = 0.9;
  ctx.stroke();
  const tears = rng.int(0, 2);
  for (let k = 0; k < tears; k++) {
    const from = Math.floor(n * rng.float(0.4, 0.7));
    ctx.save();
    if (cut) ctx.globalCompositeOperation = 'destination-out';
    polyline(ctx, offset(rng.float(-0.45, 0.45), from));
    ctx.strokeStyle = cut ? '#000' : css(c, 0.4);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
  }
}

/** A stalk from (x0, y0) to (x1, y1): shaded round, with a node every few inches. */
function paintStalk(ctx, rng, x0, y0, x1, y1, w, c) {
  const line = (dx, lw, style) => {
    ctx.beginPath();
    ctx.moveTo(x0 + dx, y0);
    ctx.lineTo(x1 + dx, y1);
    ctx.lineWidth = lw;
    ctx.strokeStyle = style;
    ctx.stroke();
  };
  line(0, w, css(c, 0.74));
  line(-w * 0.14, w * 0.6, css(c));
  line(-w * 0.26, Math.max(0.8, w * 0.18), css(c, 1.1));
  const len = Math.hypot(x1 - x0, y1 - y0);
  for (let s = rng.float(4, 30); s < len; s += rng.float(22, 40)) {
    const t = s / len;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    ctx.fillStyle = css(c, 0.7, 0.8);
    ctx.fillRect(x - w / 2, y, w, 1.2);
  }
}

function paintStalkStrip(ctx, rng) {
  const y0 = 256;
  const h = 256;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, ATLAS, h);
  ctx.clip();
  ctx.fillStyle = '#6a5d4d';
  ctx.fillRect(0, y0, ATLAS, h);
  // Draw near the left/right edges twice so the strip wraps without a seam;
  // each shape gets its own seed so both copies come out identical.
  const wrap = (x, margin, draw) => {
    const seed = rng.int(1, 1e9);
    for (const dx of [0, ...(x < margin ? [ATLAS] : []), ...(x > ATLAS - margin ? [-ATLAS] : [])]) draw(dx, new Rng(seed));
  };
  // packed stalks standing on their butts (the bottom edge is the foot)
  for (let x = 0; x < ATLAS; x += rng.float(6, 10)) {
    const w = rng.float(7, 11);
    const c = strawTone(rng);
    const lean = rng.float(-4, 4);
    const top = y0 + (rng.chance(0.2) ? rng.float(0, 70) : -2);
    wrap(x, 14, (dx, r) => paintStalk(ctx, r, x + dx + lean, top, x + dx, y0 + h + 2, w, c));
  }
  // broad leaves hanging down over most of them; the butts stay bare
  for (let k = 0; k < 110; k++) {
    const x = rng.float(0, ATLAS);
    const y = rng.float(y0 + 66, y0 + h - 100);
    const len = rng.float(60, 160);
    const sway = rng.float(-50, 50);
    const pts = bezier([x, y], [x + rng.float(-25, 25), y + len * 0.45], [x + sway, Math.min(y0 + h - 22, y + len)], 12);
    const half = rng.float(6, 10);
    const c = strawTone(rng).map((v) => v * 1.06);
    wrap(x, 70, (dx, r) => {
      ctx.save();
      ctx.translate(dx, 0);
      paintLeaf(ctx, r, pts, half, c, false);
      ctx.restore();
    });
  }
  ctx.restore();
}

/** Cells 0 and 1: a few stalks with long leaves hanging from them, ragged at the bottom. */
function paintHangingCell(ctx, rng, cell) {
  ctx.save();
  ctx.translate(cell * CELL, 0);
  ctx.beginPath();
  ctx.rect(3, 3, CELL - 6, 250);
  ctx.clip();
  for (let k = 0; k < 3; k++) {
    const x = rng.float(18, 110);
    paintStalk(ctx, rng, x + rng.float(-6, 6), rng.float(0, 50), x, 256 - rng.float(0, 50), rng.float(7, 10), strawTone(rng));
  }
  for (let k = 0; k < 9; k++) {
    const sx = rng.float(12, 116);
    const sy = rng.float(-10, 70);
    const ex = Math.min(120, Math.max(8, sx + rng.float(-35, 35)));
    const ey = rng.float(160, 252);
    const pts = bezier([sx, sy], [(sx + ex) / 2 + rng.float(-25, 25), (sy + ey) / 2], [ex, ey], 14);
    paintLeaf(ctx, rng, pts, rng.float(11, 16), strawTone(rng));
  }
  ctx.restore();
}

/** Cell 2: stalk tops fanning up from the tie, with tassels and drooping leaves. */
function paintCrownCell(ctx, rng) {
  ctx.save();
  ctx.translate(2 * CELL, 0);
  ctx.beginPath();
  ctx.rect(3, 3, CELL - 6, 250);
  ctx.clip();
  const stalks = [];
  for (let k = 0; k < 11; k++) {
    const bx = 64 + rng.float(-14, 14);
    const tx = rng.float(14, 114);
    const ty = rng.float(20, 95);
    stalks.push([bx, tx, ty]);
    paintStalk(ctx, rng, tx, ty, bx, 258, rng.float(3.5, 5.5), strawTone(rng));
    if (rng.chance(0.55)) {
      // tassel: a few thin drooping spikes
      const c = strawTone(rng);
      ctx.strokeStyle = css(c, 1.05);
      ctx.lineWidth = 1.3;
      for (let b = 0; b < 5; b++) {
        const a = -Math.PI / 2 + rng.float(-0.8, 0.8) + (tx - 64) * 0.005;
        const l = rng.float(9, 22);
        const ex = tx + Math.cos(a) * l;
        const ey = ty + Math.sin(a) * l;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo(tx + Math.cos(a) * l * 0.7, ty + Math.sin(a) * l * 0.7 - 2, ex, ey + l * 0.25);
        ctx.stroke();
      }
    }
  }
  // leaves peel off the stalks, arch outward and droop
  for (let k = 0; k < 8; k++) {
    const [bx, tx, ty] = rng.pick(stalks);
    const t = rng.float(0.2, 0.75);
    const sx = tx + (bx - tx) * t;
    const sy = ty + (258 - ty) * t;
    const dir = Math.abs(tx - 64) > 12 ? Math.sign(tx - 64) : rng.sign();
    const ex = Math.min(122, Math.max(6, sx + dir * rng.float(15, 50)));
    const ey = Math.min(250, Math.max(10, sy + rng.float(-50, 70)));
    const pts = bezier([sx, sy], [sx + dir * rng.float(5, 22) + rng.float(-8, 8), Math.min(sy, ey) - rng.float(5, 30)], [ex, ey], 14);
    paintLeaf(ctx, rng, pts, rng.float(7, 11), strawTone(rng));
  }
  ctx.restore();
}

/** Cell 3: one long leaf, base at the bottom and tip at the top, and a plain patch. */
function paintLongLeafCell(ctx, rng) {
  ctx.save();
  ctx.translate(3 * CELL, 0);
  ctx.beginPath();
  ctx.rect(3, 3, 58, 250);
  ctx.clip();
  paintLeaf(ctx, rng, bezier([32, 256], [32 + rng.float(-10, 10), 130], [32 + rng.float(-5, 5), 4], 18), 17, sRGBBytes('#e8dcc0'));
  ctx.restore();
  ctx.fillStyle = '#e6dccb';
  ctx.fillRect(456, 100, 48, 60);
}

/**
 * Straw material over a painted atlas whose bottom half (v < 0.5) is an opaque
 * strip for a core and whose top half holds alpha-cut cards. Shared by the
 * corn shocks and the hay; meshes are instanced and carry their old flat
 * color as the instance color.
 */
function strawShaderMaterial(tex) {
  tex.wrapS = THREE.RepeatWrapping; // the strip wraps around the core
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.95,
  });
  mat.onBeforeCompile = (shader) => {
    // The field's instance colors are the old gold ('#bc9d5c' scaled by
    // 0.8-1.05). Map them to pale straw, bright enough to lift the painted
    // stalks (dark gaps and all) back to about the old brightness, and let
    // the dimmer shocks weather toward grey-brown.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      THREE.ShaderChunk.color_vertex.replace(
        'vColor.rgb *= instanceColor.rgb;',
        /* glsl */ `float strawLuma = dot( instanceColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
	float strawFresh = clamp( ( strawLuma / 0.357 - 0.8 ) / 0.25, 0.0, 1.0 );
	vec3 strawPale = instanceColor.rgb * vec3( 1.74, 2.18, 4.1 );
	vec3 strawGrey = vec3( strawLuma ) * vec3( 1.96, 1.79, 1.55 );
	vColor.rgb *= mix( strawGrey, strawPale, 0.3 + 0.7 * strawFresh );`,
      ),
    );
    shader.fragmentShader = shader.fragmentShader
      // the core never cuts out, even where small mips blur into the cells
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tif ( vMapUv.y < 0.5 ) diffuseColor.a = 1.0;')
      // keep the outward normals on both faces of a card (as the tree foliage does)
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  mat.customProgramCacheKey = () => 'straw-cards';
  return mat;
}

let strawMaterial = null;
function shockMaterial() {
  if (strawMaterial) return strawMaterial;
  const c = makeCanvas(ATLAS, ATLAS);
  const ctx = c.getContext('2d');
  const rng = new Rng(1843);
  paintStalkStrip(ctx, rng);
  paintHangingCell(ctx, rng, 0);
  paintHangingCell(ctx, rng, 1);
  paintCrownCell(ctx, rng);
  paintLongLeafCell(ctx, rng);
  strawMaterial = strawShaderMaterial(toTexture(c, { repeat: false }));
  return strawMaterial;
}

/** Profile of one shock: radius at height y and angle a, lumpy and uneven at the foot. */
function shockShape(rng) {
  const tieY = SHOCK.tie + rng.float(-0.012, 0.012);
  const top = SHOCK.top + rng.float(-0.015, 0.02);
  const tieR = SHOCK.tieR * rng.float(0.94, 1.06);
  // the core's rounded top hides inside the crown of stalk tops
  const crest = tieY + (top - tieY) * 0.55;
  const waves = [[2, 0.065], [3, 0.05], [5, 0.04], [7, 0.026], [11, 0.018]].map(([k, amp]) => ({ k, amp, ph: rng.float(0, 6.3), dy: rng.float(-9, 9) }));
  const foot = [3, 4, 7].map((k) => ({ k, amp: rng.float(0.03, 0.07), ph: rng.float(0, 6.3) }));
  const radius = (y, a) => {
    let r;
    if (y <= tieY) {
      r = tieR + (SHOCK.baseR - tieR) * (1 - Math.max(0, y) / tieY) ** 0.95;
    } else {
      const s = Math.min(1, (y - tieY) / (crest - tieY));
      r = (tieR + 0.02 * Math.sin((Math.min(1, s / 0.35) * Math.PI) / 2)) * (1 - s ** 2.4);
    }
    // pulled round and tight under the twine
    const tight = 1 - 0.85 * Math.exp(-(((y - tieY) / 0.035) ** 2));
    let f = 0;
    for (const w of waves) f += w.amp * Math.sin(w.k * a + w.ph + y * w.dy);
    let g = 0;
    for (const w of foot) g += w.amp * Math.sin(w.k * a + w.ph);
    return r * (1 + f * tight + Math.max(-0.04, g) * Math.max(0, 1 - y / 0.07));
  };
  return { tieY, top, crest, radius };
}

/** Indexed triangles with normals, uvs and colors, gathered piece by piece. */
class StrawMesh {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  vert(p, n, uv, c) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c[0], c[1], c[2]);
    return this.pos.length / 3 - 1;
  }

  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** Append a whole geometry; `mapUV(u, v)` places its uvs, `shade(y, v)` colors it. */
  add(g, mapUV, shade) {
    const base = this.pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(...mapUV(t.getX(i), t.getY(i)));
      this.col.push(...shade(p.getY(i), t.getY(i)));
    }
    if (g.index) for (const k of g.index.array) this.idx.push(base + k);
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * Smooth lathe around the y axis through the heights `ys`, `seg` segments
 * round, with `radius(y, a)`; `uvOf(s, y)` maps the turn fraction s (0..1)
 * and height to atlas uvs. Normals are smoothed, seam included.
 */
function strawCore(ys, seg, radius, uvOf) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (const y of ys) {
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const r = radius(y, a);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push(...uvOf(j / seg, y));
    }
  }
  for (let i = 0; i < ys.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  smoothSeam(g, ys.length, seg);
  return g;
}

/** Share normals across the seam of a `rings` x (`seg` + 1) grid so it doesn't show. */
function smoothSeam(g, rings, seg) {
  const n = g.attributes.normal;
  for (let i = 0; i < rings; i++) {
    const a = i * (seg + 1);
    const b = a + seg;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}

/** One corn shock (base at y = 0, about 0.52 tall); `rng` picks its shape. */
function shockGeometry(rng) {
  const { tieY, top, crest, radius } = shockShape(rng);
  const out = new StrawMesh();
  const UP = new THREE.Vector3(0, 1, 0);
  const radial = (a) => new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const tangent = (a) => new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const onSurface = (y, a, off = 0) => radial(a).multiplyScalar(radius(y, a) + off).setY(y);
  // darker at the foot and in the pinch under the crown
  const ao = (y) => (0.68 + 0.32 * easeStep(0, 0.13, y)) * (1 - 0.18 * Math.exp(-(((y - tieY) / 0.03) ** 2)));
  const tone = () => {
    const b = rng.float(0.78, 1.1);
    return rng.pick(STRAW_TINTS).map((v) => v * b);
  };
  const scaled = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

  // core: a smooth, lumpy lathe painted with the stalk strip
  const ys = [
    ...[0, 0.05, 0.14, 0.27, 0.42, 0.58, 0.74, 0.88, 1].map((f) => f * tieY),
    ...[0.15, 0.4, 0.7, 1].map((f) => tieY + f * (crest - tieY)),
  ];
  out.add(strawCore(ys, 16, radius, (s, y) => stripUV(s, y / crest)), (u, v) => [u, v], (y) => [ao(y), ao(y), ao(y)]);

  // hanging-leaf cards over the lower bundle: long ones from the tie to the
  // ground, shorter ones layered between; their feet flare out
  const SKIRT = 24;
  for (let k = 0; k < SKIRT; k++) {
    const theta = (k / SKIRT) * Math.PI * 2 + rng.float(-0.12, 0.12);
    const long = k % 2 === 0;
    const y0 = long ? tieY - rng.float(0, 0.03) : rng.float(0.1, tieY - 0.06);
    const y1 = long || rng.chance(0.5) ? rng.float(-0.015, 0.015) : Math.max(-0.01, y0 - rng.float(0.12, 0.22));
    const half = Math.min(0.36, rng.float(0.035, 0.06) / radius(Math.max(0, y1), theta));
    const flare = rng.float(0.006, 0.03);
    const cell = rng.int(0, 1);
    const flip = rng.chance(0.5);
    const c = tone();
    const rows = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const y = y0 + (y1 - y0) * t;
      const row = [];
      for (let j = 0; j <= 2; j++) {
        const a = theta + (j - 1) * half;
        const p = onSurface(y, a, 0.005 + flare * t * t);
        const nrm = radial(a).setY(0.42).normalize();
        const u = flip ? 1 - j / 2 : j / 2;
        row.push(out.vert(p, nrm, cellUV(cell, u, 1 - t), scaled(c, ao(y))));
      }
      rows.push(row);
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) out.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
  }

  // crown: stalk tops fanning up out of the tie, bending outward at the tips
  const CROWN = 18;
  for (let k = 0; k < CROWN; k++) {
    const theta = (k / CROWN) * Math.PI * 2 + rng.float(-0.2, 0.2);
    const o = radial(theta);
    const yb = tieY - rng.float(0.015, 0.04);
    const base = onSurface(yb, theta, -0.012);
    const tip = radial(theta).multiplyScalar(rng.float(0.05, 0.13)).setY(top + rng.float(-0.05, 0.07));
    const psi = rng.chance(0.35) ? Math.PI / 2 + rng.float(-0.4, 0.4) : rng.float(-0.5, 0.5);
    const across = tangent(theta).multiplyScalar(Math.cos(psi)).addScaledVector(o, Math.sin(psi));
    const wb = rng.float(0.035, 0.05);
    const wt = rng.float(0.09, 0.13);
    const droop = rng.float(0, 0.03);
    const flip = rng.chance(0.5);
    const c = tone();
    const nrm = o.clone().addScaledVector(UP, 0.55).normalize();
    const rows = [];
    for (const t of [0, 0.5, 1]) {
      const mid = base.clone().lerp(tip, t).addScaledVector(o, droop * t * t).addScaledVector(UP, -droop * 0.6 * t * t);
      const w = (wb + (wt - wb) * t) / 2;
      const s = 0.78 + 0.22 * t;
      rows.push([0, 1].map((j) => out.vert(mid.clone().addScaledVector(across, (j * 2 - 1) * w), nrm, cellUV(2, flip ? 1 - j : j, t), scaled(c, s))));
    }
    for (let i = 0; i < 2; i++) out.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
  }

  // loose leaves arching out and drooping, from the crown and the bundle
  const leaf = (start, theta, len, rise, droop) => {
    const o = radial(theta);
    const s = tangent(theta);
    const w = rng.float(0.026, 0.034) / 2;
    const sway = rng.float(-0.15, 0.15);
    const twist = rng.float(-1.2, 1.2);
    const c = tone();
    const rows = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const p = start.clone().addScaledVector(o, len * 0.85 * t).addScaledVector(UP, len * (rise * t - droop * t * t)).addScaledVector(s, len * sway * Math.sin(t * Math.PI));
      p.y = Math.max(p.y, 0.003);
      const across = s.clone().multiplyScalar(Math.cos(twist * t)).addScaledVector(UP, Math.sin(twist * t));
      const nrm = o.clone().multiplyScalar(0.6).addScaledVector(UP, 0.8).normalize();
      const col = scaled(c, ao(p.y) * (0.85 + 0.2 * t));
      rows.push([0, 1].map((j) => out.vert(p.clone().addScaledVector(across, (j * 2 - 1) * w), nrm, leafUV(j, t), col)));
    }
    for (let i = 0; i < 5; i++) out.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
  };
  for (let k = 0; k < 10; k++) {
    const theta = rng.float(0, Math.PI * 2);
    const y = rng.float(tieY + 0.02, crest - 0.01);
    leaf(onSurface(y, theta, -0.004), theta, rng.float(0.1, 0.2), rng.float(0.25, 0.6), rng.float(0.9, 1.5));
  }
  for (let k = 0; k < 5; k++) {
    const theta = rng.float(0, Math.PI * 2);
    const y = rng.float(0.1, tieY - 0.05);
    leaf(onSurface(y, theta, 0.004), theta, rng.float(0.08, 0.14), rng.float(0, 0.3), rng.float(0.8, 1.3));
  }

  // splayed butts at the foot
  for (let k = 0; k < 14; k++) {
    const theta = rng.float(0, Math.PI * 2);
    const p0 = onSurface(rng.float(0.035, 0.09), theta, -0.006);
    const p1 = onSurface(0, theta + rng.float(-0.1, 0.1), rng.float(0.008, 0.035)).setY(-0.012);
    const u0 = rng.next();
    const b = rng.float(0.75, 1.0);
    out.add(taperedTube([p0, p1], [0.0062, 0.0056], 4), (u, v) => stripUV(u0 + u * 0.012, 0.02 + (1 - v) * 0.12), (y, v) => {
      const s = b * (1 - 0.35 * v);
      return [s, s, s];
    });
  }

  // two turns of twine around the waist, over the leaves
  for (let w = 0; w < 2; w++) {
    const tilt = rng.float(0.003, 0.008);
    const ph = rng.float(0, Math.PI * 2);
    const yw = tieY + (w - 0.5) * 0.009;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2 * 1.04 + ph;
      pts.push(onSurface(yw + tilt * Math.sin(a - ph * 1.7), a, 0.009));
    }
    out.add(taperedTube(pts, pts.map(() => 0.0042), 3), () => PLAIN_UV, () => TWINE);
  }

  // the whole bundle leans a little
  const lean = rng.float(0.006, 0.02);
  const la = rng.float(0, Math.PI * 2);
  for (let i = 0; i < out.pos.length; i += 3) {
    const f = (Math.max(0, out.pos[i + 1]) / top) ** 2 * lean;
    out.pos[i] += Math.cos(la) * f;
    out.pos[i + 2] += Math.sin(la) * f;
  }
  return out.geometry();
}

// ---------------------------------------------------------------------------
// Hay: the stacks behind the barn and the forkfuls spilled at its door. They
// share the corn shocks' straw look (the same painting and material) over
// their own small atlas of fine, combed-down strands.

// Hay atlas, 512 x 256. The bottom half is a seamless strip of combed strands
// for a core; the top half holds four 128 px cells: 0 and 1 courses of thatch
// with ragged, combed fringes, 2 a loose wisp (base at the bottom), 3 a
// dropped handful.
const HAY_W = 512;
const HAY_H = 256;
const hayCellUV = (cell, u, v) => [(cell * CELL + 3 + u * (CELL - 6)) / HAY_W, 0.5 + (2 + v * 124) / HAY_H];
// y runs 0 at the foot to 1 at the top; stays clear of the cells above
const hayStripUV = (u, y) => [u, 0.012 + y * 0.46];

/** A fine hay strand along a quadratic curve: shaded edges, a paler core. */
function paintStrand(ctx, p0, p1, p2, w, c) {
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
  ctx.lineWidth = w;
  ctx.strokeStyle = css(c, 0.86);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, w * 0.45);
  ctx.strokeStyle = css(c, 1.1);
  ctx.stroke();
}

function paintHayStrip(ctx, rng) {
  const y0 = 128;
  const h = 128;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y0, HAY_W, h);
  ctx.clip();
  ctx.fillStyle = '#9a8a6c';
  ctx.fillRect(0, y0, HAY_W, h);
  // strands combed down the stack; near the ends drawn twice so it wraps
  for (let k = 0; k < 1300; k++) {
    const x = rng.float(0, HAY_W);
    const y = rng.float(y0 - 20, y0 + h - 4);
    const len = rng.float(10, 30);
    const lean = rng.float(-5, 5);
    const bow = rng.float(-2.5, 2.5);
    const w = rng.float(1.1, 2.3);
    const c = strawTone(rng);
    for (const dx of [0, ...(x < 10 ? [HAY_W] : []), ...(x > HAY_W - 10 ? [-HAY_W] : [])]) {
      paintStrand(ctx, [x + dx, y], [x + dx + lean * 0.5 + bow, y + len * 0.5], [x + dx + lean, y + len], w, c);
    }
  }
  ctx.restore();
}

/** Cells 0 and 1: a course of combed-down thatch, dense above, a ragged fringe of strand ends below. */
function paintThatchCell(ctx, rng, cell) {
  ctx.save();
  ctx.translate(cell * CELL, 0);
  ctx.beginPath();
  ctx.rect(2, 2, CELL - 4, 124);
  ctx.clip();
  for (let k = 0; k < 300; k++) {
    const x = rng.float(-4, CELL + 4);
    const y = rng.float(-12, 40);
    const len = rng.float(40, 118 - y);
    const lean = rng.float(-8, 8);
    paintStrand(ctx, [x, y], [x + lean * 0.4 + rng.float(-3, 3), y + len * 0.5], [x + lean, y + len], rng.float(1.2, 2.6), strawTone(rng));
  }
  // a few strays across the grain
  for (let k = 0; k < 8; k++) {
    const x = rng.float(10, 118);
    const y = rng.float(20, 90);
    const a = Math.PI / 2 + rng.float(-0.9, 0.9);
    const len = rng.float(20, 40);
    paintStrand(ctx, [x, y], [x + Math.cos(a) * len * 0.5 + rng.float(-4, 4), y + Math.sin(a) * len * 0.5], [x + Math.cos(a) * len, y + Math.sin(a) * len], rng.float(1.2, 2), strawTone(rng));
  }
  ctx.restore();
}

/** Cell 2: a loose wisp of strands splaying up and out from the bottom middle. */
function paintWispCell(ctx, rng, cell) {
  ctx.save();
  ctx.translate(cell * CELL, 0);
  ctx.beginPath();
  ctx.rect(2, 2, CELL - 4, 124);
  ctx.clip();
  for (let k = 0; k < 50; k++) {
    const bx = 64 + rng.float(-14, 14);
    const by = 128;
    const a = -Math.PI / 2 + rng.float(-0.85, 0.85);
    const len = rng.float(40, 118);
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    paintStrand(ctx, [bx, by], [(bx + ex) / 2 + rng.float(-14, 14), (by + ey) / 2 + rng.float(-4, 14)], [ex, ey], rng.float(1.1, 2.4), strawTone(rng));
  }
  ctx.restore();
}

/** Cell 3: a dropped handful, strands mostly one way, ragged all round. */
function paintHandfulCell(ctx, rng, cell) {
  ctx.save();
  ctx.translate(cell * CELL, 0);
  ctx.beginPath();
  ctx.rect(2, 2, CELL - 4, 124);
  ctx.clip();
  for (let k = 0; k < 90; k++) {
    const cx = 64 + rng.gauss() * 16;
    const cy = 64 + rng.gauss() * 20;
    const a = Math.PI / 2 + rng.float(-0.5, 0.5);
    const len = rng.float(24, 60);
    const dx = (Math.cos(a) * len) / 2;
    const dy = (Math.sin(a) * len) / 2;
    paintStrand(ctx, [cx - dx, cy - dy], [cx + rng.float(-6, 6), cy + rng.float(-4, 4)], [cx + dx, cy + dy], rng.float(1.1, 2.3), strawTone(rng));
  }
  ctx.restore();
}

let hayMaterialCache = null;
function hayMaterial() {
  if (hayMaterialCache) return hayMaterialCache;
  const c = makeCanvas(HAY_W, HAY_H);
  const ctx = c.getContext('2d');
  const rng = new Rng(1799);
  paintHayStrip(ctx, rng);
  paintThatchCell(ctx, rng, 0);
  paintThatchCell(ctx, rng, 1);
  paintWispCell(ctx, rng, 2);
  paintHandfulCell(ctx, rng, 3);
  hayMaterialCache = strawShaderMaterial(toTexture(c, { repeat: false }));
  return hayMaterialCache;
}

/**
 * A card from `base` to `tip`, `w0` wide at the base and `w1` at the tip
 * along `across`, sagging by `sag` (world y) in the middle; `uvOf(u, v)`
 * places it in the atlas (v 0 at the base).
 */
function strawCard(out, base, tip, across, w0, w1, nrm, uvOf, col, sag = 0) {
  const rows = [];
  for (const t of [0, 0.5, 1]) {
    const mid = base.clone().lerp(tip, t);
    mid.y -= sag * 4 * t * (1 - t);
    const w = (w0 + (w1 - w0) * t) / 2;
    rows.push([0, 1].map((j) => out.vert(mid.clone().addScaledVector(across, (j * 2 - 1) * w), nrm, uvOf(j, t), col)));
  }
  for (let i = 0; i < 2; i++) out.quad(rows[i][0], rows[i + 1][0], rows[i + 1][1], rows[i][1]);
}

// A stack's profile [height, radius]: tucked in at the foot, widest low down,
// then drawn up in a long taper to a peak round the pole.
const STACK_PROFILE = [[0, 0.29], [0.04, 0.31], [0.1, 0.315], [0.18, 0.3], [0.27, 0.26], [0.35, 0.2], [0.42, 0.14], [0.48, 0.08], [0.53, 0.03], [0.55, 0.01]];
const STACK_TOP = 0.55;
const STACK_GROUND = 0.03; // stacks are set this far into the ground
let stackTable = null;
function stackRadius(y) {
  stackTable ??= new THREE.SplineCurve(STACK_PROFILE.map(([h, r]) => new THREE.Vector2(h, r))).getPoints(96);
  const t = stackTable;
  if (y <= t[0].x) return t[0].y;
  for (let i = 1; i < t.length; i++) {
    if (y <= t[i].x) return t[i - 1].y + ((t[i].y - t[i - 1].y) * (y - t[i - 1].x)) / (t[i].x - t[i - 1].x || 1);
  }
  return t[t.length - 1].y;
}

/**
 * One haystack as built round a centre pole in the 1790s (foot at y = 0,
 * about 0.52 tall, the pole's hole at the top): a lumpy core under courses of
 * combed-down thatch, a greyer weathered top and loose wisps at the foot.
 */
function haystackGeometry(rng) {
  const out = new StrawMesh();
  const UP = new THREE.Vector3(0, 1, 0);
  const radial = (a) => new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  const tangent = (a) => new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const waves = [[2, 0.05], [3, 0.04], [5, 0.028], [8, 0.016]].map(([k, amp]) => ({ k, amp, ph: rng.float(0, 6.3), dy: rng.float(-6, 6) }));
  // settled lower and wider on one side
  const slump = rng.float(0.02, 0.05);
  const slumpA = rng.float(0, Math.PI * 2);
  const radius = (y, a) => {
    let f = 1 + slump * Math.cos(a - slumpA) * Math.sin(Math.PI * Math.min(1, Math.max(0, y) / STACK_TOP));
    for (const w of waves) f += w.amp * Math.sin(w.k * a + w.ph + y * w.dy) * Math.min(1, (STACK_TOP - y) * 6);
    return stackRadius(y) * f;
  };
  const onSurface = (y, a, off = 0) => radial(a).multiplyScalar(radius(y, a) + off).setY(y);
  const normalAt = (y, a) => radial(a).setY(-(radius(y + 0.005, a) - radius(y - 0.005, a)) / 0.01).normalize();
  // weathered greyer toward the top, darker at the foot
  const shade = (y, c) => {
    const w = easeStep(0.25, 0.52, y);
    const ao = 0.7 + 0.3 * easeStep(STACK_GROUND, STACK_GROUND + 0.1, y);
    return [c[0] * ao * (1 - 0.2 * w), c[1] * ao * (1 - 0.16 * w), c[2] * ao * (1 - 0.05 * w)];
  };
  const tone = () => {
    const b = rng.float(0.82, 1.08);
    return rng.pick(STRAW_TINTS).map((v) => v * b);
  };
  const wispUV = (cell) => (u, v) => hayCellUV(cell, u, v);

  // core, the strand strip wrapped twice round
  const ys = [0, 0.03, 0.07, 0.12, 0.18, 0.24, 0.3, 0.36, 0.41, 0.46, 0.5, 0.53, STACK_TOP];
  out.add(strawCore(ys, 20, radius, (s, y) => hayStripUV(s * 2, y / STACK_TOP)), (u, v) => [u, v], (y) => shade(y, [1, 1, 1]));

  // courses of thatch from the top down, each lapping over the one below
  for (const yTop of [0.535, 0.465, 0.39, 0.315, 0.235, 0.155]) {
    const n = Math.max(12, Math.round((2 * Math.PI * stackRadius(yTop)) / 0.15));
    const phase = rng.float(0, Math.PI * 2);
    for (let k = 0; k < n; k++) {
      const theta = phase + ((k + rng.float(-0.25, 0.25)) / n) * Math.PI * 2;
      const half = (Math.PI / n) * rng.float(1.2, 1.45);
      const y0 = yTop + rng.float(-0.01, 0.01);
      const y1 = Math.max(-0.012, y0 - rng.float(0.11, 0.15));
      const cell = rng.int(0, 1);
      const flip = rng.chance(0.5);
      const c = tone();
      const lift = rng.float(0.01, 0.028); // the fringe stands off a little
      const rows = [];
      for (let i = 0; i <= 2; i++) {
        const t = i / 2;
        const y = y0 + (y1 - y0) * t;
        rows.push([0, 1, 2].map((j) => {
          const a = theta + (j - 1) * half;
          const u = flip ? 1 - j / 2 : j / 2;
          // in the shadow of the course above at the top, catching the light at the fringe
          const col = shade(y, c).map((v) => v * (0.8 + 0.2 * t));
          return out.vert(onSurface(y, a, 0.006 + lift * t * t), normalAt(y, a), hayCellUV(cell, u, 1 - t), col);
        }));
      }
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) out.quad(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]);
    }
  }

  // a weathered topknot drawn up round the pole
  for (let k = 0; k < 7; k++) {
    const theta = (k / 7) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const base = onSurface(rng.float(0.47, 0.52), theta, -0.008);
    const tip = radial(theta).multiplyScalar(rng.float(0.02, 0.05)).setY(STACK_TOP + rng.float(0.02, 0.06));
    const nrm = radial(theta).multiplyScalar(0.4).add(UP).normalize();
    strawCard(out, base, tip, tangent(theta), rng.float(0.08, 0.1), rng.float(0.06, 0.09), nrm, wispUV(2), shade(0.52, tone()));
  }

  // loose wisps: strewn on the ground round the foot, and a few pulled out of the sides
  for (let k = 0; k < 20; k++) {
    const theta = (k / 20) * Math.PI * 2 + rng.float(-0.15, 0.15);
    const base = onSurface(STACK_GROUND + rng.float(0.01, 0.05), theta, 0.004);
    const tip = base.clone().addScaledVector(radial(theta + rng.float(-0.35, 0.35)), rng.float(0.07, 0.13)).setY(STACK_GROUND + rng.float(-0.004, 0.01));
    const nrm = radial(theta).multiplyScalar(0.35).add(UP).normalize();
    strawCard(out, base, tip, tangent(theta), rng.float(0.05, 0.08), rng.float(0.08, 0.12), nrm, wispUV(rng.chance(0.7) ? 3 : 2), shade(STACK_GROUND, tone()), -0.006);
  }
  for (let k = 0; k < 8; k++) {
    const theta = rng.float(0, Math.PI * 2);
    const y = rng.float(0.12, 0.4);
    const base = onSurface(y, theta, 0.004);
    const tip = base.clone().addScaledVector(radial(theta), rng.float(0.03, 0.06)).addScaledVector(UP, -rng.float(0.03, 0.07));
    strawCard(out, base, tip, tangent(theta), 0.05, rng.float(0.06, 0.09), normalAt(y, theta), wispUV(2), shade(y, tone()), 0.008);
  }
  return out.geometry();
}

/**
 * Hay forked out of a doorway: a low, lumpy spill with wisps strewn round it.
 * Local frame: the threshold at the origin, +z out of the door, y up from the ground.
 */
function haySpillGeometry(rng) {
  const out = new StrawMesh();
  const UP = new THREE.Vector3(0, 1, 0);
  const RX = 0.2;
  const RZ = 0.13;
  const CZ = 0.1;
  const HT = 0.06;
  const lumps = [[2, 0.15], [3, 0.12], [5, 0.08]].map(([k, amp]) => ({ k, amp, ph: rng.float(0, 6.3) }));
  const tone = () => {
    const b = rng.float(0.82, 1.08);
    return rng.pick(STRAW_TINTS).map((v) => v * b);
  };
  // height of the heap at (x, z), for laying hay on it (lumps allowed for)
  const heapY = (x, z) => {
    const rho = Math.hypot(x / RX, (z - CZ) / RZ);
    return rho < 1 ? HT * (1 - rho * rho) ** 1.2 * 1.35 : 0;
  };

  // the mound: a polar grid over an ellipse, heaped highest by the door
  const SEG = 18;
  const rhos = [0, 0.25, 0.5, 0.7, 0.85, 0.95, 1];
  const pos = [];
  const uv = [];
  const idx = [];
  for (const rho of rhos) {
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      let lump = 1;
      for (const w of lumps) lump += w.amp * Math.sin(w.k * a + w.ph + rho * 3) * rho;
      const rim = 1 + 0.12 * Math.sin(3 * a + lumps[0].ph) + 0.08 * Math.sin(5 * a + lumps[1].ph);
      const x = Math.cos(a) * RX * rho * rim;
      const z = CZ + Math.sin(a) * RZ * rho * rim;
      const y = HT * (1 - rho * rho) ** 1.2 * lump * (1 - 0.35 * Math.sin(a) * rho) - 0.004;
      pos.push(x, y, z);
      // strands lie the way they were forked, out of the door
      uv.push(...hayStripUV(x / 0.4 + 0.5, Math.min(1, Math.max(0, (z + 0.06) / 0.34))));
    }
  }
  for (let i = 0; i < rhos.length - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j;
      const b = a + SEG + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  smoothSeam(g, rhos.length, SEG);
  for (let j = 0; j <= SEG; j++) g.attributes.normal.setXYZ(j, 0, 1, 0); // the peak
  out.add(g, (u, v) => [u, v], (y) => {
    const s = 0.85 + 0.2 * Math.min(1, y / 0.03);
    return [s, s, s];
  });

  // loose handfuls strewn over the heap and out across the ground, lying
  // every which way but mostly as they were forked, away from the door
  for (let k = 0; k < 36; k++) {
    const a = rng.float(-0.25, Math.PI + 0.25);
    // a third heaped over the pile, the rest strewn about
    const reach = k % 3 === 0 ? rng.float(0, 0.75) : Math.sqrt(rng.next()) * 1.35;
    const base = new THREE.Vector3(Math.cos(a) * RX * reach, 0, Math.max(0.02, CZ + Math.sin(a) * RZ * reach));
    const dir = new THREE.Vector3(rng.float(-1, 1), 0, rng.float(-0.2, 1)).normalize();
    const tip = base.clone().addScaledVector(dir, rng.float(0.06, 0.12));
    base.y = heapY(base.x, base.z) + 0.004;
    tip.y = heapY(tip.x, tip.z) + 0.004 + rng.float(0, 0.005);
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    const cell = rng.chance(0.8) ? 3 : 2;
    strawCard(out, base, tip, across, rng.float(0.05, 0.09), rng.float(0.05, 0.1), UP, (u, v) => hayCellUV(cell, u, v), tone(), -0.002);
  }
  return out.geometry();
}

function scarecrow(world) {
  const g = new THREE.Group();
  const wood = plain('#4a3a2a', { roughness: 0.9 });
  const coat = plain('#4d3b30', { roughness: 0.95, flat: true });
  const shirt = plain('#7a3024', { roughness: 0.95, flat: true });
  const straw = plain('#c8a656', { roughness: 0.9, flat: true });
  const hat = plain('#3a3025', { roughness: 0.9, flat: true });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.78, 5), wood);
  pole.position.y = 0.39;
  g.add(pole);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.56, 5), wood);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.6;
  g.add(bar);
  // ragged coat body
  const body = new THREE.Mesh(jitter(new THREE.CylinderGeometry(0.07, 0.11, 0.28, 7, 2), 0.012, 3), coat);
  body.position.y = 0.5;
  body.castShadow = true;
  g.add(body);
  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.09, 0.14, 7), shirt);
  vest.position.y = 0.56;
  g.add(vest);
  for (const side of [-1, 1]) {
    const sleeve = new THREE.Mesh(jitter(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 6), 0.008, side + 5), coat);
    sleeve.rotation.z = Math.PI / 2;
    sleeve.position.set(side * 0.17, 0.6, 0);
    sleeve.castShadow = true;
    g.add(sleeve);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 5), straw);
    tuft.rotation.z = side * Math.PI / 2;
    tuft.position.set(side * 0.3, 0.6, 0);
    g.add(tuft);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), straw);
    leg.rotation.x = Math.PI;
    leg.position.set(side * 0.04, 0.32, 0);
    g.add(leg);
  }
  // jack-o'-lantern head, and a battered hat
  const head = makeJack(1.25);
  head.position.y = 0.66;
  g.add(head);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.01, 12), hat);
  // brim rests on top of the pumpkin head, stem tucked up into the crown
  brim.position.y = 0.768;
  brim.rotation.set(0.12, 0, -0.1);
  g.add(brim);
  const crown = new THREE.Mesh(jitter(new THREE.CylinderGeometry(0.055, 0.07, 0.09, 8), 0.008, 9), hat);
  crown.position.y = 0.812;
  crown.rotation.set(0.12, 0, -0.14);
  g.add(crown);
  // perch point for a crow: the middle of the hat's crown, on top
  const hatTop = new THREE.Object3D();
  hatTop.position.y = 0.045;
  crown.add(hatTop);
  g.userData.hatTop = hatTop;
  return g;
}

// ---------------------------------------------------------------------------

export function buildFarm(world) {
  const { layout, scene } = world;
  const rng = new Rng(1820);
  const H = (x, z) => layout.heightAt(x, z);

  // --- stubble rows ---------------------------------------------------------
  const stubGeo = new THREE.CylinderGeometry(0.006, 0.009, 0.06, 4);
  stubGeo.translate(0, 0.03, 0);
  const stubMat = plain('#b0955c', { roughness: 0.95 });
  const stubs = [];
  const shockSpots = [];
  const rowZ = [];
  for (let z = FIELD.z0 + 0.12; z < FIELD.z1 - 0.05; z += 0.2) rowZ.push(z);
  const standingRows = 3; // northernmost rows still stand
  rowZ.forEach((z, ri) => {
    if (ri < standingRows) return;
    for (let x = FIELD.x0 + 0.08; x < FIELD.x1 - 0.05; x += 0.085) {
      const px = x + rng.float(-0.02, 0.02);
      const pz = z + rng.float(-0.02, 0.02);
      stubs.push({ x: px, z: pz, s: rng.float(0.6, 1.3), t: rng.float(-0.25, 0.25) });
    }
  });
  scene.add(instanced(stubGeo, stubMat, stubs, (it) => {
    e.set(it.t, 0, it.t * 0.6);
    q.setFromEuler(e);
    m4.compose(v3.set(it.x, H(it.x, it.z) - 0.005, it.z), q, s3.set(1, it.s, 1));
  }, { cast: false }));

  // --- standing dry corn ----------------------------------------------------
  const stalkVariants = [stalkGeometry(new Rng(1)), stalkGeometry(new Rng(2), 0.46), stalkGeometry(new Rng(3), 0.38)];
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide });
  stalkVariants.forEach((geo, k) => {
    const items = [];
    for (let ri = 0; ri < standingRows; ri++) {
      for (let x = FIELD.x0 + 0.08; x < FIELD.x1 - 0.05; x += 0.1) {
        if (rng.next() > 0.36) continue;
        const c = new THREE.Color('#b99c60').multiplyScalar(rng.float(0.75, 1.1));
        items.push({ x: x + rng.float(-0.03, 0.03), z: rowZ[ri] + rng.float(-0.03, 0.03), r: rng.float(0, 6.3), s: rng.float(0.85, 1.15), color: c, k });
      }
    }
    scene.add(instanced(geo, stalkMat, items, (it) => {
      e.set(rng.float(-0.08, 0.08), it.r, rng.float(-0.08, 0.08));
      q.setFromEuler(e);
      m4.compose(v3.set(it.x, H(it.x, it.z) - 0.01, it.z), q, s3.set(it.s, it.s, it.s));
    }));
  });

  // --- corn shocks ------------------------------------------------------------
  const shocks = [];
  for (let ri = standingRows + 1; ri < rowZ.length; ri += 3) {
    for (let x = FIELD.x0 + 0.45; x < FIELD.x1 - 0.3; x += 0.85) {
      const px = x + rng.float(-0.12, 0.12) + (ri % 2 ? 0.4 : 0);
      if (px > FIELD.x1 - 0.25) continue;
      if (Math.hypot(px - CLEARINGS.scarecrow.x, rowZ[ri] - CLEARINGS.scarecrow.z) < 0.4) continue;
      shocks.push({ x: px, z: rowZ[ri] + 0.1, s: rng.float(0.85, 1.15), r: rng.float(0, 6), color: new THREE.Color('#bc9d5c').multiplyScalar(rng.float(0.8, 1.05)) });
      shockSpots.push([px, rowZ[ri] + 0.1]);
    }
  }
  // Three shapes of shock, dealt out in turn. The matrices are worked out in
  // field order first, so the shared rng is drawn exactly as it always was.
  const shockMat = shockMaterial();
  const shockShapes = [0, 1, 2].map((k) => ({ geo: shockGeometry(new Rng(4101 + k * 37)), items: [] }));
  shocks.forEach((it, i) => {
    e.set(0, it.r, rng.float(-0.05, 0.05));
    q.setFromEuler(e);
    m4.compose(v3.set(it.x, H(it.x, it.z) - 0.01, it.z), q, s3.set(it.s, it.s * rng.float(0.9, 1.1), it.s));
    shockShapes[i % 3].items.push({ matrix: m4.clone(), color: it.color });
  });
  for (const { geo, items } of shockShapes) {
    scene.add(instanced(geo, shockMat, items, (it) => m4.copy(it.matrix)));
  }

  // --- pumpkins ---------------------------------------------------------------
  const pumpkins = [];
  const addPumpkin = (x, z, s) => pumpkins.push({
    x, z, s, r: rng.float(0, 6.3),
    color: new THREE.Color().setHSL(rng.float(0.055, 0.085), 0.85, rng.float(0.36, 0.48)),
  });
  let tries = 0;
  while (pumpkins.length < 28 && tries++ < 400) {
    const x = rng.float(FIELD.x0 + 0.15, FIELD.x1 - 0.15);
    const z = rng.float(FIELD.z0 + 0.8, FIELD.z1 - 0.1);
    if (shockSpots.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 0.22)) continue;
    addPumpkin(x, z, rng.float(0.7, 1.35));
  }
  // pile by the barn door and in the front meadow
  for (let k = 0; k < 9; k++) addPumpkin(-0.55 + rng.float(-0.25, 0.25), -1.45 + rng.float(-0.15, 0.12), rng.float(0.8, 1.3));
  for (let k = 0; k < 10; k++) addPumpkin(rng.float(-1.0, 0.9), rng.float(4.3, 5.1), rng.float(0.8, 1.4));
  const pGeo = pumpkinGeometry(0.06, 16, 10);
  const pMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
  scene.add(instanced(pGeo, pMat, pumpkins, (it) => {
    e.set(0, it.r, 0);
    q.setFromEuler(e);
    m4.compose(v3.set(it.x, H(it.x, it.z) + 0.035 * it.s, it.z), q, s3.set(it.s, it.s, it.s));
  }));
  const stemGeo = new THREE.CylinderGeometry(0.007, 0.012, 0.035, 5);
  stemGeo.translate(0, 0.0175, 0);
  scene.add(instanced(stemGeo, plain('#4c4424'), pumpkins.map((p) => ({ ...p, color: null })), (it) => {
    e.set(0.2, it.r, 0.1);
    q.setFromEuler(e);
    m4.compose(v3.set(it.x, H(it.x, it.z) + 0.035 * it.s + 0.042 * it.s, it.z), q, s3.set(it.s, it.s, it.s));
  }, { cast: false }));

  // --- haystacks --------------------------------------------------------------
  // Three stacks baked into one straw mesh (one draw), each round its pole,
  // in the corn shocks' own straw ('#bc9d5c') so the hay matches them. Own
  // rng, so the shared one is left alone.
  const hayMat = hayMaterial();
  const hayRng = new Rng(1795);
  const stackGeos = [];
  const poleGeos = [];
  CLEARINGS.haystacks.forEach((h, k) => {
    e.set(0, hayRng.float(0, Math.PI * 2), 0);
    q.setFromEuler(e);
    m4.compose(v3.set(h.x, H(h.x, h.z) - STACK_GROUND, h.z), q, s3.set(h.s, h.s, h.s));
    stackGeos.push(haystackGeometry(new Rng(2203 + k * 41)).applyMatrix4(m4));
    // the stack pole, standing a little out of true above the top
    const tip = new THREE.Vector3(hayRng.float(-0.012, 0.012), STACK_TOP + 0.15, hayRng.float(-0.012, 0.012));
    poleGeos.push(taperedTube([tip, new THREE.Vector3(0, 0.3, 0)], [0.0075, 0.0105], 6, { capStart: true }).applyMatrix4(m4));
  });
  const strawGold = new THREE.Color('#bc9d5c');
  scene.add(instanced(mergeAll(stackGeos), hayMat, [{ color: strawGold }], () => m4.identity()));
  const poles = new THREE.Mesh(mergeAll(poleGeos), plain('#4a3a2a'));
  poles.castShadow = true;
  scene.add(poles);

  // --- hay forked out of the barn door ------------------------------------------
  // (the barn itself is built in village.js; this spill used to be part of it)
  const barn = BUILDINGS.find((b) => b.id === 'barn');
  const spill = haySpillGeometry(new Rng(1803));
  spill.translate(-0.05, 0, barn.d / 2); // the door's threshold, a touch left of centre
  spill.rotateY(barn.yaw);
  spill.translate(barn.x, 0, barn.z);
  const sp = spill.attributes.position;
  for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) + H(sp.getX(i), sp.getZ(i)));
  scene.add(instanced(spill, hayMat, [{ color: strawGold }], () => m4.identity()));

  // --- scarecrow ---------------------------------------------------------------
  const sc = scarecrow(world);
  const S = CLEARINGS.scarecrow;
  sc.position.set(S.x, H(S.x, S.z) - 0.02, S.z);
  sc.rotation.y = 0.35;
  sc.scale.setScalar(1.1);
  scene.add(sc);
  sc.updateMatrixWorld(true);
  world.scarecrow = {
    // tops of the coat sleeves near the straw hands, and the top of the hat
    arms: [new THREE.Vector3(-0.25, 0.645, 0), new THREE.Vector3(0.25, 0.645, 0)].map((p) => p.applyMatrix4(sc.matrixWorld)),
    head: sc.userData.hatTop.getWorldPosition(new THREE.Vector3()),
  };

  buildStoneWalls(world);
  buildRailFence(world, rng);
}

// ---------------------------------------------------------------------------

const WALLS = [
  [[-3.15, 2.78], [1.05, 2.78]],
  [[-3.15, 2.78], [-3.15, -0.95]],
  [[1.1, 2.78], [1.1, 0.4]],
  [[-1.25, 4.12], [0.2, 4.08], [1.15, 4.2]],
  [[-1.3, -4.4], [0.4, -4.35], [1.45, -4.42]],
  [[2.95, -4.5], [3.9, -4.45]],
  [[5.2, 4.1], [6.3, 3.95], [7.2, 3.5]],
];

// --- dry-stone field walls ---------------------------------------------------
// New England walls: glacial fieldstone stacked in two or three loose courses
// with flat capstones on top, a few stones tumbled into the grass. Each stone
// shape is a unit-sized, faceted rock; instances stretch it to size.

/**
 * Fit a geometry into the unit cube around the origin, then shade it darker
 * toward the bottom (ground contact) and, if `moss`, green on top.
 */
function finishRock(g, moss = false) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const size = new THREE.Vector3();
  const mid = new THREE.Vector3();
  bb.getSize(size);
  bb.getCenter(mid);
  g.translate(-mid.x, -mid.y, -mid.z);
  g.scale(1 / size.x, 1 / size.y, 1 / size.z);
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) + 0.5; // 0 at the bottom, 1 on top
    const ao = 0.58 + 0.42 * Math.min(1, t * 1.4);
    const m = moss ? Math.min(1, Math.max(0, t - 0.5) * 2.4) : 0;
    colors[i * 3] = ao * (1 - 0.4 * m);
    colors[i * 3 + 1] = ao * (1 - 0.12 * m);
    colors[i * 3 + 2] = ao * (1 - 0.6 * m);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** A lumpy, rounded fieldstone: an icosahedron with its corners pushed about. */
function boulderGeometry(seed) {
  const rng = new Rng(seed);
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  // the polyhedron repeats shared corners; move each corner once
  const pos = g.attributes.position;
  const moved = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!moved.has(key)) moved.set(key, rng.float(0.78, 1.12));
    const f = moved.get(key);
    // flatter underneath, so stones sit on their beds
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * (pos.getY(i) < 0 ? 0.7 : 1), pos.getZ(i) * f);
  }
  return finishRock(g);
}

/** A flat, irregular slab: a `sides`-gon with sloping sides and an uneven top. */
function slabGeometry(seed, sides, moss = false) {
  const rng = new Rng(seed);
  const ring = [];
  for (let k = 0; k < sides; k++) {
    const a = ((k + rng.float(-0.3, 0.3)) / sides) * Math.PI * 2;
    const r = rng.float(0.62, 1.0) * 0.5;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const top = ring.map(([x, z]) => {
    const f = rng.float(0.66, 0.84);
    return [x * f, 0.5 + rng.float(-0.2, 0.1), z * f];
  });
  const bot = ring.map(([x, z]) => [x, -0.5 + rng.float(-0.05, 0.08), z]);
  const tris = [];
  for (let k = 1; k < sides - 1; k++) {
    tris.push([top[0], top[k], top[k + 1]]);
    tris.push([bot[0], bot[k + 1], bot[k]]);
  }
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    tris.push([top[k], bot[k], bot[k1]], [top[k], bot[k1], top[k1]]);
  }
  // wind every face outward (the shape is convex-ish around its centre)
  const p = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    ab.cross(ac);
    const out = ab.x * (a[0] + b[0] + c[0]) + ab.y * (a[1] + b[1] + c[1]) + ab.z * (a[2] + b[2] + c[2]) >= 0;
    p.push(...a, ...(out ? b : c), ...(out ? c : b));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return finishRock(g, moss);
}

// weathered fieldstone: warm greys, buff and brown, one lichen-grey
const WALL_STONE = ['#8b8577', '#94886f', '#7f7b71', '#6e695d', '#9b927d', '#867b69', '#7d8073'];
const MOSS = new THREE.Color('#56613c');

function buildStoneWalls(world) {
  const { layout, scene } = world;
  const rng = new Rng(1636);
  const H = (x, z) => layout.heightAt(x, z);
  // stone shapes: two boulders, two slabs and a mossy-topped capstone
  const shapes = [boulderGeometry(11), boulderGeometry(23), slabGeometry(5, 6), slabGeometry(8, 5), slabGeometry(13, 6, true)];
  const items = shapes.map(() => []);
  const BOULDER = [0, 1];
  const SLAB = [2, 3];
  const MOSSY = 4;
  const frog = CLEARINGS.frog;

  // caps: mostly flat slabs (some mossy), now and then a rounded stone
  const capShape = () => (rng.chance(0.22) ? rng.pick(BOULDER) : rng.chance(0.4) ? MOSSY : rng.pick(SLAB));
  const stoneColor = (dark, mossy) => {
    const c = new THREE.Color(rng.pick(WALL_STONE)).multiplyScalar(rng.float(0.82, 1.08) * dark);
    if (rng.chance(mossy)) c.lerp(MOSS, rng.float(0.2, 0.45));
    return c;
  };
  // where a fallen stone may lie: not on the road, in the river, by the frog or a house
  const clearGround = (x, z) =>
    layout.roadDistance(x, z, 1) > ROAD_HALF + 0.12 &&
    !layout.isWater(x, z) &&
    !layout.nearBuilding(x, z, 0.12) &&
    Math.hypot(x - frog.x, z - frog.z) > 0.24;

  // courses from the ground up: stone length, height, wall depth, how often
  // a course position is a pair of face stones instead of one through-stone
  const COURSES = [
    { len: [0.07, 0.115], h: [0.042, 0.056], depth: 0.135, pairs: 0.35, slab: 0.3 },
    { len: [0.06, 0.1], h: [0.032, 0.046], depth: 0.118, pairs: 0.25, slab: 0.5 },
    { len: [0.05, 0.085], h: [0.028, 0.038], depth: 0.1, pairs: 0, slab: 0.6, partial: true },
    { len: [0.06, 0.14], h: [0.018, 0.034], depth: 0.12, pairs: 0, cap: true },
  ];

  for (const line of WALLS) {
    const phase = rng.float(0, 10);
    for (let sgi = 0; sgi < line.length - 1; sgi++) {
      const [x0, z0] = line[sgi];
      const [x1, z1] = line[sgi + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len;
      const dz = (z1 - z0) / len;
      const yaw = Math.atan2(-dz, dx);
      const at = (t, off) => [x0 + dx * t - dz * off, z0 + dz * t + dx * off];
      let below = []; // tops of the course below: [t0, t1, top above ground]
      COURSES.forEach((course, ci) => {
        const tops = [];
        let t = ci === 0 ? 0 : rng.float(-0.03, 0.02);
        while (t < len - 0.02) {
          const L = rng.float(...course.len);
          const t0 = Math.max(0, t);
          const t1 = Math.min(len, t + L);
          t += L * rng.float(0.9, 0.98); // butted tight, a little overlap
          if (t1 - t0 < 0.03) continue;
          const tc = (t0 + t1) / 2;
          if (course.cap && rng.chance(0.08)) continue; // a capstone gone missing
          // the third course comes and goes along the wall
          const s = sgi * 3.1 + tc;
          if (course.partial && Math.sin(s * 2.3 + phase) + Math.sin(s * 5.3 + phase * 2) < -0.35) continue;
          // rest on the highest stone below, sunk in a touch
          let rest = 0;
          for (const [b0, b1, top] of below) if (b1 > t0 && b0 < t1) rest = Math.max(rest, top);
          if (ci > 0 && rest === 0) rest = 0.04 * ci;
          const faces = rng.chance(course.pairs) ? [-1, 1] : [0];
          let courseTop = 0;
          for (const side of faces) {
            const h = rng.float(...course.h);
            const depth = course.depth * (side ? rng.float(0.46, 0.56) : course.cap ? rng.float(0.75, 1.15) : rng.float(0.85, 1.05));
            const off = side * course.depth * 0.25 + rng.float(-0.008, 0.008);
            const yRel = ci === 0 ? h * 0.5 - rng.float(0.006, 0.014) : rest + h * 0.5 - rng.float(0.005, 0.01);
            const shape = course.cap ? capShape() : rng.chance(course.slab) ? rng.pick(SLAB) : rng.pick(BOULDER);
            const tilt = course.cap ? 0.15 : 0.06;
            const stone = {
              t: tc + rng.float(-0.006, 0.006),
              off,
              yRel,
              L: (t1 - t0) * rng.float(1.02, 1.1),
              h,
              depth,
              yaw: yaw + rng.float(-0.12, 0.12) * (course.cap ? 2 : 1) + (rng.chance(0.5) ? Math.PI : 0),
              pitch: rng.float(-tilt, tilt),
              roll: rng.float(-tilt, tilt),
              color: stoneColor(ci === 0 ? 0.9 : 1, ci === 0 ? 0.28 : course.cap ? 0.22 : 0.1),
            };
            // now and then an upper stone has tumbled off into the grass
            if (ci > 0 && rng.chance(0.05)) {
              const fall = rng.sign() * rng.float(0.11, 0.2);
              const [fx, fz] = at(stone.t + rng.float(-0.05, 0.05), fall);
              if (clearGround(fx, fz)) {
                items[shape].push({ ...stone, x: fx, z: fz, y: H(fx, fz) + h * 0.22, yaw: rng.float(0, 6.3), pitch: rng.float(-0.4, 0.4), roll: rng.float(-0.4, 0.4) });
                continue;
              }
            }
            const [x, z] = at(stone.t, off);
            items[shape].push({ ...stone, x, z, y: H(x, z) + yRel });
            courseTop = Math.max(courseTop, yRel + h * 0.5);
          }
          if (courseTop > 0) tops.push([t0, t1, courseTop]);
        }
        // through gaps in a partial course the caps rest on the course below
        below = course.partial ? below.concat(tops) : tops;
      });
    }
  }

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true, vertexColors: true });
  const turn = new THREE.Euler(0, 0, 0, 'YXZ'); // yaw along the wall first, then the tilts
  shapes.forEach((geo, k) => {
    if (!items[k].length) return;
    scene.add(instanced(geo, mat, items[k], (it) => {
      turn.set(it.pitch, it.yaw, it.roll);
      q.setFromEuler(turn);
      m4.compose(v3.set(it.x, it.y, it.z), q, s3.set(it.L, it.h, it.depth));
    }));
  });
}


function buildRailFence(world, rng) {
  const { layout, scene } = world;
  // zig-zag worm fence along the back lane of the farm
  const path = [[-5.0, -3.22], [0.55, -3.28]];
  const [[x0, z0], [x1, z1]] = path;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const dirX = (x1 - x0) / len;
  const dirZ = (z1 - z0) / len;
  const rail = 0.34;
  const zig = 0.055;
  const n = Math.floor(len / (rail * 0.92));
  const rails = [];
  for (let k = 0; k < n; k++) {
    const ax = x0 + dirX * k * rail * 0.92 + -dirZ * (k % 2 ? zig : -zig);
    const az = z0 + dirZ * k * rail * 0.92 + dirX * (k % 2 ? zig : -zig);
    const bx = x0 + dirX * (k + 1) * rail * 0.92 + -dirZ * (k % 2 ? -zig : zig);
    const bz = z0 + dirZ * (k + 1) * rail * 0.92 + dirX * (k % 2 ? -zig : zig);
    if (world.layout.nearBuilding((ax + bx) / 2, (az + bz) / 2, 0.08)) continue;
    const yb = (layout.heightAt(ax, az) + layout.heightAt(bx, bz)) / 2;
    for (let level = 0; level < 4; level++) {
      const v = rng.float(0.7, 1.05);
      rails.push({ ax, az, bx, bz, y: yb + 0.035 + level * 0.048 + (k % 2) * 0.024, color: new THREE.Color(v * 0.95, v * 0.88, v * 0.8) });
    }
  }
  const g = new THREE.BoxGeometry(1, 0.02, 0.024);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d5f50, roughness: 0.95 });
  const dir = new THREE.Vector3();
  scene.add(instanced(g, mat, rails, (it) => {
    dir.set(it.bx - it.ax, 0, it.bz - it.az);
    const l = dir.length() + 0.06;
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
    m4.compose(v3.set((it.ax + it.bx) / 2, it.y, (it.az + it.bz) / 2), q, s3.set(l, 1, 1));
  }));
}

