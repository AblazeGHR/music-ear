// curriculum.js — the exercise registry.
//
// There are no levels, no unlocks and no progression. Every entry is one flat
// practice mode: `defaults` is the question configuration `engine.js` consumes,
// and `options` describes the controls shown in the practice page's Options
// panel. User overrides live in state.settings.exercises[<id>] and are merged
// over `defaults` by state.moduleConfig().
//
// Option descriptors:
//   { key, label, type: 'chips',  choices: [[id, label], …] }   multi-select
//   { key, label, type: 'select', choices: [[value, label], …] } single choice
//   { key, label, type: 'toggle' }                                boolean
//   { key, label, type: 'range', min, max, step }                 two numbers

import {
  INTERVALS, CHORDS, SCALES, DEGREES, NUMERALS,
  pitchClassName,
} from './theory.js';

const pitches = () => Array.from({ length: 12 }, (_, i) => i);
const PITCH_CHOICES = pitches().map(pc => [pc, pitchClassName(pc)]);
const INTERVAL_CHOICES = Object.entries(INTERVALS).map(([id, iv]) => [id, iv.name]);
const CHORD_CHOICES = Object.entries(CHORDS).map(([id, c]) => [id, c.name]);
const SCALE_CHOICES = Object.entries(SCALES).map(([id, sc]) => [id, sc.name]);
const DEGREE_CHOICES = Object.entries(DEGREES).map(([id, d]) => [id, d.solfege]);
const NUMERAL_CHOICES = Object.entries(NUMERALS).map(([id, n]) => [id, n.name]);

const MIDI_RANGE = { min: 21, max: 108, step: 1 };

export const MODULES = [
  {
    id: 'pitch',
    title: 'Pitch',
    icon: '⇅',
    color: 'sky',
    kind: 'choice',
    itemPrefix: 'pi',   // item-stat keys: "pi:…"
    prompt: 'Is the second note higher or lower?',
    howTo: 'You\'ll hear two notes. Say whether the second one is higher or lower than the first.',
    blurb: 'Higher or lower? The very first skill — and the foundation of everything else.',
    tip: 'Sing or hum both notes back (out loud or in your head). Your voice knows which way it moved even when your ear feels unsure.',
    defaults: { gap: [1, 7], allowSame: true },
    options: [
      { key: 'gap', label: 'Gap between the notes (semitones)', type: 'range', min: 1, max: 12, step: 1 },
      { key: 'allowSame', label: 'Allow “same note”', type: 'toggle' },
    ],
  },
  {
    id: 'absolute',
    title: 'Absolute Pitch',
    icon: '♯',
    color: 'lime',
    kind: 'choice',
    itemPrefix: 'ap',   // item-stat keys: "ap:…"
    prompt: 'What note is this?',
    howTo: 'One note plays on its own — no reference, no key, no chord. Name it from the twelve note names.',
    blurb: 'Hear a single note in isolation and name it. The purest form of absolute pitch.',
    tip: 'Say the name out loud before you answer, then sing it back. This is a labelling skill: the note already has a name in your head — reach for that before you start reasoning about the key.',
    defaults: { items: pitches(), range: [48, 72] },
    options: [
      { key: 'items', label: 'Note names', type: 'chips', choices: PITCH_CHOICES },
      { key: 'range', label: 'Register', type: 'range', format: 'pitch', ...MIDI_RANGE },
    ],
  },
  {
    id: 'intervals',
    title: 'Intervals',
    icon: '⌒',
    color: 'violet',
    kind: 'choice',
    itemPrefix: 'iv',   // item-stat keys: "iv:…"
    prompt: 'What interval is this?',
    howTo: 'Two notes, one distance. Name the interval between them, up, down or together. Replays may switch direction — the interval is the answer.',
    blurb: 'The distance between two notes. Learn all twelve, up, down, and together.',
    tip: 'Anchor each interval to a song you know (shown when you miss one). Over time the song fades and the sound itself remains.',
    defaults: { items: ['M3', 'P5', 'P8'], dirs: ['a', 'd', 'h'] },
    options: [
      { key: 'items', label: 'Intervals', type: 'chips', choices: INTERVAL_CHOICES },
      {
        key: 'dirs', label: 'Direction', type: 'chips',
        choices: [['a', 'Ascending'], ['d', 'Descending'], ['h', 'Harmonic']],
      },
    ],
  },
  {
    id: 'chords',
    title: 'Chords',
    icon: '♬',
    color: 'amber',
    kind: 'choice',
    itemPrefix: 'ch',   // item-stat keys: "ch:…"
    prompt: 'What chord is this?',
    howTo: 'Three to five notes at once. Name the colour of the chord.',
    blurb: 'From major vs minor to ninths and inversions — name the colour of a chord.',
    tip: 'First react to the overall mood (bright, dark, tense, floating), then check the top and bottom notes. Don\'t dissect — let the gestalt hit you first.',
    defaults: { items: ['maj', 'min', 'dim', 'aug', 'dom7', 'maj7', 'min7', 'maj_1', 'maj_2', 'min_1', 'min_2'] },
    options: [
      { key: 'items', label: 'Chord types', type: 'chips', choices: CHORD_CHOICES },
    ],
  },
  {
    id: 'scales',
    title: 'Scales & Modes',
    icon: '𝄚',
    color: 'emerald',
    kind: 'choice',
    itemPrefix: 'sc',   // item-stat keys: "sc:…"
    prompt: 'What scale is this?',
    howTo: 'A ladder of notes from the root to the octave. Name the scale.',
    blurb: 'Major, minor, pentatonic, the church modes, and beyond.',
    tip: 'Listen for the notes that differ from plain major or minor — the raised 7th of harmonic minor, the bright ♯4 of Lydian, the ♭7 of Mixolydian.',
    defaults: { items: ['major', 'natmin', 'majpent', 'minpent', 'blues', 'dorian', 'mixolydian'] },
    options: [
      { key: 'items', label: 'Scales', type: 'chips', choices: SCALE_CHOICES },
    ],
  },
  {
    id: 'degrees',
    title: 'Scale Degrees',
    icon: '◉',
    color: 'rose',
    kind: 'choice',
    itemPrefix: 'dg',   // item-stat keys: "dg:…"
    prompt: 'Which scale degree is this?',
    howTo: 'First a short chord cadence establishes the key. Then one note plays — name where it sits in that key.',
    blurb: 'Hear a key, then name where a note sits inside it. The core of functional hearing.',
    tip: 'After the cadence, sing the note down (or up) to Do before answering. The pull each degree feels toward home is what you\'re learning.',
    defaults: { mode: 'major', items: ['do', 're', 'mi', 'fa', 'sol'], wide: false },
    options: [
      {
        key: 'mode', label: 'Key', type: 'select',
        choices: [['major', 'Major'], ['minor', 'Minor']],
      },
      { key: 'items', label: 'Degrees', type: 'chips', choices: DEGREE_CHOICES },
      { key: 'wide', label: 'Spread across two octaves', type: 'toggle' },
    ],
  },
  {
    id: 'progressions',
    title: 'Progressions',
    icon: '⛓',
    color: 'cyan',
    kind: 'sequence',
    itemPrefix: 'pg',   // item-stat keys: "pg:…"
    prompt: 'Name the chords you hear',
    howTo: 'A cadence establishes the key, then a progression plays. Tap one Roman numeral per chord, in order.',
    blurb: 'Hear a key, then identify each chord of a progression by its Roman numeral.',
    tip: 'Track the bass line first — it usually walks from root to root. Then confirm with each chord\'s colour: is it the bright IV or the wistful vi?',
    defaults: { mode: 'major', pool: ['I', 'IV', 'V', 'vi'], length: 4, startTonic: true },
    options: [
      {
        key: 'mode', label: 'Key', type: 'select',
        choices: [['major', 'Major'], ['minor', 'Minor']],
      },
      { key: 'pool', label: 'Chords', type: 'chips', choices: NUMERAL_CHOICES },
      {
        key: 'length', label: 'Chords per question', type: 'select', coerce: Number,
        choices: [[3, 'Three'], [4, 'Four'], [5, 'Five']],
      },
      { key: 'startTonic', label: 'First chord is the tonic', type: 'toggle' },
    ],
  },
  {
    id: 'melodies',
    title: 'Melodies',
    icon: '♪',
    color: 'fuchsia',
    kind: 'melody',
    itemPrefix: 'ml',   // item-stat keys: "ml:…"
    prompt: 'Play back the melody',
    howTo: 'A cadence sets the key, then a short melody plays. Play it back on the keyboard, in order.',
    blurb: 'Hear a short melody, then play it back on the keyboard. Dictation, made friendly.',
    tip: 'Don\'t memorise pitches — memorise the shape (up, down, leap, step) and where it lands relative to Do. Shape plus degrees equals the melody.',
    defaults: {
      degrees: ['do', 're', 'mi', 'fa', 'sol'], length: 4,
      upperDo: true, leapy: false, chromatic: 0, firstGiven: true,
    },
    options: [
      { key: 'degrees', label: 'Allowed notes', type: 'chips', choices: DEGREE_CHOICES },
      {
        key: 'length', label: 'Notes per melody', type: 'select', coerce: Number,
        choices: [[3, 'Three'], [4, 'Four'], [5, 'Five'], [6, 'Six'], [7, 'Seven']],
      },
      { key: 'firstGiven', label: 'Show the first note', type: 'toggle' },
      { key: 'upperDo', label: 'Allow the upper Do', type: 'toggle' },
      { key: 'leapy', label: 'Leap-heavy melodies', type: 'toggle' },
      { key: 'chromatic', label: 'Occasional chromatic notes', type: 'toggle' },
    ],
  },
  {
    id: 'reading',
    title: 'Sight Reading',
    icon: '♩',
    color: 'indigo',
    kind: 'reading',
    itemPrefix: 'sr',   // item-stat keys: "sr:…"
    prompt: 'Play what you see',
    howTo: 'Read the melody from the score and play it back on the keyboard, in order. Nothing plays unless you ask for it.',
    blurb: 'Read a short melody from the page and play it back. No listening — the notes are all on the staff.',
    tip: 'Read by interval, not by letter: find the first note, then measure each move from the one before. Hum the line in your head before you touch a key.',
    defaults: {
      notation: 'staff', notes: 8,
      rhythms: ['quarter', 'eighths'], playFirst: false, showNames: false,
    },
    options: [
      {
        key: 'notation', label: 'Notation', type: 'select',
        choices: [['staff', 'Staff'], ['tab', 'Guitar tab']],
      },
      {
        key: 'notes', label: 'Notes per melody', type: 'select', coerce: Number,
        choices: [[4, 'Four'], [6, 'Six'], [8, 'Eight'], [12, 'Twelve'], [16, 'Sixteen']],
      },
      {
        key: 'rhythms', label: 'Rhythms', type: 'chips',
        choices: [
          ['quarter', 'Quarter notes'],
          ['eighths', 'Two eighths'],
          ['dotted', 'Dotted quarter + eighth'],
          ['half', 'Half notes'],
        ],
      },
      { key: 'playFirst', label: 'Play the melody first', type: 'toggle' },
      { key: 'showNames', label: 'Show note names', type: 'toggle' },
    ],
  },
];

export const moduleById = id => MODULES.find(m => m.id === id);
