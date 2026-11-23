// notation.test.js — the score is the question in sight reading, so its
// geometry is part of grading correctness. These tests read the pure layout
// (no DOM): pitches must sit on the right line, notes must not collide, ledger
// lines and beams must appear where the music needs them, and the tab must put
// each fret number on the right string.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutScore, renderScore, diatonicStep, noteY, fretFor, tabLineY, GEOM,
} from '../js/notation.js';
import { STAFF_POOL, TAB_POOL } from '../js/reading.js';

const notesOf = (midis, beats = 1) => midis.map(midi => ({ midi, beats }));

test('pitch maps to the staff line it belongs to', () => {
  // Bottom line E4, top line F5; middle C one ledger below.
  assert.equal(noteY(64), GEOM.bottom);          // E4
  assert.equal(noteY(67), GEOM.bottom - 10);     // G4
  assert.equal(noteY(71), GEOM.bottom - 20);     // B4
  assert.equal(noteY(74), GEOM.bottom - 30);     // D5
  assert.equal(noteY(77), GEOM.bottom - 40);     // F5
  assert.equal(noteY(60), GEOM.bottom + 10);     // C4
  assert.equal(noteY(84), GEOM.bottom - 60);     // C6
  // One diatonic step is half a space; a black key has no staff position here.
  assert.equal(diatonicStep(65) - diatonicStep(64), 1);
  assert.equal(diatonicStep(61), null);
});

test('ledger lines appear only for notes outside the staff', () => {
  const lay = layoutScore(notesOf([60, 62, 64, 81, 83, 84]));
  const ledgers = lay.notes.map(n => n.ledgers.length);
  assert.deepEqual(ledgers, [1, 0, 0, 1, 1, 2]);
  // C4's ledger is the line the note head sits on.
  assert.deepEqual(lay.notes[0].ledgers, [90]);
  // C6 needs A5's ledger and its own.
  assert.deepEqual(lay.notes[5].ledgers, [30, 20]);
});

test('stems follow the middle line and eighth pairs are beamed by beat', () => {
  const lay = layoutScore([
    { midi: 60, beats: 1 },     // C4 — well below the middle: stem up
    { midi: 62, beats: 0.5 },   // D4 }
    { midi: 64, beats: 0.5 },   // E4 } beamed pair on beat 2
    { midi: 76, beats: 0.5 },   // E5 }
    { midi: 74, beats: 0.5 },   // D5 } second beamed pair
    { midi: 79, beats: 1 },     // G5 — above the middle: stem down
    { midi: 71, beats: 3 },     // B4 — long note
  ]);
  assert.equal(lay.notes[0].stem, 'up');
  assert.equal(lay.notes[5].stem, 'down');

  assert.equal(lay.groups.length, 2);
  assert.deepEqual(lay.groups[0].notes.map(n => n.index), [1, 2]);
  assert.deepEqual(lay.groups[1].notes.map(n => n.index), [3, 4]);
  assert.equal(lay.notes[5].beam, null);
  assert.equal(lay.notes[5].flag, false);

  // A lone eighth (an eighth that is not paired with one in its beat) gets a
  // flag instead of a beam.
  const single = layoutScore([{ midi: 60, beats: 0.5 }, { midi: 62, beats: 3.5 }]);
  assert.equal(single.groups.length, 0);
  assert.equal(single.notes[0].flag, true);
});

test('notes never overlap and never sit on a barline', () => {
  const lay = layoutScore(notesOf(Array.from({ length: 16 }, (_, i) => 60 + (i % 2 === 0 ? 0 : 2)), 1));
  for (let i = 1; i < lay.notes.length; i++) {
    if (lay.notes[i].system !== lay.notes[i - 1].system) {
      // A new system starts back at the left margin.
      assert.equal(lay.notes[i].x, GEOM.startX);
      continue;
    }
    const dx = lay.notes[i].x - lay.notes[i - 1].x;
    assert.ok(dx >= 14, `notes ${i - 1} and ${i} are ${dx}px apart`);
  }
  // Four bars = two systems of two bars each; the second system restarts at left.
  assert.equal(lay.measures, 4);
  assert.equal(lay.systems.length, 2);

  // A note on the first beat of a bar clears the barline by a small margin.
  for (const sys of lay.systems) {
    for (const bar of sys.barlines) {
      for (const n of lay.notes) {
        if (n.system !== sys.index) continue;
        assert.ok(Math.abs(n.x - bar.x) > 6, `note at ${n.x} collides with barline at ${bar.x}`);
        assert.ok(n.x + GEOM.headRx <= bar.x || n.x - GEOM.headRx >= bar.x);
      }
    }
  }
});

test('the whole score stays inside its viewBox', () => {
  for (const [midis, beats] of [
    [STAFF_POOL, 1],
    [[84], 4],
    [[60], 4],
    [Array.from({ length: 16 }, (_, i) => STAFF_POOL[i % STAFF_POOL.length]), 0.5],
  ]) {
    const lay = layoutScore(notesOf(midis, beats));
    assert.ok(lay.width > 0 && lay.height > 0);
    for (const n of lay.notes) {
      assert.ok(n.x > 0 && n.x < lay.width, `x ${n.x} outside ${lay.width}`);
      assert.ok(n.y > 0 && n.y < GEOM.systemH, `y ${n.y} outside its system`);
    }
    for (const sys of lay.systems) {
      assert.ok(sys.lines.length === 5, 'five staff lines');
      assert.ok(sys.lines.every(l => l.x2 <= sys.width));
      assert.ok(sys.barlines.every(b => b.x <= sys.endX + 0.01));
    }
  }
});

test('the tab writes every note on the right string and fret', () => {
  const lay = layoutScore(notesOf(TAB_POOL), { notation: 'tab' });
  assert.equal(lay.notation, 'tab');
  assert.equal(lay.systems[0].lines.length, 6, 'six tab lines');
  for (const n of lay.notes) {
    const place = fretFor(n.midi);
    assert.equal(n.string, place.string);
    assert.equal(n.fret, place.fret);
    assert.equal(n.y, tabLineY(place.string));
    assert.ok(n.fret >= 0 && n.fret <= 4);
  }
  // String 1 sits on the top line, string 6 on the bottom.
  assert.equal(tabLineY(1), GEOM.top);
  assert.equal(tabLineY(6), GEOM.bottom);
});

test('the markup is a self-contained, accessible SVG', () => {
  for (const notation of ['staff', 'tab']) {
    const svg = renderScore(notesOf([60, 62, 64, 65, 67, 69, 71, 72]), { notation });
    assert.match(svg, /^<svg /);
    assert.match(svg, /viewBox="0 0 [\d.]+ [\d.]+"/);
    assert.match(svg, /width="100%"/);
    assert.match(svg, /role="img"/);
    assert.match(svg, /<title>C major melody, 8 notes, (treble staff|guitar tab)<\/title>/);
    assert.match(svg, /<desc>/);
    // Only the SVG namespace is allowed — nothing is fetched or embedded.
    assert.doesNotMatch(svg, /xlink:href|<image|<script|@import|url\(/, 'no external references');
    assert.equal((svg.match(/data-role="staff-line"/g) || []).length, notation === 'tab' ? 6 : 5);
    assert.equal((svg.match(/data-note="/g) || []).length, 8);
  }
});

test('a rendered melody carries one node per note and no stray accidentals', () => {
  const svg = renderScore(notesOf([60, 64, 67, 72], 2), { notation: 'staff', showNames: true });
  assert.equal((svg.match(/class="st-head"/g) || []).length, 4);
  assert.equal((svg.match(/class="st-name"/g) || []).length, 4);
  assert.doesNotMatch(svg, /♯|♭/, 'C major is written without accidentals');
});

test('a default eight-note melody is two bars wide', () => {
  const lay = layoutScore(notesOf([60, 62, 64, 65, 67, 69, 71, 72], 1));
  assert.equal(lay.measures, 2);
  assert.equal(lay.systems.length, 1);
  assert.ok(lay.width < 370, 'two bars fit a 390px phone without scrolling');
});
