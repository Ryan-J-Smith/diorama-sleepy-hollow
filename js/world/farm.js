// The Van Tassel acres: a freshly harvested cornfield with stubble and corn
// shocks, a last strip of standing stalks, pumpkins, haystacks, a scarecrow,
// New England dry-stone walls and a zig-zag split-rail fence.

import * as THREE from 'three';
import { jitter, mergeAll } from '../util/geom.js';
import { Rng } from '../util/rng.js';
import { FIELD, CLEARINGS } from './layout.js';
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

function shockGeometry() {
  const pts = [
    [0.18, 0],
    [0.15, 0.08],
    [0.1, 0.2],
    [0.055, 0.3],
    [0.045, 0.33],
    [0.06, 0.36],
    [0.05, 0.42],
    [0.02, 0.5],
    [0.0, 0.52],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 12);
  // ragged stalk fringe
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const f = 1 + 0.12 * Math.sin(a * 11 + y * 30) + (y < 0.05 ? 0.1 * Math.sin(a * 17) : 0);
    p.setXYZ(i, x * f, y + (y > 0.48 ? 0.04 * Math.sin(a * 7) : 0), z * f);
  }
  g.computeVertexNormals();
  return g;
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
  const shockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
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
  scene.add(instanced(shockGeometry(), shockMat, shocks, (it) => {
    e.set(0, it.r, rng.float(-0.05, 0.05));
    q.setFromEuler(e);
    m4.compose(v3.set(it.x, H(it.x, it.z) - 0.01, it.z), q, s3.set(it.s, it.s * rng.float(0.9, 1.1), it.s));
  }));

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
  const hayMat = plain('#b8984e', { roughness: 1, flat: true });
  for (const h of CLEARINGS.haystacks) {
    const g = new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 1.55, 1);
    jitter(g, 0.035, h.x * 10, 5);
    const m = new THREE.Mesh(g, hayMat);
    m.position.set(h.x, H(h.x, h.z) - 0.03, h.z);
    m.scale.setScalar(h.s);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 4), plain('#4a3a2a'));
    pole.position.set(h.x, H(h.x, h.z) + 0.5 * h.s + 0.05, h.z);
    scene.add(pole);
  }

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

  buildStoneWalls(world, rng);
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

function buildStoneWalls(world, rng) {
  const { layout, scene } = world;
  const rocks = [];
  for (const line of WALLS) {
    for (let s = 0; s < line.length - 1; s++) {
      const [x0, z0] = line[s];
      const [x1, z1] = line[s + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.round(len / 0.075);
      for (let course = 0; course < 2; course++) {
        for (let k = 0; k < n; k++) {
          const t = (k + (course ? 0.5 : 0) + rng.float(-0.15, 0.15)) / n;
          if (t > 1) continue;
          const x = x0 + (x1 - x0) * t + rng.float(-0.015, 0.015);
          const z = z0 + (z1 - z0) * t + rng.float(-0.015, 0.015);
          const y = layout.heightAt(x, z) + (course ? 0.075 : 0.028);
          if (course && rng.chance(0.12)) continue; // tumbled stones
          const v = rng.float(0.55, 1.0);
          rocks.push({
            x, y, z,
            s: rng.float(0.8, 1.25) * (course ? 0.85 : 1),
            r: [rng.float(0, 6), rng.float(0, 6), rng.float(0, 6)],
            color: new THREE.Color(v, v * rng.float(0.96, 1.02), v * rng.float(0.9, 0.98)),
          });
        }
      }
    }
  }
  const g = new THREE.DodecahedronGeometry(0.045, 0);
  g.scale(1.35, 0.8, 1.0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.95, flatShading: true });
  scene.add(instanced(g, mat, rocks, (it) => {
    e.set(it.r[0] * 0.2, it.r[1], it.r[2] * 0.2);
    q.setFromEuler(e);
    m4.compose(v3.set(it.x, it.y, it.z), q, s3.set(it.s, it.s, it.s));
  }));
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

