// Moonlight, fill light, the dim room around the case, and small environment
// maps used for reflections on lacquered wood, brass and water.

import * as THREE from 'three';
import { QUALITY, TABLE_Y, BASE } from '../config.js';
import { makeCanvas, toTexture, woodTexture } from '../util/textures.js';

export const MOON_POS = new THREE.Vector3(-5.4, 5.05, -3.7);

export function createLighting(scene) {
  // Night: a dim blue sky fill and a cool, softer moon; candles and lanterns
  // stay as bright as before so they carry the warmth of the scene.
  const hemi = new THREE.HemisphereLight(0x3e4e86, 0x1a130d, 0.65);
  scene.add(hemi);

  // Moonlight: comes from the moon's side of the case, high overhead.
  const moon = new THREE.DirectionalLight(0xb4c2f4, 2.1);
  moon.position.set(-7, 16, -5);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(QUALITY.shadowSize, QUALITY.shadowSize);
  const cam = moon.shadow.camera;
  cam.left = -12.5;
  cam.right = 12.5;
  cam.top = 9.5;
  cam.bottom = -9.5;
  cam.near = 2;
  cam.far = 45;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.025;
  moon.shadow.radius = 2;
  scene.add(moon, moon.target);

  // Soft cool fill from the viewer's side so fronts of buildings still read.
  const fill = new THREE.DirectionalLight(0x5a6aa2, 0.22);
  fill.position.set(4, 6, 14);
  scene.add(fill);

  // A warm lamp in the room, off to the front-left, glancing on the base.
  const lamp = new THREE.SpotLight(0xffb27a, 30, 60, Math.PI * 0.12, 0.8, 1.2);
  lamp.position.set(-14, 4, 16);
  lamp.target.position.set(0, -1.2, 0);
  scene.add(lamp, lamp.target);

  return { hemi, moon, fill, lamp };
}

/** Dark room behind everything: warm vignette gradient. */
export function createBackdrop(scene) {
  const c = makeCanvas(512, 512);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(256, 300, 20, 256, 280, 420);
  g.addColorStop(0, '#231a14');
  g.addColorStop(0.5, '#120d0b');
  g.addColorStop(1, '#050407');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const tex = toTexture(c, { repeat: false });
  scene.background = tex;

  // The shelf/table the diorama stands on, fading into the dark.
  const wood = woodTexture('table').clone();
  wood.repeat.set(3, 12);
  wood.rotation = Math.PI / 2;
  wood.needsUpdate = true;
  const fade = makeCanvas(256, 256);
  const fctx = fade.getContext('2d');
  const fg = fctx.createRadialGradient(128, 128, 30, 128, 128, 128);
  fg.addColorStop(0, '#fff');
  fg.addColorStop(0.55, '#888');
  fg.addColorStop(1, '#000');
  fctx.fillStyle = fg;
  fctx.fillRect(0, 0, 256, 256);
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(70, 70),
    new THREE.MeshStandardMaterial({
      map: wood,
      alphaMap: toTexture(fade, { srgb: false, repeat: false }),
      transparent: true,
      roughness: 0.55,
      metalness: 0.0,
      color: 0x8a7a70,
      depthWrite: true,
    }),
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = TABLE_Y;
  table.renderOrder = -1;
  scene.add(table);

  // Soft contact shadow under the case (cheaper and softer than a shadow map).
  const sc = makeCanvas(256, 256);
  const sctx = sc.getContext('2d');
  sctx.filter = 'blur(14px)';
  sctx.fillStyle = '#000';
  sctx.fillRect(36, 44, 184, 168);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry((BASE.hx + 0.6) * 2 * 1.28, (BASE.hz + 0.6) * 2 * 1.42),
    new THREE.MeshBasicMaterial({
      map: toTexture(sc, { srgb: false, repeat: false }),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      color: 0x000000,
      alphaMap: toTexture(sc, { srgb: false, repeat: false }),
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = TABLE_Y + 0.005;
  scene.add(shadow);
  return { table };
}

/**
 * Environment used for reflections on the lacquer, brass and glass: a dark
 * room with a warm lamp and a tall moonlit window.
 */
export function createRoomEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 60),
    new THREE.MeshBasicMaterial({ color: 0x0c0a09, side: THREE.BackSide }),
  ));
  const panel = (w, h, color, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(8, 6, new THREE.Color(9, 5.5, 2.6), new THREE.Vector3(-18, 9, 20));
  panel(7, 12, new THREE.Color(1.3, 1.6, 2.6), new THREE.Vector3(24, 6, -12));
  panel(30, 6, new THREE.Color(0.12, 0.1, 0.09), new THREE.Vector3(0, 14, 0));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035);
  pmrem.dispose();
  return rt.texture;
}

/** Night sky environment for the water: deep blue with a bright moon. */
export function createSkyEnvironment(renderer) {
  const env = new THREE.Scene();
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#0a1024');
  g.addColorStop(0.5, '#1d2a4a');
  g.addColorStop(1, '#0b0d12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 128);
  const skyTex = toTexture(c, { repeat: false });
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide }),
  ));
  const moon = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13, 11) }));
  moon.position.copy(MOON_POS).normalize().multiplyScalar(30);
  env.add(moon);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.02);
  pmrem.dispose();
  return rt.texture;
}
