// Geometry helpers shared by the scene builders.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perlin2 } from './noise.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * Replace UVs with a per-face box projection in world-ish units so tiling
 * textures (siding, stone, shingles) keep a constant scale on any shape.
 * Returns a non-indexed geometry.
 */
export function boxUV(geometry, scale = 1, offset = [0, 0]) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    _n.subVectors(c, b).cross(_v.subVectors(a, b)).normalize();
    const ax = Math.abs(_n.x);
    const ay = Math.abs(_n.y);
    const az = Math.abs(_n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u;
      let v;
      if (ay >= ax && ay >= az) {
        u = p.x;
        v = p.z;
      } else if (ax >= az) {
        u = p.z * Math.sign(_n.x || 1);
        v = p.y;
      } else {
        u = p.x * -Math.sign(_n.z || 1);
        v = p.y;
      }
      uv[(i + k) * 2] = u * scale + offset[0];
      uv[(i + k) * 2 + 1] = v * scale + offset[1];
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Deterministically displace vertices; shared positions move together. */
export function jitter(geometry, amount, seed = 0, freq = 3.1) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = seed * 13.7;
    pos.setXYZ(
      i,
      x + amount * perlin2(x * freq + k, y * freq + z * 0.7 + 1.3),
      y + amount * perlin2(y * freq + k + 5.2, z * freq + x * 0.5 + 7.1),
      z + amount * perlin2(z * freq + k + 9.4, x * freq + y * 0.3 + 3.7),
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Fill a constant vertex color (linear). */
export function paint(geometry, color) {
  const c = new THREE.Color(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

/**
 * Normalize a list of geometries so they can be merged: non-indexed,
 * position/normal/uv (+ color if any has it).
 */
export function mergeAll(geoms, { withColor = null } = {}) {
  const needColor = withColor ?? geoms.some((g) => g.attributes.color);
  const prepared = geoms.map((g0) => {
    let g = g0.index ? g0.toNonIndexed() : g0.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (needColor && !g.attributes.color) paint(g, 0xffffff);
    if (!needColor && g.attributes.color) g.deleteAttribute('color');
    if (g.attributes.color && g.attributes.color.itemSize !== 3) {
      // drop alpha channel
      const src = g.attributes.color;
      const arr = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) {
        arr[i * 3] = src.getX(i);
        arr[i * 3 + 1] = src.getY(i);
        arr[i * 3 + 2] = src.getZ(i);
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }
    g.morphAttributes = {};
    return g;
  });
  return mergeGeometries(prepared, false);
}

/**
 * Collects static meshes and merges them by material to keep draw calls low.
 * Objects flagged `userData.dynamic` (and lights) are left as live objects.
 */
export class StaticBatcher {
  constructor() {
    this.groups = new Map();
  }

  add(geometry, material, matrix, { cast = true, receive = true } = {}) {
    const key = `${material.uuid}:${cast ? 1 : 0}${receive ? 1 : 0}`;
    if (!this.groups.has(key)) this.groups.set(key, { material, cast, receive, geoms: [] });
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    this.groups.get(key).geoms.push(g);
  }

  /** Harvest static meshes from `root`; dynamic parts are re-parented to `liveParent`. */
  addObject(root, liveParent) {
    root.updateWorldMatrix(true, true);
    const statics = [];
    const live = [];
    root.traverse((o) => {
      if (o === root) return;
      if (o.userData.dynamic || o.isLight) {
        live.push(o);
        return;
      }
      if (o.isMesh && !o.isInstancedMesh && !isUnderLive(o, live)) statics.push(o);
    });
    for (const m of statics) {
      if (isUnderLive(m, live)) continue;
      this.add(m.geometry, m.material, m.matrixWorld, {
        cast: m.castShadow,
        receive: m.receiveShadow,
      });
    }
    for (const o of live) {
      if (live.some((p) => p !== o && isAncestor(p, o))) continue;
      liveParent.attach(o);
    }
  }

  build() {
    const group = new THREE.Group();
    group.name = 'static-batch';
    for (const { material, cast, receive, geoms } of this.groups.values()) {
      const merged = mergeAll(geoms, { withColor: !!material.vertexColors });
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.groups.clear();
    return group;
  }
}

function isAncestor(a, b) {
  let p = b.parent;
  while (p) {
    if (p === a) return true;
    p = p.parent;
  }
  return false;
}

function isUnderLive(o, live) {
  return live.some((l) => isAncestor(l, o));
}

/**
 * Tube along `points` whose radius follows `radii` (one per point).
 * Uses parallel-transport frames, so it never twists.
 */
export function taperedTube(points, radii, radialSegments = 6, { capStart = false } = {}) {
  const n = points.length;
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  const normals = [];
  const binormals = [];
  let prev = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(prev)) > 0.9) prev.set(1, 0, 0);
  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    const nrm = prev.clone().sub(t.clone().multiplyScalar(prev.dot(t))).normalize();
    normals.push(nrm);
    binormals.push(new THREE.Vector3().crossVectors(t, nrm).normalize());
    prev = nrm;
  }
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const ring = radialSegments + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= radialSegments; j++) {
      const a = (j / radialSegments) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = ca * normals[i].x + sa * binormals[i].x;
      const ny = ca * normals[i].y + sa * binormals[i].y;
      const nz = ca * normals[i].z + sa * binormals[i].z;
      pos.push(points[i].x + nx * radii[i], points[i].y + ny * radii[i], points[i].z + nz * radii[i]);
      nor.push(nx, ny, nz);
      uv.push(j / radialSegments, i / (n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  if (capStart) {
    const c = pos.length / 3;
    pos.push(points[0].x, points[0].y, points[0].z);
    nor.push(-tangents[0].x, -tangents[0].y, -tangents[0].z);
    uv.push(0.5, 0);
    for (let j = 0; j < radialSegments; j++) idx.push(c, j + 1, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Rectangular molding: sweeps a 2D profile [[outset, y], ...] (bottom to top)
 * around a rectangle of half extents (hw, hd) with mitered corners.
 * UV u runs along each side (world units * uScale); v along the profile.
 */
export function moldingGeometry(profile, hw, hd, uScale = 0.25, creaseDeg = 35) {
  const pos = [];
  const nor = [];
  const uv = [];
  // per-segment 2D normals in (out, y) space
  const segN = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [o0, y0] = profile[i];
    const [o1, y1] = profile[i + 1];
    const dO = o1 - o0;
    const dY = y1 - y0;
    const len = Math.hypot(dO, dY) || 1;
    segN.push([dY / len, -dO / len]);
  }
  const creaseCos = Math.cos((creaseDeg * Math.PI) / 180);
  const vertN = (i, seg) => {
    // normal at profile point i for use in segment `seg`
    const own = segN[seg];
    const otherSeg = i === seg ? seg - 1 : seg + 1;
    if (otherSeg < 0 || otherSeg >= segN.length) return own;
    const other = segN[otherSeg];
    if (own[0] * other[0] + own[1] * other[1] < creaseCos) return own;
    const x = own[0] + other[0];
    const y = own[1] + other[1];
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  let vAcc = [0];
  for (let i = 1; i < profile.length; i++) {
    vAcc.push(vAcc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  }
  vAcc = vAcc.map((v) => v * 1.0);
  // sides: outward direction and along direction
  const sides = [
    { out: [0, 1], along: [1, 0] }, // front (+z)
    { out: [1, 0], along: [0, -1] }, // right (+x)
    { out: [0, -1], along: [-1, 0] }, // back (-z)
    { out: [-1, 0], along: [0, 1] }, // left (-x)
  ];
  for (const s of sides) {
    const halfAlongBase = s.out[0] !== 0 ? hd : hw;
    const outBase = s.out[0] !== 0 ? hw : hd;
    for (let i = 0; i < profile.length - 1; i++) {
      const quad = [];
      for (const pi of [i, i + 1]) {
        const [o, y] = profile[pi];
        const halfAlong = halfAlongBase + o;
        const dist = outBase + o;
        const n2 = vertN(pi, i);
        for (const side of [-1, 1]) {
          const x = s.out[0] * dist + s.along[0] * halfAlong * side;
          const z = s.out[1] * dist + s.along[1] * halfAlong * side;
          quad.push({
            p: [x, y, z],
            n: [s.out[0] * n2[0], n2[1], s.out[1] * n2[0]],
            uv: [(halfAlong * side + 50) * uScale, vAcc[pi] * 0.5],
          });
        }
      }
      // quad: [p_i left, p_i right, p_i+1 left, p_i+1 right]
      const tri = [0, 1, 3, 0, 3, 2];
      for (const t of tri) {
        const q = quad[t];
        pos.push(...q.p);
        nor.push(...q.n);
        uv.push(...q.uv);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  fixWinding(g);
  return g;
}

/** Make triangle winding agree with the stored normals (front faces outward). */
export function fixWinding(g) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const nn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    nn.fromBufferAttribute(nor, i).add(_v.fromBufferAttribute(nor, i + 1)).add(_v.fromBufferAttribute(nor, i + 2));
    if (fn.dot(nn) < 0) {
      for (const attr of [pos, nor, uv]) {
        if (!attr) continue;
        for (let k = 0; k < attr.itemSize; k++) {
          const t = attr.array[(i + 1) * attr.itemSize + k];
          attr.array[(i + 1) * attr.itemSize + k] = attr.array[(i + 2) * attr.itemSize + k];
          attr.array[(i + 2) * attr.itemSize + k] = t;
        }
      }
    }
  }
  return g;
}

/** Lathe-like helper: extrude a closed 2D shape into a prism along z. */
export function prism(shape, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Orient an object so its local +z faces direction (fx, fz). */
export function faceYaw(fx, fz) {
  return Math.atan2(fx, fz);
}

/**
 * Loft elliptical cross-sections along a spine — the basis for the sculpted,
 * faceted horses and riders.
 * rings: [{ p: [x, y, z], w: half-width, h: half-height, dy?: vertical offset of
 * the section's widest point }]. `ref` picks which way is "side": the side axis
 * is ref x tangent (default up, for spines running along z).
 */
export function loft(rings, segs = 8, { ref = [0, 1, 0], capStart = true, capEnd = true } = {}) {
  const n = rings.length;
  const P = rings.map((r) => new THREE.Vector3(...r.p));
  const R = new THREE.Vector3(...ref);
  const pos = [];
  const idx = [];
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const U = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    S.crossVectors(R, T);
    if (S.lengthSq() < 1e-8) S.set(1, 0, 0);
    S.normalize();
    U.crossVectors(T, S).normalize();
    const { w, h } = rings[i];
    for (let k = 0; k < segs; k++) {
      const ang = (k / segs) * Math.PI * 2;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      // slightly flatter on the bottom than the top, like most bodies
      const hh = s > 0 ? h : h * (rings[i].under ?? 1);
      pos.push(
        P[i].x + S.x * w * c + U.x * hh * s,
        P[i].y + S.y * w * c + U.y * hh * s,
        P[i].z + S.z * w * c + U.z * hh * s,
      );
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < segs; k++) {
      const a = i * segs + k;
      const b = i * segs + ((k + 1) % segs);
      const c = (i + 1) * segs + k;
      const d = (i + 1) * segs + ((k + 1) % segs);
      idx.push(a, c, b, b, c, d);
    }
  }
  const cap = (ring, tipOffset, flip) => {
    const center = P[ring].clone();
    const t = new THREE.Vector3().subVectors(P[Math.min(n - 1, ring + 1)], P[Math.max(0, ring - 1)]).normalize();
    center.addScaledVector(t, tipOffset);
    const ci = pos.length / 3;
    pos.push(center.x, center.y, center.z);
    for (let k = 0; k < segs; k++) {
      const a = ring * segs + k;
      const b = ring * segs + ((k + 1) % segs);
      if (flip) idx.push(ci, a, b);
      else idx.push(ci, b, a);
    }
  };
  if (capStart) cap(0, -Math.min(rings[0].w, rings[0].h) * 0.6, false);
  if (capEnd) cap(n - 1, Math.min(rings[n - 1].w, rings[n - 1].h) * 0.6, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Skinned figures (horses and riders)

const _catmull = (a, b, c, d, t) =>
  0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);

/**
 * Catmull-Rom resample of loft key rings so silhouettes come out smooth.
 * Ring fields: p, w, h and optional under/over/sq (numbers) and color (THREE.Color).
 */
export function resampleRings(rings, sub = 3) {
  const n = rings.length;
  if (n < 2 || sub <= 1) return rings.map((r) => ({ ...r }));
  const at = (i) => rings[Math.max(0, Math.min(n - 1, i))];
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const a = at(i - 1);
    const b = at(i);
    const c = at(i + 1);
    const d = at(i + 2);
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const lerpN = (key, def) => (b[key] ?? def) + ((c[key] ?? def) - (b[key] ?? def)) * t;
      const ring = {
        p: [0, 1, 2].map((j) => _catmull(a.p[j], b.p[j], c.p[j], d.p[j], t)),
        w: Math.max(1e-4, _catmull(a.w, b.w, c.w, d.w, t)),
        h: Math.max(1e-4, _catmull(a.h, b.h, c.h, d.h, t)),
        under: lerpN('under', 1),
        over: lerpN('over', 1),
        sq: lerpN('sq', 2),
      };
      if (b.color || c.color) ring.color = (b.color || c.color).clone().lerp(c.color || b.color, t);
      out.push(ring);
    }
  }
  out.push({ ...rings[n - 1] });
  return out;
}

/**
 * Skin weights for a point along a chain of bones. `joints` are the rest
 * positions J0..Jn (Vector3), `bones` the n bone indices between them. Near
 * each joint the weight blends smoothly between neighbouring bones.
 */
export function chainWeights(point, joints, bones, blend = 0.012) {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  const arcs = [0];
  const tmp = new THREE.Vector3();
  const seg = new THREE.Vector3();
  for (let k = 0; k < joints.length - 1; k++) {
    seg.subVectors(joints[k + 1], joints[k]);
    const len = seg.length();
    const t = Math.max(0, Math.min(1, tmp.subVectors(point, joints[k]).dot(seg) / (len * len || 1)));
    const d = tmp.copy(joints[k]).addScaledVector(seg, t).distanceTo(point);
    if (d < best) {
      best = d;
      bestS = acc + t * len;
    }
    acc += len;
    arcs.push(acc);
  }
  const n = bones.length;
  let k = 0;
  while (k < n - 1 && bestS > arcs[k + 1]) k++;
  const sstep = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  if (k < n - 1 && bestS > arcs[k + 1] - blend) {
    const t = sstep(arcs[k + 1] - blend, arcs[k + 1] + blend, bestS);
    return [[bones[k], 1 - t], [bones[k + 1], t]];
  }
  if (k > 0 && bestS < arcs[k] + blend) {
    const t = sstep(arcs[k] - blend, arcs[k] + blend, bestS);
    return [[bones[k - 1], 1 - t], [bones[k], t]];
  }
  return [[bones[k], 1]];
}

/** Mix two weight lists: (1 - t) * a + t * b. */
export function mixWeights(a, b, t) {
  const m = new Map();
  for (const [i, w] of a) m.set(i, (m.get(i) || 0) + w * (1 - t));
  for (const [i, w] of b) m.set(i, (m.get(i) || 0) + w * t);
  return [...m.entries()];
}

/**
 * Accumulates lofted parts and loose geometry into one smooth-shaded,
 * vertex-coloured, skinned BufferGeometry.
 */
export class SkinBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.si = [];
    this.sw = [];
    this.idx = [];
  }

  vertex(x, y, z, color, weights) {
    this.pos.push(x, y, z);
    this.col.push(color.r, color.g, color.b);
    const w = weights
      .filter(([, v]) => v > 1e-4)
      .sort((p, q) => q[1] - p[1])
      .slice(0, 4);
    const sum = w.reduce((s, [, v]) => s + v, 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(w[k] ? w[k][0] : 0);
      this.sw.push(w[k] ? w[k][1] / sum : 0);
    }
    return this.pos.length / 3 - 1;
  }

  /**
   * Loft rings (already resampled if wanted). Options:
   * segs, ref (side axis = ref x tangent), capStart/capEnd, arc: [a0, a1] for an
   * open partial ring (clothing), weights(ring, i) -> [[bone, w]...],
   * color: THREE.Color or (ring, i, angle) -> THREE.Color, shape(ring, i, angle) -> [dx, dy]
   * extra offsets in the ring plane.
   */
  addLoft(rings, { segs = 10, ref = [0, 1, 0], capStart = true, capEnd = true, arc = null, weights, color, shape = null }) {
    const n = rings.length;
    const P = rings.map((r) => new THREE.Vector3(...r.p));
    const R = new THREE.Vector3(...ref);
    const T = new THREE.Vector3();
    const S = new THREE.Vector3();
    const U = new THREE.Vector3();
    const open = !!arc;
    const count = open ? segs + 1 : segs;
    const base = this.pos.length / 3;
    const frames = [];
    for (let i = 0; i < n; i++) {
      T.subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize();
      S.crossVectors(R, T);
      if (S.lengthSq() < 1e-8) S.set(1, 0, 0);
      S.normalize();
      U.crossVectors(T, S).normalize();
      frames.push({ T: T.clone(), S: S.clone(), U: U.clone() });
      const r = rings[i];
      const wts = weights(r, i);
      const sq = r.sq ?? 2;
      for (let k = 0; k < count; k++) {
        const ang = open ? arc[0] + ((arc[1] - arc[0]) * k) / segs : (k / segs) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const cs = Math.sign(c) * Math.pow(Math.abs(c), 2 / sq);
        const ss = Math.sign(s) * Math.pow(Math.abs(s), 2 / sq);
        const hh = s > 0 ? r.h * (r.over ?? 1) : r.h * (r.under ?? 1);
        let dx = r.w * cs;
        let dy = hh * ss;
        if (shape) {
          const [ox, oy] = shape(r, i, ang);
          dx += ox;
          dy += oy;
        }
        const col = typeof color === 'function' ? color(r, i, ang) : r.color || color;
        this.vertex(
          P[i].x + S.x * dx + U.x * dy,
          P[i].y + S.y * dx + U.y * dy,
          P[i].z + S.z * dx + U.z * dy,
          col,
          wts,
        );
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let k = 0; k < (open ? segs : segs); k++) {
        const a = base + i * count + k;
        const b = base + i * count + (open ? k + 1 : (k + 1) % segs);
        const c = base + (i + 1) * count + k;
        const d = base + (i + 1) * count + (open ? k + 1 : (k + 1) % segs);
        this.idx.push(a, c, b, b, c, d);
      }
    }
    if (!open) {
      const cap = (i, dir) => {
        const r = rings[i];
        const center = P[i].clone().addScaledVector(frames[i].T, dir * Math.min(r.w, r.h) * 0.5);
        const col = typeof color === 'function' ? color(r, i, 0) : r.color || color;
        const ci = this.vertex(center.x, center.y, center.z, col, weights(r, i));
        for (let k = 0; k < segs; k++) {
          const a = base + i * count + k;
          const b = base + i * count + ((k + 1) % segs);
          if (dir < 0) this.idx.push(ci, b, a);
          else this.idx.push(ci, a, b);
        }
      };
      if (capStart) cap(0, -1);
      if (capEnd) cap(n - 1, 1);
    }
    return frames;
  }

  /** Add an ordinary geometry (optionally transformed) with fixed weights and colour. */
  addGeometry(geometry, weights, color, matrix = null) {
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position;
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) this.vertex(p.getX(i), p.getY(i), p.getZ(i), color, weights);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/**
 * Wrap a finished SkinBuilder geometry and a flat list of bones (already
 * parented as desired, rest pose applied) into a bound SkinnedMesh.
 */
export function makeSkinnedMesh(geometry, material, rootBones, bones) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  for (const b of rootBones) mesh.add(b);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
