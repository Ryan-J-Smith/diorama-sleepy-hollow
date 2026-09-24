// Capture mode (?capture=1) for the promo video. Instead of running on the
// wall clock, the diorama is stepped with a fixed time step and rendered one
// frame at a time on request, so every capture of a shot comes out the same.
// promo/capture.mjs drives it through window.__capture:
//
//   await __capture.load('/promo/shots.js');  // the shot list (camera paths)
//   __capture.setShot('chase');                // warm up and place the riders
//   __capture.frame(0);                        // -> PNG data URL
//   __capture.frame(1); ...                    // frames only step forwards
//
// Load a fresh page for each shot: setShot() starts from wherever the
// simulation happens to be.

import * as THREE from 'three';

const FPS = 30;
const SUBSTEPS = 2; // updaters see dt = 1/60, like the live site on most screens

const vec = (v) => (v instanceof THREE.Vector3 ? v : new THREE.Vector3(...v));

export function installCapture(world, composer) {
  const { scene, camera, renderer, sim, layout } = world;
  const glass = [];
  scene.traverse((o) => {
    if (o.name === 'glass') glass.push(o);
  });

  let shots = {};
  let shot = null;
  let frameIndex = 0;

  const advance = (frames) => {
    const n = Math.round(frames * SUBSTEPS);
    const dt = 1 / (FPS * SUBSTEPS);
    for (let i = 0; i < n; i++) {
      sim.time += dt;
      sim.realTime += dt;
      for (const u of world.updaters) u(dt, sim.time, sim);
    }
  };

  const ctx = { world, layout, actors: world.actors, THREE, frame: 0, time: 0 };

  const placeCamera = (u) => {
    ctx.frame = frameIndex;
    ctx.time = frameIndex / FPS;
    const view = shot.camera(u, ctx);
    camera.position.copy(vec(view.pos));
    camera.up.set(0, 1, 0);
    camera.lookAt(vec(view.target));
    camera.fov = view.fov ?? 32;
    camera.near = view.near ?? 0.1;
    camera.updateProjectionMatrix();
  };

  const api = {
    fps: FPS,

    /** Import a shot list module (its SHOTS export). */
    async load(url) {
      const mod = await import(url);
      shots = mod.SHOTS;
      return Object.fromEntries(Object.entries(shots).map(([name, s]) => [name, s.frames]));
    },

    /**
     * Get the scene ready for frame 0 of a shot: run the simulation for the
     * shot's warm-up (so smoke and mist have drifted in), put the riders at
     * their spot on the road, then let the chase run for the pre-roll.
     */
    setShot(name) {
      shot = shots[name];
      if (!shot) throw new Error(`No shot called "${name}"`);
      for (const g of glass) g.visible = shot.glass !== false;
      advance((shot.warmup ?? 20) * FPS);
      if (shot.chase != null) world.actors.seek(shot.chase(world.actors, ctx));
      advance((shot.preroll ?? 2) * FPS);
      frameIndex = 0;
      placeCamera(0);
      renderer.compile(scene, camera);
      return shot.frames;
    },

    /** Step forwards to frame i of the current shot, render it and return a PNG data URL. */
    frame(i) {
      if (!shot) throw new Error('Call setShot() first');
      if (i < frameIndex) throw new Error(`Frames only step forwards (at ${frameIndex}, asked for ${i})`);
      advance(i - frameIndex);
      frameIndex = i;
      placeCamera(shot.frames > 1 ? i / (shot.frames - 1) : 0);
      composer.render();
      return renderer.domElement.toDataURL('image/png');
    },

    /** Handy numbers for writing camera paths. */
    info() {
      return {
        time: sim.time,
        peakS: world.actors.peakS,
        roadLength: layout.roadLength,
        bridge: layout.bridge,
        stoneBridge: layout.stoneBridge,
        perches: world.perches.map((p) => p.toArray()),
        ichabod: world.actors.ichabod().toArray(),
        horseman: world.actors.horseman().toArray(),
      };
    },
  };

  document.body.classList.add('capture');
  window.__capture = api;
  return api;
}
