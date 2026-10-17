// options.js — the practice page's Options panel.
//
// A config-driven form over the option descriptors in curriculum.js: chips
// (multi-select pools), selects, toggles and numeric ranges. Every edit writes
// through State.setExerciseOption() and then redraws the panel from the stored
// config, so a control's visual state can never drift from what is actually
// enabled (and the next question uses the new pool).

import { h } from './ui.js';
import * as State from './state.js';
import { midiName, nameToMidi } from './theory.js';

// Builds the collapsed <details> panel for one exercise. `onChange` fires after
// every edit so the session can redraw its next question.
export function renderOptions(mod, onChange) {
  const details = h('details', { class: 'options' }, h('summary', {}, 'Options'));
  const body = h('div', { class: 'options-body' });
  details.append(body);

  // Redraw every control from the stored configuration. Rebuilding (rather
  // than patching classes by hand) keeps chips, toggles, selects and ranges
  // honest after any edit, including "Reset to defaults".
  const draw = () => {
    body.innerHTML = '';
    for (const opt of mod.options) {
      body.append(control(mod, opt, v => {
        State.setExerciseOption(mod.id, opt.key, v);
        draw();
        onChange();
      }));
    }
    body.append(h('div', { class: 'options-reset' },
      h('button', {
        class: 'btn small ghost',
        onclick: () => { State.resetExercise(mod.id); draw(); onChange(); },
      }, 'Reset to defaults')));
  };

  draw();
  return details;
}

// Always read the live value — never a value captured when the panel was built.
const current = (mod, opt) => State.moduleConfig(mod.id)[opt.key];

function control(mod, opt, set) {
  if (opt.type === 'toggle') return row(opt.label, toggle(mod, opt, set));
  if (opt.type === 'select') return row(opt.label, select(mod, opt, set));
  if (opt.type === 'range') return row(opt.label, range(mod, opt, set));
  return row(opt.label, chips(mod, opt, set));
}

function row(label, control) {
  return h('div', { class: 'card setting-row' },
    h('div', { class: 'set-main' }, h('div', { class: 'set-label' }, label)),
    control);
}

function toggle(mod, opt, set) {
  const on = !!current(mod, opt);
  const btn = h('button', {
    class: 'toggle' + (on ? ' on' : ''),
    role: 'switch', 'aria-checked': String(on),
    onclick: () => set(!current(mod, opt)),
  }, h('span', { class: 'knob' }));
  return btn;
}

function select(mod, opt, set) {
  const value = current(mod, opt);
  return h('select', {
    class: 'select',
    onchange: e => set(opt.coerce ? opt.coerce(e.target.value) : e.target.value),
  },
    opt.choices.map(([v, label]) =>
      h('option', { value: String(v), ...(v === value ? { selected: '' } : {}) }, label)));
}

// Two numbers. `format: 'pitch'` shows them as note names (C3 – C5) rather
// than raw MIDI numbers — the stored value stays MIDI either way.
function range(mod, opt, set) {
  const clamp = n => Math.max(opt.min, Math.min(opt.max, n));
  const isPitch = opt.format === 'pitch';
  const show = n => (isPitch ? midiName(n) : String(n));
  const parse = text => {
    const v = isPitch ? nameToMidi(text) : Number(text);
    return Number.isFinite(v) ? Math.round(v) : null;
  };
  const inputs = [];
  const input = which => h('input', {
    type: isPitch ? 'text' : 'number',
    class: 'num' + (isPitch ? ' note' : ''),
    ...(isPitch ? { inputmode: 'text', placeholder: midiName(opt.min) } : {
      min: String(opt.min), max: String(opt.max), step: String(opt.step),
    }),
    value: show(current(mod, opt)[which]),
    onchange: e => {
      const parsed = parse(e.target.value);
      if (parsed === null) {                 // not a note / not a number: undo
        e.target.value = show(current(mod, opt)[which]);
        return;
      }
      const next = [...current(mod, opt)];
      next[which] = clamp(parsed);
      // Keep the pair ordered: a low above the high (or vice versa) is a typo.
      if (next[0] > next[1]) next.sort((a, b) => a - b);
      set(next);
      // Reflect any correction straight back into both boxes.
      inputs.forEach((el, i) => { el.value = show(next[i]); });
    },
  });
  inputs.push(input(0), input(1));
  return h('div', { class: 'range-pair' }, inputs[0], ' – ', inputs[1]);
}

function chips(mod, opt, set) {
  const selected = new Set(current(mod, opt));
  const wrap = h('div', { class: 'chip-wrap' });
  for (const [id, label] of opt.choices) {
    wrap.append(h('button', {
      class: 'chip' + (selected.has(id) ? ' on' : ''),
      onclick: () => {
        const now = new Set(current(mod, opt));
        if (now.has(id) && now.size <= 1) return;   // never leave an empty pool
        if (now.has(id)) now.delete(id); else now.add(id);
        set([...now]);
      },
    }, label));
  }
  return wrap;
}
