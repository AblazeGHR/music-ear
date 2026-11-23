// session.js — the practice screen: question loop, answer UIs for choice /
// sequence / melody questions, feedback, and the exercise's Options panel.

import { h, go } from './ui.js';
import * as Audio from './audio.js';
import * as Engine from './engine.js';
import * as State from './state.js';
import { moduleById } from './curriculum.js';
import { renderOptions } from './options.js';
import { createRecognizer, bindPointerSurface } from './gesture.js';
import { speakMiss, cancelSpeech, speechAvailable, spokenAnswerName } from './speech.js';
import { voiceSupported, createVoiceController } from './voice.js';
import { theoryName, t, translate } from './i18n.js';
import { buildScreenOffSession } from './screenoff.js';
import { createPiano } from './piano.js';
import { renderScore, layoutScore, SCORE_MAX_W } from './notation.js';
import { midiName } from './theory.js';
import { track } from './analytics.js';

export function renderPractice(root, moduleId) {
  const mod = moduleById(moduleId);
  if (!mod) { go('#/'); return () => {}; }
  return runSession(root, {
    title: mod.title,
    blurb: mod.blurb,
    color: mod.color,
    moduleId,
    next: () => Engine.generate(moduleId, State.moduleConfig(moduleId)),
  });
}

function runSession(root, cfg) {
  track('session_start', { module: cfg.moduleId });
  let q = null;
  let answered = false;
  let everPlayed = false;     // becomes true after the first user-initiated play
  let sessionN = 0, sessionC = 0;
  let qPlays = 0;             // plays of the current question; replays may vary
  let autoTimer = null;
  let autoAt = 0;             // wall-clock deadline, survives frozen timers
  let piano = null;
  let userSeq = [];           // sequence answers
  let userMidis = [];         // melody answers
  let optionBtns = [];

  // ── static shell ───────────────────────────────────────────────────────────
  const playBtn = h('button', { class: 'playbtn', 'aria-label': 'Play / replay', onclick: () => playQ() }, '▶');
  const promptEl = h('div', { class: 's-prompt' });
  const howToEl = h('div', { class: 's-howto' });
  const answersEl = h('div', { class: 's-answers' });
  const feedbackEl = h('div', { class: 's-feedback' });
  const actionsEl = h('div', { class: 's-actions' });
  const scoreEl = h('div', { class: 's-score' });

  const mod = moduleById(cfg.moduleId);
  const optionsEl = renderOptions(mod, () => { if (!answered) nextQuestion(); });

  // ── gesture mode (eyes-closed input) ───────────────────────────────────────
  // Every multiple-choice question gets it, whatever the option count. The
  // caller validates the counted number against the question; counting is the
  // user's own trade-off.

  const KBD_HINT = '1–9 answer · R replay · ⏎ next · ⌫ undo';
  // Sight reading has no answer buttons to number.
  const TYPE_HINT = 'R replay · ⏎ next · ⌫ undo';
  const kbdHint = () => (q?.kind === 'reading' ? TYPE_HINT : KBD_HINT);
  const gestureMode = State.state.settings.gestureMode === 'hold' ? 'hold' : 'tap';
  const holdRepeatMs = State.clampHoldRepeat(State.state.settings.holdRepeatMs);
  const TAP_HINT = 'Tap ×N = option N (after a miss: play it) · Swipe = next · Hold = off · Circle = replay · 2 circles = names';
  const HOLD_HINT = `Press & hold: a tick every ${holdRepeatMs} ms · Release after N ticks = option N · Triple-tap = off · Swipe = next · Circle = replay · 2 circles = names`;
  const gestureHint = () => (gestureMode === 'hold' ? HOLD_HINT : TAP_HINT);
  let gestureOn = false;
  let compareRun = 0;          // generation counter for the A/B playback
  let lastChoiceId = null;
  let lastResultCorrect = null;

  const gestureBtn = h('button', {
    class: 'gesture-switch', role: 'switch', 'aria-checked': 'false',
    onclick: () => setGesture(!gestureOn),
  }, 'Gesture');
  const voiceBtn = h('button', {
    class: 'gesture-switch voice-switch', role: 'switch', 'aria-checked': 'false',
    title: 'Answer by voice', 'aria-label': 'Answer by voice',
    onclick: () => setVoice(!voiceOn),
  }, '🎙');
  const helpBtn = h('button', {
    class: 'gesture-help-btn', 'aria-label': 'How gestures map to the buttons', title: 'How gestures map to the buttons',
    onclick: () => showHelp(),
  }, '?');
  const statsBtn = h('button', {
    class: 'iconbtn', 'aria-label': 'This exercise in your stats', title: 'This exercise in your stats',
    onclick: () => go(`#/stats/${cfg.moduleId}`),
  }, '📊');
  const kbdEl = h('div', { class: 's-kbd' }, KBD_HINT);
  const overlay = h('div', { class: 'gesture-overlay' });
  const voiceText = h('span', { class: 'v-text' });
  const voiceBar = h('div', { class: 's-voice', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'v-dot' }), voiceText);

  // How long the app waits for another tap before taking the answer; any
  // value the user set in Settings, clamped to something usable here.
  const recognizer = createRecognizer({
    // Sounding the tick on touch — not on the tap judgement — is what makes it
    // feel instant: it lands with the finger, and a hold, swipe or circle that
    // follows ticks too yet still counts as no tap at all.
    onTouch: () => { if (gestureOn) Audio.playNote(84, 0.045, 1, { lead: UI_LEAD }); },
    onCommit: n => { if (gestureOn) submitByCount(n); },
    onSwipe: () => { if (gestureOn) { clearAuto(); nextQuestion(); } },   // straight line → next
    onHold: () => { if (gestureOn) setGesture(false); },                  // tap mode: hold → leave
    onRepeat: () => { if (gestureOn) Audio.playNote(84, 0.045, 1, { lead: UI_LEAD }); },
    onExit: () => { if (gestureOn) setGesture(false); },                  // hold mode: triple-tap
    onCircle: loops => {
      if (!gestureOn) return;
      // Two loops after a miss: name the answers instead of re-playing them.
      // The speech must start inside this gesture handler — iOS requires it.
      if (loops >= 2 && answered && lastResultCorrect === false && lastChoiceId !== null) {
        Audio.stopAll();
        speakMiss(cfg.moduleId, lastChoiceId, q.answerId);
        return;
      }
      playQ();
    },
  }, {
    tapWindowMs: State.clampTapWindow(State.state.settings.tapWindowMs),
    mode: gestureMode,
    holdRepeatMs,
    exitTapWindowMs: 600,
    maxTicks: Number.POSITIVE_INFINITY,
  });
  const unbindGestures = bindPointerSurface(overlay, recognizer);

  function setGesture(on) {
    // Gesture and voice are independent inputs: both may be on at once, and
    // whichever recognises first answers (the answer guard drops the second).
    gestureOn = on;
    shell.classList.toggle('gesture-on', on);
    gestureBtn.classList.toggle('on', on);
    gestureBtn.setAttribute('aria-checked', String(on));
    kbdEl.textContent = on ? gestureHint() : kbdHint();
    recognizer.reset();
    if (on) { hideHelp(); Audio.playNote(76, 0.1, 1, { lead: UI_LEAD }); }   // audible "it's on"
  }

  // The Android service runs the loop natively when the screen locks; the
  // page pre-builds the queue while it is still visible.
  const Practice = () => (typeof window !== 'undefined' ? window.AndroidPractice : null);

  function prepareNativeSession() {
    const bridge = Practice();
    if (!bridge || typeof bridge.prepareSession !== 'function') return;
    try {
      const payload = buildScreenOffSession(cfg.moduleId);
      bridge.prepareSession(payload ? JSON.stringify(payload) : '');
    } catch {
      try { bridge.prepareSession(''); } catch { /* web build */ }
    }
  }

  function setVoice(on) {
    if (on && !voiceSupported()) return;
    if (on && (!q || q.kind !== 'choice')) return;
    voiceOn = on;
    shell.classList.toggle('voice-on', on);
    voiceBtn.classList.toggle('on', on);
    voiceBtn.setAttribute('aria-checked', String(on));
    clearTimeout(voiceHintTimer);
    if (on) {
      Audio.unlock();
      hideHelp();
      Audio.playNote(76, 0.1, 1, { lead: UI_LEAD });
      setVoiceStatus('Starting…');
      voice.enable();
      prepareNativeSession();
    } else {
      const bridge = Practice();
      if (bridge) { try { bridge.prepareSession(''); } catch { /* web build */ } }
      voice.disable();
      setVoiceStatus('');
    }
  }

  function setVoiceStatus(text, transient = false) {
    voiceText.textContent = text || '';
    voiceBar.classList.toggle('show', !!text);
    clearTimeout(voiceHintTimer);
    if (transient && text) {
      voiceHintTimer = setTimeout(() => {
        if (!voiceOn) { voiceText.textContent = ''; voiceBar.classList.remove('show'); }
      }, 6000);
    }
  }

  function syncVoiceAffordance() {
    const eligible = !!q && q.kind === 'choice' && voiceSupported();
    voiceBtn.classList.toggle('hidden', !eligible);
    if (!eligible && voiceOn) setVoice(false);
  }

  // ── gesture help: what each gesture stands in for ──────────────────────────
  let helpOverlay = null;

  function showHelp() {
    if (helpOverlay) return;
    const hold = gestureMode === 'hold';
    const ghRow = (gesture, meaning) => h('div', { class: 'gh-row' },
      h('span', { class: 'gh-g' }, gesture),
      h('span', { class: 'gh-arrow' }, '→'),
      h('span', { class: 'gh-b' }, meaning));
    helpOverlay = h('div', {
      class: 'overlay',
      onclick: e => { if (e.target === helpOverlay) hideHelp(); },
    },
      h('div', { class: 'gesture-help card' },
        h('h2', {}, hold ? 'Gesture mode · hold to count' : 'Gesture mode · tap to count'),
        h('p', { class: 'muted' }, hold
          ? `Press and hold: a tick every ${holdRepeatMs} ms, release after N ticks to pick option N.`
          : 'With the switch on, these gestures stand in for the buttons:'),
        h('div', { class: 'gh-rows' },
          hold ? [
            ghRow('Hold still', 'one tick per interval — release after N ticks to pick option N; after a miss it plays that option'),
            ghRow('Tap three times', 'turns gesture mode off'),
            ghRow('Swipe a line', 'Next → — or skip the question if you have not answered'),
            ghRow('Draw a circle', '▶ Play / replay — after a wrong answer it plays your pick, then the real one'),
            ghRow('Circle twice', 'after a wrong answer, speaks your pick and then the real one — the 🔊 Names button does the same'),
          ] : [
            ghRow('Tap once', 'the 1st answer button'),
            ghRow('Tap N times', 'the Nth answer button — a tick plays on every tap so you can count with your eyes closed. After a miss it plays that option instead'),
            ghRow('Swipe a line', 'Next → — or skip the question if you have not answered'),
            ghRow('Draw a circle', '▶ Play / replay — after a wrong answer it plays your pick, then the real one'),
            ghRow('Circle twice', 'after a wrong answer, speaks your pick and then the real one — the 🔊 Names button does the same'),
            ghRow('Long press', 'turns gesture mode off'),
          ]),
        h('p', { class: 'tiny muted' }, 'A wrong answer plays your pick and then the real one, so the comparison needs no buttons. Everything else — back, Options, keyboard — stays locked until the switch is off.'),
        h('div', { class: 'gesture-help-close' },
          h('button', { class: 'btn primary', onclick: hideHelp }, 'Got it'))));
    shell.append(helpOverlay);
  }

  function hideHelp() {
    if (helpOverlay) { helpOverlay.remove(); helpOverlay = null; }
  }

  // Tap count → answer. Choice questions only; ignored before the first play.
  function submitByCount(n) {
    if (!q || !everPlayed) return;
    if (q.kind !== 'choice') return;
    if (n < 1 || n > q.options.length) return;
    const id = q.options[n - 1].id;
    if (!answered) answerChoice(id);
    else if (lastResultCorrect === false) auditionChoice(id);
  }

  function syncGestureAffordance() {
    const eligible = !!q && q.kind === 'choice';
    gestureBtn.classList.toggle('hidden', !eligible);
    helpBtn.classList.toggle('hidden', !eligible);
    if (!eligible && gestureOn) setGesture(false);
  }

  const shell = h('div', { class: 'session', style: { '--mc': `var(--c-${cfg.color})` } },
    h('header', { class: 's-head' },
      h('button', {
        class: 'iconbtn', 'aria-label': 'Back',
        onclick: () => go('#/'),
      }, '←'),
      h('div', { class: 's-title' },
        h('div', {}, cfg.title),
        h('div', { class: 's-sub' }, cfg.blurb)),
      h('div', { class: 's-tools' },
        scoreEl, voiceBtn, gestureBtn, helpBtn, statsBtn)),
    h('main', { class: 's-body' },
      h('div', { class: 's-stage' }, playBtn, promptEl, howToEl),
      answersEl, feedbackEl, voiceBar, actionsEl,
      optionsEl,
      kbdEl),
    overlay);
  root.append(shell);

  // ── voice mode (spoken answers, on-device on Android) ─────────────────────
  let voiceOn = false;
  let voiceHintTimer = null;

  const voice = createVoiceController({
    getCtx: () => (q && q.kind === 'choice'
      ? { moduleId: cfg.moduleId, options: q.options }
      : null),
    getIdleMinutes: () => State.state.settings.voiceTimeoutMin,
    onAnswer: intent => {
      if (!q) return;
      if (!everPlayed) { setVoiceStatus('Play the question first — say “replay”'); return; }
      if (!answered) { answerChoice(intent.id); return; }
      if (lastResultCorrect === false) auditionChoice(intent.id);
    },
    onCommand: name => {
      if (name === 'replay') { Audio.unlock(); playQ(); }
      else if (name === 'next') { clearAuto(); nextQuestion(); }
      else if (name === 'names') {
        if (answered && lastResultCorrect === false && lastChoiceId !== null && q) {
          Audio.stopAll();
          speakMiss(cfg.moduleId, lastChoiceId, q.answerId);
        }
      } else if (name === 'stop') setVoice(false);
    },
    onHeard: (text, intent) => {
      if (!voiceOn) return;
      setVoiceStatus(intent && intent.type === 'none'
        ? `Heard “${text}” — no match`
        : `Heard “${text}”`);
    },
    onState: (state, detail) => {
      if (state === 'timeout') {
        setVoice(false);
        const mins = Number(detail) || 10;
        setVoiceStatus(`Voice mode stopped after ${mins} minute${mins === 1 ? '' : 's'} without a recognised answer`, true);
        return;
      }
      if (state === 'fatal') {
        setVoice(false);
        setVoiceStatus(detail === 'network'
          ? 'Voice recognition needs a network here — use the buttons'
          : 'Voice unavailable — use the buttons', true);
        return;
      }
      if (!voiceOn) return;
      if (state === 'preparing') setVoiceStatus('Preparing offline voice…');
      else if (state === 'ready') setVoiceStatus('Voice ready');
      else if (state === 'listening') setVoiceStatus('Listening — say an option name, a number, or “replay”');
      else if (state === 'paused') setVoiceStatus('Paused while the sound plays');
      else if (state === 'error') {
        setVoiceStatus(detail === 'permission'
          ? 'Microphone blocked — allow it in system settings'
          : 'Recognition hiccup — still listening…', true);
      }
    },
  });

  // ── helpers ────────────────────────────────────────────────────────────────
  function updateScore() {
    scoreEl.textContent = sessionN ? `✓ ${sessionC}/${sessionN}` : '';
  }

  const pause = ms => new Promise(r => setTimeout(r, ms));

  const UI_LEAD = 0.01;         // s — UI feedback sounds should feel instant
  const COMPARE_GAP_MS = 250;   // pause between your pick and the real answer

  // Plays the wrong-answer comparison: your pick, then the real answer. The
  // second sound waits for the first to finish, so a long option — a two-note
  // interval, a seven-note scale — is never cut off by a fixed timer. Any new
  // run (or moving to the next question) abandons whatever was in flight.
  async function playComparison(leadMs) {
    const run = ++compareRun;
    const qRef = q;
    const pick = lastChoiceId;
    if (!qRef || pick === null || typeof qRef.playOption !== 'function') return;
    const answerId = qRef.answerId;
    await pause(leadMs);
    if (run !== compareRun) return;
    await qRef.playOption(pick);
    if (run !== compareRun) return;
    await pause(COMPARE_GAP_MS);
    if (run !== compareRun) return;
    await qRef.playOption(answerId);
  }

  async function playQ() {
    if (!q) return;
    const holdVoice = voiceOn;
    if (holdVoice) voice.pause();
    everPlayed = true;
    playBtn.classList.add('playing');
    shell.classList.remove('awaiting-play');
    try {
      // After a miss, replay is the A/B itself: your pick, then the real
      // answer — the same pairing the buttons offer, but via play/circle/R.
      const compareAfterMiss = answered && lastResultCorrect === false
        && typeof q.playOption === 'function' && lastChoiceId !== null;
      if (compareAfterMiss) {
        await playComparison(0);
      } else {
        // First play is the question as generated; replays may re-voice it
        // (e.g. a different direction) so the answer is learned as a sound.
        const replay = qPlays > 0 && typeof q.replay === 'function';
        qPlays++;
        await (replay ? q.replay() : q.play());
      }
    } finally {
      playBtn.classList.remove('playing');
      if (holdVoice) voice.resume();
    }
    playBtn.textContent = '↻';
  }

  function clearAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    autoAt = 0;
  }

  function nextQuestion() {
    clearAuto();
    compareRun++;               // abandon any comparison still playing
    recognizer.reset();
    lastChoiceId = null;
    lastResultCorrect = null;
    qPlays = 0;
    q = cfg.next();
    answered = false;
    userSeq = [];
    userMidis = [];
    piano = null;
    feedbackEl.innerHTML = '';
    actionsEl.innerHTML = '';
    answersEl.innerHTML = '';
    playBtn.textContent = '▶';
    promptEl.textContent = q.prompt;
    howToEl.textContent = mod.howTo || '';
    renderAnswers();
    updateScore();
    if (!gestureOn) kbdEl.textContent = kbdHint();
    syncGestureAffordance();
    syncVoiceAffordance();
    if (q.kind === 'reading') {
      // The question is on the page: there is nothing to wait for, and the
      // score must never be dimmed. Sound only if the user asked for it.
      everPlayed = true;
      playBtn.classList.toggle('hidden', !q.autoPlay);
      if (q.autoPlay) playQ();
      else shell.classList.remove('awaiting-play');
    } else if (everPlayed) playQ();
    else {
      shell.classList.add('awaiting-play');
      // A spoken "next" before the first play leaves the grammar from the
      // previous question loaded; restart so the new options are recognised.
      if (voiceOn) { voice.pause(); voice.resume(); }
    }
  }

  function finishAnswer(result, extraFeedback) {
    answered = true;
    lastResultCorrect = result.correct;
    sessionN++;
    if (result.correct) sessionC++;
    State.recordAnswer(q.moduleId, result.itemResults, result.correct, result.confusion, q.kind);
    updateScore();
    track('question_answered', { module: q.moduleId, kind: q.kind, correct: result.correct });

    renderFeedback(result, extraFeedback);

    // Eyes-closed feedback: a blip means right; wrong answers play your pick
    // and then the real one, so the comparison is heard without any button.
    if (gestureOn) {
      if (result.correct) {
        Audio.playNote(91, 0.14, 1, { lead: UI_LEAD });
      } else {
        playComparison(120);    // fire and forget; the run guard keeps it safe
      }
    }

    const nextBtn = h('button', { class: 'btn primary', onclick: nextQuestion }, 'Next →');
    actionsEl.append(nextBtn);
    if (result.correct && State.state.settings.autoAdvance) {
      autoAt = Date.now() + 1100;
      autoTimer = setTimeout(nextQuestion, 1100);
    } else {
      // Move the keyboard focus to Next without scrolling: on a phone the
      // feedback + buttons push the page down, and yanking the viewport after
      // every answer breaks the rhythm of continuous practice.
      nextBtn.focus({ preventScroll: true });
    }
  }

  function renderFeedback(result, extra = []) {
    feedbackEl.innerHTML = '';
    const box = h('div', { class: `fb ${result.correct ? 'good' : 'bad'}` });
    box.append(h('div', { class: 'fb-line' }, result.correct ? '✓ Correct' : '✗ Not quite'));
    for (const node of extra) box.append(node);
    feedbackEl.append(box);
  }

  // ── answer UIs ─────────────────────────────────────────────────────────────
  function renderAnswers() {
    if (q.kind === 'choice') renderChoice();
    else if (q.kind === 'sequence') renderSequence();
    else if (q.kind === 'reading') renderReading();
    else renderMelody();
  }

  // choice ────────────────────────────────────────────────────────────────────
  // Chord/scale names collide in English ("Major"), so translations are looked
  // up by module id rather than by the rendered label.
  const displayLabel = opt => theoryName(cfg.moduleId, opt.id, opt.label);

  function renderChoice() {
    optionBtns = q.options.map((opt, i) =>
      h('button', { class: 'opt', 'data-no-i18n': '', onclick: () => onOptionClick(opt.id) },
        i < 10 ? h('span', { class: 'opt-kbd' }, String((i + 1) % 10)) : null,
        h('span', { class: 'opt-label' }, displayLabel(opt)),
        opt.sub ? h('span', { class: 'opt-sub' }, opt.sub) : null));
    answersEl.append(h('div', { class: 'opt-grid' }, optionBtns));
  }

  // After a miss every option stays live as a preview: tapping it (or saying
  // its name, or tapping it N times in gesture mode) plays that option.
  async function auditionChoice(id) {
    if (!q || q.kind !== 'choice' || typeof q.playOption !== 'function') return;
    Audio.unlock();
    compareRun++;
    Audio.stopAll();
    const holdVoice = voiceOn;
    if (holdVoice) voice.pause();
    try { await q.playOption(id); } finally { if (holdVoice) voice.resume(); }
  }

  function onOptionClick(id) {
    if (!answered) { answerChoice(id); return; }
    if (lastResultCorrect === false) auditionChoice(id);
  }

  function answerChoice(id) {
    if (answered || !everPlayed) return;
    lastChoiceId = id;
    const result = q.grade(id);
    const canAudition = !result.correct && typeof q.playOption === 'function';
    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i], btn = optionBtns[i];
      btn.disabled = !canAudition;
      if (canAudition) btn.classList.add('audition');
      if (opt.id === q.answerId) btn.classList.add('good');
      else if (opt.id === id) btn.classList.add('bad');
      else btn.classList.add('dim');
    }
    const extra = [];
    const correctOpt = q.options.find(o => o.id === q.answerId);
    if (!result.correct) {
      const yourOpt = q.options.find(o => o.id === id);
      extra.push(h('div', { class: 'fb-detail' },
        `It was ${displayLabel(correctOpt)} — you chose ${displayLabel(yourOpt)}.`));
      if (typeof q.playOption === 'function') {
        extra.push(h('div', { class: 'tiny muted' },
          'Tap any option (or say its name) to hear it.'));
      }
      const compareBtns = [];
      if (q.playOption) {
        compareBtns.push(
          h('button', { class: 'btn small', onclick: () => auditionChoice(id) }, '▶ Your pick'),
          h('button', { class: 'btn small', onclick: () => auditionChoice(q.answerId) }, '▶ Answer'));
      }
      // The button equivalent of the two-circle gesture: speak the names.
      // Hidden when the platform has no speech engine or the names are unknown.
      if (speechAvailable()
        && spokenAnswerName(cfg.moduleId, id) && spokenAnswerName(cfg.moduleId, q.answerId)) {
        compareBtns.push(h('button', {
          class: 'btn small',
          title: 'Speak the answer names',
          onclick: () => { Audio.stopAll(); speakMiss(cfg.moduleId, id, q.answerId); },
        }, '🔊 Names'));
      }
      if (compareBtns.length) extra.push(h('div', { class: 'fb-compare' }, ...compareBtns));
    } else {
      extra.push(h('div', { class: 'fb-detail' }, displayLabel(correctOpt)));
    }
    if (q.mnemonic) extra.push(h('div', { class: 'fb-mnemonic' }, `♪ ${q.mnemonic}`));
    finishAnswer(result, extra);
  }

  // sequence (progressions) ───────────────────────────────────────────────────
  let slotEls = [];

  function renderSequence() {
    // Given slots show their value as a ghost hint — the user still performs
    // them, so "press I first" (everyone's instinct) is the right move.
    userSeq = q.answerSeq.map(() => null);
    slotEls = q.answerSeq.map((n, i) =>
      h('div', { class: 'slot' + (q.given[i] ? ' ghost' : '') },
        q.given[i] ? n : '·'));
    optionBtns = q.options.map((opt, i) =>
      h('button', { class: 'opt numeral', onclick: () => fillSlot(opt.id) },
        i < 10 ? h('span', { class: 'opt-kbd' }, String((i + 1) % 10)) : null,
        h('span', { class: 'opt-label' }, opt.label)));
    answersEl.append(
      h('div', { class: 'slots' }, slotEls),
      h('div', { class: 'opt-grid numerals' }, optionBtns),
      h('div', { class: 'seq-tools' },
        h('button', { class: 'btn small', onclick: undoSlot }, '⌫ Undo')));
  }

  function fillSlot(id) {
    if (answered || !everPlayed) return;
    const i = userSeq.findIndex(v => v === null);
    if (i === -1) return;
    userSeq[i] = id;
    slotEls[i].textContent = id;
    slotEls[i].classList.remove('ghost');
    slotEls[i].classList.add('filled');
    if (!userSeq.includes(null)) submitSequence();
  }

  function undoSlot() {
    if (answered) return;
    for (let i = userSeq.length - 1; i >= 0; i--) {
      if (userSeq[i] !== null) {
        userSeq[i] = null;
        slotEls[i].textContent = q.given[i] ? q.answerSeq[i] : '·';
        slotEls[i].classList.remove('filled');
        if (q.given[i]) slotEls[i].classList.add('ghost');
        return;
      }
    }
  }

  function submitSequence() {
    const result = q.grade(userSeq);
    optionBtns.forEach(b => (b.disabled = true));
    for (let i = 0; i < q.answerSeq.length; i++) {
      slotEls[i].classList.add(userSeq[i] === q.answerSeq[i] ? 'good' : 'bad');
    }
    const extra = [];
    extra.push(h('div', { class: 'fb-detail' }, q.answerSeq.join(' – ')));
    extra.push(h('div', { class: 'fb-compare' },
      h('button', { class: 'btn small', onclick: () => q.playProgressionOnly() }, '▶ Chords only'),
      h('button', { class: 'btn small', onclick: () => q.play() }, '▶ With cadence')));
    finishAnswer(result, extra);
  }

  // melody (dictation) ────────────────────────────────────────────────────────
  function renderMelody() {
    // The first note is shown (slot ghost + highlighted key) but the user
    // plays it themselves — matching everyone's instinct to start from note 1.
    userMidis = [];
    slotEls = q.targetMidis.map((m, i) =>
      h('div', { class: 'slot note' + (q.firstGiven && i === 0 ? ' ghost' : '') },
        q.firstGiven && i === 0 ? midiName(m) : '·'));

    const pianoWrap = h('div', { class: 'piano-wrap' });
    answersEl.append(
      h('div', { class: 'slots' }, slotEls),
      pianoWrap,
      h('div', { class: 'seq-tools' },
        h('button', { class: 'btn small', onclick: undoNote }, '⌫ Undo')));

    piano = createPiano(pianoWrap, q.keyRange[0], q.keyRange[1], {
      tonic: q.tonicMidi,
      onKey: midi => {
        if (answered || !everPlayed) return;
        if (userMidis.length >= q.targetMidis.length) return;
        userMidis.push(midi);
        const i = userMidis.length - 1;
        slotEls[i].textContent = midiName(midi);
        slotEls[i].classList.remove('ghost');
        slotEls[i].classList.add('filled');
        if (userMidis.length === q.targetMidis.length) submitMelody();
      },
    });
    if (q.firstGiven) piano.highlight(q.targetMidis[0], 'hl');
  }

  function undoNote() {
    if (answered) return;
    if (userMidis.length === 0) return;
    userMidis.pop();
    const i = userMidis.length;
    slotEls[i].textContent = q.firstGiven && i === 0 ? midiName(q.targetMidis[0]) : '·';
    slotEls[i].classList.remove('filled');
    if (q.firstGiven && i === 0) slotEls[i].classList.add('ghost');
  }

  function submitMelody() {
    const result = q.grade(userMidis);
    piano.setEnabled(false);
    for (let i = 0; i < q.targetMidis.length; i++) {
      slotEls[i].classList.add(userMidis[i] === q.targetMidis[i] ? 'good' : 'bad');
    }
    const extra = [];
    if (!result.correct) {
      extra.push(h('div', { class: 'fb-detail' },
        `Answer: ${q.targetMidis.map(midiName).join(' ')}`));
      extra.push(h('div', { class: 'fb-compare' },
        h('button', { class: 'btn small', onclick: () => q.playMelodyOnly() }, '▶ Melody'),
        h('button', { class: 'btn small', onclick: showOnPiano }, '👆 Show on piano')));
    }
    finishAnswer(result, extra);
  }

  function showOnPiano() {
    const tempo = State.state.settings.melodyTempo;
    piano.clear();
    q.playMelodyOnly();
    q.targetMidis.forEach((m, i) => {
      setTimeout(() => piano.flash(m, 'hl-good', tempo * 880), i * tempo * 1000);
    });
  }

  // sight reading (score → keyboard) ─────────────────────────────────────────
  // The score replaces the "listen first" stage: it is the question. Nothing
  // sounds until the user asks, and the answer is played back on the keyboard.
  function scoreTitle() {
    const where = q.notation === 'tab' ? t('guitar tab') : t('treble staff');
    return translate(`C major melody, ${q.notes.length} notes, ${where}`);
  }

  function renderReading() {
    userMidis = [];
    const scoreWrap = h('div', { class: 'score-wrap' });
    // Phones get two bars per line, wide screens four: the same melody, drawn
    // at a size that can actually be read rather than scaled down to fit.
    const barsPerSystem = (typeof window !== 'undefined' && window.innerWidth <= 520) ? 2 : 4;
    const layout = layoutScore(q.notes, {
      notation: q.notation, showNames: q.showNames, barsPerSystem,
    });
    scoreWrap.style.maxWidth = `${Math.max(SCORE_MAX_W + 20, layout.width + 12)}px`;
    scoreWrap.innerHTML = renderScore(q.notes, {
      notation: q.notation,
      showNames: q.showNames,
      barsPerSystem,
      title: scoreTitle(),
      desc: t('A short melody written on the page. Play it back on the keyboard, in order.'),
    });

    slotEls = q.targetMidis.map(() => h('div', { class: 'slot note' }, '·'));

    const pianoWrap = h('div', { class: 'piano-wrap' });
    answersEl.append(
      scoreWrap,
      h('div', { class: 'slots tight' }, slotEls),
      pianoWrap,
      h('div', { class: 'seq-tools' },
        h('button', { class: 'btn small', onclick: undoNote }, '⌫ Undo')));

    piano = createPiano(pianoWrap, q.keyRange[0], q.keyRange[1], {
      tonic: q.tonicMidi,
      onKey: midi => {
        if (answered) return;
        if (userMidis.length >= q.targetMidis.length) return;
        userMidis.push(midi);
        const i = userMidis.length - 1;
        slotEls[i].textContent = midiName(midi);
        slotEls[i].classList.add('filled');
        if (userMidis.length === q.targetMidis.length) submitReading();
      },
    });
  }

  function submitReading() {
    const result = q.grade(userMidis);
    piano.setEnabled(false);
    for (let i = 0; i < q.targetMidis.length; i++) {
      slotEls[i].classList.add(userMidis[i] === q.targetMidis[i] ? 'good' : 'bad');
    }
    // Mark the score itself, so a wrong note is visible where it was read.
    answersEl.querySelectorAll('.snote').forEach(el => {
      const i = Number(el.getAttribute('data-note'));
      el.classList.add(userMidis[i] === q.targetMidis[i] ? 'good' : 'bad');
    });

    const extra = [];
    if (!result.correct) {
      extra.push(h('div', { class: 'fb-detail' },
        `Answer: ${q.targetMidis.map(midiName).join(' ')}`));
    }
    extra.push(h('div', { class: 'fb-compare' },
      h('button', { class: 'btn small', onclick: () => q.playMelodyOnly() }, '▶ Hear the answer')));
    finishAnswer(result, extra);
  }

  // ── keyboard shortcuts ─────────────────────────────────────────────────────
  function onKeydown(e) {
    if (gestureOn) return;   // eyes-closed mode: gestures are the only input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'r' || e.key === 'R') { Audio.unlock(); playQ(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      Audio.unlock();
      if (answered) { clearAuto(); nextQuestion(); }
      else if (!everPlayed) playQ();
      return;
    }
    if (e.key === 'Backspace') {
      if (q?.kind === 'sequence') { e.preventDefault(); undoSlot(); }
      if (q?.kind === 'melody' || q?.kind === 'reading') { e.preventDefault(); undoNote(); }
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const idx = e.key === '0' ? 9 : Number(e.key) - 1;
      if (!q?.options || !q.options[idx]) return;
      Audio.unlock();
      if (q.kind === 'choice') {
        if (!answered) answerChoice(q.options[idx].id);
        else auditionChoice(q.options[idx].id);
      }
      if (q.kind === 'sequence' && !answered) fillSlot(q.options[idx].id);
    }
  }
  document.addEventListener('keydown', onKeydown);

  // Any tap in the session unlocks audio (iOS) before it's needed.
  shell.addEventListener('pointerdown', () => Audio.unlock());

  // Native heartbeat (screen-off practice): if WebView timers were throttled,
  // this still resumes audio and honours a pending auto-advance.
  window.__practiceTick = () => {
    try { Audio.unlock(); } catch { /* no context yet */ }
    if (answered && autoAt && Date.now() >= autoAt) {
      clearAuto();
      nextQuestion();
    }
    try { window.AndroidPractice?.tick?.(); } catch { /* web build */ }
  };

  // ── native screen-off handover ─────────────────────────────────────────────
  // When the screen locks the service takes the loop over; the page only waits
  // for the results (delivered when it becomes visible again).
  window.__nativeTakeover = () => {
    if (voiceOn) voice.pause();
  };

  window.__nativeResults = payload => {
    let data = payload;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { data = {}; }
    }

    let added = 0;
    let right = 0;
    for (const r of data?.results ?? []) {
      if (!r || !r.itemKey) continue;
      const ok = !!r.correct;
      added++;
      if (ok) right++;
      State.recordAnswer(r.moduleId, [{ key: r.itemKey, correct: ok }], ok,
        ok ? null : { correctId: r.answerId, answeredId: r.answeredId }, 'choice');
    }
    if (added) {
      sessionN += added;
      sessionC += right;
      updateScore();
    }

    if (data?.stopped) {
      setVoice(false);
    } else if (voiceOn) {
      voice.resume();
      prepareNativeSession();
    }
    nextQuestion();
  };

  nextQuestion();

  return () => {
    if (window.__practiceTick) delete window.__practiceTick;
    if (window.__nativeTakeover) delete window.__nativeTakeover;
    if (window.__nativeResults) delete window.__nativeResults;
    document.removeEventListener('keydown', onKeydown);
    hideHelp();
    unbindGestures();
    voice.dispose();
    compareRun++;
    cancelSpeech();
    clearAuto();
    Audio.stopAll();
  };
}
