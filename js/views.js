// views.js — home, stats, settings, guide.

import { h, fmtPct, go } from './ui.js';
import * as State from './state.js';
import * as Audio from './audio.js';
import { MODULES, moduleById } from './curriculum.js';
import { INTERVALS, CHORDS, SCALES, DEGREES, pitchClassName } from './theory.js';
import { track } from './analytics.js';
import { APP_VERSION, REPO_URL } from './config.js';
import { language, isLanguageFixed, theoryName } from './i18n.js';

// ── shared chrome ─────────────────────────────────────────────────────────────

function topbar(active = '') {
  const link = (route, label, key) =>
    h('a', { class: 'nav-link' + (active === key ? ' active' : ''), href: route }, label);
  return h('header', { class: 'topbar' },
    h('a', { class: 'logo', href: '#/' }, h('span', { class: 'logo-mark' }, '◖♪'), 'earpath'),
    h('nav', { class: 'nav' },
      link('#/guide', 'Guide', 'guide'),
      link('#/stats', 'Stats', 'stats'),
      link('#/settings', 'Settings', 'settings')));
}

// ── home ──────────────────────────────────────────────────────────────────────

export function renderHome(root) {
  const page = h('div', { class: 'page' },
    topbar(),
    h('p', { class: 'home-intro' },
      'Pick an exercise and start — everything is customisable inside each one, and your progress stays in this browser.'),

    h('section', { class: 'module-grid' },
      MODULES.map(mod => {
        const ms = State.moduleStats(mod.id);
        return h('button', {
          class: 'card module-card',
          style: { '--mc': `var(--c-${mod.color})` },
          onclick: () => go(`#/practice/${mod.id}`),
        },
          h('div', { class: 'mc-head' },
            h('span', { class: 'mc-icon' }, mod.icon),
            h('span', { class: 'mc-title' }, mod.title),
            ms.a > 0
              ? h('span', { class: 'mc-count' }, `${fmtPct(ms.c, ms.a)} · ${ms.a}`)
              : null),
          h('div', { class: 'mc-blurb' }, mod.blurb));
      })),

    h('footer', { class: 'foot' },
      h('span', {}, 'earpath — free & open source ear training. '),
      h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'GitHub'),
      h('span', {}, ` · v${APP_VERSION} · `),
      h('a', { href: `${REPO_URL}/blob/main/CHANGELOG.md`, target: '_blank', rel: 'noopener' }, 'changelog')));

  root.append(page);
  return () => {};
}

// ── stats ─────────────────────────────────────────────────────────────────────

function statCard(icon, big, label, sub) {
  return h('div', { class: 'card stat-card' },
    h('div', { class: 'sc-icon' }, icon),
    h('div', { class: 'sc-big' }, big),
    h('div', { class: 'sc-label' }, label),
    sub ? h('div', { class: 'tiny muted' }, sub) : null);
}

export function renderStats(root, focusModuleId = null) {
  const s = State.state;
  const practiced = MODULES.filter(m => State.moduleStats(m.id).a > 0).length;
  const confusions = State.topConfusions(8);

  const confName = (moduleId, id) => {
    const base = moduleId === 'intervals' ? INTERVALS[id]?.name
      : moduleId === 'chords' ? CHORDS[id]?.name
      : moduleId === 'scales' ? SCALES[id]?.name
      : moduleId === 'degrees' ? DEGREES[id]?.solfege ?? id
      : moduleId === 'absolute' ? pitchClassName(id)
      : id;
    return theoryName(moduleId, id, base);
  };

  function comparePlay(moduleId, id) {
    Audio.unlock();
    Audio.stopAll();
    const root = 60;
    if (moduleId === 'intervals' && INTERVALS[id]) {
      Audio.playEvents(Audio.intervalEvents(root, INTERVALS[id].semis, 'a'));
    } else if (moduleId === 'chords' && CHORDS[id]) {
      Audio.playEvents(Audio.chordEvents(root, CHORDS[id].semis, s.settings.chordStyle));
    } else if (moduleId === 'scales' && SCALES[id]) {
      Audio.playEvents(Audio.scaleEvents(root, SCALES[id].semis));
    } else if (moduleId === 'degrees') {
      const deg = DEGREES[id];
      if (deg) Audio.playEvents([
        { midi: root, at: 0, dur: 0.6 },
        { midi: root + deg.semis, at: 0.75, dur: 0.9 },
      ]);
    } else if (moduleId === 'absolute' && id !== undefined && id !== null && id !== '') {
      Audio.playEvents([{ midi: root + Number(id), at: 0, dur: 0.9 }]);
    }
  }

  const playable = mid => ['intervals', 'chords', 'scales', 'degrees', 'absolute'].includes(mid);

  // One answer's row: name, how often it was missed, and — expanded — what got
  // picked instead, as a share of that answer's misses.
  const answerRow = (moduleId, ans) => {
    const wrongPct = Math.round((ans.wrongTotal / ans.a) * 100);
    return h('details', { class: 'ans-row' },
      h('summary', {},
        h('span', { class: 'ans-name' }, confName(moduleId, ans.id) ?? ans.id),
        h('span', { class: 'ans-bar' },
          h('span', { class: 'ans-fill', style: { width: `${wrongPct}%` } })),
        h('span', { class: 'ans-num' },
          ans.wrongTotal ? `${wrongPct}% wrong` : 'all right',
          h('span', { class: 'tiny muted' }, ` ${ans.wrongTotal}/${ans.a}`))),
      ans.wrong.length
        ? h('div', { class: 'wrong-list' },
            ans.wrong.map(([pickedId, n]) => h('div', { class: 'wrong-row' },
              h('span', {}, confName(moduleId, pickedId) ?? pickedId),
              h('span', { class: 'tiny muted' },
                `${n}× · ${Math.round((n / ans.wrongTotal) * 100)}% of misses`))))
        : h('div', { class: 'wrong-list tiny muted' }, 'No misses recorded for this answer.'));
  };

  // Two-step destructive action — no native confirm() in this app: the first
  // tap arms the button for a few seconds and says what would go, the second
  // one actually clears it. Disabled outright when there is nothing to clear.
  const clearButton = (mod, ms) => {
    if (!ms.a) {
      return h('button', {
        class: 'btn small danger', disabled: '', title: 'No data recorded for this exercise yet',
      }, '🗑 Clear');
    }
    const btn = h('button', { class: 'btn small danger' });
    let timer = null;
    const disarm = () => {
      btn.classList.remove('armed');
      btn.textContent = '🗑 Clear';
    };
    btn.textContent = '🗑 Clear';
    btn.addEventListener('click', () => {
      if (btn.classList.contains('armed')) {
        clearTimeout(timer);
        State.clearModule(mod.id);
        Audio.stopAll();
        root.innerHTML = '';
        renderStats(root, mod.id);
        return;
      }
      btn.classList.add('armed');
      btn.textContent = `Clear ${ms.a} answers? Tap again`;
      timer = setTimeout(disarm, 4000);
    });
    return btn;
  };

  let focusRef = null;

  const page = h('div', { class: 'page' },
    topbar('stats'),
    h('h1', {}, 'Your progress'),
    h('div', { class: 'stat-cards' },
      statCard('🎯', fmtPct(s.totals.c, s.totals.a), 'accuracy', `${s.totals.a} answers`),
      statCard('✓', String(s.totals.c), 'correct', ''),
      statCard('◖♪', `${practiced}/${MODULES.length}`, 'exercises tried', '')),

    h('h2', {}, 'Exercises'),
    h('div', { class: 'stat-modules' },
      MODULES.map(mod => {
        const ms = State.moduleStats(mod.id);
        const breakdown = State.answerBreakdown(mod.id);
        const det = h('details', { class: 'stat-mod card', style: { '--mc': `var(--c-${mod.color})` } },
          h('summary', { class: 'sm-sum' },
            h('span', { class: 'mc-icon' }, mod.icon),
            h('div', { class: 'sm-main' },
              h('div', { class: 'sm-title' }, mod.title),
              h('div', { class: 'sm-bar' },
                h('div', {
                  class: 'sm-fill',
                  style: { width: `${ms.a ? (ms.c / ms.a) * 100 : 0}%` },
                }))),
            h('div', { class: 'sm-side' }, ms.a ? fmtPct(ms.c, ms.a) : '—',
              h('div', { class: 'tiny muted' }, ms.a ? `${ms.a} answers` : '')),
            h('span', { class: 'sm-chev' }, '›')),
          h('div', { class: 'sm-body' },
            h('div', { class: 'sm-actions' },
              h('button', {
                class: 'btn small ghost',
                onclick: () => go(`#/practice/${mod.id}`),
              }, `▶ Practice ${mod.title}`),
              clearButton(mod, ms)),
            breakdown.length
              ? h('div', { class: 'ans-list' },
                  h('div', { class: 'tiny muted ans-head' },
                    'Per-answer accuracy, worst first — open an answer for what gets picked instead'),
                  breakdown.map(ans => answerRow(mod.id, ans)))
              : h('div', { class: 'tiny muted' },
                  'Per-answer detail appears once you have answered a few questions.')));
        if (focusModuleId === mod.id) focusRef = det;
        return det;
      })),

    confusions.length ? h('h2', {}, 'Often confused') : null,
    confusions.length
      ? h('div', { class: 'confusions' },
          confusions.map(cf => {
            const modTitle = moduleById(cf.moduleId)?.title ?? cf.moduleId;
            const aName = confName(cf.moduleId, cf.correctId) ?? cf.correctId;
            const bName = confName(cf.moduleId, cf.answeredId) ?? cf.answeredId;
            return h('div', { class: 'card confusion-row' },
              h('div', { class: 'cf-main' },
                h('div', {}, h('strong', {}, aName), ' heard as ', h('strong', {}, bName)),
                h('div', { class: 'tiny muted' }, `${modTitle} · ${cf.count}×`)),
              playable(cf.moduleId)
                ? h('div', { class: 'cf-btns' },
                    h('button', { class: 'btn small', onclick: () => comparePlay(cf.moduleId, cf.correctId) }, `▶ ${aName}`),
                    h('button', { class: 'btn small', onclick: () => comparePlay(cf.moduleId, cf.answeredId) }, `▶ ${bName}`))
                : null);
          }))
      : null);

  root.append(page);
  // Deep link from a practice screen: open that exercise's breakdown and bring
  // it into view.
  if (focusRef) {
    focusRef.open = true;
    focusRef.scrollIntoView({ block: 'center' });
  }
  return () => { Audio.stopAll(); };
}

// ── settings ──────────────────────────────────────────────────────────────────

export function renderSettings(root) {
  const s = State.state.settings;

  const row = (label, desc, control) =>
    h('div', { class: 'card setting-row' },
      h('div', { class: 'set-main' },
        h('div', { class: 'set-label' }, label),
        desc ? h('div', { class: 'tiny muted' }, desc) : null),
      control);

  const select = (value, options, onChange) => {
    const sel = h('select', { class: 'select', onchange: e => onChange(e.target.value) },
      options.map(([v, label]) =>
        h('option', { value: v, ...(v === value ? { selected: '' } : {}) }, label)));
    return sel;
  };

  // A free numeric setting: any value in range, clamped on commit so a stray
  // entry can never leave the app with an unusable number.
  const numberInput = (value, { min, max, step = 10, onInput }) =>
    h('input', {
      class: 'num', type: 'number', value: String(value),
      min: String(min), max: String(max), step: String(step),
      onchange: e => {
        const clamped = Math.min(max, Math.max(min, Math.round(Number(e.target.value) || value)));
        e.target.value = String(clamped);
        onInput(clamped);
      },
    });

  const toggle = (value, onChange) => {
    const btn = h('button', {
      class: 'toggle' + (value ? ' on' : ''),
      role: 'switch', 'aria-checked': String(value),
      onclick: () => {
        const on = !btn.classList.contains('on');
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-checked', String(on));
        onChange(on);
      },
    }, h('span', { class: 'knob' }));
    return btn;
  };

  const fileInput = h('input', {
    type: 'file', accept: '.json,application/json', style: { display: 'none' },
    onchange: async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        State.importJSON(await file.text());
        alert('Progress imported. Welcome back!');
        go('#/');
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    },
  });

  const gestureModeRow = row('Gesture mode', 'Tap counting: tap N times. Hold to count: hold still and release after N ticks.',
    select(s.gestureMode, [
      ['tap', 'Tap counting'],
      ['hold', 'Hold to count'],
    ], v => {
      s.gestureMode = v === 'hold' ? 'hold' : 'tap';
      State.save();
      syncGestureSettings();
    }));

  const tapWindowRow = row('Gesture tap window', 'Tap counting only: how long the app waits for another tap before taking your answer, in milliseconds — shorter means quicker feedback. 250 is quick, 350 normal, 550 relaxed. Applies from the next exercise you open.',
    numberInput(s.tapWindowMs, {
      min: State.TAP_WINDOW_MIN,
      max: State.TAP_WINDOW_MAX,
      onInput: v => { s.tapWindowMs = State.clampTapWindow(v); State.save(); },
    }));

  const holdRepeatRow = row('Hold repeat interval', 'Hold to count only: one tick every this many milliseconds (200–2000); N ticks = option N. Applies from the next exercise you open.',
    numberInput(s.holdRepeatMs, {
      min: State.HOLD_REPEAT_MIN,
      max: State.HOLD_REPEAT_MAX,
      step: 50,
      onInput: v => { s.holdRepeatMs = State.clampHoldRepeat(v); State.save(); },
    }));

  function syncGestureSettings() {
    tapWindowRow.style.display = s.gestureMode === 'hold' ? 'none' : '';
    holdRepeatRow.style.display = s.gestureMode === 'hold' ? '' : 'none';
  }
  syncGestureSettings();

  const page = h('div', { class: 'page' },
    topbar('settings'),
    h('h1', {}, 'Settings'),
    h('p', { class: 'muted' }, 'Per-exercise question pools live in each exercise’s Options panel.'),
    isLanguageFixed() ? null : row('Language', 'Interface and answer language.',
      h('div', { 'data-no-i18n': '' },
        select(language(), [
          ['en', 'English'],
          ['zh', '简体中文'],
        ], v => { s.language = v; State.save(); location.reload(); }))),
    (typeof window !== 'undefined' && window.AndroidPractice)
      ? row('Background reliability', 'Allow the app to keep running while the screen is off.',
        h('button', {
          class: 'btn small',
          onclick: () => window.AndroidPractice.requestBatteryExemption(),
        }, 'Allow'))
      : null,

    row('Volume', 'Output level for all playback.',
      h('input', {
        type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume), class: 'slider',
        oninput: e => {
          s.volume = Number(e.target.value);
          Audio.setVolume(s.volume);
        },
        onchange: () => { State.save(); Audio.unlock(); Audio.playNote(60, 0.4); },
      })),
    row('Auto-advance', 'Move to the next question automatically after a correct answer.',
      toggle(s.autoAdvance, v => { s.autoAdvance = v; State.save(); })),
    gestureModeRow,
    tapWindowRow,
    holdRepeatRow,
    row('Voice idle timeout', 'Voice mode turns itself off after this many minutes without a recognised answer or command (1–60). Default 10.',
      numberInput(s.voiceTimeoutMin, {
        min: State.VOICE_TIMEOUT_MIN,
        max: State.VOICE_TIMEOUT_MAX,
        step: 1,
        onInput: v => { s.voiceTimeoutMin = State.clampVoiceTimeout(v); State.save(); },
      })),
    row('Chord playback', 'Arpeggiating after the block chord helps you hear individual notes.',
      select(s.chordStyle, [
        ['block', 'Block chord only'],
        ['block+arp', 'Block, then arpeggio'],
        ['arp', 'Arpeggio only'],
      ], v => { s.chordStyle = v; State.save(); })),
    row('Scale degree labels', 'Movable-do solfege or scale-degree numbers.',
      select(s.degreeLabels, [
        ['solfege', 'Solfege (Do Re Mi)'],
        ['number', 'Numbers (1 2 3)'],
      ], v => { s.degreeLabels = v; State.save(); })),
    row('Melody speed', 'How fast dictation melodies are played.',
      select(String(s.melodyTempo), [
        ['0.7', 'Relaxed'],
        ['0.55', 'Medium'],
        ['0.42', 'Brisk'],
      ], v => { s.melodyTempo = Number(v); State.save(); })),

    h('h2', {}, 'Your data'),
    row('Export progress', 'Download a JSON backup of all progress and settings.',
      h('button', {
        class: 'btn', onclick: () => {
          const blob = new Blob([State.exportJSON()], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `music-ear-backup-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        },
      }, 'Export')),
    row('Import progress', 'Restore from a backup file. Replaces current progress.',
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Import')),
    row('Reset everything', 'Delete all progress and start over. Cannot be undone.',
      h('button', {
        class: 'btn danger', onclick: () => {
          if (confirm('Really delete all progress? This cannot be undone.')) {
            State.resetAll();
            go('#/');
          }
        },
      }, 'Reset')),
    fileInput);

  root.append(page);
  return () => {};
}

// ── guide ─────────────────────────────────────────────────────────────────────

export function renderGuide(root) {
  const songRows = Object.entries(INTERVALS)
    .filter(([, iv]) => iv.songs?.asc || iv.songs?.desc)
    .map(([id, iv]) =>
      h('tr', {},
        h('td', {}, h('strong', { 'data-no-i18n': '' }, theoryName('intervals', id, iv.name))),
        h('td', {}, iv.songs.asc || '—'),
        h('td', {}, iv.songs.desc || '—')));

  const page = h('div', { class: 'page guide' },
    topbar('guide'),
    h('h1', {}, 'How to get better, faster'),
    h('p', {}, 'Ear training is a physical skill, like balance. It responds to ', h('strong', {}, 'short, frequent practice'), ' — five focused minutes a day beats an hour on Sunday. Use each exercise’s Options to keep the pool just outside your comfort zone.'),
    h('div', { class: 'card tipcard' },
      h('h3', {}, '🎤 Sing. Seriously.'),
      h('p', {}, 'The single biggest accelerator. Hum or sing what you hear before you answer — intervals, the notes of a chord, melodies. Connecting your voice to your ear builds the skill twice as fast. Nobody can hear you.')),
    h('div', { class: 'card tipcard' },
      h('h3', {}, '🧭 When you miss, compare.'),
      h('p', {}, 'After a wrong answer, use the “Your pick / Answer” buttons to hear both back-to-back. The difference between what you thought and what it was is exactly where your ear grows.')),
    h('div', { class: 'card tipcard' },
      h('h3', {}, '🌱 Feeling stuck? Narrow the pool.'),
      h('p', {}, 'Drop the hardest items from an exercise’s Options for a day to rebuild confidence, or switch exercises — skills cross-pollinate. Scale-degree work makes intervals easier, and vice versa.')),

    h('h2', {}, 'Listening strategies by exercise'),
    MODULES.map(mod =>
      h('div', { class: 'card tipcard', style: { '--mc': `var(--c-${mod.color})` } },
        h('h3', {}, `${mod.icon} ${mod.title}`),
        h('p', {}, mod.tip))),

    h('h2', {}, 'Interval reference songs'),
    h('p', { class: 'muted' }, 'Anchor each interval to a melody you already know. These also appear as hints when you miss an interval.'),
    h('table', { class: 'songs' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Interval'), h('th', {}, 'Ascending'), h('th', {}, 'Descending'))),
      h('tbody', {}, songRows)),

    h('h2', {}, 'About & privacy'),
    h('p', { class: 'muted' },
      'earpath is free, open source, and runs entirely in your browser — no account, no server, your progress lives on your device (use Settings → Export for backups). ',
      h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Source on GitHub'),
      '.'),
    h('p', { class: 'muted' },
      'Privacy: no analytics, no network calls beyond loading this page. Feedback you submit through the 💬 button is read by a human.'));

  root.append(page);
  return () => {};
}
