// notation.js — pure SVG engraving for sight reading: treble staff and guitar
// tab. Notes in, markup string out. No DOM, no app state, no network — so the
// layout (line positions, ledger lines, beams, fret numbers) can be asserted
// in node --test without a browser.
//
// Everything is engraved in C major: no accidentals are ever drawn, so a note's
// height on the staff follows its diatonic step exactly.

import { midiName } from './theory.js';
import { MUSIC_GLYPHS } from './music-glyphs.js';

// Geometry in SVG user units; the whole drawing is scaled by the viewBox.
export const GEOM = {
  lineGap: 10,     // px between staff lines
  step: 5,         // px per diatonic step — one staff space is two steps
  top: 40,         // y of the top staff line
  bottom: 80,      // y of the bottom staff line
  startX: 64,      // first note column; clef and time signature sit to its left
  beatW: 32,       // px per beat
  beats: 4,        // 4/4
  maxBarsPerSystem: 4,
  systemH: 112,
  stem: 35,        // 3.5 staff spaces, the engraving standard
  tabStem: 24,     // above the fret numbers, shorter than a staff stem
  headRx: 5.9,     // half the Bravura black-notehead width at lineGap 10
};

// Bravura (SMuFL) glyphs are drawn in font units where one staff space is 250
// units and y points up; render them with scale(s, -s) so the SVG y axis works.
const SPACE_UNITS = 250;
export const GLYPH_SCALE = GEOM.lineGap / SPACE_UNITS;
// The clef's origin is the bottom staff line; its spiral is then on the G line
// by design, so no hand tuning is needed.
export const CLEF = { x: 6, y: GEOM.bottom, scale: GLYPH_SCALE };
export const TIME_X = 36;
// Stems meet the notehead just inside its widest point.
const STEM_OFF = 5.6;

// Where a diatonic step lands vertically. E4 (step 30) is the bottom staff
// line, F5 (step 38) the top one; middle C (step 28) hangs one ledger below.
const BOTTOM_STEP = 30;
const TOP_STEP = 38;
const MIDDLE_Y = 60;      // the middle line, B4
export const stepY = step => GEOM.bottom - (step - BOTTOM_STEP) * GEOM.step;

// Letter index within the octave, naturals only.
const LETTER_OF_PC = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };

/** Diatonic position of a MIDI number (C4 = 28), or null for a black key. */
export function diatonicStep(midi) {
  const letter = LETTER_OF_PC[((midi % 12) + 12) % 12];
  if (letter === undefined) return null;
  return (Math.floor(midi / 12) - 1) * 7 + letter;
}

/** Vertical position of a note head on the treble staff. */
export function noteY(midi) {
  const step = diatonicStep(midi);
  return step === null ? null : stepY(step);
}

// ── Guitar tab: standard tuning, frets 0–4 ───────────────────────────────────

export const STANDARD_TUNING = [
  { string: 1, open: 64 },   // high E4
  { string: 2, open: 59 },   // B3
  { string: 3, open: 55 },   // G3
  { string: 4, open: 50 },   // D3
  { string: 5, open: 45 },   // A2
  { string: 6, open: 40 },   // low E2
];
export const TAB_MAX_FRET = 4;

/**
 * The (string, fret) a note is played at, or null when it is out of reach of
 * the first five frets. Preference: the lowest fret, then the higher-pitched
 * string — so every reachable note has exactly one written position.
 */
export function fretFor(midi) {
  const places = [];
  for (const s of STANDARD_TUNING) {
    const fret = midi - s.open;
    if (fret >= 0 && fret <= TAB_MAX_FRET) places.push({ string: s.string, fret });
  }
  if (!places.length) return null;
  places.sort((a, b) => a.fret - b.fret || a.string - b.string);
  return places[0];
}

/** y of one of the six tab lines (string 1 on top). */
export const tabLineY = string => GEOM.top + (string - 1) * 8;

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * Lay out a melody. `notes` is [{ midi, beats }] in reading order; `opts` is
 * { notation: 'staff' | 'tab', showNames, barsPerSystem }.
 *
 * `barsPerSystem` is the responsive knob: four bars on a wide screen, two on a
 * phone — the same music at a legible size instead of a shrunken four-bar line.
 * The last system may hold fewer bars (3 bars at 2 per system → 2 + 1); a
 * complete one-bar system is fine, only an incomplete *bar* is special.
 *
 * Returns geometry only — systems, staff/tab lines, barlines and one entry per
 * note (x, y, stem, beam group, ledger lines, fret) — so tests can assert
 * positions without parsing markup.
 */
export function layoutScore(notes, opts = {}) {
  const g = GEOM;
  const notation = opts.notation === 'tab' ? 'tab' : 'staff';
  const perSystem = Math.max(1, Math.floor(Number(opts.barsPerSystem) || g.maxBarsPerSystem));

  const starts = [];
  let total = 0;
  for (const n of notes) { starts.push(total); total += n.beats; }
  if (!notes.length) total = g.beats;
  const measures = Math.max(1, Math.ceil((total - 1e-9) / g.beats));

  const systems = [];
  for (let fromMeasure = 0; fromMeasure < measures; fromMeasure += perSystem) {
    const toMeasure = Math.min(measures, fromMeasure + perSystem);
    const fromBeat = fromMeasure * g.beats;
    const toBeat = Math.min(toMeasure * g.beats, total);
    // The closing barline sits a little before the last beat position, so a
    // note on the first beat of a measure never lands on the barline itself.
    const endX = g.startX + (toBeat - fromBeat) * g.beatW - 9;
    systems.push({
      index: systems.length,
      fromBeat,
      toBeat,
      bars: toMeasure - fromMeasure,
      top: g.top,
      bottom: g.bottom,
      endX,
      lines: [],
      barlines: [],
      width: endX + 8,
      height: g.systemH,
    });
  }

  // Lines and barlines, per system.
  for (const sys of systems) {
    // Tab lines start to the right of the "TAB" label; the staff runs the full
    // width so the clef sits on its lines.
    const x1 = notation === 'tab' ? 30 : 6;
    const x2 = sys.endX + 1;
    const lineYs = notation === 'tab'
      ? [0, 1, 2, 3, 4, 5].map(i => g.top + i * 8)
      : [0, 1, 2, 3, 4].map(i => g.top + i * g.lineGap);
    sys.lines = lineYs.map(y => ({ y, x1, x2 }));

    // Interior barlines at each measure boundary inside this system, plus the
    // closing barline (which may fall inside an incomplete last measure).
    const bounds = [];
    for (let beat = (Math.floor(sys.fromBeat / g.beats) + 1) * g.beats; beat < sys.toBeat; beat += g.beats) {
      bounds.push({ beat, final: false });
    }
    bounds.push({ beat: sys.toBeat, final: true });
    sys.barlines = bounds.map(b => ({
      x: b.final ? sys.endX : g.startX + (b.beat - sys.fromBeat) * g.beatW - 9,
      final: b.final,
    }));
  }

  const systemOfBeat = beat => systems.find(s => beat < s.toBeat - 1e-9) ?? systems[systems.length - 1];

  const out = notes.map((n, i) => {
    const beat = starts[i];
    const sys = systemOfBeat(beat);
    const x = g.startX + (beat - sys.fromBeat) * g.beatW;
    const entry = {
      index: i,
      midi: n.midi,
      beats: n.beats,
      beat,
      system: sys.index,
      x,
      name: midiName(n.midi),
      y: null,
      string: null,
      fret: null,
      ledgers: [],
      stem: 'up',
      beam: null,
      flag: false,
    };
    if (notation === 'tab') {
      const place = fretFor(n.midi);
      entry.string = place?.string ?? null;
      entry.fret = place?.fret ?? null;
      entry.y = place ? tabLineY(place.string) : g.top + 2 * 8;
    } else {
      const step = diatonicStep(n.midi);
      entry.step = step;
      entry.y = noteY(n.midi);
      if (step < BOTTOM_STEP) {
        for (let s = 28; s >= step; s -= 2) entry.ledgers.push(stepY(s));
      } else if (step > TOP_STEP) {
        for (let s = 40; s <= step; s += 2) entry.ledgers.push(stepY(s));
      }
      entry.stem = entry.y >= MIDDLE_Y ? 'up' : 'down';
    }
    return entry;
  });

  // Beams: consecutive eighth notes that share a beat are joined by one beam;
  // a lone eighth gets a flag. Tab always stems up, the staff follows the
  // middle line (or the group's average height).
  const groups = [];
  for (let i = 0; i < out.length;) {
    const a = out[i];
    const b = out[i + 1];
    const pair = a.beats === 0.5 && b && b.beats === 0.5
      && a.system === b.system && Math.floor(a.beat) === Math.floor(b.beat);
    if (pair) {
      const group = { notes: [a, b], index: groups.length };
      groups.push(group);
      a.beam = group.index;
      b.beam = group.index;
      // The staff picks its direction from the group's height; tab always
      // stems up, above the fret numbers.
      const dir = notation === 'tab' ? 'up'
        : (a.y + b.y) / 2 >= MIDDLE_Y ? 'up' : 'down';
      const beamY = dir === 'up'
        ? Math.min(a.y, b.y) - GEOM.stem
        : Math.max(a.y, b.y) + GEOM.stem;
      group.dir = dir;
      group.y = beamY;
      const off = dir === 'up' ? STEM_OFF : -STEM_OFF;
      group.x1 = a.x + off;
      group.x2 = b.x + off;
      i += 2;
    } else {
      if (a.beats === 0.5) a.flag = true;
      i += 1;
    }
  }

  for (const n of out) {
    if (n.beam !== null) {
      n.stemDir = groups[n.beam].dir;
      n.stemY = groups[n.beam].y;
    } else {
      // Tab stems reach a little higher so the rhythm reads above the numbers.
      const len = notation === 'tab' ? GEOM.tabStem : GEOM.stem;
      const dir = notation === 'tab' ? 'up' : n.stem;
      n.stemDir = dir;
      n.stemY = dir === 'up' ? n.y - len : n.y + len;
    }
  }

  return {
    notation,
    notes: out,
    systems,
    groups,
    width: Math.max(...systems.map(s => s.width)),
    height: systems.length * GEOM.systemH,
    totalBeats: total,
    measures,
    showNames: !!opts.showNames,
  };
}

// ── Markup ───────────────────────────────────────────────────────────────────

// Scores are drawn at one comfortable width whatever their beat count, so a
// one-bar melody is not tiny and an eight-bar one is not a wall.
export const SCORE_MAX_W = 340;

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// One SMuFL glyph as a filled path. `x`/`y` are the glyph origin in SVG units.
function glyph(name, x, y, cls, attrs = '', scale = GLYPH_SCALE) {
  const g = MUSIC_GLYPHS[name];
  return `<path class="${cls}"${attrs} d="${g.path}" fill="currentColor"`
    + ` transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale} ${-scale})"/>`;
}

function noteHead(n) {
  const half = n.beats >= 2;
  const name = half ? 'noteheadHalf' : 'noteheadBlack';
  const g = MUSIC_GLYPHS[name];
  return glyph(name, n.x - (g.adv / 2) * GLYPH_SCALE, n.y, 'st-head',
    ` data-glyph="${half ? 'half' : 'black'}"`);
}

function staffSystem(sys, layout, sysTop) {
  const g = GEOM;
  const parts = [];
  parts.push(`<g class="st-system" data-system="${sys.index}" transform="translate(0 ${sysTop})">`);
  for (const l of sys.lines) {
    parts.push(`<line class="st-line" data-role="staff-line" x1="${l.x1}" y1="${l.y}" x2="${l.x2}" y2="${l.y}"`
      + ` stroke="currentColor" stroke-width="1"/>`);
  }
  // Clef and time signature, both real SMuFL glyphs: the clef sits with its
  // origin on the bottom line (spiral on G), the two 4s are centred on the
  // upper and lower halves of the staff.
  if (layout.notation === 'staff') {
    parts.push(glyph('gClef', CLEF.x, CLEF.y, 'st-clef'));
    parts.push(glyph('timeSig4', TIME_X, 70, 'st-time'));
    parts.push(glyph('timeSig4', TIME_X, 50, 'st-time'));
  }

  for (const b of sys.barlines) {
    parts.push(`<line class="st-bar${b.final ? ' final' : ''}" data-role="barline" x1="${b.x}" y1="${g.top}"`
      + ` x2="${b.x}" y2="${g.bottom}" stroke="currentColor" stroke-width="${b.final ? 2.6 : 1.2}"/>`);
  }

  // Beams first, so note heads and stems sit on top.
  for (const grp of layout.groups) {
    if (grp.notes[0].system !== sys.index) continue;
    parts.push(`<line class="st-beam" data-role="beam" x1="${grp.x1}" y1="${grp.y}" x2="${grp.x2}" y2="${grp.y}"`
      + ` stroke="currentColor" stroke-width="4.6"/>`);
  }

  for (const n of layout.notes) {
    if (n.system !== sys.index) continue;
    parts.push(`<g class="snote" data-note="${n.index}" data-midi="${n.midi}">`);
    for (const y of n.ledgers) {
      parts.push(`<line class="st-ledger" data-role="ledger" x1="${n.x - 8}" y1="${y}" x2="${n.x + 8}" y2="${y}" stroke="currentColor" stroke-width="1.4"/>`);
    }
    if (layout.notation === 'tab') {
      const g2 = GEOM;
      const y = n.y;
      parts.push(`<text class="st-fret" data-role="fret" x="${n.x}" y="${y + 3.4}" font-size="10.5"`
        + ` font-weight="700" text-anchor="middle" fill="currentColor">${n.fret ?? '·'}</text>`);
      if (n.stemDir === 'up') {
        parts.push(`<line class="st-stem" data-role="stem" x1="${n.x + 4.2}" y1="${y - 1.5}" x2="${n.x + 4.2}" y2="${n.stemY}" stroke="currentColor" stroke-width="1.4"/>`);
      }
      if (n.beam === null && n.beats === 0.5) {
        parts.push(glyph('flag8thUp', n.x + 4.2, n.stemY, 'st-flag', ' data-role="flag"'));
      }
      if (layout.showNames) {
        parts.push(`<text class="st-name" x="${n.x}" y="${g2.bottom + 16}" font-size="8.5" text-anchor="middle" fill="currentColor">${esc(n.name)}</text>`);
      }
    } else {
      const y = n.y;
      parts.push(noteHead(n));
      if (n.stemDir === 'up') {
        parts.push(`<line class="st-stem" data-role="stem" x1="${n.x + STEM_OFF}" y1="${y}" x2="${n.x + STEM_OFF}" y2="${n.stemY}" stroke="currentColor" stroke-width="1.4"/>`);
      } else {
        parts.push(`<line class="st-stem" data-role="stem" x1="${n.x - STEM_OFF}" y1="${y}" x2="${n.x - STEM_OFF}" y2="${n.stemY}" stroke="currentColor" stroke-width="1.4"/>`);
      }
      if (n.flag) {
        const flag = n.stemDir === 'up' ? 'flag8thUp' : 'flag8thDown';
        const off = n.stemDir === 'up' ? STEM_OFF : -STEM_OFF;
        parts.push(glyph(flag, n.x + off, n.stemY, 'st-flag', ' data-role="flag"'));
      }
      if (n.beats === 1.5) {
        // The dot glyph is centred on its own origin.
        parts.push(glyph('augmentationDot', n.x + 9.5, y, 'st-dot'));
      }
      if (layout.showNames) {
        parts.push(`<text class="st-name" x="${n.x}" y="102" font-size="8.5" text-anchor="middle" fill="currentColor">${esc(n.name)}</text>`);
      }
    }
    parts.push('</g>');
  }

  if (layout.notation === 'tab') {
    parts.push(`<text class="st-tab-label" x="8" y="63" font-size="10.5" font-weight="700"`
      + ` letter-spacing="1.5" fill="currentColor">TAB</text>`);
    // Time signature above the six lines: inside them it reads as a fret number.
    parts.push(`<text class="st-time" x="46" y="32" font-size="11" font-weight="700" fill="currentColor">4/4</text>`);
  }

  parts.push('</g>');
  return parts.join('');
}

/**
 * Render one melody to standalone SVG markup. `opts`:
 *   notation: 'staff' | 'tab'
 *   barsPerSystem: bars per line (default 4; phones use 2)
 *   showNames: label every note with its name
 *   title / desc: accessible text (already localised by the caller)
 */
export function renderScore(notes, opts = {}) {
  const layout = layoutScore(notes, opts);
  const staff = layout.notation === 'staff';
  const title = opts.title ?? `C major melody, ${notes.length} notes, ${staff ? 'treble staff' : 'guitar tab'}`;
  const desc = opts.desc ?? (staff
    ? 'A short melody written on the treble staff. Play it back on the keyboard in order.'
    : 'A short melody written in guitar tablature. Play it back on the keyboard in order.');

  const body = layout.systems
    .map(sys => staffSystem(sys, layout, sys.index * GEOM.systemH))
    .join('');

  return `<svg class="score-svg score-${layout.notation}" xmlns="http://www.w3.org/2000/svg"`
    + ` viewBox="0 0 ${layout.width} ${layout.height}" width="100%"`
    + ` style="max-width:${Math.max(SCORE_MAX_W, layout.width)}px" role="img" aria-label="${esc(title)}">`
    + `<title>${esc(title)}</title><desc>${esc(desc)}</desc>`
    + body
    + '</svg>';
}
