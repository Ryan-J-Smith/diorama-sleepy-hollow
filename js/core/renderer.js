// WebGL renderer + post-processing (bloom for candlelight, ACES tone mapping).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY, CAPTURE, CAPTURE_SIZE } from '../config.js';
import { MistPass } from '../fx/mist.js';

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    // capture mode reads frames back with toDataURL()
    preserveDrawingBuffer: CAPTURE,
  });
  renderer.setPixelRatio(QUALITY.pixelRatio);
  if (CAPTURE) renderer.setSize(CAPTURE_SIZE.width, CAPTURE_SIZE.height, false);
  else renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function createComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: QUALITY.msaa,
    // for the mist pass: the multisampled depth is resolved into this texture
    // along with the colour (the composer's second target gets its own copy)
    depthTexture: new THREE.DepthTexture(size.x, size.y),
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // ground mist, in linear HDR before bloom; switched on once the terrain
  // exists. Phones march it at half resolution with fewer steps.
  const mist = new MistPass(camera, QUALITY.mobile ? { steps: 8, half: true } : { steps: 10 });
  composer.addPass(mist);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = cameraFov(camera.aspect);
    camera.updateProjectionMatrix();
  };
  // capture frames stay a fixed size whatever the window does
  if (!CAPTURE) window.addEventListener('resize', resize);
  return { composer, bloom, mist, resize };
}

/** Wider lens on tall (portrait) screens so the case still fits. */
export function cameraFov(aspect) {
  return aspect < 1 ? 46 : aspect < 1.3 ? 38 : 32;
}
