# The Legend of Sleepy Hollow — a diorama

**[Open the diorama →](https://ryan-j-smith.github.io/diorama-sleepy-hollow/)**

A moonlit autumn diorama of Washington Irving's *Legend of Sleepy Hollow*, sitting in a
glass case on a lacquered walnut base. Ichabod Crane gallops his old plough horse
Gunpowder around the hollow — through the candlelit village, past the harvested
cornfield, over the covered bridge, past the Old Dutch Church on its hill and back over the
stone bridge — with the Headless Horseman close behind, his burning head held aloft. The
chase goes round and round the hollow all night.

Everything is built in the browser with [three.js](https://threejs.org/): the models,
textures and animation are generated in code, so there are no image or model files. The
only asset is the music track.

## Viewing it

| Action | Mouse | Touch |
| --- | --- | --- |
| Turn around the case | drag | drag |
| Look closer / step back | scroll | pinch |
| Slide the view | right-drag | two-finger drag |

When the page has loaded, press **Open the case**. The diorama has
soft background music; the switch just below the button shows whether it's on and lets
you turn it off before anything plays. The choice is remembered for next time.

The camera stays outside the glass. Buttons along the bottom:

- **Pause**: freezes the scene (<kbd>Space</kbd>)
- **Turntable**: turns the case slowly when you leave it alone
- **Follow**: keeps the riders in view (<kbd>F</kbd>)
- **Music**: on or off (<kbd>M</kbd>), with a volume slider beside it (starts quiet)
- **Reset**: goes back to the starting view (<kbd>R</kbd>)
- **Fullscreen**
- **Help**: shows the "Exploring the diorama" card again (<kbd>H</kbd>). It appears
  on a first visit and stays hidden once dismissed.

## Running it locally

Browsers won't load ES modules from `file://`, so serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Publishing on GitHub Pages

1. Create a GitHub repository and push this folder to it (the `index.html` must be at the
   repository root).
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick your
   branch (e.g. `main`) and the **/ (root)** folder, then **Save**.
4. After a minute or so the site is live at `https://<your-user>.github.io/<repo-name>/`.

All paths are relative and three.js is vendored in `vendor/three/`, so it works under a
project sub-path and needs no CDN. `.nojekyll` stops GitHub from running Jekyll over it.

## The promo video

`promo/` holds the short promo video's pipeline. `?capture=1` puts the site in a capture mode
(`js/capture.js`) that steps the scene with a fixed time step and renders exact 1920×1080
frames on request, so every capture comes out the same. The shots' camera paths are in
`promo/shots.js`, and the edit (titles, dissolves, music) is a
[Remotion](https://www.remotion.dev/) project in `promo/src/`.

```sh
cd promo
npm install
npm run stills    # first/middle/last frame of each shot, headless -> promo/stills/
npm run capture   # every frame, rendered on the GPU in a browser window -> promo/public/clips/
npm run render    # the finished video -> promo/out/promo.mp4
```

## Making it your own

- **Plaque text**: `buildBase()` in `js/world/caseworks.js` (the `plaqueTexture(...)` call).
- **Signposts**: the `SPURS` list in `js/world/layout.js`.
- **Chase speed**: `SPEED` in `js/actors/chase.js`.
- **Layout** (road, river, buildings, fields): `js/world/layout.js`. Every other builder
  reads from it.
- **Colors of each house**: `SPECS` in `js/world/village.js`.

## Project layout

```
index.html            page shell, import map, loading card, controls
css/style.css
js/main.js            builds the scene step by step, runs the animation loop
js/config.js          case/terrain dimensions and quality settings
js/core/              renderer + bloom, lighting & environment maps, camera controls
js/util/              seeded random, noise, procedural canvas textures, geometry helpers
js/world/             layout/heightfield, terrain & water, river rocks and riffles, case,
                      buildings, village, church, bridges, trees, farm, props
js/actors/            horses, riders, the chase, owls and crows
js/fx/                particles, falling leaves, mist, chimney smoke
js/audio.js           background music (Web Audio, gapless loop, volume)
js/capture.js         promo capture mode (?capture=1): fixed-step frames on request
audio/                the music track
vendor/three/         three.js r186 (MIT licence, see vendor/three/LICENSE)
promo/                the promo video: frame capture (Playwright) and edit (Remotion)
```

## Credits

- Story: Washington Irving, *The Legend of Sleepy Hollow* (1820), public domain.
- Typeface: [IM Fell English](https://fonts.google.com/specimen/IM+Fell+English) by Igino
  Marini, via Google Fonts (SIL Open Font License). Falls back to Georgia offline.
- Rendering: [three.js](https://threejs.org/) (MIT).
- Music: "Abandoned Mystical Forest" by BFCMUSIC ([bfcmusic.me](https://bfcmusic.me)), via
  Pixabay under the Pixabay Content License.
