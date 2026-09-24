// Orbit camera that can circle, zoom and pan around the case but never pass
// through the glass or the wooden base.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CASE, BASE, TABLE_Y } from '../config.js';

const HOME_TARGET = new THREE.Vector3(0, 1.0, 0.4);
const HOME_DIR = new THREE.Vector3(0.06, 0.3, 1).normalize();

// On tall (portrait) screens look down the length of the case from its end.
const HOME_DIR_PORTRAIT = new THREE.Vector3(1, 0.62, 0.42).normalize();

/** Starting camera spot that frames the whole case for the current aspect. */
function homePosition(camera) {
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  if (camera.aspect < 0.8) {
    const d = Math.min(Math.max(7.4 / tanH + 7, 9 / tanV), 64);
    return HOME_TARGET.clone().addScaledVector(HOME_DIR_PORTRAIT, d);
  }
  const byWidth = 11.2 / tanH + 6.5;
  const byHeight = 5.2 / tanV + 6.5;
  const d = Math.min(Math.max(byWidth, byHeight), 64);
  return HOME_TARGET.clone().addScaledVector(HOME_DIR, d);
}

export class CaseControls {
  constructor(camera, dom) {
    this.camera = camera;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.7;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.minDistance = 1.5;
    c.maxDistance = 70;
    c.maxPolarAngle = Math.PI * 0.53;
    c.autoRotateSpeed = 0;
    this.controls = c;

    const margin = 0.28;
    // The glass case and the wooden base, as keep-out boxes.
    this.boxes = [
      new THREE.Box3(
        new THREE.Vector3(-CASE.hx - margin, -0.2, -CASE.hz - margin),
        new THREE.Vector3(CASE.hx + margin, CASE.height + 0.12 + margin, CASE.hz + margin),
      ),
      new THREE.Box3(
        new THREE.Vector3(-BASE.hx - 0.5 - margin, TABLE_Y - 2, -BASE.hz - 0.5 - margin),
        new THREE.Vector3(BASE.hx + 0.5 + margin, 0.05, BASE.hz + 0.5 + margin),
      ),
    ];
    // Where the orbit pivot may wander (inside the case).
    this.targetBounds = new THREE.Box3(new THREE.Vector3(-8.8, 0.3, -5.2), new THREE.Vector3(8.8, 3.6, 5.2));
    this.minCameraY = TABLE_Y + 0.6;

    // Turntable: resumes shortly after the visitor lets go, easing up to a
    // slow display-case turn (about 75 s per revolution).
    this.turntable = true;
    this.turnDelay = 2.5; // seconds idle before turning again
    this.turnSpeed = 0.8; // OrbitControls units: 2 = 30 s per revolution
    this.turnRamp = 0;
    this.idleTime = 0;
    this.follow = null; // () => Vector3 | null
    this.interacting = false;
    c.addEventListener('start', () => {
      this.interacting = true;
      this.idleTime = 0;
    });
    c.addEventListener('end', () => {
      this.interacting = false;
      this.idleTime = 0;
    });
    dom.addEventListener('wheel', () => (this.idleTime = 0), { passive: true });

    this.reset(true);
  }

  reset(immediate = false) {
    this.home = homePosition(this.camera);
    if (immediate) {
      this.camera.position.copy(this.home);
      this.controls.target.copy(HOME_TARGET);
      this.flight = null;
    } else {
      this.flight = {
        t: 0,
        fromPos: this.camera.position.clone(),
        fromTarget: this.controls.target.clone(),
      };
    }
    this.idleTime = 0;
  }

  update(dt) {
    const c = this.controls;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / 1.6);
      const e = f.t * f.t * (3 - 2 * f.t);
      this.camera.position.lerpVectors(f.fromPos, this.home, e);
      c.target.lerpVectors(f.fromTarget, HOME_TARGET, e);
      if (f.t >= 1 || this.interacting) this.flight = null;
    }

    if (this.follow && !this.flight) {
      const p = this.follow();
      if (p) {
        const k = 1 - Math.exp(-dt * 2.2);
        const delta = new THREE.Vector3().subVectors(p, c.target).multiplyScalar(k);
        c.target.add(delta);
        this.camera.position.add(delta);
      }
    }

    this.idleTime += dt;
    const turning = this.turntable && !this.interacting && this.idleTime > this.turnDelay && !this.flight;
    this.turnRamp = turning ? Math.min(1, this.turnRamp + dt / 1.5) : 0;
    const ease = this.turnRamp * this.turnRamp * (3 - 2 * this.turnRamp);
    c.autoRotate = this.turnRamp > 0;
    c.autoRotateSpeed = this.turnSpeed * ease;

    c.update(dt);
    this.constrain();
  }

  constrain() {
    const c = this.controls;
    const cam = this.camera;
    c.target.clamp(this.targetBounds.min, this.targetBounds.max);

    const dir = new THREE.Vector3().subVectors(cam.position, c.target);
    let dist = dir.length();
    if (dist < 1e-4) {
      dir.set(0, 0.3, 1);
      dist = 0;
    }
    dir.normalize();
    // walk out along the view ray until we are clear of every keep-out box
    let t = dist;
    const p = new THREE.Vector3();
    for (let iter = 0; iter < 4; iter++) {
      p.copy(c.target).addScaledVector(dir, t);
      let moved = false;
      for (const box of this.boxes) {
        if (box.containsPoint(p)) {
          t += exitDistance(p, dir, box) + 1e-3;
          moved = true;
        }
      }
      if (!moved) break;
    }
    if (t !== dist) cam.position.copy(c.target).addScaledVector(dir, t);
    if (cam.position.y < this.minCameraY) cam.position.y = this.minCameraY;
    cam.lookAt(c.target);
  }
}

/** Distance along dir from p (inside box) to the box surface. */
function exitDistance(p, dir, box) {
  let t = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const d = dir[axis];
    if (d > 1e-6) t = Math.min(t, (box.max[axis] - p[axis]) / d);
    else if (d < -1e-6) t = Math.min(t, (box.min[axis] - p[axis]) / d);
  }
  return Number.isFinite(t) ? t : 0;
}
