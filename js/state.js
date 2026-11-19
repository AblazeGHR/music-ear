// state.js — persistence, per-skill statistics and settings (localStorage).
//
// There are no levels, streaks or activity heatmaps: progress is a flat record
// of per-skill accuracy (which also drives question weighting) plus per-exercise
// totals. Question pools live in settings.exercises[<moduleId>], merged over the
// module's `defaults` from curriculum.js.

import { moduleById } from './curriculum.js';

// v2 schema: the level/streak data of v1 (localStorage key 'earpath-v1') does
// not exist in this model, so old saves are intentionally not read.
const KEY = 'music-ear-v1';
const VERSION = 2;

const DEFAULT_SETTINGS = {
  volume: 0.9,
  autoAdvance: true,
  chordStyle: 'block+arp',   // 'block' | 'block+arp' | 'arp'
  degreeLabels: 'solfege',   // 'solfege' | 'number'
  melodyTempo: 0.55,         // seconds per note
  tapWindowMs: 350,          // gesture mode: wait for another tap before answering
  voiceTimeoutMin: 10,       // voice mode: stop after this long without a recognised answer
  exercises: {},             // moduleId -> question-config overrides (see moduleConfig)
};

function blank() {
  return {
    version: VERSION,
    settings: { ...DEFAULT_SETTINGS, exercises: {} },
    items: {},                // itemKey -> {a, c, recent: [0|1]}
    modules: {},              // moduleId -> {a, c}
    confusions: {},           // 'moduleId|correct>answered' -> count
    answers: {},              // moduleId -> answerId -> {a, c, wrong: {answeredId: count}}
    totals: { a: 0, c: 0 },
  };
}

export let state = blank();

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state = {
        ...blank(), ...data,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(data.settings || {}),
          exercises: { ...(data.settings?.exercises || {}) },
        },
      };
    }
  } catch (e) {
    console.warn('music-ear: could not load saved state', e);
  }
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('music-ear: could not save state', e);
  }
}

export function resetAll() {
  state = blank();
  save();
}

// Erase one exercise's history: its per-item records, module totals, confusion
// pairs and per-answer breakdown. The global totals are recomputed from the
// remaining modules so the cards on the stats page stay consistent.
export function clearModule(moduleId) {
  const mod = moduleById(moduleId);
  if (!mod) return;
  const prefix = `${mod.itemPrefix}:`;
  for (const key of Object.keys(state.items)) {
    if (key.startsWith(prefix)) delete state.items[key];
  }
  delete state.modules[moduleId];
  for (const key of Object.keys(state.confusions)) {
    if (key.startsWith(`${moduleId}|`)) delete state.confusions[key];
  }
  delete state.answers[moduleId];
  state.totals.a = Object.values(state.modules).reduce((n, m) => n + m.a, 0);
  state.totals.c = Object.values(state.modules).reduce((n, m) => n + m.c, 0);
  save();
}

// ── Exercise configuration ───────────────────────────────────────────────────

// The gesture tap window is a free value, not a menu of presets: any duration
// in this range is accepted, and one clamp is shared by the settings control
// and the recognizer that consumes it.
export const TAP_WINDOW_MIN = 100;
export const TAP_WINDOW_MAX = 2000;
export const VOICE_TIMEOUT_MIN = 1;
export const VOICE_TIMEOUT_MAX = 60;
export function clampVoiceTimeout(min) {
  const n = Math.round(Number(min));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.voiceTimeoutMin;
  return Math.min(VOICE_TIMEOUT_MAX, Math.max(VOICE_TIMEOUT_MIN, n));
}

export function clampTapWindow(ms) {
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.tapWindowMs;
  return Math.min(TAP_WINDOW_MAX, Math.max(TAP_WINDOW_MIN, n));
}

// The live question configuration for a module: registry defaults with the
// user's stored overrides on top. Chip pools (question items, directions,
// degrees, numerals…) are returned in the registry's canonical order — never
// the order the user happened to click them in — so the answer buttons are
// always laid out the same way (intervals ascending by semitone, degrees
// ascending, numerals I–vi, …).
export function moduleConfig(id) {
  const mod = moduleById(id);
  if (!mod) return null;
  const cfg = { ...mod.defaults, ...(state.settings.exercises[id] || {}) };
  for (const opt of mod.options) {
    if (opt.type !== 'chips' || !Array.isArray(cfg[opt.key])) continue;
    const index = new Map(opt.choices.map(([v], i) => [v, i]));
    const rank = v => (index.has(v) ? index.get(v) : Number.MAX_SAFE_INTEGER);
    cfg[opt.key] = [...cfg[opt.key]].sort((a, b) => rank(a) - rank(b));
  }
  return cfg;
}

// Write one option back. The stored object is always the full merged config,
// so an export stays readable and a later registry change can't half-apply —
// and it goes through moduleConfig() again so pools are stored in canonical
// order (what the app actually renders), not click order.
export function setExerciseOption(id, key, value) {
  state.settings.exercises[id] = { ...moduleConfig(id), [key]: value };
  state.settings.exercises[id] = moduleConfig(id);
  save();
}

// Drop an exercise's overrides entirely, back to the registry defaults.
export function resetExercise(id) {
  delete state.settings.exercises[id];
  save();
}

// ── Item + module stats ──────────────────────────────────────────────────────

const RECENT_CAP = 20;

export function itemStats(key) {
  return state.items[key] || { a: 0, c: 0, recent: [] };
}

// Recent accuracy over the item's last n answers; null when unseen.
export function itemRecentAccuracy(key, n = 10) {
  const recent = itemStats(key).recent.slice(-n);
  if (!recent.length) return null;
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// Selection weight: unseen and recently-missed items come up more often.
export function itemWeight(key) {
  const st = itemStats(key);
  if (st.a < 3) return 3;                       // new item: prioritise
  const acc = itemRecentAccuracy(key) ?? 0;
  return 1 + 4 * (1 - acc);
}

export function moduleStats(moduleId) {
  return state.modules[moduleId] || { a: 0, c: 0 };
}

// Record one answered question.
// itemResults: [{key, correct}] for each skill exercised (per-slot for
// sequences); correct: whole-question correctness.
export function recordAnswer(moduleId, itemResults, correct, confusion = null, kind = null) {
  for (const { key, correct: ok } of itemResults) {
    const st = state.items[key] || { a: 0, c: 0, recent: [] };
    st.a += 1;
    if (ok) st.c += 1;
    st.recent.push(ok ? 1 : 0);
    if (st.recent.length > RECENT_CAP) st.recent.shift();
    state.items[key] = st;
  }

  const ms = state.modules[moduleId] || { a: 0, c: 0 };
  ms.a += 1;
  if (correct) ms.c += 1;
  state.modules[moduleId] = ms;

  if (confusion && confusion.correctId !== confusion.answeredId) {
    const ck = `${moduleId}|${confusion.correctId}>${confusion.answeredId}`;
    state.confusions[ck] = (state.confusions[ck] || 0) + 1;
  }

  // Multiple-choice only: how often each answer was the right one, and what
  // got picked instead when it was missed. Sequences and dictation grade whole
  // questions, so there is no single "this answer" to attribute a miss to.
  if (kind === 'choice' && confusion) {
    const byAnswer = state.answers[moduleId] || (state.answers[moduleId] = {});
    const entry = byAnswer[confusion.correctId] || (byAnswer[confusion.correctId] = { a: 0, c: 0, wrong: {} });
    entry.a += 1;
    if (correct) {
      entry.c += 1;
    } else {
      entry.wrong[confusion.answeredId] = (entry.wrong[confusion.answeredId] || 0) + 1;
    }
  }

  state.totals.a += 1;
  if (correct) state.totals.c += 1;
  save();
}

export function topConfusions(limit = 8) {
  return Object.entries(state.confusions)
    .map(([k, count]) => {
      const [moduleId, pair] = k.split('|');
      const [correctId, answeredId] = pair.split('>');
      return { moduleId, correctId, answeredId, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Per-answer record for a multiple-choice module, worst-missed first: each
// entry carries how often the answer came up, how often it was right, and the
// ranked list of what was chosen when it was missed.
export function answerBreakdown(moduleId) {
  const byAnswer = state.answers[moduleId] || {};
  return Object.entries(byAnswer)
    .map(([id, e]) => {
      const wrong = Object.entries(e.wrong || {}).sort((a, b) => b[1] - a[1]);
      return {
        id,
        a: e.a,
        c: e.c,
        wrongTotal: e.a - e.c,
        wrong,                       // [[answeredId, count], …] most chosen first
      };
    })
    .sort((x, y) =>
      (y.wrongTotal / y.a) - (x.wrongTotal / x.a) ||   // miss rate first
      y.wrongTotal - x.wrongTotal ||
      y.a - x.a);
}

// ── Export / import ──────────────────────────────────────────────────────────

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (typeof data !== 'object' || data === null || data.version !== VERSION) {
    throw new Error('Not a valid music-ear backup file.');
  }
  state = {
    ...blank(), ...data,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(data.settings || {}),
      exercises: { ...(data.settings?.exercises || {}) },
    },
  };
  save();
}
