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
  exercises: {},             // moduleId -> question-config overrides (see moduleConfig)
};

function blank() {
  return {
    version: VERSION,
    settings: { ...DEFAULT_SETTINGS, exercises: {} },
    items: {},                // itemKey -> {a, c, recent: [0|1]}
    modules: {},              // moduleId -> {a, c}
    confusions: {},           // 'moduleId|correct>answered' -> count
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

// ── Exercise configuration ───────────────────────────────────────────────────

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
export function recordAnswer(moduleId, itemResults, correct, confusion = null) {
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
