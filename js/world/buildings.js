// Procedural colonial buildings: gable, Dutch gambrel and saltbox roofs, with
// candlelit windows, shutters, paneled doors, stone foundations and chimneys.
// Local frame: front wall faces +z, ridge runs along x, ground at y = 0.

import * as THREE from 'three';
import { boxUV, prism } from '../util/geom.js';
import { windowAtlas } from '../util/textures.js';
import { Rng } from '../util/rng.js';
import { surface, plain } from './kit.js';

const WIN_W = 0.15;
const WIN_H = 0.22;

/** Roof outline from the back eave to the front eave, as [z, y] points. */
function roofChain(spec) {
  const { d, wallH, roofH, roof } = spec;
  const hd = d / 2;
  if (roof === 'gambrel') {
    const bz = hd * 0.6;
    const by = wallH + roofH * 0.62;
    return [[-hd, wallH], [-bz, by], [0, wallH + roofH], [bz, by], [hd, wallH]];
  }
  if (roof === 'saltbox') {
    return [[-hd, wallH * 0.55], [hd * 0.2, wallH + roofH], [hd, wallH]];
  }
  return [[-hd, wallH], [0, wallH + roofH], [hd, wallH]];
}

/** Height of the roofline above a depth position z (for gable-end windows). */
function roofHeightAt(chain, z) {
  for (let i = 0; i < chain.length - 1; i++) {
    const [z0, y0] = chain[i];
    const [z1, y1] = chain[i + 1];
    if (z >= z0 && z <= z1) return y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
  }
  return chain[0][1];
}

/** One lit/unlit material pair per building so each house flickers on its own. */
function windowMaterials(seed) {
  const atlas = windowAtlas();
  const make = () =>
    new THREE.MeshStandardMaterial({
      map: atlas.map,
      emissive: 0xffffff,
      emissiveMap: atlas.emissiveMap,
      emissiveIntensity: 1.15,
      roughness: 0.3,
    });
  const lower = make();
  const upper = make();
  lower.userData = { base: 1.15, seed, target: 1, level: 1 };
  upper.userData = { base: 1.0, seed: seed + 0.5, target: 1, level: 1 };
  return { lower, upper };
}

function atlasPlane(w, h, cell, uv0 = [0, 0], uv1 = [1, 1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv0[0] + (uv1[0] - uv0[0]) * uv.getX(i);
    const v = uv0[1] + (uv1[1] - uv0[1]) * uv.getY(i);
    uv.setXY(i, (cell + u) / 4, v);
  }
  return g;
}

/**
 * Build a building. Returns { group, chimneys: Vector3[] (local), windows,
 * door: {x, y, z, face} }.
 */
export function makeBuilding(spec) {
  const s = {
    stories: 1,
    roof: 'gable',
    wall: 'clapboard',
    wallColor: '#d8d0bd',
    roofColor: '#4a4540',
    trimColor: '#e6e0d0',
    shutterColor: null,
    doorColor: '#4a2a1c',
    chimneys: ['right'],
    door: 'front',
    litChance: 0.8,
    wallScale: 2.2,
    frontWindows: null,
    sideWindows: null,
    gableWindows: true,
    seed: 1,
    ...spec,
  };
  const rng = new Rng(s.seed * 7919);
  const group = new THREE.Group();
  const { w, d, wallH, roofH } = s;
  const hw = w / 2;
  const hd = d / 2;

  const wallMat = surface(s.wall, s.wallColor, { roughness: 0.9 });
  const roofMat = surface('shingle', s.roofColor, { roughness: 0.95 });
  const trimMat = plain(s.trimColor, { roughness: 0.8 });
  const stoneMat = surface('stone', '#9a948a', { roughness: 0.95 });
  const { lower, upper } = windowMaterials(s.seed);

  // --- walls --------------------------------------------------------------
  const chain = roofChain(s);
  const shape = new THREE.Shape();
  shape.moveTo(-hd, 0);
  shape.lineTo(hd, 0);
  for (let i = chain.length - 1; i >= 0; i--) shape.lineTo(chain[i][0], chain[i][1]);
  shape.lineTo(-hd, 0);
  let bodyGeo = prism(shape, w);
  bodyGeo.rotateY(-Math.PI / 2);
  bodyGeo = boxUV(bodyGeo, s.wallScale, [s.seed * 0.37, 0]);
  const body = new THREE.Mesh(bodyGeo, wallMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // corner boards
  if (s.wall === 'clapboard') {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const h = sz < 0 ? chain[0][1] : wallH;
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, h, 0.035), trimMat);
        m.position.set(sx * hw, h / 2, sz * hd);
        group.add(m);
      }
    }
  }

  // --- roof slabs -----------------------------------------------------------
  const thick = 0.045;
  const eave = 0.09;
  const gableOver = 0.07;
  for (let i = 0; i < chain.length - 1; i++) {
    const [z0, y0] = chain[i];
    const [z1, y1] = chain[i + 1];
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.hypot(dz, dy);
    const ux = dz / len;
    const uy = dy / len;
    const extStart = i === 0 ? eave : thick * 0.7;
    const extEnd = i === chain.length - 2 ? eave : thick * 0.7;
    const L = len + extStart + extEnd;
    const cz = (z0 + z1) / 2 + ux * (extEnd - extStart) / 2;
    const cy = (y0 + y1) / 2 + uy * (extEnd - extStart) / 2;
    const theta = Math.atan2(-dy, dz);
    // outward normal (0, cos, sin) of the rotated slab
    const nz = Math.sin(theta);
    const ny = Math.cos(theta);
    let g = new THREE.BoxGeometry(w + gableOver * 2, thick, L);
    g.rotateX(theta);
    g.translate(0, cy + ny * thick * 0.5, cz + nz * thick * 0.5);
    g = boxUV(g, 1.7);
    const slab = new THREE.Mesh(g, roofMat);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
  }
  // ridge board
  const top = chain.reduce((a, b) => (b[1] > a[1] ? b : a));
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(w + gableOver * 2 + 0.02, 0.035, 0.05), plain('#2f2b28'));
  ridge.position.set(0, top[1] + thick * 0.9, top[0]);
  group.add(ridge);

  // --- foundation -----------------------------------------------------------
  const found = new THREE.Mesh(boxUV(new THREE.BoxGeometry(w + 0.05, 0.5, d + 0.05), 2.4), stoneMat);
  found.position.y = -0.2;
  found.receiveShadow = true;
  group.add(found);

  // --- openings ---------------------------------------------------------------
  const windows = [];
  const faces = {
    front: { n: [0, 0, 1], len: w, depth: hd },
    back: { n: [0, 0, -1], len: w, depth: hd },
    right: { n: [1, 0, 0], len: d, depth: hw },
    left: { n: [-1, 0, 0], len: d, depth: hw },
  };
  const place = (obj, face, u, y, out = 0) => {
    const f = faces[face];
    const [nx, , nz] = f.n;
    // along-face axis: front: +x, back: -x, right: -z, left: +z
    const ax = nz !== 0 ? nz : 0;
    const az = nx !== 0 ? -nx : 0;
    obj.position.set(nx * (f.depth + out) + ax * u, y, nz * (f.depth + out) + az * u);
    obj.rotation.y = Math.atan2(nx, nz);
    group.add(obj);
    return obj;
  };

  const addWindow = (face, u, y, story, { shutters = !!s.shutterColor, scale = 1 } = {}) => {
    const lit = rng.chance(s.litChance);
    const cell = lit ? rng.pick([0, 0, 0, 1, 1, 2, 2]) : 3;
    const mat = story > 0 ? upper : lower;
    const ww = WIN_W * scale;
    const wh = WIN_H * scale;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.035, wh + 0.035, 0.02), trimMat);
    place(frame, face, u, y, 0.0);
    // unlit panes use the dark atlas cell, which has no emission
    const pane = new THREE.Mesh(atlasPlane(ww, wh, cell), mat);
    place(pane, face, u, y, 0.015);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.06, 0.018, 0.04), trimMat);
    place(sill, face, u, y - wh / 2 - 0.02, 0.012);
    if (shutters && s.shutterColor) {
      const sm = plain(s.shutterColor, { roughness: 0.85 });
      for (const side of [-1, 1]) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(ww * 0.5, wh + 0.02, 0.012), sm);
        place(sh, face, u + side * (ww * 0.5 + 0.045), y, 0.008);
      }
    }
    windows.push({ face, u, y, story, lit });
  };

  const doorFace = s.door;
  const doorW = 0.2;
  const doorH = 0.36;
  const storyH = s.stories === 2 ? wallH / 2 : wallH;
  const floorY = (story) => story * storyH + Math.min(storyH * 0.52, 0.32) + (story === 0 ? 0.02 : 0);

  // does a window at (face, u, y) fit under the eaves / roofline?
  const fits = (face, u, y) => {
    const topY = y + WIN_H / 2 + 0.04;
    if (face === 'front') return topY < wallH;
    if (face === 'back') return topY < chain[0][1];
    const z = face === 'right' ? -u : u;
    return topY < Math.min(roofHeightAt(chain, z - WIN_W / 2), roofHeightAt(chain, z + WIN_W / 2));
  };

  const layoutFace = (face, count, story) => {
    const f = faces[face];
    const usable = f.len - 0.3;
    const positions = [];
    for (let k = 0; k < count; k++) positions.push(-usable / 2 + ((k + 0.5) / count) * usable);
    for (const u of positions) {
      if (story === 0 && face === doorFace && Math.abs(u) < doorW * 0.9) continue;
      const y = floorY(story);
      if (!fits(face, u, y)) continue;
      addWindow(face, u, y, story);
    }
  };

  const frontCount = s.frontWindows ?? Math.max(2, Math.round(w / 0.36));
  const sideCount = s.sideWindows ?? Math.max(1, Math.round(d / 0.5));
  for (let story = 0; story < s.stories; story++) {
    layoutFace('front', story === 0 && doorFace === 'front' ? frontCount + (frontCount % 2 === 0 ? 1 : 0) : frontCount, story);
    layoutFace('back', Math.max(1, frontCount - 1), story);
    layoutFace('right', sideCount, story);
    layoutFace('left', sideCount, story);
  }
  // half-story windows up in the gables
  if (s.gableWindows && roofH > 0.3) {
    for (const face of ['left', 'right']) {
      const peak = roofHeightAt(chain, 0);
      const y = wallH + (peak - wallH) * 0.4;
      if (y + WIN_H * 0.45 < roofHeightAt(chain, 0.08) - 0.04) {
        addWindow(face, 0, y, 1, { shutters: false, scale: 0.8 });
      }
    }
  }

  // --- door ---------------------------------------------------------------
  let door = null;
  if (doorFace !== 'none') {
    const dMat = surface('door', s.doorColor, { roughness: 0.75 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.05, doorH + 0.04, 0.02), trimMat);
    place(frame, doorFace, 0, doorH / 2 + 0.02, 0);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), dMat);
    place(leaf, doorFace, 0, doorH / 2 + 0.02, 0.012);
    // glowing transom over the door
    const transom = new THREE.Mesh(atlasPlane(doorW, 0.05, 0, [0.1, 0.55], [0.9, 0.75]), lower);
    place(transom, doorFace, 0, doorH + 0.06, 0.012);
    const step = new THREE.Mesh(boxUV(new THREE.BoxGeometry(doorW + 0.14, 0.05, 0.12), 3), stoneMat);
    place(step, doorFace, 0, 0.02, 0.06);
    const f = faces[doorFace];
    door = {
      x: f.n[0] * (f.depth + 0.2),
      y: 0,
      z: f.n[2] * (f.depth + 0.2),
      face: doorFace,
    };
  }

  // --- chimneys -------------------------------------------------------------
  const chimneys = [];
  const peakY = top[1];
  for (const where of s.chimneys) {
    const x = where === 'left' ? -hw + 0.14 : where === 'right' ? hw - 0.14 : 0;
    const z = top[0];
    const h = peakY + 0.2;
    const ch = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.16, h - wallH * 0.5, 0.18), 3), stoneMat);
    ch.position.set(x, wallH * 0.5 + (h - wallH * 0.5) / 2, z);
    ch.castShadow = true;
    group.add(ch);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.22), plain('#3a3633'));
    cap.position.set(x, h, z);
    group.add(cap);
    chimneys.push(new THREE.Vector3(x, h + 0.03, z));
  }

  return { group, chimneys, windows, door, materials: { lower, upper }, chain, spec: s };
}
