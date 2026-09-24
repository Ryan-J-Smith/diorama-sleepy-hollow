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

/**
 * Only the scene render needs multisampling and depth; every pass after it
 * draws a full-screen quad. So the scene always goes into the multisampled
 * target and the passes write into a plain one, instead of the two targets
 * swapping roles each frame (which kept a second multisampled target, with
 * its own depth, and resolved it after every pass).
 */
class SceneComposer extends EffectComposer {
  constructor(renderer, sceneTarget) {
    super(renderer, sceneTarget);
    this.renderTarget2.dispose();
    this.renderTarget2 = new THREE.WebGLRenderTarget(sceneTarget.width, sceneTarget.height, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
    });
  }

  render(deltaTime) {
    this.readBuffer = this.renderTarget1;
    this.writeBuffer = this.renderTarget2;
    super.render(deltaTime);
  }
}

export function createComposer(renderer, scene, camera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: QUALITY.msaa,
    // for the mist pass: the multisampled depth is resolved into this texture
    // along with the colour
    depthTexture: new THREE.DepthTexture(size.x, size.y),
  });
  const composer = new SceneComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // ground mist, in linear HDR before bloom; switched on once the terrain
  // exists. Phones march it at half resolution with fewer steps, and so do
  // screens at a pixel ratio of 2, where half resolution is still one march
  // per CSS pixel, as on a standard screen.
  const mist = new MistPass(camera, QUALITY.mobile ? { steps: 8, half: true } : { steps: 10, half: QUALITY.pixelRatio >= 2 });
  composer.addPass(mist);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.5, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Given a target, the composer sizes its passes as if the target were in
  // CSS pixels, so above a pixel ratio of 1 they start out too big (bloom and
  // mist at pixel ratio² the pixels) until the first resize. Size everything
  // from the CSS size now, exactly as a resize would, so high-DPI screens get
  // the same bloom as everyone else from the first frame.
  const css = renderer.getSize(new THREE.Vector2());
  composer.setSize(css.x, css.y);

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
