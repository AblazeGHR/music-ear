# Changelog

## 0.7.0 — 2026-10-14

- 📊 **Per-answer statistics for multiple-choice exercises.** Every answer now records how often it came up, how often it was right, and — when it was missed — what got picked instead. The Stats page expands each exercise: the first level lists every answer's miss rate (worst first), and opening an answer shows the wrong-choice distribution as a share of that answer's misses ("Perfect 5th — 33% wrong · Major 3rd 2× · Octave 1×")
- 🔗 **Two-way shortcuts between practice and stats.** Each practice screen's top bar has a 📊 button that jumps straight to that exercise's breakdown (deep link `#/stats/<exercise>`, opens and scrolls to it), and each exercise's stats card has a ▶ Practice button back
- Pitch questions now contribute to the confusion statistics like the other choice exercises (they always were multiple choice)

## 0.6.5 — 2026-10-13

- 🔄 **Gesture vocabulary reshuffled, as requested**: a **straight swipe** now moves to the next question (it used to do nothing), and a **long press** now **turns gesture mode off** (it used to mean "next"). Tap ×N = option N and circle = play / replay are unchanged
- The swipe is recognised by net travel over path length (a straight line is ~1, an arc well below), so partial loops and curves stay ignored instead of being read as a line — and a swipe, like a hold, discards taps that were still waiting to commit rather than submitting a half-intended answer
- The help popup and the on-screen legend reflect the new mapping

## 0.6.4 — 2026-10-13

- ⚡ **UI feedback sounds are near-instant.** Tap ticks, the right-answer blip and the gesture-on chime were scheduled with the 60 ms lookahead meant for multi-note phrases; they now use a few milliseconds, so a tap is heard as immediately as the device allows
- 🔧 **The wrong-answer comparison no longer cuts itself off.** The two comparison sounds were fired by fixed timers (350 ms / 1250 ms), so a first option longer than 1.25 s — a two-note interval, a seven-note scale, a block+arpeggio chord — was faded out mid-sound when the second started. The pair is now played sequentially: the answer waits for your pick to finish, then follows after a 250 ms pause
- ⚙️ **New setting: Gesture tap window** (Quick 250 ms / Normal 350 ms / Relaxed 550 ms, default 350). How long the app waits for another tap before taking your answer — the shorter it is, the sooner the answer feedback arrives. Applies from the next exercise you open

## 0.6.3 — 2026-10-13

- 🎵 **Interval directions now reorder the same two notes instead of changing them.** Descending used to re-voice the interval below the root (an ascending C→G became C→F when flipped), so only the first note stayed the same. The pair is now fixed — lower note first ascending, upper note first descending, both together harmonic; the direction only changes the order or simultaneity, never the pitches. The register logic was simplified to match (one pair, always inside C3–C6)

## 0.6.2 — 2026-10-13

- 🔁 **After a wrong answer, replay plays both.** The big play button (and the replay key, and the circle gesture) used to re-play only the question itself — i.e. only the correct sound — after a miss. It now plays your pick and then the real answer, the same A/B the “Your pick / Answer” buttons offer, from the same root

## 0.6.1 — 2026-10-13

- ❓ A small help button next to the gesture switch shows exactly what each gesture stands in for: tap once → the 1st answer button, tap N times → the Nth, press and hold → Next →, draw a circle → play / replay — plus how the tick-per-tap and the wrong-answer playback work. Locked in gesture mode itself, like everything except the switch
- 🔄 **Interval replays now switch direction.** When several directions are selected (ascending / descending / harmonic), each replay re-voices the same interval in a randomly chosen *different* direction — the answer is learned as an interval, not as a fixed pattern. Statistics and the reference-song hint stay tied to the direction the question was drawn in; the compare buttons still play both options in one direction so the A/B stays fair

## 0.6.0 — 2026-10-13

- ✋ **Gesture mode** — eyes-closed practice for multiple-choice exercises. The switch in the practice header hands the whole screen to three gestures: **tap N times = option N** (a tick per tap so you can count, committed when the tap window closes), **press and hold = next question**, **draw a circle = play / replay**. Everything else — back, the Options panel, keyboard shortcuts — is locked out until the switch is turned off, so nothing can be hit by accident with your eyes closed
- 🔔 Eyes-closed feedback: a blip when the answer is right; a wrong answer automatically plays your pick and then the real one, so the comparison needs no buttons
- ↕️ **Answer buttons now always use a fixed musical order** — intervals ascending by semitone, scale degrees ascending, numerals I–vi, and so on — instead of the order options happened to be clicked in. Pools are stored in that order too, so exports read the same way
- Offered only where it helps: multiple-choice exercises with 8 or fewer options in the current pool. Progressions, dictation and the twelve-note pool keep their normal input
- Tests: 42 (10 new for the gesture recognizer: tap windows, hold, circle vs. its lookalikes; plus canonical-order assertions)

## 0.5.1 — 2026-10-13

Bug fix: the Options panel's controls were built from values captured at render time, so their displayed state drifted from what was actually enabled.

- 🐛 **Chips and toggles now redraw from the stored config after every edit** — a clicked chip lights up (or dims) immediately, and the same control can be toggled back and forth. Previously the visual state never changed, and because the click handler compared against a stale captured value, a chip could only ever be switched one way (added items could not be removed, removed items could not be re-added)
- 🐛 **Numeric ranges keep both edits.** Editing the second bound no longer reverts the first (each edit read a snapshot taken when the panel was built), and an inverted pair is corrected in the boxes as well as in storage
- 🐛 **"Reset to defaults" now resyncs every control**, not just the question
- 🐛 **Degenerate pools no longer hang or crash**: a one-chord progression pool used to spin forever in the "avoid repeating the previous chord" loop (freezing the tab); a one-note melody pool used to throw. Both now produce a valid question, and switching the key with a mismatched pool no longer asks for a tonic that has no answer button
- Tests: 31 cases (new: degenerate-pool regressions for progressions and melodies, minor-key tonic fallback). Verified in Chromium: chip/toggle/range round-trips, reset, and full answer cycles on degenerate pools — console clean

## 0.5.0 — 2026-10-13

- ♬ **Seventh-chord inversions** join the Chords exercise: 1st/2nd/3rd inversions of dom7, maj7, min7 and m7♭5 (16 new chord types), selectable in Options and included in the default pool alongside the triad inversions. The symmetric dim7 deliberately has no inversion entries — each would be enharmonically another dim7, so "the" correct answer would be ambiguous
- Tests now assert that every inversion is a pitch-class rotation of its root position

## 0.4.0 — 2026-10-13

The "no levels" release. Every exercise is now one flat practice mode in the spirit of [tonedear.com](https://tonedear.com/ear-training/intervals): pick an exercise, start immediately, and shape what you practise from its Options panel.

- 🧹 **Removed the entire level/progression system**: no levels, no unlocks, no onboarding, no streaks, no 12-week heatmap, no daily workout, no completion celebrations. Progress is a flat per-skill accuracy record — which still weights question selection toward what you miss
- 🎛 **Options panel on every exercise**: choose the exact question pool (intervals, chord types, scales, degrees, note names…), direction, key, register, melody length and toggles. Changes apply to the very next question and persist
- 🏠 **Home is a plain exercise list** — click a card and start; each card shows your running accuracy
- 📊 **Stats simplified** to what is useful: overall accuracy, per-exercise accuracy, and the "Often confused" pairs with playback
- 🧪 **A real test suite** (still zero dependencies, Node's built-in runner): music-theory data, the exercise registry, question generation and grading invariants, and persistence — run with `npm test`
- 🔒 Progress moves to a new `music-ear-v1` storage key, so 0.3.x progress does not carry over (use Settings → Export first if you care)
- Net result: same eight exercises, roughly a thousand lines of JavaScript removed

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
