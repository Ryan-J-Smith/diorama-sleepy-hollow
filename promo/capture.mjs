// Captures the promo's shots from the real diorama, frame by frame.
//
//   node capture.mjs                   every shot in shots.js -> frames/<shot>/0000.png ...
//                                      then public/clips/<shot>.mp4 for the Remotion edit
//   node capture.mjs chase owl         just those shots
//   node capture.mjs --stills          first, middle and last frame of each shot -> stills/
//   node capture.mjs --stills --frames=0,60,90   those frames instead
//   node capture.mjs --info            print handy scene numbers (bridge, perches, ...)
//   --shots=review/owl.js --out=review/owl-stills
//                                      use another shot list (a path inside this repo,
//                                      relative to promo/) and write the stills elsewhere,
//                                      for side-by-side reviews that leave shots.js alone
//   node capture.mjs --gpu             render in a visible Chromium window on the GPU
//
// It serves the site itself (no caching, so edits always show up), opens it
// with ?capture=1 and steps through each shot with window.__capture (see
// js/capture.js). The page is reloaded for every shot so each one comes out
// the same no matter which shots are captured, or in what order.
//
// Chromium runs headless by default, so nothing pops up and steals focus, but
// under WSL headless only gets software rendering (SwiftShader, 2-5 s a
// frame): fine for stills. For a full capture use --gpu, which opens one
// window (it grabs focus once) and renders on the graphics card, ~0.15 s a
// frame.

import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const wanted = args.filter((a) => !a.startsWith('--'));
// the shot list, as a URL path on the site the script serves
const SHOTS_URL = `/${relative(ROOT, resolve(HERE, option('shots', 'shots.js'))).split(sep).join('/')}`;
const STILLS_DIR = resolve(HERE, option('out', 'stills'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

/** Static server for the repo root that never lets the browser cache. */
function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** Load (or reload) the diorama in capture mode; returns the shot list's frame counts. */
async function openDiorama(page, url) {
  await page.goto(`${url}/?capture=1`);
  await page.waitForFunction(() => window.__capture, null, { timeout: 300_000 });
  return page.evaluate((shotsUrl) => window.__capture.load(shotsUrl), SHOTS_URL);
}

const savePng = (dataUrl, file) => writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));

/** Encode a shot's PNGs into an H.264 clip with the ffmpeg that ships with Remotion. */
async function encode(name) {
  const clips = join(HERE, 'public', 'clips');
  await mkdir(clips, { recursive: true });
  const ffmpeg = spawnSync(
    join(HERE, 'node_modules', '.bin', 'remotion'),
    ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', join(HERE, 'frames', name, '%04d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', join(clips, `${name}.mp4`)],
    { stdio: 'inherit' },
  );
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg could not encode ${name}`);
}

async function main() {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: !flag('gpu'),
    channel: 'chromium',
    args: [
      '--ignore-gpu-blocklist',
      // keep working while the window is behind others
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  // one page (one window with --gpu), reloaded for each shot
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (err) => console.error('  page error:', err.message));
  page.on('console', (msg) => {
    // software GL grumbles about reading frames back; that's expected here
    if (msg.text().includes('GPU stall due to ReadPixels')) return;
    if (msg.type() === 'error' || msg.type() === 'warning') console.error(`  console ${msg.type()}:`, msg.text());
  });

  try {
    const all = await openDiorama(page, url);
    if (flag('info')) {
      console.log(JSON.stringify(await page.evaluate(() => window.__capture.info()), null, 2));
      return;
    }
    const renderer = await page.evaluate(() => {
      const gl = window.__diorama.renderer.getContext();
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    console.log(`Rendering with ${renderer}`);

    const names = wanted.length ? wanted : Object.keys(all);
    for (const name of names) {
      if (!(name in all)) throw new Error(`No shot called "${name}" (have: ${Object.keys(all).join(', ')})`);
    }

    for (const name of names) {
      const total = all[name];
      const picked = option('frames', null)?.split(',').map(Number).filter((f) => f >= 0 && f < total);
      const frames = flag('stills')
        ? picked ?? [...new Set([0, Math.floor((total - 1) / 2), total - 1])]
        : [...Array(total).keys()];
      const dir = flag('stills') ? STILLS_DIR : join(HERE, 'frames', name);
      if (!flag('stills')) await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });

      const started = Date.now();
      await openDiorama(page, url);
      await page.evaluate((n) => window.__capture.setShot(n), name);
      for (const i of frames) {
        const png = await page.evaluate((f) => window.__capture.frame(f), i);
        const file = flag('stills') ? join(dir, `${name}-${String(i).padStart(4, '0')}.png`) : join(dir, `${String(i).padStart(4, '0')}.png`);
        await savePng(png, file);
        process.stdout.write(`\r${name}: frame ${i + 1}/${total}`);
      }
      console.log(`\r${name}: ${frames.length} frames in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      if (!flag('stills')) await encode(name);
    }
    // the edit plays the site's own music
    if (!flag('stills')) await copyFile(join(ROOT, 'audio', 'abandoned-mystical-forest.mp3'), join(HERE, 'public', 'music.mp3'));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
