// voice.js — session-level voice answering.
//
// Two backends behind one interface:
//   • Android shell: native Vosk (on-device, grammar-limited, offline)
//   • browsers: Web Speech API (network; unavailable in some regions)
//
// The controller owns listening windows only. What an utterance *means* is
// decided by voice-intent.js, and what an answer *does* stays in session.js.

import { parseIntent, grammarPhrases } from './voice-intent.js';
import { language } from './i18n.js';

const NativeASR = () => (typeof window !== 'undefined' ? window.AndroidASR : null);
const WebSpeech = () => (typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null);

export function voiceBackend() {
  if (NativeASR() && typeof NativeASR().start === 'function') return 'native';
  if (WebSpeech()) return 'web';
  return null;
}

export function voiceSupported() {
  return voiceBackend() !== null;
}

export function createVoiceController({ getCtx, getIdleMinutes, onAnswer, onCommand, onState, onHeard }) {
  const backend = voiceBackend();
  let on = false;
  let holds = 0;                 // playback / TTS pauses, nested
  let recon = null;              // web backend instance
  let restartTimer = null;
  let networkErrors = 0;
  let nativeBound = false;
  let lastFinal = { text: '', at: 0 };
  let lastHeard = '';
  let speechTimer = null;
  let idleTimer = null;

  function emitState(state, detail) { onState?.(state, detail); }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  const Practice = () => (typeof window !== 'undefined' ? window.AndroidPractice : null);

  function setScreenOffPractice(active) {
    const bridge = Practice();
    if (!bridge) return;
    try {
      if (active) bridge.start(language());
      else bridge.stop();
    } catch { /* web build */ }
  }

  function enable() {
    if (!backend) return false;
    on = true;
    networkErrors = 0;
    // If the mic is already granted this starts immediately; otherwise the
    // bridge waits for the permission result (and listening retries anyway).
    setScreenOffPractice(true);
    if (backend === 'native') {
      bindNative();
      try { NativeASR().prepare(language()); } catch { /* start() will retry */ }
    }
    startListening();
    armIdle();
    return true;
  }

  function disable() {
    on = false;
    setScreenOffPractice(false);
    holds = 0;
    clearRestart();
    clearTimeout(idleTimer);
    idleTimer = null;
    clearTimeout(speechTimer);
    speechTimer = null;
    stopListening();
    emitState('off');
  }

  // The timeout is about walking away, not about a hard session limit: any
  // recognised answer or command resets it, silence (or noise) does not.
  function armIdle() {
    clearTimeout(idleTimer);
    if (!on) return;
    const minutes = Math.max(1, Math.round(Number(getIdleMinutes?.() ?? 10) || 10));
    idleTimer = setTimeout(() => {
      if (!on) return;
      disable();
      emitState('timeout', String(minutes));
    }, minutes * 60000);
  }

  function isOn() { return on; }

  // Nested holds: the recogniser is off while the question, the A/B comparison
  // or the spoken answer is audible — otherwise it hears the app itself.
  function pause() {
    holds++;
    if (holds === 1) stopListening();
  }

  function resume() {
    if (holds > 0) holds--;
    if (on && holds === 0) startListening();
  }

  function dispose() {
    on = false;
    setScreenOffPractice(false);
    holds = 0;
    clearRestart();
    clearTimeout(speechTimer);
    clearTimeout(idleTimer);
    stopListening();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('music-ear:speech-start', onSpeechStart);
    window.removeEventListener('music-ear:speech-end', onSpeechEnd);
  }

  // ── listening ──────────────────────────────────────────────────────────────

  function startListening() {
    if (!on || holds > 0) return;
    const base = getCtx();
    if (!base) return;
    const ctx = { ...base, language: language() };
    if (backend === 'native') {
      bindNative();
      try {
        const phrases = grammarPhrases(ctx);
        // '' (not null) so native pending-start state survives the permission
        // prompt and model load; SpeechBridge treats an empty string as
        // "no grammar".
        NativeASR().start(phrases.length ? JSON.stringify(phrases) : '', language());
      } catch {
        emitState('error', 'audio');
      }
    } else {
      webStart();
    }
  }

  function stopListening() {
    clearRestart();
    if (backend === 'native') {
      const bridge = NativeASR();
      if (bridge && typeof bridge.stop === 'function') {
        try { bridge.stop(); } catch { /* already idle */ }
      }
    } else {
      stopWeb();
    }
  }

  function clearRestart() {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  }

  // ── native backend ─────────────────────────────────────────────────────────

  function bindNative() {
    if (nativeBound) return;
    nativeBound = true;
    window.__asr = {
      event(json) {
        const msg = typeof json === 'string' ? safeParse(json) : json;
        if (msg) handleNative(msg);
      },
    };
  }

  function handleNative(msg) {
    if (msg.type === 'state') {
      if (msg.value === 'preparing') emitState('preparing');
      else if (msg.value === 'ready') emitState(holds > 0 ? 'paused' : 'ready');
      else if (msg.value === 'listening') {
        setScreenOffPractice(true);
        emitState('listening');
      }
      else if (msg.value === 'idle') emitState(holds > 0 ? 'paused' : 'idle');
      return;
    }
    if (msg.type === 'partial') {
      if (on && holds === 0) onHeard?.(msg.text, null);
      return;
    }
    if (msg.type === 'final') {
      if (on && holds === 0) handleText(msg.text, true);
      return;
    }
    if (msg.type === 'error') {
      if (msg.code === 'permission') emitState('error', 'permission');
      else if (msg.code === 'model') emitState('fatal', 'model');
      else emitState('error', msg.code || 'audio');
    }
  }

  // ── web backend ────────────────────────────────────────────────────────────

  function webStart() {
    clearRestart();
    stopWeb();
    const Ctor = WebSpeech();
    if (!Ctor) return;
    const r = new Ctor();
    recon = r;
    r.lang = language() === 'zh' ? 'zh-CN' : 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = e => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) final += ` ${text}`;
        else interim += ` ${text}`;
      }
      if (interim.trim() && on && holds === 0) onHeard?.(interim.trim(), null);
      if (final.trim()) handleText(final.trim(), true);
    };

    r.onerror = e => {
      const code = e.error;
      if (code === 'aborted') return;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        emitState('fatal', 'permission');
        return;
      }
      if (code === 'network') {
        networkErrors++;
        emitState('error', 'network');
        if (networkErrors >= 3) emitState('fatal', 'network');
        return;
      }
      // no-speech / audio-capture: onend restarts with a small delay.
      if (code === 'audio-capture') emitState('error', 'audio');
    };

    r.onend = () => {
      if (recon !== r) return;
      recon = null;
      if (on && holds === 0) scheduleRestart();
    };

    try {
      r.start();
      emitState('listening');
    } catch {
      scheduleRestart();
    }
  }

  function stopWeb() {
    const r = recon;
    recon = null;
    if (!r) return;
    r.onend = null;
    r.onresult = null;
    r.onerror = null;
    try { r.abort(); } catch { /* already stopped */ }
  }

  function scheduleRestart() {
    clearRestart();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (on && holds === 0) webStart();
    }, 350);
  }

  // ── interpretation ─────────────────────────────────────────────────────────

  function handleText(text, isFinal) {
    if (!on || holds > 0) return;
    const clean = String(text || '').trim();
    if (!clean) return;

    // Recognisers repeat a final utterance when they restart; one command must
    // not skip two questions.
    const now = Date.now();
    if (lastFinal.text === clean.toLowerCase() && now - lastFinal.at < 1200) return;
    lastFinal = { text: clean.toLowerCase(), at: now };

    const base = getCtx();
    if (!base) return;
    const ctx = { ...base, language: language() };
    lastHeard = clean;
    const intent = parseIntent(clean, ctx);
    onHeard?.(clean, intent);

    if (intent.type === 'command') {
      armIdle();
      onCommand?.(intent.name);
      return;
    }
    if (intent.type === 'answer') {
      // Interim results are deliberately not committed: "major" may still
      // become "major seventh", and a wrong early guess is worse than 300 ms
      // of extra latency.
      if (!isFinal) return;
      armIdle();
      onAnswer?.(intent);
    }
  }

  // ── background / speech pauses ─────────────────────────────────────────────

  function onVisibility() {
    if (!on) return;
    if (document.hidden) stopListening();
    else if (holds === 0) startListening();
  }

  function onSpeechStart() {
    if (!on) return;
    pause();
    // If the engine never reports completion (no voices, failed init), do not
    // leave the microphone off forever.
    clearTimeout(speechTimer);
    speechTimer = setTimeout(onSpeechEnd, 12000);
  }

  function onSpeechEnd() {
    clearTimeout(speechTimer);
    speechTimer = null;
    if (on) resume();
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('music-ear:speech-start', onSpeechStart);
  window.addEventListener('music-ear:speech-end', onSpeechEnd);

  return { enable, disable, pause, resume, dispose, isOn, backend, heard: () => lastHeard };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}
