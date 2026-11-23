// engine.js — generates questions for every exercise and grades the answers.
//
// A Question owns its exact audio (root, voicing, melody), so replay is always
// identical and any answer option can be auditioned from the same root for
// comparison after a miss.
//
// `cfg` is the exercise configuration from state.moduleConfig(moduleId): which
// items are in the pool, direction, register, and so on. Global playback
// preferences (chord style, solfège vs numbers, melody tempo) still come from
// state.settings, exactly as the options that used to be per-level.

import * as Audio from './audio.js';
import {
  INTERVALS, CHORDS, SCALES, DEGREES, NUMERALS, CADENCES,
  pitchClassName,
  randInt, choice, weightedChoice,
} from './theory.js';
import { moduleById } from './curriculum.js';
import { state, itemWeight } from './state.js';
import * as Reading from './reading.js';

let lastItemKey = null;

// Weakness-weighted pick over candidate skills; damp the one just asked.
function pickWeighted(cands) {
  const weights = cands.map(c =>
    (c.itemKey === lastItemKey && cands.length > 2 ? 0.25 : 1) * itemWeight(c.itemKey));
  const picked = weightedChoice(cands, weights);
  lastItemKey = picked.itemKey;
  return picked;
}

function playFresh(events) {
  Audio.stopAll();
  return Audio.playEvents(events);
}

export function generate(moduleId, cfg) {
  const mod = moduleById(moduleId);
  if (!mod || !cfg) return null;
  switch (moduleId) {
    case 'pitch': return genPitch(mod, cfg);
    case 'absolute': return genAbsolute(mod, cfg);
    case 'intervals': return genInterval(mod, cfg);
    case 'chords': return genChord(mod, cfg);
    case 'scales': return genScale(mod, cfg);
    case 'degrees': return genDegree(mod, cfg);
    case 'progressions': return genProgression(mod, cfg);
    case 'melodies': return genMelody(mod, cfg);
    case 'reading': return Reading.generate(mod, cfg);
  }
}

// ── Pitch: higher / lower / same ─────────────────────────────────────────────

function genPitch(mod, cfg) {
  const ids = cfg.allowSame ? ['up', 'down', 'same'] : ['up', 'down'];
  const picked = pickWeighted(ids.map(id => ({ id, itemKey: `pi:${id}` })));
  const gap = picked.id === 'same' ? 0 : randInt(cfg.gap[0], cfg.gap[1]);
  let lo = 48, hi = 76;
  if (picked.id === 'up') hi -= gap;
  if (picked.id === 'down') lo += gap;
  const a = randInt(lo, hi);
  const b = picked.id === 'up' ? a + gap : picked.id === 'down' ? a - gap : a;
  const events = [
    { midi: a, at: 0, dur: 0.7 },
    { midi: b, at: 0.88, dur: 0.7 },
  ];
  const labels = { up: 'Higher', down: 'Lower', same: 'Same' };
  return {
    moduleId: 'pitch', kind: 'choice', prompt: mod.prompt,
    options: ids.map(id => ({ id, label: labels[id] })),
    answerId: picked.id,
    events,
    optionEvents: {},            // a "higher/lower" choice has no sound of its own
    play: () => playFresh(events),
    playOption: null,
    grade(answeredId) {
      const correct = answeredId === this.answerId;
      return {
        correct,
        itemResults: [{ key: `pi:${this.answerId}`, correct }],
        // A choice question like any other: what the answer was, what was
        // picked — feeds the per-answer breakdown and the confusion list.
        confusion: { correctId: this.answerId, answeredId },
      };
    },
  };
}

// ── Absolute pitch: one bare note, no reference ───────────────────────────────

function genAbsolute(mod, cfg) {
  const picked = pickWeighted(cfg.items.map(pc => ({ pc, itemKey: `ap:${pc}` })));
  const [lo, hi] = cfg.range;
  const noteMidi = randInt(lo, hi);
  // The single note is all that ever sounds — no cadence, no drone, no root.
  // That isolation *is* the exercise, so `events` is exposed on the question:
  // it lets the "one note, no reference" invariant be asserted outside a browser.
  const events = [{ midi: noteMidi, at: 0, dur: 1.0 }];
  // Option previews are voiced in the question note's own octave, so a wrong
  // answer is heard as the exact note it should have been.
  const octaveBase = noteMidi - (noteMidi % 12);
  const optionEvents = {};
  for (const pc of cfg.items) optionEvents[pc] = [{ midi: octaveBase + pc, at: 0, dur: 0.9 }];

  return {
    moduleId: 'absolute', kind: 'choice', prompt: mod.prompt,
    noteMidi,
    events,
    optionEvents,
    options: cfg.items.map(pc => ({ id: pc, label: pitchClassName(pc) })),
    answerId: picked.pc,
    play: () => playFresh(events),
    playOption: id => playFresh(optionEvents[id]),
    grade(answeredId) {
      const correct = answeredId === this.answerId;
      return {
        correct,
        itemResults: [{ key: picked.itemKey, correct }],
        confusion: { correctId: this.answerId, answeredId },
      };
    },
  };
}

// ── Intervals ────────────────────────────────────────────────────────────────

// A random direction different from the one just heard, so replays of the same
// interval never repeat the same voicing while alternatives remain selected.
export function pickOtherDir(dirs, lastDir) {
  const others = dirs.filter(d => d !== lastDir);
  return others.length ? choice(others) : lastDir;
}

function genInterval(mod, cfg) {
  const cands = [];
  for (const id of cfg.items) {
    for (const dir of cfg.dirs) {
      cands.push({ id, dir, itemKey: `iv:${id}:${dir}` });
    }
  }
  const picked = pickWeighted(cands);
  const semis = INTERVALS[picked.id].semis;

  // The pair is fixed — lower note at `root`, upper at root+semis — and stays
  // inside C3–C6 (48–84) whatever the direction, which only reorders the two.
  const root = randInt(48, Math.min(72, 84 - semis));

  const dirs = [...new Set(cfg.dirs)];
  let lastDir = picked.dir;

  const optionIds = [...new Set(cfg.items)];
  // Serialisable plan for the native screen-off engine: the same events the
  // web player schedules. `playOption` uses the generated direction.
  const optionEvents = {};
  for (const id of optionIds) {
    optionEvents[id] = Audio.intervalEvents(root, INTERVALS[id].semis, picked.dir);
  }
  const song = INTERVALS[picked.id].songs?.[picked.dir === 'd' ? 'desc' : 'asc'];
  const dirWord = { a: 'ascending', d: 'descending', h: 'harmonic' }[picked.dir];

  const question = {
    moduleId: 'intervals', kind: 'choice', prompt: mod.prompt,
    dir: lastDir,
    events: Audio.intervalEvents(root, semis, lastDir),
    optionEvents,
    options: optionIds.map(id => ({ id, label: INTERVALS[id].name, sub: INTERVALS[id].short })),
    answerId: picked.id,
    mnemonic: song && picked.dir !== 'h'
      ? `${INTERVALS[picked.id].name} ${dirWord} · think “${song}”`
      : null,
    play: () => playFresh(question.events),
    playOption: id => playFresh(optionEvents[id]),
    grade(answeredId) {
      const correct = answeredId === this.answerId;
      return {
        correct,
        itemResults: [{ key: picked.itemKey, correct }],
        confusion: { correctId: this.answerId, answeredId },
      };
    },
  };

  // Replays vary the voicing: the same interval comes back in another selected
  // direction, never the one just heard. Statistics and the mnemonic stay tied
  // to the direction the question was generated in.
  question.replayNext = () => {
    lastDir = pickOtherDir(dirs, lastDir);
    question.dir = lastDir;
    question.events = Audio.intervalEvents(root, semis, lastDir);
    return question.events;
  };
  question.replay = () => playFresh(question.replayNext());

  return question;
}

// ── Chords ───────────────────────────────────────────────────────────────────

function genChord(mod, cfg) {
  const picked = pickWeighted(cfg.items.map(id => ({ id, itemKey: `ch:${id}` })));
  const semis = CHORDS[picked.id].semis;
  const maxOffset = Math.max(...semis);
  // Voicing centred around middle C; top note capped near A5.
  const root = randInt(55, Math.max(55, Math.min(67, 81 - maxOffset)));
  const style = state.settings.chordStyle;
  const events = Audio.chordEvents(root, semis, style);
  const optionEvents = {};
  for (const id of cfg.items) optionEvents[id] = Audio.chordEvents(root, CHORDS[id].semis, style);

  return {
    moduleId: 'chords', kind: 'choice', prompt: mod.prompt,
    options: cfg.items.map(id => ({ id, label: CHORDS[id].name, sub: CHORDS[id].short })),
    answerId: picked.id,
    events,
    optionEvents,
    play: () => playFresh(events),
    playOption: id => playFresh(optionEvents[id]),
    grade(answeredId) {
      const correct = answeredId === this.answerId;
      return {
        correct,
        itemResults: [{ key: picked.itemKey, correct }],
        confusion: { correctId: this.answerId, answeredId },
      };
    },
  };
}

// ── Scales ───────────────────────────────────────────────────────────────────

function genScale(mod, cfg) {
  const picked = pickWeighted(cfg.items.map(id => ({ id, itemKey: `sc:${id}` })));
  const root = randInt(53, 67);
  const events = Audio.scaleEvents(root, SCALES[picked.id].semis);
  const optionEvents = {};
  for (const id of cfg.items) optionEvents[id] = Audio.scaleEvents(root, SCALES[id].semis);

  return {
    moduleId: 'scales', kind: 'choice', prompt: mod.prompt,
    options: cfg.items.map(id => ({ id, label: SCALES[id].name, sub: SCALES[id].sub })),
    answerId: picked.id,
    events,
    optionEvents,
    play: () => playFresh(events),
    playOption: id => playFresh(optionEvents[id]),
    grade(answeredId) {
      const correct = answeredId === this.answerId;
      return {
        correct,
        itemResults: [{ key: picked.itemKey, correct }],
        confusion: { correctId: this.answerId, answeredId },
      };
    },
  };
}

// ── Functional helpers: cadence + voiced numerals ────────────────────────────

// Close-position triad voiced near `center`, plus a bass root note.
function voiceNumeral(keyRoot, numeralId, center = 64) {
  const num = NUMERALS[numeralId];
  const chordRoot = keyRoot + num.root;
  const base = CHORDS[num.quality].semis; // [0,3/4,7]
  const inversions = [
    [base[0], base[1], base[2]],
    [base[1], base[2], base[0] + 12],
    [base[2], base[0] + 12, base[1] + 12],
  ];
  let best = null, bestDist = Infinity;
  for (const inv of inversions) {
    for (const oct of [-12, 0, 12]) {
      const notes = inv.map(s => chordRoot + s + oct);
      const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
      const d = Math.abs(avg - center);
      if (d < bestDist) { bestDist = d; best = notes; }
    }
  }
  let bass = chordRoot;
  while (bass > 52) bass -= 12;
  while (bass < 41) bass += 12;
  return [bass, ...best];
}

function cadenceFor(keyRoot, mode) {
  return Audio.cadenceEvents(
    CADENCES[mode].map(n => ({ root: 0, semis: voiceNumeral(keyRoot, n) }))
  );
}

// ── Scale degrees ─────────────────────────────────────────────────────────────

function genDegree(mod, cfg) {
  const picked = pickWeighted(cfg.items.map(id => ({ id, itemKey: `dg:${cfg.mode}:${id}` })));
  const keyRoot = randInt(53, 64);
  const octave = cfg.wide ? choice([-12, 0, 12]) : choice([0, 12]);
  const noteMidi = keyRoot + DEGREES[picked.id].semis + octave;

  const cadence = cadenceFor(keyRoot, cfg.mode);
  const noteAt = Audio.eventsDuration(cadence) + 0.55;
  const events = [...cadence, { midi: noteMidi, at: noteAt, dur: 1.0 }];

  const labelOf = id => state.settings.degreeLabels === 'number'
    ? DEGREES[id].number : DEGREES[id].solfege;
  const subOf = id => state.settings.degreeLabels === 'number'
    ? DEGREES[id].solfege : DEGREES[id].number;

  const optionEvents = {};
  for (const id of cfg.items) {
    const candidates = [-12, 0, 12].map(o => keyRoot + DEGREES[id].semis + o);
    const m = candidates.reduce((a, b) =>
      Math.abs(b - noteMidi) < Math.abs(a - noteMidi) ? b : a);
    optionEvents[id] = [{ midi: m, at: 0, dur: 1.0 }];
  }

  return {
    moduleId: 'degrees', kind: 'choice', prompt: mod.prompt,
    options: cfg.items.map(id => ({ id, label: labelOf(id), sub: subOf(id) })),
    answerId: picked.id,
    events,
    optionEvents,
    play: () => playFresh(events),
    // Compare a degree in the same register as the question note.
    playOption: id => playFresh(optionEvents[id]),
    grade(answeredId) {
      const correct = answeredId === this.answerId;
      return {
        correct,
        itemResults: [{ key: picked.itemKey, correct }],
        confusion: { correctId: this.answerId, answeredId },
      };
    },
  };
}

// ── Progressions ──────────────────────────────────────────────────────────────

function genProgression(mod, cfg) {
  // The forced tonic must exist in the pool — switching to a minor key with a
  // major-numeral pool must not ask for a chord that has no answer button.
  const tonicId = cfg.mode === 'major' ? 'I' : 'i';
  const useTonic = cfg.startTonic && cfg.pool.includes(tonicId);
  const enders = cfg.pool.filter(n => ['I', 'i', 'V', 'vi'].includes(n));

  const seq = [useTonic ? tonicId : choice(cfg.pool)];
  for (let i = 1; i < cfg.length; i++) {
    if (cfg.pool.length < 2) { seq.push(cfg.pool[0]); continue; }   // no alternative chord
    let next;
    do { next = choice(cfg.pool); } while (next === seq[i - 1]);
    seq.push(next);
  }
  // Real progressions tend to land somewhere stable.
  if (enders.length && Math.random() < 0.7 && !enders.includes(seq[seq.length - 1])) {
    const alternatives = enders.filter(n => n !== seq[seq.length - 2]);
    if (alternatives.length) seq[seq.length - 1] = choice(alternatives);
  }

  const keyRoot = randInt(50, 59);
  const cadence = cadenceFor(keyRoot, cfg.mode);
  let at = Audio.eventsDuration(cadence) + 0.8;
  const progEvents = [];
  for (const n of seq) {
    progEvents.push({ midis: voiceNumeral(keyRoot, n), at, dur: 0.85, vel: 0.6 });
    at += 0.95;
  }
  const events = [...cadence, ...progEvents];
  const given = seq.map((_, i) => i === 0 && useTonic);

  return {
    moduleId: 'progressions', kind: 'sequence', prompt: mod.prompt,
    options: cfg.pool.map(id => ({ id, label: NUMERALS[id].name })),
    answerSeq: seq,
    given,
    slots: cfg.length,
    play: () => playFresh(events),
    playProgressionOnly: () => playFresh(progEvents.map(e => ({ ...e, at: e.at - progEvents[0].at }))),
    playOption: null,
    grade(userSeq) { // user fills every slot; given slots are just shown as hints
      const itemResults = [];
      let allCorrect = true;
      for (let i = 0; i < seq.length; i++) {
        const ok = userSeq[i] === seq[i];
        if (!ok) allCorrect = false;
        if (!given[i]) itemResults.push({ key: `pg:${cfg.mode}:${seq[i]}`, correct: ok });
      }
      return { correct: allCorrect, itemResults, confusion: null };
    },
  };
}

// ── Melodies ──────────────────────────────────────────────────────────────────

function genMelody(mod, cfg) {
  const keyRoot = randInt(55, 64);
  // Allowed scale tones: exactly the configured degrees, plus the upper Do
  // only when opted in — never notes beyond what the keyboard will render.
  const allowed = cfg.degrees.map(d => keyRoot + DEGREES[d].semis);
  if (cfg.upperDo) allowed.push(keyRoot + 12);
  allowed.sort((a, b) => a - b);
  const top = allowed[allowed.length - 1];

  const startPool = cfg.length <= 4
    ? [keyRoot]
    : [keyRoot, keyRoot + 4, keyRoot + 7].filter(m => allowed.includes(m));
  let idx = allowed.indexOf(startPool.length ? choice(startPool) : keyRoot);
  if (idx < 0) idx = 0;

  const stepWeights = cfg.leapy
    ? [[-4, 1], [-3, 1.5], [-2, 2], [-1, 3], [1, 3], [2, 2], [3, 1.5], [4, 1]]
    : [[-2, 1], [-1, 3.5], [1, 3.5], [2, 1]];

  const midis = [allowed[idx]];
  for (let i = 1; i < cfg.length; i++) {
    const moves = stepWeights.filter(([s]) => idx + s >= 0 && idx + s < allowed.length);
    if (!moves.length) { midis.push(allowed[idx]); continue; }   // pool too small to move
    const [step] = weightedChoice(moves, moves.map(([, w]) => w));
    idx += step;
    let m = allowed[idx];
    if (cfg.chromatic && Math.random() < cfg.chromatic && i < cfg.length - 1) {
      const alt = m + choice([-1, 1]);
      if (alt > keyRoot - 1 && alt < top + 1 && !allowed.includes(alt)) m = alt;
    }
    midis.push(m);
  }

  const tempo = state.settings.melodyTempo;
  const cadence = cadenceFor(keyRoot, 'major');
  const melodyStart = Audio.eventsDuration(cadence) + 0.7;
  const events = [...cadence, ...Audio.shiftEvents(Audio.melodyEvents(midis, tempo), melodyStart)];

  // Stats key follows the configuration signature, not a level index: the same
  // length/first-note/leaps/chromatic mix is the same skill.
  const sig = `ml:${cfg.length}:${cfg.firstGiven ? 1 : 0}:${cfg.leapy ? 1 : 0}:${cfg.chromatic ? 1 : 0}`;

  return {
    moduleId: 'melodies', kind: 'melody', prompt: mod.prompt,
    targetMidis: midis,
    firstGiven: !!cfg.firstGiven,   // first note shown as a hint; user still plays it
    tonicMidi: keyRoot,
    keyRange: [keyRoot - 1, top + 1], // every possible answer fits on the keyboard
    play: () => playFresh(events),
    playMelodyOnly: () => playFresh(Audio.melodyEvents(midis, tempo)),
    playOption: null,
    grade(userMidis) {
      let allCorrect = true;
      for (let i = 0; i < midis.length; i++) {
        if (userMidis[i] !== midis[i]) allCorrect = false;
      }
      return {
        correct: allCorrect,
        itemResults: [{ key: sig, correct: allCorrect }],
        confusion: null,
      };
    },
  };
}
