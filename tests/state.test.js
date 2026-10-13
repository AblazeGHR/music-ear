// state.test.js — persistence, per-skill statistics and the exercise
// configuration merge. Needs the localStorage stub, so it is imported first.

import './localstorage-stub.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as State from '../js/state.js';
import { moduleById } from '../js/curriculum.js';

test('moduleConfig merges registry defaults with stored overrides', () => {
  State.resetAll();
  assert.deepEqual(State.moduleConfig('intervals'), moduleById('intervals').defaults);

  State.setExerciseOption('intervals', 'dirs', ['a']);
  const cfg = State.moduleConfig('intervals');
  assert.deepEqual(cfg.dirs, ['a'], 'the override applies');
  assert.deepEqual(cfg.items, moduleById('intervals').defaults.items, 'untouched keys keep defaults');

  State.resetExercise('intervals');
  assert.deepEqual(State.moduleConfig('intervals'), moduleById('intervals').defaults);
});

test('chip pools always come back in the registry’s canonical order', () => {
  State.resetAll();
  // Clicked wildly out of order; the config must read back musically sorted.
  State.setExerciseOption('intervals', 'items', ['P5', 'm2', 'M3']);
  assert.deepEqual(State.moduleConfig('intervals').items, ['m2', 'M3', 'P5']);

  State.setExerciseOption('degrees', 'items', ['sol', 'do', 'mi']);
  assert.deepEqual(State.moduleConfig('degrees').items, ['do', 'mi', 'sol']);

  State.setExerciseOption('progressions', 'pool', ['V', 'I', 'vi']);
  assert.deepEqual(State.moduleConfig('progressions').pool, ['I', 'V', 'vi']);

  State.setExerciseOption('absolute', 'items', [9, 0, 4]);
  assert.deepEqual(State.moduleConfig('absolute').items, [0, 4, 9]);

  // The stored override keeps whatever the user clicked; only the read path sorts.
  assert.deepEqual(State.state.settings.exercises.intervals.items, ['m2', 'M3', 'P5'],
    'writes store the canonical order too, via the merged config');
});

test('the configuration survives a save/load round-trip', () => {
  State.resetAll();
  State.setExerciseOption('absolute', 'range', [40, 60]);
  State.load();
  assert.deepEqual(State.moduleConfig('absolute').range, [40, 60]);
});

test('recordAnswer accumulates items, exercises, confusions and totals', () => {
  State.resetAll();
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: true }], true, null);
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: false }], false,
    { correctId: 'P5', answeredId: 'P4' });
  State.recordAnswer('chords', [{ key: 'ch:maj', correct: true }], true, null);

  const st = State.state;
  assert.equal(st.items['iv:P5:a'].a, 2);
  assert.equal(st.items['iv:P5:a'].c, 1);
  assert.deepEqual(st.items['iv:P5:a'].recent, [1, 0]);
  assert.deepEqual(st.modules.intervals, { a: 2, c: 1 });
  assert.deepEqual(st.modules.chords, { a: 1, c: 1 });
  assert.equal(st.confusions['intervals|P5>P4'], 1);
  assert.equal(st.confusions['intervals|P4>P5'], undefined, 'confusions are directional');
  assert.deepEqual(st.totals, { a: 3, c: 2 });
  // identical confusions count up
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: false }], false,
    { correctId: 'P5', answeredId: 'P4' });
  assert.equal(State.state.confusions['intervals|P5>P4'], 2);
  // a "correct" answer never records a confusion
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: true }], true,
    { correctId: 'P5', answeredId: 'P5' });
  assert.equal(State.state.confusions['intervals|P5>P5'], undefined);
});

test('itemWeight favours unseen and recently-missed skills', () => {
  State.resetAll();
  const unseen = State.itemWeight('iv:P5:a');
  assert.equal(unseen, 3);
  for (let i = 0; i < 10; i++) {
    State.recordAnswer('intervals', [{ key: 'iv:P4:a', correct: i < 3 }], i < 3, null);
  }
  const weak = State.itemWeight('iv:P4:a');
  assert.ok(weak > unseen, `weak skill weight ${weak} should exceed the unseen weight ${unseen}`);
});

test('topConfusions ranks by count', () => {
  State.resetAll();
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: false }], false, { correctId: 'P5', answeredId: 'P4' });
  State.recordAnswer('intervals', [{ key: 'iv:M3:a', correct: false }], false, { correctId: 'M3', answeredId: 'm3' });
  State.recordAnswer('intervals', [{ key: 'iv:M3:a', correct: false }], false, { correctId: 'M3', answeredId: 'm3' });
  const top = State.topConfusions(8);
  assert.equal(top[0].correctId, 'M3');
  assert.equal(top[0].answeredId, 'm3');
  assert.equal(top[0].count, 2);
  assert.equal(top[1].count, 1);
});

test('export/import round-trips and rejects foreign files', () => {
  State.resetAll();
  State.recordAnswer('chords', [{ key: 'ch:maj', correct: true }], true, null);
  const json = State.exportJSON();

  State.resetAll();
  assert.equal(State.state.totals.a, 0);
  State.importJSON(json);
  assert.equal(State.state.totals.a, 1);
  assert.equal(State.state.items['ch:maj'].c, 1);
  assert.deepEqual(State.state.modules.chords, { a: 1, c: 1 });

  assert.throws(() => State.importJSON('{"version": 1}'), /backup/);
  assert.throws(() => State.importJSON('not json'));
});
