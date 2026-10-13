// theory.test.js — the music-theory data is the app's foundation: if a chord is
// built on the wrong semitones, no amount of good UI makes the ear training
// right. These tests pin the numbers down.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  midiToFreq, midiName, pitchClassName,
  INTERVALS, CHORDS, SCALES, DEGREES, NUMERALS,
  randInt, choice, weightedChoice,
} from '../js/theory.js';
import { MODULES, ONBOARDING_PATHS, moduleById } from '../js/curriculum.js';

test('midiToFreq is twelve-tone equal temperament anchored at A4 = 440 Hz', () => {
  assert.equal(midiToFreq(69), 440);
  assert.equal(midiToFreq(81), 880);
  assert.equal(midiToFreq(57), 220);
  assert.ok(Math.abs(midiToFreq(60) - 261.6255653) < 1e-6); // middle C
  assert.ok(Math.abs(midiToFreq(60 + 12) / midiToFreq(60) - 2) < 1e-12);
  assert.ok(Math.abs(midiToFreq(69 - 12) / 440 - 0.5) < 1e-12);
});

test('pitch-class names cover all twelve names exactly once', () => {
  const names = Array.from({ length: 12 }, (_, pc) => pitchClassName(pc));
  assert.equal(new Set(names).size, 12);
  assert.equal(pitchClassName(0), 'C');
  assert.equal(pitchClassName(9), 'A');
  assert.equal(pitchClassName(11), 'B');
  // enharmonic spellings follow the single app-wide table in theory.js
  assert.equal(pitchClassName(1), 'C♯');
  assert.equal(pitchClassName(3), 'E♭');
  assert.equal(pitchClassName(6), 'F♯');
  assert.equal(pitchClassName(8), 'A♭');
  assert.equal(pitchClassName(10), 'B♭');
  assert.equal(pitchClassName(-1), pitchClassName(11)); // wraps
  assert.equal(pitchClassName(12), pitchClassName(0));
  assert.equal(midiName(60), 'C4');
  assert.equal(midiName(69), 'A4');
  assert.equal(midiName(21), 'A0');
});

test('interval semitone counts are correct', () => {
  const expected = {
    m2: 1, M2: 2, m3: 3, M3: 4, P4: 5, TT: 6, P5: 7,
    m6: 8, M6: 9, m7: 10, M7: 11, P8: 12, m9: 13, M9: 14, P11: 17, P12: 19,
  };
  for (const [id, semis] of Object.entries(expected)) {
    assert.equal(INTERVALS[id].semis, semis, `${id} should be ${semis} semitones`);
    assert.ok(INTERVALS[id].name && INTERVALS[id].short, `${id} needs a name`);
  }
  // every simple interval is within one octave
  for (const id of ['m2', 'M2', 'm3', 'M3', 'P4', 'TT', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8']) {
    assert.ok(INTERVALS[id].semis <= 12, `${id} is not compound`);
  }
});

test('chord qualities are built on the right semitones above the root', () => {
  const expected = {
    maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
    sus2: [0, 2, 7], sus4: [0, 5, 7],
    dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10],
    m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], mM7: [0, 3, 7, 11],
    maj6: [0, 4, 7, 9], min6: [0, 3, 7, 9],
    dom9: [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], min9: [0, 3, 7, 10, 14],
  };
  for (const [id, semis] of Object.entries(expected)) {
    assert.deepEqual(CHORDS[id].semis, semis, `${id} voicing`);
    assert.ok(CHORDS[id].name && CHORDS[id].short, `${id} needs a name`);
  }
  // voicings are written low-to-high
  for (const [id, ch] of Object.entries(CHORDS)) {
    const sorted = [...ch.semis].sort((a, b) => a - b);
    assert.deepEqual(ch.semis, sorted, `${id} should be voiced low-to-high`);
  }
});

test('inversion voicings contain the same pitch classes as their root position', () => {
  // Inversions are written as offsets from the *bass* note, so the invariant is
  // not "same numbers" but "same pitch-class set, rotated by the root's offset".
  const pcSet = xs => new Set(xs.map(x => ((x % 12) + 12) % 12));
  const isInversionOf = (inv, quality) => {
    const set = pcSet(inv);
    return [...set].some(rootOffset => {
      const rotated = pcSet(quality.map(q => rootOffset + q));
      return rotated.size === set.size && [...set].every(x => rotated.has(x));
    });
  };
  assert.ok(isInversionOf(CHORDS.maj_1.semis, CHORDS.maj.semis), 'maj_1 is a major triad');
  assert.ok(isInversionOf(CHORDS.maj_2.semis, CHORDS.maj.semis), 'maj_2 is a major triad');
  assert.ok(isInversionOf(CHORDS.min_1.semis, CHORDS.min.semis), 'min_1 is a minor triad');
  assert.ok(isInversionOf(CHORDS.min_2.semis, CHORDS.min.semis), 'min_2 is a minor triad');
  // concrete spot checks: C major 1st inversion is E–G–C
  assert.deepEqual(CHORDS.maj_1.semis, [0, 3, 8]);
  assert.deepEqual(CHORDS.maj_2.semis, [0, 5, 9]);
  assert.deepEqual(CHORDS.min_1.semis, [0, 4, 9]);
  assert.deepEqual(CHORDS.min_2.semis, [0, 5, 8]);
});

test('scales start at the root and return to the octave', () => {
  const SCALES_KEY = semis => semis.filter(s => s < 12).join(',');
  for (const [id, sc] of Object.entries(SCALES)) {
    assert.equal(sc.semis[0], 0, `${id} must start on the root`);
    assert.equal(sc.semis[sc.semis.length - 1], 12, `${id} must end on the octave`);
    assert.ok(sc.semis.every((s, i) => i === 0 || s > sc.semis[i - 1]), `${id} must ascend`);
    assert.ok(sc.name, `${id} needs a name`);
  }
  // the modes are rotations of the major scale, so each has its own collection
  const collections = new Set(Object.values(SCALES).map(sc => SCALES_KEY(sc.semis)));
  assert.equal(collections.size, Object.keys(SCALES).length, 'every scale is distinct');
  // each mode is identified by its character notes
  assert.ok(SCALES.dorian.semis.includes(9) && !SCALES.natmin.semis.includes(9), 'Dorian has a natural 6th');
  assert.ok(SCALES.natmin.semis.includes(8) && !SCALES.dorian.semis.includes(8), 'natural minor has a ♭6');
  assert.ok(SCALES.mixolydian.semis.includes(10) && !SCALES.major.semis.includes(10), 'Mixolydian has a ♭7');
  assert.ok(SCALES.lydian.semis.includes(6) && !SCALES.major.semis.includes(6), 'Lydian has a ♯4');
  assert.ok(SCALES.harmmin.semis.includes(11), 'harmonic minor raises the 7th');
});

test('scale degrees cover all twelve semitones with matching labels', () => {
  const semis = Object.values(DEGREES).map(d => d.semis);
  assert.equal(semis.length, 12);
  assert.equal(new Set(semis).size, 12);
  assert.deepEqual([...semis].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i));
  assert.equal(DEGREES.do.semis, 0);
  assert.equal(DEGREES.ti.semis, 11);
  for (const [id, d] of Object.entries(DEGREES)) {
    assert.ok(d.solfege && d.number, `${id} needs both label styles`);
  }
});

test('roman numerals map to roots whose triads match their stated quality', () => {
  for (const [id, num] of Object.entries(NUMERALS)) {
    const chord = CHORDS[num.quality];
    assert.ok(chord, `${id} points at unknown quality ${num.quality}`);
    assert.ok(num.root >= 0 && num.root < 12, `${id} root must be within an octave`);
    assert.equal(num.name, id);
  }
  // I–IV–V in a major key must be major triads; ii, iii, vi minor
  for (const id of ['I', 'IV', 'V']) assert.equal(NUMERALS[id].quality, 'maj');
  for (const id of ['ii', 'iii', 'vi']) assert.equal(NUMERALS[id].quality, 'min');
  assert.equal(NUMERALS.V.root - NUMERALS.IV.root, 2); // IV → V is a whole step
  assert.equal(NUMERALS.vi.root - NUMERALS.V.root, 2); // V → vi is a whole step
  // VI is ♭VI (a major triad a minor third above the tonic), not vi
  assert.equal(NUMERALS.VI.root, 8);
  assert.equal(NUMERALS.VI.quality, 'maj');
  assert.equal(NUMERALS.VII.root, 10); // ♭VII, the subtonic
  // the minor-key numerals line up with their major-key counterparts
  assert.deepEqual(
    ['i', 'iv', 'V'].map(id => NUMERALS[id].root),
    ['I', 'IV', 'V'].map(id => NUMERALS[id].root),
  );
});

test('random helpers stay inside their ranges', () => {
  for (let i = 0; i < 500; i++) {
    const v = randInt(3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
  }
  assert.equal(randInt(5, 5), 5);
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 200; i++) assert.ok(arr.includes(choice(arr)));
  const items = ['x', 'y'];
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const picked = weightedChoice(items, [0, 1]);
    assert.equal(picked, 'y'); // zero weight must never be picked
    seen.add(picked);
  }
  assert.equal(seen.size, 1);
  assert.ok(['x', 'y'].includes(weightedChoice(items, [1, 1])));
});

test('the module registry is internally consistent', () => {
  const ids = MODULES.map(m => m.id);
  assert.equal(new Set(ids).size, ids.length, 'module ids must be unique');
  for (const mod of MODULES) {
    assert.ok(mod.title && mod.icon && mod.blurb && mod.prompt, `${mod.id} copy`);
    assert.ok(['choice', 'sequence', 'melody'].includes(mod.kind), `${mod.id} kind`);
    assert.ok(/^[a-z]+$/.test(mod.color), `${mod.id} colour token`);
    assert.ok(mod.window > 0 && mod.need > 0 && mod.need <= mod.window, `${mod.id} goal`);
    assert.ok(mod.levels.length > 0, `${mod.id} levels`);
    for (const lv of mod.levels) {
      assert.ok(lv.name && lv.hint, `${mod.id} level copy`);
    }
  }
  assert.ok(moduleById('absolute'), 'absolute module registered');
  // onboarding paths only mention modules that exist
  for (const path of Object.values(ONBOARDING_PATHS)) {
    for (const id of Object.keys(path.unlocks)) {
      assert.ok(moduleById(id), `onboarding path unlocks unknown module ${id}`);
    }
  }
});
