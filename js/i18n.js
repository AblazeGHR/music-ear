// i18n.js — runtime localisation for a no-build static app.
//
// The English copy is the source of truth and stays in the components. In
// Chinese mode every rendered text node / label / placeholder is looked up in
// the generated dictionary (js/i18n.zh.js); a missing key falls back to the
// English string instead of breaking the page. Dynamic sentences are matched
// against the small template table from the translator (e.g. "It was {answer}
// — you chose {picked}.").
//
// Android lean builds pass ?lang=zh|en, which locks the language: the switch
// in Settings is hidden there.

import { ZH, ZH_TEMPLATES, THEORY_ZH } from './i18n.zh.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'SVG']);
const ATTRS = ['title', 'aria-label', 'placeholder'];

let current = 'en';
let fixed = null;
let observer = null;
let scheduled = false;
let pending = new Set();

const TEMPLATES = Object.entries(ZH_TEMPLATES).map(([english, chinese]) => {
  const names = [];
  const pattern = english
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{(\w+)\\\}/g, (_, name) => { names.push(name); return '([\\s\\S]*?)'; });
  return { re: new RegExp(`^${pattern}$`), chinese, names };
});
TEMPLATES.sort((a, b) => b.re.length - a.re.length);

export function initLanguage(stored) {
  const param = new URLSearchParams(location.search).get('lang');
  fixed = param === 'zh' || param === 'en' ? param : null;
  current = fixed ?? (stored === 'zh' ? 'zh' : 'en');
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';

  if (current === 'zh') {
    document.title = translate(document.title) ?? document.title;
    install();
  }
}

export function language() { return current; }
export function isLanguageFixed() { return fixed !== null; }

const PITCH_ZH = { up: '更高', down: '更低', same: '相同' };

/** Chinese display name for an answer id; falls back in English mode. */
export function theoryName(moduleId, id, fallback) {
  if (current !== 'zh') return fallback;
  if (moduleId === 'pitch') return PITCH_ZH[id] ?? fallback;
  const table = THEORY_ZH[moduleId];
  return table?.[id] ?? fallback;
}

/** Exact dictionary lookup, preserving surrounding whitespace. */
export function t(text) {
  if (current !== 'zh' || !text) return text;
  const direct = ZH[text];
  if (direct) return direct;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const hit = ZH[m[2]];
  return hit ? `${m[1]}${hit}${m[3]}` : text;
}

/** Template-aware lookup for a complete sentence. */
export function translate(text) {
  if (current !== 'zh' || !text) return text;
  const direct = t(text);
  if (direct !== text) return direct;

  const core = text.trim();
  for (const { re, chinese, names } of TEMPLATES) {
    const m = core.match(re);
    if (!m) continue;
    const values = {};
    names.forEach((name, i) => { values[name] = t(m[i + 1]); });
    return chinese.replace(/\{(\w+)\}/g, (whole, name) =>
      (name in values ? values[name] : whole));
  }
  return text;
}

// ── DOM scanning ─────────────────────────────────────────────────────────────

function install() {
  if (observer) return;
  observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') pending.add(record.target);
      else if (record.type === 'attributes') pending.add(record.target);
      else record.addedNodes.forEach(collect);
    }
    schedule();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
  collect(document.body);
  schedule();
}

export function refresh(root = document.body) {
  collect(root);
  schedule();
}

function collect(node) {
  if (node.nodeType === Node.TEXT_NODE) { pending.add(node); return; }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  pending.add(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.ELEMENT_NODE) pending.add(n);
    else pending.add(n);
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const batch = pending;
    pending = new Set();
    for (const node of batch) apply(node);
  }, 0);
}

function skipped(el) {
  if (!el) return false;
  if (el.closest?.('[data-no-i18n]')) return true;
  return SKIP_TAGS.has(el.tagName);
}

function apply(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (skipped(node.parentElement)) return;
    const next = translate(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (skipped(node)) return;
  for (const attr of ATTRS) {
    if (!node.hasAttribute(attr)) continue;
    const value = node.getAttribute(attr);
    const next = translate(value);
    if (next !== value) node.setAttribute(attr, next);
  }
}
