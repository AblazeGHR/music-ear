// engine.test.js — every exercise must generate playable, gradable questions
// from a plain configuration object, and must stay inside the pool and register
// it was given. These run without a browser: generate() only builds data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../js/engine.js';
import { MODULES } from '../js/curriculum.js';

test('every exercise generates questions from its default configuration', () => {
  for (const mod of MODULES) {
    for (let i = 0; i < 30; i++) {
      const q = generate(mod.id, mod.defaults);
      assert.ok(q, `${mod.id} produced a question`);
      assert.equal(q.moduleId, mod.id);
      assert.equal(q.kind, mod.kind);
      if (q.kind !== 'melody') {
        assert.ok(Array.isArray(q.options) && q.options.length > 0, `${mod.id} has options`);
      }
      assert.equal(typeof q.play, 'function');
      // choice questions carry an answer id; sequence/melody carry their own
      if (q.kind === 'choice') {
        assert.ok(q.answerId !== undefined, `${mod.id} has an answer`);
        assert.ok(q.options.some(o => o.id === q.answerId));
      }
      if (q.kind === 'sequence') assert.equal(q.slots, q.answerSeq.length);
      if (q.kind === 'melody') assert.ok(q.targetMidis.length > 0 && q.keyRange[0] < q.keyRange[1]);
    }
  }
});

test('generate refuses unknown exercises', () => {
  assert.equal(generate('nope', {}), null);
  assert.equal(generate('intervals', null), null);
});

test('configured pools restrict what is asked and offered', () => {
  const cfg = { items: ['M3', 'P5'], dirs: ['a'] };
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const q = generate('intervals', cfg);
    assert.deepEqual(q.options.map(o => o.id), ['M3', 'P5']);
    assert.ok(cfg.items.includes(q.answerId));
    seen.add(q.answerId);
  }
  assert.deepEqual([...seen].sort(), ['M3', 'P5']);

  const chords = { items: ['maj', 'min'] };
  for (let i = 0; i < 100; i++) {
    const q = generate('chords', chords);
    assert.deepEqual(q.options.map(o => o.id), ['maj', 'min']);
    assert.ok(['maj', 'min'].includes(q.answerId));
  }

  const degrees = { mode: 'minor', items: ['do', 'me', 'sol'], wide: false };
  for (let i = 0; i < 100; i++) {
    const q = generate('degrees', degrees);
    assert.deepEqual(q.options.map(o => o.id), degrees.items);
    assert.ok(degrees.items.includes(q.answerId));
  }

  const melodies = { degrees: ['do', 're', 'mi'], length: 3, upperDo: false, leapy: false, chromatic: 0, firstGiven: true };
  for (let i = 0; i < 50; i++) {
    const q = generate('melodies', melodies);
    assert.equal(q.targetMidis.length, 3);
    // every answer note is within the rendered keyboard
    for (const m of q.targetMidis) assert.ok(m >= q.keyRange[0] && m <= q.keyRange[1]);
  }
});

test('configured registers and gap bounds are respected', () => {
  const cfg = { items: Array.from({ length: 12 }, (_, i) => i), range: [40, 50] };
  for (let i = 0; i < 400; i++) {
    assert.ok(generate('absolute', cfg).noteMidi >= 40 && generate('absolute', cfg).noteMidi <= 50);
  }

  const pitch = { gap: [7, 12], allowSame: false };
  for (let i = 0; i < 200; i++) {
    const q = generate('pitch', pitch);
    const gap = Math.abs(q.events[1].midi - q.events[0].midi);
    assert.ok(gap >= 7 && gap <= 12, `pitch gap ${gap} escaped [7, 12]`);
    assert.ok(['up', 'down'].includes(q.answerId), 'allowSame=false must not ask "same"');
  }

  const fine = { gap: [1, 1], allowSame: true };
  for (let i = 0; i < 100; i++) {
    const q = generate('pitch', fine);
    const gap = Math.abs(q.events[1].midi - q.events[0].midi);
    assert.ok(gap <= 1, `fine-tuning gap ${gap} should be at most 1`);
  }
});

test('progression questions honour their length and tonic settings', () => {
  const cfg = { mode: 'major', pool: ['I', 'IV', 'V'], length: 3, startTonic: true };
  for (let i = 0; i < 100; i++) {
    const q = generate('progressions', cfg);
    assert.equal(q.answerSeq.length, 3);
    assert.equal(q.answerSeq[0], 'I', 'startTonic must open on I');
    assert.equal(q.given[0], true);
    assert.deepEqual(q.options.map(o => o.id), ['I', 'IV', 'V']);
  }
  const free = { ...cfg, startTonic: false };
  for (let i = 0; i < 100; i++) {
    const q = generate('progressions', free);
    assert.equal(q.given[0], false);
    assert.ok(['I', 'IV', 'V'].includes(q.answerSeq[0]));
  }
});

test('interval replays re-voice the question in a different direction', () => {
  const dirOf = events => {
    if (events.length === 1) return 'h';                 // both notes at once
    return events[1].midi > events[0].midi ? 'a' : 'd';
  };
  const cfg = { items: ['P5'], dirs: ['a', 'd', 'h'] };

  for (let i = 0; i < 40; i++) {
    const q = generate('intervals', cfg);
    assert.equal(q.dir, dirOf(q.events), 'the generated voicing matches its direction');
    let prev = q.dir;
    for (let k = 0; k < 6; k++) {
      const events = q.replayNext();   // the pure half of replay(): no audio
      assert.notEqual(q.dir, prev, 'a replay never repeats the direction just heard');
      assert.equal(q.dir, dirOf(events), 'the re-voicing matches its direction');
      assert.equal(q.events, events);
      prev = q.dir;
    }
  }

  // Across many replays every selected direction actually comes up.
  const seen = new Set();
  const q = generate('intervals', cfg);
  for (let i = 0; i < 200; i++) { q.replayNext(); seen.add(q.dir); }
  for (const d of ['a', 'd', 'h']) assert.ok(seen.has(d), `direction ${d} never chosen`);

  // With a single direction selected there is no alternative: replay stays put.
  const single = generate('intervals', { items: ['P5'], dirs: ['d'] });
  single.replayNext();
  assert.equal(single.dir, 'd');

  // Exercises without a replay hook keep their plain play().
  const chord = generate('chords', MODULES.find(m => m.id === 'chords').defaults);
  assert.equal(typeof chord.replay, 'undefined');
});

test('interval directions keep the same pair of notes — order or simultaneity only', () => {
  const notesOf = events => (events.length === 1 ? [...events[0].midis] : events.map(e => e.midi));
  const key = arr => [...arr].sort((x, y) => x - y).join(',');
  const cfg = { items: ['P5'], dirs: ['a', 'd', 'h'] };

  for (let i = 0; i < 30; i++) {
    const q = generate('intervals', cfg);
    const pairs = new Map([[q.dir, notesOf(q.events)]]);
    for (let k = 0; k < 60 && pairs.size < 3; k++) {
      q.replayNext();
      pairs.set(q.dir, notesOf(q.events));
    }
    const asc = pairs.get('a'), desc = pairs.get('d'), harm = pairs.get('h');
    assert.ok(asc && desc && harm, 'all three directions seen');
    assert.equal(key(asc), key(desc), 'ascending and descending use the same two pitches');
    assert.equal(key(asc), key(harm), 'harmonic uses the same two pitches');
    assert.deepEqual(desc, [...asc].reverse(), 'descending is the ascending pair reversed');
    // the pair itself never moves while replaying within one question
    assert.ok(asc[1] > asc[0], 'ascending starts on the lower note');
  }
});

test('melody statistics keys follow the configuration, not a level index', () => {
  const base = MODULES.find(m => m.id === 'melodies').defaults;
  const a = generate('melodies', { ...base, length: 5, firstGiven: false, leapy: true, chromatic: 0.18 });
  assert.match(a.grade(a.targetMidis).itemResults[0].key, /^ml:5:0:1:1$/);
  const b = generate('melodies', { ...base });
  assert.match(b.grade(b.targetMidis).itemResults[0].key, /^ml:4:1:0:0$/);
  // chromatic melodies use the same key as plain ones of the same shape
  const c = generate('melodies', { ...base, chromatic: 0.18 });
  assert.match(c.grade(c.targetMidis).itemResults[0].key, /^ml:4:1:0:1$/);
});

test('grading returns the whole-question verdict plus per-skill results', () => {
  const q = generate('progressions', { mode: 'major', pool: ['I', 'V'], length: 3, startTonic: true });
  const right = q.grade([...q.answerSeq]);
  assert.equal(right.correct, true);
  assert.equal(right.itemResults.length, 2, 'the given first slot is not a skill to grade');
  const wrong = q.grade(q.answerSeq.map((n, i) => (i === 0 ? n : 'I')));
  assert.equal(wrong.correct, false);
});

test('degenerate option pools terminate instead of hanging or throwing', () => {
  // A one-chord pool has no alternative to pick: the generator must not spin
  // forever in its "avoid repeating the previous chord" loop.
  for (let i = 0; i < 50; i++) {
    const q = generate('progressions', { mode: 'major', pool: ['I'], length: 4, startTonic: true });
    assert.equal(q.answerSeq.length, 4);
    assert.deepEqual(q.answerSeq, ['I', 'I', 'I', 'I']);
    assert.deepEqual(q.options.map(o => o.id), ['I']);
    assert.equal(q.grade(['I', 'I', 'I', 'I']).correct, true);
  }

  // Switching to a minor key while the pool only holds major numerals must not
  // force a tonic that has no answer button.
  for (let i = 0; i < 50; i++) {
    const q = generate('progressions', { mode: 'minor', pool: ['I', 'IV', 'V'], length: 3, startTonic: true });
    assert.equal(q.answerSeq.length, 3);
    assert.ok(q.options.some(o => o.id === q.answerSeq[0]), 'first chord must be answerable');
    assert.equal(q.given[0], false, 'no phantom tonic when the pool lacks it');
  }

  // A one-note melody pool cannot move: it must repeat, not crash.
  for (let i = 0; i < 50; i++) {
    const q = generate('melodies', { degrees: ['do'], length: 3, upperDo: false, leapy: false, chromatic: 0, firstGiven: true });
    assert.equal(q.targetMidis.length, 3);
    assert.equal(new Set(q.targetMidis).size, 1);
    assert.equal(q.grade(q.targetMidis).correct, true);
  }

  // A two-degree pool still moves.
  for (let i = 0; i < 50; i++) {
    const q = generate('melodies', { degrees: ['do', 're'], length: 4, upperDo: false, leapy: false, chromatic: 0, firstGiven: true });
    assert.equal(q.targetMidis.length, 4);
  }
});
