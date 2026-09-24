// Lightweight camera-facing particle system (one draw call per system).
// Used for sparks, hoof dust, chimney smoke and river mist.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute float iSize;
  attribute vec4 iColor;
  attribute float iRot;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 p = position.xy;
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    mv.xy += p * iSize;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = iColor;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(map, vUv);
    float a = vColor.a * t.a;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor.rgb * t.rgb, a);
  }
`;

export class Particles {
  constructor(max, { texture, additive = false, renderOrder = 5 } = {}) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.rot = new Float32Array(max);
    const attr = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', attr(this.pos, 3));
    g.setAttribute('iSize', attr(this.size, 1));
    g.setAttribute('iColor', attr(this.color, 4));
    g.setAttribute('iRot', attr(this.rot, 1));
    g.instanceCount = max;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.items = [];
    this.free = [];
    for (let i = max - 1; i >= 0; i--) this.free.push(i);
  }

  /**
   * p: { x, y, z, vx, vy, vz, life, size0, size1, color: Color, alpha0, alpha1,
   *      gravity, drag, rot, spin, ground: (x,z)=>y|null, fadeIn }
   */
  spawn(p) {
    if (!this.free.length) return null;
    const slot = this.free.pop();
    const item = {
      slot,
      age: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: 0,
      drag: 0,
      rot: 0,
      spin: 0,
      alpha0: 1,
      alpha1: 0,
      fadeIn: 0,
      ...p,
    };
    this.items.push(item);
    return item;
  }

  update(dt) {
    const { pos, size, color, rot } = this;
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      it.age += dt;
      const i = it.slot;
      if (it.age >= it.life) {
        size[i] = 0;
        color[i * 4 + 3] = 0;
        this.free.push(i);
        this.items[k] = this.items[this.items.length - 1];
        this.items.pop();
        continue;
      }
      const drag = Math.exp(-it.drag * dt);
      it.vx *= drag;
      it.vy = it.vy * drag + it.gravity * dt;
      it.vz *= drag;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      if (it.ground) {
        const gy = it.ground(it.x, it.z);
        if (gy !== null && it.y < gy) {
          it.y = gy;
          it.vy *= -0.3;
          it.vx *= 0.6;
          it.vz *= 0.6;
        }
      }
      it.rot += it.spin * dt;
      const t = it.age / it.life;
      pos[i * 3] = it.x;
      pos[i * 3 + 1] = it.y;
      pos[i * 3 + 2] = it.z;
      size[i] = it.size0 + (it.size1 - it.size0) * t;
      const c = it.color;
      let a = it.alpha0 + (it.alpha1 - it.alpha0) * t;
      if (it.fadeIn > 0) a *= Math.min(1, it.age / it.fadeIn);
      color[i * 4] = c.r;
      color[i * 4 + 1] = c.g;
      color[i * 4 + 2] = c.b;
      color[i * 4 + 3] = a;
      rot[i] = it.rot;
    }
    const g = this.geometry;
    g.attributes.iPos.needsUpdate = true;
    g.attributes.iSize.needsUpdate = true;
    g.attributes.iColor.needsUpdate = true;
    g.attributes.iRot.needsUpdate = true;
  }
}
