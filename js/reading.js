// reading.js — sight-reading questions: a melody to read, not to hear.
//
// The generator owns pitch, rhythm and the tab mapping. Everything here is a
// pure function of (config, random) so the musical constraints — stepwise
// motion, the register of each notation, eight bars at most — can be asserted
// in node --test.

import * as Audio from './audio.js';
import { midiName } from './theory.js';

// C major naturals. The staff reads C4–C6; the tab keeps to G3–G4, the range
// that every note can reach in the first five frets of standard tuning.
export const STAFF_POOL = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
export const TAB_POOL = [55, 57, 59, 60, 62, 64, 65, 67];

const isDo = m => m % 12 === 0;
const isMi = m => m % 12 === 4;
const isSol = m => m % 12 === 7;

// Rhythm cells, in beats of 4/4 and in notes per cell. A dotted quarter is
// written as one note and leaves half a beat that the following eighth fills.
export const RHYTHMS = {
  quarter: { beats: 1, durs: [1], label: 'Quarter notes' },
  eighths: { beats: 1, durs: [0.5, 0.5], label: 'Two eighths' },
  dotted: { beats: 2, durs: [1.5, 0.5], label: 'Dotted quarter + eighth' },
  half: { beats: 2, durs: [2], label: 'Half notes' },
};
export const RHYTHM_IDS = Object.keys(RHYTHMS);

export const NOTE_COUNTS = [4, 6, 8, 12, 16];
export const MAX_BEATS = 32;        // eight bars of 4/4 — the widest score drawn
export const BEAT_SECONDS = 0.55;   // reference playback tempo

const rand = Math.random;
const pick = (arr, r = rand) => arr[Math.floor(r() * arr.length)];

function pickWeighted(items, weights, r = rand) {
  const total = weights.reduce((a, b) => a + b, 0);
  let v = r() * total;
  for (let i = 0; i < items.length; i++) {
    v -= weights[i];
    if (v <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Keep only known rhythm ids, in canonical order (never click order). */
export function normaliseRhythms(ids) {
  const list = Array.isArray(ids) ? ids.filter(id => RHYTHMS[id]) : [];
  const unique = RHYTHM_IDS.filter(id => list.includes(id));
  return unique.length ? unique : ['quarter'];
}

/** Requested note count, clamped to the offered choices. */
export function normaliseCount(n) {
  const v = Number(n);
  return NOTE_COUNTS.includes(v) ? v : 8;
}

/**
 * Melody rhythm: cells chosen from the selected set until the note count is
 * reached or eight bars are full. Cells always fit the bar they start in; when
 * only a fraction of a cell is still needed the first note of the shortest
 * fitting cell is used, so the requested note count is hit exactly.
 */
export function generateRhythm(rhythmIds, count, r = rand) {
  const ids = normaliseRhythms(rhythmIds);
  const want = normaliseCount(count);
  const out = [];
  let beat = 0;

  while (out.length < want && beat < MAX_BEATS - 1e-9) {
    const left = want - out.length;
    const room = MAX_BEATS - beat;
    const fitting = ids.filter(id => RHYTHMS[id].beats <= room + 1e-9 && RHYTHMS[id].durs.length <= left);
    if (fitting.length) {
      const id = pick(fitting, r);
      for (const d of RHYTHMS[id].durs) out.push(d);
      beat += RHYTHMS[id].beats;
      continue;
    }
    // Nothing whole fits: one note from the shortest cell that still fits.
    const single = ids
      .map(id => RHYTHMS[id].durs[0])
      .filter(d => d <= room + 1e-9)
      .sort((a, b) => a - b)[0];
    if (single === undefined) break;
    out.push(single);
    beat += single;
  }
  return out;
}

/**
 * Pitches for a rhythm, as indexes into `pool`. Mostly steps of one or two,
 * occasionally three, never more than four; starts on do/mi/sol, ends on do or
 * sol, never repeats a note more than twice in a row.
 */
export function generatePitches(pool, count, r = rand) {
  const starts = pool
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => isDo(m) || isMi(m) || isSol(m))
    .filter(({ i }) => i > 0 && i < pool.length - 1)
    .map(({ i }) => i);
  let idx = starts.length ? pick(starts, r) : 0;

  const out = [idx];
  let run = 1;

  while (out.length < count) {
    const moves = [];
    const weights = [];
    for (const step of [0, 1, -1, 2, -2, 3, -3]) {
      const next = idx + step;
      if (next < 0 || next >= pool.length) continue;
      if (step === 0) {
        if (run >= 2) continue;          // at most two of the same note
        moves.push(step); weights.push(0.35);
      } else {
        const w = Math.abs(step) === 1 ? 4 : Math.abs(step) === 2 ? 2 : 0.7;
        moves.push(step); weights.push(w);
      }
    }
    if (!moves.length) break;
    const step = pickWeighted(moves, weights, r);
    idx += step;
    run = step === 0 ? run + 1 : 1;
    out.push(idx);
  }
  // Degenerate pool: never leave the rhythm and the pitches out of step.
  while (out.length < count) out.push(out[out.length - 1]);

  // Land on do or sol, as close to where the line already is as possible —
  // without making a third repeat of the same note.
  if (out.length > 1) {
    const prev = out[out.length - 2];
    const thirdRepeat = out.length > 2 && out[out.length - 3] === prev;
    const ends = pool
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => isDo(m) || isSol(m))
      .map(({ m, i }) => ({ i, dist: Math.abs(i - prev), do_: isDo(m) }))
      .filter(e => e.dist <= 4 && !(thirdRepeat && e.i === prev))
      .sort((a, b) => a.dist - b.dist || (b.do_ ? 1 : 0) - (a.do_ ? 1 : 0));
    if (ends.length) out[out.length - 1] = ends[0].i;
  }

  return out.map(i => pool[i]);
}

/** Whole-question statistics key: notation + note count + rhythm set. */
export function readingSignature(notation, count, rhythmIds) {
  return `sr:${notation}:${normaliseCount(count)}:${normaliseRhythms(rhythmIds).join('+')}`;
}

/**
 * Build one sight-reading question. `cfg` comes from the exercise config:
 * { notation, notes, rhythms, playFirst, showNames }.
 */
export function generate(mod, cfg) {
  const notation = cfg.notation === 'tab' ? 'tab' : 'staff';
  const pool = notation === 'tab' ? TAB_POOL : STAFF_POOL;
  const count = normaliseCount(cfg.notes);
  const rhythms = normaliseRhythms(cfg.rhythms);

  const beats = generateRhythm(rhythms, count);
  const midis = generatePitches(pool, beats.length);
  const notes = midis.map((midi, i) => ({ midi, beats: beats[i] }));

  // Reference playback follows the written rhythm; answering itself is silent.
  const events = [];
  let at = 0;
  for (const n of notes) {
    events.push({ midi: n.midi, at, dur: n.beats * BEAT_SECONDS * 0.9 });
    at += n.beats * BEAT_SECONDS;
  }

  const sig = readingSignature(notation, count, rhythms);
  const playFresh = () => { Audio.stopAll(); return Audio.playEvents(events); };

  return {
    moduleId: 'reading',
    kind: 'reading',
    prompt: mod.prompt,
    notation,
    notes,
    targetMidis: midis,
    beats,
    showNames: !!cfg.showNames,
    autoPlay: !!cfg.playFirst,
    sig,
    tonicMidi: 60,
    keyRange: notation === 'tab' ? [54, 68] : [59, 85],
    play: playFresh,
    playMelodyOnly: playFresh,
    playOption: null,
    answerNames: midis.map(midiName),
    grade(userMidis) {
      let allCorrect = userMidis.length === midis.length;
      for (let i = 0; i < midis.length; i++) {
        if (userMidis[i] !== midis[i]) allCorrect = false;
      }
      return {
        correct: allCorrect,
        itemResults: [{ key: sig, correct: allCorrect }],
        confusion: null,
      };
    },
  };
}
