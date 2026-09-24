// The landscape: heightfield mesh with a hand-"painted" ground texture, the
// cut soil edge you see through the glass, and the brook and pond water.

import * as THREE from 'three';
import { TERRAIN, WATER_Y, smoothstep, clamp } from '../config.js';
import { fbm2, perlin2 } from '../util/noise.js';
import { Rng } from '../util/rng.js';
import { makeCanvas, toTexture, hexBytes, mixBytes, soilTexture, waterNormalTexture } from '../util/textures.js';
import { FIELD, CHURCHYARD, BUILDINGS } from './layout.js';

const PX_PER_UNIT = 110;

export function buildTerrain(world) {
  const { layout } = world;
  const { hx, hz, segX, segZ } = TERRAIN;

  const geo = new THREE.PlaneGeometry(hx * 2, hz * 2, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, layout.heights[i]);
  geo.computeVertexNormals();

  const groundTex = paintGround(layout);
  const mat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  world.scene.add(mesh);

  buildSkirt(world);
  buildWater(world);
  return mesh;
}

// ---------------------------------------------------------------------------

function paintGround(layout) {
  const { hx, hz } = TERRAIN;
  const W = Math.round(hx * 2 * PX_PER_UNIT);
  const H = Math.round(hz * 2 * PX_PER_UNIT);
  const toPx = (x) => ((x + hx) / (hx * 2)) * W;
  const toPy = (z) => ((z + hz) / (hz * 2)) * H;

  // 1. Low-resolution color field, upscaled for soft transitions.
  const LW = Math.round(hx * 2 * 22);
  const LH = Math.round(hz * 2 * 22);
  const low = makeCanvas(LW, LH);
  const lctx = low.getContext('2d');
  const img = lctx.createImageData(LW, LH);
  const d = img.data;

  const grassA = hexBytes('#56592a');
  const grassB = hexBytes('#7a7038');
  const dryGrass = hexBytes('#8f7d45');
  const litterA = hexBytes('#6e4020');
  const litterB = hexBytes('#86552a');
  const litterC = hexBytes('#5b3a20');
  const soil = hexBytes('#5d4630');
  const churchGrass = hexBytes('#3f4a26');
  const trampled = hexBytes('#6b5f3c');
  const mud = hexBytes('#2b261c');
  const rock = hexBytes('#5e574d');

  for (let py = 0; py < LH; py++) {
    const z = -hz + ((py + 0.5) / LH) * hz * 2;
    for (let px = 0; px < LW; px++) {
      const x = -hx + ((px + 0.5) / LW) * hx * 2;
      const h = layout.heightAt(x, z);
      const n1 = 0.5 + 0.5 * fbm2(x * 0.7, z * 0.7, 3);
      const n2 = 0.5 + 0.5 * perlin2(x * 2.1 + 9, z * 2.1);
      let col = mixBytes(grassA, grassB, n1);
      col = mixBytes(col, dryGrass, smoothstep(0.55, 0.8, n2) * 0.6);

      const forest = layout.forestDensity(x, z);
      const litter = mixBytes(mixBytes(litterA, litterB, n2), litterC, smoothstep(0.4, 0.7, n1));
      col = mixBytes(col, litter, smoothstep(0.25, 0.7, forest));

      if (layout.inRect(CHURCHYARD, x, z, -0.05)) col = mixBytes(col, churchGrass, 0.7);
      // trampled yards around houses
      let yard = 0;
      for (const b of BUILDINGS) {
        const fd = layout.footprintDistance(b, x, z);
        yard = Math.max(yard, 1 - smoothstep(0.05, 0.55, fd));
      }
      col = mixBytes(col, trampled, yard * 0.55);

      if (layout.inRect(FIELD, x, z, 0.0)) col = mixBytes(soil, dryGrass, 0.3 + 0.3 * n2);

      // steep slopes show rock
      const gx = layout.heightAt(x + 0.1, z) - layout.heightAt(x - 0.1, z);
      const gz = layout.heightAt(x, z + 0.1) - layout.heightAt(x, z - 0.1);
      const slope = Math.hypot(gx, gz) / 0.2;
      col = mixBytes(col, rock, smoothstep(0.9, 1.6, slope) * 0.6);

      // wet banks and beds
      if (h < TERRAIN.base - 0.06) col = mixBytes(col, mud, smoothstep(TERRAIN.base - 0.06, WATER_Y + 0.02, h));

      const i = (py * LW + px) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255;
    }
  }
  lctx.putImageData(img, 0, 0);

  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low, 0, 0, W, H);

  const rng = new Rng(1790);
  const U = PX_PER_UNIT;

  // 2. Fine grass/ground speckle.
  for (let k = 0; k < 60000; k++) {
    const px = rng.float(0, W);
    const py = rng.float(0, H);
    const v = rng.float(-1, 1);
    ctx.fillStyle = v > 0 ? `rgba(160,150,90,${0.08 * v})` : `rgba(20,18,8,${-0.12 * v})`;
    ctx.fillRect(px, py, rng.float(1, 3), rng.float(1, 2));
  }

  // 3. Furrows in the harvested field (rows run along x).
  {
    const x0 = toPx(FIELD.x0 + 0.05);
    const x1 = toPx(FIELD.x1 - 0.05);
    for (let z = FIELD.z0 + 0.12; z < FIELD.z1 - 0.05; z += 0.2) {
      const y = toPy(z);
      ctx.strokeStyle = 'rgba(52,38,24,0.75)';
      ctx.lineWidth = 0.075 * U;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(176,150,92,0.35)';
      ctx.lineWidth = 0.05 * U;
      ctx.beginPath();
      ctx.moveTo(x0, y + 0.09 * U);
      ctx.lineTo(x1, y + 0.09 * U);
      ctx.stroke();
    }
  }

  // 4. The road: soft verge, packed dirt, wheel ruts and a grassy crown.
  const onBridge = (i) =>
    layout.bridges.some((b) => {
      let di = Math.abs(i - b.index);
      di = Math.min(di, layout.roadN - di);
      return di < Math.round((b.halfLen - 0.05) / layout.roadStep);
    });
  const strokePath = (xs, zs, txs, tzs, n, closed, skip, width, style, offset) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width * U;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let k = 0; k <= (closed ? n : n - 1); k++) {
      const i = k % n;
      if (skip(i)) {
        pen = false;
        continue;
      }
      const x = xs[i] - tzs[i] * offset;
      const z = zs[i] + txs[i] * offset;
      if (!pen) {
        ctx.moveTo(toPx(x), toPy(z));
        pen = true;
      } else {
        ctx.lineTo(toPx(x), toPy(z));
      }
    }
    ctx.stroke();
  };
  const strokeRoad = (width, style, offset = 0) => {
    strokePath(layout.roadX, layout.roadZ, layout.roadTX, layout.roadTZ, layout.roadN, true, onBridge, width, style, offset);
    for (const sp of layout.spurs) strokePath(sp.x, sp.z, sp.tx, sp.tz, sp.x.length, false, () => false, width, style, offset);
  };
  strokeRoad(0.9, 'rgba(90,72,48,0.25)');
  strokeRoad(0.74, 'rgba(112,90,62,0.6)');
  strokeRoad(0.6, '#7d6644');
  strokeRoad(0.1, 'rgba(84,64,44,0.35)', 0.14);
  strokeRoad(0.1, 'rgba(84,64,44,0.35)', -0.14);
  strokeRoad(0.1, 'rgba(100,92,56,0.28)');

  // footpath from the road up the hill to the church door
  {
    const ch = BUILDINGS.find((b) => b.id === 'church');
    const pts = [[CHURCHYARD.x0 - 0.75, ch.z], [CHURCHYARD.x0, ch.z + 0.03], [ch.x - ch.w / 2 - 0.05, ch.z]];
    for (const [w, style] of [[0.2, 'rgba(92,76,54,0.55)'], [0.13, '#7a6546']]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = w * U;
      ctx.beginPath();
      pts.forEach(([x, z], i) => (i ? ctx.lineTo(toPx(x), toPy(z)) : ctx.moveTo(toPx(x), toPy(z))));
      ctx.stroke();
    }
  }

  // pebbles on the road
  for (let k = 0; k < 2500; k++) {
    const i = rng.int(0, layout.roadN - 1);
    const off = rng.float(-0.28, 0.28);
    const x = layout.roadX[i] - layout.roadTZ[i] * off;
    const z = layout.roadZ[i] + layout.roadTX[i] * off;
    const v = rng.float(70, 150);
    ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.8},0.7)`;
    ctx.fillRect(toPx(x), toPy(z), 2, 2);
  }

  // 5. Fallen leaves everywhere, thickest under the trees.
  const leafCols = ['#b8321f', '#d4541f', '#e08a2a', '#c9a032', '#8e3a18', '#a8471c', '#e0b040'];
  for (let k = 0; k < 70000; k++) {
    const x = rng.float(-hx, hx);
    const z = rng.float(-hz, hz);
    const f = layout.forestDensity(x, z);
    if (rng.next() > 0.12 + f * 0.9) continue;
    if (layout.inRect(FIELD, x, z, -0.05)) continue;
    if (layout.heightAt(x, z) < WATER_Y + 0.02) continue;
    ctx.fillStyle = rng.pick(leafCols);
    ctx.globalAlpha = rng.float(0.45, 0.95);
    ctx.save();
    ctx.translate(toPx(x), toPy(z));
    ctx.rotate(rng.float(0, Math.PI));
    ctx.fillRect(-1.5, -1, rng.float(2.5, 4.5), rng.float(1.5, 3));
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  const tex = toTexture(c, { repeat: false });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------------

/** The cut earth edge of the landscape, visible through the glass walls. */
function buildSkirt(world) {
  const { layout } = world;
  const { hx, hz } = TERRAIN;
  const soil = soilTexture();
  soil.wrapT = THREE.ClampToEdgeWrapping;
  soil.needsUpdate = true;

  const soilPos = [];
  const soilUv = [];
  const waterPos = [];
  const edges = [
    // [start x, start z, end x, end z, outward nx, nz]
    [-hx, hz, hx, hz, 0, 1],
    [hx, hz, hx, -hz, 1, 0],
    [hx, -hz, -hx, -hz, 0, -1],
    [-hx, -hz, -hx, hz, -1, 0],
  ];
  const steps = 240;
  for (const [x0, z0, x1, z1] of edges) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    let prev = null;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const h = layout.heightAt(x, z);
      const cur = { x, z, h, u: (t * len) / 3 };
      if (prev) {
        const quad = (ya0, ya1, yb0, yb1, arr, uvArr) => {
          // a: prev column, b: current column; 0 bottom, 1 top
          const a0 = [prev.x, ya0, prev.z];
          const a1 = [prev.x, ya1, prev.z];
          const b0 = [cur.x, yb0, cur.z];
          const b1 = [cur.x, yb1, cur.z];
          arr.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
          if (uvArr) {
            const va0 = 1 - (prev.h - ya0) * 0.55;
            const va1 = 1 - (prev.h - ya1) * 0.55;
            const vb0 = 1 - (cur.h - yb0) * 0.55;
            const vb1 = 1 - (cur.h - yb1) * 0.55;
            uvArr.push(prev.u, va0, cur.u, vb0, cur.u, vb1, prev.u, va0, cur.u, vb1, prev.u, va1);
          }
        };
        quad(0, prev.h, 0, cur.h, soilPos, soilUv);
        if (prev.h < WATER_Y || cur.h < WATER_Y) {
          quad(Math.min(prev.h, WATER_Y), WATER_Y, Math.min(cur.h, WATER_Y), WATER_Y, waterPos, null);
        }
      }
      prev = cur;
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(soilPos, 3));
  sg.setAttribute('uv', new THREE.Float32BufferAttribute(soilUv, 2));
  sg.computeVertexNormals();
  const skirt = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: soil, roughness: 1, side: THREE.DoubleSide }));
  skirt.receiveShadow = true;
  world.scene.add(skirt);

  if (waterPos.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(waterPos, 3));
    wg.computeVertexNormals();
    const cut = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({
      color: 0x1d3a44,
      roughness: 0.15,
      emissive: 0x08161c,
      side: THREE.DoubleSide,
    }));
    world.scene.add(cut);
  }
}

// ---------------------------------------------------------------------------

function buildWater(world) {
  const { layout } = world;
  const { NX, NZ, heights } = layout;
  const { hx, hz } = TERRAIN;
  const pos = [];
  const uv = [];
  for (let iz = 0; iz < NZ - 1; iz++) {
    for (let ix = 0; ix < NX - 1; ix++) {
      const i = iz * NX + ix;
      const m = Math.min(heights[i], heights[i + 1], heights[i + NX], heights[i + NX + 1]);
      if (m >= WATER_Y) continue;
      const x0 = -hx + ix * layout.dx;
      const x1 = x0 + layout.dx;
      const z0 = -hz + iz * layout.dz;
      const z1 = z0 + layout.dz;
      pos.push(x0, WATER_Y, z0, x0, WATER_Y, z1, x1, WATER_Y, z1, x0, WATER_Y, z0, x1, WATER_Y, z1, x1, WATER_Y, z0);
      for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) uv.push(x * 0.5, z * 0.5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const normalMap = waterNormalTexture();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0f1d26,
    roughness: 0.16,
    metalness: 0.2,
    normalMap,
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMap: world.skyEnv,
    envMapIntensity: 1.2,
  });
  const water = new THREE.Mesh(g, mat);
  water.receiveShadow = true;
  water.name = 'water';
  world.scene.add(water);
  world.addUpdater((dt, t) => {
    normalMap.offset.set(t * 0.012, t * 0.035);
  });
  return water;
}

export { clamp };
