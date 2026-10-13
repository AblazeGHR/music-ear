# Changelog

## 0.3.0 — 2026-10-13

First release under this project's own development. Up to and including 0.2.2 is the upstream [earpath-app](https://github.com/abeage1/earpath-app) history (MIT, © abeage1), imported as the baseline — see [docs/BASELINE_REVIEW.md](docs/BASELINE_REVIEW.md).

- ♯ **New module: Absolute Pitch** — hear one bare note with no reference, no key and no chord, and name it. Four levels: the seven natural names (C3–C5) → all twelve names → all twelve spread over C2–C6 so the register can't give it away → the five accidentals alone. Answers are graded by pitch class, so the app-wide enharmonic spelling table (C♯/E♭/F♯/A♭/B♭) stays consistent with the rest of the app
- 📈 Absolute-pitch answers feed the existing statistics pipeline: per-name accuracy (`ap:<pitch class>`), streak, heat map, and an "Often confused" row that can play both names back in the same octave
- 🔎 A test suite now guards the music theory: equal-temperament frequencies, interval semitones, chord qualities, the inversion invariant, scale collections, roman-numeral roots, and the module registry. Run it with `npm test` (Node's built-in runner — still zero runtime dependencies)
- 🔒 PostHog analytics disabled (`js/config.js` key emptied), and the canonical/OG links that pointed at the upstream domain removed

## 0.2.2 — 2026-06-13

- 📱 The dictation keyboard never scrolls anymore — it always fits your screen (scrolling hid notes and could play keys while panning)

## 0.2.1 — 2026-06-13

First feedback-driven release — thank you r/musictheory! 🙏

- 🐛 **Melodies: every answer note now fits on the keyboard.** Note pools are capped to exactly what each level promises (the upper octave only appears from "Full scale" onward), and the keyboard sizes itself to the range — no more answers hiding off-screen on phones
- ✨ **You now play the given first note/chord yourself.** Everyone's instinct is to start from note 1 — now that's correct. Given items show as ghost hints (and the first melody note is highlighted on the keyboard) instead of being pre-filled
- 🔓 **"Unlock all levels" toggle in Settings** — practice any level in any module, no progression required
- 📖 Each exercise now shows a one-line "how it works" under the prompt

## 0.2.0 — 2026-06-11

The "real people" release. Forked from [earpath](https://github.com/abeage1/earpath) v0.1 to focus on getting the app into users' hands and learning from them.

- 💬 In-app feedback widget (mood + free text), with GitHub-issue and email fallbacks
- 📊 Anonymous, cookieless usage analytics (PostHog; disabled entirely under Do Not Track and on localhost) — see Guide → About & privacy
- 🔗 Social previews (Open Graph / Twitter card) for nicer link sharing
- 📝 Version + changelog link in the footer; privacy note in the Guide
- 🐛 GitHub issue templates for bugs and feedback

## 0.1.0 — 2026-06-09

Initial release: seven modules (pitch, intervals, chords, scales & modes, scale degrees, progressions, melodies), 54 levels, adaptive question selection, confusion tracking, daily workout, streaks, onboarding paths, offline PWA.
