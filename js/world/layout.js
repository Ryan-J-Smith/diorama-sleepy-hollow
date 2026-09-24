// The master plan of the diorama: the looping road, the brook and pond, where
// buildings stand, and the heightfield everything else sits on.

import * as THREE from 'three';
import { TERRAIN, WATER_Y, ROAD_HALF, smoothstep, lerp, clamp } from '../config.js';
import { perlin2, fbm2 } from '../util/noise.js';

// Travel order of the chase: down the village street, along the front past the
// cornfield, over the covered bridge, up past the church and back through the
// woods at the foot of the hills. Points 2.0..5.6 on the front are colinear so
// the bridge sits on a straight run.
const ROAD_POINTS = [
  [-6.7, -3.3],
  [-7.05, -1.4],
  [-7.0, 0.8],
  [-6.5, 2.55],
  [-5.3, 3.35],
  [-3.5, 3.55],
  [-1.2, 3.52],
  [1.1, 3.45],
  [2.0, 3.415],
  [2.9, 3.38],
  [3.8, 3.345],
  [4.7, 3.31],
  [5.6, 3.275],
  [6.1, 2.8],
  [6.05, 1.4],
  [5.9, -0.5],
  [5.65, -2.35],
  [4.85, -3.5],
  [3.8, -3.86],
  [2.7, -3.86],
  [1.6, -3.86],
  [0.5, -3.86],
  [-2.0, -3.85],
  [-4.3, -3.8],
  [-5.8, -3.65],
];

// The river runs out of a gorge in the hills at the back, under the stone
// bridge on the back road, through the middle of the hollow and under the
// covered bridge before leaving through the front of the case.
const STREAM_POINTS = [
  [2.4, -6.0],
  [2.22, -4.7],
  [2.15, -3.86],
  [2.2, -3.0],
  [2.5, -1.8],
  [3.0, -0.4],
  [3.35, 0.9],
  [3.66, 2.2],
  [3.8, 3.345],
  [3.97, 4.5],
  [4.25, 5.95],
];

export const STREAM_BED = WATER_Y - 0.17;

// Side roads leading out of the case so the hollow feels connected to the
// wider world. The first point is snapped onto the loop to form a junction.
export const SPURS = [
  { id: 'post-road', sign: 'Albany Post Rd', pts: [[6.05, 2.1], [7.1, 2.45], [8.4, 2.55], [9.9, 2.5]] },
  { id: 'tarry-town', sign: 'Tarry Town', pts: [[-6.2, 2.8], [-6.42, 3.9], [-6.5, 4.9], [-6.56, 6.1]] },
];

export const FIELD = { x0: -3.0, x1: 0.95, z0: -1.1, z1: 2.55 };
// The front (west) fence stands on the level ground beside the road; the
// graveyard climbs the hill behind it.
export const CHURCHYARD = { x0: 6.5, x1: 9.3, z0: -2.3, z1: 1.7 };
// A lower hill set further back, so the climb from the road is a long gentle
// slope rather than a bank.
export const CHURCH_HILL = { x: 8.4, z: -0.3, top: 0.95, foot: 2.6, height: 0.62 };
export const GNARLED_TREE = { x: 1.95, z: 4.72 };
export const CLEARINGS = {
  scarecrow: { x: -1.0, z: 0.95 },
  // the frog's stone, beside the cornfield's east wall, back from the road
  frog: { x: 1.27, z: 2.05 },
  haystacks: [
    { x: 0.3, z: -2.2, s: 1.0 },
    { x: 0.78, z: -2.65, s: 0.85 },
    { x: 0.28, z: -2.95, s: 0.72 },
  ],
};

// Building footprints. `face` is the direction the front door looks.
export const BUILDINGS = [
  { id: 'houseA', x: -8.5, z: -2.6, w: 1.25, d: 0.85, face: [1, 0] },
  { id: 'houseB', x: -8.45, z: -0.45, w: 1.1, d: 0.8, face: [1, 0] },
  { id: 'houseC', x: -8.45, z: 1.7, w: 1.2, d: 0.9, face: [1, 0] },
  { id: 'houseD', x: -5.6, z: -1.95, w: 1.1, d: 0.8, face: [-1, 0] },
  { id: 'houseE', x: -5.55, z: 0.3, w: 1.0, d: 0.75, face: [-1, 0] },
  { id: 'houseG', x: -4.4, z: 2.15, w: 1.05, d: 0.75, face: [0, 1] },
  { id: 'cottage', x: -7.65, z: 4.55, w: 0.95, d: 0.75, face: [0, -1] },
  { id: 'tavern', x: -4.95, z: 4.64, w: 1.9, d: 1.0, face: [0, -1] },
  { id: 'houseF', x: -2.2, z: 4.75, w: 1.0, d: 0.75, face: [0, -1] },
  { id: 'farmhouse', x: -3.85, z: -2.45, w: 1.45, d: 0.9, face: [0, 1] },
  { id: 'barn', x: -1.5, z: -2.3, w: 1.8, d: 1.15, face: [0, 1] },
  { id: 'school', x: -2.3, z: -4.95, w: 0.95, d: 0.7, face: [0, 1] },
  { id: 'church', x: 8.4, z: -0.3, w: 1.45, d: 0.95, face: [0, 1] },
];
for (const b of BUILDINGS) b.yaw = Math.atan2(b.face[0], b.face[1]);

/** Spatial hash over a set of 2D sample points for nearest-point queries. */
class PointIndex {
  constructor(xs, zs, cell = 0.5) {
    this.xs = xs;
    this.zs = zs;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < xs.length; i++) {
      const k = this.key(Math.floor(xs[i] / cell), Math.floor(zs[i] / cell));
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    }
  }

  key(cx, cz) {
    return (cx + 1000) * 4096 + (cz + 1000);
  }

  nearest(x, z, maxR) {
    const r = Math.ceil(maxR / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = maxR * maxR;
    let bi = -1;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = this.map.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const i of list) {
          const ex = this.xs[i] - x;
          const ez = this.zs[i] - z;
          const d2 = ex * ex + ez * ez;
          if (d2 < best) {
            best = d2;
            bi = i;
          }
        }
      }
    }
    return { d: bi < 0 ? Infinity : Math.sqrt(best), i: bi };
  }
}

function gauss(dx, dz, r) {
  return Math.exp(-(dx * dx + dz * dz) / (r * r));
}

/** Natural ground before the road, pads and water are cut in. */
function naturalHeight(x, z) {
  // broad rolling swells plus small bumps
  let h = TERRAIN.base + 0.22 * fbm2(x * 0.15 + 3.1, z * 0.15 - 1.7, 3) + 0.06 * fbm2(x * 0.6 + 9, z * 0.6, 3);
  // the Catskill ridge along the back: tall and craggy
  const back = smoothstep(-3.9, -5.6, z);
  const ridge = 1.75 + 0.8 * fbm2(x * 0.3 + 7.7, 2.3, 3) + 0.35 * Math.sin(x * 0.55 + 1.3);
  h += Math.pow(back, 1.3) * ridge;
  // plateau-topped hill for the Old Dutch Church
  const dc = Math.hypot(x - CHURCH_HILL.x, z - CHURCH_HILL.z);
  h += CHURCH_HILL.height * smoothstep(CHURCH_HILL.foot, CHURCH_HILL.top, dc);
  // wooded hill in the front-right corner, the village rising to the left
  // edge, the Van Tassel farm on a gentle rise, a knoll by the river
  h += 0.75 * gauss(x - 8.7, z - 4.8, 1.3);
  h += 0.5 * smoothstep(-7.6, -9.4, x);
  h += 0.22 * gauss(x + 2.8, z + 2.4, 1.8);
  h += 0.32 * gauss(x - 1.55, z + 0.1, 0.8);
  // everything falls away a little toward the front glass
  h -= 0.12 * smoothstep(1.0, 5.5, z);
  // no stray puddles: only the river cuts below the waterline
  return Math.max(h, WATER_Y + 0.1);
}

export class Layout {
  constructor() {
    this._buildRoad();
    this._buildStream();
    this._computeRoadProfile();
    this._buildSpurs();
    this._computeHeights();
  }

  // -------------------------------------------------------------------------
  _buildRoad() {
    const pts = ROAD_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 4000;
    const L = curve.getLength();
    const n = Math.round(L / 0.04);
    this.roadCurve = curve;
    this.roadLength = L;
    this.roadN = n;
    this.roadStep = L / n;
    this.roadX = new Float32Array(n);
    this.roadZ = new Float32Array(n);
    this.roadTX = new Float32Array(n);
    this.roadTZ = new Float32Array(n);
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      const tl = Math.hypot(t.x, t.z) || 1;
      this.roadX[i] = p.x;
      this.roadZ[i] = p.z;
      this.roadTX[i] = t.x / tl;
      this.roadTZ[i] = t.z / tl;
    }
    this.roadIndex = new PointIndex(this.roadX, this.roadZ, 0.5);
  }

  _buildStream() {
    const pts = STREAM_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const L = curve.getLength();
    const n = Math.round(L / 0.04);
    this.streamCurve = curve;
    this.streamX = new Float32Array(n + 1);
    this.streamZ = new Float32Array(n + 1);
    const p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      curve.getPointAt(i / n, p);
      this.streamX[i] = p.x;
      this.streamZ[i] = p.z;
    }
    this.streamIndex = new PointIndex(this.streamX, this.streamZ, 0.5);
  }

  _computeRoadProfile() {
    const n = this.roadN;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = naturalHeight(this.roadX[i], this.roadZ[i]);
    // two passes of a circular box filter (~1.4 units each way)
    let a = raw;
    const W = Math.round(1.4 / this.roadStep);
    for (let pass = 0; pass < 2; pass++) {
      const b = new Float32Array(n);
      let sum = 0;
      for (let k = -W; k <= W; k++) sum += a[(k + n) % n];
      for (let i = 0; i < n; i++) {
        b[i] = sum / (2 * W + 1);
        sum += a[(i + W + 1) % n] - a[(i - W + n) % n];
      }
      a = b;
    }
    this.roadY = a;

    // Bridges: wherever the road crosses the river (twice around the loop).
    const dist = new Float32Array(n);
    for (let i = 0; i < n; i++) dist[i] = this.streamIndex.nearest(this.roadX[i], this.roadZ[i], 1.0).d;
    const crossings = [];
    for (let i = 0; i < n; i++) {
      const a = dist[(i - 1 + n) % n];
      const b = dist[(i + 1) % n];
      if (dist[i] < 0.2 && dist[i] <= a && dist[i] < b) crossings.push(i);
    }
    const make = (bi, halfLen, hump) => {
      const bridgeY = this.roadY[bi];
      const flat = Math.round((halfLen + 0.3) / this.roadStep);
      const ramp = Math.round(0.9 / this.roadStep);
      for (let k = -flat - ramp; k <= flat + ramp; k++) {
        const i = (bi + k + n) % n;
        const ak = Math.abs(k);
        const t = ak <= flat ? 0 : smoothstep(0, 1, (ak - flat) / ramp);
        let y = lerp(bridgeY, this.roadY[i], t);
        // humpbacked stone bridge: the road rises over the arch
        const sk = (k * this.roadStep) / (halfLen + 0.25);
        if (hump && Math.abs(sk) < 1) y += hump * Math.cos((sk * Math.PI) / 2) ** 2;
        this.roadY[i] = y;
      }
      return {
        x: this.roadX[bi],
        z: this.roadZ[bi],
        tx: this.roadTX[bi],
        tz: this.roadTZ[bi],
        y: bridgeY,
        index: bi,
        s: bi * this.roadStep,
        halfLen,
        hump,
      };
    };
    crossings.sort((a, b) => this.roadZ[b] - this.roadZ[a]);
    this.bridge = make(crossings[0], 1.0, 0); // covered bridge, front road
    this.stoneBridge = make(crossings[crossings.length - 1], 0.8, 0.18);
    this.bridges = [this.bridge, this.stoneBridge];
  }

  _buildSpurs() {
    const xs = [];
    const zs = [];
    const ys = [];
    this.spurs = [];
    for (const spur of SPURS) {
      // snap the junction onto the loop
      const [jx, jz] = spur.pts[0];
      const j = this.roadIndex.nearest(jx, jz, 3).i;
      const pts = [new THREE.Vector3(this.roadX[j], 0, this.roadZ[j]), ...spur.pts.slice(1).map(([x, z]) => new THREE.Vector3(x, 0, z))];
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const n = Math.round(curve.getLength() / 0.04);
      const sx = [];
      const sz = [];
      const raw = [];
      const p = new THREE.Vector3();
      for (let i = 0; i <= n; i++) {
        curve.getPointAt(i / n, p);
        sx.push(p.x);
        sz.push(p.z);
        raw.push(naturalHeight(p.x, p.z));
      }
      // smooth along the spur, then ease into the loop's grade at the junction
      const W = 25;
      const sy = raw.map((_, i) => {
        let sum = 0;
        let cnt = 0;
        for (let k = Math.max(0, i - W); k <= Math.min(n, i + W); k++) {
          sum += raw[k];
          cnt++;
        }
        return sum / cnt;
      });
      for (let i = 0; i <= n; i++) sy[i] = lerp(this.roadY[j], sy[i], smoothstep(0, 30, i));
      const tx = [];
      const tz = [];
      for (let i = 0; i <= n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n, i + 1);
        const l = Math.hypot(sx[b] - sx[a], sz[b] - sz[a]) || 1;
        tx.push((sx[b] - sx[a]) / l);
        tz.push((sz[b] - sz[a]) / l);
      }
      this.spurs.push({ ...spur, x: sx, z: sz, y: sy, tx, tz, junction: j });
      xs.push(...sx);
      zs.push(...sz);
      ys.push(...sy);
    }
    this.spurY = Float32Array.from(ys);
    this.spurIndex = new PointIndex(Float32Array.from(xs), Float32Array.from(zs), 0.5);
  }

  /** Ground height after the road has been graded (no pads or water). */
  _gradedHeight(x, z) {
    let h = naturalHeight(x, z);
    const near = this.roadIndex.nearest(x, z, 2.6);
    if (near.i >= 0) {
      // Where the road is cut into rising ground, lay the bank back: the
      // deeper the cut, the longer and gentler the slope, with a wandering
      // edge so it never reads as a straight wall.
      const rise = Math.max(0, h - this.roadY[near.i]);
      const bank = 0.6 + 1.5 * Math.min(1, rise / 0.7) + 0.25 * perlin2(x * 1.6 + 3, z * 1.6);
      const w = 1 - smoothstep(ROAD_HALF + 0.05, ROAD_HALF + 0.05 + bank, near.d);
      const rut = 0.012 * (1 - smoothstep(0, ROAD_HALF, near.d));
      h = lerp(h, this.roadY[near.i] - rut, w);
    }
    const spur = this.spurIndex.nearest(x, z, 1.2);
    if (spur.i >= 0) {
      const w = 1 - smoothstep(ROAD_HALF + 0.05, ROAD_HALF + 0.6, spur.d);
      const rut = 0.012 * (1 - smoothstep(0, ROAD_HALF, spur.d));
      h = lerp(h, this.spurY[spur.i] - rut, w);
    }
    return h;
  }

  _computeHeights() {
    const { hx, hz, segX, segZ } = TERRAIN;
    const NX = segX + 1;
    const NZ = segZ + 1;
    this.NX = NX;
    this.NZ = NZ;
    this.dx = (2 * hx) / segX;
    this.dz = (2 * hz) / segZ;
    const H = new Float32Array(NX * NZ);

    for (const b of BUILDINGS) {
      b.y = this._gradedHeight(b.x, b.z);
      b.cos = Math.cos(b.yaw);
      b.sin = Math.sin(b.yaw);
    }

    for (let iz = 0; iz < NZ; iz++) {
      const z = -hz + iz * this.dz;
      for (let ix = 0; ix < NX; ix++) {
        const x = -hx + ix * this.dx;
        let h = this._gradedHeight(x, z);
        // level pads under buildings
        for (const b of BUILDINGS) {
          const d = this.footprintDistance(b, x, z);
          if (d < 0.7) h = lerp(h, b.y, 1 - smoothstep(0.08, 0.6, d));
        }
        // river: wider valley where it cuts through high ground
        const sd = this.streamIndex.nearest(x, z, 2.0).d;
        if (sd < 2.0) {
          const rise = Math.max(0, h - TERRAIN.base);
          const w = smoothstep(0.26, 0.62 + rise * 0.55, sd + 0.05 * perlin2(x * 2.3, z * 2.3));
          h = lerp(STREAM_BED, h, w);
        }
        H[iz * NX + ix] = h;
      }
    }
    this.heights = H;
  }

  // -------------------------------------------------------------------------
  // Queries

  /** Signed-ish distance from a building footprint (0 inside). */
  footprintDistance(b, x, z) {
    const dx = x - b.x;
    const dz = z - b.z;
    // world -> local (rotate by -yaw)
    const lx = dx * b.cos - dz * b.sin;
    const lz = dx * b.sin + dz * b.cos;
    const ox = Math.max(Math.abs(lx) - b.w / 2, 0);
    const oz = Math.max(Math.abs(lz) - b.d / 2, 0);
    return Math.hypot(ox, oz);
  }

  heightAt(x, z) {
    const fx = clamp((x + TERRAIN.hx) / this.dx, 0, this.NX - 1.001);
    const fz = clamp((z + TERRAIN.hz) / this.dz, 0, this.NZ - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const H = this.heights;
    const i = iz * this.NX + ix;
    const a = H[i] + (H[i + 1] - H[i]) * tx;
    const b = H[i + this.NX] + (H[i + this.NX + 1] - H[i + this.NX]) * tx;
    return a + (b - a) * tz;
  }

  isWater(x, z) {
    return this.heightAt(x, z) < WATER_Y + 0.01;
  }

  /** Distance to the nearest road, loop or side road. */
  roadDistance(x, z, maxR = 3) {
    return Math.min(this.roadIndex.nearest(x, z, maxR).d, this.spurIndex.nearest(x, z, maxR).d);
  }

  streamDistance(x, z, maxR = 3) {
    return this.streamIndex.nearest(x, z, maxR).d;
  }

  nearBuilding(x, z, margin) {
    for (const b of BUILDINGS) if (this.footprintDistance(b, x, z) < margin) return true;
    return false;
  }

  /**
   * Sample the road at arc length s (wraps). Writes into out {x,y,z,tx,tz}.
   */
  roadAt(s, out) {
    const n = this.roadN;
    let f = (s / this.roadStep) % n;
    if (f < 0) f += n;
    const i = Math.floor(f);
    const j = (i + 1) % n;
    const t = f - i;
    out.x = this.roadX[i] + (this.roadX[j] - this.roadX[i]) * t;
    out.z = this.roadZ[i] + (this.roadZ[j] - this.roadZ[i]) * t;
    out.y = this.roadY[i] + (this.roadY[j] - this.roadY[i]) * t;
    let tx = this.roadTX[i] + (this.roadTX[j] - this.roadTX[i]) * t;
    let tz = this.roadTZ[i] + (this.roadTZ[j] - this.roadTZ[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    return out;
  }

  /** 0..1 how wooded a spot should be. */
  forestDensity(x, z) {
    let d = 0.06;
    d = Math.max(d, 0.95 * smoothstep(-3.95, -4.55, z)); // hills
    // woods along the river east of the field, inside the loop (thinning
    // out toward the road below the church hill)
    const pondWoods = smoothstep(0.9, 1.6, x) * (1 - smoothstep(4.4, 5.1, x)) * smoothstep(-3.4, -2.9, z) * (1 - smoothstep(2.2, 2.9, z));
    d = Math.max(d, 0.78 * pondWoods);
    // front-right corner woods (kept clear in front of the road past the
    // covered bridge, where the head is thrown)
    d = Math.max(d, 0.85 * smoothstep(6.7, 7.5, x) * smoothstep(3.6, 4.2, z));
    // along the right edge, but not on the church hill
    d = Math.max(d, 0.6 * smoothstep(8.7, 9.1, x) * (1 - smoothstep(-2.8, -2.2, z) * (1 - smoothstep(2.0, 2.6, z))));
    // behind the village on the left edge
    d = Math.max(d, 0.35 * smoothstep(-8.9, -9.2, x));
    // patchiness
    d *= 0.72 + 0.45 * (0.5 + 0.5 * fbm2(x * 0.5 + 20, z * 0.5 - 4, 2));
    return clamp(d, 0, 1);
  }

  inRect(r, x, z, margin = 0) {
    return x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin;
  }
}
