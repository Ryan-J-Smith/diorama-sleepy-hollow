// Low-lying mist over the river, the churchyard and the hollow under the back
// hills, drawn as a post-processing pass: each view ray is marched through a
// thin volume hugging the ground and water, stopping at the scene depth. It
// replaces camera-facing puffs, which sliced into banks, bridge decks and
// gravestones with hard straight edges.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { TERRAIN, WATER_Y, smoothstep } from '../config.js';
import { CHURCHYARD } from '../world/layout.js';
import { fbm2 } from '../util/noise.js';
import { Rng } from '../util/rng.js';

const MIST_COLOR = new THREE.Color(0.5, 0.56, 0.68); // cool, lit by the moon
const THICKNESS = 0.36; // how far the layer rises above the (smoothed) ground, by default
const SWELL = 0.14; // how much its top billows up and down
const LOW_TOP = 1.1; // the highest the layer reaches, away from the church hill

// ---------------------------------------------------------------------------
// Baked textures

/**
 * What the mist is like at (x, z): mask (0..1, how much gathers there), depth
 * (how deep the layer lies) and cover (the noise level below which it breaks
 * into holes: the river is veiled almost everywhere, the churchyard only in
 * wisps between the stones).
 */
function mistAt(layout, x, z) {
  // along the river, fading out as it leaves the gorge at the back
  const river = (1 - smoothstep(0.25, 1.15, layout.streamDistance(x, z, 1.6))) * smoothstep(-5.3, -4.4, z);
  // the churchyard on its hill: shallower, so the gravestones stand out of it
  const cx = Math.max(CHURCHYARD.x0 - x, 0, x - CHURCHYARD.x1);
  const cz = Math.max(CHURCHYARD.z0 - z, 0, z - CHURCHYARD.z1);
  const church = 0.6 * (1 - smoothstep(0, 0.45, Math.hypot(cx, cz)));
  // the hollow at the foot of the back hills, its edges wandering
  const wander = 0.35 * fbm2(x * 0.4 - 7, z * 0.4 + 2, 2);
  const hollow = 0.55 * smoothstep(-2.5, -3.1, z + wander) * (1 - smoothstep(-3.9, -4.5, z - wander)) * (1 - smoothstep(5.0, 7.0, Math.abs(x)));
  const sum = river + church + hollow;
  const depth = sum > 0 ? (0.38 * river + 0.2 * church + 0.4 * hollow) / sum : THICKNESS;
  const cover = sum > 0 ? (0.3 * river + 0.5 * church + 0.45 * hollow) / sum : 0.4;
  // patchy, and never up against the glass
  const patch = 0.6 + 0.4 * (0.5 + 0.5 * fbm2(x * 0.35 + 11, z * 0.35 - 3, 2));
  const edge = Math.min(TERRAIN.hx - Math.abs(x), TERRAIN.hz - Math.abs(z));
  return { mask: Math.max(river, church, hollow) * patch * smoothstep(0.1, 0.8, edge), depth, cover };
}

/** Separable box blur (two passes) over an nx * nz grid, clamped at the edges. */
function blurGrid(src, nx, nz, r) {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[iz * nx + Math.min(nx - 1, Math.max(0, ix + k))];
        b[iz * nx + ix] = sum / (2 * r + 1);
      }
    }
    const c = new Float32Array(a.length);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += b[Math.min(nz - 1, Math.max(0, iz + k)) * nx + ix];
        c[iz * nx + ix] = sum / (2 * r + 1);
      }
    }
    a = c;
  }
  return a;
}

/**
 * The layer's footprint on the heightfield grid: ground (or water) height,
 * mist mask, the height of the layer's top and its cover, plus two bounding boxes for
 * the ray march (the churchyard hill stands higher than everything else, so it
 * gets its own box and rays over the low ground march a thinner slab).
 */
function bakeTerrain(layout) {
  const { NX, NZ, dx, dz, heights } = layout;
  const ground = heights.map((h) => Math.max(h, WATER_Y));
  // the top follows the ground smoothed out, so mist pools in the river
  // channel and thins over knolls instead of climbing every bank
  const floor = blurGrid(ground, NX, NZ, 5);
  const data = new Uint16Array(NX * NZ * 4);
  const boxes = [new THREE.Box3(), new THREE.Box3()];
  const p = new THREE.Vector3();
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let iz = 0; iz < NZ; iz++) {
    const z = -TERRAIN.hz + iz * dz;
    for (let ix = 0; ix < NX; ix++) {
      const x = -TERRAIN.hx + ix * dx;
      const i = iz * NX + ix;
      const { mask: m, depth, cover } = mistAt(layout, x, z);
      const hill = layout.inRect(CHURCHYARD, x, z, 0.8);
      // pools, but not too deep, and away from the church hill it never
      // climbs the slopes of the gorge
      const top = Math.min(floor[i] + depth, ground[i] + 1.6 * depth, hill ? Infinity : LOW_TOP);
      data[i * 4] = toHalf(ground[i]);
      data[i * 4 + 1] = toHalf(m);
      data[i * 4 + 2] = toHalf(top);
      data[i * 4 + 3] = toHalf(cover);
      if (m < 0.004 || top + SWELL < ground[i]) continue;
      const box = boxes[hill ? 1 : 0];
      box.expandByPoint(p.set(x - dx, ground[i], z - dz));
      box.expandByPoint(p.set(x + dx, top + SWELL, z + dz));
    }
  }
  // an empty box collapses to a point under the base, which no ray reaches
  for (const b of boxes) if (b.isEmpty()) b.set(p.set(0, -10, 0), p);
  const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // world (x, z) -> texel centres
  const xf = new THREE.Vector4(1 / (dx * NX), 1 / (dz * NZ), (TERRAIN.hx / dx + 0.5) / NX, (TERRAIN.hz / dz + 0.5) / NZ);
  return { tex, xf, boxes };
}

/** Tiling 3D gradient noise (fBm, three octaves) in a small repeating volume. */
function bakeNoise(size = 32) {
  const rng = new Rng(23);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const G = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  // gradient noise whose lattice wraps every `period` cells
  const noise = (x, y, z, period) => {
    const X = Math.floor(x);
    const Y = Math.floor(y);
    const Z = Math.floor(z);
    const fx = x - X;
    const fy = y - Y;
    const fz = z - Z;
    const corner = (i, j, k) => {
      const h = perm[(perm[(perm[(X + i) % period] + ((Y + j) % period)) & 255] + ((Z + k) % period)) & 255] % 12;
      const g = G[h];
      return g[0] * (fx - i) + g[1] * (fy - j) + g[2] * (fz - k);
    };
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);
    return lerp(
      lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), u), lerp(corner(0, 1, 0), corner(1, 1, 0), u), v),
      lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), u), lerp(corner(0, 1, 1), corner(1, 1, 1), u), v),
      w,
    );
  };
  const raw = new Float32Array(size ** 3);
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let sum = 0;
        let amp = 1;
        for (let period = 4; period <= 16; period *= 2) {
          const s = period / size;
          sum += amp * noise(i * s, j * s, k * s, period);
          amp *= 0.5;
        }
        raw[(k * size + j) * size + i] = sum;
      }
    }
  }
  // equalise, so values are spread evenly over 0..1 and the shader's
  // thresholds say directly how much of the mist is holes
  const order = Array.from(raw.keys()).sort((a, b) => raw[a] - raw[b]);
  const data = new Uint8Array(raw.length);
  order.forEach((idx, rank) => {
    data[idx] = Math.round((rank / (raw.length - 1)) * 255);
  });
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Shaders

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// How much moonlight reaches the mist, per texel of the terrain grid, at the
// bottom (r) and top (g) of the layer. Re-rendered each frame from the moon's
// shadow map, blurred over a small disc: sampled directly inside the march,
// thin branch shadows slice the volume far finer than the steps and turn to
// grain; a soft light map is closer to how mist scatters anyway.
const lightShader = /* glsl */ `
  uniform sampler2D tTerrain;
  uniform sampler2DShadow tShadow;
  uniform mat4 uShadowMatrix;
  uniform float uShadowBias;
  uniform vec3 uToMoon;
  uniform vec4 uTerrainXf;
  varying vec2 vUv;

  const vec2 DISC[8] = vec2[8](
    vec2(0.0, 0.0), vec2(0.7, 0.1), vec2(-0.5, 0.55), vec2(-0.35, -0.65),
    vec2(0.45, -0.6), vec2(0.15, 0.95), vec2(-0.95, -0.05), vec2(0.95, 0.4)
  );

  float moonlight(vec3 p) {
    float sum = 0.0;
    for (int i = 0; i < 8; i++) {
      // nudged towards the moon so the ground doesn't shadow the mist on it
      vec3 q = p + vec3(DISC[i].x, 0.0, DISC[i].y) * 0.1 + uToMoon * 0.05;
      vec4 s = uShadowMatrix * vec4(q, 1.0);
      sum += texture(tShadow, vec3(s.xy, s.z + uShadowBias));
    }
    return sum / 8.0;
  }

  void main() {
    vec4 ter = texture2D(tTerrain, vUv);
    vec2 xz = (vUv - uTerrainXf.zw) / uTerrainXf.xy;
    float base = moonlight(vec3(xz.x, ter.r, xz.y));
    float top = moonlight(vec3(xz.x, max(ter.b, ter.r + 0.1), xz.y));
    gl_FragColor = vec4(base, top, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tColor;
  uniform highp sampler2D tDepth;
  uniform sampler2D tTerrain;
  uniform sampler2D tLight;
  uniform sampler3D tNoise;
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  uniform vec3 uBoxMin[2];
  uniform vec3 uBoxMax[2];
  uniform vec4 uTerrainXf;
  uniform vec3 uDrift0;
  uniform vec3 uDrift1;
  uniform vec3 uColor;
  uniform float uDensity;
  varying vec2 vUv;

  const float SWELL = ${SWELL.toFixed(3)};
  const float WISP_SOFT = 0.4; // noise range over which a wisp thickens from nothing
  const float SKYLIGHT = 0.45; // what's left in the moon's shadow, under trees and bridges
  const float MAX_OPACITY = 0.5;

  // Interleaved gradient noise: a fixed per-pixel offset for the march that
  // hides banding and, not changing from frame to frame, never sparkles.
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  // Ray entry and exit distances for a box (entry clamped to the camera).
  vec2 slab(vec3 ro, vec3 inv, vec3 bmin, vec3 bmax) {
    vec3 a = (bmin - ro) * inv;
    vec3 b = (bmax - ro) * inv;
    vec3 lo = min(a, b);
    vec3 hi = max(a, b);
    return vec2(max(max(lo.x, lo.y), max(lo.z, 0.0)), min(min(hi.x, hi.y), hi.z));
  }

  // The layer thins with height as (1 - u)^2, u = 0 on the ground, 1 at its
  // top. This is its integral from the ground up to u.
  float rise(float u) {
    float v = 1.0 - clamp(u, 0.0, 1.0);
    return (1.0 - v * v * v) / 3.0;
  }

  // Optical depth over one step of the ray, [ta, ta + dt], sampled at p, and
  // how brightly the mist there is lit. The height profile is integrated
  // exactly across the step (so a few steps through a thin layer don't band);
  // the noise is sampled at p.
  float stepDensity(vec3 ro, vec3 rd, float ta, float dt, vec3 p, out float lit) {
    lit = 0.0;
    vec2 uv = p.xz * uTerrainXf.xy + uTerrainXf.zw;
    vec4 ter = texture2D(tTerrain, uv);
    float ya = ro.y + rd.y * ta;
    float yb = ya + rd.y * dt;
    if (ter.g < 0.004 || max(ya, yb) < ter.r || min(ya, yb) > ter.b + SWELL) return 0.0;
    // flattened wisps: ground mist lies in sheets, and it changes slowly
    // with height so a jittered step through it samples much the same value
    float big = texture(tNoise, p * vec3(0.11, 0.12, 0.11) + uDrift0).r;
    float fine = texture(tNoise, p * vec3(0.3, 0.3, 0.3) + uDrift1).r;
    // the top of the layer billows up and down with the large-scale noise
    float depth = max(ter.b + (big - 0.5) * 2.0 * SWELL - ter.r, 0.03);
    float ua = (ya - ter.r) / depth;
    float span = (yb - ya) / depth;
    span = abs(span) < 1e-3 ? 1e-3 : span;
    float profile = (rise(ua + span) - rise(ua)) / span;
    // wisps, and holes where the noise falls below the local cover level
    float wisp = smoothstep(ter.a, ter.a + WISP_SOFT, 0.55 * fine + 0.45 * big);
    // lit by the moon where it reaches, the top of the layer a little more
    // than its base (taken at the step's middle, not the jittered point: no grain)
    float up = clamp(ua + 0.5 * span, 0.0, 1.0);
    vec2 moon = texture2D(tLight, uv).rg;
    lit = mix(SKYLIGHT, 1.0, mix(moon.r, moon.g, up)) * (0.6 + 0.3 * up);
    return ter.g * wisp * profile * dt;
  }

  // The span of the view ray through uv that crosses the mist's boxes (the
  // union of both); false if it misses them, as most of the frame does.
  bool mistSpan(vec2 uv, out vec3 ro, out vec3 rd, out float tin, out float tout) {
    ro = uCamWorld[3].xyz;
    vec4 far = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    rd = normalize(mat3(uCamWorld) * (far.xyz / far.w));
    vec3 inv = 1.0 / mix(rd, vec3(1e-6), lessThan(abs(rd), vec3(1e-6)));
    vec2 s0 = slab(ro, inv, uBoxMin[0], uBoxMax[0]);
    vec2 s1 = slab(ro, inv, uBoxMin[1], uBoxMax[1]);
    bool h0 = s0.y > s0.x;
    bool h1 = s1.y > s1.x;
    tin = min(h0 ? s0.x : 1e9, h1 ? s1.x : 1e9);
    tout = max(h0 ? s0.y : 0.0, h1 ? s1.y : 0.0);
    return h0 || h1;
  }

  // Distance from the camera to whatever the ray through uv hits.
  float sceneDistance(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    vec4 hit = uProjInv * vec4(vec3(uv, depth) * 2.0 - 1.0, 1.0);
    return length(hit.xyz / hit.w);
  }

  // Marches the ray through uv: (light, veil), the mist's brightness (times
  // uColor) and opacity. dist is the scene distance, or 0 if the ray misses
  // the mist's boxes altogether.
  vec2 march(vec2 uv, float jitter, out float dist) {
    dist = 0.0;
    vec3 ro, rd;
    float tin, tout;
    if (!mistSpan(uv, ro, rd, tin, tout)) return vec2(0.0);
    // stop at whatever the ray hits first
    dist = sceneDistance(uv);
    tout = min(tout, dist);
    if (tout <= tin) return vec2(0.0);
    float dt = (tout - tin) / float(STEPS);
    float T = 1.0;
    float light = 0.0;
    for (int i = 0; i < STEPS; i++) {
      float ta = tin + float(i) * dt;
      vec3 p = ro + rd * (ta + dt * jitter);
      float lit;
      float tau = stepDensity(ro, rd, ta, dt, p, lit) * uDensity;
      if (tau > 0.0) {
        float a = 1.0 - exp(-tau);
        light += T * a * lit;
        T *= 1.0 - a;
      }
    }
    // Seen edge-on the layer would thicken into a white wall: ease the total
    // opacity towards a ceiling so it stays a veil (thin mist is unchanged).
    float opacity = 1.0 - T;
    float veil = MAX_OPACITY * (1.0 - exp(-opacity / MAX_OPACITY));
    return vec2(light * veil / max(opacity, 1e-5), veil);
  }

  #if defined(MIST_LOW)

  // Phones, first half: march at half resolution, keeping the scene distance
  // for the upsample.
  void main() {
    float dist;
    vec2 m = march(vUv, ign(gl_FragCoord.xy), dist);
    gl_FragColor = vec4(m, dist, 1.0);
  }

  #elif defined(MIST_UPSAMPLE)

  uniform sampler2D tMist;
  uniform vec2 uMistSize;

  // Weight for a half-resolution sample by how close its scene distance is to
  // this pixel's, so mist doesn't bleed across the edges of nearer things.
  float nearness(float d, float dist) {
    float r = abs(d - dist) / (0.02 * dist);
    return 1.0 / (1.0 + r * r);
  }

  // Phones, second half: upsample the half-resolution mist over the scene.
  void main() {
    vec4 scene = texture2D(tColor, vUv);
    vec3 ro, rd;
    float tin, tout;
    if (!mistSpan(vUv, ro, rd, tin, tout)) {
      gl_FragColor = scene;
      return;
    }
    float dist = sceneDistance(vUv);
    if (dist <= tin) {
      gl_FragColor = scene;
      return;
    }
    // Away from edges, a small tent of four bilinear fetches: smooths out the
    // march's per-pixel jitter, which half resolution would otherwise enlarge.
    vec2 o = 0.5 / uMistSize;
    vec3 s0 = texture2D(tMist, vUv + vec2(-o.x, -o.y)).xyz;
    vec3 s1 = texture2D(tMist, vUv + vec2(o.x, -o.y)).xyz;
    vec3 s2 = texture2D(tMist, vUv + vec2(-o.x, o.y)).xyz;
    vec3 s3 = texture2D(tMist, vUv + vec2(o.x, o.y)).xyz;
    vec2 m = (s0.xy + s1.xy + s2.xy + s3.xy) * 0.25;
    vec4 dz = abs(vec4(s0.z, s1.z, s2.z, s3.z) - dist);
    if (max(max(dz.x, dz.y), max(dz.z, dz.w)) > 0.01 * dist) {
      // near an edge: weight the four samples by how near they are in depth
      vec2 st = vUv * uMistSize - 0.5;
      vec2 f = fract(st);
      ivec2 c = ivec2(floor(st));
      ivec2 top = ivec2(uMistSize) - 1;
      vec3 a = texelFetch(tMist, clamp(c, ivec2(0), top), 0).xyz;
      vec3 b = texelFetch(tMist, clamp(c + ivec2(1, 0), ivec2(0), top), 0).xyz;
      vec3 g = texelFetch(tMist, clamp(c + ivec2(0, 1), ivec2(0), top), 0).xyz;
      vec3 h = texelFetch(tMist, clamp(c + ivec2(1, 1), ivec2(0), top), 0).xyz;
      vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
      w *= vec4(nearness(a.z, dist), nearness(b.z, dist), nearness(g.z, dist), nearness(h.z, dist));
      w /= max(w.x + w.y + w.z + w.w, 1e-6);
      m = a.xy * w.x + b.xy * w.y + g.xy * w.z + h.xy * w.w;
    }
    gl_FragColor = vec4(scene.rgb * (1.0 - m.y) + uColor * m.x, scene.a);
  }

  #else

  // Desktop: march every pixel and blend over the scene in one go.
  void main() {
    vec4 scene = texture2D(tColor, vUv);
    float dist;
    vec2 m = march(vUv, ign(gl_FragCoord.xy), dist);
    gl_FragColor = vec4(scene.rgb * (1.0 - m.y) + uColor * m.x, scene.a);
  }

  #endif
`;

// ---------------------------------------------------------------------------

const fract = (v) => v - Math.floor(v);

export class MistPass extends Pass {
  /**
   * Disabled until setTerrain() gives it the landscape to lie on.
   * steps: march steps per ray. half: march at half resolution and upsample
   * (phones); both materials are made, but only the one in use is compiled.
   */
  constructor(camera, { steps = 10, half = false } = {}) {
    super();
    this.enabled = false;
    this.half = half;
    this.moon = null;
    this.lightTarget = null;
    // (light, veil, scene distance) per half-resolution pixel, for phones
    this.halfTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      tTerrain: { value: null },
      tLight: { value: null },
      tNoise: { value: null },
      uProjInv: { value: camera.projectionMatrixInverse },
      uCamWorld: { value: camera.matrixWorld },
      uBoxMin: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uBoxMax: { value: [new THREE.Vector3(), new THREE.Vector3()] },
      uTerrainXf: { value: new THREE.Vector4() },
      uDrift0: { value: new THREE.Vector3() },
      uDrift1: { value: new THREE.Vector3() },
      uColor: { value: MIST_COLOR },
      uDensity: { value: 2.7 },
      tMist: { value: this.halfTarget.texture },
      uMistSize: { value: new THREE.Vector2(1, 1) },
    };
    this.lightUniforms = {
      tTerrain: this.uniforms.tTerrain,
      uTerrainXf: this.uniforms.uTerrainXf,
      tShadow: { value: null },
      uShadowMatrix: { value: new THREE.Matrix4() },
      uShadowBias: { value: 0 },
      uToMoon: { value: new THREE.Vector3(0, 1, 0) },
    };
    const material = (name, uniforms, fragment, defines = {}) =>
      new THREE.ShaderMaterial({ name, defines, uniforms, vertexShader, fragmentShader: fragment, depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(material('Mist', this.uniforms, fragmentShader, { STEPS: steps }));
    this.halfQuad = new FullScreenQuad(material('MistHalf', this.uniforms, fragmentShader, { STEPS: steps, MIST_LOW: 1 }));
    this.upsampleQuad = new FullScreenQuad(material('MistUpsample', this.uniforms, fragmentShader, { STEPS: steps, MIST_UPSAMPLE: 1 }));
    this.lightQuad = new FullScreenQuad(material('MistLight', this.lightUniforms, lightShader));
  }

  setSize(width, height) {
    this.halfTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
    this.uniforms.uMistSize.value.set(this.halfTarget.width, this.halfTarget.height);
  }

  setTerrain(layout) {
    const { tex, xf, boxes } = bakeTerrain(layout);
    const u = this.uniforms;
    u.tTerrain.value = tex;
    u.tNoise.value = bakeNoise();
    u.uTerrainXf.value.copy(xf);
    boxes.forEach((b, i) => {
      u.uBoxMin.value[i].copy(b.min);
      u.uBoxMax.value[i].copy(b.max);
    });
    // the light map shares the heightfield's grid
    this.lightTarget = new THREE.WebGLRenderTarget(layout.NX, layout.NZ, {
      format: THREE.RGFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    u.tLight.value = this.lightTarget.texture;
    this.enabled = true;
  }

  /** The moon's shadow darkens the mist under trees and bridges. */
  setMoon(light) {
    this.moon = light;
    const u = this.lightUniforms;
    u.uShadowMatrix.value = light.shadow.matrix;
    u.uShadowBias.value = light.shadow.bias;
    u.uToMoon.value.subVectors(light.position, light.target.position).normalize();
  }

  /** Simulation time: two layers of noise drifting at different rates, so the mist changes shape as it moves. */
  setTime(t) {
    this.uniforms.uDrift0.value.set(fract(-t * 0.004), 0, fract(-t * 0.0015));
    this.uniforms.uDrift1.value.set(fract(-t * 0.009), fract(t * 0.002), fract(-t * 0.003));
  }

  render(renderer, writeBuffer, readBuffer) {
    // the moon's shadow map is redrawn by the scene render just before this pass
    const shadowMap = this.moon?.shadow.map;
    if (shadowMap) {
      this.lightUniforms.tShadow.value = shadowMap.depthTexture;
      renderer.setRenderTarget(this.lightTarget);
      this.lightQuad.render(renderer);
    }
    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    if (this.half) {
      renderer.setRenderTarget(this.halfTarget);
      this.halfQuad.render(renderer);
    }
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    // nothing reads this target's depth, so skip resolving it
    const resolveDepth = writeBuffer.resolveDepthBuffer;
    writeBuffer.resolveDepthBuffer = false;
    (this.half ? this.upsampleQuad : this.quad).render(renderer);
    writeBuffer.resolveDepthBuffer = resolveDepth;
  }

  dispose() {
    for (const q of [this.quad, this.halfQuad, this.upsampleQuad, this.lightQuad]) q.material.dispose();
    this.quad.dispose();
    this.halfTarget.dispose();
    this.lightTarget?.dispose();
    this.uniforms.tTerrain.value?.dispose();
    this.uniforms.tNoise.value?.dispose();
  }
}
