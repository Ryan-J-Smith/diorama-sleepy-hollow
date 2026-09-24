// A galloping horse built as one continuous, smooth-shaded skinned mesh:
// lofted barrel, arched neck and wedge-shaped head, legs with proper joints
// (forearm/knee/cannon/fetlock in front, stifle/hock behind), mane and tail,
// all bent by a skeleton driven with a rotary gallop keyed from Muybridge-style
// poses. Faces +z with hooves on y = 0. Riders sit on `saddle` and take their
// reins from the two `bits`.

import * as THREE from 'three';
import { SkinBuilder, resampleRings, chainWeights, mixWeights, makeSkinnedMesh } from '../util/geom.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (hex) => new THREE.Color(hex);
const sstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Footfall offsets within a stride (left-lead rotary gallop: hind-left,
// hind-right, fore-left, fore-right, then all four gathered in suspension).
const LEG_OFFSETS = { LH: 0.0, RH: 0.1, LF: 0.3, RF: 0.4 };

// Joint rotations (about x, relative to the standing rest pose) through one
// stride of a single leg; u = 0 is the footfall, stance lasts to u = 0.3.
// Positive swings a lower segment backward. [u, upper, middle, cannon, pastern]
const FORE_KEYS = [
  [0.0, -0.32, 0.0, 0.0, -0.1],
  [0.15, 0.04, 0.0, 0.0, -0.42],
  [0.3, 0.42, 0.06, 0.3, -0.05],
  [0.42, 0.36, -0.25, 1.35, 0.95],
  [0.55, 0.02, -0.55, 1.65, 0.75],
  [0.7, -0.36, -0.65, 0.95, 0.3],
  [0.84, -0.5, -0.28, 0.25, 0.02],
  [0.94, -0.4, -0.05, 0.04, -0.06],
];
const HIND_KEYS = [
  [0.0, -0.42, 0.04, -0.08, -0.12],
  [0.15, -0.08, 0.12, -0.24, -0.42],
  [0.3, 0.34, -0.08, 0.26, -0.05],
  [0.42, 0.36, 0.32, -0.32, 0.9],
  [0.55, 0.06, 0.58, -1.1, 0.78],
  [0.7, -0.34, 0.46, -1.0, 0.48],
  [0.84, -0.58, 0.2, -0.45, 0.1],
  [0.94, -0.52, 0.08, -0.16, -0.06],
];

/** Periodic Catmull-Rom through the keys at phase u (0..1). */
function sampleKeys(keys, u) {
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (keys[k][0] <= u) i = k;
  }
  const k0 = keys[(i - 1 + n) % n];
  const k1 = keys[i];
  const k2 = keys[(i + 1) % n];
  const k3 = keys[(i + 2) % n];
  const t1 = k1[0];
  let t2 = k2[0];
  if (t2 <= t1) t2 += 1;
  let uu = u;
  if (uu < t1) uu += 1;
  const f = (uu - t1) / (t2 - t1);
  const out = [];
  for (let j = 1; j < k1.length; j++) {
    const a = k0[j];
    const b = k1[j];
    const c = k2[j];
    const d = k3[j];
    out.push(0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f));
  }
  return out;
}

export class Horse {
  /**
   * @param {object} o
   * @param {string} o.coat body colour
   * @param {string} o.mane mane and tail colour
   * @param {string} [o.blanket] saddle blanket colour
   * @param {number} [o.scale]
   * @param {number} [o.gaunt] 0..1 old plough horse: ewe neck, ribs, hip bones
   * @param {number} [o.eyeGlow] emissive red eyes (the Horseman's steed)
   * @param {number} [o.maneLength] longer, wilder mane and tail
   * @param {number} [o.phase] starting point in the gallop cycle, 0..1
   */
  constructor({ coat, mane, blanket = '#5a2a1e', scale = 1, gaunt = 0, eyeGlow = 0, maneLength = 1, phase = 0 }) {
    this.group = new THREE.Group();
    this.phase = phase;
    const coatC = col(coat);
    const maneC = col(mane);
    const hoofC = col('#1a1512');
    // lower legs and muzzle a shade darker, like a real coat's "points"
    const pointsC = coatC.clone().lerp(col('#2a2622'), 0.45);
    const G = gaunt;

    // --- skeleton (rest positions in horse space) ---------------------------
    const bones = [];
    const bone = (name, pos, parent) => {
      const b = new THREE.Bone();
      b.name = name;
      b.userData.rest = pos.clone();
      const pp = parent ? parent.userData.rest : V(0, 0, 0);
      b.position.copy(pos).sub(pp);
      if (parent) parent.add(b);
      bones.push(b);
      return b;
    };
    const body = bone('body', V(0, 0.29, 0), null);
    const neck1 = bone('neck1', V(0, 0.305, 0.13), body);
    const neck2 = bone('neck2', V(0, 0.388, 0.194), neck1);
    const head = bone('head', V(0, 0.468, 0.232), neck2);
    const tailJ = [V(0, 0.345, -0.198), V(0, 0.322, -0.242), V(0, 0.288, -0.278), V(0, 0.242, -0.3)];
    const tail1 = bone('tail1', tailJ[0], body);
    const tail2 = bone('tail2', tailJ[1], tail1);
    const tail3 = bone('tail3', tailJ[2], tail2);
    const idx = (b) => bones.indexOf(b);

    const legSpecs = {
      LF: { sx: 1, fore: true },
      RF: { sx: -1, fore: true },
      LH: { sx: 1, fore: false },
      RH: { sx: -1, fore: false },
    };
    const foreJ = (sx) => [V(0.045 * sx, 0.322, 0.126), V(0.051 * sx, 0.203, 0.091), V(0.047 * sx, 0.098, 0.097), V(0.047 * sx, 0.036, 0.099), V(0.047 * sx, 0.017, 0.113)];
    const hindJ = (sx) => [V(0.046 * sx, 0.325, -0.132), V(0.058 * sx, 0.215, -0.078), V(0.05 * sx, 0.127, -0.141), V(0.048 * sx, 0.037, -0.134), V(0.048 * sx, 0.017, -0.12)];
    this.legs = {};
    for (const [name, spec] of Object.entries(legSpecs)) {
      const J = spec.fore ? foreJ(spec.sx) : hindJ(spec.sx);
      const b0 = bone(`${name}0`, J[0], body);
      const b1 = bone(`${name}1`, J[1], b0);
      const b2 = bone(`${name}2`, J[2], b1);
      const b3 = bone(`${name}3`, J[3], b2);
      this.legs[name] = { ...spec, J, bones: [b0, b1, b2, b3] };
    }

    // --- surface ------------------------------------------------------------
    const sb = new SkinBuilder();
    const B = idx(body);

    // barrel: rump -> hindquarters -> barrel -> withers -> breast
    const trunkKeys = [
      [-0.204, 0.318, 0.28, 0.015],
      [-0.194, 0.338, 0.262, 0.034],
      [-0.176, 0.352, 0.246, 0.052],
      [-0.145, 0.358, 0.233, 0.063],
      [-0.105, 0.356 - 0.004 * G, 0.223, 0.066],
      [-0.06, 0.35 - 0.008 * G, 0.21 + 0.008 * G, 0.068 * (1 - 0.1 * G)],
      [-0.012, 0.347 - 0.012 * G, 0.2 + 0.004 * G, 0.071 * (1 - 0.1 * G)],
      [0.038, 0.353 - 0.006 * G, 0.197, 0.07 * (1 - 0.08 * G)],
      [0.088, 0.364, 0.203, 0.064],
      [0.132, 0.36, 0.22, 0.055],
      [0.163, 0.336, 0.238, 0.045],
      [0.184, 0.31, 0.255, 0.03],
      [0.194, 0.29, 0.266, 0.014],
    ].map(([z, top, bot, w]) => ({ p: [0, (top + bot) / 2, z], w, h: (top - bot) / 2, sq: 2.25, under: 0.96 }));
    sb.addLoft(resampleRings(trunkKeys, 3), {
      segs: 18,
      weights: () => [[B, 1]],
      color: coatC,
      // an old nag's ribs show along the barrel
      shape: G ? (r, i, a) => {
        const z = r.p[2];
        const ribs = z > -0.06 && z < 0.06 && Math.abs(Math.sin(a)) < 0.6 ? 0.0025 * Math.max(0, Math.sin(z * 260)) : 0;
        return [Math.sign(Math.cos(a)) * ribs, 0];
      } : null,
    });
    if (G) {
      // hip bones (points of the hip) on the old plough horse
      const knob = new THREE.SphereGeometry(0.02, 10, 8);
      for (const sx of [-1, 1]) {
        const m = new THREE.Matrix4().compose(V(0.05 * sx, 0.345, -0.115), new THREE.Quaternion(), V(0.85, 0.6, 1.3));
        sb.addGeometry(knob, [[B, 1]], coatC, m);
      }
    }

    // neck: base buried in the chest, arched crest (ewe neck for the old horse)
    const neckJ = [V(0, 0.29, 0.1), neck1.userData.rest, neck2.userData.rest, head.userData.rest];
    const neckBones = [B, idx(neck1), idx(neck2)];
    const crest = 1.08 - 0.2 * G;
    const neckKeys = [
      { p: [0, 0.296, 0.118], w: 0.05, h: 0.075 },
      { p: [0, 0.333, 0.162], w: 0.047 * (1 - 0.1 * G), h: 0.068, over: crest, under: 1 + 0.1 * G },
      { p: [0, 0.377, 0.19], w: 0.04 * (1 - 0.12 * G), h: 0.057, over: crest, under: 1 + 0.12 * G },
      { p: [0, 0.418, 0.21], w: 0.033 * (1 - 0.1 * G), h: 0.047, over: crest },
      { p: [0, 0.45, 0.223], w: 0.028, h: 0.04 },
      { p: [0, 0.474, 0.232], w: 0.025, h: 0.034 },
    ];
    const neckRings = resampleRings(neckKeys, 3);
    const neckFrames = sb.addLoft(neckRings, {
      segs: 14,
      weights: (r) => chainWeights(V(...r.p), neckJ, neckBones, 0.03),
      color: coatC,
    });

    // head: jowl, flat face, soft muzzle
    const H = idx(head);
    const headKeys = [
      { p: [0, 0.484, 0.221], w: 0.018, h: 0.019 },
      { p: [0, 0.474, 0.239], w: 0.027, h: 0.035, under: 1.25 },
      { p: [0, 0.456, 0.264], w: 0.028, h: 0.033, under: 1.15 },
      { p: [0, 0.437, 0.29], w: 0.023, h: 0.026 },
      { p: [0, 0.419, 0.315], w: 0.019, h: 0.022 },
      { p: [0, 0.404, 0.336], w: 0.018, h: 0.02, color: pointsC },
      { p: [0, 0.395, 0.35], w: 0.019, h: 0.019, color: pointsC },
      { p: [0, 0.39, 0.357], w: 0.012, h: 0.012, color: pointsC },
    ].map((r) => ({ ...r, color: r.color || coatC }));
    sb.addLoft(resampleRings(headKeys, 3), {
      segs: 14,
      weights: (r) => (r.p[2] < 0.235 ? [[H, 0.7], [idx(neck2), 0.3]] : [[H, 1]]),
      color: coatC,
    });
    // ears
    const ear = new THREE.ConeGeometry(0.0085, 0.034, 8);
    ear.translate(0, 0.017, 0);
    for (const sx of [-1, 1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0, -0.22 * sx));
      const m = new THREE.Matrix4().compose(V(0.013 * sx, 0.49, 0.23), q, V(1, 1, 0.6));
      sb.addGeometry(ear, [[H, 1]], coatC, m);
    }

    // mane: locks along the crest falling to the off side, plus a forelock
    const lock = new THREE.ConeGeometry(0.011, 1, 6);
    lock.translate(0, 0.5, 0);
    const lockLen = (0.045 + 0.01 * G) * maneLength;
    const stations = 9;
    for (let k = 0; k < stations; k++) {
      const f = 0.12 + (k / (stations - 1)) * 0.83;
      const ri = Math.min(neckRings.length - 1, Math.round(f * (neckRings.length - 1)));
      const r = neckRings[ri];
      const fr = neckFrames[ri];
      const top = V(...r.p).addScaledVector(fr.U, r.h * (r.over ?? 1) * 0.92);
      const dir = fr.U.clone().multiplyScalar(0.45).add(V(-0.85, 0, 0)).addScaledVector(fr.T, -0.35).normalize();
      const len = lockLen * (0.8 + 0.35 * Math.sin(k * 2.3) ** 2) * (k === stations - 1 ? 0.7 : 1);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
      const m = new THREE.Matrix4().compose(top, q, V(1.1, len, 0.45));
      sb.addGeometry(lock, chainWeights(top, neckJ, neckBones, 0.03), maneC, m);
    }
    for (const sx of [-0.4, 0.4]) {
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(sx * 0.3, -0.3, 1).normalize());
      const m = new THREE.Matrix4().compose(V(sx * 0.006, 0.488, 0.238), q, V(0.9, 0.03 * maneLength, 0.45));
      sb.addGeometry(lock, [[H, 1]], maneC, m);
    }

    // tail: a hair fan that streams out behind
    const tl = 0.85 + 0.25 * maneLength;
    const tailKeys = [
      { p: [0, 0.35, -0.188], w: 0.011, h: 0.012 },
      { p: [0, 0.344, -0.203], w: 0.012, h: 0.013 },
      { p: [0, 0.322, -0.242], w: 0.014, h: 0.018 },
      { p: [0, 0.29, -0.277], w: 0.016, h: 0.021 },
      { p: [0, 0.29 - 0.05 * tl, -0.277 - 0.024 * tl], w: 0.014, h: 0.018 },
      { p: [0, 0.29 - 0.085 * tl, -0.277 - 0.034 * tl], w: 0.008, h: 0.01 },
      { p: [0, 0.29 - 0.105 * tl, -0.277 - 0.038 * tl], w: 0.003, h: 0.004 },
    ];
    const tailBones = [B, idx(tail1), idx(tail2), idx(tail3)];
    const tailJoints = [V(0, 0.35, -0.185), ...tailJ];
    sb.addLoft(resampleRings(tailKeys, 3), {
      segs: 10,
      weights: (r) => chainWeights(V(...r.p), tailJoints, tailBones, 0.02),
      color: maneC,
    });

    // legs
    for (const leg of Object.values(this.legs)) {
      const sx = leg.sx;
      const X = (x) => x * sx;
      const keys = leg.fore
        ? [
          [0.044, 0.342, 0.13, 0.03, 0.05],
          [0.048, 0.282, 0.118, 0.034, 0.054],
          [0.051, 0.238, 0.101, 0.031, 0.046],
          [0.051, 0.203, 0.093, 0.027, 0.04],
          [0.05, 0.174, 0.095, 0.025, 0.033],
          [0.048, 0.136, 0.097, 0.018, 0.024],
          [0.047, 0.108, 0.097, 0.0155, 0.021],
          [0.047, 0.097, 0.097, 0.0165, 0.022],
          [0.047, 0.08, 0.097, 0.0125, 0.017],
          [0.047, 0.052, 0.097, 0.012, 0.016],
          [0.047, 0.036, 0.099, 0.014, 0.02],
          [0.047, 0.026, 0.106, 0.0115, 0.015],
          [0.047, 0.017, 0.113, 0.015, 0.017, true],
          [0.047, 0.007, 0.117, 0.018, 0.02, true],
          [0.047, 0.001, 0.119, 0.019, 0.021, true],
        ]
        : [
          [0.04, 0.334, -0.142, 0.042, 0.072],
          [0.052, 0.287, -0.121, 0.048, 0.07],
          [0.057, 0.246, -0.097, 0.042, 0.058],
          [0.058, 0.215, -0.081, 0.034, 0.046],
          [0.056, 0.19, -0.095, 0.028, 0.04],
          [0.053, 0.155, -0.122, 0.021, 0.032],
          [0.05, 0.127, -0.14, 0.017, 0.029],
          [0.049, 0.105, -0.139, 0.0135, 0.02],
          [0.049, 0.07, -0.136, 0.0125, 0.018],
          [0.048, 0.037, -0.134, 0.014, 0.02],
          [0.048, 0.026, -0.127, 0.0115, 0.015],
          [0.048, 0.017, -0.12, 0.015, 0.017, true],
          [0.048, 0.007, -0.116, 0.018, 0.02, true],
          [0.048, 0.001, -0.114, 0.019, 0.021, true],
        ];
      const rings = keys.map(([x, y, z, w, h, hoof]) => {
        // coat darkens toward the hoof
        const shade = THREE.MathUtils.smoothstep(y, 0.03, 0.16);
        return {
          p: [X(x) * (1 - 0.06 * G), y, z],
          w: w * (1 - 0.08 * G),
          h,
          color: hoof ? hoofC : pointsC.clone().lerp(coatC, shade),
        };
      });
      const legBones = leg.bones.map(idx);
      const top = V(...rings[0].p);
      sb.addLoft(resampleRings(rings, 2), {
        segs: 12,
        ref: [0, 0, 1],
        // the top of the leg is buried in the barrel: keep it riding with the
        // body so it doesn't swing out through the flank
        weights: (r) => mixWeights([[B, 1]], chainWeights(V(...r.p), leg.J, legBones, 0.012), sstep(0.015, 0.075, V(...r.p).distanceTo(top))),
        color: coatC,
      });
    }

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      // the black steed has a glossy coat so moonlight picks out its shape;
      // old Gunpowder's dusty coat is matte (a sheen on his broad barrel read
      // as plastic and made the flanks look flat)
      roughness: eyeGlow ? 0.34 : 0.92,
      metalness: eyeGlow ? 0.02 : 0,
    });
    this.mesh = makeSkinnedMesh(sb.build(), material, [body], bones);
    this.group.add(this.mesh);
    this.bones = { body, neck1, neck2, head, tail: [tail1, tail2, tail3] };
    this.restBodyY = body.position.y;

    // --- rigid extras on bones ----------------------------------------------
    const local = (b, p) => p.clone().sub(b.userData.rest);

    // eyes
    const eyeMat = eyeGlow
      ? new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a10, emissiveIntensity: eyeGlow })
      : new THREE.MeshStandardMaterial({ color: 0x0b0908, roughness: 0.2 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeGlow ? 0.0075 : 0.0062, 10, 8), eyeMat);
      eye.position.copy(local(head, V(0.025 * sx, 0.466, 0.262)));
      head.add(eye);
    }

    // saddle, blanket and girth on the barrel
    const tack = new SkinBuilder();
    const leather = col('#3a2416');
    const dark = col('#22150d');
    const blanketC = col(blanket);
    const pad = new THREE.CylinderGeometry(0.08, 0.08, 0.13, 20, 1, true, -Math.PI * 0.4, Math.PI * 0.8);
    pad.rotateY(Math.PI);
    pad.rotateX(Math.PI / 2);
    pad.scale(0.95 * (1 - 0.08 * G), 1.02, 1);
    pad.translate(0, 0.276 - 0.004 * G, -0.012);
    tack.addGeometry(pad, [[0, 1]], blanketC);
    tack.addLoft(resampleRings([
      { p: [0, 0.37, -0.064], w: 0.026, h: 0.017 },
      { p: [0, 0.366, -0.046], w: 0.044, h: 0.012 },
      { p: [0, 0.359 - 0.01 * G, -0.012], w: 0.047, h: 0.009 },
      { p: [0, 0.363 - 0.006 * G, 0.028], w: 0.037, h: 0.011 },
      { p: [0, 0.377, 0.052], w: 0.021, h: 0.016 },
    ], 3), { segs: 14, weights: () => [[0, 1]], color: leather });
    const flap = new THREE.BoxGeometry(0.004, 0.07, 0.085);
    for (const sx of [-1, 1]) {
      const m = new THREE.Matrix4().compose(V(0.075 * sx * (1 - 0.08 * G), 0.318, -0.01), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.22 * sx)), V(1, 1, 1));
      tack.addGeometry(flap, [[0, 1]], dark, m);
    }
    const girth = new THREE.TorusGeometry(0.079, 0.004, 6, 28);
    girth.scale(0.93 * (1 - 0.08 * G), 1.03, 1);
    girth.translate(0, 0.276, 0.042);
    tack.addGeometry(girth, [[0, 1]], dark);
    const tackGeo = tack.build();
    tackGeo.deleteAttribute('skinIndex');
    tackGeo.deleteAttribute('skinWeight');
    tackGeo.translate(0, -body.userData.rest.y, 0);
    const tackMesh = new THREE.Mesh(tackGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }));
    tackMesh.castShadow = true;
    body.add(tackMesh);

    // bridle: headstall, noseband and bit rings, riding on the head bone
    const bridle = new SkinBuilder();
    const strap = (a, b) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const g = new THREE.CylinderGeometry(0.0022, 0.0022, d.length(), 5);
      const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1));
      bridle.addGeometry(g, [[0, 1]], dark, m);
    };
    this.bits = [];
    for (const sx of [1, -1]) {
      strap(V(0.022 * sx, 0.488, 0.228), V(0.02 * sx, 0.402, 0.33));
      const ring = new THREE.TorusGeometry(0.0065, 0.0018, 6, 12);
      ring.rotateY(Math.PI / 2);
      ring.translate(0.02 * sx, 0.399, 0.337);
      bridle.addGeometry(ring, [[0, 1]], col('#8d8780'));
      const bit = new THREE.Object3D();
      bit.position.copy(local(head, V(0.02 * sx, 0.399, 0.337)));
      head.add(bit);
      this.bits.push(bit);
    }
    const nose = new THREE.TorusGeometry(0.023, 0.0024, 6, 20);
    nose.rotateX(Math.PI / 2 - 0.62);
    nose.scale(0.95, 1.1, 1);
    nose.translate(0, 0.413, 0.318);
    bridle.addGeometry(nose, [[0, 1]], dark);
    const brow = new THREE.TorusGeometry(0.024, 0.002, 6, 20, Math.PI);
    brow.rotateX(-Math.PI / 2 - 0.4);
    brow.translate(0, 0.482, 0.238);
    bridle.addGeometry(brow, [[0, 1]], dark);
    const bridleGeo = bridle.build();
    bridleGeo.deleteAttribute('skinIndex');
    bridleGeo.deleteAttribute('skinWeight');
    bridleGeo.translate(...local(head, V(0, 0, 0)).toArray());
    const bridleMesh = new THREE.Mesh(bridleGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }));
    head.add(bridleMesh);

    // where riders sit
    this.saddle = new THREE.Object3D();
    this.saddle.position.copy(local(body, V(0, 0.375, -0.014)));
    body.add(this.saddle);

    this.group.scale.setScalar(scale);
    this.scale = scale;
    this.stride = 0.8 * scale; // distance covered per gallop stride
  }

  /** Advance the gallop by the distance travelled this frame. */
  update(dt, distance, t) {
    this.phase = (this.phase + distance / this.stride) % 1;
    const p = this.phase;
    const TAU = Math.PI * 2;
    const g = distance > 1e-6 ? 1 : 0;

    for (const [name, leg] of Object.entries(this.legs)) {
      const u = (p - LEG_OFFSETS[name] + 1) % 1;
      const a = sampleKeys(leg.fore ? FORE_KEYS : HIND_KEYS, u);
      leg.bones.forEach((b, i) => {
        b.rotation.x = g * a[i];
      });
    }

    const { body, neck1, neck2, head, tail } = this.bones;
    // lowest as the forehand lands, highest in the gathered suspension
    body.position.y = this.restBodyY + g * (0.012 * Math.cos(TAU * (p - 0.85)) + 0.004);
    // nose up while the hind legs drive, nose down as the fore legs land
    body.rotation.x = g * -0.06 * Math.cos(TAU * (p - 0.18));
    // the head and neck swing against the body's rocking
    const nod = Math.cos(TAU * (p - 0.6));
    neck1.rotation.x = g * (0.06 + 0.08 * nod);
    neck2.rotation.x = g * (0.04 * nod);
    head.rotation.x = g * (0.12 - 0.1 * nod);

    // tail streams out behind at speed, rippling
    tail[0].rotation.x = g * (0.62 + 0.08 * Math.sin(TAU * p + 1.0)) + (1 - g) * 0.05;
    tail[1].rotation.x = g * (0.28 + 0.14 * Math.sin(t * 9.0)) + 0.02;
    tail[2].rotation.x = g * (0.22 + 0.2 * Math.sin(t * 9.0 - 1.3));
    tail[0].rotation.z = 0.06 * Math.sin(t * 3.1);
    tail[1].rotation.z = 0.1 * Math.sin(t * 5.3 - 0.7);
    tail[2].rotation.z = 0.14 * Math.sin(t * 5.3 - 1.6);
  }
}
