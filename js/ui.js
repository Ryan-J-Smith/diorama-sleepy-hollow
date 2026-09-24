// Wires the small control bar and the "exploring the diorama" help card.

export function setupUI(world) {
  const { sim, controls } = world;
  const bar = document.getElementById('controls');

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

  setupHelp(button('help'));
}

const HELP_KEY = 'sleepy-hollow-help';

/**
 * The help card: shown when the case first opens, hidden with "Got it" or the
 * close button (and remembered), and reopened from the Help button or H key.
 */
function setupHelp(helpBtn) {
  const help = document.getElementById('help');
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

  const show = () => {
    help.hidden = false;
    // next frame so the fade-in transition runs
    requestAnimationFrame(() => help.classList.add('shown'));
    helpBtn.setAttribute('aria-pressed', 'true');
  };
  const hide = () => {
    help.classList.remove('shown');
    helpBtn.setAttribute('aria-pressed', 'false');
    setTimeout(() => {
      if (!help.classList.contains('shown')) help.hidden = true;
    }, 600);
    try {
      localStorage.setItem(HELP_KEY, 'hidden');
    } catch {
      // storage unavailable: it will simply show again next visit
    }
  };
  const toggle = () => (help.classList.contains('shown') ? hide() : show());

  help.querySelector('.help-close').addEventListener('click', hide);
  help.querySelector('.help-ok').addEventListener('click', hide);
  helpBtn.addEventListener('click', toggle);
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Escape' && help.classList.contains('shown')) hide();
    else if ((e.key === 'h' || e.key === 'H' || e.key === '?') && !(e.target instanceof HTMLButtonElement)) toggle();
  });

  let seen = null;
  try {
    seen = localStorage.getItem(HELP_KEY);
  } catch {
    seen = null;
  }
  // first visit: show it once the controls have faded in
  if (seen !== 'hidden') setTimeout(show, 1400);
}
