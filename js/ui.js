// Wires the small control bar and the fading interaction hint.

export function setupUI(world) {
  const { sim, controls } = world;
  const bar = document.getElementById('controls');
  const hint = document.getElementById('hint');
  const canvas = document.getElementById('scene');

  const setPressed = (btn, on) => btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const button = (action) => bar.querySelector(`[data-action="${action}"]`);

  const pauseBtn = button('pause');
  const turnBtn = button('turntable');
  const followBtn = button('follow');

  pauseBtn.addEventListener('click', () => {
    sim.running = !sim.running;
    setPressed(pauseBtn, !sim.running);
    pauseBtn.querySelector('.label').textContent = sim.running ? 'Pause' : 'Play';
  });

  turnBtn.addEventListener('click', () => {
    controls.turntable = !controls.turntable;
    setPressed(turnBtn, controls.turntable);
  });

  followBtn.addEventListener('click', () => {
    const on = !controls.follow;
    controls.follow = on ? () => world.actors.focus?.() ?? null : null;
    setPressed(followBtn, on);
  });

  const musicBtn = button('music');
  const volume = document.getElementById('volume');
  const syncMusic = () => {
    setPressed(musicBtn, world.music.enabled);
    volume.classList.toggle('off', !world.music.enabled);
    volume.style.setProperty('--fill', `${Math.round(world.music.volume * 100)}%`);
  };
  volume.value = String(world.music.volume);
  syncMusic();
  musicBtn.addEventListener('click', () => {
    world.music.setEnabled(!world.music.enabled);
    syncMusic();
  });
  volume.addEventListener('input', () => {
    world.music.setVolume(parseFloat(volume.value));
    // nudging the slider up while muted turns the music back on
    if (!world.music.enabled && world.music.volume > 0) world.music.setEnabled(true);
    syncMusic();
  });

  button('reset').addEventListener('click', () => {
    controls.follow = null;
    setPressed(followBtn, false);
    controls.reset(false);
  });

  const fsBtn = button('fullscreen');
  if (!document.fullscreenEnabled) {
    fsBtn.hidden = true;
  } else {
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    });
  }

  // keyboard: space pauses, R resets, F follows
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      pauseBtn.click();
    } else if (e.key === 'r' || e.key === 'R') {
      button('reset').click();
    } else if (e.key === 'f' || e.key === 'F') {
      followBtn.click();
    } else if (e.key === 'm' || e.key === 'M') {
      musicBtn.click();
    }
  });

  if (matchMedia('(pointer: coarse)').matches) {
    hint.textContent = 'Drag to turn \u00b7 Pinch to look closer \u00b7 Two-finger drag to pan';
  }
  let hintTimer = setTimeout(() => hint.classList.add('gone'), 11000);
  const dismiss = () => {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.add('gone'), 1500);
    canvas.removeEventListener('pointerdown', dismiss);
  };
  canvas.addEventListener('pointerdown', dismiss);
}
