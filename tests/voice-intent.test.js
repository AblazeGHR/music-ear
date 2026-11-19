// voice-intent.test.js — the transcript parser is pure data + string work, so
// every exercise's vocabulary and every command can be exercised without a
// microphone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, normalizeTranscript, aliasesFor, grammarPhrases } from '../js/voice-intent.js';
import { INTERVALS, CHORDS, SCALES, DEGREES } from '../js/theory.js';

const ctx = (moduleId, ids = []) => ({
  moduleId,
  options: ids.map(id => ({ id, label: String(id) })),
});

const POOLS = {
  pitch: ['up', 'down', 'same'],
  absolute: [...Array(12).keys()],
  intervals: Object.keys(INTERVALS),
  chords: Object.keys(CHORDS),
  scales: Object.keys(SCALES),
  degrees: Object.keys(DEGREES),
};

test('normalisation expands numbers, accidentals and filler words', () => {
  assert.equal(normalizeTranscript('Minor 3rd'), 'minor third');
  assert.equal(normalizeTranscript('C♯'), 'c sharp');
  assert.equal(normalizeTranscript('E♭'), 'e flat');
  assert.equal(normalizeTranscript('Dominant 7th · 1st inv'), 'dominant seventh first inversion');
  assert.equal(normalizeTranscript('it was a major chord'), 'major');
  assert.equal(normalizeTranscript('A'), 'a', 'a lone A stays a note name');
});

test('pitch answers accept words and synonyms', () => {
  const c = ctx('pitch', POOLS.pitch);
  assert.equal(parseIntent('higher', c).id, 'up');
  assert.equal(parseIntent('it went up', c).id, 'up');
  assert.equal(parseIntent('lower', c).id, 'down');
  assert.equal(parseIntent('same', c).id, 'same');
  assert.equal(parseIntent('identical', c).id, 'same');
});

test('absolute pitch: letters, accidentals and enharmonic spellings', () => {
  const c = ctx('absolute', POOLS.absolute);
  assert.equal(parseIntent('C sharp', c).id, 1);
  assert.equal(parseIntent('D flat', c).id, 1, 'enharmonic spelling of C♯');
  assert.equal(parseIntent('A', c).id, 9);
  assert.equal(parseIntent('B flat', c).id, 10);
  assert.equal(parseIntent('E', c).id, 4);
});

test('intervals: full names, short names and synonyms', () => {
  const c = ctx('intervals', POOLS.intervals);
  assert.equal(parseIntent('perfect fifth', c).id, 'P5');
  assert.equal(parseIntent('fifth', c).id, 'P5');
  assert.equal(parseIntent('minor third', c).id, 'm3');
  assert.equal(parseIntent('minor 3rd', c).id, 'm3');
  assert.equal(parseIntent('tritone', c).id, 'TT');
  assert.equal(parseIntent('perfect 5th', c).id, 'P5');
  assert.equal(parseIntent('octave', c).id, 'P8');
});

test('chords: names, inversions and spoken numerals', () => {
  const c = ctx('chords', POOLS.chords);
  assert.equal(parseIntent('major', c).id, 'maj');
  assert.equal(parseIntent('dominant seventh', c).id, 'dom7');
  assert.equal(parseIntent('dominant 7th first inversion', c).id, 'dom7_1');
  assert.equal(parseIntent('major in first inversion', c).id, 'maj_1');
  assert.equal(parseIntent('half diminished', c).id, 'm7b5');
  assert.equal(parseIntent('minor major seventh', c).id, 'mM7');
  assert.equal(parseIntent('sus two', c).id, 'sus2');
});

test('scales: names, mode aliases and “scale” noise', () => {
  const c = ctx('scales', POOLS.scales);
  assert.equal(parseIntent('natural minor', c).id, 'natmin');
  assert.equal(parseIntent('aeolian', c).id, 'natmin');
  assert.equal(parseIntent('whole tone scale', c).id, 'wholetone');
  assert.equal(parseIntent('major scale', c).id, 'major');
  assert.equal(parseIntent('harmonic minor', c).id, 'harmmin');
});

test('degrees: solfège, phonetic spellings and numbered degrees', () => {
  const c = ctx('degrees', POOLS.degrees);
  assert.equal(parseIntent('re', c).id, 're');
  assert.equal(parseIntent('ray', c).id, 're');
  assert.equal(parseIntent('flat three', c).id, 'me');
  assert.equal(parseIntent('sharp four', c).id, 'fi');
  assert.equal(parseIntent('tee', c).id, 'ti');
});

test('option names win over bare numbers', () => {
  const c = ctx('degrees', POOLS.degrees);
  // "three" is the label of Mi; the third *button* may be something else.
  assert.equal(parseIntent('three', c).id, 'mi');
  assert.equal(parseIntent('flat three', c).id, 'me');
});

test('explicit numbers pick the button, in display order', () => {
  const c = ctx('degrees', ['mi', 'do', 'sol']);
  assert.equal(parseIntent('option three', c).id, 'sol');
  assert.equal(parseIntent('number one', c).id, 'mi');
  assert.equal(parseIntent('choice two', c).id, 'do');
});

test('ordinals work as numbers too', () => {
  const c = ctx('intervals', POOLS.intervals);
  assert.equal(parseIntent('first', c).index, 1);
  assert.equal(parseIntent('option first', c).index, 1);
  assert.equal(parseIntent('number third', c).index, 3);
  assert.equal(parseIntent('twenty third', ctx('chords', POOLS.chords)).index, 23);
});

test('bare numbers are an index only when no name matches', () => {
  const chords = ctx('chords', POOLS.chords);
  assert.equal(parseIntent('seven', chords).via, 'index');
  assert.equal(parseIntent('seven', chords).index, 7);
  assert.equal(parseIntent('thirty three', chords).index, 33);
});

test('commands are recognised regardless of surrounding words', () => {
  const c = ctx('intervals', POOLS.intervals);
  assert.equal(parseIntent('replay', c).name, 'replay');
  assert.equal(parseIntent('can you play it again', c).name, 'replay');
  assert.equal(parseIntent('next', c).name, 'next');
  assert.equal(parseIntent('please skip this one', c).name, 'next');
  assert.equal(parseIntent('say the names', c).name, 'names');
  assert.equal(parseIntent('stop listening', c).name, 'stop');
});

test('ambiguity is refused, not guessed', () => {
  const c = ctx('intervals', ['m3', 'M3']);
  const r = parseIntent('third', c);
  assert.equal(r.type, 'none');
  assert.equal(r.reason, 'ambiguous');
});

test('fuzzy matching tolerates a garbled syllable', () => {
  const c = ctx('intervals', POOLS.intervals);
  assert.equal(parseIntent('perfect fith', c).id, 'P5');
  assert.equal(parseIntent('miner third', c).id, 'm3');
  const chords = ctx('chords', POOLS.chords);
  assert.equal(parseIntent('dominant sevent', chords).id, 'dom7');
});

test('noise does not produce an answer', () => {
  const c = ctx('chords', POOLS.chords);
  for (const text of ['banana', 'hello there', 'what time is it', '']) {
    assert.equal(parseIntent(text, c).type, 'none', `"${text}" must not answer`);
  }
});

test('every choice answer has at least one alias', () => {
  for (const [moduleId, ids] of Object.entries(POOLS)) {
    for (const id of ids) {
      assert.ok(aliasesFor(moduleId, id).length > 0, `${moduleId}/${id} has aliases`);
    }
  }
});

test('every alias maps back to its own answer', () => {
  for (const [moduleId, ids] of Object.entries(POOLS)) {
    const c = ctx(moduleId, ids);
    for (const id of ids) {
      for (const alias of aliasesFor(moduleId, id)) {
        const r = parseIntent(alias, c);
        assert.equal(r.type, 'answer', `${moduleId}/${id}: "${alias}" is an answer`);
        assert.equal(r.id, id, `${moduleId}/${id}: "${alias}" maps back`);
      }
    }
  }
});

test('grammar phrases are ASCII and include the commands', () => {
  const phrases = grammarPhrases(ctx('chords', POOLS.chords));
  assert.ok(phrases.includes('replay'));
  assert.ok(phrases.includes('next'));
  assert.ok(phrases.includes('major seventh first inversion'));
  assert.ok(phrases.every(p => /^[\x20-\x7e]+$/.test(p)));
});

// ── Chinese ──────────────────────────────────────────────────────────────────

const zh = (moduleId, ids = []) => ({
  moduleId,
  options: ids.map(id => ({ id })),
  language: 'zh',
});

test('Chinese pitch answers', () => {
  const c = zh('pitch', POOLS.pitch);
  assert.equal(parseIntent('更高', c).id, 'up');
  assert.equal(parseIntent('低一点', c).id, 'down');
  assert.equal(parseIntent('一样', c).id, 'same');
});

test('Chinese interval names, with and without extra words', () => {
  const c = zh('intervals', POOLS.intervals);
  assert.equal(parseIntent('纯五度', c).id, 'P5');
  assert.equal(parseIntent('我觉得是纯五度', c).id, 'P5');
  assert.equal(parseIntent('小三度', c).id, 'm3');
  assert.equal(parseIntent('三全音', c).id, 'TT');
  assert.equal(parseIntent('八度', c).id, 'P8');
  assert.equal(parseIntent('五度', c).id, 'P5');
});

test('Chinese chord names and inversions', () => {
  const c = zh('chords', POOLS.chords);
  assert.equal(parseIntent('大三和弦', c).id, 'maj');
  assert.equal(parseIntent('大三和弦第一转位', c).id, 'maj_1');
  assert.equal(parseIntent('第一转位大三和弦', c).id, 'maj_1');
  assert.equal(parseIntent('属七和弦第一转位', c).id, 'dom7_1');
  assert.equal(parseIntent('半减七和弦第一转位', c).id, 'm7b5_1');
});

test('Chinese scale names', () => {
  const c = zh('scales', POOLS.scales);
  assert.equal(parseIntent('自然小调', c).id, 'natmin');
  assert.equal(parseIntent('大调', c).id, 'major');
  assert.equal(parseIntent('多利亚', c).id, 'dorian');
  assert.equal(parseIntent('全音音阶', c).id, 'wholetone');
});

test('Chinese degrees: solfège and numbered degrees', () => {
  const c = zh('degrees', POOLS.degrees);
  assert.equal(parseIntent('哆', c).id, 'do');
  assert.equal(parseIntent('来', c).id, 're');
  assert.equal(parseIntent('索', c).id, 'sol');
  assert.equal(parseIntent('三级', c).id, 'mi');
  assert.equal(parseIntent('降三级', c).id, 'me');
  assert.equal(parseIntent('升四级', c).id, 'fi');
});

test('Chinese absolute pitch: 升/降 spellings', () => {
  const c = zh('absolute', POOLS.absolute);
  assert.equal(parseIntent('升c', c).id, 1);
  assert.equal(parseIntent('降e', c).id, 3);
  assert.equal(parseIntent('降b', c).id, 10);
  assert.equal(parseIntent('a', c).id, 9);
});

test('Chinese numbers pick buttons, explicit forms first', () => {
  const c = zh('intervals', POOLS.intervals);
  assert.equal(parseIntent('三', c).index, 3);
  assert.equal(parseIntent('第三个', c).index, 3);
  assert.equal(parseIntent('选项三', c).index, 3);
  assert.equal(parseIntent('请选三号', c).index, 3);
  assert.equal(parseIntent('三十三', zh('chords', POOLS.chords)).index, 33);
});

test('Chinese commands', () => {
  const c = zh('intervals', POOLS.intervals);
  assert.equal(parseIntent('重播', c).name, 'replay');
  assert.equal(parseIntent('请再放一遍', c).name, 'replay');
  assert.equal(parseIntent('下一题', c).name, 'next');
  assert.equal(parseIntent('跳过', c).name, 'next');
  assert.equal(parseIntent('报答案', c).name, 'names');
  assert.equal(parseIntent('关闭语音', c).name, 'stop');
});

test('Chinese ambiguity is refused', () => {
  const c = zh('intervals', ['m3', 'M3']);
  const r = parseIntent('三度', c);
  assert.equal(r.type, 'none');
  assert.equal(r.reason, 'ambiguous');
});

test('Chinese one-character answers do not swallow every name', () => {
  const c = zh('degrees', POOLS.degrees);
  // "三" is a number, not the 三 inside 降三级/三星…
  assert.equal(parseIntent('三', c).via, 'index');
  assert.equal(parseIntent('香蕉', c).type, 'none');
});

test('Chinese builds no recogniser grammar (no word list in the model)', () => {
  assert.deepEqual(grammarPhrases(zh('chords', POOLS.chords)), []);
});
