// Autumn woods: instanced maples, birches, oaks and hemlocks in fall colors,
// plus gnarled leafless trees — including the great twisted tree by the road
// where the story says Major André was taken.

import * as THREE from 'three';
import { TERRAIN, WATER_Y } from '../config.js';
import { taperedTube, jitter, paint, mergeAll } from '../util/geom.js';
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

const ATLAS_CELLS = 4; // 0 maple, 1 round (birch), 2 lobed (oak), 3 solid
const SOLID_UV = [(3 + 0.5) / ATLAS_CELLS, 0.5];

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
 * leaf clusters to use.
 */
function crownFromSpheres(rng, spheres, cells, { cards = 17, cardSize = [0.2, 0.3], core = 0.58 } = {}) {
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
      const b = (0.72 + 0.42 * depth) * rng.float(0.88, 1.12);
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

function trunk(rng, height, r0, r1, lean = 0.08, color = BARK, branches = 3, branchStart = 0.55) {
  const parts = [];
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
  parts.push(taperedTube(pts, radii, 6));
  for (let b = 0; b < branches; b++) {
    const a = rng.float(0, Math.PI * 2);
    const y0 = height * rng.float(branchStart, 0.92);
    const len = height * rng.float(0.35, 0.55);
    const s = new THREE.Vector3(lx * 0.5, y0, lz * 0.5);
    const e = s.clone().add(new THREE.Vector3(Math.cos(a) * len * 0.7, len * 0.7, Math.sin(a) * len * 0.7));
    const m = s.clone().lerp(e, 0.5).add(new THREE.Vector3(0, -0.03, 0));
    parts.push(taperedTube([s, m, e], [r1 * 0.8, r1 * 0.55, r1 * 0.25], 4));
  }
  const g = mergeAll(parts.map((p) => p.toNonIndexed()));
  paint(g, color);
  return g;
}

function mapleVariant(rng) {
  const h = rng.float(0.62, 0.8);
  const t = trunk(rng, h, 0.055, 0.032);
  const cy = h + 0.32;
  const spheres = [{ x: 0, y: cy + 0.08, z: 0, r: 0.34 }];
  const n = rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const rr = rng.float(0.22, 0.32);
    spheres.push({ x: Math.cos(a) * rr, y: cy + rng.float(-0.12, 0.2), z: Math.sin(a) * rr, r: rng.float(0.2, 0.28) });
  }
  spheres.push({ x: rng.float(-0.08, 0.08), y: cy + 0.36, z: rng.float(-0.08, 0.08), r: 0.2 });
  return { trunk: t, crown: crownFromSpheres(rng, spheres, [0, 0, 2]) };
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
  const t = trunk(rng, h, 0.075, 0.045, 0.05, BARK, 4, 0.5);
  const cy = h + 0.3;
  const spheres = [{ x: 0, y: cy + 0.1, z: 0, r: 0.34, sy: 0.8 }];
  const n = rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const rr = rng.float(0.32, 0.44);
    spheres.push({ x: Math.cos(a) * rr, y: cy + rng.float(-0.08, 0.14), z: Math.sin(a) * rr, r: rng.float(0.2, 0.27), sy: 0.8 });
  }
  return { trunk: t, crown: crownFromSpheres(rng, spheres, [2, 2, 0]) };
}

function pineVariant(rng) {
  const tiers = rng.int(4, 5);
  const t = trunk(rng, 0.35, 0.04, 0.03, 0.02, BARK, 0);
  const cones = [];
  let y = 0.25;
  let r = rng.float(0.42, 0.5);
  for (let i = 0; i < tiers; i++) {
    const h = 0.55 - i * 0.05;
    const g = new THREE.ConeGeometry(r, h, 16, 2, true);
    // jagged, bough-tipped skirt instead of a smooth cone
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const py = p.getY(k);
      if (py < -h / 2 + 1e-4 || Math.abs(py) < 1e-4) {
        const a = Math.atan2(p.getZ(k), p.getX(k));
        const seg = Math.round((a / (Math.PI * 2)) * 16);
        const f = seg % 2 ? 0.7 : 1.05;
        p.setX(k, p.getX(k) * f);
        p.setZ(k, p.getZ(k) * f);
        if (py < -h / 2 + 1e-4 && seg % 2 === 0) p.setY(k, py - 0.05);
      }
    }
    g.translate(0, y + h / 2, 0);
    jitter(g, 0.02, rng.float(0, 50), 6);
    const shade = rng.float(0.85, 1.1);
    paint(g, new THREE.Color(shade, shade, shade));
    const ng = g.toNonIndexed();
    ng.computeVertexNormals();
    const uvA = ng.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, SOLID_UV[0], SOLID_UV[1]);
    cones.push(ng);
    y += h * 0.52;
    r *= 0.74;
  }
  return { trunk: t, crown: mergeAll(cones) };
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
