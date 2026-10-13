// gesture.js — eyes-closed input for multiple-choice exercises.
//
// Three disjoint gestures (they differ in movement and duration, so they can
// never be confused with each other):
//   • tap / N quick taps → pick the Nth option (committed when the tap window
//     closes, so "tap, tap" can mean "option 2" rather than two option-1 picks)
//   • press and hold     → next question (skips an ungraded one)
//   • circle             → play / replay
//
// The core is a pure state machine taking explicit coordinates and timestamps,
// so it is unit-tested without a browser; bindPointerSurface() at the bottom is
// the only DOM-aware part.

export const GESTURE_DEFAULTS = {
  tapWindowMs: 400,        // time allowed between taps of one count
  holdMs: 500,             // stillness beyond this reads as a hold
  moveTolerance: 14,       // px of travel still considered "not moving"
  circleMinAngle: 1.5 * Math.PI,  // how much arc counts as a circle
  circleMinRadius: 16,     // px — smaller loops are jitter
  circleMaxRadius: 240,    // px — larger paths are probably a drag
  circleMaxMs: 1800,       // a circle drawn slower than this is ignored
};

export function createRecognizer(handlers, options = {}) {
  const cfg = { ...GESTURE_DEFAULTS, ...options };
  let downAt = 0, downX = 0, downY = 0, maxMove = 0;
  let path = [];
  let tapCount = 0, tapTimer = null;

  const clearTapTimer = () => {
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
  };

  function commitTaps() {
    clearTapTimer();
    const n = tapCount;
    tapCount = 0;
    if (n > 0) handlers.onCommit(n);
  }

  return {
    pointerDown(x, y, t) {
      downAt = t; downX = x; downY = y; maxMove = 0;
      path = [{ x, y, t }];
    },

    pointerMove(x, y, t) {
      if (!path.length) return;
      path.push({ x, y, t });
      maxMove = Math.max(maxMove, Math.hypot(x - downX, y - downY));
    },

    pointerUp(x, y, t) {
      if (!path.length) return;
      path.push({ x, y, t });
      maxMove = Math.max(maxMove, Math.hypot(x - downX, y - downY));
      const duration = t - downAt;

      if (maxMove > cfg.moveTolerance && isCircle(path, cfg)) {
        handlers.onCircle();
      } else if (maxMove <= cfg.moveTolerance && duration >= cfg.holdMs) {
        // A hold wins over taps still waiting to commit — they were almost
        // certainly part of reaching for the hold, not an intended answer.
        clearTapTimer();
        tapCount = 0;
        handlers.onHold();
      } else if (maxMove <= cfg.moveTolerance) {
        tapCount += 1;
        handlers.onTap(tapCount);
        clearTapTimer();
        tapTimer = setTimeout(commitTaps, cfg.tapWindowMs);
      }
      // Anything else (a drag or a stray swipe) is ignored on purpose.
      path = [];
    },

    // Drop any pending tap count — used when the question changes underneath.
    reset() {
      clearTapTimer();
      tapCount = 0;
      path = [];
    },

    get pending() { return tapCount; },
  };
}

// True when the pointer swept far enough around its own centroid to read as a
// loop. Direction-agnostic (both clockwise and counter-clockwise count).
export function isCircle(path, cfg = GESTURE_DEFAULTS) {
  if (path.length < 8) return false;
  const span = path[path.length - 1].t - path[0].t;
  if (span <= 0 || span > cfg.circleMaxMs) return false;

  let cx = 0, cy = 0;
  for (const p of path) { cx += p.x; cy += p.y; }
  cx /= path.length; cy /= path.length;

  let radius = 0;
  for (const p of path) radius = Math.max(radius, Math.hypot(p.x - cx, p.y - cy));
  if (radius < cfg.circleMinRadius || radius > cfg.circleMaxRadius) return false;

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
  return Math.abs(angle) >= cfg.circleMinAngle;
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
