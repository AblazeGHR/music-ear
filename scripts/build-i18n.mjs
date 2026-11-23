// scripts/build-i18n.mjs — turn the translator's JSON output into a JS module.
//
// Sources: .cache/i18n/zh-ui.json, zh-templates.json, zh-content.json
// Output:  js/i18n.zh.js   — generated, do not edit by hand
//
// The content file is keyed by registry ids; the English side is read from the
// real curriculum/theory modules so option labels and exercise copy line up
// exactly with what the renderer produces.
//
// Run:  node scripts/build-i18n.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES } from '../js/curriculum.js';
import { INTERVALS, CHORDS, SCALES, NUMERALS } from '../js/theory.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, '.cache', 'i18n');
const OUT = join(ROOT, 'js', 'i18n.zh.js');

const read = name => {
  const file = join(SRC, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

const ui = read('zh-ui.json');
const templates = read('zh-templates.json');
const content = read('zh-content.json');

// Strings introduced by the language switch itself.
const EXTRA = {
  'Language': '语言',
  'Interface and answer language.': '界面与答案语言。',
  'This build is locked to one language.': '此版本已锁定为单一语言。',
  // Voice-mode copy changed when Chinese commands and option auditions landed.
  'Listening — say an option name, a number, or “replay”':
    '正在聆听——说选项名、数字，或“重播”',
  'Play the question first — say “replay”': '请先播放题目——说“重播”',
  'Tap any option (or say its name) to hear it.': '点按或说出任意选项即可试听。',
  'Tap ×N = option N (after a miss: play it) · Swipe = next · Hold = off · Circle = replay · 2 circles = names':
    '点击 ×N = 第 N 个选项（答错后试听该选项）· 划直线 = 下一题 · 长按 = 关闭 · 画圈 = 重播 · 画两圈 = 报答案名',
  'the Nth answer button — a tick plays on every tap so you can count with your eyes closed. After a miss it plays that option instead':
    '第 N 个答案按钮——每次点击都有提示音，闭眼也能数；答错后改为播放该选项',
  'Gesture mode': '手势模式',
  'Tap counting: tap N times. Hold to count: hold still and release after N ticks.':
    '连击计数：点 N 下选第 N 项。长按计数：按住不动，松手时响了几声就是第几项。',
  'Tap counting': '连击计数',
  'Hold to count': '长按计数',
  'Tap counting only: how long the app waits for another tap before taking your answer, in milliseconds — shorter means quicker feedback. 250 is quick, 350 normal, 550 relaxed. Applies from the next exercise you open.':
    '仅连击计数：两次点击之间最多等多久（毫秒），越短反馈越快。250 快、350 正常、550 从容。从下一个打开的练习生效。',
  'Hold repeat interval': '长按重复间隔',
  'Hold to count only: one tick every this many milliseconds (200–2000); N ticks = option N. Applies from the next exercise you open.':
    '仅长按计数：每多少毫秒响一声（200–2000），响 N 声 = 第 N 项。从下一个打开的练习生效。',
  'Gesture mode · hold to count': '手势模式 · 长按计数',
  'Gesture mode · tap to count': '手势模式 · 连击计数',
  'Press and hold: a tick every {ms} ms, release after N ticks to pick option N.':
    '按住不动：每 {ms} 毫秒响一声，松手时响了几声就选第几项。',
  'Hold still': '按住不动',
  'one tick per interval — release after N ticks to pick option N; after a miss it plays that option':
    '每隔一个间隔响一声——松手时响 N 声就选第 N 项；答错后改为播放该选项',
  'Tap three times': '连按三下',
  'Background reliability': '后台运行',
  'Allow the app to keep running while the screen is off.':
    '允许应用在锁屏后继续运行；国产手机还需要在系统设置里关闭自动管理。',
  'Allow': '去允许',
  // Sight reading (v0.17.0) — the ninth exercise.
  'Sight Reading': '视奏',
  'Play what you see': '看谱弹出旋律',
  'Read the melody from the score and play it back on the keyboard, in order. No reference sound by default — turn on “Play the melody first” in Options, or hear the answer after you play.':
    '照着谱面读出旋律，在琴键上按顺序弹出。默认不播放参考音；可在选项里打开“先播放参考旋律”，作答后可听正确答案。',
  'Read a short melody from the page and play it back. No listening — the notes are all on the page.':
    '看一小段乐谱，把旋律弹出来。不靠听力——所有音符都写在谱面上。',
  'Read by interval, not by letter: find the first note, then measure each move from the one before. Hum the line in your head before you touch a key.':
    '用音程读谱，而不是逐个认字母：先找到第一个音，再看每个音与上一个音的距离。落键前先在脑子里哼一遍。',
  'Notation': '记谱方式',
  'Staff': '五线谱',
  'Guitar tab': '六线谱',
  'Notes per melody': '每题音符数',
  'Four': '4 个',
  'Six': '6 个',
  'Eight': '8 个',
  'Twelve': '12 个',
  'Sixteen': '16 个',
  'Rhythms': '节奏型',
  'Quarter notes': '四分音符',
  'Two eighths': '两个八分音符',
  'Dotted quarter + eighth': '附点四分音符 + 八分音符',
  'Half notes': '二分音符',
  'Play the melody first': '先播放参考旋律',
  'Show note names': '显示音名',
  '▶ Hear the answer': '▶ 听正确答案',
  'R replay · ⏎ next · ⌫ undo': 'R 重播 · ⏎ 下一题 · ⌫ 撤销',
  'treble staff': '五线谱（高音谱号）',
  'guitar tab': '六线谱',
  'A short melody written on the page. Play it back on the keyboard, in order.':
    '谱面上的短旋律，请在琴键上按顺序弹出。',
};

const flat = { ...ui, ...EXTRA };

const zhField = (entry, key) => entry?.[`${key}Zh`] ?? entry?.[key];

for (const mod of MODULES) {
  const zh = content.modules?.[mod.id];
  if (!zh) continue;
  for (const key of ['title', 'prompt', 'howTo', 'blurb', 'tip']) {
    const english = mod[key];
    const chinese = zhField(zh, key);
    if (english && chinese) flat[english] = chinese;
  }
}

const theoryZh = { intervals: {}, chords: {}, scales: {}, numerals: {} };
const tables = [
  ['intervals', INTERVALS, content.theory?.intervals],
  ['chords', CHORDS, content.theory?.chords],
  ['scales', SCALES, content.theory?.scales],
  ['numerals', NUMERALS, content.theory?.numerals],
];
for (const [table, source, zh] of tables) {
  for (const [id, entry] of Object.entries(source)) {
    const chinese = zh?.[id];
    if (!chinese) continue;
    theoryZh[table][id] = chinese;
    // Flat lookup is still useful for text that has no id, but names collide
    // across tables ("Major" chord vs scale), so id-based callers must prefer
    // THEORY_ZH.
    if (entry.name) flat[entry.name] = chinese;
  }
}

const MANUAL_TEMPLATES = {
  'Press & hold: a tick every {ms} ms · Release after N ticks = option N · Triple-tap = off · Swipe = next · Circle = replay · 2 circles = names':
    '长按：每 {ms} 毫秒响一声 · 松手时响 N 声 = 第 N 项 · 连按三下 = 关闭 · 划直线 = 下一题 · 画圈 = 重播 · 画两圈 = 报答案',
  'C major melody, {n} notes, {where}': 'C 大调旋律，{n} 个音符，{where}',
};

const allTemplates = { ...templates, ...MANUAL_TEMPLATES };

const body = `// Generated by scripts/build-i18n.mjs — do not edit by hand.
// Sources: .cache/i18n/zh-ui.json, zh-templates.json, zh-content.json

export const ZH = ${JSON.stringify(flat, null, 2)};

export const ZH_TEMPLATES = ${JSON.stringify(allTemplates, null, 2)};

// Id-keyed names: unambiguous where English display names collide
// (e.g. "Major" is a chord and a scale).
export const THEORY_ZH = ${JSON.stringify(theoryZh, null, 2)};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, body, 'utf8');
console.log(`wrote ${OUT}: ${Object.keys(flat).length} static keys, ${Object.keys(allTemplates).length} templates`);

if (content.modules) {
  const missing = MODULES.filter(m => !content.modules[m.id]).map(m => m.id);
  if (missing.length) console.warn('modules not translated yet:', missing.join(', '));
}
