// Owls that turn their heads to watch the riders pass, and crows circling
// ominously over the cornfield or perched on the scarecrow.

import * as THREE from 'three';
import { mergeAll, paint } from '../util/geom.js';
import { Rng } from '../util/rng.js';
import { BUILDINGS, CLEARINGS } from '../world/layout.js';

const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// ---------------------------------------------------------------------------
// Owls

function makeOwl({ plumage, face, tufts }) {
  const owl = new THREE.Group();
  const body = std(plumage, 0.9);
  const light = std(face, 0.9);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), body);
  torso.scale.set(1, 1.3, 0.92);
  torso.position.y = 0.055;
  torso.castShadow = true;
  owl.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 8), light);
  belly.scale.set(0.9, 1.15, 0.6);
  belly.position.set(0, 0.05, 0.022);
  owl.add(belly);
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8), body);
    wing.scale.set(0.45, 1.25, 0.95);
    wing.position.set(sx * 0.038, 0.052, -0.004);
    owl.add(wing);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 5), body);
  tail.rotation.x = Math.PI + 0.3;
  tail.position.set(0, 0.0, -0.025);
  owl.add(tail);

  const head = new THREE.Group();
  head.position.y = 0.112;
  owl.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), body);
  skull.scale.set(1.12, 0.95, 1);
  head.add(skull);
  const disc = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), light);
  disc.scale.set(1.15, 0.95, 0.4);
  disc.position.set(0, -0.002, 0.022);
  head.add(disc);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x331800, emissive: 0xffa21a, emissiveIntensity: 2.6 });
  const pupilMat = std('#050505', 0.2);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(sx * 0.015, 0.004, 0.034);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0095, 10, 8), eyeMat);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0048, 8, 6), pupilMat);
    pupil.position.z = 0.007;
    eye.add(iris, pupil);
    head.add(eye);
    eyes.push(eye);
    if (tufts) {
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.034, 5), body);
      tuft.position.set(sx * 0.024, 0.032, 0.0);
      tuft.rotation.z = -sx * 0.35;
      head.add(tuft);
    }
  }
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.0055, 0.016, 5), std('#3a3226', 0.5));
  beak.rotation.x = Math.PI / 2 + 0.6;
  beak.position.set(0, -0.009, 0.036);
  head.add(beak);
  return { owl, head, eyes };
}

function buildOwls(world) {
  const { scene, layout } = world;
  const rng = new Rng(31);
  const barn = BUILDINGS.find((b) => b.id === 'barn');
  const spots = [];
  if (world.perches?.length) {
    // the big gnarled tree by the road
    const p = world.perches.reduce((a, b) => (b.y > a.y && b.y < a.y + 0.6 ? b : a), world.perches[0]);
    spots.push({ pos: p, kind: 'horned', yaw: 0.2 });
  }
  if (world.perches?.length > 5) spots.push({ pos: world.perches[world.perches.length - 1], kind: 'horned', yaw: -1.2 });
  spots.push({ pos: new THREE.Vector3(barn.x + 0.72, barn.y + 0.82 + 0.78 + 0.07, barn.z), kind: 'barn', yaw: 0 });

  const owls = spots.map((s) => {
    const o = makeOwl(s.kind === 'barn'
      ? { plumage: '#b58a58', face: '#efe6d4', tufts: false }
      : { plumage: '#5a4a3a', face: '#a8927a', tufts: true });
    o.owl.position.copy(s.pos).add(new THREE.Vector3(0, 0.015, 0));
    o.owl.rotation.y = s.yaw;
    o.owl.scale.setScalar(1.15);
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide });
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
