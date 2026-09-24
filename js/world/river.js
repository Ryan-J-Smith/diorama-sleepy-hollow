// River details: boulders along the waterline, wet stones mid-stream with foam
// wakes trailing behind them, and riffles of broken water that scroll
// downstream (livelier where the river leaves the gorge in the hills).

import * as THREE from 'three';
import { TERRAIN, WATER_Y } from '../config.js';
import { fbmTile } from '../util/noise.js';
import { Rng } from '../util/rng.js';
import { makeCanvas, toTexture } from '../util/textures.js';
import { CLEARINGS } from './layout.js';

/** Streaky foam, tileable so it can scroll along the flow (v axis). */
function foamTexture() {
  const w = 64;
  const h = 256;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // sampling a square noise field into a tall texture stretches it into
      // streaks along the flow
      const n = 0.5 + 0.5 * fbmTile(x / w, y / h, 6, 3);
      const a = Math.min(1, Math.max(0, (n - 0.5) * 3.2));
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, { srgb: false });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Static soft mask: 'wake' is brightest upstream and trails off; 'patch' is an oval. */
function maskTexture(kind) {
  const w = 64;
  const h = 128;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w - 0.5; // across
      const v = (y + 0.5) / h; // 0 = upstream (canvas top), 1 = downstream
      let a;
      if (kind === 'wake') {
        // a V that widens downstream and fades out
        const spread = 0.08 + 0.38 * v;
        const across = Math.max(0, 1 - Math.abs(u) / spread);
        a = Math.pow(across, 0.8) * Math.pow(1 - v, 1.3) * Math.min(1, v * 8);
      } else {
        const r = Math.hypot(u / 0.5, (v - 0.5) / 0.5);
        a = Math.max(0, 1 - r) ** 1.4;
      }
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, a * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, { srgb: false, repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildRiverDetails(world) {
  const { layout, scene } = world;
  const rng = new Rng(1809);
  const xs = layout.streamX;
  const zs = layout.streamZ;
  const n = xs.length;

  const nearBridge = (x, z) => layout.bridges.some((b) => Math.hypot(x - b.x, z - b.z) < b.halfLen + 0.3);
  const inside = (x, z) => Math.abs(x) < TERRAIN.hx - 0.08 && Math.abs(z) < TERRAIN.hz - 0.08;
  const nearFrog = (x, z) => Math.hypot(x - CLEARINGS.frog.x, z - CLEARINGS.frog.z) < 0.3;
  const flowAt = (i) => {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    const dx = xs[b] - xs[a];
    const dz = zs[b] - zs[a];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };

  // --- boulders along both waterlines ---------------------------------------
  const bank = [];
  const midstream = [];
  for (let i = 0; i < n; i += 4) {
    const [fx, fz] = flowAt(i);
    const px = -fz;
    const pz = fx; // perpendicular to the flow
    for (const side of [-1, 1]) {
      if (!rng.chance(0.8)) continue;
      // walk out from mid-river to where the bank meets the water
      let edge = 0.1;
      while (edge < 1.2 && layout.heightAt(xs[i] + px * side * edge, zs[i] + pz * side * edge) < WATER_Y + 0.015) edge += 0.02;
      const off = edge + rng.float(-0.06, 0.08);
      const x = xs[i] + px * side * off + rng.float(-0.04, 0.04);
      const z = zs[i] + pz * side * off + rng.float(-0.04, 0.04);
      if (!inside(x, z) || nearBridge(x, z) || nearFrog(x, z)) continue;
      const s = rng.float(0.7, 1.5) * (rng.chance(0.18) ? 1.7 : 1);
      bank.push({ x, z, y: Math.max(layout.heightAt(x, z), WATER_Y) - 0.012 * s, s, wet: off < edge + 0.02 });
      // sometimes a smaller stone tucked beside it
      if (rng.chance(0.35)) {
        const bx = x + rng.float(-0.09, 0.09);
        const bz = z + rng.float(-0.09, 0.09);
        if (inside(bx, bz) && !nearBridge(bx, bz)) {
          const bs = s * rng.float(0.4, 0.65);
          bank.push({ x: bx, z: bz, y: Math.max(layout.heightAt(bx, bz), WATER_Y) - 0.012 * bs, s: bs, wet: true });
        }
      }
    }
    // now and then a stone out in the current
    if (i > 6 && rng.chance(0.2)) {
      const off = rng.float(-0.22, 0.22);
      const x = xs[i] + px * off;
      const z = zs[i] + pz * off;
      if (!inside(x, z) || nearBridge(x, z)) continue;
      midstream.push({ x, z, s: rng.float(0.7, 1.2), i, fx, fz });
    }
  }

  const rockGeo = new THREE.DodecahedronGeometry(0.05, 1);
  {
    // lumpy, slightly flattened river stones
    const p = rockGeo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const f = 1 + 0.18 * Math.sin(x * 60 + z * 40) * Math.cos(y * 50);
      p.setXYZ(k, x * f * 1.25, y * f * 0.7, z * f);
    }
    rockGeo.computeVertexNormals();
  }
  const place = (inst, items, colorFn, yFn) => {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    items.forEach((r, k) => {
      q.setFromEuler(new THREE.Euler(rng.float(-0.25, 0.25), rng.float(0, Math.PI * 2), rng.float(-0.25, 0.25)));
      m4.compose(new THREE.Vector3(r.x, yFn(r), r.z), q, new THREE.Vector3(r.s, r.s * rng.float(0.8, 1.2), r.s));
      inst.setMatrixAt(k, m4);
      inst.setColorAt(k, colorFn(r, col));
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    scene.add(inst);
  };
  const bankRocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), bank.length);
  place(bankRocks, bank, (r, c) => {
    // weathered grey-brown fieldstone; darker where the water wets it
    const v = rng.float(0.2, 0.34);
    c.setRGB(v, v * 0.95, v * 0.86);
    if (rng.chance(0.3)) c.lerp(new THREE.Color(0.2, 0.27, 0.13), 0.5); // moss
    if (r.wet) c.multiplyScalar(0.72);
    return c;
  }, (r) => r.y);
  // wet stones in the current: dark with a sheen
  const wetRocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, flatShading: true }), midstream.length);
  place(wetRocks, midstream, (r, c) => {
    const v = rng.float(0.16, 0.26);
    return c.setRGB(v, v, v * 1.05);
  }, (r) => WATER_Y - 0.012 * r.s);

  // --- foam: wakes behind stones, riffles across the shallows ------------------
  const foam = foamTexture();
  const foamColor = new THREE.Color(0.66, 0.72, 0.82);
  const foamMaterial = (mask, opacity) =>
    new THREE.MeshBasicMaterial({
      map: foam,
      alphaMap: mask,
      color: foamColor,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2); // lies on the water; local +z is downstream

  const wakes = midstream.map((r) => ({
    x: r.x + r.fx * 0.17 * r.s,
    z: r.z + r.fz * 0.17 * r.s,
    w: 0.13 * r.s,
    l: 0.34 * r.s,
    fx: r.fx,
    fz: r.fz,
  }));
  const riffles = [];
  for (let i = 8; i < n; i += 10) {
    const x = xs[i];
    const z = zs[i];
    if (!inside(x, z) || nearBridge(x, z)) continue;
    const gorge = z < -4.2;
    if (!gorge && !rng.chance(0.4)) continue;
    const [fx, fz] = flowAt(i);
    riffles.push({ x, z, w: rng.float(0.35, 0.55), l: gorge ? rng.float(0.45, 0.7) : rng.float(0.25, 0.42), fx, fz });
  }

  const addFoam = (items, mask, opacity) => {
    if (!items.length) return;
    const inst = new THREE.InstancedMesh(quad, foamMaterial(mask, opacity), items.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((f, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.fx, f.fz));
      m4.compose(new THREE.Vector3(f.x, WATER_Y + 0.004, f.z), q, new THREE.Vector3(f.w, 1, f.l));
      inst.setMatrixAt(k, m4);
    });
    inst.renderOrder = 3;
    scene.add(inst);
  };
  // UV v runs upstream across each quad, and canvas row 0 maps to v = 1, so
  // the bright top of the wake mask sits at the stone
  addFoam(wakes, maskTexture('wake'), 0.95);
  addFoam(riffles, maskTexture('patch'), 0.7);

  // the foam streaks drift downstream
  foam.repeat.set(1, 1.5);
  world.addUpdater((dt, t) => {
    foam.offset.y = t * 0.22;
  });
}
