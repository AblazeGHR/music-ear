// absolute-pitch.test.js — the absolute pitch exercise is the app's newest
// requirement and the only one that must play a note with no tonal context
// whatsoever, so its invariants are asserted explicitly rather than left to a
// manual listening test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/engine.js';
import { moduleById } from '../js/curriculum.js';
import { pitchClassName } from '../js/theory.js';

const mod = moduleById('absolute');
const DEFAULTS = mod.defaults;
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const ALL = Array.from({ length: 12 }, (_, i) => i);
const ACCIDENTALS = [1, 3, 6, 8, 10];

test('the absolute exercise is registered with sane defaults', () => {
  assert.ok(mod, 'exercise registered');
  assert.equal(mod.kind, 'choice');
  assert.deepEqual([...DEFAULTS.items].sort((a, b) => a - b), ALL);
  assert.deepEqual(DEFAULTS.range, [48, 72]);
  // every configurable default is offered in the options panel
  assert.deepEqual(mod.options.map(o => o.key).sort(), ['items', 'range']);
});

test('a question offers exactly the configured names, spelled from theory.js', () => {
  for (const cfg of [DEFAULTS, { ...DEFAULTS, items: NATURALS }, { ...DEFAULTS, items: ACCIDENTALS }]) {
    for (let i = 0; i < 25; i++) {
      const q = generate('absolute', cfg);
      assert.equal(q.kind, 'choice');
      assert.equal(q.moduleId, 'absolute');
      assert.deepEqual(q.options.map(o => o.id), cfg.items);
      assert.deepEqual(q.options.map(o => o.label), cfg.items.map(pitchClassName));
      assert.ok(cfg.items.includes(q.answerId), 'answer must be one of the offered names');
      assert.equal(typeof q.play, 'function');
      assert.equal(typeof q.playOption, 'function');
    }
  }
});

test('a question sounds exactly one note — no reference, no key, no drone', () => {
  for (let i = 0; i < 100; i++) {
    const q = generate('absolute', DEFAULTS);
    assert.equal(q.events.length, 1, 'only the bare note may sound');
    assert.equal(q.events[0].midi, q.noteMidi);
    assert.equal(q.events[0].at, 0, 'the note starts the question');
    assert.ok(q.events.every(e => e.at === 0));
    assert.ok(!('cadence' in q) && !('drone' in q), 'no tonal context on the question');
  }
});

test('notes stay inside the configured register', () => {
  for (const [lo, hi] of [[48, 72], [40, 55], [60, 84]]) {
    const cfg = { ...DEFAULTS, range: [lo, hi] };
    for (let i = 0; i < 300; i++) {
      const q = generate('absolute', cfg);
      assert.ok(q.noteMidi >= lo && q.noteMidi <= hi, `midi ${q.noteMidi} escaped [${lo}, ${hi}]`);
    }
  }
  // every offered name should actually come up over many draws
  const seen = new Set();
  for (let i = 0; i < 800; i++) seen.add(generate('absolute', DEFAULTS).answerId);
  for (const pc of ALL) assert.ok(seen.has(pc), `${pitchClassName(pc)} never generated`);
});

test('grading compares the pitch class and records per-name statistics', () => {
  for (let i = 0; i < 60; i++) {
    const q = generate('absolute', { ...DEFAULTS, items: ALL });

    const right = q.grade(q.answerId);
    assert.equal(right.correct, true);
    assert.deepEqual(right.itemResults, [{ key: `ap:${q.answerId}`, correct: true }]);

    const wrongOption = q.options.find(o => o.id !== q.answerId);
    assert.ok(wrongOption, 'a 12-name pool always has a wrong option');
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
    const q = generate('absolute', { ...DEFAULTS, items: ACCIDENTALS });
    for (const o of q.options) {
      assert.equal(typeof o.id, 'number');
      assert.equal(o.label, pitchClassName(o.id));
    }
    assert.equal(q.grade(q.answerId).correct, true);
  }
});
