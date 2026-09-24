// The chase: Ichabod on Gunpowder, the Horseman close behind, looping the
// road like a clockwork toy. The goblin gains on the approach to the covered
// bridge, rises in his stirrups with his burning head held high as he comes
// off it, then falls back through the woods before closing in again.

import * as THREE from 'three';
import { smoothstep } from '../config.js';
import { Horse } from './horse.js';
import { Ichabod, Horseman } from './riders.js';
import { Particles } from '../fx/particles.js';
import { puffTexture } from '../util/textures.js';
import { Rng } from '../util/rng.js';

const SPEED = 1.3;

export function buildChase(world) {
  const { layout } = world;
  const L = layout.roadLength;
  const rng = new Rng(1790);

  // seeded gallop phases so every visit (and every promo capture) matches
  const gunpowder = new Horse({ coat: '#8e8a84', mane: '#5b4a38', blanket: '#6e2a1f', scale: 1.0, gaunt: 1, phase: rng.float() });
  const steed = new Horse({ coat: '#141217', mane: '#08080a', blanket: '#1c1418', scale: 1.2, eyeGlow: 3.2, maneLength: 1.5, phase: rng.float() });
  gunpowder.group.rotation.order = 'YXZ';
  steed.group.rotation.order = 'YXZ';
  world.live.add(gunpowder.group, steed.group);
  const ichabod = new Ichabod(gunpowder);
  const horseman = new Horseman(steed);

  const dust = new Particles(160, { texture: puffTexture() });
  world.live.add(dust.mesh);

  const bridge = layout.bridge;
  // The moment of greatest menace: Ichabod just clear of the covered bridge.
  const peakS = bridge.s + bridge.halfLen + 1.5;
  let sI = bridge.s - 12;
  let sH = null;
  let lastD = null;

  // Gap between the riders, by distance since the peak moment.
  const gapAt = (d) => 1.3 + 1.3 * smoothstep(0.5, 7, d) * (1 - smoothstep(L - 16, L - 1.5, d));

  const A = {};
  const B = {};
  const C = {};
  const place = (horse, s) => {
    layout.roadAt(s, A);
    layout.roadAt(s + 0.14, B);
    layout.roadAt(s - 0.14, C);
    horse.group.position.set(A.x, A.y, A.z);
    const yaw = Math.atan2(B.x - C.x, B.z - C.z);
    const pitch = -Math.atan2(B.y - C.y, 0.28);
    horse.group.rotation.set(pitch, yaw, 0);
  };

  const crossed = (d, th) => {
    if (lastD === null) return false;
    if (d >= lastD) return lastD < th && d >= th;
    return th > lastD || th <= d; // wrapped around the loop
  };

  // Ichabod glances back now and then, and always as he clears the bridge.
  const glances = [
    { at: L - 1.2, len: 2.4 },
    { at: 9, len: 1.1 },
    { at: 17, len: 1.1 },
    { at: 25, len: 1.1 },
  ];
  let glanceLeft = 0;
  let flourishTarget = 0;

  world.addUpdater((dt, t) => {
    if (dt <= 0) return;

    const speed = SPEED * (1 + 0.05 * Math.sin(t * 0.7));
    const ds = speed * dt;
    sI += ds;
    let d = (sI - peakS) % L;
    if (d < 0) d += L;
    const nextH = sI - gapAt(d);
    const dsH = sH === null ? 0 : Math.max(0, nextH - sH);
    sH = nextH;

    place(gunpowder, sI);
    place(steed, sH);
    gunpowder.update(dt, ds, t);
    steed.update(dt, dsH, t);

    // choreography keyed to the spot on the road
    for (const g of glances) {
      if (crossed(d, g.at % L)) {
        glanceLeft = g.len;
        ichabod.lookBack(true);
      }
    }
    if (glanceLeft > 0) {
      glanceLeft -= dt;
      if (glanceLeft <= 0) ichabod.lookBack(false);
    }
    if (crossed(d, L - 0.6)) flourishTarget = 1;
    if (crossed(d, 2.2)) flourishTarget = 0;
    lastD = d;
    horseman.flourish += (flourishTarget - horseman.flourish) * Math.min(1, dt * 4);
    // lower the lantern while under the covered bridge's roof
    const hp = steed.group.position;
    const underRoof = Math.hypot(hp.x - bridge.x, hp.z - bridge.z) < bridge.halfLen + 0.45 ? 1 : 0;
    horseman.duck += (underRoof - horseman.duck) * Math.min(1, dt * 7);

    // reins need the horses' current head positions
    gunpowder.group.updateMatrixWorld(true);
    steed.group.updateMatrixWorld(true);
    ichabod.update(dt, t, gunpowder.phase);
    horseman.update(dt, t, steed.phase);

    // hoof dust (not on the bridge decks)
    for (const [horse, s, moved] of [[gunpowder, sI, ds], [steed, sH, dsH]]) {
      horse.dustAcc = (horse.dustAcc ?? 0) + moved;
      if (horse.dustAcc < 0.16) continue;
      horse.dustAcc = 0;
      const p = horse.group.position;
      if (layout.bridges.some((b) => Math.hypot(p.x - b.x, p.z - b.z) < b.halfLen + 0.1)) continue;
      layout.roadAt(s, B);
      dust.spawn({
        x: p.x - B.tx * 0.12 + rng.float(-0.04, 0.04),
        y: p.y + 0.02,
        z: p.z - B.tz * 0.12 + rng.float(-0.04, 0.04),
        vx: -B.tx * 0.15,
        vy: 0.08,
        vz: -B.tz * 0.15,
        drag: 1.5,
        life: 1.0,
        size0: 0.06,
        size1: 0.24,
        color: new THREE.Color(0.2, 0.17, 0.13),
        alpha0: 0.4,
        alpha1: 0,
        rot: rng.float(0, 6),
        spin: rng.float(-1, 1),
      });
    }
    dust.update(dt);
  });

  const ichabodPos = new THREE.Vector3();
  const horsemanPos = new THREE.Vector3();
  world.actors = {
    ichabod: () => ichabodPos.copy(gunpowder.group.position),
    horseman: () => horsemanPos.copy(steed.group.position),
    focus: () => new THREE.Vector3().addVectors(gunpowder.group.position, steed.group.position).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.35, 0)),
    // jump the chase to a spot on the road (debugging / screenshots)
    seek: (s) => {
      sI = s;
      sH = null;
      lastD = null;
      // start the choreography afresh rather than mid-glance or mid-flourish
      glanceLeft = 0;
      ichabod.lookBack(false);
      flourishTarget = 0;
      horseman.flourish = 0;
    },
    peakS,
  };
  return world.actors;
}
