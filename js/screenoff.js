// screenoff.js — a serialisable practice session for the native screen-off
// engine.
//
// While the screen is on, session.js owns the loop: WebAudio plays, Vosk (or
// Web Speech) listens, and grading happens in JS. With the screen off,
// Chromium suspends the page, so none of that can be relied on. This module
// pre-builds the same questions as plain JSON — audio as MIDI event lists,
// answers, spoken names and recognisable aliases — and the Android service
// runs the loop natively from that.
//
// The queue is generated when voice mode is switched on, not when the screen
// locks: by then the page may already be frozen and unable to generate
// anything.

import * as Engine from './engine.js';
import * as State from './state.js';
import { moduleById } from './curriculum.js';
import { aliasesFor, commandPhrasesFor } from './voice-intent.js';
import { aliasesForZh } from './voice-intent-zh.js';
import { spokenAnswerName } from './speech.js';
import { language } from './i18n.js';

// Long enough for a real session (60 questions at roughly 10 s each), small
// enough to stay a few hundred kilobytes of JSON.
const QUEUE_SIZE = 60;

export function screenOffSupported(moduleId) {
  return moduleById(moduleId)?.kind === 'choice';
}

/**
 * Build one native session for `moduleId`, or null when the exercise is not
 * multiple choice (progressions and melodies have no option grid to count).
 */
export function buildScreenOffSession(moduleId) {
  if (!screenOffSupported(moduleId)) return null;
  const lang = language();
  const questions = [];

  for (let i = 0; i < QUEUE_SIZE; i++) {
    const q = Engine.generate(moduleId, State.moduleConfig(moduleId));
    if (!q || q.kind !== 'choice') return null;

    // grade(answer) returns the stats key for this question; asking with the
    // correct id is the cheapest way to get it without grading anything.
    const graded = q.grade(q.answerId);
    const itemKey = graded?.itemResults?.[0]?.key ?? null;

    const options = q.options.map(opt => ({
      id: opt.id,
      // What TTS says for this option ("perfect fifth", "大三和弦，第一转位").
      speech: spokenAnswerName(moduleId, opt.id) ?? opt.label,
      // What the recogniser may hear. English aliases feed the Vosk grammar;
      // Chinese ones are substring-matched because that model has no word list.
      aliases: lang === 'zh'
        ? aliasesForZh(moduleId, opt.id)
        : aliasesFor(moduleId, opt.id),
      // Played when the user auditions an option after a miss.
      events: q.optionEvents?.[opt.id] ?? null,
    }));

    questions.push({
      moduleId,
      itemKey,
      answerId: q.answerId,
      events: q.events ?? null,
      options,
    });
  }

  return {
    v: 1,
    lang,
    volume: State.state.settings.volume ?? 0.9,
    idleMinutes: State.state.settings.voiceTimeoutMin ?? 10,
    commands: commandPhrasesFor(lang),
    questions,
  };
}
