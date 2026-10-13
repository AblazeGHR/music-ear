// session.js — the practice screen: question loop, answer UIs for choice /
// sequence / melody questions, feedback, and the exercise's Options panel.

import { h, go } from './ui.js';
import * as Audio from './audio.js';
import * as Engine from './engine.js';
import * as State from './state.js';
import { moduleById } from './curriculum.js';
import { renderOptions } from './options.js';
import { createRecognizer, bindPointerSurface } from './gesture.js';
import { createPiano } from './piano.js';
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
  // Only multiple-choice questions with a small pool get it: counting taps to
  // twelve while blind is not a skill anyone needs, so the switch simply is
  // not offered there.
  const MAX_GESTURE_OPTIONS = 8;
  const KBD_HINT = '1–9 answer · R replay · ⏎ next · ⌫ undo';
  const GESTURE_HINT = 'Tap ×N = option N · Hold = next · Circle = replay';
  let gestureOn = false;
  let compareTimers = [];
  let lastChoiceId = null;
  let lastResultCorrect = null;

  const gestureBtn = h('button', {
    class: 'gesture-switch', role: 'switch', 'aria-checked': 'false',
    onclick: () => setGesture(!gestureOn),
  }, 'Gesture');
  const helpBtn = h('button', {
    class: 'gesture-help-btn', 'aria-label': 'How gestures map to the buttons', title: 'How gestures map to the buttons',
    onclick: () => showHelp(),
  }, '?');
  const kbdEl = h('div', { class: 's-kbd' }, KBD_HINT);
  const overlay = h('div', { class: 'gesture-overlay' });

  const recognizer = createRecognizer({
    onTap: () => { if (gestureOn) Audio.playNote(84, 0.045); },   // count ticks
    onCommit: n => { if (gestureOn) submitByCount(n); },
    onHold: () => { if (gestureOn) { clearAuto(); nextQuestion(); } },
    onCircle: () => { if (gestureOn) playQ(); },
  });
  const unbindGestures = bindPointerSurface(overlay, recognizer);

  function setGesture(on) {
    gestureOn = on;
    shell.classList.toggle('gesture-on', on);
    gestureBtn.classList.toggle('on', on);
    gestureBtn.setAttribute('aria-checked', String(on));
    kbdEl.textContent = on ? GESTURE_HINT : KBD_HINT;
    recognizer.reset();
    if (on) { hideHelp(); Audio.playNote(76, 0.1); }   // audible "it's on"
  }

  // ── gesture help: what each gesture stands in for ──────────────────────────
  let helpOverlay = null;

  function showHelp() {
    if (helpOverlay) return;
    const ghRow = (gesture, meaning) => h('div', { class: 'gh-row' },
      h('span', { class: 'gh-g' }, gesture),
      h('span', { class: 'gh-arrow' }, '→'),
      h('span', { class: 'gh-b' }, meaning));
    helpOverlay = h('div', {
      class: 'overlay',
      onclick: e => { if (e.target === helpOverlay) hideHelp(); },
    },
      h('div', { class: 'gesture-help card' },
        h('h2', {}, 'Gesture mode'),
        h('p', { class: 'muted' }, 'With the switch on, these gestures stand in for the buttons:'),
        h('div', { class: 'gh-rows' },
          ghRow('Tap once', 'the 1st answer button'),
          ghRow('Tap N times', 'the Nth answer button — a tick plays on every tap so you can count with your eyes closed'),
          ghRow('Press and hold', 'Next → — or skip the question if you have not answered'),
          ghRow('Draw a circle', '▶ Play / replay — after a wrong answer it plays your pick, then the real one')),
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
    if (!q || answered || !everPlayed) return;
    if (q.kind !== 'choice') return;
    if (n < 1 || n > q.options.length) return;
    answerChoice(q.options[n - 1].id);
  }

  function syncGestureAffordance() {
    const eligible = !!q && q.kind === 'choice' && q.options.length <= MAX_GESTURE_OPTIONS;
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
      scoreEl, gestureBtn, helpBtn),
    h('main', { class: 's-body' },
      h('div', { class: 's-stage' }, playBtn, promptEl, howToEl),
      answersEl, feedbackEl, actionsEl,
      optionsEl,
      kbdEl),
    overlay);
  root.append(shell);

  // ── helpers ────────────────────────────────────────────────────────────────
  function updateScore() {
    scoreEl.textContent = sessionN ? `✓ ${sessionC}/${sessionN}` : '';
  }

  const pause = ms => new Promise(r => setTimeout(r, ms));

  async function playQ() {
    if (!q) return;
    everPlayed = true;
    playBtn.classList.add('playing');
    shell.classList.remove('awaiting-play');
    try {
      // After a miss, replay is the A/B itself: your pick, then the real
      // answer — the same pairing the buttons offer, but via play/circle/R.
      const compareAfterMiss = answered && lastResultCorrect === false
        && typeof q.playOption === 'function' && lastChoiceId !== null;
      if (compareAfterMiss) {
        for (const t of compareTimers) clearTimeout(t);
        compareTimers = [];
        await q.playOption(lastChoiceId);
        await pause(200);
        await q.playOption(q.answerId);
      } else {
        // First play is the question as generated; replays may re-voice it
        // (e.g. a different direction) so the answer is learned as a sound.
        const replay = qPlays > 0 && typeof q.replay === 'function';
        qPlays++;
        await (replay ? q.replay() : q.play());
      }
    } finally { playBtn.classList.remove('playing'); }
    playBtn.textContent = '↻';
  }

  function clearAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  function nextQuestion() {
    clearAuto();
    for (const t of compareTimers) clearTimeout(t);
    compareTimers = [];
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
    syncGestureAffordance();
    if (everPlayed) playQ();
    else shell.classList.add('awaiting-play');
  }

  function finishAnswer(result, extraFeedback) {
    answered = true;
    lastResultCorrect = result.correct;
    sessionN++;
    if (result.correct) sessionC++;
    State.recordAnswer(q.moduleId, result.itemResults, result.correct, result.confusion);
    updateScore();
    track('question_answered', { module: q.moduleId, kind: q.kind, correct: result.correct });

    renderFeedback(result, extraFeedback);

    // Eyes-closed feedback: a blip means right; wrong answers play your pick
    // and then the real one, so the comparison is heard without any button.
    if (gestureOn) {
      if (result.correct) {
        Audio.playNote(91, 0.14);
      } else if (q.playOption && lastChoiceId !== null) {
        compareTimers.push(setTimeout(() => q.playOption(lastChoiceId), 350));
        compareTimers.push(setTimeout(() => q.playOption(q.answerId), 1250));
      }
    }

    const nextBtn = h('button', { class: 'btn primary', onclick: nextQuestion }, 'Next →');
    actionsEl.append(nextBtn);
    if (result.correct && State.state.settings.autoAdvance) {
      autoTimer = setTimeout(nextQuestion, 1100);
    } else {
      nextBtn.focus();
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
    else renderMelody();
  }

  // choice ────────────────────────────────────────────────────────────────────
  function renderChoice() {
    optionBtns = q.options.map((opt, i) =>
      h('button', { class: 'opt', onclick: () => answerChoice(opt.id) },
        i < 10 ? h('span', { class: 'opt-kbd' }, String((i + 1) % 10)) : null,
        h('span', { class: 'opt-label' }, opt.label),
        opt.sub ? h('span', { class: 'opt-sub' }, opt.sub) : null));
    answersEl.append(h('div', { class: 'opt-grid' }, optionBtns));
  }

  function answerChoice(id) {
    if (answered || !everPlayed) return;
    lastChoiceId = id;
    const result = q.grade(id);
    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i], btn = optionBtns[i];
      btn.disabled = true;
      if (opt.id === q.answerId) btn.classList.add('good');
      else if (opt.id === id) btn.classList.add('bad');
      else btn.classList.add('dim');
    }
    const extra = [];
    const correctOpt = q.options.find(o => o.id === q.answerId);
    if (!result.correct) {
      const yourOpt = q.options.find(o => o.id === id);
      extra.push(h('div', { class: 'fb-detail' },
        `It was ${correctOpt.label} — you chose ${yourOpt.label}.`));
      if (q.playOption) {
        extra.push(h('div', { class: 'fb-compare' },
          h('button', { class: 'btn small', onclick: () => q.playOption(id) }, '▶ Your pick'),
          h('button', { class: 'btn small', onclick: () => q.playOption(q.answerId) }, '▶ Answer')));
      }
    } else {
      extra.push(h('div', { class: 'fb-detail' }, correctOpt.label));
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
      if (q?.kind === 'melody') { e.preventDefault(); undoNote(); }
      return;
    }
    if (/^[0-9]$/.test(e.key) && !answered) {
      const idx = e.key === '0' ? 9 : Number(e.key) - 1;
      Audio.unlock();
      if (q?.kind === 'choice' && q.options[idx]) answerChoice(q.options[idx].id);
      if (q?.kind === 'sequence' && q.options[idx]) fillSlot(q.options[idx].id);
    }
  }
  document.addEventListener('keydown', onKeydown);

  // Any tap in the session unlocks audio (iOS) before it's needed.
  shell.addEventListener('pointerdown', () => Audio.unlock());

  nextQuestion();

  return () => {
    document.removeEventListener('keydown', onKeydown);
    hideHelp();
    unbindGestures();
    for (const t of compareTimers) clearTimeout(t);
    clearAuto();
    Audio.stopAll();
  };
}
