// options.js — the practice page's Options panel.
//
// A config-driven form over the option descriptors in curriculum.js: chips
// (multi-select pools), selects, toggles and numeric ranges. Every edit writes
// through State.setExerciseOption(), so the next question uses the new pool and
// the choice survives a reload.

import { h } from './ui.js';
import * as State from './state.js';

// Builds the collapsed <details> panel for one exercise. `onChange` fires after
// every edit so the session can redraw its next question.
export function renderOptions(mod, onChange) {
  const cfg = State.moduleConfig(mod.id);
  const body = h('div', { class: 'options-body' });

  for (const opt of mod.options) {
    body.append(control(opt, cfg[opt.key], v => {
      State.setExerciseOption(mod.id, opt.key, v);
      onChange();
    }));
  }

  body.append(h('div', { class: 'options-reset' },
    h('button', {
      class: 'btn small ghost',
      onclick: () => { State.resetExercise(mod.id); onChange(); },
    }, 'Reset to defaults')));

  return h('details', { class: 'options' },
    h('summary', {}, 'Options'),
    body);
}

function control(opt, value, set) {
  if (opt.type === 'toggle') return row(opt.label, toggle(value, set));
  if (opt.type === 'select') return row(opt.label, select(opt, value, set));
  if (opt.type === 'range') return row(opt.label, range(opt, value, set));
  return row(opt.label, chips(opt, value, set));
}

function row(label, control) {
  return h('div', { class: 'card setting-row' },
    h('div', { class: 'set-main' }, h('div', { class: 'set-label' }, label)),
    control);
}

function toggle(value, set) {
  const btn = h('button', {
    class: 'toggle' + (value ? ' on' : ''),
    role: 'switch', 'aria-checked': String(value),
    onclick: () => { set(!value); },
  }, h('span', { class: 'knob' }));
  return btn;
}

function select(opt, value, set) {
  return h('select', {
    class: 'select',
    onchange: e => set(opt.coerce ? opt.coerce(e.target.value) : e.target.value),
  },
    opt.choices.map(([v, label]) =>
      h('option', { value: String(v), ...(v === value ? { selected: '' } : {}) }, label)));
}

function range(opt, value, set) {
  const clamp = n => Math.max(opt.min, Math.min(opt.max, n));
  const input = (which, n) => h('input', {
    type: 'number', class: 'num', min: String(opt.min), max: String(opt.max), step: String(opt.step),
    value: String(n),
    onchange: e => {
      const next = [...value];
      next[which] = clamp(Number(e.target.value) || opt.min);
      // Keep the pair ordered: a low above the high (or vice versa) is a typo.
      if (next[0] > next[1]) next.sort((a, b) => a - b);
      set(next);
    },
  });
  return h('div', { class: 'range-pair' }, input(0, value[0]), ' – ', input(1, value[1]));
}

function chips(opt, value, set) {
  const selected = new Set(value);
  const wrap = h('div', { class: 'chip-wrap' });
  for (const [id, label] of opt.choices) {
    const on = selected.has(id);
    const btn = h('button', {
      class: 'chip' + (on ? ' on' : ''),
      onclick: () => {
        if (on && selected.size <= 1) return;   // never leave an empty pool
        if (on) selected.delete(id); else selected.add(id);
        set([...selected]);
      },
    }, label);
    wrap.append(btn);
  }
  return wrap;
}
