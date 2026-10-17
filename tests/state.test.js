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

test('clearing one exercise erases only that exercise', () => {
  State.resetAll();
  const cf = (a, b) => ({ correctId: a, answeredId: b });
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: false }], false, cf('P5', 'M3'), 'choice');
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: true }], true, cf('P5', 'P5'), 'choice');
  State.recordAnswer('chords', [{ key: 'ch:maj', correct: true }], true, cf('maj', 'maj'), 'choice');
  assert.equal(State.state.totals.a, 3);

  State.clearModule('intervals');

  assert.deepEqual(State.moduleStats('intervals'), { a: 0, c: 0 });
  assert.equal(State.state.items['iv:P5:a'], undefined);
  assert.equal(State.state.answers.intervals, undefined);
  assert.equal(Object.keys(State.state.confusions).filter(k => k.startsWith('intervals|')).length, 0);

  // The other exercise is untouched…
  assert.deepEqual(State.moduleStats('chords'), { a: 1, c: 1 });
  assert.ok(State.state.items['ch:maj']);
  assert.deepEqual(State.state.answers.chords.maj, { a: 1, c: 1, wrong: {} });
  // …and the global totals follow what is left.
  assert.deepEqual(State.state.totals, { a: 1, c: 1 });
});

test('clearing an unknown exercise is a no-op', () => {
  State.resetAll();
  State.recordAnswer('chords', [{ key: 'ch:maj', correct: true }], true, null, 'choice');
  assert.doesNotThrow(() => State.clearModule('nope'));
  assert.deepEqual(State.state.totals, { a: 1, c: 1 });
});

test('the tap window is a free value, clamped to something usable', () => {
  // Anything inside the range passes through, rounded to a whole millisecond.
  assert.equal(State.clampTapWindow(275), 275);
  assert.equal(State.clampTapWindow(412.6), 413);
  assert.equal(State.clampTapWindow('600'), 600);
  // Outside it, the bounds win — the recognizer must never get a value that
  // would leave taps uncommittable or firing instantly.
  assert.equal(State.clampTapWindow(10), State.TAP_WINDOW_MIN);
  assert.equal(State.clampTapWindow(99999), State.TAP_WINDOW_MAX);
  // Garbage falls back to the default rather than NaN.
  assert.equal(State.clampTapWindow('abc'), 350);
  assert.equal(State.clampTapWindow(undefined), 350);
});

test('multiple-choice answers track per-answer misses and what was picked', () => {
  State.resetAll();
  const cf = (correctId, answeredId) => ({ correctId, answeredId });
  // Perfect 5th came up four times: right twice, missed as M3 once and P8 once.
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: true }], true, cf('P5', 'P5'), 'choice');
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: false }], false, cf('P5', 'M3'), 'choice');
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: false }], false, cf('P5', 'P8'), 'choice');
  State.recordAnswer('intervals', [{ key: 'iv:P5:a', correct: true }], true, cf('P5', 'P5'), 'choice');

  const bd = State.answerBreakdown('intervals');
  assert.equal(bd.length, 1);
  assert.equal(bd[0].id, 'P5');
  assert.equal(bd[0].a, 4);
  assert.equal(bd[0].c, 2);
  assert.equal(bd[0].wrongTotal, 2);
  assert.deepEqual(bd[0].wrong, [['M3', 1], ['P8', 1]]);

  // The new bookkeeping leaves the existing statistics untouched.
  assert.deepEqual(State.moduleStats('intervals'), { a: 4, c: 2 });
  assert.deepEqual(State.itemStats('iv:P5:a'), { a: 4, c: 2, recent: [1, 0, 0, 1] });
});

test('non-choice questions record no per-answer breakdown', () => {
  State.resetAll();
  State.recordAnswer('progressions', [{ key: 'pg:major:I', correct: true }], true, null, 'sequence');
  State.recordAnswer('melodies', [{ key: 'ml:do', correct: false }], false, null, 'melody');
  assert.deepEqual(State.answerBreakdown('progressions'), []);
  assert.deepEqual(State.answerBreakdown('melodies'), []);
  assert.deepEqual(State.state.answers, {});
});

test('the breakdown is worst-first and survives export/import', () => {
  State.resetAll();
  const cf = (a, b) => ({ correctId: a, answeredId: b });
  for (let i = 0; i < 3; i++) State.recordAnswer('absolute', [{ key: 'ab:4', correct: false }], false, cf(4, 0), 'choice');
  for (let i = 0; i < 2; i++) State.recordAnswer('absolute', [{ key: 'ab:0', correct: false }], false, cf(0, 4), 'choice');
  State.recordAnswer('absolute', [{ key: 'ab:0', correct: true }], true, cf(0, 0), 'choice');

  const ids = () => State.answerBreakdown('absolute').map(x => x.id);
  assert.deepEqual(ids(), ['4', '0'], 'the highest miss rate comes first');
  State.importJSON(State.exportJSON());
  assert.deepEqual(ids(), ['4', '0']);
  assert.deepEqual(State.answerBreakdown('absolute')[0].wrong, [['0', 3]]);
});

test('the breakdown ranks by miss rate, not raw miss count', () => {
  State.resetAll();
  const cf = (a, b) => ({ correctId: a, answeredId: b });
  // Asked a lot, missed a little: 20%.
  for (let i = 0; i < 5; i++) State.recordAnswer('chords', [{ key: 'ch:maj', correct: i > 0 }], i > 0, i > 0 ? cf('maj', 'maj') : cf('maj', 'min'), 'choice');
  // Asked once, missed once: 100% — the weakest answer despite one single miss.
  State.recordAnswer('chords', [{ key: 'ch:dim', correct: false }], false, cf('dim', 'min'), 'choice');

  assert.deepEqual(State.answerBreakdown('chords').map(x => x.id), ['dim', 'maj']);
});
