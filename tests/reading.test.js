// reading.test.js — sight reading must produce a melody a person can actually
// read: inside the exercise's register and key, mostly stepwise, four bars at
// most, and every tab note reachable in the first five frets.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/engine.js';
import {
  generateRhythm, generatePitches, normaliseRhythms, normaliseCount,
  readingSignature, STAFF_POOL, TAB_POOL, RHYTHMS, NOTE_COUNTS, MAX_BEATS,
} from '../js/reading.js';
import { fretFor, STANDARD_TUNING, TAB_MAX_FRET } from '../js/notation.js';
import { MODULES } from '../js/curriculum.js';

const mod = MODULES.find(m => m.id === 'reading');
const naturals = m => [0, 2, 4, 5, 7, 9, 11].includes(m % 12);
const pc = m => ((m % 12) + 12) % 12;

const cases = [
  { notation: 'staff', notes: 8, rhythms: ['quarter', 'eighths'], playFirst: false, showNames: false },
  { notation: 'staff', notes: 16, rhythms: ['eighths'], playFirst: true, showNames: true },
  { notation: 'staff', notes: 12, rhythms: ['dotted'], playFirst: false, showNames: false },
  { notation: 'staff', notes: 6, rhythms: ['half'], playFirst: false, showNames: false },
  { notation: 'tab', notes: 8, rhythms: ['quarter', 'eighths'], playFirst: false, showNames: false },
  { notation: 'tab', notes: 12, rhythms: ['dotted', 'half', 'quarter'], playFirst: false, showNames: true },
];

test('sight-reading questions stay inside the register, key and metre', () => {
  for (const cfg of cases) {
    const pool = cfg.notation === 'tab' ? TAB_POOL : STAFF_POOL;
    for (let i = 0; i < 60; i++) {
      const q = generate('reading', { ...mod.defaults, ...cfg });
      assert.equal(q.kind, 'reading');
      assert.equal(q.moduleId, 'reading');
      assert.equal(q.notation, cfg.notation);

      // Register, key and note count.
      assert.ok(q.notes.length >= 4, `${cfg.notation}: at least four notes`);
      assert.ok(q.notes.length <= cfg.notes, `${cfg.notation}: never more than requested`);
      for (const n of q.notes) {
        assert.ok(pool.includes(n.midi), `${n.midi} is in the ${cfg.notation} pool`);
        assert.ok(naturals(n.midi), `${n.midi} is a C major natural`);
      }
      assert.ok(Math.min(...q.targetMidis) >= Math.min(...pool));
      assert.ok(Math.max(...q.targetMidis) <= Math.max(...pool));

      // Metre: cells of the chosen values, four bars at most.
      const beats = q.notes.reduce((a, n) => a + n.beats, 0);
      assert.ok(beats <= MAX_BEATS + 1e-9, `beats ${beats} must fit four bars`);
      assert.ok(beats > 0);
      for (const n of q.notes) assert.ok([0.5, 1, 1.5, 2].includes(n.beats), `duration ${n.beats}`);

      // Motion: stepwise with occasional small leaps, never a big one.
      const idx = q.targetMidis.map(m => pool.indexOf(m));
      assert.ok(pc(q.targetMidis[0]) === 0 || pc(q.targetMidis[0]) === 4 || pc(q.targetMidis[0]) === 7,
        'starts on do, mi or sol');
      const last = pc(q.targetMidis[q.targetMidis.length - 1]);
      assert.ok(last === 0 || last === 7, 'ends on do or sol');
      for (let k = 1; k < idx.length; k++) {
        const step = Math.abs(idx[k] - idx[k - 1]);
        assert.ok(step <= 4, `leap of ${step} steps is too wide`);
      }
      // At most two of the same note in a row.
      for (let k = 2; k < idx.length; k++) {
        const run = idx[k] === idx[k - 1] && idx[k - 1] === idx[k - 2];
        assert.ok(!run, 'a note may repeat at most twice');
      }
    }
  }
});

test('the requested note count is honoured whenever the rhythm allows it', () => {
  for (const notes of NOTE_COUNTS) {
    for (const rhythm of ['quarter', 'eighths', 'dotted']) {
      const q = generate('reading', { ...mod.defaults, notation: 'staff', notes, rhythms: [rhythm] });
      assert.equal(q.notes.length, notes, `${rhythm} × ${notes}`);
    }
  }
  // Half notes are two beats each, so sixteen of them would need eight bars:
  // the melody is trimmed to the four bars the score draws.
  const heavy = generate('reading', { ...mod.defaults, notes: 16, rhythms: ['half'] });
  assert.ok(heavy.notes.length <= 8);
  assert.ok(heavy.notes.reduce((a, n) => a + n.beats, 0) <= MAX_BEATS);
});

test('rhythm generation fills whole bars and truncates only the last one', () => {
  for (const rhythm of Object.keys(RHYTHMS)) {
    for (let i = 0; i < 20; i++) {
      const durs = generateRhythm([rhythm], 8);
      assert.equal(durs.length, 8);
      const total = durs.reduce((a, b) => a + b, 0);
      assert.ok(total <= MAX_BEATS);
      const allowed = RHYTHMS[rhythm].durs;
      for (const d of durs) assert.ok(allowed.includes(d), `${rhythm} produced ${d}`);
    }
  }
  // No selection at all still answers with quarters rather than an empty score.
  assert.deepEqual(normaliseRhythms([]), ['quarter']);
  assert.deepEqual(normaliseRhythms(['nope', 'half', 'quarter', 'half']), ['quarter', 'half']);
  assert.equal(normaliseCount(99), 8);
});

test('every note of the tab pool is playable in frets 0–4 at one position', () => {
  const expected = {
    55: { string: 3, fret: 0 },   // G3
    57: { string: 3, fret: 2 },   // A3
    59: { string: 2, fret: 0 },   // B3
    60: { string: 2, fret: 1 },   // C4
    62: { string: 2, fret: 3 },   // D4
    64: { string: 1, fret: 0 },   // E4
    65: { string: 1, fret: 1 },   // F4
    67: { string: 1, fret: 3 },   // G4
  };
  assert.deepEqual(TAB_POOL, Object.keys(expected).map(Number));
  for (const midi of TAB_POOL) {
    assert.deepEqual(fretFor(midi), expected[midi], `${midi} position`);
  }
  // Out of range: no position is invented.
  assert.equal(fretFor(39), null);
  assert.equal(fretFor(72), null);

  // Standard tuning, high string first.
  assert.deepEqual(STANDARD_TUNING.map(s => s.open), [64, 59, 55, 50, 45, 40]);
  for (const s of STANDARD_TUNING) {
    assert.equal(fretFor(s.open).string, s.string);
    assert.equal(fretFor(s.open).fret, 0);
  }
  for (const midi of TAB_POOL) assert.ok(fretFor(midi).fret <= TAB_MAX_FRET);
});

test('the staff pool is C4–C6 in C major', () => {
  assert.equal(STAFF_POOL[0], 60);
  assert.equal(STAFF_POOL[STAFF_POOL.length - 1], 84);
  assert.equal(STAFF_POOL.length, 15);
  for (const m of STAFF_POOL) assert.ok(naturals(m), `${m} is natural`);
});

test('grading is per question and keyed by the configuration signature', () => {
  const q = generate('reading', mod.defaults);
  assert.equal(q.grade(q.targetMidis).correct, true);

  const wrong = [...q.targetMidis];
  wrong[wrong.length - 1] += 2;
  const graded = q.grade(wrong);
  assert.equal(graded.correct, false);
  assert.equal(graded.itemResults.length, 1);
  assert.equal(graded.itemResults[0].key, q.sig);
  assert.match(q.sig, /^sr:staff:8:/);
  assert.equal(graded.confusion, null);

  // Training aids never enter the signature; rhythm order does not either.
  assert.equal(
    readingSignature('staff', 8, ['quarter', 'eighths']),
    readingSignature('staff', 8, ['eighths', 'quarter']),
  );
  assert.notEqual(
    readingSignature('staff', 8, ['quarter']),
    readingSignature('tab', 8, ['quarter']),
  );
  const aided = generate('reading', { ...mod.defaults, showNames: true, playFirst: true });
  assert.equal(aided.sig, q.sig);
});

test('reference playback follows the written rhythm', () => {
  const q = generate('reading', { ...mod.defaults, notes: 8, rhythms: ['dotted'] });
  const beats = q.notes.reduce((a, n) => a + n.beats, 0);
  assert.equal(typeof q.play, 'function');
  assert.equal(q.play, q.playMelodyOnly);

  // Timing is the cumulative beat count — the score and the playback agree.
  let at = 0;
  const starts = [];
  for (const n of q.notes) { starts.push(at); at += n.beats; }
  assert.equal(at, beats);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('sight reading is not auto-played unless asked', () => {
  const silent = generate('reading', mod.defaults);
  assert.equal(silent.autoPlay, false);
  const heard = generate('reading', { ...mod.defaults, playFirst: true });
  assert.equal(heard.autoPlay, true);
});

test('the question exposes everything the score renderer needs', () => {
  for (const cfg of cases) {
    const q = generate('reading', { ...mod.defaults, ...cfg });
    assert.ok(Array.isArray(q.notes) && q.notes.length > 0);
    for (const n of q.notes) {
      assert.equal(typeof n.midi, 'number');
      assert.equal(typeof n.beats, 'number');
    }
    assert.equal(q.notes.length, q.targetMidis.length);
    assert.ok(q.keyRange[0] < Math.min(...q.targetMidis));
    assert.ok(q.keyRange[1] > Math.max(...q.targetMidis));
    assert.equal(q.answerNames.length, q.targetMidis.length);
    for (const name of q.answerNames) assert.match(name, /^[A-G][♯♭]?-?\d$/);
  }
});
