// absolute-pitch.test.js — the absolute pitch module is the app's newest
// requirement (roadmap M1) and the only one that must play a note with no
// tonal context whatsoever, so its invariants are asserted explicitly rather
// than left to a manual listening test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/engine.js';
import { moduleById } from '../js/curriculum.js';
import { pitchClassName } from '../js/theory.js';

const mod = moduleById('absolute');
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const ALL = Array.from({ length: 12 }, (_, i) => i);
const ACCIDENTALS = [1, 3, 6, 8, 10];

test('the absolute module is registered with its level ladder', () => {
  assert.ok(mod, 'module registered');
  assert.equal(mod.kind, 'choice');
  assert.equal(mod.window, 12);
  assert.ok(mod.need > 0 && mod.need <= mod.window);
  assert.deepEqual(
    mod.levels.map(l => l.items),
    [NATURALS, ALL, ALL, ACCIDENTALS],
    'natural notes → all twelve → all twelve wide → accidentals only',
  );
  for (const lv of mod.levels) {
    assert.ok(Array.isArray(lv.range) && lv.range.length === 2, `${lv.name} range`);
    assert.ok(lv.range[0] <= lv.range[1], `${lv.name} range order`);
    assert.ok(new Set(lv.items).size === lv.items.length, `${lv.name} items unique`);
    assert.ok(lv.items.every(pc => Number.isInteger(pc) && pc >= 0 && pc < 12));
  }
});

test('each question offers exactly the level names, spelled from theory.js', () => {
  mod.levels.forEach((lv, idx) => {
    for (let i = 0; i < 25; i++) {
      const q = generate('absolute', idx);
      assert.equal(q.kind, 'choice');
      assert.equal(q.moduleId, 'absolute');
      assert.deepEqual(q.options.map(o => o.id), lv.items);
      assert.deepEqual(q.options.map(o => o.label), lv.items.map(pitchClassName));
      assert.ok(lv.items.includes(q.answerId), 'answer must be one of the offered names');
      assert.equal(typeof q.play, 'function');
      assert.equal(typeof q.playOption, 'function');
    }
  });
});

test('a question sounds exactly one note — no reference, no key, no drone', () => {
  for (const idx of [0, 1, 2, 3]) {
    for (let i = 0; i < 60; i++) {
      const q = generate('absolute', idx);
      assert.equal(q.events.length, 1, 'only the bare note may sound');
      assert.equal(q.events[0].midi, q.noteMidi);
      assert.equal(q.events[0].at, 0, 'the note starts the question');
      // a cadence or drone would add earlier events at non-zero offsets
      assert.ok(q.events.every(e => e.at === 0));
      assert.ok(!('cadence' in q) && !('drone' in q), 'no tonal context on the question');
    }
  }
});

test('notes stay inside the level range, and the wide level really is wider', () => {
  mod.levels.forEach((lv, idx) => {
    const [lo, hi] = lv.range;
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      const q = generate('absolute', idx);
      assert.ok(q.noteMidi >= lo && q.noteMidi <= hi, `midi ${q.noteMidi} escaped [${lo}, ${hi}]`);
      seen.add(q.noteMidi % 12);
    }
    // every offered name should actually come up over 400 draws
    for (const pc of lv.items) assert.ok(seen.has(pc), `${pitchClassName(pc)} never generated`);
  });
  const narrow = mod.levels[0].range;
  const wide = mod.levels[2].range;
  assert.ok(wide[1] - wide[0] > narrow[1] - narrow[0], 'the "Any octave" level must be wider');
});

test('grading compares the pitch class and records per-name statistics', () => {
  for (let i = 0; i < 60; i++) {
    const q = generate('absolute', 1);

    const right = q.grade(q.answerId);
    assert.equal(right.correct, true);
    assert.deepEqual(right.itemResults, [{ key: `ap:${q.answerId}`, correct: true }]);

    const wrongOption = q.options.find(o => o.id !== q.answerId);
    assert.ok(wrongOption, 'a 12-name level always has a wrong option');
    const wrong = q.grade(wrongOption.id);
    assert.equal(wrong.correct, false);
    assert.deepEqual(wrong.itemResults, [{ key: `ap:${q.answerId}`, correct: false }]);
    assert.equal(wrong.confusion.correctId, q.answerId);
    assert.equal(wrong.confusion.answeredId, wrongOption.id);
  }
});

test('answer ids are pitch classes, not labels, so enharmonics cannot drift', () => {
  // The app-wide spelling table fixes one name per pitch class; the grade path
  // must compare numbers so a name change can never silently break scoring.
  for (let i = 0; i < 40; i++) {
    const q = generate('absolute', 3); // accidentals only
    for (const o of q.options) {
      assert.equal(typeof o.id, 'number');
      assert.equal(o.label, pitchClassName(o.id));
    }
    assert.equal(q.grade(q.answerId).correct, true);
  }
});
