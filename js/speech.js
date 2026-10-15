// speech.js — spoken answer names, via the Web Speech API.
//
// No dependency and no network request: the browser ships the voices. Gesture
// mode uses it so a missed answer can be *named*, not only re-played.

import { INTERVALS, CHORDS, SCALES, DEGREES, pitchClassName } from './theory.js';
import * as State from './state.js';

// English voices read solfege syllables wrong ("Re" → "ray"), so the spoken
// form is spelled the way it should sound.
const SOLFEGE_SPOKEN = {
  Do: 'doe', Re: 'reh', Mi: 'mee', Fa: 'fah', Sol: 'so', La: 'lah', Ti: 'tee',
  Ra: 'rah', Me: 'meh', Fi: 'fee', Si: 'see', Le: 'leh', Te: 'teh',
};
const PITCH_LABELS = { up: 'Higher', down: 'Lower', same: 'Same' };

// The pronounceable name of one answer in one exercise — what gets spoken.
export function spokenAnswerName(moduleId, id) {
  switch (moduleId) {
    case 'intervals': return INTERVALS[id]?.name ?? null;
    case 'scales': return SCALES[id]?.name ?? null;
    case 'chords': return CHORDS[id]?.name?.replace(' · ', ', ') ?? null;
    case 'degrees': {
      const deg = DEGREES[id];
      if (!deg) return null;
      // Follow the user's label preference: solfege (spelled for the voice) or
      // the numbered degree.
      return State.state.settings.degreeLabels === 'number'
        ? deg.number.replace('♭', 'flat ').replace('♯', 'sharp ')
        : SOLFEGE_SPOKEN[deg.solfege] ?? deg.solfege;
    }
    case 'absolute':
      return pitchClassName(id)?.replace('♯', ' sharp').replace('♭', ' flat') ?? null;
    case 'pitch': return PITCH_LABELS[id] ?? null;
    default: return null;
  }
}

export function speechAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// Speak one line, replacing anything already being spoken. Returns false when
// the platform has no speech engine at all, so callers can fall back to audio.
export function speak(text) {
  if (!speechAvailable() || !text) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voice = synth.getVoices().find(v => /^en/i.test(v.lang));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? 'en-US';
  u.rate = 0.95;                                  // a touch slower for clarity
  u.volume = State.state.settings.volume;
  synth.speak(u);
  return true;
}

// The post-miss narration: what was chosen, then what the answer was — in that
// order, because with your eyes closed the order is the only way to tell them
// apart.
export function speakMiss(moduleId, pickedId, answerId) {
  const picked = spokenAnswerName(moduleId, pickedId);
  const answer = spokenAnswerName(moduleId, answerId);
  if (!picked || !answer) return false;
  return speak(`You chose ${picked}. The answer was ${answer}.`);
}

export function cancelSpeech() {
  if (speechAvailable()) window.speechSynthesis.cancel();
}
