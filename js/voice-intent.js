// voice-intent.js — turn one speech transcript into an answer or a command.
//
// Pure and platform-free: the Android shell (Vosk) and the browser (Web
// Speech) both feed the same text through here, so both behave identically.
// Kept deliberately separate from speech.js (which only *speaks* names) and
// from session.js (which owns the question loop).
//
// Matching ladder, first hit wins:
//   1. commands ("replay", "next", …)
//   2. explicit index ("option 3", "number three")
//   3. exact alias ("perfect fifth", "C sharp")
//   4. containment ("fifth" if the pool has exactly one fifth; extra words ok)
//   5. bare number ("five" → the fifth button)
//   6. fuzzy ("perfect fith", "miner third")
//
// Names beat numbers on purpose: in Scale Degrees the option labelled "3" is
// Mi, so "three" answers Mi while "option three" picks the third button.

import { INTERVALS, CHORDS, SCALES, DEGREES, pitchClassName } from './theory.js';
import { ZH } from './i18n.zh.js';
import { parseIntentZh, commandPhrasesForZh } from './voice-intent-zh.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety'];
const ORDINAL_IRREGULAR = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};

function numberWord(n) {
  if (n < 20) return ONES[n] ?? '';
  const t = Math.floor(n / 10), o = n % 10;
  return TENS[t] ? `${TENS[t]}${o ? ` ${ONES[o]}` : ''}` : '';
}

function ordinalWord(n) {
  const word = numberWord(n);
  if (!word) return '';
  const parts = word.split(' ');
  const last = parts.pop();
  let ord = ORDINAL_IRREGULAR[last];
  if (!ord) ord = /y$/.test(last) ? last.slice(0, -1) + 'ieth' : last + 'th';
  return [...parts, ord].join(' ');
}

const ORDINAL_TO_NUMBER = new Map();
for (let i = 1; i <= 99; i++) ORDINAL_TO_NUMBER.set(ordinalWord(i), i);

// Words people (and recognisers) add around the answer. Articles are handled
// separately: a lone "A" is a note name, "a major chord" is not.
const FILLER = new Set([
  'the', 'in', 'is', 'it', 'that', 'was', 'please', 'mode', 'scale', 'note',
  'chord', 'sound', 'answer', 'interval',
]);

// Frequent recogniser slips on exactly the vocabulary this app uses.
const HOMOPHONE = {
  miner: 'minor', miners: 'minor', minnor: 'minor', manor: 'minor',
  mayor: 'major', majour: 'major',
  dominate: 'dominant', dominated: 'dominant',
  fith: 'fifth', fivth: 'fifth', fift: 'fifth', fifthh: 'fifth',
  forth: 'fourth', nineth: 'ninth', nighth: 'ninth', thrid: 'third',
  secound: 'second', sekond: 'second',
  augument: 'augmented', augment: 'augmented', augmentid: 'augmented',
  diminish: 'diminished', dimished: 'diminished',
  inv: 'inversion', inversions: 'inversion',
  sole: 'sol', doe: 'do', ray: 're', reh: 're', mee: 'mi', fah: 'fa',
  lah: 'la', tee: 'ti', rah: 'ra', meh: 'me', fee: 'fi', leh: 'le', teh: 'te',
  to: 'two', too: 'two', for: 'four', ate: 'eight', won: 'one',
  pentatonic: 'pentatonic',
};

export function normalizeTranscript(text) {
  let s = ` ${String(text ?? '').toLowerCase()} `;
  s = s.replace(/♯/g, ' sharp ').replace(/#/g, ' sharp ').replace(/♭/g, ' flat ');
  // "Sus2" has no word boundary before the digit; split it so the number path
  // below turns it into "sus two".
  s = s.replace(/([a-z])(\d)/gi, '$1 $2');
  // "see sharp" is what an English recogniser writes for "C♯".
  s = s.replace(/\bsee sharp\b/g, 'c sharp').replace(/\bsee flat\b/g, 'c flat');
  s = s.replace(/\b(\d+)\s*(?:st|nd|rd|th)\b/g, (_, d) => ` ${ordinalWord(Number(d))} `);
  s = s.replace(/\b(\d+)\b/g, (_, d) => ` ${numberWord(Number(d))} `);
  s = s.replace(/[·•,.;:!?()[\]{}"“”'’/\\-]/g, ' ');
  let tokens = s.split(/\s+/).filter(Boolean)
    .filter(t => !FILLER.has(t))
    .map(t => HOMOPHONE[t] ?? t);
  // Drop a leading article only when something else remains ("a major chord"),
  // never when the whole utterance is "a" — that is the note A.
  if (tokens.length > 1) tokens = tokens.filter((t, i) => !(i === 0 && (t === 'a' || t === 'an')));
  return tokens.join(' ');
}

const tokensOf = norm => norm.split(' ').filter(Boolean);

function parseNumberWords(words) {
  if (!words.length || words.length > 3) return null;
  // "first", "twenty third" — people answer with ordinals as often as with
  // cardinals, and the UI numbers the buttons 1, 2, 3…
  const ordinal = ORDINAL_TO_NUMBER.get(words.join(' '));
  if (ordinal) return ordinal;
  let total = 0;
  for (const w of words) {
    const one = ONES.indexOf(w);
    const ten = TENS.indexOf(w);
    if (one >= 0) total += one;
    else if (ten > 0) total += ten * 10;
    else return null;
  }
  return total;
}

// ── aliases ───────────────────────────────────────────────────────────────────

const PITCH_ALIASES = {
  up: ['higher', 'up', 'high', 'rising', 'rose', 'went up'],
  down: ['lower', 'down', 'low', 'falling', 'fell', 'went down'],
  same: ['same', 'equal', 'identical', 'unchanged'],
};

// The note spelling in theory.js plus the enharmonic one a musician may say.
const ENHARMONIC = { 1: 'D♭', 3: 'D♯', 6: 'G♭', 8: 'G♯', 10: 'A♯' };

const INTERVAL_EXTRA = {
  // No "augmented fourth" / "diminished fifth" here: they would make a bare
  // "fourth" or "fifth" ambiguous with P4/P5, and "tritone" is unambiguous.
  P8: ['eighth'],
};

const SCALE_EXTRA = {
  major: ['ionian'],
  natmin: ['aeolian', 'minor'],
  harmmin: ['harmonic minor scale'],
  melmin: ['melodic minor scale'],
  majpent: ['major pentatonic scale'],
  minpent: ['minor pentatonic scale'],
  blues: ['blues scale'],
  wholetone: ['whole tone scale', 'whole tone'],
  dimhw: ['octatonic', 'half whole diminished', 'whole half diminished'],
};

const CHORD_EXTRA = {
  m7b5: ['half diminished seventh'],
  mM7: ['minor major seventh'],
  dom7: ['dominant seventh chord'],
  maj7: ['major seventh chord'],
  min7: ['minor seventh chord'],
  dim7: ['diminished seventh chord'],
};

const SOLFEGE_SPOKEN = {
  do: 'doe', re: 'reh', mi: 'mee', fa: 'fah', sol: 'so', la: 'lah', ti: 'tee',
  ra: 'rah', me: 'meh', fi: 'fee', le: 'leh', te: 'teh',
};

function rawAliases(moduleId, id) {
  const out = [];
  switch (moduleId) {
    case 'pitch':
      out.push(...(PITCH_ALIASES[id] ?? []));
      break;
    case 'absolute': {
      const pc = Number(id);
      const name = pitchClassName(pc);
      out.push(name);
      if (ENHARMONIC[pc]) out.push(ENHARMONIC[pc]);
      break;
    }
    case 'intervals': {
      const iv = INTERVALS[id];
      if (!iv) break;
      out.push(iv.name);
      out.push(...(INTERVAL_EXTRA[id] ?? []));
      break;
    }
    case 'chords': {
      const chord = CHORDS[id];
      if (!chord) break;
      out.push(chord.name);
      out.push(chord.name.replace(' · ', ' '));           // drop the dot
      out.push(...(CHORD_EXTRA[id] ?? []));
      break;
    }
    case 'scales': {
      const scale = SCALES[id];
      if (!scale) break;
      out.push(scale.name);
      if (scale.sub) out.push(`${scale.name} ${scale.sub}`);
      out.push(...(SCALE_EXTRA[id] ?? []));
      break;
    }
    case 'degrees': {
      const deg = DEGREES[id];
      if (!deg) break;
      out.push(deg.solfege);
      if (SOLFEGE_SPOKEN[id]) out.push(SOLFEGE_SPOKEN[id]);
      out.push(deg.number);                                // "♭3"
      out.push(deg.number.replace(/\d+/, n => ordinalWord(Number(n)))); // "♭third"
      break;
    }
    default:
      break;
  }
  return out;
}

export function aliasesFor(moduleId, id) {
  const seen = new Set();
  for (const raw of rawAliases(moduleId, id)) {
    const norm = normalizeTranscript(raw);
    if (norm) seen.add(norm);
  }
  return [...seen];
}

function aliasMapFor(ctx) {
  const map = new Map();                     // alias → Set(id)
  for (const opt of ctx.options ?? []) {
    for (const alias of aliasesFor(ctx.moduleId, opt.id)) {
      if (!map.has(alias)) map.set(alias, new Set());
      map.get(alias).add(opt.id);
    }
  }
  return map;
}

// ── commands ─────────────────────────────────────────────────────────────────

const COMMANDS = [
  { name: 'stop', patterns: [/\bstop listening\b/, /\bstop\b/, /\bvoice off\b/, /\bexit voice\b/, /\bclose voice\b/, /\bturn off\b/] },
  { name: 'names', patterns: [/\bnames\b/, /\bsay the names\b/, /\btell me\b/, /\bwhat was it\b/] },
  { name: 'next', patterns: [/\bnext question\b/, /\bnext\b/, /\bskip\b/, /\bmove on\b/, /\bgo on\b/] },
  { name: 'replay', patterns: [/\breplay\b/, /\bplay it again\b/, /\bplay again\b/, /\bagain\b/, /\brepeat\b/, /\bone more time\b/, /^play$/] },
];

const COMMAND_PHRASES = [
  'replay', 'play again', 'again', 'next', 'skip', 'names', 'say the names',
  'stop listening', 'stop',
];

const COMMAND_ALIASES = {
  replay: ['replay', 'play again', 'again', 'repeat', 'one more time', 'play'],
  next: ['next', 'next question', 'skip', 'move on', 'go on'],
  names: ['names', 'say the names', 'tell me', 'what was it'],
  stop: ['stop listening', 'stop', 'voice off', 'exit voice', 'close voice', 'turn off'],
};

/** Phrase → command table for the native screen-off engine. */
export function commandPhrasesFor(lang) {
  return lang === 'zh' ? commandPhrasesForZh() : COMMAND_ALIASES;
}

// ── matching ─────────────────────────────────────────────────────────────────

function subset(a, b) {
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 6) return Math.max(a.length, b.length);
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,                 // delete
        prev[j - 1] + 1,             // insert
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = tmp;
    }
  }
  return prev[b.length];
}

function explicitIndex(norm, count) {
  const m = norm.match(/\b(?:option|number|choice)\s+([a-z ]+)$/);
  if (!m) return null;
  const n = parseNumberWords(m[1].trim().split(/\s+/));
  return n !== null && n >= 1 && n <= count ? n : null;
}

function bareIndex(norm, count) {
  const words = tokensOf(norm);
  if (words.length > 3) return null;
  const n = parseNumberWords(words);
  return n !== null && n >= 1 && n <= count ? n : null;
}

function containScore(t, aliasTokens) {
  const a = new Set(aliasTokens);
  if (t.size === 0 || a.size === 0) return 0;
  if (!subset(t, a) && !subset(a, t)) return 0;
  let shared = 0;
  for (const x of t) if (a.has(x)) shared++;
  return shared / (t.size + a.size - shared);   // Jaccard
}

export function parseIntent(transcript, ctx = {}) {
  if (ctx.language === 'zh') return parseIntentZh(transcript, ctx);
  const heard = String(transcript ?? '').trim();
  const norm = normalizeTranscript(heard);
  if (!norm) return { type: 'none', reason: 'empty', heard };

  for (const cmd of COMMANDS) {
    if (cmd.patterns.some(re => re.test(norm))) {
      return { type: 'command', name: cmd.name, heard };
    }
  }

  const options = ctx.options ?? [];
  if (!options.length) return { type: 'none', reason: 'no-options', heard };

  const idx = explicitIndex(norm, options.length);
  if (idx !== null) {
    return { type: 'answer', via: 'index', id: options[idx - 1].id, index: idx, score: 1, heard };
  }

  const map = aliasMapFor(ctx);
  const exact = map.get(norm);
  if (exact && exact.size === 1) {
    const id = [...exact][0];
    return { type: 'answer', via: 'name', id, index: options.findIndex(o => o.id === id), score: 1, heard };
  }

  const t = new Set(tokensOf(norm));
  const contained = new Map();                 // id → best score
  for (const [alias, ids] of map) {
    const score = containScore(t, tokensOf(alias));
    if (!score) continue;
    for (const id of ids) contained.set(id, Math.max(contained.get(id) ?? 0, score));
  }
  if (contained.size === 1) {
    const [id, score] = [...contained.entries()][0];
    return { type: 'answer', via: 'name', id, index: options.findIndex(o => o.id === id), score, heard };
  }
  if (contained.size > 1) {
    // Several options fit — saying just "third" with both thirds in the pool
    // is genuinely ambiguous, and guessing would teach the wrong answer.
    const ranked = [...contained.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked[0][1] - (ranked[1][1] ?? 0) < 0.12) {
      return { type: 'none', reason: 'ambiguous', heard };
    }
  }

  const bare = bareIndex(norm, options.length);
  if (bare !== null) {
    return { type: 'answer', via: 'index', id: options[bare - 1].id, index: bare, score: 1, heard };
  }

  // Fuzzy — tolerate one garbled syllable, but never guess on short noise.
  if (norm.length >= 4) {
    let best = { id: null, score: 0 };
    let second = 0;
    for (const [alias, ids] of map) {
      const score = 1 - levenshtein(norm, alias) / Math.max(norm.length, alias.length);
      for (const id of ids) {
        if (score > best.score) {
          if (best.id !== null && best.id !== id) second = Math.max(second, best.score);
          best = { id, score };
        } else if (id !== best.id) {
          second = Math.max(second, score);
        }
      }
    }
    if (best.id !== null && best.score >= 0.78 && best.score - second >= 0.05) {
      return {
        type: 'answer', via: 'fuzzy', id: best.id,
        index: options.findIndex(o => o.id === best.id),
        score: best.score, heard,
      };
    }
  }

  return { type: 'none', reason: 'no-match', heard };
}

// The phrases handed to an on-device recogniser (Vosk grammar). Short, ASCII,
// lowercase; the recogniser never invents words outside this list.
export function grammarPhrases(ctx) {
  // The Chinese model ships no word list, so grammar phrases cannot be
  // verified against its vocabulary; use the language model instead.
  if (ctx.language === 'zh') return [];
  const set = new Set(COMMAND_PHRASES);
  for (const alias of aliasMapFor(ctx).keys()) set.add(alias);

  // The recogniser only hears words the grammar contains, so the spoken
  // numbers must be in it too — otherwise "one" is simply not decoded.
  const count = ctx.options?.length ?? 0;
  for (let i = 1; i <= count; i++) {
    const card = numberWord(i);
    const ord = ordinalWord(i);
    set.add(card);
    set.add(ord);
    set.add(`option ${card}`);
    set.add(`number ${card}`);
    set.add(`option ${ord}`);
    set.add(`number ${ord}`);
  }
  return [...set].filter(p => /^[\x20-\x7e]+$/.test(p));
}
