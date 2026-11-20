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
//   • circle                → play / replay; a second full loop (onCircle
//     reports 2) is the "name the answers" gesture after a miss
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
  circleMinAngle: 1.5 * Math.PI,  // how much arc counts as a circle
  circleMinRadius: 16,     // px — smaller loops are jitter
  circleMaxRadius: 240,    // px — larger paths are probably a drag
  circleMaxMs: 1800,       // a circle drawn slower than this is ignored
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
      // Once it is clearly a swipe or a circle, stop ticking; the ticks that
      // already played are discarded on release.
      if (holdMode && maxMove > cfg.moveTolerance) clearRepeat();
    },

    pointerUp(x, y, t) {
      if (!path.length) return;
      path.push({ x, y, t });
      maxMove = Math.max(maxMove, Math.hypot(x - downX, y - downY));
      const duration = t - downAt;
      clearRepeat();

      if (maxMove > cfg.moveTolerance && isCircle(path, cfg)) {
        repeatCount = 0;
        handlers.onCircle?.(circleLoops(path, cfg));
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

// Geometric summary of one gesture's path: how far it travelled, how much it
// curved around its own centroid, how straight it was, and how long it took.
function pathShape(path, cfg) {
  let cx = 0, cy = 0;
  for (const p of path) { cx += p.x; cy += p.y; }
  cx /= path.length; cy /= path.length;

  let radius = 0, displacement = 0;
  for (const p of path) {
    radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));
    displacement = Math.max(displacement, Math.hypot(p.x - path[0].x, p.y - path[0].y));
  }

  let pathLength = 0;
  for (let i = 1; i < path.length; i++) {
    pathLength += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  const straightness = pathLength > 0 ? Math.min(1, displacement / pathLength) : 0;

  const duration = path[path.length - 1].t - path[0].t;
  if (duration <= 0 || duration > cfg.circleMaxMs) {
    return { duration, radius, displacement, pathLength, straightness, angle: 0 };
  }
  let angle = 0;
  let prev = Math.atan2(path[0].y - cy, path[0].x - cx);
  for (let i = 1; i < path.length; i++) {
    const a = Math.atan2(path[i].y - cy, path[i].x - cx);
    let d = a - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    angle += d;
    prev = a;
  }
  return { duration, radius, displacement, pathLength, straightness, angle };
}

// True when the pointer swept far enough around its own centroid to read as a
// loop. Direction-agnostic (both clockwise and counter-clockwise count).
export function isCircle(path, cfg = GESTURE_DEFAULTS) {
  if (path.length < 8) return false;
  const shape = pathShape(path, cfg);
  return shape.duration > 0
    && shape.radius >= cfg.circleMinRadius && shape.radius <= cfg.circleMaxRadius
    && Math.abs(shape.angle) >= cfg.circleMinAngle;
}

// How many times around the loop went. Measured as path length over the
// circumference of the loop it drew — one loop of travel is one circle, and
// rounding absorbs the wobble of a hand-drawn loop. A single circle that
// overshoots its start by a third or less still reads as one; a loop and a half
// or more reads as two. (The accumulated angle cannot be used here: it
// saturates at one turn per revolution.)
export function circleLoops(path, cfg = GESTURE_DEFAULTS) {
  const shape = pathShape(path, cfg);
  if (shape.radius <= 0 || shape.pathLength <= 0) return 1;
  return Math.max(1, Math.round(shape.pathLength / (2 * Math.PI * shape.radius)));
}

// True when the pointer travelled far along a straight line. Measured as net
// travel over path length (a line is ~1, an arc well below), which separates it
// from both loops and curves — a curve reads as neither gesture and is ignored.
export function isSwipe(path, cfg = GESTURE_DEFAULTS) {
  const shape = pathShape(path, cfg);
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
