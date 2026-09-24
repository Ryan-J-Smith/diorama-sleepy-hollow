// The Old Dutch Church on its knoll, with an open belfry and weathervane, and
// the churchyard where the Hessian trooper is said to be buried.

import * as THREE from 'three';
import { BUILDINGS, CHURCHYARD } from './layout.js';
import { makeBuilding } from './buildings.js';
import { registerWindowLife } from './village.js';
import { makeLampPost, groundGlow } from './props.js';
import { plain, IRON } from './kit.js';
import { mergeAll } from '../util/geom.js';
import { Rng } from '../util/rng.js';

export function buildChurch(world) {
  const { layout, batcher } = world;
  const b = BUILDINGS.find((x) => x.id === 'church');
  const house = makeBuilding({
    w: b.w,
    d: b.d,
    roof: 'gambrel',
    wall: 'stone',
    wallColor: '#b4ab9b',
    wallScale: 1.5,
    wallH: 0.82,
    roofH: 0.66,
    roofColor: '#3a3532',
    trimColor: '#ece6d6',
    door: 'left',
    chimneys: [],
    frontWindows: 3,
    sideWindows: 1,
    litChance: 0.55,
    seed: 99,
  });
  const g = house.group;
  g.position.set(b.x, b.y, b.z);
  g.rotation.y = b.yaw;

  // --- belfry over the entrance gable -------------------------------------
  const white = plain('#e8e2d4', { roughness: 0.8 });
  const dark = plain('#2c2826', { roughness: 0.7 });
  const peak = house.chain.reduce((a, c) => (c[1] > a[1] ? c : a))[1];
  const belfry = new THREE.Group();
  belfry.position.set(-b.w / 2 + 0.24, peak - 0.02, 0);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), white);
  base.position.y = 0.1;
  base.castShadow = true;
  belfry.add(base);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 8), white);
  deck.position.y = 0.215;
  belfry.add(deck);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.24, 0.025), white);
    post.position.set(Math.cos(a) * 0.15, 0.35, Math.sin(a) * 0.15);
    post.castShadow = true;
    belfry.add(post);
  }
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.1, 12, 1, true), plain('#5a4524', { metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
  bell.position.y = 0.36;
  belfry.add(bell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.21, 0.08, 8), dark);
  cap.position.y = 0.51;
  belfry.add(cap);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.52, 8), dark);
  spire.position.y = 0.81;
  spire.castShadow = true;
  belfry.add(spire);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 6), world.materials.brass);
  ball.position.y = 1.09;
  belfry.add(ball);
  // weathervane: a little banner that turns with the wind
  const vaneMount = new THREE.Group();
  vaneMount.position.y = 1.1;
  vaneMount.userData.dynamic = true;
  const vane = new THREE.Group();
  vaneMount.add(vane);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), IRON());
  rod.position.y = 0.1;
  vane.add(rod);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.14, 0.02);
  flagShape.lineTo(0.11, 0.045);
  flagShape.lineTo(0.14, 0.07);
  flagShape.lineTo(0, 0.07);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), plain('#2a2522', { metalness: 0.5, side: THREE.DoubleSide }));
  flag.position.y = 0.11;
  vane.add(flag);
  belfry.add(vaneMount);
  world.addUpdater((dt, t) => {
    vane.rotation.y = 1.2 + 0.35 * Math.sin(t * 0.21) + 0.12 * Math.sin(t * 0.83);
  });
  g.add(belfry);

  batcher.addObject(g, world.live);
  registerWindowLife(world, [{ id: 'church', materials: house.materials, next: 20 }]);

  buildGraveyard(world, b);

  // gate lantern
  const gateZ = b.z;
  const gx = CHURCHYARD.x0 + 0.02;
  for (const side of [-1, 1]) {
    const lamp = makeLampPost(world, { light: side > 0, intensity: 1.0, distance: 2.4 });
    const z = gateZ + side * 0.28;
    lamp.position.set(gx, layout.heightAt(gx, z), z);
    lamp.scale.setScalar(0.85);
    lamp.updateMatrixWorld(true);
    batcher.addObject(lamp, world.live);
  }
  groundGlow(world, gx + 0.1, gateZ, 0.7, 0xff9a40, 0.3);
}

// ---------------------------------------------------------------------------

function slabGeometry() {
  const s = new THREE.Shape();
  const w = 0.055;
  const h = 0.13;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, h);
  s.absarc(0, h, w, 0, Math.PI, false);
  s.lineTo(-w, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 });
  g.translate(0, -0.03, -0.011);
  return g;
}

function crossGeometry() {
  const a = new THREE.BoxGeometry(0.028, 0.2, 0.024);
  a.translate(0, 0.07, 0);
  const b = new THREE.BoxGeometry(0.11, 0.026, 0.024);
  b.translate(0, 0.12, 0);
  return mergeAll([a, b]);
}

function obeliskGeometry() {
  const shaft = new THREE.CylinderGeometry(0.022, 0.034, 0.24, 4);
  shaft.rotateY(Math.PI / 4);
  shaft.translate(0, 0.12, 0);
  const tip = new THREE.ConeGeometry(0.03, 0.05, 4);
  tip.rotateY(Math.PI / 4);
  tip.translate(0, 0.265, 0);
  const plinth = new THREE.BoxGeometry(0.08, 0.04, 0.08);
  plinth.translate(0, 0.0, 0);
  return mergeAll([shaft, tip, plinth]);
}

function buildGraveyard(world, church) {
  const { layout } = world;
  const rng = new Rng(1776);
  const types = [
    { geo: slabGeometry(), items: [] },
    { geo: crossGeometry(), items: [] },
    { geo: obeliskGeometry(), items: [] },
  ];
  const Y = CHURCHYARD;
  for (let z = Y.z0 + 0.25; z < Y.z1 - 0.15; z += 0.34) {
    for (let x = Y.x0 + 0.35; x < Y.x1 - 0.12; x += 0.3) {
      const px = x + rng.float(-0.08, 0.08);
      const pz = z + rng.float(-0.06, 0.06);
      if (layout.footprintDistance(church, px, pz) < 0.28) continue;
      if (Math.abs(pz - church.z) < 0.22 && px < church.x) continue; // path to the door
      if (rng.chance(0.3)) continue;
      const r = rng.next();
      const t = r < 0.72 ? 0 : r < 0.9 ? 1 : 2;
      types[t].items.push({ x: px, z: pz });
    }
  }
  const mat = plain('#8f8d86', { roughness: 0.95, flat: false });
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  for (const t of types) {
    if (!t.items.length) continue;
    const inst = new THREE.InstancedMesh(t.geo, mat, t.items.length);
    t.items.forEach((it, i) => {
      // face the stones west, toward the road, with a graveyard lean
      e.set(rng.float(-0.12, 0.12), -Math.PI / 2 + rng.float(-0.15, 0.15), rng.float(-0.1, 0.1));
      q.setFromEuler(e);
      const s = rng.float(0.85, 1.2);
      m4.compose(new THREE.Vector3(it.x, layout.heightAt(it.x, it.z) - 0.01, it.z), q, new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m4);
      const v = rng.float(0.55, 1.0);
      col.setRGB(v, v * rng.float(0.97, 1.03), v * rng.float(0.9, 1.0));
      if (rng.chance(0.25)) col.lerp(new THREE.Color(0.45, 0.55, 0.35), 0.35);
      inst.setColorAt(i, col);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    world.scene.add(inst);
  }

  // wrought-iron fence around the churchyard, open at the gate
  const pickets = [];
  const rails = [];
  const edge = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 0.07));
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      if (Math.abs(x - Y.x0) < 0.01 && Math.abs(z - church.z) < 0.24) continue; // gate
      pickets.push({ x, z, y: layout.heightAt(x, z) });
    }
    rails.push({ x0, z0, x1, z1 });
  };
  edge(Y.x0, Y.z0, Y.x1, Y.z0);
  edge(Y.x1, Y.z0, Y.x1, Y.z1);
  edge(Y.x1, Y.z1, Y.x0, Y.z1);
  edge(Y.x0, Y.z1, Y.x0, church.z + 0.24);
  edge(Y.x0, church.z - 0.24, Y.x0, Y.z0);

  const pGeo = mergeAll([
    new THREE.CylinderGeometry(0.005, 0.005, 0.2, 4).translate(0, 0.1, 0),
    new THREE.ConeGeometry(0.012, 0.03, 4).translate(0, 0.215, 0),
  ]);
  const iron = IRON();
  const inst = new THREE.InstancedMesh(pGeo, iron, pickets.length);
  pickets.forEach((p, i) => {
    m4.makeTranslation(p.x, p.y - 0.02, p.z);
    inst.setMatrixAt(i, m4);
  });
  inst.castShadow = true;
  world.scene.add(inst);
  // two horizontal rails following the ground, as short segments
  const railSegs = [];
  for (const r of rails) {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const n = Math.max(1, Math.round(len / 0.25));
    for (let k = 0; k < n; k++) {
      const ax = r.x0 + ((r.x1 - r.x0) * k) / n;
      const az = r.z0 + ((r.z1 - r.z0) * k) / n;
      const bx = r.x0 + ((r.x1 - r.x0) * (k + 1)) / n;
      const bz = r.z0 + ((r.z1 - r.z0) * (k + 1)) / n;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (Math.abs(mx - Y.x0) < 0.01 && Math.abs(mz - church.z) < 0.24) continue;
      for (const hgt of [0.06, 0.17]) railSegs.push({ ax, az, bx, bz, hgt });
    }
  }
  const rGeo = new THREE.BoxGeometry(1, 0.008, 0.008);
  const rInst = new THREE.InstancedMesh(rGeo, iron, railSegs.length);
  railSegs.forEach((s, i) => {
    const ya = layout.heightAt(s.ax, s.az) - 0.02 + s.hgt;
    const yb = layout.heightAt(s.bx, s.bz) - 0.02 + s.hgt;
    const a = new THREE.Vector3(s.ax, ya, s.az);
    const bb = new THREE.Vector3(s.bx, yb, s.bz);
    const dir = new THREE.Vector3().subVectors(bb, a);
    const len = dir.length();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
    m4.compose(a.clone().add(bb).multiplyScalar(0.5), q, new THREE.Vector3(len, 1, 1));
    rInst.setMatrixAt(i, m4);
  });
  world.scene.add(rInst);
}
