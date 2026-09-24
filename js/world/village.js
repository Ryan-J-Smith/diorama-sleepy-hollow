// The village of Sleepy Hollow: houses, the tavern, the Van Tassel farm and
// barn, Ichabod's log schoolhouse, lamp posts and jack-o'-lanterns on stoops.

import * as THREE from 'three';
import { BUILDINGS } from './layout.js';
import { makeBuilding } from './buildings.js';
import { makeLampPost, makeLantern, makeJack, groundGlow } from './props.js';
import { surface, plain, IRON } from './kit.js';
import { signTexture } from '../util/textures.js';
import { SPURS } from './layout.js';
import { boxUV } from '../util/geom.js';
import { noise1 } from '../util/noise.js';
import { Rng } from '../util/rng.js';

const SPECS = {
  houseA: { roof: 'gambrel', wallH: 0.62, roofH: 0.62, wallColor: '#d9d2c0', roofColor: '#4a4744', shutterColor: '#2f4a38', chimneys: ['left', 'right'] },
  houseB: { roof: 'gable', stories: 2, wallH: 0.95, roofH: 0.42, wallColor: '#7d8a96', roofColor: '#3d3a38', shutterColor: '#1d1d1f', chimneys: ['center'] },
  houseC: { roof: 'saltbox', stories: 2, wallH: 0.92, roofH: 0.5, wallColor: '#7b3b2a', roofColor: '#4b4038', trimColor: '#d8cfbd', chimneys: ['center'] },
  houseD: { roof: 'gambrel', wall: 'stone', wallColor: '#b8ad98', wallScale: 1.6, wallH: 0.6, roofH: 0.6, roofColor: '#3b3632', trimColor: '#e0d8c4', shutterColor: '#6b2a22', chimneys: ['left', 'right'] },
  houseE: { roof: 'gambrel', wallH: 0.56, roofH: 0.55, wallColor: '#b08d4a', roofColor: '#463d34', shutterColor: '#3b2a1c', chimneys: ['right'] },
  houseG: { roof: 'gable', wallH: 0.62, roofH: 0.45, wallColor: '#5e6a57', roofColor: '#3a3632', trimColor: '#d8d2c2', chimneys: ['left'] },
  cottage: { roof: 'gable', wallH: 0.55, roofH: 0.42, wallColor: '#8a7560', roofColor: '#4a4038', chimneys: ['right'] },
  tavern: { roof: 'gambrel', stories: 2, wallH: 1.0, roofH: 0.62, wallColor: '#6e2a22', roofColor: '#3a3634', trimColor: '#e2dccb', shutterColor: '#1f2b22', chimneys: ['left', 'right'], litChance: 0.95 },
  houseF: { roof: 'gable', wallH: 0.6, roofH: 0.44, wallColor: '#ddd6c6', roofColor: '#4a4540', shutterColor: '#243a4a', chimneys: ['left'] },
  farmhouse: { roof: 'gambrel', wallH: 0.66, roofH: 0.7, wallColor: '#e0d9c8', roofColor: '#403a35', shutterColor: '#2d4436', chimneys: ['left', 'right'], litChance: 0.9 },
  barn: { roof: 'gambrel', wall: 'board', wallScale: 1.8, wallH: 0.82, roofH: 0.78, wallColor: '#7d2c20', roofColor: '#3f3b38', trimColor: '#d8d0c0', chimneys: [], door: 'none', frontWindows: 0, sideWindows: 0, litChance: 0.5 },
  school: { roof: 'gable', wallH: 0.5, roofH: 0.36, wallColor: '#6b4e36', wallScale: 1.1, roofColor: '#4a4038', trimColor: '#8a7a64', chimneys: ['left'], litChance: 0.35, frontWindows: 2 },
};

// Which stoops get a jack-o'-lantern.
const STOOP_JACKS = ['houseA', 'houseC', 'houseE', 'tavern', 'farmhouse', 'houseF', 'cottage'];

export function buildVillage(world) {
  const { layout, batcher } = world;
  const rng = new Rng(1692);
  const houses = [];
  world.chimneys = world.chimneys || [];

  BUILDINGS.forEach((b, i) => {
    if (b.id === 'church') return;
    const spec = { ...SPECS[b.id], w: b.w, d: b.d, seed: i + 1 };
    const house = makeBuilding(spec);
    const g = house.group;
    g.position.set(b.x, b.y, b.z);
    g.rotation.y = b.yaw;

    if (b.id === 'barn') addBarnDetails(world, house);
    if (b.id === 'tavern') addTavernDetails(world, house);
    if (STOOP_JACKS.includes(b.id) && house.door) {
      const jack = makeJack(rng.float(0.9, 1.15));
      jack.position.set(house.door.x + 0.2, 0.02, house.door.z - 0.06);
      jack.rotation.y = rng.float(-0.4, 0.4);
      g.add(jack);
      if (rng.chance(0.5)) {
        const j2 = makeJack(0.75);
        j2.position.set(house.door.x - 0.2, 0.02, house.door.z - 0.08);
        j2.rotation.y = rng.float(-0.5, 0.5);
        g.add(j2);
      }
    }

    g.updateMatrixWorld(true);
    for (const c of house.chimneys) world.chimneys.push(c.clone().applyMatrix4(g.matrixWorld));
    batcher.addObject(g, world.live);
    houses.push({ id: b.id, materials: house.materials, next: rng.float(8, 30) });
  });

  buildLamps(world);
  buildSignposts(world);
  registerWindowLife(world, houses);
  world.houses = houses;
  return houses;
}

/** Candles flicker; upstairs rooms go dark and light again now and then. */
export function registerWindowLife(world, houses) {
  const rng = new Rng(42);
  world.addUpdater((dt, t, sim) => {
    const rt = sim.realTime;
    for (const h of houses) {
      const { lower, upper } = h.materials;
      if (t > h.next) {
        upper.userData.target = upper.userData.target > 0.5 ? (rng.chance(0.7) ? 0.05 : 1) : 1;
        h.next = t + rng.float(9, 35);
      }
      for (const m of [lower, upper]) {
        const u = m.userData;
        u.level += (u.target - u.level) * Math.min(1, dt * 1.3);
        // candle flicker: a slow waver plus a quick flutter
        const flick = 0.88 + noise1(rt * 4 + u.seed * 11, 5) * 0.09 + noise1(rt * 17 + u.seed * 3, 6) * 0.05;
        m.emissiveIntensity = u.base * u.level * flick;
      }
    }
  });
}

function addBarnDetails(world, house) {
  const g = house.group;
  const z = house.spec.d / 2;
  const doorMat = surface('board', '#5e2219', { roughness: 0.9 });
  const trim = plain('#d8d0c0', { roughness: 0.8 });
  const dw = 0.34;
  const dh = 0.55;
  // warm lamplit interior seen through the half-open door
  const inside = new THREE.Mesh(
    new THREE.PlaneGeometry(dw * 1.9, dh),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.55, 0.2) }),
  );
  inside.position.set(0, dh / 2, z + 0.004);
  g.add(inside);
  const panel = (x, out) => {
    const p = new THREE.Group();
    const board = new THREE.Mesh(boxUV(new THREE.BoxGeometry(dw, dh, 0.02), 1.8), doorMat);
    board.castShadow = true;
    p.add(board);
    for (const [bw, bh, bx, by, rz] of [
      [dw, 0.025, 0, dh / 2 - 0.012, 0],
      [dw, 0.025, 0, -dh / 2 + 0.012, 0],
      [0.025, dh, -dw / 2 + 0.012, 0, 0],
      [0.025, dh, dw / 2 - 0.012, 0, 0],
      [Math.hypot(dw, dh) - 0.03, 0.022, 0, 0, Math.atan2(dh, dw)],
      [Math.hypot(dw, dh) - 0.03, 0.022, 0, 0, -Math.atan2(dh, dw)],
    ]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.012), trim);
      t.position.set(bx, by, 0.014);
      t.rotation.z = rz;
      p.add(t);
    }
    p.position.set(x, dh / 2, z + out);
    g.add(p);
  };
  panel(-dw / 2 - dw * 0.72, 0.03); // slid open
  panel(dw / 2, 0.012);
  // track rail
  const rail = new THREE.Mesh(new THREE.BoxGeometry(dw * 3.6, 0.02, 0.02), IRON());
  rail.position.set(-dw * 0.4, dh + 0.02, z + 0.03);
  g.add(rail);
  // hayloft door
  const loft = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.22, 0.2, 0.02), 1.8), doorMat);
  loft.position.set(0, 0.98, z + 0.012);
  g.add(loft);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), plain('#3a2a1e'));
  beam.position.set(0, 1.18, z + 0.09);
  g.add(beam);
  // lantern by the door with real light
  const lantern = makeLantern(world, { light: true, intensity: 1.1, distance: 2.4 });
  lantern.position.set(dw * 1.35, 0.5, z + 0.07);
  g.add(lantern);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.07), IRON());
  hook.position.set(dw * 1.35, 0.57, z + 0.035);
  g.add(hook);
  // hay spilling out of the door
  const hay = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), plain('#b89a52', { flat: true }));
  hay.scale.set(1.6, 0.35, 0.8);
  hay.position.set(-0.05, 0, z + 0.12);
  g.add(hay);
}

function addTavernDetails(world, house) {
  const g = house.group;
  const { w, d } = house.spec;
  const z = d / 2;
  const iron = IRON();

  // iron bracket and swinging sign at the corner of the front wall
  const bracket = new THREE.Group();
  bracket.position.set(w / 2 - 0.12, 0.74, z);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.34), iron);
  arm.position.z = 0.17;
  bracket.add(arm);
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.24), iron);
  strut.position.set(0, -0.08, 0.1);
  strut.rotation.x = -0.6;
  bracket.add(strut);
  g.add(bracket);

  // The outer group is re-parented (world transform baked into its rotation),
  // so the animation swings an inner pendulum rather than the group itself.
  const hanger = new THREE.Group();
  hanger.position.set(w / 2 - 0.12, 0.735, z + 0.26);
  hanger.userData.dynamic = true;
  const swing = new THREE.Group();
  hanger.add(swing);
  const tex = signTexture(['TAVERN'], { emblem: 'tankard', w: 256, h: 192 });
  const signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.26), [
    signMat, signMat, plain('#2d1d12'), plain('#2d1d12'), plain('#2d1d12'), plain('#2d1d12'),
  ]);
  board.position.y = -0.14;
  board.castShadow = true;
  swing.add(board);
  for (const sz of [-0.09, 0.09]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 4), iron);
    chain.position.set(0, -0.025, sz);
    swing.add(chain);
  }
  g.add(hanger);
  world.addUpdater((dt, t) => {
    swing.rotation.z = 0.14 * Math.sin(t * 1.3) + 0.05 * Math.sin(t * 2.9);
  });

  // lanterns flanking the door
  for (const side of [-1, 1]) {
    const lan = makeLantern(world, { light: side > 0, intensity: 1.3, distance: 2.8, scale: 0.9 });
    lan.position.set(side * 0.22, 0.46, z + 0.06);
    g.add(lan);
  }

  // barrels and a bench outside
  const barrelMat = surface('plank', '#6a4a30', { roughness: 0.85 });
  const bandMat = plain('#2a2522', { roughness: 0.6, metalness: 0.4 });
  const barrelGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 12);
  const bulge = barrelGeo.attributes.position;
  for (let i = 0; i < bulge.count; i++) {
    const y = bulge.getY(i) / 0.07;
    const k = 1 + 0.18 * (1 - y * y);
    bulge.setX(i, bulge.getX(i) * k);
    bulge.setZ(i, bulge.getZ(i) * k);
  }
  barrelGeo.computeVertexNormals();
  for (const [bx, bz] of [[-w / 2 + 0.12, z + 0.14], [-w / 2 + 0.26, z + 0.12], [-w / 2 + 0.19, z + 0.26]]) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(bx, 0.07, bz);
    b.castShadow = true;
    g.add(b);
    for (const by of [-0.045, 0.045]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.004, 4, 16), bandMat);
      band.rotation.x = Math.PI / 2;
      band.position.set(bx, 0.07 + by, bz);
      g.add(band);
    }
  }
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.07), plain('#4a3424'));
  bench.position.set(-0.52, 0.11, z + 0.1);
  g.add(bench);
  for (const bx of [-0.66, -0.38]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.06), plain('#3a2a1e'));
    leg.position.set(bx, 0.05, z + 0.1);
    g.add(leg);
  }
}

function roadside(layout, nearX, nearZ, side, offset = 0.52) {
  const { i } = layout.roadIndex.nearest(nearX, nearZ, 3);
  const tx = layout.roadTX[i];
  const tz = layout.roadTZ[i];
  const x = layout.roadX[i] + -tz * side * offset;
  const z = layout.roadZ[i] + tx * side * offset;
  return { x, z, y: layout.heightAt(x, z) };
}

function buildLamps(world) {
  const { layout, batcher } = world;
  const spots = [
    { near: [-7.0, -2.25], side: 1, light: false },
    { near: [-7.02, 0.0], side: -1, light: true },
    { near: [-5.6, 3.25], side: 1, light: false },
    { near: [-3.9, 3.53], side: -1, light: true },
    { near: [-1.9, 3.52], side: 1, light: false },
  ];
  for (const s of spots) {
    const p = roadside(layout, s.near[0], s.near[1], s.side);
    const lamp = makeLampPost(world, { light: s.light, intensity: 1.2, distance: 2.6 });
    lamp.position.set(p.x, p.y - 0.02, p.z);
    lamp.updateMatrixWorld(true);
    batcher.addObject(lamp, world.live);
    groundGlow(world, p.x, p.z, 0.75, 0xff9a40, s.light ? 0.28 : 0.42);
  }
}

/** Wooden fingerposts where the side roads leave the loop. */
function buildSignposts(world) {
  const { layout } = world;
  const wood = plain('#5a4632', { roughness: 0.9 });
  const edge = plain('#3a2c20', { roughness: 0.9 });
  const arm = (text, dir, y, post) => {
    const tex = signTexture([text.toUpperCase()], { w: 320, h: 56, bg: '#d9cdb2', fg: '#2a1c14', border: false });
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.048, 0.012), [edge, edge, edge, edge, face, face]);
    board.position.set(dir.x * 0.12, y, dir.z * 0.12);
    board.rotation.y = Math.atan2(-dir.z, dir.x);
    board.castShadow = true;
    post.add(board);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.03, 3), edge);
    tip.rotation.set(0, 0, -Math.PI / 2);
    tip.scale.set(1, 1, 0.25);
    tip.position.set(0.145, 0, 0);
    board.add(tip);
  };
  layout.spurs.forEach((sp, k) => {
    const i = Math.min(16, sp.x.length - 1);
    const side = k === 0 ? 1 : -1;
    const x = sp.x[i] - sp.tz[i] * 0.46 * side;
    const z = sp.z[i] + sp.tx[i] * 0.46 * side;
    const post = new THREE.Group();
    post.position.set(x, layout.heightAt(x, z) - 0.02, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.62, 6), wood);
    pole.position.y = 0.31;
    pole.castShadow = true;
    post.add(pole);
    const capM = new THREE.Mesh(new THREE.ConeGeometry(0.024, 0.04, 6), edge);
    capM.position.y = 0.64;
    post.add(capM);
    // one arm down the side road, one back along the loop toward the village
    arm(SPURS[k].sign, new THREE.Vector3(sp.tx[i], 0, sp.tz[i]), 0.55, post);
    const j = sp.junction;
    const back = new THREE.Vector3(layout.roadTX[j], 0, layout.roadTZ[j]).multiplyScalar(k === 0 ? -1 : 1);
    arm(k === 0 ? 'Sleepy Hollow' : 'Old Dutch Church', back, 0.47, post);
    world.scene.add(post);
  });
}
