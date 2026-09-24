// Autumn woods: instanced maples, birches, oaks and hemlocks in fall colors,
// plus gnarled leafless trees — including the great twisted tree by the road
// where the story says Major André was taken.

import * as THREE from 'three';
import { TERRAIN, WATER_Y } from '../config.js';
import { taperedTube, paint, mergeAll } from '../util/geom.js';
import { makeCanvas, toTexture } from '../util/textures.js';
import { Rng } from '../util/rng.js';
import { FIELD, CHURCHYARD, GNARLED_TREE, CLEARINGS } from './layout.js';

const BARK = '#46382e';

const PALETTES = {
  maple: ['#c8321e', '#dc4422', '#e2621f', '#ea7c26', '#c02a1f', '#f09a2a', '#d24e1e'],
  birch: ['#e3b02c', '#edc23e', '#d9a12a', '#c9aa32', '#f0cf52'],
  oak: ['#9c5024', '#b0622c', '#8a4420', '#a8702e', '#7f5426'],
  pine: ['#23402c', '#1e3827', '#2b4a30', '#27432f'],
};

// ---------------------------------------------------------------------------
// Geometry builders
//
// Crowns are a small dark core (so you can't see straight through) wrapped in
// many alpha-cut "leaf cards" painted with clusters of leaves. Card normals
// point away from the crown's center so the foliage shades like a soft volume.

const ATLAS_CELLS = 5; // 0 maple, 1 round (birch), 2 lobed (oak), 3 solid, 4 hemlock sprays
const SOLID_UV = [(3 + 0.5) / ATLAS_CELLS, 0.5];
const SPRAY_CELL = 4; // two sprays side by side, each half a cell wide: 0 broad, 1 slender

/** Atlas uv on hemlock spray `k`: u runs across the spray, v from its base (0) to its tip (1). */
function sprayUV(k, u, v) {
  return [(SPRAY_CELL + k * 0.5 + 0.01 + u * 0.48) / ATLAS_CELLS, 0.01 + v * 0.98];
}

function leafShape(ctx, kind, size) {
  ctx.beginPath();
  if (kind === 0) {
    // five-pointed maple leaf
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const r = k % 2 ? size * 0.45 : size * (k === 4 || k === 6 ? 0.8 : 1);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
  } else if (kind === 1) {
    ctx.ellipse(0, 0, size * 0.55, size * 0.8, 0, 0, Math.PI * 2);
  } else {
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const r = size * (0.62 + 0.2 * Math.cos(a * 4)) * (1 + 0.25 * Math.sin(a));
      ctx.lineTo(Math.cos(a) * r * 0.62, Math.sin(a) * r);
    }
  }
  ctx.closePath();
}

/**
 * A flat hemlock spray seen from above, painted into a w x h box at (ox, 0):
 * a twig with alternate side shoots, each lined with short two-ranked needles.
 * The needle mass underneath is dark and solid (a filled outline inside the
 * shoot tips) so a spray keeps its body in the small mipmaps and distant
 * trees stay dense; the needles on top feather its edge and lighten toward
 * the tips, like the season's new growth. Base at the bottom, tip at the top.
 */
function paintSpray(ctx, rng, ox, w, h, { shoots, reach, angle, needle }) {
  const SHADES = 6;
  const mass = [];
  const needles = Array.from({ length: SHADES }, () => []);
  const len = h - 16;
  const bend = rng.float(-0.04, 0.04) * w;
  const spine = (t) => [ox + w / 2 + Math.sin(t * Math.PI) * bend, h - 8 - t * len];

  // walk a shoot out from (x, y) along (dx, dy), curving toward the spray's tip
  const shoot = (x, y, dx, dy, length, size, t0) => {
    const step = 2.2;
    const steps = Math.max(2, Math.round(length / step));
    const path = [x, y];
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      dy -= 0.009;
      const m = Math.hypot(dx, dy);
      dx /= m;
      dy /= m;
      x += dx * step;
      y += dy * step;
      path.push(x, y);
      const nl = size * (1 - 0.45 * f) * rng.float(0.8, 1.15);
      for (const s of [-1, 1]) {
        const lean = rng.float(0.12, 0.5); // needles sweep forward a little
        const nx = -dy * s * Math.cos(lean) + dx * Math.sin(lean);
        const ny = dx * s * Math.cos(lean) + dy * Math.sin(lean);
        const g = 0.05 + 0.45 * f + 0.4 * t0 + rng.float(-0.2, 0.2);
        const k = Math.max(0, Math.min(SHADES - 1, Math.floor(g * SHADES)));
        needles[k].push(x, y, x + nx * nl, y + ny * nl);
      }
    }
    mass.push({ path, width: size * 1.25 });
    return path;
  };

  const rachis = [];
  for (let i = 0; i <= 24; i++) rachis.push(...spine(i / 24));
  mass.push({ path: rachis, width: 4.5 });
  const tips = [[], []]; // shoot tips on the left and right, base to tip
  for (let j = 0; j < shoots; j++) {
    const t = 0.04 + (0.9 * (j + rng.float(0, 0.7))) / shoots;
    const side = j % 2 ? 1 : -1;
    const [x, y] = spine(t);
    // broadest a little past the middle, like a fan of foliage
    const profile = Math.sin(Math.PI * Math.pow(t, 1.15));
    const length = w * reach * (0.12 + 0.88 * profile) * rng.float(0.82, 1.1);
    const a = angle * (1.12 - 0.3 * t) * rng.float(0.9, 1.1);
    const path = shoot(x, y, side * Math.sin(a), -Math.cos(a), length, needle, t);
    tips[side > 0 ? 1 : 0].push(path.slice(-2));
    // the longer shoots fork again, forward and outward
    if (length > 20) {
      const pts = path.length / 2;
      for (const [f, turn] of [[0.3, -0.75], [0.55, 0.6]]) {
        const i = Math.floor((pts - 1) * f * rng.float(0.85, 1.15));
        const b = a + turn * rng.float(0.8, 1.2);
        shoot(path[i * 2], path[i * 2 + 1], side * Math.sin(b), -Math.cos(b), length * rng.float(0.3, 0.42), needle * 0.8, t);
      }
    }
  }

  const strokePath = (p) => {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 1, 1, w - 2, h - 2);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // solid body, a little inside the shoot tips
  const cx = ox + w / 2;
  const hull = [spine(0.1), ...tips[0], spine(0.9), ...tips[1].reverse()];
  ctx.fillStyle = 'rgb(70,76,68)';
  ctx.beginPath();
  hull.forEach(([x, y], i) => {
    const px = cx + (x - cx) * 0.72;
    if (i) ctx.lineTo(px, y);
    else ctx.moveTo(px, y);
  });
  ctx.fill();
  ctx.strokeStyle = 'rgb(84,90,80)';
  for (const { path, width } of mass) {
    ctx.lineWidth = width;
    strokePath(path);
  }
  // the bare brown twig shows through toward the base
  ctx.strokeStyle = 'rgb(74,62,52)';
  ctx.lineWidth = 1.1;
  strokePath(rachis.slice(0, 36));
  ctx.lineWidth = 1.5;
  needles.forEach((n, k) => {
    const v = 128 + k * 24;
    ctx.strokeStyle = `rgb(${Math.round(v * 0.97)},${v},${Math.round(v * 0.76)})`;
    ctx.beginPath();
    for (let i = 0; i < n.length; i += 4) {
      ctx.moveTo(n[i], n[i + 1]);
      ctx.lineTo(n[i + 2], n[i + 3]);
    }
    ctx.stroke();
  });
  ctx.restore();
}

let leafMaterial = null;
function crownMaterial() {
  if (leafMaterial) return leafMaterial;
  const cell = 256;
  const c = makeCanvas(cell * ATLAS_CELLS, cell);
  const ctx = c.getContext('2d');
  const rng = new Rng(2024);
  for (let kind = 0; kind < 3; kind++) {
    ctx.save();
    ctx.translate(kind * cell, 0);
    const count = kind === 1 ? 150 : 120;
    for (let i = 0; i < count; i++) {
      // dense in the middle, ragged toward the edge (never a straight cut)
      const r = Math.pow(rng.next(), 0.55) * cell * 0.43;
      const a = rng.float(0, Math.PI * 2);
      const x = cell / 2 + Math.cos(a) * r;
      const y = cell / 2 + Math.sin(a) * r;
      const size = rng.float(15, 25) * (kind === 1 ? 0.8 : 1);
      const v = Math.floor(rng.float(190, 255));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng.float(0, Math.PI * 2));
      // stem
      ctx.strokeStyle = `rgba(${v * 0.5},${v * 0.45},${v * 0.4},1)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, size * 0.5);
      ctx.lineTo(0, size * 1.1);
      ctx.stroke();
      leafShape(ctx, kind, size);
      ctx.fillStyle = `rgb(${v},${Math.floor(v * rng.float(0.9, 1.0))},${Math.floor(v * rng.float(0.82, 0.95))})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(0,0,0,0.35)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // midrib
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(0, size * 0.4);
      ctx.lineTo(0, -size * 0.7);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  ctx.fillStyle = '#b0b0b0';
  ctx.fillRect(3 * cell, 0, cell, cell);
  // hemlock sprays for the conifers (painted last, so the cells above are unchanged)
  paintSpray(ctx, rng, SPRAY_CELL * cell, cell / 2, cell, { shoots: 30, reach: 0.47, angle: 1.0, needle: 4.4 });
  paintSpray(ctx, rng, SPRAY_CELL * cell + cell / 2, cell / 2, cell, { shoots: 26, reach: 0.34, angle: 0.85, needle: 3.8 });
  const tex = toTexture(c, { repeat: false });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  leafMaterial = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    alphaTest: 0.38,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.8,
  });
  // Keep the outward "crown" normals on both faces of a card; by default
  // three.js flips them for back faces, which turns half the leaves black.
  leafMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
    );
  };
  leafMaterial.customProgramCacheKey = () => 'foliage-no-flip';
  return leafMaterial;
}

/**
 * Leafy crown from a list of spheres {x, y, z, r, sy}. `cells` picks which
 * leaf clusters to use; `dim` darkens the leaf cards (for shaded undersides).
 */
function crownFromSpheres(rng, spheres, cells, { cards = 17, cardSize = [0.2, 0.3], core = 0.58, dim = 1 } = {}) {
  const center = new THREE.Vector3();
  let maxR = 0;
  for (const s of spheres) center.add(new THREE.Vector3(s.x, s.y, s.z));
  center.divideScalar(spheres.length);
  for (const s of spheres) maxR = Math.max(maxR, center.distanceTo(new THREE.Vector3(s.x, s.y, s.z)) + s.r);

  const pos = [];
  const nor = [];
  const uv = [];
  const colr = [];
  const tmp = new THREE.Vector3();
  const pushVert = (p, shade, u, v) => {
    pos.push(p.x, p.y, p.z);
    tmp.copy(p).sub(center).normalize();
    tmp.y = tmp.y * 0.7 + 0.3; // bias up so crowns catch the moon on top
    tmp.normalize();
    nor.push(tmp.x, tmp.y, tmp.z);
    uv.push(u, v);
    colr.push(shade[0], shade[1], shade[2]);
  };

  // dark core
  for (const s of spheres) {
    const g = new THREE.IcosahedronGeometry(s.r * core, 1);
    g.scale(1, s.sy ?? 1, 1);
    g.translate(s.x, s.y, s.z);
    const p = g.attributes.position;
    const shade = [0.38, 0.35, 0.32];
    for (let i = 0; i < p.count; i++) pushVert(tmp.fromBufferAttribute(p, i).clone(), shade, SOLID_UV[0], SOLID_UV[1]);
  }

  // leaf cards
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (const s of spheres) {
    const n = Math.round(cards * (s.r / 0.25) ** 2);
    for (let k = 0; k < n; k++) {
      dir.set(rng.float(-1, 1), rng.float(-0.7, 1), rng.float(-1, 1)).normalize();
      const c = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(dir, s.r * rng.float(0.5, 0.95));
      c.y = s.y + (c.y - s.y) * (s.sy ?? 1);
      // card faces roughly outward, then gets a random twist
      const facing = dir.clone().add(new THREE.Vector3(rng.float(-0.6, 0.6), rng.float(-0.6, 0.6), rng.float(-0.6, 0.6))).normalize();
      right.crossVectors(facing, Math.abs(facing.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      up.crossVectors(right, facing).normalize();
      const roll = rng.float(0, Math.PI * 2);
      const r2 = right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up, Math.sin(roll));
      const u2 = up.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right, -Math.sin(roll));
      const half = rng.float(cardSize[0], cardSize[1]) / 2;
      const depth = c.distanceTo(center) / maxR;
      const b = (0.72 + 0.42 * depth) * rng.float(0.88, 1.12) * dim;
      const warm = rng.float(-0.07, 0.07);
      const shade = [b * (1 + warm), b, b * (1 - warm)];
      const cell = rng.pick(cells);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, bb]) => c.clone().addScaledVector(r2, a * half).addScaledVector(u2, bb * half));
      const uvs = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ].map(([u, v]) => [(cell + 0.02 + u * 0.96) / ATLAS_CELLS, 0.02 + v * 0.96]);
      for (const i of [0, 1, 2, 0, 2, 3]) pushVert(corners[i], shade, uvs[i][0], uvs[i][1]);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  return g;
}

/**
 * Draw a trunk's random layout: its lean, stem points and branches. Kept
 * apart from building it, so a crown drawn from the same rng afterwards can
 * be reached into (see trunkGeometry).
 */
function trunkPlan(rng, height, r0, r1, lean = 0.08, color = BARK, branches = 3, branchStart = 0.55) {
  const pts = [];
  const radii = [];
  const segs = 5;
  const lx = rng.float(-lean, lean);
  const lz = rng.float(-lean, lean);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3(lx * t * t + rng.float(-0.01, 0.01), t * height, lz * t * t + rng.float(-0.01, 0.01)));
    radii.push(r0 + (r1 - r0) * t);
  }
  // flare at the base
  radii[0] *= 1.35;
  const limbs = [];
  for (let b = 0; b < branches; b++) {
    const a = rng.float(0, Math.PI * 2);
    const y0 = height * rng.float(branchStart, 0.92);
    const len = height * rng.float(0.35, 0.55);
    limbs.push({ a, y0, len });
  }
  return { height, r1, lx, lz, pts, radii, limbs, color };
}

/**
 * Build a planned trunk. Given the crown's spheres, the wood grows up into
 * the foliage instead of stopping short under it: the stem carries on into
 * the heart of the crown, each branch sweeps up into the lobe nearest its
 * heading, and lobes left without a branch get one of their own, so every
 * branch end is buried in a dark core and no gap shows under the leaves.
 */
function trunkGeometry({ height, r1, lx, lz, pts, radii, limbs, color }, crown = null) {
  const parts = [];
  // out from the trunk, then up into the crown
  const limb = (s, e, r) => {
    const m = s.clone().lerp(e, 0.45).add(new THREE.Vector3((e.x - s.x) * 0.15, -0.03, (e.z - s.z) * 0.15));
    parts.push(taperedTube([s, m, e], [r, r * 0.7, r * 0.35], 4));
  };
  if (crown) {
    const heart = new THREE.Vector3(crown[0].x, crown[0].y, crown[0].z);
    const top = pts[pts.length - 1];
    parts.push(taperedTube([...pts, top.clone().lerp(heart, 0.5), heart], [...radii, r1 * 0.8, r1 * 0.45], 6));
  } else {
    parts.push(taperedTube(pts, radii, 6));
  }
  const lobes = crown ? crown.filter((c) => Math.hypot(c.x, c.z) > 0.12) : [];
  const heading = (c) => Math.atan2(c.z, c.x);
  const gap = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const reached = new Set();
  for (const { a, y0, len } of limbs) {
    const s = new THREE.Vector3(lx * 0.5, y0, lz * 0.5);
    if (lobes.length) {
      const lobe = lobes.reduce((best, c) => (gap(heading(c), a) < gap(heading(best), a) ? c : best));
      reached.add(lobe);
      limb(s, new THREE.Vector3(lobe.x, lobe.y, lobe.z), r1 * 0.8);
    } else {
      const e = s.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.7, len * 0.7, Math.sin(a) * len * 0.7));
      const m = s.clone().lerp(e, 0.5).add(new THREE.Vector3(0, -0.03, 0));
      parts.push(taperedTube([s, m, e], [r1 * 0.8, r1 * 0.55, r1 * 0.25], 4));
    }
  }
  lobes
    .filter((c) => !reached.has(c))
    .forEach((c, k) => {
      const t = 0.7 + 0.22 * ((k * 0.618) % 1);
      limb(new THREE.Vector3(lx * t * t, t * height, lz * t * t), new THREE.Vector3(c.x, c.y, c.z), r1 * 0.65);
    });
  const g = mergeAll(parts.map((p) => p.toNonIndexed()));
  paint(g, color);
  return g;
}

function trunk(rng, ...plan) {
  return trunkGeometry(trunkPlan(rng, ...plan));
}

/**
 * A low, shaded cluster of leaves around a dark core where the limbs fork
 * into the crown, so the underside meets the wood. Drawn after the crown, so
 * the crown's own leaves are unchanged.
 */
function underCrown(rng, y, r, sy, cells) {
  return crownFromSpheres(rng, [{ x: 0, y, z: 0, r, sy }], cells, { dim: 0.72 });
}

function mapleVariant(rng) {
  const h = rng.float(0.62, 0.8);
  const plan = trunkPlan(rng, h, 0.055, 0.032);
  const cy = h + 0.32;
  const spheres = [{ x: 0, y: cy + 0.08, z: 0, r: 0.34 }];
  const n = rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const rr = rng.float(0.22, 0.32);
    spheres.push({ x: Math.cos(a) * rr, y: cy + rng.float(-0.12, 0.2), z: Math.sin(a) * rr, r: rng.float(0.2, 0.28) });
  }
  spheres.push({ x: rng.float(-0.08, 0.08), y: cy + 0.36, z: rng.float(-0.08, 0.08), r: 0.2 });
  const crown = crownFromSpheres(rng, spheres, [0, 0, 2]);
  return { trunk: trunkGeometry(plan, spheres), crown: mergeAll([crown, underCrown(rng, h + 0.12, 0.24, 0.7, [0, 0, 2])]) };
}

function birchVariant(rng) {
  const h = rng.float(0.95, 1.2);
  const t = trunk(rng, h, 0.03, 0.018, 0.12, '#d8d2c4', 2, 0.6);
  // dark bark marks
  const col = t.attributes.color;
  const pos = t.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const band = Math.sin(y * 61 + Math.sin(y * 13) * 2) > 0.72;
    if (band && y > 0.05) col.setXYZ(i, 0.08, 0.07, 0.06);
  }
  const spheres = [];
  for (let i = 0; i < 5; i++) {
    const y = h * 0.55 + i * 0.16 + rng.float(-0.03, 0.03);
    const r = 0.19 - i * 0.015 + rng.float(-0.02, 0.02);
    spheres.push({ x: rng.float(-0.08, 0.08), y: y + 0.1, z: rng.float(-0.08, 0.08), r, sy: 1.25 });
  }
  return { trunk: t, crown: crownFromSpheres(rng, spheres, [1], { cards: 26, cardSize: [0.18, 0.26], core: 0.42 }) };
}

function oakVariant(rng) {
  const h = rng.float(0.5, 0.62);
  const plan = trunkPlan(rng, h, 0.075, 0.045, 0.05, BARK, 4, 0.5);
  const cy = h + 0.3;
  const spheres = [{ x: 0, y: cy + 0.1, z: 0, r: 0.34, sy: 0.8 }];
  const n = rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const rr = rng.float(0.32, 0.44);
    spheres.push({ x: Math.cos(a) * rr, y: cy + rng.float(-0.08, 0.14), z: Math.sin(a) * rr, r: rng.float(0.2, 0.27), sy: 0.8 });
  }
  const crown = crownFromSpheres(rng, spheres, [2, 2, 0]);
  return { trunk: trunkGeometry(plan, spheres), crown: mergeAll([crown, underCrown(rng, h + 0.12, 0.28, 0.65, [2, 2, 0])]) };
}

/**
 * Hemlock: tiers of soft, drooping boughs around a slim dark core, topped by
 * a spire with a nodding leader. Each bough is a card painted with a flat
 * hemlock spray, running out from the trunk, rising a little, then arching
 * down, with more sprays hanging from its outer part: seen from above the
 * tiers are layered fans, from the side a series of drooping curtains. Like
 * the leafy crowns, normals point out from the trunk and up, so the tiers
 * shade as one soft volume, and the bough tips are lighter to catch the moon.
 */
function pineVariant(rng) {
  // the variant's own seed picks the form: a broad, full tree or a taller, slimmer one
  const slim = rng.next() > 0.6;
  const t = trunk(rng, 0.35, 0.04, 0.03, 0.02, BARK, 0);
  const top = slim ? rng.float(1.56, 1.64) : rng.float(1.4, 1.48);
  const base = 0.32; // height of the lowest boughs
  const spread = slim ? rng.float(0.42, 0.45) : rng.float(0.5, 0.54);
  const levels = slim ? 9 : 8;
  const crest = top - 0.26; // the highest boughs; the spire rises above them
  const envelope = (y) => spread * Math.max(0, (top - y) / (top - base));
  // a lopsided outline, as if crowded from one side
  const p1 = rng.float(0, Math.PI * 2);
  const p2 = rng.float(0, Math.PI * 2);
  const lop = (a) => 1 + 0.1 * Math.sin(a + p1) + 0.06 * Math.sin(2 * a + p2);

  const pos = [];
  const nor = [];
  const uv = [];
  const colr = [];
  const vert = ({ p, n, uv: [u, v], c }) => {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    uv.push(u, v);
    colr.push(c[0], c[1], c[2]);
  };
  const quad = (a, b, c, d) => {
    for (const q of [a, b, c, a, c, d]) vert(q);
  };
  const UP = new THREE.Vector3(0, 1, 0);
  const outUp = (p, fallback, lift = 0.7) => {
    const radial = new THREE.Vector3(p.x, 0, p.z);
    if (radial.lengthSq() < 1e-6) radial.copy(fallback);
    return radial.normalize().multiplyScalar(0.72).addScaledVector(UP, lift);
  };

  /**
   * A card strip along spine(s), s from 0 (base) to 1 (tip), `width` across.
   * `across(s)` gives the horizontal side direction, `shade(s)` the
   * brightness. With `crease`, the strip gets a centre line and its sides sag
   * by `sag`, like a spray bowed over its twig.
   */
  const strip = ({ rows, spine, across, width, sag = 0, crease = true, sprite, flip, reverse = false, shade, warm = 0, roll = 0, lift = 0.7 }) => {
    const cols = crease ? [-1, 0, 1] : [-1, 1];
    const grid = rows.map((s) => {
      const c = spine(s);
      const side = across(s);
      const lat = side.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP, Math.sin(roll));
      return cols.map((k) => {
        const p = c.clone().addScaledVector(lat, (k * width) / 2);
        if (k && crease) p.y -= sag * (0.4 + 0.6 * s);
        const n = outUp(p, side.clone().cross(UP).negate(), lift).addScaledVector(lat, k * 0.25).normalize();
        const b = shade(s) * (k && crease ? 0.9 : 1);
        return { p, n, uv: sprayUV(sprite, flip ? (1 - k) / 2 : (1 + k) / 2, reverse ? 1 - s : s), c: [b * (1 + warm), b, b * (1 - warm)] };
      });
    });
    for (let i = 0; i < rows.length - 1; i++) {
      for (let j = 0; j < cols.length - 1; j++) quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    }
  };

  /**
   * A bough: a flat spray reaching out from the trunk, rising a little and
   * arching down, with sprays hanging from its outer part, so every tier ends
   * in a drooping curtain that reads from the side as well as from above.
   */
  const bough = ({ y, a, r, rise, droop, hang, curl, sprite, bright }) => {
    const dirAt = (s) => new THREE.Vector3(Math.cos(a + curl * s), 0, Math.sin(a + curl * s));
    const sideAt = (s) => {
      const d = dirAt(s);
      return new THREE.Vector3(-d.z, 0, d.x);
    };
    const reach = r * 0.8;
    const spine = (s) => dirAt(s).multiplyScalar(0.03 + (reach - 0.03) * s).setY(y + reach * (rise * s - droop * s * s));
    const width = Math.max(0.08, r * 0.5 * rng.float(0.92, 1.1));
    const warm = rng.float(-0.04, 0.04);
    strip({
      rows: [0, 0.5, 1],
      spine,
      across: sideAt,
      width,
      sag: width * 0.2,
      sprite,
      flip: rng.chance(0.5),
      shade: (s) => bright * (0.55 + 0.7 * s),
      warm,
      roll: rng.float(-0.2, 0.2),
      lift: 0.85,
    });
    // hanging sprays: out and down from part-way along, steepening to `hang`
    // (radians below level) at the tip
    const sprays = r > 0.12 ? 2 : 1;
    for (let k = 0; k < sprays; k++) {
      const at = sprays === 2 ? [0.45, 0.8][k] * rng.float(0.9, 1.1) : rng.float(0.55, 0.75);
      const swing = sprays === 2 ? (k ? 0.4 : -0.4) * rng.float(0.7, 1.2) : rng.float(-0.2, 0.2);
      const d = dirAt(at).applyAxisAngle(UP, swing);
      const len = Math.max(0.09, r * rng.float(0.46, 0.56));
      const pts = [spine(at).addScaledVector(d, -0.02)];
      for (const [f, part] of [[0.35, 0.5], [0.85, 0.5]]) {
        const th = 0.3 + (hang - 0.3) * f;
        pts.push(pts[pts.length - 1].clone().addScaledVector(d, len * part * Math.cos(th)).addScaledVector(UP, -len * part * Math.sin(th)));
      }
      strip({
        rows: [0, 0.5, 1],
        spine: (s) => pts[Math.round(s * 2)],
        across: () => new THREE.Vector3(-d.z, 0, d.x),
        width: len * rng.float(0.62, 0.74),
        crease: false,
        sprite: rng.chance(0.7) ? 0 : 1,
        flip: rng.chance(0.5),
        shade: (s) => bright * (0.75 + 0.8 * s),
        warm,
        roll: rng.float(-0.25, 0.25),
        lift: 0.55,
      });
    }
  };

  // the dark core, so you can't see through: a slim spindle, shaded like the
  // deep inside of the tree, with near-level normals so the sky doesn't pick
  // out its smooth sides
  const coreSegs = 7;
  const corePh = rng.float(0, Math.PI * 2);
  const coreTop = base + (crest - base) * 0.75;
  const coreAt = (y) => (0.28 - 0.1 * ((y - base) / (coreTop - base))) * envelope(y);
  const rings = [0, 0.4, 0.75].map((f) => {
    const y = base - 0.04 + (coreTop - base + 0.04) * f;
    return Array.from({ length: coreSegs }, (_, k) => {
      const ang = corePh + (k / coreSegs) * Math.PI * 2;
      const rr = coreAt(y) * rng.float(0.85, 1.12);
      const p = new THREE.Vector3(Math.cos(ang) * rr, y, Math.sin(ang) * rr);
      const n = new THREE.Vector3(Math.cos(ang), 0.15, Math.sin(ang)).normalize();
      return { p, n, uv: SOLID_UV, c: [0.32, 0.32, 0.32] };
    });
  });
  for (let b = 0; b < rings.length - 1; b++) {
    for (let k = 0; k < coreSegs; k++) {
      const k1 = (k + 1) % coreSegs;
      quad(rings[b][k], rings[b][k1], rings[b + 1][k1], rings[b + 1][k]);
    }
  }
  for (let k = 0; k < coreSegs; k++) {
    const k1 = (k + 1) % coreSegs;
    const mid = corePh + ((k + 0.5) / coreSegs) * Math.PI * 2;
    const n = new THREE.Vector3(Math.cos(mid), 0.15, Math.sin(mid)).normalize();
    vert(rings[2][k]);
    vert(rings[2][k1]);
    vert({ p: new THREE.Vector3(0, coreTop, 0), n, uv: SOLID_UV, c: [0.32, 0.32, 0.32] });
  }

  let phase = rng.float(0, Math.PI * 2);
  for (let i = 0; i < levels; i++) {
    const f = i / (levels - 1);
    // tiers draw closer together toward the top, where the boughs are short
    const y = base + (crest - base) * (1 - (1 - f) ** 1.3) + (i && i < levels - 1 ? rng.float(-0.02, 0.02) : 0);
    const R = envelope(y);
    const width = Math.max(0.08, R * 0.5);
    const count = Math.max(3, Math.min(10, Math.round((2 * Math.PI * 0.62 * R) / (0.8 * width))));
    phase += 2.39996; // golden angle, so tiers don't line up
    for (let j = 0; j < count; j++) {
      if (i < levels - 1 && rng.chance(0.08)) continue; // the odd missing bough
      const a = phase + ((j + rng.float(-0.3, 0.3)) / count) * Math.PI * 2;
      bough({
        y: y + rng.float(-0.025, 0.02),
        a,
        r: R * lop(a) * rng.float(0.84, 1.1) * (rng.chance(0.1) ? 1.22 : 1),
        rise: 0.08 + 0.3 * f + rng.float(-0.04, 0.04),
        droop: (0.4 - 0.2 * f) * rng.float(0.85, 1.15),
        hang: (1.15 - 0.45 * f) * rng.float(0.85, 1.1),
        curl: rng.float(-0.25, 0.25),
        sprite: f > 0.7 || rng.chance(0.25) ? 1 : 0,
        bright: (0.9 + 0.25 * f) * rng.float(0.9, 1.1),
      });
    }
  }

  // the spire: three crossed sprays, upside down so they narrow to a bare
  // twig at the top, bending over into hemlock's nodding leader
  const nodA = rng.float(0, Math.PI * 2);
  const nodDir = new THREE.Vector3(Math.cos(nodA), 0, Math.sin(nodA));
  const nod = rng.float(0.05, 0.08);
  const y0 = crest - 0.14;
  const leaderAt = (s) => nodDir.clone().multiplyScalar(nod * s ** 2.5).setY(y0 + (top - y0) * s - nod * 0.6 * s ** 4);
  for (let k = 0; k < 3; k++) {
    const across = nodDir.clone().applyAxisAngle(UP, Math.PI / 2 + (k * Math.PI) / 3 + rng.float(-0.2, 0.2));
    strip({
      rows: [0, 0.45, 0.8, 1],
      spine: leaderAt,
      across: () => across,
      width: rng.float(0.15, 0.19),
      crease: false,
      sprite: 0,
      flip: rng.chance(0.5),
      reverse: true,
      shade: (s) => 1.0 + 0.2 * s,
      lift: 0.6,
    });
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  return { trunk: t, crown: g };
}

/** Recursively grown gnarled branches (merged into one geometry). */
export function gnarledTree(rng, { height = 0.9, radius = 0.12, limbs = 4, depth = 3, spread = 1.0 } = {}) {
  const parts = [];
  const perches = [];
  const randDir = () => new THREE.Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1));

  const grow = (start, dir, length, r, level) => {
    const segs = level === 0 ? 7 : 5;
    const pts = [start.clone()];
    const radii = [r];
    const d = dir.clone();
    let p = start.clone();
    for (let i = 1; i <= segs; i++) {
      d.addScaledVector(randDir(), level === 0 ? 0.12 : 0.38).normalize();
      if (level > 0) {
        d.y += 0.04 * (level > 1 ? -1 : 1);
        d.normalize();
      }
      p = p.clone().addScaledVector(d, length / segs);
      pts.push(p);
      radii.push(r * (1 - (i / segs) * 0.62));
    }
    parts.push(taperedTube(pts, radii, level === 0 ? 9 : level === 1 ? 6 : 4).toNonIndexed());
    if (level === 1) perches.push(pts[Math.floor(segs * 0.6)].clone());
    if (level >= depth) return;
    const kids = level === 0 ? limbs : rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      const idx = level === 0 ? segs - rng.int(0, 2) : rng.int(Math.floor(segs * 0.45), segs);
      const from = pts[Math.min(idx, segs)];
      const a = level === 0 ? (k / kids) * Math.PI * 2 + rng.float(-0.4, 0.4) : rng.float(0, Math.PI * 2);
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const up = level === 0 ? rng.float(0.25, 0.7) : rng.float(-0.1, 0.6);
      const nd = out.multiplyScalar(spread).add(new THREE.Vector3(0, up, 0)).normalize();
      grow(from, nd, length * (level === 0 ? rng.float(0.85, 1.15) : rng.float(0.5, 0.7)), radii[Math.min(idx, segs)] * 0.72, level + 1);
    }
  };

  grow(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 1, 0), height, radius, 0);
  // roots
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const s = new THREE.Vector3(0, 0.12, 0);
    const m = new THREE.Vector3(Math.cos(a) * radius * 1.4, 0.03, Math.sin(a) * radius * 1.4);
    const e = new THREE.Vector3(Math.cos(a) * radius * 3, -0.04, Math.sin(a) * radius * 3);
    parts.push(taperedTube([s, m, e], [radius * 0.55, radius * 0.4, 0.01], 5).toNonIndexed());
  }
  const g = mergeAll(parts);
  return { geometry: g, perches };
}

// ---------------------------------------------------------------------------

const TYPES = {
  maple: { make: mapleVariant, variants: 3 },
  birch: { make: birchVariant, variants: 2 },
  oak: { make: oakVariant, variants: 2 },
  pine: { make: pineVariant, variants: 2 },
};

function pickType(rng, x, z) {
  const r = rng.next();
  if (z < -4.25) return r < 0.34 ? 'pine' : r < 0.64 ? 'maple' : r < 0.84 ? 'oak' : 'birch';
  if (x < -4.3) return r < 0.6 ? 'maple' : 'oak';
  if (x > 4.3 && z > 3.6) return r < 0.4 ? 'maple' : r < 0.62 ? 'oak' : r < 0.84 ? 'birch' : 'pine';
  return r < 0.38 ? 'maple' : r < 0.62 ? 'birch' : r < 0.84 ? 'oak' : 'pine';
}

export function buildTrees(world) {
  const { layout } = world;
  const rng = new Rng(1819);
  const { hx, hz } = TERRAIN;
  const br = layout.bridge;

  const placements = { maple: [], birch: [], oak: [], pine: [] };
  const dead = [];
  const cell = 0.4;
  for (let z = -hz + 0.5; z < hz - 0.4; z += cell) {
    for (let x = -hx + 0.5; x < hx - 0.4; x += cell) {
      const px = x + rng.float(-0.17, 0.17);
      const pz = z + rng.float(-0.17, 0.17);
      const density = layout.forestDensity(px, pz);
      if (rng.next() > density) continue;
      if (Math.abs(px) > hx - 0.5 || Math.abs(pz) > hz - 0.48) continue;
      if (layout.roadDistance(px, pz, 1) < 0.62) continue;
      // keep the front road open so the chase is visible from the front
      if (pz > 2.0 && pz < 4.6 && px > -3.6 && px < 3.2 && layout.roadDistance(px, pz, 1.5) < 1.25) continue;
      const h = layout.heightAt(px, pz);
      if (h < TERRAIN.base - 0.07) continue;
      if (layout.nearBuilding(px, pz, 0.45)) continue;
      if (layout.inRect(FIELD, px, pz, 0.25)) continue;
      if (layout.inRect(CHURCHYARD, px, pz, 0.15)) continue;
      if (Math.hypot(px - br.x, pz - br.z) < 1.5) continue;
      if (Math.hypot(px - layout.stoneBridge.x, pz - layout.stoneBridge.z) < 1.0) continue;
      if (layout.streamDistance(px, pz, 1) < 0.62) continue;
      if (Math.hypot(px - GNARLED_TREE.x, pz - GNARLED_TREE.z) < 1.1) continue;
      if (CLEARINGS.haystacks.some((hs) => Math.hypot(px - hs.x, pz - hs.z) < 0.5)) continue;
      if (Math.hypot(px - CLEARINGS.frog.x, pz - CLEARINGS.frog.z) < 0.45) continue;
      if (rng.chance(0.04)) {
        dead.push({ x: px, z: pz, y: h, s: rng.float(0.55, 0.8) });
        continue;
      }
      const type = pickType(rng, px, pz);
      const hills = pz < -4.2 ? 1.12 : 1;
      placements[type].push({ x: px, z: pz, y: h, s: rng.float(0.8, 1.2) * hills, variant: rng.int(0, TYPES[type].variants - 1) });
    }
  }
  // a few big shade trees in the village and by the farm
  for (const [x, z, type] of [[-6.15, -0.9, 'maple'], [-7.9, 3.2, 'oak'], [-0.2, -3.05, 'oak'], [-9.0, -1.5, 'maple'], [1.3, -2.7, 'maple']]) {
    placements[type].push({ x, z, y: layout.heightAt(x, z), s: 1.25, variant: 0 });
  }

  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const crownMat = crownMaterial();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  world.treeCrowns = [];

  for (const [type, def] of Object.entries(TYPES)) {
    const list = placements[type];
    for (let v = 0; v < def.variants; v++) {
      const items = list.filter((p) => p.variant === v);
      if (!items.length) continue;
      const geo = def.make(new Rng(v * 31 + type.length * 101));
      const trunks = new THREE.InstancedMesh(geo.trunk, trunkMat, items.length);
      const crowns = new THREE.InstancedMesh(geo.crown, crownMat, items.length);
      const box = new THREE.Box3().setFromBufferAttribute(geo.crown.attributes.position);
      items.forEach((p, i) => {
        e.set(rng.float(-0.05, 0.05), rng.float(0, Math.PI * 2), rng.float(-0.05, 0.05));
        q.setFromEuler(e);
        const sy = p.s * rng.float(0.92, 1.1);
        m4.compose(new THREE.Vector3(p.x, p.y - 0.02, p.z), q, new THREE.Vector3(p.s, sy, p.s));
        trunks.setMatrixAt(i, m4);
        crowns.setMatrixAt(i, m4);
        col.set(rng.pick(PALETTES[type]));
        // a few maples and oaks still hanging on to summer
        if (type !== 'pine' && rng.chance(0.07)) col.set('#6f7a2c');
        crowns.setColorAt(i, col);
        const b = rng.float(0.8, 1.15);
        trunks.setColorAt(i, col.setRGB(b, b, b));
        world.treeCrowns.push({
          x: p.x,
          z: p.z,
          y: p.y + ((box.min.y + box.max.y) / 2) * sy,
          r: ((box.max.x - box.min.x) / 2) * p.s * 0.8,
          color: crowns.instanceColor ? getColor(crowns, i) : null,
          type,
        });
      });
      crowns.receiveShadow = false;
      for (const m of [trunks, crowns]) {
        m.castShadow = true;
        if (m === trunks) m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        world.scene.add(m);
      }
    }
  }

  buildDeadTrees(world, dead, rng);
}

function getColor(inst, i) {
  const c = new THREE.Color();
  inst.getColorAt(i, c);
  return c;
}

function buildDeadTrees(world, dead, rng) {
  const { layout } = world;
  const bark = new THREE.MeshStandardMaterial({ color: 0x3a332d, roughness: 0.95 });
  world.perches = [];

  // Major André's tree: the huge twisted landmark by the road
  const big = gnarledTree(new Rng(1780), { height: 0.95, radius: 0.15, limbs: 5, depth: 3, spread: 1.4 });
  const gm = new THREE.Mesh(big.geometry, bark);
  const gy = layout.heightAt(GNARLED_TREE.x, GNARLED_TREE.z);
  gm.position.set(GNARLED_TREE.x, gy, GNARLED_TREE.z);
  gm.scale.setScalar(1.25);
  gm.rotation.y = 0.6;
  gm.castShadow = true;
  gm.receiveShadow = true;
  world.scene.add(gm);
  gm.updateMatrixWorld(true);
  for (const p of big.perches) world.perches.push(p.clone().applyMatrix4(gm.matrixWorld));

  // smaller dead trees: swamp, churchyard, plus random ones from the woods
  const extras = [
    { x: 1.75, z: -2.3, s: 0.75 },
    { x: 3.75, z: 0.2, s: 0.65 },
    { x: 2.95, z: -3.1, s: 0.55 },
    { x: 8.95, z: 1.45, s: 0.8 },
    { x: 7.45, z: -2.15, s: 0.7 },
    { x: 8.95, z: -2.1, s: 0.6 },
  ].map((d) => ({ ...d, y: Math.max(layout.heightAt(d.x, d.z), WATER_Y - 0.05) }));
  const all = [...extras, ...dead];
  const variants = [0, 1, 2].map((k) => gnarledTree(new Rng(300 + k), { height: 0.75, radius: 0.07, limbs: 3, depth: 2, spread: 0.9 }));
  variants.forEach((v, k) => {
    const items = all.filter((_, i) => i % 3 === k);
    if (!items.length) return;
    const inst = new THREE.InstancedMesh(v.geometry, bark, items.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((d, i) => {
      q.setFromEuler(new THREE.Euler(rng.float(-0.08, 0.08), rng.float(0, Math.PI * 2), rng.float(-0.08, 0.08)));
      m4.compose(new THREE.Vector3(d.x, d.y - 0.03, d.z), q, new THREE.Vector3(d.s * 1.6, d.s * 1.6, d.s * 1.6));
      inst.setMatrixAt(i, m4);
      if (world.perches.length < 8 && v.perches.length) {
        const p = v.perches[0].clone().applyMatrix4(m4);
        world.perches.push(p);
      }
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    world.scene.add(inst);
  });
}
