// icons.js — Lucide icons (ISC), https://lucide.dev
//
// Bundled as inline SVG so the app stays offline and needs no icon font.
// Icon paths are from lucide-static 0.468.0; see assets/icons/LICENSE.

const PATHS = {
  "arrow-up-down": "<path d=\"m21 16-4 4-4-4\" /> <path d=\"M17 20V4\" /> <path d=\"m3 8 4-4 4 4\" /> <path d=\"M7 4v16\" />",
  "hash": "<line x1=\"4\" x2=\"20\" y1=\"9\" y2=\"9\" /> <line x1=\"4\" x2=\"20\" y1=\"15\" y2=\"15\" /> <line x1=\"10\" x2=\"8\" y1=\"3\" y2=\"21\" /> <line x1=\"16\" x2=\"14\" y1=\"3\" y2=\"21\" />",
  "ruler": "<path d=\"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z\" /> <path d=\"m14.5 12.5 2-2\" /> <path d=\"m11.5 9.5 2-2\" /> <path d=\"m8.5 6.5 2-2\" /> <path d=\"m17.5 15.5 2-2\" />",
  "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\" /> <path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\" /> <path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\" />",
  "list-music": "<path d=\"M21 15V6\" /> <path d=\"M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z\" /> <path d=\"M12 12H3\" /> <path d=\"M16 6H3\" /> <path d=\"M12 18H3\" />",
  "target": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <circle cx=\"12\" cy=\"12\" r=\"6\" /> <circle cx=\"12\" cy=\"12\" r=\"2\" />",
  "git-branch": "<line x1=\"6\" x2=\"6\" y1=\"3\" y2=\"15\" /> <circle cx=\"18\" cy=\"6\" r=\"3\" /> <circle cx=\"6\" cy=\"18\" r=\"3\" /> <path d=\"M18 9a9 9 0 0 1-9 9\" />",
  "audio-lines": "<path d=\"M2 10v3\" /> <path d=\"M6 6v11\" /> <path d=\"M10 3v18\" /> <path d=\"M14 8v7\" /> <path d=\"M18 5v13\" /> <path d=\"M22 10v3\" />",
  "book-open": "<path d=\"M12 7v14\" /> <path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\" />",
  "arrow-left": "<path d=\"m12 19-7-7 7-7\" /> <path d=\"M19 12H5\" />",
  "mic": "<path d=\"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z\" /> <path d=\"M19 10v2a7 7 0 0 1-14 0v-2\" /> <line x1=\"12\" x2=\"12\" y1=\"19\" y2=\"22\" />",
  "hand": "<path d=\"M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2\" /> <path d=\"M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2\" /> <path d=\"M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8\" /> <path d=\"M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15\" />",
  "circle-help": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /> <path d=\"M12 17h.01\" />",
  "chart-no-axes-column": "<line x1=\"18\" x2=\"18\" y1=\"20\" y2=\"10\" /> <line x1=\"12\" x2=\"12\" y1=\"20\" y2=\"4\" /> <line x1=\"6\" x2=\"6\" y1=\"20\" y2=\"14\" />",
  "play": "<polygon points=\"6 3 20 12 6 21 6 3\" />",
  "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /> <path d=\"M3 3v5h5\" />",
  "volume-2": "<path d=\"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z\" /> <path d=\"M16 9a5 5 0 0 1 0 6\" /> <path d=\"M19.364 18.364a9 9 0 0 0 0-12.728\" />",
  "undo-2": "<path d=\"M9 14 4 9l5-5\" /> <path d=\"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11\" />",
  "check": "<path d=\"M20 6 9 17l-5-5\" />",
  "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  "message-circle": "<path d=\"M7.9 20A9 9 0 1 0 4 16.1L2 22Z\" />",
  "arrow-right": "<path d=\"M5 12h14\" /> <path d=\"m12 5 7 7-7 7\" />",
  "sliders-horizontal": "<line x1=\"21\" x2=\"14\" y1=\"4\" y2=\"4\" /> <line x1=\"10\" x2=\"3\" y1=\"4\" y2=\"4\" /> <line x1=\"21\" x2=\"12\" y1=\"12\" y2=\"12\" /> <line x1=\"8\" x2=\"3\" y1=\"12\" y2=\"12\" /> <line x1=\"21\" x2=\"16\" y1=\"20\" y2=\"20\" /> <line x1=\"12\" x2=\"3\" y1=\"20\" y2=\"20\" /> <line x1=\"14\" x2=\"14\" y1=\"2\" y2=\"6\" /> <line x1=\"8\" x2=\"8\" y1=\"10\" y2=\"14\" /> <line x1=\"16\" x2=\"16\" y1=\"18\" y2=\"22\" />",
  "music-4": "<path d=\"M9 18V5l12-2v13\" /> <path d=\"m9 9 12-2\" /> <circle cx=\"6\" cy=\"18\" r=\"3\" /> <circle cx=\"18\" cy=\"16\" r=\"3\" />",
  "compass": "<path d=\"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z\" /> <circle cx=\"12\" cy=\"12\" r=\"10\" />",
  "sprout": "<path d=\"M7 20h10\" /> <path d=\"M10 20c5.5-2.5.8-6.4 3-10\" /> <path d=\"M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z\" /> <path d=\"M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z\" />",
  "frown": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M16 16s-1.5-2-4-2-4 2-4 2\" /> <line x1=\"9\" x2=\"9.01\" y1=\"9\" y2=\"9\" /> <line x1=\"15\" x2=\"15.01\" y1=\"9\" y2=\"9\" />",
  "meh": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <line x1=\"8\" x2=\"16\" y1=\"15\" y2=\"15\" /> <line x1=\"9\" x2=\"9.01\" y1=\"9\" y2=\"9\" /> <line x1=\"15\" x2=\"15.01\" y1=\"9\" y2=\"9\" />",
  "smile": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M8 14s1.5 2 4 2 4-2 4-2\" /> <line x1=\"9\" x2=\"9.01\" y1=\"9\" y2=\"9\" /> <line x1=\"15\" x2=\"15.01\" y1=\"9\" y2=\"9\" />",
  "trash-2": "<path d=\"M3 6h18\" /> <path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\" /> <path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\" /> <line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\" /> <line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\" />",
  "piano": "<path d=\"M18.5 8c-1.4 0-2.6-.8-3.2-2A6.87 6.87 0 0 0 2 9v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-8.5C22 9.6 20.4 8 18.5 8\" /> <path d=\"M2 14h20\" /> <path d=\"M6 14v4\" /> <path d=\"M10 14v4\" /> <path d=\"M14 14v4\" /> <path d=\"M18 14v4\" />"
};

const FALLBACK = 'circle-help';

export function iconSvg(name, cls = '') {
  const inner = PATHS[name] ?? PATHS[FALLBACK] ?? '';
  const extra = cls ? ` ${cls}` : '';
  return `<svg class="icon${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

/** An inline icon element; the wrapper keeps sizing consistent everywhere. */
export function iconEl(name, cls = '') {
  const span = document.createElement('span');
  span.className = 'icon-wrap';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = iconSvg(name, cls);
  return span;
}
