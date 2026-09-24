// Background music: "Abandoned Mystical Forest" by BFCMUSIC (bfcmusic.me),
// used under the Pixabay Content License.
//
// Browsers only allow sound after the visitor interacts with the page, so the
// music starts from the "Wind the clockwork" button on the title card. Web
// Audio is used (rather than an <audio> element) so the track loops without a
// gap and fades smoothly, including on iOS.

const SRC = 'audio/abandoned-mystical-forest.mp3';
const DEFAULT_VOLUME = 0.3; // slider position; starts quiet to be polite
const PREF_KEY = 'sleepy-hollow-music';
const VOLUME_KEY = 'sleepy-hollow-volume';

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode etc.): the choice just isn't remembered
  }
}

/** Slider position (0..1) to gain, on a perceptual (squared) curve. */
const toGain = (v) => v * v;

export class Music {
  constructor() {
    this.enabled = readPref(PREF_KEY) !== 'off';
    const saved = parseFloat(readPref(VOLUME_KEY));
    this.volume = Number.isFinite(saved) ? Math.min(1, Math.max(0, saved)) : DEFAULT_VOLUME;
    this.ctx = null;
    this.gain = null;
    this.started = false;
    // start downloading straight away so it's ready when the visitor enters
    this.bytes = fetch(SRC)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (this.enabled) this.ctx.resume();
    });
  }

  /** Must be called from a user gesture (click, tap or key press). */
  async start() {
    if (this.started) return;
    this.started = true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    const bytes = await this.bytes;
    if (!bytes) return;
    try {
      const buffer = await this.ctx.decodeAudioData(bytes.slice(0));
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.gain);
      source.start();
      if (this.enabled) this.fadeTo(toGain(this.volume), 4);
      else this.ctx.suspend();
    } catch (err) {
      console.warn('Music could not be played:', err);
    }
  }

  /** Slider position 0..1. */
  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    writePref(VOLUME_KEY, String(this.volume));
    if (this.ctx && this.enabled) this.fadeTo(toGain(this.volume), 0.15);
  }

  setEnabled(on) {
    this.enabled = on;
    writePref(PREF_KEY, on ? 'on' : 'off');
    if (!this.ctx) {
      if (on) this.start();
      return;
    }
    if (on) {
      this.ctx.resume();
      this.fadeTo(toGain(this.volume), 1.5);
    } else {
      this.fadeTo(0, 0.6);
      setTimeout(() => {
        if (!this.enabled) this.ctx.suspend();
      }, 700);
    }
  }

  fadeTo(value, seconds) {
    const g = this.gain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(value, now + seconds);
  }
}
