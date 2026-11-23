// voice-intent-zh.js — the Chinese half of the transcript parser.
//
// Chinese has no word boundaries and Vosk's zh model ships no word list, so
// matching works on a whitespace-free string, the recogniser runs without a
// grammar (plain language model), and the matcher accepts names, spoken
// numbers and four commands.

import { INTERVALS, CHORDS, SCALES, DEGREES } from './theory.js';
import { THEORY_ZH } from './i18n.zh.js';

const DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const NUMBER = '[零〇一二两三四五六七八九十百\\d]+';

const COMMANDS = [
  { name: 'stop', phrases: ['停止监听', '关闭语音', '关掉语音', '退出语音', '关语音', '停止'] },
  { name: 'names', phrases: ['说出答案', '报答案', '念答案', '说答案', '读答案', '告诉我', '答案是什么'] },
  { name: 'next', phrases: ['下一题', '下一个', '换一题', '跳过', '继续'] },
  { name: 'replay', phrases: ['再放一遍', '再放一次', '再来一次', '重播', '重复', '播放', '再播'] },
];

export function commandPhrasesForZh() {
  const out = {};
  for (const c of COMMANDS) out[c.name] = [...c.phrases];
  return out;
}

export function aliasesForZh(moduleId, id) {
  return aliases(moduleId, id);
}

const PITCH = {
  up: ['更高', '高', '上升', '升高'],
  down: ['更低', '低', '下降', '降低'],
  same: ['相同', '一样', '不变', '同样'],
};

const NOTES = {
  0: ['c'], 1: ['升c', '降d'], 2: ['d'], 3: ['降e', '升d'], 4: ['e'], 5: ['f'],
  6: ['升f', '降g'], 7: ['g'], 8: ['降a', '升g'], 9: ['a'], 10: ['降b', '升a'], 11: ['b'],
};

const SOLFEGE = { do: '哆', re: '来', mi: '咪', fa: '发', sol: '索', la: '拉', ti: '西' };
const DEGREE_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function zhNumber(text) {
  const s = String(text ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let num = 0;
  for (const ch of s) {
    if (ch === '十') { total += (num || 1) * 10; num = 0; }
    else if (ch === '百') { total += (num || 1) * 100; num = 0; }
    else if (ch in DIGITS) num = DIGITS[ch];
    else return null;
  }
  return total + num;
}

function normalizeZh(text) {
  let s = String(text ?? '').toLowerCase();
  s = s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/♯/g, '升').replace(/#/g, '升').replace(/♭/g, '降');
  s = s.replace(/[，。！？、；：""''（）【】《》〈〉,\.!\?;:'"()\[\]{}·•\-—…\s]/g, '');
  // Speech that wraps the answer: "我觉得是纯五度" / "答案是第三".
  s = s.replace(/(我觉得|应该是|答案是|我选|选择|请|谢谢|一点|一些|点儿|稍微|吧|呢|啊)/g, '');
  // Typical recogniser slips inside this vocabulary.
  s = s.replace(/合弦/g, '和弦').replace(/唇/g, '纯');
  return s;
}

function aliases(moduleId, id) {
  const out = [];
  switch (moduleId) {
    case 'pitch':
      out.push(...(PITCH[id] ?? []));
      break;
    case 'absolute':
      out.push(...(NOTES[Number(id)] ?? []));
      break;
    case 'intervals': {
      const zh = THEORY_ZH.intervals[id];
      if (zh) out.push(zh);
      break;
    }
    case 'chords': {
      const zh = THEORY_ZH.chords[id];
      if (!zh) break;
      out.push(zh);
      const inv = zh.match(/^(.+?)（第([一二三])转位）$/);
      if (inv) {
        out.push(`${inv[1]}第${inv[2]}转位`);
        out.push(`第${inv[2]}转位${inv[1]}`);
      }
      break;
    }
    case 'scales': {
      const zh = THEORY_ZH.scales[id];
      if (zh) out.push(zh);
      break;
    }
    case 'degrees': {
      const deg = DEGREES[id];
      if (!deg) break;
      out.push(deg.number
        .replace('♭', '降').replace('♯', '升')
        .replace(/(\d)/, d => `${DEGREE_NUM[Number(d)]}级`));
      if (!/[♭♯]/.test(deg.number)) {
        if (SOLFEGE[id]) out.push(SOLFEGE[id]);
        out.push(id);                       // Latin do/re/mi for mixed speech
      }
      break;
    }
    default:
      break;
  }
  return [...new Set(out.map(normalizeZh).filter(Boolean))];
}

function aliasMap(ctx) {
  const map = new Map();
  for (const opt of ctx.options ?? []) {
    for (const alias of aliases(ctx.moduleId, opt.id)) {
      if (!map.has(alias)) map.set(alias, new Set());
      map.get(alias).add(opt.id);
    }
  }
  return map;
}

function explicitIndex(norm, count) {
  let m = norm.match(new RegExp(`(?:选项|第)(${NUMBER})(?:个|项|号)?$`));
  if (!m) m = norm.match(new RegExp(`(${NUMBER})号$`));
  if (!m) return null;
  const n = zhNumber(m[1]);
  return n !== null && n >= 1 && n <= count ? n : null;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

export function parseIntentZh(transcript, ctx = {}) {
  const heard = String(transcript ?? '').trim();
  const norm = normalizeZh(heard);
  if (!norm) return { type: 'none', reason: 'empty', heard };

  for (const cmd of COMMANDS) {
    if (cmd.phrases.some(p => norm.includes(p))) {
      return { type: 'command', name: cmd.name, heard };
    }
  }

  const options = ctx.options ?? [];
  if (!options.length) return { type: 'none', reason: 'no-options', heard };

  const idx = explicitIndex(norm, options.length);
  if (idx !== null) {
    return { type: 'answer', via: 'index', id: options[idx - 1].id, index: idx, score: 1, heard };
  }

  const map = aliasMap(ctx);
  const exact = map.get(norm);
  if (exact && exact.size === 1) {
    const id = [...exact][0];
    return { type: 'answer', via: 'name', id, index: options.findIndex(o => o.id === id), score: 1, heard };
  }

  // Substring matching is what makes "五度" work for "纯五度" and ignores
  // extra words around the answer. Single characters are left to the number
  // path so "三" means button 3, not every name containing 三.
  if (norm.length >= 2) {
    const contained = new Map();
    for (const [alias, ids] of map) {
      if (alias.length < 2) continue;
      if (!(norm.includes(alias) || alias.includes(norm))) continue;
      const score = Math.min(norm.length, alias.length) / Math.max(norm.length, alias.length);
      for (const id of ids) contained.set(id, Math.max(contained.get(id) ?? 0, score));
    }
    if (contained.size) {
      const ranked = [...contained.entries()].sort((a, b) => b[1] - a[1]);
      if (contained.size === 1 || ranked[0][1] - (ranked[1][1] ?? 0) >= 0.15) {
        const [id, score] = ranked[0];
        return { type: 'answer', via: 'name', id, index: options.findIndex(o => o.id === id), score, heard };
      }
      return { type: 'none', reason: 'ambiguous', heard };
    }
  }

  const bare = new RegExp(`^${NUMBER}$`).test(norm) ? zhNumber(norm) : null;
  if (bare !== null && bare >= 1 && bare <= options.length) {
    return { type: 'answer', via: 'index', id: options[bare - 1].id, index: bare, score: 1, heard };
  }

  if (norm.length >= 3) {
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
    if (best.id !== null && best.score >= 0.7 && best.score - second >= 0.05) {
      return {
        type: 'answer', via: 'fuzzy', id: best.id,
        index: options.findIndex(o => o.id === best.id),
        score: best.score, heard,
      };
    }
  }

  return { type: 'none', reason: 'no-match', heard };
}
