// The native screen-off engine runs from this payload, so every field it
// relies on must survive JSON and be present for every choice exercise.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScreenOffSession } from '../js/screenoff.js';

const CHOICE = ['pitch', 'absolute', 'intervals', 'chords', 'scales', 'degrees'];

test('every choice exercise builds a complete native session', () => {
  for (const moduleId of CHOICE) {
    const session = buildScreenOffSession(moduleId);
    assert.ok(session, `${moduleId} should be supported`);
    assert.equal(session.questions.length, 60);
    assert.equal(session.lang, 'en');
    assert.ok(session.volume > 0);
    assert.ok(session.idleMinutes >= 1);
    for (const cmd of ['replay', 'next', 'names', 'stop']) {
      assert.ok(session.commands[cmd]?.length, `${moduleId}: ${cmd} phrases`);
    }

    for (const q of session.questions.slice(0, 4)) {
      assert.equal(q.moduleId, moduleId);
      assert.ok(q.events?.length, `${moduleId}: question audio`);
      assert.ok(q.itemKey, `${moduleId}: stats key`);
      const ids = q.options.map(o => o.id);
      assert.ok(ids.includes(q.answerId), `${moduleId}: answer among options`);
      for (const opt of q.options) {
        assert.ok(opt.speech && typeof opt.speech === 'string');
        assert.ok(opt.aliases.length, `${moduleId}/${opt.id}: recognisable name`);
        // Pitch options ("higher/lower") have no sound of their own.
        if (moduleId !== 'pitch') {
          assert.ok(opt.events?.length, `${moduleId}/${opt.id}: preview audio`);
        }
      }
    }
  }
});

test('the payload survives JSON and stays small enough to hand to Android', () => {
  const session = buildScreenOffSession('chords');
  const json = JSON.stringify(session);
  assert.ok(json.length > 1000);
  assert.ok(json.length < 2_000_000, `payload is ${json.length} bytes`);
  const back = JSON.parse(json);
  assert.deepEqual(back.questions[0].options[0].aliases, session.questions[0].options[0].aliases);
  assert.equal(back.questions[0].itemKey, session.questions[0].itemKey);
});

test('sequences and melodies are not offered to the native engine', () => {
  assert.equal(buildScreenOffSession('progressions'), null);
  assert.equal(buildScreenOffSession('melodies'), null);
});
