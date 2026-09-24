// Small shared props: lamp posts, hanging lanterns, pumpkins and
// jack-o'-lanterns, and pools of warm light on the ground.

import * as THREE from 'three';
import { glowTexture, jackTextures } from '../util/textures.js';
import { noise1 } from '../util/noise.js';
import { plain, lanternGlass, IRON } from './kit.js';

const flames = []; // {light, base, seed}
const glowMats = [];

/** Ribbed pumpkin geometry; face (for carved ones) points to +z. */
export function pumpkinGeometry(r = 0.06, widthSegs = 24, heightSegs = 14) {
  const g = new THREE.SphereGeometry(r, widthSegs, heightSegs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const phi = Math.atan2(z, -x);
    const lobe = 0.5 + 0.5 * Math.cos(phi * 8);
    const k = 0.9 + 0.1 * Math.sqrt(lobe);
    const ny = y / r;
    const pole = 1 - 0.22 * Math.pow(Math.abs(ny), 5);
    p.setXYZ(i, x * k * pole, y * 0.74 * (1 - 0.1 * Math.pow(Math.abs(ny), 3)), z * k * pole);
  }
  g.computeVertexNormals();
  return g;
}

let jackMat = null;
let pumpkinStemGeo = null;

export function jackMaterial() {
  if (!jackMat) {
    const { map, emissiveMap } = jackTextures('grin');
    jackMat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: new THREE.Color(0xff9a30),
      emissiveIntensity: 2.6,
      roughness: 0.6,
    });
    jackMat.userData.base = 2.6;
    glowMats.push(jackMat);
  }
  return jackMat;
}

/** A carved, candlelit jack-o'-lantern. */
export function makeJack(scale = 1, material = jackMaterial()) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(pumpkinGeometry(0.06 * scale, 24, 14), material);
  body.position.y = 0.045 * scale;
  body.castShadow = true;
  group.add(body);
  if (!pumpkinStemGeo) {
    pumpkinStemGeo = new THREE.CylinderGeometry(0.008, 0.013, 0.04, 6);
    pumpkinStemGeo.rotateZ(0.25);
  }
  const stem = new THREE.Mesh(pumpkinStemGeo, plain('#4a4020', { roughness: 0.9 }));
  stem.scale.setScalar(scale);
  stem.position.y = 0.045 * scale + 0.06 * scale * 0.74;
  group.add(stem);
  return group;
}

/** A soft pool of lantern light painted onto the ground. */
export function groundGlow(world, x, z, radius, color = 0xff9a40, strength = 0.5) {
  const { layout } = world;
  // a ring mesh with several loops so it drapes over the terrain
  const ring = new THREE.RingGeometry(0.001, radius, 24, 5);
  ring.rotateX(-Math.PI / 2);
  const p = ring.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i) + x;
    const pz = p.getZ(i) + z;
    p.setXYZ(i, px, layout.heightAt(px, pz) + 0.025, pz);
  }
  const uv = ring.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, 0.5 + (p.getX(i) - x) / (radius * 2), 0.5 - (p.getZ(i) - z) / (radius * 2));
  }
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color: new THREE.Color(color).multiplyScalar(strength),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  mat.userData.base = strength;
  mat.userData.color = new THREE.Color(color);
  const mesh = new THREE.Mesh(ring, mat);
  mesh.renderOrder = 2;
  mesh.userData.dynamic = true;
  world.live.add(mesh);
  glowMats.push({ decal: mat, seed: x * 3.1 + z });
  return mesh;
}

/** Iron-framed lantern with glowing panes. Optional real light. */
export function makeLantern(world, { light = false, intensity = 1.4, distance = 2.6, scale = 1 } = {}) {
  const g = new THREE.Group();
  const iron = IRON();
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.07), lanternGlass(3.4));
  g.add(glass);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), iron);
      post.position.set(sx * 0.037, 0, sz * 0.037);
      g.add(post);
    }
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.05, 4), iron);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = 0.07;
  g.add(cap);
  const ringM = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 4, 8), iron);
  ringM.position.y = 0.105;
  g.add(ringM);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.015, 0.085), iron);
  bottom.position.y = -0.052;
  g.add(bottom);
  g.scale.setScalar(scale);
  if (light) {
    const l = new THREE.PointLight(0xffa24a, intensity, distance, 2);
    l.position.y = 0;
    g.add(l);
    flames.push({ light: l, base: intensity, seed: flames.length * 7.3 });
  }
  return g;
}

/** Village lamp post: iron post with a lantern on top. */
export function makeLampPost(world, opts = {}) {
  const g = new THREE.Group();
  const iron = IRON();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.56, 6), iron);
  post.position.y = 0.28;
  post.castShadow = true;
  g.add(post);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.05, 6), plain('#4a4642'));
  foot.position.y = 0.025;
  g.add(foot);
  const lantern = makeLantern(world, opts);
  lantern.position.y = 0.62;
  g.add(lantern);
  return g;
}

/** Candle flicker for lights, jack-o'-lanterns and ground glows. */
export function registerFlicker(world) {
  world.addUpdater((dt, t, sim) => {
    const rt = sim.realTime;
    for (const f of flames) {
      const n = noise1(rt * 7 + f.seed, 1) * 0.12 + noise1(rt * 19 + f.seed, 2) * 0.06;
      f.light.intensity = f.base * (0.9 + n);
    }
    for (const m of glowMats) {
      if (m.decal) {
        const n = noise1(rt * 6 + m.seed, 3) * 0.1;
        m.decal.color.copy(m.decal.userData.color).multiplyScalar(m.decal.userData.base * (0.92 + n));
      } else {
        m.emissiveIntensity = m.userData.base * (0.85 + noise1(rt * 9, 4) * 0.15);
      }
    }
  });
}
