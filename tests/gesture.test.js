// gesture.test.js — the eyes-closed input recognizer is a pure state machine
// (explicit coordinates and timestamps in, callbacks out), so every gesture
// rule is pinned down without a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecognizer, backAndForthTrips, GESTURE_DEFAULTS } from '../js/gesture.js';

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
    onBackAndForth: trips => calls.push(['forth', trips]),
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

// A back-and-forth along x: out, back, and (for two trips) out and back again.
// Straight legs and no jitter, so the hysteresis is the only thing under test.
function zigzag(rec, { x0 = 140, y0 = 220, leg = 90, trips = 1, steps = 6, t0 = 0, dur = 600 } = {}) {
  const legs = trips * 2;
  const per = dur / legs;
  rec.pointerDown(x0, y0, t0);
  let x = x0;
  for (let l = 1; l <= legs; l++) {
    const to = x0 + (l % 2 === 1 ? leg : 0);
    for (let i = 1; i <= steps; i++) {
      const t = t0 + per * (l - 1) + (per * i) / steps;
      rec.pointerMove(x + ((to - x) * i) / steps, y0, t);
    }
    x = to;
  }
  rec.pointerUp(x, y0, t0 + dur);
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
    ['back-and-forth', r => zigzag(r)],
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

test('one back-and-forth fires onBackAndForth(1) and never a tap', () => {
  const { calls, rec } = recorder();
  zigzag(rec);
  assert.deepEqual(calls, [['forth', 1]]);
});

test('two back-and-forth trips report 2', () => {
  const { calls, rec } = recorder();
  zigzag(rec, { trips: 2 });
  assert.deepEqual(calls, [['forth', 2]]);
});

test('a swipe with a small rebound stays a swipe, not a trip', () => {
  // 220 px out, 24 px back — under the hysteresis band, and it does not return.
  const { calls, rec } = recorder();
  rec.pointerDown(80, 200, 0);
  for (let i = 1; i <= 10; i++) rec.pointerMove(80 + i * 22, 200, i * 30);
  rec.pointerMove(296, 200, 330);
  rec.pointerUp(296, 200, 360);
  assert.deepEqual(calls, [['swipe']]);
  const pts = [{ x: 80, y: 200, t: 0 }, { x: 200, y: 200, t: 150 }, { x: 300, y: 200, t: 250 }, { x: 276, y: 200, t: 320 }];
  assert.equal(backAndForthTrips(pts), 0);
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

test('backAndForthTrips counts trips and rejects lookalikes', () => {
  const line = Array.from({ length: 24 }, (_, i) => ({ x: 100 + i * 10, y: 100, t: i * 12 }));
  assert.equal(backAndForthTrips(line), 0, 'a straight line never reversed');

  const out = [{ x: 100, y: 100, t: 0 }, { x: 200, y: 100, t: 100 }, { x: 300, y: 100, t: 200 }];
  const oneTrip = [...out, { x: 200, y: 100, t: 300 }, { x: 100, y: 100, t: 400 }];
  assert.equal(backAndForthTrips(oneTrip), 1);

  const twoTrips = [...oneTrip, { x: 200, y: 100, t: 500 }, { x: 100, y: 100, t: 600 }];
  assert.equal(backAndForthTrips(twoTrips), 2);

  const tiny = oneTrip.map(p => ({ ...p, x: 200 + (p.x - 200) * 0.1, y: 110 }));
  assert.equal(backAndForthTrips(tiny), 0, 'jitter-sized movement is not a trip');

  const slow = twoTrips.map((p, i) => ({ ...p, t: i * 900 }));
  assert.equal(backAndForthTrips(slow), 0, 'too slow to be intentional');
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


test('hold mode has no option-count ceiling', async () => {
  const { calls, rec } = recorder({ mode: 'hold', holdRepeatMs: 5 });
  rec.pointerDown(100, 100, 0);
  await sleep(260);              // Windows timer granularity is ~15 ms
  rec.pointerUp(100, 100, 270);
  const repeats = calls.filter(c => c[0] === 'repeat').length;
  assert.ok(repeats > 8, `expected more than eight ticks, got ${repeats}`);
  assert.deepEqual(calls.filter(c => c[0] === 'commit'), [['commit', repeats]]);
});
