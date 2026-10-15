// speech.test.js — the spoken answer names are pure data over the theory
// tables, so every answer of every choice exercise can be asserted here; the
// narration sentence is checked with a stubbed speech engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spokenAnswerName, speakMiss } from '../js/speech.js';
import { INTERVALS, CHORDS, SCALES, DEGREES } from '../js/theory.js';
import * as State from '../js/state.js';

test('every multiple-choice answer has a spoken name', () => {
  State.resetAll();
  const pools = {
    pitch: ['up', 'down', 'same'],
    absolute: [...Array(12).keys()],
    intervals: Object.keys(INTERVALS),
    chords: Object.keys(CHORDS),
    scales: Object.keys(SCALES),
    degrees: Object.keys(DEGREES),
  };
  for (const [moduleId, ids] of Object.entries(pools)) {
    assert.ok(ids.length > 0, `${moduleId} has answers`);
    for (const id of ids) {
      const name = spokenAnswerName(moduleId, id);
      assert.ok(name && name.length > 0, `${moduleId}/${id} has a spoken name (got "${name}")`);
    }
  }
});

test('spoken names are pronounceable, not raw labels', () => {
  // Chord inversions: "Dominant 7th · 1st inv" would be read with the dot.
  assert.equal(spokenAnswerName('chords', 'dom7_1'), 'Dominant 7th, 1st inv');
  assert.equal(spokenAnswerName('chords', 'm7b5'), 'Half-diminished');
  // Accidentals spelled out for the voice.
  assert.equal(spokenAnswerName('absolute', 1), 'C sharp');
  assert.equal(spokenAnswerName('absolute', 3), 'E flat');
  // Solfege spelled the way it sounds.
  assert.equal(spokenAnswerName('degrees', 'do'), 'doe');
  assert.equal(spokenAnswerName('degrees', 'te'), 'teh');
});

test('degrees follow the user’s label preference', () => {
  State.resetAll();
  assert.equal(spokenAnswerName('degrees', 'ra'), 'rah');
  State.state.settings.degreeLabels = 'number';
  assert.equal(spokenAnswerName('degrees', 'ra'), 'flat 2');
  assert.equal(spokenAnswerName('degrees', 'te'), 'flat 7');
  State.resetAll();
});

test('unknown answers are refused rather than spoken', () => {
  assert.equal(spokenAnswerName('intervals', 'nope'), null);
  assert.equal(spokenAnswerName('progressions', 'I'), null);
});

test('the post-miss narration composes the sentence in order', () => {
  const spoken = [];
  globalThis.window = {
    speechSynthesis: {
      cancel() {},
      getVoices: () => [],
      speak: u => spoken.push(u.text),
    },
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
  };
  try {
    assert.equal(speakMiss('intervals', 'P5', 'M3'), true);
    assert.deepEqual(spoken, ['You chose Perfect 5th. The answer was Major 3rd.']);

    assert.equal(speakMiss('absolute', 1, 3), true);
    assert.deepEqual(spoken[1], 'You chose C sharp. The answer was E flat.');

    // A missing name stops the whole line instead of saying "null".
    assert.equal(speakMiss('intervals', 'P5', 'nope'), false);
    assert.equal(spoken.length, 2);
  } finally {
    delete globalThis.window;
    delete globalThis.SpeechSynthesisUtterance;
  }
});
