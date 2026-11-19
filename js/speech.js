// speech.js — spoken answer names, via the Web Speech API.
//
// No dependency and no network request: the browser ships the voices. Gesture
// mode uses it so a missed answer can be *named*, not only re-played.

import { INTERVALS, CHORDS, SCALES, DEGREES, pitchClassName } from './theory.js';
import * as State from './state.js';
import { language } from './i18n.js';
import { THEORY_ZH } from './i18n.zh.js';

// English voices read solfege syllables wrong ("Re" → "ray"), so the spoken
// form is spelled the way it should sound.
const SOLFEGE_SPOKEN = {
  Do: 'doe', Re: 'reh', Mi: 'mee', Fa: 'fah', Sol: 'so', La: 'lah', Ti: 'tee',
  Ra: 'rah', Me: 'meh', Fi: 'fee', Si: 'see', Le: 'leh', Te: 'teh',
};
const PITCH_LABELS = { up: 'Higher', down: 'Lower', same: 'Same' };

const SOLFEGE_ZH = {
  do: '哆', re: '来', mi: '咪', fa: '发', sol: '索', la: '拉', ti: '西',
};
const NUMBER_ZH = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

// Chinese names follow the same theory ids; numbers are used where a solfège
// syllable would be ambiguous with its altered form.
function spokenNameZh(moduleId, id) {
  switch (moduleId) {
    case 'intervals': return THEORY_ZH.intervals[id] ?? INTERVALS[id]?.name ?? null;
    case 'scales': return THEORY_ZH.scales[id] ?? SCALES[id]?.name ?? null;
    case 'chords': {
      const name = THEORY_ZH.chords[id] ?? CHORDS[id]?.name;
      return name ? name.replace('（', '，').replace('）', '') : null;
    }
    case 'degrees': {
      const deg = DEGREES[id];
      if (!deg) return null;
      const number = deg.number
        .replace('♭', '降').replace('♯', '升')
        .replace(/(\d)/, d => `${NUMBER_ZH[Number(d)]}级`);
      if (State.state.settings.degreeLabels === 'number') return number;
      if (!/[♭♯]/.test(deg.number) && SOLFEGE_ZH[id]) return SOLFEGE_ZH[id];
      return number;
    }
    case 'absolute': {
      const name = pitchClassName(id);
      if (!name) return null;
      return name.replace(/^([A-G])([♯♭])$/, (_, letter, acc) =>
        `${acc === '♯' ? '升' : '降'}${letter}`);
    }
    case 'pitch': return { up: '更高', down: '更低', same: '相同' }[id] ?? null;
    default: return null;
  }
}

// The pronounceable name of one answer in one exercise — what gets spoken.
export function spokenAnswerName(moduleId, id) {
  if (language() === 'zh') return spokenNameZh(moduleId, id);
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

// Android's WebView reports `speechSynthesis` but ships no voices, so the app
// shell injects a native bridge instead (see android/.../TtsBridge.java). It
// wins whenever it exists.
// Voice mode listens for these to stop the microphone while the app speaks.
function emit(name) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event(name));
}
if (typeof window !== 'undefined') {
  // Called by the Android TTS bridge when an utterance finishes.
  window.__speechEnd = () => emit('music-ear:speech-end');
}

function nativeTts() {
  const bridge = typeof window !== 'undefined' ? window.AndroidTTS : null;
  return bridge && typeof bridge.speak === 'function' ? bridge : null;
}

export function speechAvailable() {
  return !!nativeTts() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

// Speak one line, replacing anything already being spoken. Returns false when
// the platform has no speech engine at all, so callers can fall back to audio.
export function speak(text) {
  if (!text) return false;
  emit('music-ear:speech-start');
  const bridge = nativeTts();
  if (bridge) {
    if (typeof bridge.setLanguage === 'function') {
      bridge.setLanguage(language() === 'zh' ? 'zh' : 'en');
    }
    bridge.speak(text, State.state.settings.volume ?? 1);
    return true;
  }
  if (!speechAvailable()) { emit('music-ear:speech-end'); return false; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.onend = () => emit('music-ear:speech-end');
  u.onerror = () => emit('music-ear:speech-end');
  const want = language() === 'zh' ? 'zh' : 'en';
  const voice = synth.getVoices().find(v => new RegExp(`^${want}`, 'i').test(v.lang));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? (want === 'zh' ? 'zh-CN' : 'en-US');
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
  if (language() === 'zh') return speak(`你选择了${picked}，正确答案是${answer}。`);
  return speak(`You chose ${picked}. The answer was ${answer}.`);
}

export function cancelSpeech() {
  emit('music-ear:speech-end');
  const bridge = nativeTts();
  if (bridge && typeof bridge.cancel === 'function') bridge.cancel();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
