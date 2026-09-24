// Entry point: builds the diorama piece by piece behind the loading card, then
// sets it running.

import * as THREE from 'three';
import { QUALITY, CAPTURE, CAPTURE_SIZE } from './config.js';
import { createRenderer, createComposer, cameraFov } from './core/renderer.js';
import { createLighting, createBackdrop, createRoomEnvironment, createSkyEnvironment } from './core/lighting.js';
import { CaseControls } from './core/controls.js';
import { setMaxAnisotropy } from './util/textures.js';
import { StaticBatcher } from './util/geom.js';
import { Layout } from './world/layout.js';
import { buildBase, buildCase, buildMoon } from './world/caseworks.js';
import { buildTerrain } from './world/terrain.js';
import { buildRiverDetails } from './world/river.js';
import { buildVillage } from './world/village.js';
import { buildChurch } from './world/church.js';
import { buildBridge, buildStoneBridge } from './world/bridge.js';
import { registerFlicker } from './world/props.js';
import { buildTrees } from './world/trees.js';
import { buildFarm } from './world/farm.js';
import { buildChase } from './actors/chase.js';
import { buildWildlife } from './actors/wildlife.js';
import { buildAtmosphere } from './fx/atmosphere.js';
import { setupUI } from './ui.js';
import { Music } from './audio.js';

const loader = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');
const loaderStep = document.getElementById('loader-step');

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * The plaque and signs are painted with the web font, so wait for it (up to a
 * few seconds; offline it falls back to Georgia). The font stylesheet loads
 * without blocking the page, so first wait for its @font-face rules to exist.
 */
async function waitForFonts() {
  if (!document.fonts) return;
  const deadline = performance.now() + 3000;
  const hasSheet = () => [...document.styleSheets].some((sheet) => (sheet.href || '').includes('fonts.googleapis'));
  while (!hasSheet() && performance.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const fonts = ['96px "IM Fell English SC"', 'italic 46px "IM Fell English"', '40px "IM Fell English"'];
  const load = Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => null)));
  await Promise.race([load, new Promise((r) => setTimeout(r, Math.max(300, deadline - performance.now())))]);
}

async function main() {
  // the scripts have arrived: switch the loader from "downloading" to progress
  clearTimeout(window.__loaderSlow);
  loader.classList.add('started');
  const canvas = document.getElementById('scene');
  const music = CAPTURE ? null : new Music(); // starts downloading the track right away
  const renderer = createRenderer(canvas);
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

  const scene = new THREE.Scene();
  const aspect = CAPTURE ? CAPTURE_SIZE.width / CAPTURE_SIZE.height : window.innerWidth / window.innerHeight;
  const camera = new THREE.PerspectiveCamera(cameraFov(aspect), aspect, 0.1, 200);
  const { composer, mist } = createComposer(renderer, scene, camera);

  const sim = { running: true, time: 0, realTime: 0 };
  const world = {
    scene,
    camera,
    renderer,
    mist, // the mist post-processing pass, given the terrain in buildAtmosphere
    sim,
    materials: {},
    updaters: [],
    addUpdater(fn) {
      this.updaters.push(fn);
    },
    batcher: new StaticBatcher(),
    live: new THREE.Group(),
    layout: null,
    envMap: null,
    skyEnv: null,
    actors: {},
  };
  world.live.name = 'live';
  scene.add(world.live);

  const steps = [
    ['Lighting the lamps', async () => {
      await waitForFonts();
      world.envMap = createRoomEnvironment(renderer);
      world.skyEnv = createSkyEnvironment(renderer);
      world.lights = createLighting(scene);
      createBackdrop(scene);
    }],
    ['Surveying the hollow', () => {
      world.layout = new Layout();
    }],
    ['Turning the walnut', () => {
      buildBase(world);
      buildCase(world);
      buildMoon(world);
    }],
    ['Shaping the hills', () => {
      buildTerrain(world);
      buildRiverDetails(world);
    }],
    ['Raising the village', () => {
      buildVillage(world);
      buildChurch(world);
      buildBridge(world);
      buildStoneBridge(world);
      registerFlicker(world);
    }],
    ['Planting the woods', () => buildTrees(world)],
    ['Bringing in the harvest', () => buildFarm(world)],
    ['Saddling the horses', () => buildChase(world)],
    ['Waking the owls', () => {
      buildWildlife(world);
      buildAtmosphere(world);
    }],
    ['Setting the glass', () => {
      scene.add(world.batcher.build());
    }],
  ];

  for (let i = 0; i < steps.length; i++) {
    const [label, fn] = steps[i];
    loaderStep.textContent = `${label}…`;
    loaderFill.style.width = `${Math.round((i / steps.length) * 100)}%`;
    await nextFrame();
    await fn();
  }
  loaderFill.style.width = '100%';

  if (CAPTURE) {
    // promo video: frames are stepped and rendered on request, not by the clock
    const { installCapture } = await import('./capture.js');
    installCapture(world, composer);
    loader.style.display = 'none';
    window.__diorama = world;
    return;
  }

  const controls = new CaseControls(camera, canvas);
  world.controls = controls;
  world.music = music;

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const realDt = Math.min(timer.getDelta(), 0.1);
    sim.realTime += realDt;
    const dt = sim.running ? realDt : 0;
    sim.time += dt;
    for (const u of world.updaters) u(dt, sim.time, sim);
    controls.update(realDt);
    composer.render();
  });

  // compile shaders before revealing
  renderer.compile(scene, camera);
  await nextFrame();

  // Browsers only allow sound after a click or tap, so the visitor "opens the
  // case" to reveal the diorama and start the music.
  const enter = document.getElementById('enter');
  // Let the visitor see (and change) the music choice before anything plays.
  const musicChoice = document.getElementById('enter-music');
  const showChoice = () => {
    musicChoice.setAttribute('aria-pressed', music.enabled ? 'true' : 'false');
    musicChoice.querySelector('.state').textContent = music.enabled ? 'Soft music on' : 'Music off';
    musicChoice.querySelector('.action').textContent = music.enabled ? 'turn off' : 'turn on';
  };
  showChoice();
  musicChoice.addEventListener('click', () => {
    music.setPreference(!music.enabled);
    showChoice();
  });
  loader.classList.add('loaded');
  enter.hidden = false;
  musicChoice.hidden = false;
  enter.focus();
  await new Promise((resolve) => enter.addEventListener('click', resolve, { once: true }));
  music.start();
  setupUI(world);
  controls.idleTime = 0;
  document.body.classList.add('ready');
  window.__diorama = world;
  if (QUALITY.mobile) document.body.classList.add('mobile');
}

main().catch((err) => {
  console.error(err);
  loader.classList.add('error');
  loaderStep.textContent = 'The diorama could not start — this browser may not support WebGL 2.';
});
