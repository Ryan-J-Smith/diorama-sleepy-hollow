// Shared, cached materials so identical surfaces merge into single draw calls.

import * as THREE from 'three';
import {
  clapboardTexture,
  boardBattenTexture,
  shingleTexture,
  stoneTexture,
  stoneNormalTexture,
  plankTexture,
  doorTexture,
} from '../util/textures.js';

const cache = new Map();

function get(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

const TEXTURES = {
  clapboard: clapboardTexture,
  board: boardBattenTexture,
  shingle: shingleTexture,
  stone: stoneTexture,
  plank: plankTexture,
  door: doorTexture,
};

// Surfaces with relief: a normal map painted alongside the color texture.
const NORMALS = {
  stone: stoneNormalTexture,
};

/** Textured, tinted standard material (with relief where the surface has a normal map). */
export function surface(kind, color, { roughness = 0.88, side = THREE.FrontSide } = {}) {
  return get(`${kind}:${color}:${roughness}:${side}`, () =>
    new THREE.MeshStandardMaterial({
      map: TEXTURES[kind](),
      normalMap: NORMALS[kind]?.() ?? null,
      color: new THREE.Color(color),
      roughness,
      metalness: 0,
      side,
    }),
  );
}

/** Plain colored material; `flat` gives the faceted, hand-carved look. */
export function plain(color, { roughness = 0.85, metalness = 0, flat = false, vertexColors = false, side = THREE.FrontSide } = {}) {
  return get(`plain:${color}:${roughness}:${metalness}:${flat}:${vertexColors}:${side}`, () =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness,
      metalness,
      flatShading: flat,
      vertexColors,
      side,
    }),
  );
}

/** Warm emissive glass for lanterns (never merged with window flicker). */
export function lanternGlass(intensity = 3.2) {
  return get(`lanternGlass:${intensity}`, () =>
    new THREE.MeshStandardMaterial({
      color: 0x3a2008,
      emissive: new THREE.Color(0xffb04a),
      emissiveIntensity: intensity,
      roughness: 0.3,
    }),
  );
}

export const IRON = () => plain('#1b1a1c', { roughness: 0.55, metalness: 0.6 });
