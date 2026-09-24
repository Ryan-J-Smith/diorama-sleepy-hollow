// Snow-globe touches: leaves drifting down inside the case, low mist over the
// river and churchyard, and wood smoke curling from the chimneys.

import * as THREE from 'three';
import { WATER_Y, CASE, TERRAIN } from '../config.js';
import { Particles } from './particles.js';
import { puffTexture } from '../util/textures.js';
import { Rng } from '../util/rng.js';
import { CHURCHYARD } from '../world/layout.js';

// ---------------------------------------------------------------------------
// Falling leaves

function leafGeometry() {
  const s = new THREE.Shape();
  const r = 0.028;
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
    const rr = k % 2 ? r * 0.45 : r * (k === 4 || k === 6 ? 0.8 : 1);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (k === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

function buildLeaves(world) {
  const { layout } = world;
  const rng = new Rng(77);
  const crowns = (world.treeCrowns || []).filter((c) => c.type !== 'pine');
  const COUNT = 220;
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  const mesh = new THREE.InstancedMesh(leafGeometry(), mat, COUNT);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  world.scene.add(mesh);

  const fallbackColors = ['#c8321e', '#e2621f', '#f09a2a', '#edc23e', '#9c5024'].map((c) => new THREE.Color(c));
  const leaves = [];
  const spawn = (leaf, initial) => {
    const fromTree = crowns.length && rng.chance(0.8);
    if (fromTree) {
      const c = rng.pick(crowns);
      leaf.p.set(c.x + rng.float(-c.r, c.r), c.y + rng.float(-0.1, 0.25), c.z + rng.float(-c.r, c.r));
      leaf.color.copy(c.color ?? rng.pick(fallbackColors));
    } else {
      // drifting down from high in the case, snow-globe style
      leaf.p.set(rng.float(-TERRAIN.hx + 0.6, TERRAIN.hx - 0.6), rng.float(3.2, CASE.height - 0.5), rng.float(-TERRAIN.hz + 0.6, TERRAIN.hz - 0.6));
      leaf.color.copy(rng.pick(fallbackColors));
    }
    leaf.color.multiplyScalar(rng.float(0.8, 1.15));
    if (initial) leaf.p.y = rng.float(leaf.p.y * 0.4, leaf.p.y);
    leaf.fall = rng.float(0.1, 0.2);
    leaf.sway = rng.float(0.15, 0.35);
    leaf.phase = rng.float(0, Math.PI * 2);
    leaf.freq = rng.float(1.2, 2.4);
    leaf.rot.set(rng.float(0, 6), rng.float(0, 6), rng.float(0, 6));
    leaf.spin.set(rng.float(-3, 3), rng.float(-2, 2), rng.float(-3, 3));
    leaf.state = 'fall';
    leaf.rest = 0;
    leaf.scale = 1;
  };
  for (let i = 0; i < COUNT; i++) {
    const leaf = { p: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), color: new THREE.Color() };
    spawn(leaf, true);
    leaves.push(leaf);
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const update = (dt, t) => {
    for (let i = 0; i < COUNT; i++) {
      const L = leaves[i];
      if (L.state === 'fall') {
        L.p.y -= L.fall * dt * (0.7 + 0.5 * Math.abs(Math.sin(t * L.freq + L.phase)));
        L.p.x += Math.sin(t * L.freq + L.phase) * L.sway * dt + 0.03 * dt;
        L.p.z += Math.cos(t * L.freq * 0.8 + L.phase) * L.sway * 0.6 * dt;
        L.rot.x += L.spin.x * dt;
        L.rot.y += L.spin.y * dt;
        L.rot.z += L.spin.z * dt;
        const ground = Math.max(layout.heightAt(L.p.x, L.p.z), WATER_Y) + 0.008;
        if (L.p.y <= ground) {
          L.p.y = ground;
          L.state = 'rest';
          L.rest = rng.float(2, 5);
          L.rot.set(rng.float(-0.2, 0.2), rng.float(0, 6), rng.float(-0.2, 0.2));
        }
      } else {
        L.rest -= dt;
        if (layout.heightAt(L.p.x, L.p.z) < WATER_Y) {
          // carried downstream a little
          L.p.z += 0.05 * dt;
        }
        if (L.rest < 0.6) L.scale = Math.max(0, L.rest / 0.6);
        if (L.rest <= 0) spawn(L, false);
      }
      if (Math.abs(L.p.x) > CASE.hx - 0.1 || Math.abs(L.p.z) > CASE.hz - 0.1) spawn(L, false);
      q.setFromEuler(L.rot);
      sc.setScalar(L.scale);
      m4.compose(L.p, q, sc);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, L.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  };
  update(0, 0);
  world.addUpdater((dt, t) => {
    if (dt > 0) update(dt, t);
  });
}

// ---------------------------------------------------------------------------
// Mist and smoke

function buildMist(world) {
  const { layout } = world;
  const rng = new Rng(5);
  const mist = new Particles(90, { texture: puffTexture(), renderOrder: 4 });
  world.live.add(mist.mesh);
  const color = new THREE.Color(0.5, 0.56, 0.68);

  // where mist gathers: the river, the churchyard, the hollow at the hills' foot
  const spots = [];
  for (let i = 0; i < layout.streamX.length; i += 6) spots.push([layout.streamX[i], layout.streamZ[i], 0.5]);
  for (let k = 0; k < 10; k++) spots.push([rng.float(CHURCHYARD.x0, CHURCHYARD.x1), rng.float(CHURCHYARD.z0, CHURCHYARD.z1), 0.4]);
  for (let k = 0; k < 10; k++) spots.push([rng.float(-6, 6), rng.float(-3.6, -3.2), 0.6]);

  const spawn = (initial) => {
    const [x, z, spread] = rng.pick(spots);
    const px = x + rng.float(-spread, spread);
    const pz = z + rng.float(-spread, spread);
    if (Math.abs(px) > TERRAIN.hx - 0.8 || Math.abs(pz) > TERRAIN.hz - 0.8) return;
    const life = rng.float(14, 24);
    const p = mist.spawn({
      x: px,
      y: Math.max(layout.heightAt(px, pz), WATER_Y) + rng.float(0.1, 0.25),
      z: pz,
      vx: rng.float(0.01, 0.04),
      vz: rng.float(-0.015, 0.015),
      life,
      size0: rng.float(0.9, 1.3),
      size1: rng.float(1.5, 2.2),
      color,
      alpha0: rng.float(0.12, 0.2),
      alpha1: 0,
      fadeIn: 4,
      rot: rng.float(0, 6),
      spin: rng.float(-0.05, 0.05),
    });
    if (p && initial) p.age = rng.float(0, life * 0.6);
  };
  for (let k = 0; k < 70; k++) spawn(true);
  let acc = 0;
  world.addUpdater((dt) => {
    if (dt <= 0) return;
    acc += dt;
    while (acc > 0.25) {
      acc -= 0.25;
      if (mist.items.length < 80) spawn(false);
    }
    mist.update(dt);
  });
}

function buildSmoke(world) {
  const chimneys = world.chimneys || [];
  if (!chimneys.length) return;
  const rng = new Rng(8);
  const smoke = new Particles(chimneys.length * 12, { texture: puffTexture(), renderOrder: 4 });
  world.live.add(smoke.mesh);
  const color = new THREE.Color(0.42, 0.44, 0.5);
  const timers = chimneys.map(() => rng.float(0, 0.5));
  world.addUpdater((dt, t) => {
    if (dt <= 0) return;
    chimneys.forEach((c, i) => {
      timers[i] -= dt;
      if (timers[i] > 0) return;
      timers[i] = rng.float(0.3, 0.5);
      smoke.spawn({
        x: c.x + rng.float(-0.02, 0.02),
        y: c.y,
        z: c.z + rng.float(-0.02, 0.02),
        vx: 0.05 + 0.03 * Math.sin(t * 0.3),
        vy: rng.float(0.14, 0.2),
        vz: 0.01,
        drag: 0.25,
        life: rng.float(3, 4.2),
        size0: 0.06,
        size1: rng.float(0.32, 0.45),
        color,
        alpha0: 0.32,
        alpha1: 0,
        fadeIn: 0.4,
        rot: rng.float(0, 6),
        spin: rng.float(-0.4, 0.4),
      });
    });
    smoke.update(dt);
  });
}

export function buildAtmosphere(world) {
  buildLeaves(world);
  buildMist(world);
  buildSmoke(world);
}
