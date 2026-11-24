// gesture.js — eyes-closed input for multiple-choice exercises.
//
// Two answering modes, chosen in Settings:
//   tap  (default) — tap N times = option N, hold = leave gesture mode
//   hold           — press and hold; every interval a tick sounds, release
//                    stops it, N ticks = option N. Triple-tap leaves gesture
//                    mode (hold is now the answer, so it cannot mean "exit").
//
// Shared gestures, unchanged in both modes:
//   • swipe a straight line → next question (skips an ungraded one)
//   • swipe back and forth  → play / replay; two back-and-forth trips are the
//     "name the answers" gesture after a miss (onBackAndForth reports the trips)
//
// onTouch fires on touch-down only in tap mode, so the caller can sound an
// instant tick. Hold mode sounds its ticks through onRepeat instead, one per
// interval: N sounds must equal N taps.
//
// The core is a pure state machine taking explicit coordinates and timestamps,
// so it is unit-tested without a browser; bindPointerSurface() at the bottom is
// the only DOM-aware part.

export const GESTURE_DEFAULTS = {
  mode: 'tap',             // 'tap' | 'hold'
  tapWindowMs: 400,        // tap mode: time allowed between taps of one count
  holdMs: 500,             // tap mode: stillness beyond this reads as a hold
  holdRepeatMs: 500,       // hold mode: one tick per this interval
  exitTapWindowMs: 600,    // hold mode: max gap between the three exit taps
  maxTicks: Number.POSITIVE_INFINITY, // hold mode: no option-count limit
  moveTolerance: 14,       // px of travel still considered "not moving"
  swipeMinDist: 40,        // px of net travel for a deliberate straight swipe
  swipeMinStraightness: 0.9, // net travel / path length — near 1 reads as a line
  zigMinLeg: 32,           // px each way before a direction change counts
  zigMaxMs: 2500,          // a slower back-and-forth is not a deliberate gesture
  zigMaxReturnRatio: 0.6,  // net travel / path length — a round trip returns
};

export function createRecognizer(handlers, options = {}) {
  const cfg = { ...GESTURE_DEFAULTS, ...options };
  const holdMode = cfg.mode === 'hold';
  let downAt = 0, downX = 0, downY = 0, maxMove = 0;
  let path = [];
  let tapCount = 0, tapTimer = null;
  let repeatTimer = null, repeatCount = 0;
  let exitTaps = 0, exitTimer = null;

  const clearTapTimer = () => {
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
  };
  const clearRepeat = () => {
    if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
  };
  const clearExit = () => {
    if (exitTimer) { clearTimeout(exitTimer); exitTimer = null; }
  };

  function commitTaps() {
    clearTapTimer();
    const n = tapCount;
    tapCount = 0;
    if (n > 0) handlers.onCommit?.(n);
  }

  // Hold mode: first tick after one interval, then one per interval. There is
  // no option-count cap; the caller validates the count against the question.
  function startRepeat() {
    clearRepeat();
    repeatCount = 0;
    const step = () => {
      repeatTimer = null;
      if (!path.length) return;
      repeatCount += 1;
      handlers.onRepeat?.(repeatCount);
      if (repeatCount < cfg.maxTicks) {
        repeatTimer = setTimeout(step, cfg.holdRepeatMs);
      }
    };
    repeatTimer = setTimeout(step, cfg.holdRepeatMs);
  }

  return {
    pointerDown(x, y, t) {
      downAt = t; downX = x; downY = y; maxMove = 0;
      path = [{ x, y, t }];
      if (holdMode) {
        repeatCount = 0;
        startRepeat();
      } else {
        // Instant, unconditional: the caller sounds a tick here so the feedback
        // lands with the touch instead of waiting to see what the gesture
        // becomes. Whether it counts as a tap is decided on release, as always.
        handlers.onTouch?.();
      }
    },

    pointerMove(x, y, t) {
      if (!path.length) return;
      path.push({ x, y, t });
      maxMove = Math.max(maxMove, Math.hypot(x - downX, y - downY));
      // Once the finger clearly moves, stop ticking; the ticks that already
      // played are discarded on release.
      if (holdMode && maxMove > cfg.moveTolerance) clearRepeat();
    },

    pointerUp(x, y, t) {
      if (!path.length) return;
      path.push({ x, y, t });
      maxMove = Math.max(maxMove, Math.hypot(x - downX, y - downY));
      const duration = t - downAt;
      clearRepeat();

      const trips = maxMove > cfg.moveTolerance ? backAndForthTrips(path, cfg) : 0;
      if (trips > 0) {
        clearTapTimer();
        tapCount = 0;
        repeatCount = 0;
        handlers.onBackAndForth?.(trips);
      } else if (maxMove > cfg.moveTolerance && isSwipe(path, cfg)) {
        clearTapTimer();
        tapCount = 0;
        repeatCount = 0;
        handlers.onSwipe?.();
      } else if (maxMove <= cfg.moveTolerance && holdMode) {
        if (repeatCount > 0) {
          const n = repeatCount;
          repeatCount = 0;
          clearExit();
          exitTaps = 0;
          handlers.onCommit?.(n);
        } else {
          // A short tap is only the exit gesture here; it never answers.
          exitTaps += 1;
          clearExit();
          if (exitTaps >= 3) {
            exitTaps = 0;
            handlers.onExit?.();
          } else {
            exitTimer = setTimeout(() => {
              exitTaps = 0;
              exitTimer = null;
            }, cfg.exitTapWindowMs);
          }
        }
      } else if (maxMove <= cfg.moveTolerance && duration >= cfg.holdMs) {
        // Tap mode only: a hold wins over taps still waiting to commit.
        clearTapTimer();
        tapCount = 0;
        handlers.onHold?.();
      } else if (maxMove <= cfg.moveTolerance) {
        tapCount += 1;
        handlers.onTap?.(tapCount);
        clearTapTimer();
        tapTimer = setTimeout(commitTaps, cfg.tapWindowMs);
      }
      // Anything else (a curve that is neither a line nor a loop) is ignored.
      repeatCount = 0;
      path = [];
    },

    // Drop anything pending — used when the question changes underneath.
    reset() {
      clearTapTimer();
      clearRepeat();
      clearExit();
      tapCount = 0;
      repeatCount = 0;
      exitTaps = 0;
      path = [];
    },

    get pending() { return holdMode ? repeatCount : tapCount; },
  };
}

// Geometric summary of one gesture's path: how far it travelled, how straight
// it was, and how long it took.
function pathShape(path) {
  let displacement = 0;
  for (const p of path) {
    displacement = Math.max(displacement, Math.hypot(p.x - path[0].x, p.y - path[0].y));
  }

  let pathLength = 0;
  for (let i = 1; i < path.length; i++) {
    pathLength += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  const straightness = pathLength > 0 ? Math.min(1, displacement / pathLength) : 0;

  const duration = path[path.length - 1].t - path[0].t;
  return { duration, displacement, pathLength, straightness };
}

// How many complete "out and back" trips the path contains — 0 when it never
// reversed, 1 for one back-and-forth, 2 for two.
//
// The path is projected onto its dominant axis (start → farthest point), then
// walked with a hysteresis band: a direction only flips once the finger has
// retreated zigMinLeg from the extreme it reached. Counting legs rather than
// turns is what makes "once" and "twice" unambiguous, and the band is what
// keeps the small backward drag at the end of a plain swipe from reading as a
// trip. Requiring the path to end roughly where it began rejects that drag too:
// a true round trip returns home.
export function backAndForthTrips(path, cfg = GESTURE_DEFAULTS) {
  if (path.length < 5) return 0;
  const shape = pathShape(path);
  if (shape.duration <= 0 || shape.duration > cfg.zigMaxMs) return 0;
  if (shape.pathLength < cfg.zigMinLeg * 2) return 0;

  // Dominant axis: the direction of the longest straight line from the start.
  let ax = 1, ay = 0, reach = 0;
  for (const p of path) {
    const dx = p.x - path[0].x, dy = p.y - path[0].y;
    const d = Math.hypot(dx, dy);
    if (d > reach) { reach = d; ax = dx / d; ay = dy / d; }
  }
  if (reach < cfg.zigMinLeg) return 0;

  // A round trip comes home; a swipe with a little rebound does not.
  const endDx = path[path.length - 1].x - path[0].x;
  const endDy = path[path.length - 1].y - path[0].y;
  if (Math.hypot(endDx, endDy) > shape.pathLength * cfg.zigMaxReturnRatio) return 0;

  const project = p => (p.x - path[0].x) * ax + (p.y - path[0].y) * ay;
  let dir = 0, extreme = 0, legs = 1;
  for (let i = 1; i < path.length; i++) {
    const s = project(path[i]);
    if (dir === 0) {
      if (s - extreme >= cfg.zigMinLeg) { dir = 1; extreme = s; }
      else if (extreme - s >= cfg.zigMinLeg) { dir = -1; extreme = s; }
    } else if (dir === 1) {
      if (s > extreme) extreme = s;
      else if (extreme - s >= cfg.zigMinLeg) { dir = -1; extreme = s; legs += 1; }
    } else {
      if (s < extreme) extreme = s;
      else if (s - extreme >= cfg.zigMinLeg) { dir = 1; extreme = s; legs += 1; }
    }
  }
  return Math.floor(legs / 2);
}

// True when the pointer travelled far along a straight line. Measured as net
// travel over path length (a line is ~1, an arc well below), which separates it
// from both loops and curves — a curve reads as neither gesture and is ignored.
export function isSwipe(path, cfg = GESTURE_DEFAULTS) {
  const shape = pathShape(path);
  return shape.displacement >= cfg.swipeMinDist
    && shape.straightness >= cfg.swipeMinStraightness;
}

// Feeds real pointer events into a recognizer. Capture keeps move/up coming
// even when the pointer wanders off the element mid-gesture.
export function bindPointerSurface(el, recognizer) {
  const now = () => performance.now();
  const down = e => {
    // A pointer capture is best-effort: it keeps move/up coming when the
    // pointer wanders off the element, but browsers throw for stale or
    // synthetic pointer ids — a gesture must never die over that.
    try { el.setPointerCapture?.(e.pointerId); } catch { /* not capturable */ }
    recognizer.pointerDown(e.clientX, e.clientY, now());
    e.preventDefault();
  };
  const move = e => recognizer.pointerMove(e.clientX, e.clientY, now());
  const up = e => recognizer.pointerUp(e.clientX, e.clientY, now());
  const cancel = () => recognizer.reset();

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
  };
}
