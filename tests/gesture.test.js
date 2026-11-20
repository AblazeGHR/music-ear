// gesture.test.js — the eyes-closed input recognizer is a pure state machine
// (explicit coordinates and timestamps in, callbacks out), so every gesture
// rule is pinned down without a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecognizer, isCircle, GESTURE_DEFAULTS } from '../js/gesture.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function recorder(options = {}) {
  const calls = [];
  const touches = [];      // kept apart: a touch is not a judgement
  const handlers = {
    onTouch: () => touches.push('touch'),
    onTap: n => calls.push(['tap', n]),
    onCommit: n => calls.push(['commit', n]),
    onHold: () => calls.push(['hold']),
    onSwipe: () => calls.push(['swipe']),
    onCircle: loops => calls.push(['circle', loops]),
    onRepeat: n => calls.push(['repeat', n]),
    onExit: () => calls.push(['exit']),
  };
  return { calls, touches, rec: createRecognizer(handlers, { tapWindowMs: 30, holdMs: 40, ...options }) };
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

test('the tick is emitted on touch-down, before the gesture is judged', async () => {
  const log = [];
  const rec = createRecognizer({
    onTouch: () => log.push('touch'),
    onTap: () => log.push('tap'),
    onCommit: n => log.push(`commit:${n}`),
  }, { tapWindowMs: 30, holdMs: 40 });

  rec.pointerDown(100, 100, 0);
  assert.deepEqual(log, ['touch'], 'the finger lands and the tick is already out');
  rec.pointerUp(100, 100, 10);
  assert.deepEqual(log, ['touch', 'tap'], 'the judgement comes at release…');
  await sleep(50);
  assert.deepEqual(log, ['touch', 'tap', 'commit:1'], '…and the answer once the tap window closes');
});

test('every touch ticks, and only real taps are judged', async () => {
  for (const [label, drive] of [
    ['tap', r => tap(r)],
    ['hold', r => hold(r)],
    ['circle', r => circle(r)],
    ['swipe', r => { r.pointerDown(100, 100, 0); r.pointerMove(170, 100, 40); r.pointerUp(240, 100, 80); }],
    ['curve (ignored)', r => { r.pointerDown(280, 100, 0); for (let i = 1; i <= 16; i++) { const a = Math.PI * (i / 16); r.pointerMove(200 + 80 * Math.cos(a), 100 + 80 * Math.sin(a), i * 12); } r.pointerUp(120, 100, 200); }],
  ]) {
    const { touches, calls, rec } = recorder();
    drive(rec);
    await sleep(50);
    assert.equal(touches.length, 1, `${label}: exactly one tick for one touch`);
    if (label !== 'tap') {
      assert.ok(!calls.some(c => c[0] === 'tap' || c[0] === 'commit'), `${label} is not judged as a tap`);
    }
  }
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

test('a circle fires onCircle(1) and never a tap', () => {
  const { calls, rec } = recorder();
  circle(rec);
  assert.deepEqual(calls, [['circle', 1]]);
});

test('a second loop reports onCircle(2)', () => {
  const { calls, rec } = recorder();
  circle(rec, { turns: 2.3 });          // well past two full turns
  assert.deepEqual(calls, [['circle', 2]]);
});

test('a single loop that overshoots a little still counts as one', () => {
  const { calls, rec } = recorder();
  circle(rec, { turns: 1.3 });          // one loop plus a third, not two
  assert.deepEqual(calls, [['circle', 1]]);
});

test('a straight line fires onSwipe and never a tap', () => {
  const { calls, rec } = recorder();
  rec.pointerDown(100, 100, 0);
  rec.pointerMove(160, 100, 30);
  rec.pointerMove(220, 100, 60);
  rec.pointerUp(280, 100, 90);
  assert.deepEqual(calls, [['swipe']]);
});

test('a swipe discards taps that were still waiting to commit', async () => {
  const { calls, rec } = recorder();
  tap(rec, 100, 100, 0);
  rec.pointerDown(100, 100, 10);
  rec.pointerMove(170, 100, 40);
  rec.pointerUp(240, 100, 80);
  await sleep(50);
  assert.deepEqual(calls, [['tap', 1], ['swipe']], 'no commit — the line was meant, not the tap');
});

test('a curve that is neither a line nor a loop is ignored', () => {
  const { calls, rec } = recorder();
  // A half circle, drawn from the arc: too curved to be a line, too short of a
  // loop to be a circle.
  rec.pointerDown(280, 100, 0);
  for (let i = 1; i <= 16; i++) {
    const a = Math.PI * (i / 16);
    rec.pointerMove(200 + 80 * Math.cos(a), 100 + 80 * Math.sin(a), i * 12);
  }
  rec.pointerUp(120, 100, 200);
  assert.deepEqual(calls, []);
});

test('a long drag is not mistaken for a hold — it reads as a swipe', () => {
  const { calls, rec } = recorder();
  rec.pointerDown(100, 100, 0);
  rec.pointerMove(160, 100, 40);
  rec.pointerUp(220, 100, 80);
  assert.deepEqual(calls, [['swipe']]);
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


// ── hold-to-count mode ──────────────────────────────────────────────────────

test('hold mode ticks on an interval and commits the count on release', async () => {
  const { calls, touches, rec } = recorder({ mode: 'hold', holdRepeatMs: 20, maxTicks: 8 });
  rec.pointerDown(100, 100, 0);
  await sleep(75);
  rec.pointerUp(100, 100, 80);

  const repeats = calls.filter(c => c[0] === 'repeat').length;
  assert.ok(repeats >= 2, `expected several ticks, got ${repeats}`);
  assert.deepEqual(calls.filter(c => c[0] === 'commit'), [['commit', repeats]],
    'release submits exactly the number of ticks heard');
  assert.equal(touches.length, 0, 'hold mode does not tick on touch-down');
});

test('hold mode short taps never answer; three of them exit', async () => {
  const { calls, rec } = recorder({ mode: 'hold', holdRepeatMs: 200, exitTapWindowMs: 200 });
  for (let i = 0; i < 3; i++) {
    tap(rec, 100, 100, i * 10, 5);
    await sleep(5);
  }
  assert.deepEqual(calls.filter(c => c[0] === 'commit'), []);
  assert.equal(calls.filter(c => c[0] === 'exit').length, 1);
});

test('hold mode swiping cancels the ticks instead of answering', async () => {
  const { calls, rec } = recorder({ mode: 'hold', holdRepeatMs: 15 });
  rec.pointerDown(100, 100, 0);
  await sleep(35);
  rec.pointerMove(100, 50, 45);
  rec.pointerUp(100, 50, 50);
  assert.deepEqual(calls.filter(c => c[0] === 'commit'), []);
  assert.equal(calls.filter(c => c[0] === 'swipe').length, 1);
});

test('hold mode stops ticking at maxTicks', async () => {
  const { calls, rec } = recorder({ mode: 'hold', holdRepeatMs: 10, maxTicks: 3 });
  rec.pointerDown(100, 100, 0);
  await sleep(80);
  rec.pointerUp(100, 100, 90);
  assert.equal(calls.filter(c => c[0] === 'repeat').length, 3);
  assert.deepEqual(calls.filter(c => c[0] === 'commit'), [['commit', 3]]);
});
