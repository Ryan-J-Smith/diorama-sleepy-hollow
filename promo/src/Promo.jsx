// The promo edit: the captured shots cut together with slow cross-dissolves,
// the title over the opening overhead shot, an end card as the closing shot
// settles on the whole case, and the diorama's own music.

import { AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { loadFont as loadFell } from '@remotion/google-fonts/IMFellEnglish';
import { loadFont as loadFellSC } from '@remotion/google-fonts/IMFellEnglishSC';
import { SHOTS } from '../shots.js';

// the site's fonts and colours
const { fontFamily: FELL } = loadFell('normal');
loadFell('italic');
const { fontFamily: FELL_SC } = loadFellSC('normal');
const GOLD = '#d9b36a';
const PARCHMENT = '#e9dcc0';
const INK = '#07060a';
const SHADOW = '0 2px 18px rgba(0, 0, 0, 0.85), 0 0 42px rgba(0, 0, 0, 0.6)';

const FPS = 30;
const DISSOLVE = 15;
const ORDER = ['overhead', 'corner', 'bridge', 'soar'];
const END_CARD = 115; // frames the end card is up for, at the very end

// where each shot starts in the edit (they overlap by a dissolve)
const START = {};
let at = 0;
for (const name of ORDER) {
  START[name] = at;
  at += SHOTS[name].frames - DISSOLVE;
}
export const PROMO_FRAMES = at + DISSOLVE;

// "Abandoned Mystical Forest" swells at 12.18 s. Start the track so the swell
// lands as the Horseman plunges into the covered bridge after Ichabod.
const MUSIC_SWELL = 12.18;
const HORSEMAN_PLUNGE = START.bridge + 80;
const MUSIC_TRIM = Math.round(MUSIC_SWELL * FPS - HORSEMAN_PLUNGE);
const MUSIC_VOLUME = 0.7;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

const Clip = ({ name }) => (
  <AbsoluteFill>
    <OffthreadVideo src={staticFile(`clips/${name}.mp4`)} muted style={{ width: '100%', height: '100%' }} />
  </AbsoluteFill>
);

/** "The Legend of Sleepy Hollow" over the opening shot. */
const Title = () => {
  const f = useCurrentFrame();
  const title = interpolate(f, [14, 44, 86, 106], [0, 1, 1, 0], clamp);
  const byline = interpolate(f, [32, 60, 86, 106], [0, 1, 1, 0], clamp);
  const rise = interpolate(f, [14, 70], [16, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
      {/* a soft pool of shadow behind the words, so they read over the village */}
      <AbsoluteFill
        style={{
          opacity: title,
          background: 'radial-gradient(ellipse 46% 26% at 50% 50%, rgba(7, 6, 10, 0.62) 0%, rgba(7, 6, 10, 0) 100%)',
        }}
      />
      <div style={{ textAlign: 'center', transform: `translateY(${rise}px)`, textShadow: SHADOW }}>
        <div style={{ fontFamily: FELL_SC, fontSize: 108, letterSpacing: '0.04em', color: GOLD, opacity: title }}>
          The Legend of Sleepy Hollow
        </div>
        <div style={{ marginTop: 10, fontFamily: FELL, fontStyle: 'italic', fontSize: 44, color: PARCHMENT, opacity: 0.8 * byline }}>
          after Washington Irving
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** The title above the case and the site's address below it, as the closing shot settles. */
const EndCard = () => {
  const f = useCurrentFrame();
  const title = interpolate(f, [0, 30], [0, 1], clamp);
  const address = interpolate(f, [22, 46], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: 'center', textShadow: SHADOW }}>
      <div style={{ position: 'absolute', top: 74, fontFamily: FELL_SC, fontSize: 84, letterSpacing: '0.04em', color: GOLD, opacity: title }}>
        The Legend of Sleepy Hollow
      </div>
      <div style={{ position: 'absolute', bottom: 70, fontFamily: FELL, fontSize: 40, letterSpacing: '0.05em', color: PARCHMENT, opacity: 0.85 * address }}>
        ryan-j-smith.github.io/diorama-sleepy-hollow
      </div>
    </AbsoluteFill>
  );
};

export const Promo = () => {
  const f = useCurrentFrame();
  // in from black, and out to black at the very end
  const black = interpolate(f, [0, 12, PROMO_FRAMES - 14, PROMO_FRAMES - 1], [1, 0, 0, 1], clamp);
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <TransitionSeries>
        {ORDER.flatMap((name, i) => [
          i > 0 && (
            <TransitionSeries.Transition key={`${name}-in`} presentation={fade()} timing={linearTiming({ durationInFrames: DISSOLVE })} />
          ),
          <TransitionSeries.Sequence key={name} durationInFrames={SHOTS[name].frames}>
            <Clip name={name} />
          </TransitionSeries.Sequence>,
        ]).filter(Boolean)}
      </TransitionSeries>

      {/* a gentle vignette, like looking into the case by lamplight */}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse 75% 70% at 50% 50%, rgba(0, 0, 0, 0) 60%, rgba(0, 0, 0, 0.42) 100%)' }} />

      <Sequence durationInFrames={SHOTS.overhead.frames}>
        <Title />
      </Sequence>
      <Sequence from={PROMO_FRAMES - END_CARD}>
        <EndCard />
      </Sequence>

      <AbsoluteFill style={{ backgroundColor: 'black', opacity: black }} />

      <Audio
        src={staticFile('music.mp3')}
        trimBefore={MUSIC_TRIM}
        volume={(v) => MUSIC_VOLUME * interpolate(v, [0, 30, PROMO_FRAMES - 60, PROMO_FRAMES], [0, 1, 1, 0], clamp)}
      />
    </AbsoluteFill>
  );
};
