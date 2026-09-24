// The promo's shot list. Every camera stays outside the glass, as a visitor
// would: the diorama works because you look into it, from above, never from
// down among the models. Loaded in the browser by js/capture.js (capture mode)
// and by the Remotion edit (for the clip lengths), so it imports nothing:
// three.js arrives as ctx.THREE.
//
// Each shot:
//   frames   length of the captured clip at 30 fps, including the frames that
//            overlap the cross-dissolves either side
//   glass    false hides the glass panes (for cameras inside the case)
//   warmup   seconds the scene runs first, so smoke and mist have drifted in
//   chase    (actors, ctx) => road position (arc length) to put Ichabod at
//            after the warm-up; the riders then run for `preroll` seconds
//            before frame 0
//   camera   (u, ctx) => { pos, target, fov }, u = 0..1 through the shot
//
// Chase landmarks: Ichabod runs at about 1.3 road units a second. The covered
// bridge is centred at s = peakS - 2.5; the Horseman rises in his stirrups
// when Ichabod reaches peakS - 0.6.

const SPEED = 1.3;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const ease = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Camera position looking down at target from `tilt` radians off vertical. */
const orbit = (target, yaw, tilt, r) => [
  target[0] + Math.sin(yaw) * Math.sin(tilt) * r,
  target[1] + Math.cos(tilt) * r,
  target[2] + Math.cos(yaw) * Math.sin(tilt) * r,
];

/** Ichabod's road position `seconds` into the shot, allowing for the pre-roll. */
const chaseAt = (s, seconds, preroll) => s - (seconds + preroll) * SPEED;

/** Arc length along the chase road of the point nearest (x, z). */
const roadS = (layout, x, z) => layout.roadIndex.nearest(x, z, 3).i * layout.roadStep;

// The closing view: the site's home view, a little further back and with the
// case set low, leaving room for the end card's title above and address below.
const END_TARGET = [0, 1.9, 0.4];
const END_POS = (() => {
  const dir = [0.06, 0.3, 1];
  const len = Math.hypot(...dir);
  return END_TARGET.map((v, i) => v + (dir[i] / len) * 34);
})();

export const SHOTS = {
  // 1. From high above, the case slowly turning; the title fades in over it.
  overhead: {
    frames: 120,
    glass: true,
    camera: (u) => {
      const yaw = lerp(-0.12, 0.08, ease(u));
      const tilt = 0.15; // radians off straight down
      const r = lerp(33, 29.5, ease(u));
      const target = [0, 0, 0.1];
      return { pos: orbit(target, yaw, tilt, r), target, fov: 32 };
    },
  },

  // 2. The chase through the village, from outside the front glass up the
  //    Tarry Town lane between the cottage and the tavern: Ichabod swings round
  //    the corner by the fingerpost with the Horseman bursting after him, his
  //    burning head lighting up the maples.
  corner: {
    frames: 110,
    glass: true,
    preroll: 2,
    // Ichabod rounds the corner 1.8 s in
    chase: (a, { layout }) => chaseAt(roadS(layout, -6.2, 2.9), 1.8, 2),
    camera: (u) => ({ pos: [lerp(-6.3, -6.15, u), 1.5, 6.6], target: [-6.6, 1.05, 1.0], fov: 32 }),
  },

  // 3. Straight down through the lid as they race along the front road past
  //    the great gnarled tree and plunge into the covered bridge. In the legend
  //    the Horseman can't cross running water, so the promo never shows him
  //    leave the far side: the bridge's east end is out of frame and the shot
  //    ends with both inside. The top edge stops short of the frog's stone.
  bridge: {
    frames: 100,
    glass: true,
    preroll: 2,
    // Ichabod reaches the west portal (peakS - 3.5) 1.8 s in
    chase: (a) => chaseAt(a.peakS - 3.5, 1.8, 2),
    camera: () => ({ pos: [0.8, 11.2, 3.91], target: [0.8, 0.7, 3.7], fov: 15 }),
  },

  // 4. A bird's-eye view down through the lid over the empty churchyard in
  //    the mist (the riders are back on the village side of the river, so
  //    whatever became of Ichabod stays a mystery), then soaring back to the
  //    whole case on its walnut base and settling for the end card.
  soar: {
    frames: 270,
    glass: true,
    preroll: 2,
    // Ichabod starts on the village street and is still short of the covered
    // bridge when the shot ends
    chase: () => chaseAt(2, 0, 2),
    camera: (u) => {
      const sec = u * 9;
      // drift over the churchyard for the first few seconds...
      const p = Math.min(sec / 3.3, 1.25);
      const target = [lerp(6.4, 5.6, p), 0.8, lerp(0.6, -1.9, p)];
      const pos = [target[0] - 2.4, 10.5, target[2] + 4.6];
      // ...then rise away and back to the closing view
      const t = easeInOut(Math.min(1, Math.max(0, (sec - 2.6) / 3.6)));
      return { pos: mix(pos, END_POS, t), target: mix(target, END_TARGET, t), fov: lerp(30, 32, t) };
    },
  },
};
