// The display case itself: lacquered walnut base with moldings, brass plaque,
// clockwork winding key, bun feet, the glass hood with its wooden frame, and
// the moon hung from the lid on a wire.

import * as THREE from 'three';
import { BASE, CASE } from '../config.js';
import { moldingGeometry } from '../util/geom.js';
import { woodTexture, plaqueTexture, moonTexture, glowTexture } from '../util/textures.js';
import { MOON_POS } from '../core/lighting.js';

function cove(cx, cy, r, a0, a1, steps = 8) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export function buildBase(world) {
  const { envMap } = world;
  const group = new THREE.Group();
  group.name = 'base';

  const wood = new THREE.MeshPhysicalMaterial({
    map: woodTexture('walnut'),
    roughness: 0.38,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    envMap,
    envMapIntensity: 1.0,
  });
  world.materials.walnut = wood;

  const brass = new THREE.MeshStandardMaterial({
    color: 0xd6ad5c,
    metalness: 0.92,
    roughness: 0.28,
    envMap,
    envMapIntensity: 1.3,
  });
  world.materials.brass = brass;

  // --- the molded body --------------------------------------------------
  const H = BASE.height;
  const profile = [
    [0.42, -H],
    [0.42, -H + 0.16],
    [0.39, -H + 0.2],
    [0.36, -H + 0.2],
    ...cove(0.36, -H + 0.36, 0.16, -Math.PI / 2, -Math.PI, 8).slice(1),
    [0.2, -H + 0.4],
    [0.14, -H + 0.44],
    [0.14, -0.4],
    ...cove(0.14, -0.28, 0.12, -Math.PI / 2, 0, 8).slice(1),
    [0.26, -0.17],
    [0.22, -0.13],
    ...cove(0.1, -0.13, 0.12, 0, Math.PI / 2, 6).slice(1),
    [0.0, 0.0],
  ];
  const body = new THREE.Mesh(moldingGeometry(profile, BASE.hx, BASE.hz, 0.12), wood);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const topGeo = new THREE.PlaneGeometry(BASE.hx * 2, BASE.hz * 2);
  topGeo.rotateX(-Math.PI / 2);
  const uv = topGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * BASE.hx * 2 * 0.12, uv.getY(i) * BASE.hz * 2 * 0.5);
  const top = new THREE.Mesh(topGeo, wood);
  top.receiveShadow = true;
  group.add(top);

  // --- bun feet -----------------------------------------------------------
  const footGeo = new THREE.SphereGeometry(0.36, 24, 12);
  footGeo.scale(1, 0.46, 1);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const f = new THREE.Mesh(footGeo, wood);
      f.position.set(sx * (BASE.hx + 0.05), -H - BASE.footHeight * 0.5, sz * (BASE.hz + 0.05));
      f.castShadow = true;
      group.add(f);
    }
  }

  // --- brass plaque -------------------------------------------------------
  // Less mirror-like than the other brass so its colour shows, plus a faint
  // glow from the brass itself (as if a lamp in the room catches it) so the
  // engraving stays readable at night from any angle.
  const plaqueTex = plaqueTexture('The Legend of Sleepy Hollow', 'Washington Irving \u00b7 1820');
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(4.3, 0.64, 0.03),
    new THREE.MeshStandardMaterial({
      map: plaqueTex,
      emissive: 0xd9ccb4,
      emissiveMap: plaqueTex,
      emissiveIntensity: 0.14,
      metalness: 0.68,
      roughness: 0.35,
      envMap,
      envMapIntensity: 1.25,
    }),
  );
  plaque.position.set(0, -0.84, BASE.hz + 0.14 + 0.012);
  group.add(plaque);
  const screwGeo = new THREE.SphereGeometry(0.03, 12, 6);
  screwGeo.scale(1, 1, 0.5);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const s = new THREE.Mesh(screwGeo, brass);
      s.position.set(sx * 2.03, -0.84 + sy * 0.24, BASE.hz + 0.14 + 0.03);
      group.add(s);
    }
  }

  // --- clockwork winding key on the right-hand side -----------------------
  const key = new THREE.Group();
  key.position.set(BASE.hx + 0.14, -0.84, 0);
  const esc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 32), brass);
  esc.rotation.z = Math.PI / 2;
  esc.position.x = 0.012;
  key.add(esc);
  const spinner = new THREE.Group();
  spinner.userData.dynamic = true;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.3, 16), brass);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.15;
  spinner.add(shaft);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), brass);
  hub.position.x = 0.3;
  spinner.add(hub);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -0.04);
  wingShape.bezierCurveTo(0.1, -0.05, 0.3, -0.16, 0.34, 0);
  wingShape.bezierCurveTo(0.3, 0.16, 0.1, 0.05, 0, 0.04);
  wingShape.lineTo(0, -0.04);
  const hole = new THREE.Path();
  hole.absellipse(0.23, 0, 0.055, 0.045, 0, Math.PI * 2, true);
  wingShape.holes.push(hole);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 12,
  });
  wingGeo.translate(0, 0, -0.0175);
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, brass);
    // flat bow plate in the x-y plane (contains the shaft), reaching along +/- y
    w.rotation.set(0, 0, side * Math.PI / 2);
    w.position.x = 0.32;
    w.castShadow = true;
    spinner.add(w);
  }
  key.add(spinner);
  group.add(key);
  world.addUpdater((dt, t, sim) => {
    if (sim.running) spinner.rotation.x -= dt * 0.55;
  });

  world.scene.add(group);
  return group;
}

export function buildCase(world) {
  const group = new THREE.Group();
  group.name = 'case';
  const wood = world.materials.walnut;
  const brass = world.materials.brass;
  const Hc = CASE.height;

  // bottom rail around the glass
  const rail = new THREE.Mesh(
    moldingGeometry(
      [
        [-0.03, 0.0],
        [0.1, 0.0],
        [0.1, 0.06],
        ...cove(0.02, 0.06, 0.08, 0, Math.PI / 2, 6).slice(1),
        [-0.03, 0.14],
        [-0.03, 0.0],
      ],
      CASE.hx,
      CASE.hz,
      0.12,
    ),
    wood,
  );
  rail.castShadow = true;
  rail.receiveShadow = true;
  group.add(rail);

  // corner posts. They and the top frame cast no shadows: the moon hangs
  // inside the case, so its light shouldn't be barred by the case's own frame
  // (the top rail used to lay a long dark stripe down the village road).
  const f = CASE.frame;
  const postGeo = new THREE.BoxGeometry(f * 1.4, Hc, f * 1.4);
  const puv = postGeo.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * 0.08, puv.getY(i) * 0.8);
  postGeo.rotateY(0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(postGeo, wood);
      p.position.set(sx * CASE.hx, Hc / 2, sz * CASE.hz);
      group.add(p);
    }
  }

  // top frame
  const topFrame = new THREE.Mesh(
    moldingGeometry(
      [
        [-0.06, 0.0],
        [0.07, 0.0],
        [0.1, 0.03],
        [0.1, 0.08],
        ...cove(0.04, 0.08, 0.06, 0, Math.PI / 2, 5).slice(1),
        [-0.06, 0.14],
        [-0.06, 0.0],
      ],
      CASE.hx,
      CASE.hz,
      0.12,
    ),
    wood,
  );
  topFrame.position.y = Hc;
  group.add(topFrame);

  // brass finials on the top corners
  const finialGeo = new THREE.SphereGeometry(0.075, 16, 10);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const b = new THREE.Mesh(finialGeo, brass);
      b.position.set(sx * CASE.hx, Hc + 0.19, sz * CASE.hz);
      group.add(b);
    }
  }

  // glass
  const glass = createGlassMaterial();
  const panels = [
    { w: CASE.hx * 2, h: Hc, pos: [0, Hc / 2, CASE.hz], rot: [0, 0, 0] },
    { w: CASE.hx * 2, h: Hc, pos: [0, Hc / 2, -CASE.hz], rot: [0, Math.PI, 0] },
    { w: CASE.hz * 2, h: Hc, pos: [CASE.hx, Hc / 2, 0], rot: [0, Math.PI / 2, 0] },
    { w: CASE.hz * 2, h: Hc, pos: [-CASE.hx, Hc / 2, 0], rot: [0, -Math.PI / 2, 0] },
    { w: CASE.hx * 2, h: CASE.hz * 2, pos: [0, Hc + 0.07, 0], rot: [-Math.PI / 2, 0, 0] },
  ];
  for (const p of panels) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), glass);
    m.name = 'glass'; // promo capture hides the panes for shots inside the case
    m.position.set(...p.pos);
    m.rotation.set(...p.rot);
    m.userData.dynamic = true;
    m.renderOrder = 10;
    group.add(m);
  }

  world.scene.add(group);
  return group;
}

/**
 * Thin display glass: faint darkening plus reflections of a lamp and a tall
 * window in the room, strongest at grazing angles.
 */
function createGlassMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      float box(vec2 p, vec2 c, vec2 h, float soft) {
        vec2 d = abs(p - c) - h;
        return 1.0 - smoothstep(0.0, soft, max(d.x, d.y));
      }

      void main() {
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 N = normalize(vWorldNormal);
        if (dot(N, V) < 0.0) N = -N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
        vec3 R = reflect(-V, N);
        vec2 sph = vec2(atan(R.x, R.z), asin(clamp(R.y, -1.0, 1.0)));

        // tall moonlit window with a cross mullion
        vec2 wc = vec2(2.03, 0.22);
        float win = box(sph, wc, vec2(0.16, 0.34), 0.02);
        float mull = max(box(sph, wc, vec2(0.012, 0.34), 0.004), box(sph, wc, vec2(0.16, 0.01), 0.004));
        win *= 1.0 - mull;
        // a second, dimmer window
        win += 0.5 * box(sph, vec2(-2.5, 0.15), vec2(0.1, 0.28), 0.03);

        // warm lamp
        vec3 L = normalize(vec3(-18.0, 9.0, 20.0));
        float lamp = pow(max(dot(R, L), 0.0), 120.0) * 2.0;

        vec3 room = mix(vec3(0.004, 0.0035, 0.003), vec3(0.012, 0.01, 0.009), smoothstep(-0.3, 0.7, R.y));
        vec3 col = room + lamp * vec3(1.2, 0.8, 0.42) + win * vec3(0.13, 0.155, 0.21);
        float a = clamp(0.01 + F * 0.16, 0.0, 0.3);
        gl_FragColor = vec4(col * (0.4 + F * 1.8), a);
      }
    `,
  });
}

export function buildMoon(world) {
  const pivot = new THREE.Group();
  pivot.position.set(MOON_POS.x, CASE.height + 0.02, MOON_POS.z);
  pivot.userData.dynamic = true;
  const drop = CASE.height + 0.02 - MOON_POS.y;
  const r = 0.46;

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(r, 48, 24),
    // bright enough to read as the moon without blooming into a lamp
    new THREE.MeshBasicMaterial({ map: moonTexture(), color: new THREE.Color(1.0, 0.98, 0.9) }),
  );
  moon.position.y = -drop;
  moon.rotation.y = -0.8;
  pivot.add(moon);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color: new THREE.Color(0.13, 0.15, 0.2),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  halo.scale.set(2.4, 2.4, 1);
  halo.position.y = -drop;
  pivot.add(halo);

  const wireLen = drop - r;
  const wire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, wireLen, 5),
    new THREE.MeshStandardMaterial({ color: 0x9a8a70, metalness: 0.8, roughness: 0.4 }),
  );
  wire.position.y = -wireLen / 2;
  pivot.add(wire);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.01, 6, 16), world.materials.brass);
  hook.position.y = -0.03;
  pivot.add(hook);

  world.scene.add(pivot);
  world.addUpdater((dt, t) => {
    pivot.rotation.z = 0.025 * Math.sin(t * 0.5);
    pivot.rotation.x = 0.018 * Math.sin(t * 0.37 + 1.0);
  });
  return pivot;
}
