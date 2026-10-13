// main.js — bootstrapping and hash routing.

import * as State from './state.js';
import * as Audio from './audio.js';
import { renderHome, renderStats, renderSettings, renderGuide } from './views.js';
import { renderPractice } from './session.js';
import { initAnalytics, track } from './analytics.js';
import { mountFeedback, setFeedbackVisible } from './feedback.js';

const app = document.getElementById('app');
let cleanup = null;

function route() {
  if (cleanup) { try { cleanup(); } catch { /* view already gone */ } cleanup = null; }
  app.innerHTML = '';
  window.scrollTo(0, 0);

  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [view, a] = parts;

  // Keep the floating feedback button out of the way while practicing.
  setFeedbackVisible(view !== 'practice');
  track('screen', { view: view || 'home', module: view === 'practice' ? a : undefined });

  if (!view) cleanup = renderHome(app);
  else if (view === 'practice' && a) cleanup = renderPractice(app, a);
  else if (view === 'stats') cleanup = renderStats(app);
  else if (view === 'settings') cleanup = renderSettings(app);
  else if (view === 'guide') cleanup = renderGuide(app);
  else cleanup = renderHome(app);
}

State.load();
Audio.setVolume(State.state.settings.volume);
initAnalytics();
track('app_open', { total_answers: State.state.totals.a });
mountFeedback();

window.addEventListener('hashchange', route);
route();

// Offline support (no-op during local file:// development).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
