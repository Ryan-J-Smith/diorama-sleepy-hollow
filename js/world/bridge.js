// The covered bridge over the brook — where Ichabod hoped the goblin would
// vanish "in a flash of fire and brimstone".

import * as THREE from 'three';
import { boxUV, mergeAll, paint } from '../util/geom.js';
import { signTexture } from '../util/textures.js';
import { Rng } from '../util/rng.js';
import { surface, plain } from './kit.js';
import { makeLantern, groundGlow } from './props.js';

const L = 2.1; // length along the road
const WI = 0.68; // inner width
const HW = 1.02; // wall height (tall enough for a hay wagon — or a horseman)
const RISE = 0.32;
const T = 0.03; // board thickness

export function buildBridge(world) {
  const { layout, batcher } = world;
  const br = layout.bridge;
  const g = new THREE.Group();
  g.position.set(br.x, br.y, br.z);
  g.rotation.y = Math.atan2(-br.tz, br.tx);

  const red = surface('board', '#7a2c21', { roughness: 0.9 });
  const roofMat = surface('shingle', '#3a3532', { roughness: 0.95 });
  const deckMat = surface('plank', '#5b4431', { roughness: 0.9 });
  const beamMat = plain('#3b2a1f', { roughness: 0.9 });
  const trimMat = plain('#d9d0bd', { roughness: 0.85 });
  const stone = surface('stone', '#8f887c', { roughness: 0.95 });

  // deck and floor beams
  const deck = new THREE.Mesh(boxUV(new THREE.BoxGeometry(L + 0.1, 0.06, WI + 0.16), 1.6), deckMat);
  deck.position.y = -0.03;
  deck.receiveShadow = true;
  g.add(deck);
  const stringer = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, 0.06), beamMat);
  for (const sz of [-1, 1]) {
    const s = stringer.clone();
    s.position.set(0, -0.1, sz * (WI / 2 + 0.03));
    g.add(s);
  }

  // side walls with a strip of windows
  const sideShape = new THREE.Shape();
  sideShape.moveTo(-L / 2, 0);
  sideShape.lineTo(L / 2, 0);
  sideShape.lineTo(L / 2, HW);
  sideShape.lineTo(-L / 2, HW);
  sideShape.lineTo(-L / 2, 0);
  const nWin = 4;
  const span = L - 0.5;
  const ww = span / nWin - 0.1;
  for (let k = 0; k < nWin; k++) {
    const cx = -span / 2 + (k + 0.5) * (span / nWin);
    const hole = new THREE.Path();
    hole.moveTo(cx - ww / 2, 0.5);
    hole.lineTo(cx + ww / 2, 0.5);
    hole.lineTo(cx + ww / 2, 0.68);
    hole.lineTo(cx - ww / 2, 0.68);
    hole.lineTo(cx - ww / 2, 0.5);
    sideShape.holes.push(hole);
  }
  const sideGeo = boxUV(new THREE.ExtrudeGeometry(sideShape, { depth: T, bevelEnabled: false }), 1.8);
  for (const sz of [-1, 1]) {
    const wall = new THREE.Mesh(sideGeo, red);
    wall.position.z = sz * (WI / 2) + (sz > 0 ? 0 : -T);
    wall.castShadow = true;
    wall.receiveShadow = true;
    g.add(wall);
  }
  // Town lattice-ish trusses visible through the windows
  for (const sz of [-1, 1]) {
    for (let k = -3; k <= 3; k++) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.2, 0.02), beamMat);
      brace.position.set(k * 0.28, HW / 2, sz * (WI / 2 - 0.02));
      brace.rotation.z = k % 2 ? 0.7 : -0.7;
      g.add(brace);
    }
    const chord = new THREE.Mesh(new THREE.BoxGeometry(L, 0.04, 0.03), beamMat);
    chord.position.set(0, HW - 0.04, sz * (WI / 2 - 0.02));
    g.add(chord);
  }

  // portals (gable ends) with the carriage opening
  const outer = WI / 2 + T;
  const portal = new THREE.Shape();
  portal.moveTo(-outer, 0);
  portal.lineTo(outer, 0);
  portal.lineTo(outer, HW);
  portal.lineTo(0, HW + RISE);
  portal.lineTo(-outer, HW);
  portal.lineTo(-outer, 0);
  const ow = 0.29;
  const oh = 0.94;
  const opening = new THREE.Path();
  opening.moveTo(-ow, 0);
  opening.lineTo(ow, 0);
  opening.lineTo(ow, oh - 0.08);
  opening.lineTo(ow - 0.08, oh);
  opening.lineTo(-ow + 0.08, oh);
  opening.lineTo(-ow, oh - 0.08);
  opening.lineTo(-ow, 0);
  portal.holes.push(opening);
  let portalGeo = new THREE.ExtrudeGeometry(portal, { depth: 0.035, bevelEnabled: false });
  portalGeo.translate(0, 0, -0.0175);
  portalGeo.rotateY(Math.PI / 2);
  portalGeo = boxUV(portalGeo, 1.8);
  const signTex = signTexture(['WALK YOUR HORSE'], { w: 512, h: 88, bg: '#e6dcc4', fg: '#2a1c14', border: false });
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(portalGeo, red);
    p.position.x = sx * (L / 2);
    p.castShadow = true;
    g.add(p);
    // white trim around the opening
    const trimTop = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, ow * 2 - 0.1), trimMat);
    trimTop.position.set(sx * (L / 2 + 0.02), oh + 0.01, 0);
    g.add(trimTop);
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, oh - 0.06, 0.03), trimMat);
      post.position.set(sx * (L / 2 + 0.02), (oh - 0.06) / 2, sz * (ow + 0.012));
      g.add(post);
    }
    // the famous (and ignored) sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.086), signMat);
    sign.position.set(sx * (L / 2 + 0.022), HW + 0.06, 0);
    sign.rotation.y = sx * Math.PI / 2;
    g.add(sign);
  }

  // roof
  const slope = Math.hypot(outer + 0.1, RISE);
  const theta = Math.atan2(RISE, outer);
  for (const sz of [-1, 1]) {
    const slab = new THREE.Mesh(boxUV(new THREE.BoxGeometry(L + 0.24, 0.045, slope + 0.08), 1.7), roofMat);
    slab.position.set(0, HW + RISE / 2 + 0.03, sz * (outer / 2 + 0.02));
    slab.rotation.x = sz * theta;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(L + 0.26, 0.04, 0.05), plain('#2a2624'));
  ridge.position.set(0, HW + RISE + 0.04, 0);
  g.add(ridge);
  // dark ceiling so light from inside doesn't leak through the roof gap
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(L, WI + 0.06), plain('#1e1612', { side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = HW;
  g.add(ceiling);

  // stone abutments at each end
  for (const sx of [-1, 1]) {
    const ab = new THREE.Mesh(boxUV(new THREE.BoxGeometry(0.5, 0.62, WI + 0.36), 1.4), stone);
    ab.position.set(sx * (L / 2 - 0.2), -0.37, 0);
    ab.receiveShadow = true;
    ab.castShadow = true;
    g.add(ab);
  }

  // lanterns: one hanging inside, one at the village-side portal
  const inside = makeLantern(world, { light: true, intensity: 1.0, distance: 1.9 });
  inside.position.set(0, HW - 0.12, WI / 2 - 0.1);
  g.add(inside);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 4), plain('#1b1a1c', { metalness: 0.6 }));
  chain.position.set(0, HW - 0.04, WI / 2 - 0.1);
  g.add(chain);
  const portalLantern = makeLantern(world, { light: false, scale: 0.9 });
  portalLantern.position.set(-(L / 2 + 0.06), 0.72, ow + 0.14);
  g.add(portalLantern);

  g.updateMatrixWorld(true);
  const lp = new THREE.Vector3(-(L / 2 + 0.3), 0, ow + 0.1).applyMatrix4(g.matrixWorld);
  groundGlow(world, lp.x, lp.z, 0.6, 0xff9a40, 0.35);

  batcher.addObject(g, world.live);
  world.bridgeInfo = { length: L, width: WI };
}

/** Humpbacked fieldstone arch bridge where the back road crosses the river. */
export function buildStoneBridge(world) {
  const { layout, batcher } = world;
  const br = layout.stoneBridge;
  const g = new THREE.Group();
  g.position.set(br.x, br.y, br.z);
  g.rotation.y = Math.atan2(-br.tz, br.tx);

  const stone = surface('stone', '#958d80', { roughness: 0.95 });
  // dressed arch stones: faceted and plain, tinted stone by stone
  const ringStone = plain('#b3aa98', { roughness: 0.9, flat: true, vertexColors: true });
  const coping = surface('stone', '#7a746a', { roughness: 0.9 });

  const humpSpan = br.halfLen + 0.25;
  const top = (x) => (Math.abs(x) < humpSpan ? br.hump * Math.cos((x / humpSpan) * Math.PI / 2) ** 2 : 0);
  const half = br.halfLen + 0.12;
  const width = 0.74;

  // arch geometry: segmental arch springing just above the water
  const span = 0.56;
  const spring = -0.2;
  const apex = 0.1;
  const rise = apex - spring;
  const R = (span * span + rise * rise) / (2 * rise);
  const cy = apex - R;
  const a0 = Math.atan2(spring - cy, -span);
  const a1 = Math.atan2(spring - cy, span);
  const arc = (radius, steps = 18) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([Math.cos(a) * radius, cy + Math.sin(a) * radius]);
    }
    return pts;
  };

  const body = new THREE.Shape();
  body.moveTo(-half, -0.6);
  body.lineTo(half, -0.6);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const x = half - (2 * half * i) / steps;
    body.lineTo(x, top(x));
  }
  body.lineTo(-half, -0.6);
  const hole = new THREE.Path();
  hole.moveTo(-span, -0.48);
  for (const [x, y] of arc(R)) hole.lineTo(x, y);
  hole.lineTo(span, -0.48);
  hole.lineTo(-span, -0.48);
  body.holes.push(hole);
  const bodyGeo = boxUV(new THREE.ExtrudeGeometry(body, { depth: width, bevelEnabled: false }).translate(0, 0, -width / 2), 1.5);
  const bodyMesh = new THREE.Mesh(bodyGeo, stone);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  g.add(bodyMesh);

  // lighter voussoir ring around the arch, standing slightly proud: separate
  // wedge stones with a keystone, each a touch different in size and tone
  const rng = new Rng(186);
  const count = 13;
  const joint = 0.011 / R; // angular width of a mortar joint
  const r0 = R - 0.003; // a hair inside the barrel, so the soffits never fight
  const voussoirs = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < count; k++) {
      const b0 = a0 + ((a1 - a0) * k) / count + joint / 2;
      const b1 = a0 + ((a1 - a0) * (k + 1)) / count - joint / 2;
      const key = k === (count - 1) / 2;
      const r1 = R + 0.075 * (key ? 1.3 : rng.float(0.88, 1.12));
      const sh = new THREE.Shape();
      const pts = [];
      for (let i = 0; i <= 2; i++) pts.push([Math.cos(b0 + ((b1 - b0) * i) / 2), Math.sin(b0 + ((b1 - b0) * i) / 2)]);
      sh.moveTo(pts[0][0] * r0, cy + pts[0][1] * r0);
      for (const [c, s] of pts.slice(1)) sh.lineTo(c * r0, cy + s * r0);
      for (const [c, s] of pts.slice().reverse()) sh.lineTo(c * r1, cy + s * r1);
      sh.lineTo(pts[0][0] * r0, cy + pts[0][1] * r0);
      // each stone sits proud of the face by a slightly different amount
      const proud = rng.float(0.008, 0.016);
      const depth = 0.07;
      const vg = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
      vg.translate(0, 0, side * (width / 2 + proud) - (side > 0 ? depth : 0));
      const v = rng.float(0.84, 1.08);
      voussoirs.push(paint(vg, new THREE.Color(v, v * rng.float(0.97, 1.01), v * rng.float(0.92, 0.99))));
    }
  }
  const ring = new THREE.Mesh(mergeAll(voussoirs), ringStone);
  ring.castShadow = true;
  ring.receiveShadow = true;
  g.add(ring);

  // parapet walls following the hump, with a coping course
  const band = (y0, y1, thickness, mat, zc) => {
    const sh = new THREE.Shape();
    const n = 20;
    sh.moveTo(-half, top(-half) + y0);
    for (let i = 0; i <= n; i++) {
      const x = -half + (2 * half * i) / n;
      sh.lineTo(x, top(x) + y0);
    }
    for (let i = n; i >= 0; i--) {
      const x = -half + (2 * half * i) / n;
      sh.lineTo(x, top(x) + y1);
    }
    const geo = boxUV(new THREE.ExtrudeGeometry(sh, { depth: thickness, bevelEnabled: false }).translate(0, 0, zc - thickness / 2), 1.9);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  for (const side of [-1, 1]) {
    band(0, 0.1, 0.055, stone, side * (width / 2 - 0.028));
    band(0.1, 0.125, 0.075, coping, side * (width / 2 - 0.028));
  }

  batcher.addObject(g, world.live);
}
