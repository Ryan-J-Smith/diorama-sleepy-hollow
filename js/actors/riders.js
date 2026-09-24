// Ichabod Crane — lanky, elbows flapping "like a pair of wings", coat-skirts
// fluttering — and the Headless Horseman with his cloak and glowing head.
// Each rider is one smooth skinned mesh; every frame a small pose solver (with
// two-bone IK for arms and legs) places the bones, so joints never come apart.
// Reins run from their hands to the horse's bit; feet sit in the stirrups.

import * as THREE from 'three';
import { SkinBuilder, resampleRings, chainWeights, mixWeights, makeSkinnedMesh } from '../util/geom.js';
import { jackTextures } from '../util/textures.js';
import { pumpkinGeometry } from '../world/props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (hex) => new THREE.Color(hex);
const UP = V(0, 1, 0);
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const sstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Two-bone IK: middle joint for a limb of lengths l1, l2 reaching for target. */
function ik(root, target, l1, l2, pole) {
  const d = new THREE.Vector3().subVectors(target, root);
  let dist = d.length() || 1e-5;
  const dir = d.divideScalar(dist);
  dist = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (p.lengthSq() < 1e-8) p.set(0, 0, 1);
  p.normalize();
  return {
    mid: root.clone().addScaledVector(dir, a).addScaledVector(p, h),
    end: root.clone().addScaledVector(dir, dist),
  };
}

/** Torso frame from its axis and a twist about it: {x: side, y: up, z: forward, q}. */
function frame(up, twist = 0) {
  const y = up.clone().normalize();
  const x = V(Math.cos(twist), 0, -Math.sin(twist));
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
  return { x, y, z, q };
}

/**
 * Flat list of bones (all direct children of the skinned mesh). Each bone's
 * rest pose is a pure translation to its head joint, so a posed bone is
 * simply "put the head here, rotated like this".
 */
class Rig {
  constructor() {
    this.bones = [];
    this.byName = {};
  }

  add(name, head, tail = null) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(head);
    b.userData = { head: head.clone(), dir: tail ? tail.clone().sub(head).normalize() : null };
    this.byName[name] = b;
    this.bones.push(b);
    return this.bones.length - 1;
  }

  i(name) {
    return this.bones.indexOf(this.byName[name]);
  }

  /** Aim a bone from head toward tail (shortest-arc turn from its rest direction). */
  aim(name, head, tail) {
    const b = this.byName[name];
    b.position.copy(head);
    b.quaternion.setFromUnitVectors(b.userData.dir, _w.subVectors(tail, head).normalize());
  }

  /** Place a bone with an explicit rotation relative to its rest pose. */
  place(name, head, q) {
    const b = this.byName[name];
    b.position.copy(head);
    b.quaternion.copy(q);
  }
}

/** Loft rings along a straight axis from a to b; profile rows are [t, w, h, color?]. */
function axisRings(a, b, profile, defaultColor) {
  const d = new THREE.Vector3().subVectors(b, a);
  return profile.map(([t, w, h, c]) => ({ p: a.clone().addScaledVector(d, t).toArray(), w, h, color: c || defaultColor }));
}

/** Loft rings along a polyline of joints; profile rows are [s (0..n-1 along joints), w, h, color?]. */
function chainRings(joints, profile, defaultColor) {
  return profile.map(([s, w, h, c]) => {
    const k = Math.min(joints.length - 2, Math.max(0, Math.floor(s)));
    const f = s - k;
    const p = joints[k].clone().lerp(joints[k + 1], f);
    return { p: p.toArray(), w, h, color: c || defaultColor };
  });
}

/** Reins from the hands to the bit rings, and stirrup leathers and irons. */
class Tack {
  constructor(group, horse, { handsTogether = false } = {}) {
    this.group = group;
    this.horse = horse;
    this.handsTogether = handsTogether;
    const reinMat = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.7 });
    const strap = () => {
      const g = new THREE.CylinderGeometry(0.0026, 0.0026, 1, 5);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, reinMat);
      group.add(m);
      return m;
    };
    this.reins = [0, 1].map(() => [strap(), strap()]);
    this.leathers = [0, 1].map(() => strap());
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x8d8780, roughness: 0.35, metalness: 0.7 });
    this.irons = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0026, 6, 12), ironMat);
      group.add(m);
      return m;
    });
    this.bitLocal = [V(0, 0, 0), V(0, 0, 0)];
  }

  span(mesh, a, b) {
    const d = _w.subVectors(b, a);
    const len = d.length() || 1e-4;
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
    mesh.scale.set(1, len, 1);
  }

  update(hands, feet) {
    this.horse.bits.forEach((bit, i) => {
      bit.getWorldPosition(_w);
      this.bitLocal[i].copy(this.group.worldToLocal(_w));
    });
    [1, -1].forEach((side, i) => {
      const hand = this.handsTogether ? hands[0] : hands[i];
      const bit = this.bitLocal[i];
      const mid = hand.clone().lerp(bit, 0.5);
      mid.y -= 0.016;
      this.span(this.reins[i][0], hand, mid);
      this.span(this.reins[i][1], mid, bit);
      const top = V(side * 0.062, -0.012, -0.004);
      const iron = feet[i].clone().add(V(0, 0.004, -0.004));
      this.span(this.leathers[i], top, iron.clone().add(V(0, 0.012, 0)));
      this.irons[i].position.copy(iron);
    });
  }
}

// ---------------------------------------------------------------------------

const ICH = { upper: 0.075, fore: 0.076, thigh: 0.097, shin: 0.1, torso: 0.165 };

export class Ichabod {
  constructor(horse) {
    this.group = new THREE.Group();
    horse.saddle.add(this.group);
    this.look = 0;
    this.lookTarget = 0;

    const coat = col('#1f2028');
    const waistcoat = col('#4a3f33');
    const white = col('#ece8de');
    const breeches = col('#463f35');
    const stocking = col('#d4ccb8');
    const shoe = col('#141414');
    const skin = col('#e3c09b');
    const hair = col('#6e4a2b');

    const rest = this.pose({});
    this.restPose = rest;
    const rig = new Rig();
    this.rig = rig;
    const T = rig.add('torso', rest.P, rest.S);
    const N = rig.add('neck', rest.S, rest.N);
    const Hd = rig.add('head', rest.H);
    const arms = [0, 1].map((i) => [rig.add(`armU${i}`, rest.sh[i], rest.el[i]), rig.add(`armF${i}`, rest.el[i], rest.hand[i])]);
    const legs = [0, 1].map((i) => [rig.add(`thigh${i}`, rest.hip[i], rest.knee[i]), rig.add(`shin${i}`, rest.knee[i], rest.foot[i]), rig.add(`foot${i}`, rest.foot[i])]);
    const tails = [0, 1].map((i) => [rig.add(`tailA${i}`, rest.tail[i][0], rest.tail[i][1]), rig.add(`tailB${i}`, rest.tail[i][1], rest.tail[i][2])]);

    const sb = new SkinBuilder();

    // torso: narrow, round-shouldered; waistcoat and cravat show at the front
    sb.addLoft(resampleRings(axisRings(rest.P, rest.S, [
      [-0.07, 0.027, 0.021],
      [0, 0.031, 0.024],
      [0.24, 0.026, 0.019],
      [0.52, 0.028, 0.02],
      [0.78, 0.034, 0.022],
      [0.92, 0.034, 0.02],
      [1.0, 0.019, 0.015],
      [1.07, 0.01, 0.009],
    ], coat), 3), {
      segs: 16,
      ref: [0, 0, 1],
      weights: () => [[T, 1]],
      color: (r, i, a) => {
        const t = new THREE.Vector3(...r.p).sub(rest.P).dot(rest.frame.y) / ICH.torso;
        const front = Math.sin(a);
        if (t > 0.86 && front > 0.62) return white;
        if (t > 0.14 && t <= 0.8 && front > 0.72) return waistcoat;
        return coat;
      },
    });
    // coat skirts, open at the front, draped over the saddle
    const down = rest.frame.y.clone().negate();
    sb.addLoft(resampleRings([
      { p: rest.P.clone().addScaledVector(rest.frame.y, 0.028).toArray(), w: 0.029, h: 0.022 },
      { p: rest.P.clone().toArray(), w: 0.041, h: 0.033 },
      { p: rest.P.clone().addScaledVector(down, 0.03).add(V(0, 0, -0.01)).toArray(), w: 0.052, h: 0.046 },
    ], 3), {
      segs: 14,
      ref: [0, 0, 1],
      arc: [Math.PI / 2 + 0.55, Math.PI / 2 + Math.PI * 2 - 0.55],
      weights: () => [[T, 1]],
      color: coat,
    });
    // coat tails streaming out behind
    for (let i = 0; i < 2; i++) {
      const J = rest.tail[i];
      sb.addLoft(resampleRings(chainRings(J, [[0, 0.017, 0.0035], [0.8, 0.022, 0.0035], [1.5, 0.02, 0.003], [2, 0.009, 0.0025]], coat), 3), {
        segs: 6,
        ref: [0, 1, 0],
        weights: (r) => mixWeights([[T, 1]], chainWeights(V(...r.p), J, tails[i], 0.02), sstep(0, 0.02, V(...r.p).distanceTo(J[0]))),
        color: coat,
      });
    }
    // long neck
    sb.addLoft(resampleRings(axisRings(rest.S, rest.N, [[-0.2, 0.011, 0.01], [0.3, 0.0085, 0.0085], [1.1, 0.008, 0.008]], skin), 2), {
      segs: 10,
      ref: [0, 0, 1],
      weights: (r) => mixWeights([[T, 1]], [[N, 1]], sstep(0, 0.02, V(...r.p).distanceTo(rest.S))),
      color: skin,
    });
    // small head, flat on top, huge ears, long snipe nose, green glassy eyes
    const H = rest.H;
    const at = (x, y, z) => V(H.x + x, H.y + y, H.z + z);
    sb.addLoft(resampleRings([
      { p: at(0, -0.027, 0.006).toArray(), w: 0.009, h: 0.011 },
      { p: at(0, -0.016, 0.003).toArray(), w: 0.017, h: 0.02 },
      { p: at(0, 0.002, 0).toArray(), w: 0.021, h: 0.024 },
      { p: at(0, 0.017, -0.002).toArray(), w: 0.02, h: 0.023 },
      { p: at(0, 0.024, -0.002).toArray(), w: 0.016, h: 0.019 },
    ], 3), { segs: 14, ref: [0, 0, 1], weights: () => [[Hd, 1]], color: skin });
    const geo = (g, m, c) => sb.addGeometry(g, [[Hd, 1]], c, m);
    const place = (p, e = [0, 0, 0], s = [1, 1, 1]) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)), V(...s));
    geo(new THREE.ConeGeometry(0.0065, 0.034, 8), place(at(0, -0.004, 0.035), [Math.PI / 2 + 0.28, 0, 0]), skin);
    for (const sx of [-1, 1]) {
      geo(new THREE.SphereGeometry(0.012, 10, 8), place(at(0.022 * sx, 0.001, -0.002), [0, 0, 0], [0.32, 1.15, 0.85]), skin);
      geo(new THREE.SphereGeometry(0.0042, 8, 6), place(at(0.0095 * sx, 0.008, 0.02)), col('#cfe2c2'));
    }
    geo(new THREE.SphereGeometry(0.021, 12, 8), place(at(0, 0.017, -0.006), [0, 0, 0], [1.03, 0.52, 1.08]), hair);
    geo(new THREE.ConeGeometry(0.0055, 0.034, 8), place(at(0, -0.006, -0.03), [Math.PI - 0.55, 0, 0]), hair);
    geo(new THREE.SphereGeometry(0.0065, 8, 6), place(at(0, 0.005, -0.024), [0, 0, 0], [1.7, 0.8, 0.7]), col('#111111'));
    // arms: elbows out, black coat sleeves with white cuffs, bare hands
    for (let i = 0; i < 2; i++) {
      const tip = rest.hand[i].clone().addScaledVector(rest.hand[i].clone().sub(rest.el[i]).normalize(), 0.024);
      const J = [rest.sh[i], rest.el[i], rest.hand[i], tip];
      sb.addLoft(resampleRings(chainRings(J, [
        [-0.15, 0.014, 0.013],
        [0.45, 0.012, 0.012],
        [1.0, 0.0105, 0.0105],
        [1.5, 0.0095, 0.0095],
        [1.84, 0.0108, 0.0108, white],
        [1.97, 0.0086, 0.0086, white],
        [2.25, 0.0095, 0.0085, skin],
        [2.7, 0.0098, 0.009, skin],
        [3, 0.006, 0.006, skin],
      ], coat), 2), {
        segs: 10,
        ref: [0, 0, 1],
        weights: (r) => mixWeights([[T, 1]], chainWeights(V(...r.p), J.slice(0, 3), arms[i], 0.012), sstep(0, 0.02, V(...r.p).distanceTo(rest.sh[i]))),
        color: coat,
      });
    }
    // legs: breeches, pale stockings, buckled shoes
    for (let i = 0; i < 2; i++) {
      const J = [rest.hip[i], rest.knee[i], rest.foot[i]];
      sb.addLoft(resampleRings(chainRings(J, [
        [-0.12, 0.016, 0.017],
        [0.4, 0.016, 0.016],
        [0.85, 0.013, 0.013],
        [1.0, 0.0118, 0.0118],
        [1.08, 0.0112, 0.0112, stocking],
        [1.35, 0.0108, 0.0112, stocking],
        [1.85, 0.0078, 0.0078, stocking],
        [2.0, 0.0072, 0.0072, stocking],
      ], breeches), 2), {
        segs: 10,
        ref: [0, 0, 1],
        weights: (r) => mixWeights([[T, 1]], chainWeights(V(...r.p), J, legs[i].slice(0, 2), 0.012), sstep(0, 0.02, V(...r.p).distanceTo(rest.hip[i]))),
        color: breeches,
      });
      const f = rest.foot[i];
      sb.addLoft(resampleRings([
        { p: [f.x, f.y - 0.004, f.z - 0.013], w: 0.0085, h: 0.007 },
        { p: [f.x, f.y - 0.005, f.z + 0.004], w: 0.0098, h: 0.0072 },
        { p: [f.x, f.y - 0.006, f.z + 0.024], w: 0.008, h: 0.0055 },
      ], 3), { segs: 10, ref: [0, 1, 0], weights: () => [[legs[i][2], 1]], color: shoe });
      sb.addGeometry(new THREE.BoxGeometry(0.009, 0.003, 0.006), [[legs[i][2], 1]], col('#c9a44a'), place(V(f.x, f.y + 0.003, f.z + 0.006)));
    }

    this.mesh = makeSkinnedMesh(sb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), rig.bones, rig.bones);
    this.group.add(this.mesh);
    this.head = rig.byName.head;

    // a small wool hat perched on top
    this.hat = new THREE.Group();
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x3c352b, roughness: 0.95 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.029, 0.004, 18), hatMat);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.02, 16), hatMat);
    crown.position.y = 0.012;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0192, 0.0192, 0.004, 16), new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.8 }));
    band.position.y = 0.004;
    brim.castShadow = crown.castShadow = true;
    this.hat.add(brim, crown, band);
    this.hat.position.set(0, 0.028, 0.001);
    this.hat.rotation.x = -0.16;
    this.head.add(this.hat);

    this.tack = new Tack(this.group, horse);
  }

  lookBack(on) {
    this.lookTarget = on ? 1 : 0;
  }

  /** Joint positions (rider space) for the given pose parameters. */
  pose({ bounce = 0, lean = 0.45, look = 0, flap = 0, foot = [0, 0], tailFlap = [0, 0] }) {
    const P = V(0, 0.02 + bounce, -0.012);
    const fr = frame(V(0, Math.cos(lean), Math.sin(lean)), look * 0.4);
    const S = P.clone().addScaledVector(fr.y, ICH.torso);
    const N = S.clone().add(V(0, 0.042, 0.03));
    const H = N.clone().add(V(0, 0.021, 0.006));
    const sh = [];
    const el = [];
    const hand = [];
    const hip = [];
    const knee = [];
    const ft = [];
    const tail = [];
    [1, -1].forEach((side, i) => {
      const s = S.clone().addScaledVector(fr.x, side * 0.037).addScaledVector(fr.y, -0.012).addScaledVector(fr.z, -0.004);
      const target = V(side * 0.026, 0.058 + 0.012 * flap + bounce, 0.15);
      const arm = ik(s, target, ICH.upper, ICH.fore, V(side, -0.25 + 0.95 * flap, -0.35));
      sh.push(s);
      el.push(arm.mid);
      hand.push(arm.end);
      const h = P.clone().add(V(side * 0.027, 0.004, 0));
      const leg = ik(h, V(side * 0.074, -0.056 + foot[i], 0.044), ICH.thigh, ICH.shin, V(side * 0.5, 0.5, 1));
      hip.push(h);
      knee.push(leg.mid);
      ft.push(leg.end);
      // coat tails stream back and up from the waist
      const root = P.clone().add(V(side * 0.014, 0.03, -0.026));
      const a = 0.95 + tailFlap[i];
      const d1 = V(side * 0.12, -Math.cos(a), -Math.sin(a)).normalize();
      const a2 = a + 0.15 + tailFlap[i] * 0.8;
      const d2 = V(side * 0.14, -Math.cos(a2), -Math.sin(a2)).normalize();
      const mid = root.clone().addScaledVector(d1, 0.06);
      tail.push([root, mid, mid.clone().addScaledVector(d2, 0.058)]);
    });
    return { P, S, N, H, frame: fr, sh, el, hand, hip, knee, foot: ft, tail };
  }

  update(dt, t, gait) {
    const phase = gait * Math.PI * 2;
    this.look += (this.lookTarget - this.look) * Math.min(1, dt * 5);
    const flap = Math.sin(t * 11.5);
    const p = this.pose({
      bounce: 0.012 * Math.max(0, Math.sin(phase + 1.2)),
      lean: 0.45 + 0.07 * Math.sin(phase),
      look: this.look,
      flap,
      foot: [0.01 * Math.sin(phase), 0.01 * Math.sin(phase + 1)],
      tailFlap: [0.25 * Math.sin(t * 17) + 0.12 * Math.sin(t * 6.3), 0.25 * Math.sin(t * 17 + 1.7) + 0.12 * Math.sin(t * 6.3 + 1)],
    });
    const rig = this.rig;
    const rest = this.restPose;
    rig.place('torso', p.P, p.frame.q.clone().multiply(rest.frame.q.clone().invert()));
    rig.aim('neck', p.S, p.N);
    rig.place('head', p.H, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12 - this.look * 0.15, this.look * 2.4 + Math.sin(t * 1.7) * 0.08 * (1 - this.look), this.look * 0.22)));
    for (let i = 0; i < 2; i++) {
      rig.aim(`armU${i}`, p.sh[i], p.el[i]);
      rig.aim(`armF${i}`, p.el[i], p.hand[i]);
      rig.aim(`thigh${i}`, p.hip[i], p.knee[i]);
      rig.aim(`shin${i}`, p.knee[i], p.foot[i]);
      rig.place(`foot${i}`, p.foot[i], new THREE.Quaternion());
      rig.aim(`tailA${i}`, p.tail[i][0], p.tail[i][1]);
      rig.aim(`tailB${i}`, p.tail[i][1], p.tail[i][2]);
    }
    this.tack.update(p.hand, p.foot);
  }
}

// ---------------------------------------------------------------------------

const HM = { upper: 0.1, fore: 0.1, thigh: 0.1, shin: 0.162, torso: 0.2 };

export class Horseman {
  constructor(horse) {
    this.group = new THREE.Group();
    horse.saddle.add(this.group);
    this.flourish = 0; // 0 riding .. 1 risen in the stirrups, head held high
    this.duck = 0; // 1 while passing under the covered bridge's roof

    const coat = col('#1e2029');
    const cloak = col('#121218');
    const leather = col('#0f0e11');
    const breeches = col('#2a2830');
    const glove = col('#141316');
    const brass = col('#9c7c3c');
    const steel = col('#71727a');

    const rest = this.pose({});
    this.restPose = rest;
    const rig = new Rig();
    this.rig = rig;
    const T = rig.add('torso', rest.P, rest.S);
    const arms = [0, 1].map((i) => [rig.add(`armU${i}`, rest.sh[i], rest.el[i]), rig.add(`armF${i}`, rest.el[i], rest.hand[i])]);
    const legs = [0, 1].map((i) => [rig.add(`thigh${i}`, rest.hip[i], rest.knee[i]), rig.add(`shin${i}`, rest.knee[i], rest.foot[i]), rig.add(`foot${i}`, rest.foot[i])]);
    const sb = new SkinBuilder();
    const fr = rest.frame;
    const along = (t) => rest.P.clone().addScaledVector(fr.y, t * HM.torso);

    // broad-chested Hessian coat with a belt and a row of brass buttons
    sb.addLoft(resampleRings(axisRings(rest.P, rest.S, [
      [-0.07, 0.043, 0.03],
      [0, 0.047, 0.033],
      [0.15, 0.045, 0.031, leather],
      [0.2, 0.044, 0.031, leather],
      [0.24, 0.043, 0.03],
      [0.5, 0.054, 0.036],
      [0.76, 0.066, 0.036],
      [0.9, 0.064, 0.032],
      [1.0, 0.036, 0.026],
      [1.05, 0.028, 0.02],
    ], coat), 3), { segs: 18, ref: [0, 0, 1], weights: () => [[T, 1]], color: coat });
    for (let k = 0; k < 5; k++) {
      const p = along(0.3 + k * 0.13).addScaledVector(fr.z, 0.036 + 0.004 * Math.sin((k / 4) * Math.PI));
      sb.addGeometry(new THREE.SphereGeometry(0.0035, 8, 6), [[T, 1]], brass, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
    }
    // coat skirts, open at the front, over the saddle and thighs
    sb.addLoft(resampleRings([
      { p: along(0.16).toArray(), w: 0.046, h: 0.032 },
      { p: along(0).toArray(), w: 0.062, h: 0.048 },
      { p: along(-0.17).add(V(0, 0, -0.012)).toArray(), w: 0.078, h: 0.064 },
    ], 3), {
      segs: 16,
      ref: [0, 0, 1],
      arc: [Math.PI / 2 + 0.45, Math.PI / 2 + Math.PI * 2 - 0.45],
      weights: () => [[T, 1]],
      color: coat,
    });
    // ragged shoulder cape
    sb.addLoft(resampleRings([
      { p: along(1.02).toArray(), w: 0.036, h: 0.028 },
      { p: along(0.84).toArray(), w: 0.078, h: 0.053 },
      { p: along(0.62).toArray(), w: 0.098, h: 0.066 },
    ], 3), {
      segs: 24,
      ref: [0, 0, 1],
      capStart: false,
      capEnd: false,
      weights: () => [[T, 1]],
      color: cloak,
    });
    // a low stand-up collar around nothing at all, and the dark stump inside
    sb.addLoft([
      { p: along(0.97).toArray(), w: 0.035, h: 0.029 },
      { p: along(1.06).addScaledVector(fr.z, -0.004).toArray(), w: 0.043, h: 0.037 },
      { p: along(1.15).addScaledVector(fr.z, -0.012).toArray(), w: 0.053, h: 0.046 },
    ], {
      segs: 18,
      ref: [0, 0, 1],
      // open at the front so it reads as a collar, not a hat
      arc: [Math.PI / 2 + 0.75, Math.PI / 2 + Math.PI * 2 - 0.75],
      weights: () => [[T, 1]],
      color: col('#17181f'),
    });
    const stump = new THREE.CircleGeometry(0.03, 16);
    stump.rotateX(-Math.PI / 2);
    const sq = new THREE.Quaternion().setFromUnitVectors(UP, fr.y);
    const sp = along(1.02);
    sb.addGeometry(stump, [[T, 1]], col('#240909'), new THREE.Matrix4().compose(sp, sq, V(1.1, 1, 0.85)));
    // sabre at his left hip
    const hilt = rest.P.clone().add(V(0.06, 0.04, -0.005));
    const tipDir = V(0.02, -0.62, -0.78).normalize();
    sb.addLoft(resampleRings([
      { p: hilt.toArray(), w: 0.0065, h: 0.004 },
      { p: hilt.clone().addScaledVector(tipDir, 0.2).toArray(), w: 0.006, h: 0.0035 },
      { p: hilt.clone().addScaledVector(tipDir, 0.245).toArray(), w: 0.006, h: 0.0035, color: steel },
    ], 2), { segs: 8, ref: [1, 0, 0], weights: () => [[T, 1]], color: leather });
    sb.addGeometry(new THREE.BoxGeometry(0.004, 0.034, 0.006), [[T, 1]], steel, new THREE.Matrix4().compose(hilt, new THREE.Quaternion().setFromUnitVectors(UP, tipDir), V(1, 1, 1)));
    sb.addGeometry(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 8), [[T, 1]], leather, new THREE.Matrix4().compose(hilt.clone().addScaledVector(tipDir, -0.022), new THREE.Quaternion().setFromUnitVectors(UP, tipDir), V(1, 1, 1)));
    // arms with flared gauntlets
    for (let i = 0; i < 2; i++) {
      const tip = rest.hand[i].clone().addScaledVector(rest.hand[i].clone().sub(rest.el[i]).normalize(), 0.03);
      const J = [rest.sh[i], rest.el[i], rest.hand[i], tip];
      sb.addLoft(resampleRings(chainRings(J, [
        [-0.2, 0.026, 0.024],
        [0.35, 0.022, 0.021],
        [1.0, 0.0185, 0.0185],
        [1.45, 0.017, 0.017],
        [1.62, 0.024, 0.024, glove],
        [1.95, 0.015, 0.015, glove],
        [2.35, 0.016, 0.014, glove],
        [3, 0.011, 0.01, glove],
      ], coat), 2), {
        segs: 12,
        ref: [0, 0, 1],
        weights: (r) => mixWeights([[T, 1]], chainWeights(V(...r.p), J.slice(0, 3), arms[i], 0.015), sstep(0, 0.03, V(...r.p).distanceTo(rest.sh[i]))),
        color: coat,
      });
    }
    // legs: breeches and tall cuffed riding boots
    for (let i = 0; i < 2; i++) {
      const J = [rest.hip[i], rest.knee[i], rest.foot[i]];
      sb.addLoft(resampleRings(chainRings(J, [
        [-0.12, 0.028, 0.029],
        [0.4, 0.026, 0.027],
        [0.78, 0.023, 0.023],
        [0.84, 0.031, 0.031, leather],
        [1.0, 0.025, 0.026, leather],
        [1.35, 0.023, 0.025, leather],
        [1.85, 0.018, 0.019, leather],
        [2.0, 0.017, 0.018, leather],
      ], breeches), 2), {
        segs: 12,
        ref: [0, 0, 1],
        weights: (r) => mixWeights([[T, 1]], chainWeights(V(...r.p), J, legs[i].slice(0, 2), 0.015), sstep(0, 0.025, V(...r.p).distanceTo(rest.hip[i]))),
        color: breeches,
      });
      const f = rest.foot[i];
      sb.addLoft(resampleRings([
        { p: [f.x, f.y - 0.004, f.z - 0.018], w: 0.016, h: 0.013 },
        { p: [f.x, f.y - 0.007, f.z + 0.008], w: 0.016, h: 0.011 },
        { p: [f.x, f.y - 0.009, f.z + 0.036], w: 0.012, h: 0.008 },
      ], 3), { segs: 12, ref: [0, 1, 0], weights: () => [[legs[i][2], 1]], color: leather });
    }

    this.mesh = makeSkinnedMesh(sb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide }), rig.bones, rig.bones);
    this.group.add(this.mesh);

    // the cloak: a cloth grid that falls from the shoulders and streams back
    this.cols = 11;
    this.rows = 16;
    this.cloakGeo = new THREE.PlaneGeometry(1, 1, this.cols - 1, this.rows - 1);
    this.cloak = new THREE.Mesh(this.cloakGeo, new THREE.MeshStandardMaterial({ color: 0x121218, roughness: 0.9, side: THREE.DoubleSide }));
    this.cloak.castShadow = true;
    this.cloak.frustumCulled = false;
    this.group.add(this.cloak);

    // his "head": a fierce jack-o'-lantern with a real light inside
    const { map, emissiveMap } = jackTextures('fierce');
    this.headMat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: new THREE.Color(0xff8a28),
      emissiveIntensity: 3.4,
      roughness: 0.55,
    });
    this.pumpkin = new THREE.Group();
    const body = new THREE.Mesh(pumpkinGeometry(0.06, 24, 14), this.headMat);
    body.castShadow = true;
    this.pumpkin.add(body);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.011, 0.034, 8), new THREE.MeshStandardMaterial({ color: 0x3a3418, roughness: 0.9 }));
    stem.position.y = 0.052;
    stem.rotation.z = 0.3;
    this.pumpkin.add(stem);
    this.light = new THREE.PointLight(0xff8a2a, 1.8, 3.0, 2);
    this.pumpkin.add(this.light);
    this.group.add(this.pumpkin);
    this.lightBase = 1.8;

    this.tack = new Tack(this.group, horse, { handsTogether: true });
  }

  /** Joint positions (rider space) for the given pose parameters. */
  pose({ bounce = 0, lean = 0.1, flourish = 0, duck = 0, bob = 0 }) {
    const f = flourish;
    const k = duck;
    const rise = f * 0.035;
    const P = V(0, 0.022 + bounce + rise, -0.015);
    const fr = frame(V(0, Math.cos(lean), Math.sin(lean)));
    const S = P.clone().addScaledVector(fr.y, HM.torso);
    const sh = [];
    const el = [];
    const hand = [];
    const hip = [];
    const knee = [];
    const ft = [];
    [1, -1].forEach((side, i) => {
      const s = S.clone().addScaledVector(fr.x, side * 0.07).addScaledVector(fr.y, -0.032).addScaledVector(fr.z, -0.004);
      let target;
      let pole;
      if (side < 0) {
        // right hand holds the burning head up where a head should be,
        // higher when he rises in the stirrups, lowered under a roof
        target = s.clone().add(V(-0.03, 0.12 + 0.07 * f - 0.2 * k + bob, 0.07 + 0.03 * f + 0.07 * k));
        pole = V(-1, 0.1, -0.3);
      } else {
        target = V(0.028, 0.085 + bounce, 0.14);
        pole = V(1, -0.6, -0.3);
      }
      const arm = ik(s, target, HM.upper, HM.fore, pole);
      sh.push(s);
      el.push(arm.mid);
      hand.push(arm.end);
      const h = P.clone().add(V(side * 0.042, 0.004, 0));
      const leg = ik(h, V(side * 0.083, -0.15 + rise * 0.4, 0.036), HM.thigh, HM.shin, V(side * 0.4, 0.4, 1));
      hip.push(h);
      knee.push(leg.mid);
      ft.push(leg.end);
    });
    return { P, S, frame: fr, sh, el, hand, hip, knee, foot: ft };
  }

  update(dt, t, gait) {
    const phase = gait * Math.PI * 2;
    const f = this.flourish;
    const p = this.pose({
      bounce: 0.01 * Math.max(0, Math.sin(phase + 1.0)),
      lean: 0.1 + 0.04 * Math.sin(phase) - f * 0.12 + this.duck * 0.25,
      flourish: f,
      duck: this.duck,
      bob: 0.01 * Math.sin(phase + 0.5),
    });
    const rig = this.rig;
    rig.place('torso', p.P, p.frame.q.clone().multiply(this.restPose.frame.q.clone().invert()));
    for (let i = 0; i < 2; i++) {
      rig.aim(`armU${i}`, p.sh[i], p.el[i]);
      rig.aim(`armF${i}`, p.el[i], p.hand[i]);
      rig.aim(`thigh${i}`, p.hip[i], p.knee[i]);
      rig.aim(`shin${i}`, p.knee[i], p.foot[i]);
      rig.place(`foot${i}`, p.foot[i], new THREE.Quaternion());
    }
    this.pumpkin.position.copy(p.hand[1]).add(V(0.004, 0.068, 0.004));
    this.tack.update([p.hand[0]], p.foot);

    // the cloak falls down the back from the shoulders, then streams out behind
    const S = p.S;
    const pos = this.cloakGeo.attributes.position;
    const len = 0.5;
    const seg = len / (this.rows - 1);
    const stream = 0.95 + 0.1 * Math.sin(t * 2.3);
    for (let c = 0; c < this.cols; c++) {
      const u = c / (this.cols - 1) - 0.5;
      let y = S.y - 0.03;
      let z = S.z - 0.045 - 0.018 * (1 - 4 * u * u);
      for (let r = 0; r < this.rows; r++) {
        const v = r / (this.rows - 1);
        if (r > 0) {
          const a = 0.2 + stream * Math.pow(v, 0.9) + 0.12 * Math.sin(t * 10 - v * 7 + u * 3) * v;
          y -= Math.cos(a) * seg;
          z -= Math.sin(a) * seg;
        }
        const x = u * (0.15 + 0.2 * v) + 0.015 * Math.sin(t * 8 + v * 5) * v;
        const billow = 0.035 * (1 - 4 * u * u) * v;
        pos.setXYZ(r * this.cols + c, x, y + billow * 0.4, z + billow);
      }
    }
    pos.needsUpdate = true;
    this.cloakGeo.computeVertexNormals();

    this.pumpkin.rotation.y = 0.25 * Math.sin(t * 2.1);
    this.light.intensity = this.lightBase * (1 + 0.4 * f) * (0.88 + 0.12 * Math.sin(t * 23) * Math.sin(t * 7.3));
    this.headMat.emissiveIntensity = 3.4 * (1 + 0.3 * f);
  }
}
