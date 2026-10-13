// gesture.test.js — the eyes-closed input recognizer is a pure state machine
// (explicit coordinates and timestamps in, callbacks out), so every gesture
// rule is pinned down without a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecognizer, isCircle, GESTURE_DEFAULTS } from '../js/gesture.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function recorder(options = {}) {
  const calls = [];
  const handlers = {
    onTap: n => calls.push(['tap', n]),
    onCommit: n => calls.push(['commit', n]),
    onHold: () => calls.push(['hold']),
    onCircle: () => calls.push(['circle']),
  };
  return { calls, rec: createRecognizer(handlers, { tapWindowMs: 30, holdMs: 40, ...options }) };
}

// A tap: pointer down and up at the same spot, a few ms apart.
function tap(rec, x = 100, y = 100, t = 0, dur = 10) {
  rec.pointerDown(x, y, t);
  rec.pointerUp(x, y, t + dur);
}

// A press held still for `dur` ms.
function hold(rec, x = 100, y = 100, t = 0, dur = 80) {
  rec.pointerDown(x, y, t);
  rec.pointerMove(x + 1, y + 1, t + dur / 2);   // tiny jitter stays a hold
  rec.pointerUp(x, y, t + dur);
}

// Points around a circle, fed in as down/move…/up.
function circle(rec, { cx = 200, cy = 200, r = 80, turns = 1.25, steps = 32, t0 = 0, dur = 400 } = {}) {
  rec.pointerDown(cx + r, cy, t0);
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI * turns;
    rec.pointerMove(cx + r * Math.cos(a), cy + r * Math.sin(a), t0 + (dur * i) / steps);
  }
  rec.pointerUp(cx + r, cy, t0 + dur);
}

test('N quick taps commit once as "option N"', async () => {
  const { calls, rec } = recorder();
  tap(rec, 100, 100, 0);
  assert.deepEqual(calls, [['tap', 1]]);
  tap(rec, 100, 100, 10);
  assert.deepEqual(calls, [['tap', 1], ['tap', 2]]);
  await sleep(50);
  assert.deepEqual(calls, [['tap', 1], ['tap', 2], ['commit', 2]],
    'the window closes and submits the final count once');
});

test('taps spaced further apart than the window commit separately', async () => {
  const { calls, rec } = recorder();
  tap(rec, 100, 100, 0);
  await sleep(50);
  tap(rec, 100, 100, 100);
  await sleep(50);
  assert.deepEqual(calls, [['tap', 1], ['commit', 1], ['tap', 1], ['commit', 1]]);
});

test('a hold commits nothing and fires onHold', () => {
  const { calls, rec } = recorder();
  hold(rec, 100, 100, 0, 80);
  assert.deepEqual(calls, [['hold']]);
});

test('a hold discards taps that were still waiting to commit', async () => {
  const { calls, rec } = recorder();
  tap(rec, 100, 100, 0);
  hold(rec, 100, 100, 10, 80);   // starts before the tap window closes
  await sleep(50);
  assert.deepEqual(calls, [['tap', 1], ['hold']],
    'no commit — the stray tap was part of reaching for the hold');
});

test('a circle fires onCircle and never a tap', () => {
  const { calls, rec } = recorder();
  circle(rec);
  assert.deepEqual(calls, [['circle']]);
});

test('a straight drag is ignored entirely', () => {
  const { calls, rec } = recorder();
  rec.pointerDown(100, 100, 0);
  rec.pointerMove(140, 100, 30);
  rec.pointerMove(180, 100, 60);
  rec.pointerUp(220, 100, 90);
  assert.deepEqual(calls, []);
});

test('a long drag is not mistaken for a hold', () => {
  const { calls, rec } = recorder();
  rec.pointerDown(100, 100, 0);
  rec.pointerMove(160, 100, 40);
  rec.pointerUp(220, 100, 80);
  assert.deepEqual(calls, []);
});

test('reset() drops a pending count without committing', async () => {
  const { calls, rec } = recorder();
  tap(rec, 100, 100, 0);
  rec.reset();
  await sleep(50);
  assert.deepEqual(calls, [['tap', 1]], 'no commit after reset');
  assert.equal(rec.pending, 0);
});

test('isCircle accepts loops and rejects lookalikes', () => {
  const pts = n => Array.from({ length: n }, (_, i) => ({ x: 200 + 80 * Math.cos(i / 4), y: 200 + 80 * Math.sin(i / 4), t: i * 12 }));
  assert.ok(isCircle(pts(32)), 'a full loop is a circle');

  const line = Array.from({ length: 32 }, (_, i) => ({ x: 100 + i * 8, y: 100, t: i * 12 }));
  assert.ok(!isCircle(line), 'a straight line is not');

  const tiny = pts(32).map(p => ({ ...p, x: 200 + (p.x - 200) * 0.05, y: 200 + (p.y - 200) * 0.05 }));
  assert.ok(!isCircle(tiny), 'jitter-sized loops are not circles');

  const slow = pts(32).map((p, i) => ({ ...p, t: i * 200 }));
  assert.ok(!isCircle(slow), 'too slow to be intentional');

  const huge = pts(32).map(p => ({ ...p, x: 500 + (p.x - 200) * 4, y: 500 + (p.y - 200) * 4 }));
  assert.ok(!isCircle(huge), 'a huge sweeping path is a drag, not a circle');
});

test('the defaults leave room for deliberate gestures', () => {
  assert.ok(GESTURE_DEFAULTS.tapWindowMs >= 250 && GESTURE_DEFAULTS.tapWindowMs <= 600);
  assert.ok(GESTURE_DEFAULTS.holdMs >= 350 && GESTURE_DEFAULTS.holdMs <= 900);
});
