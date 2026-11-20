# Brainstorm v2 - status

## Done
- Root cause: the PDF marks correct answers with **cyan highlight drawn as vector rectangles** (not PDF annotations, not bold). The old parser only looked at bold/annotations, so it saw no answers, and its line/option rules dropped ~100 questions.
- New `parser.js`: reads highlight rectangles from the page drawing operators (tracks transforms + fill colour), maps them to individual characters.
- Handles: options inline on one line (`a) x b) y c) z`), options inside the question text, a)/b) in the stem + c)/d) on next lines, `6.A` / `160 A` / `273An` numbering, question numbers glued to the end of the previous line, skipped/duplicated/mis-typed numbers, page numbers and Cyrillic headers/footers, Cyrillic look-alike letters (А В С Е), short partial highlights, wrapped options, stray `\x00` characters.
- Kept: `Answer: B`, `*`, `✓`, `(correct)`, bold and DOCX highlight detection.
- Result on your PDF (79 pages): **506 questions extracted** (the PDF numbers go to 500 but contain 11 skipped numbers and ~17 repeated/mis-typed numbers - all kept, nothing deduplicated). **501 have the answer detected automatically.**
- End-to-end test: uploaded the PDF to the running server -> 506 questions returned.

## Remaining (5 questions - cannot be auto-fixed)
These carry **no highlight in the PDF**, so there is nothing to extract. My own suggestions (from medical knowledge, NOT from the file - please verify):
| # in app | PDF no. | page | question | suggestion |
|---|---|---|---|---|
| 33 | 33 | 7 | Most common cardiac involvement in RA | B - Pericarditis |
| 36 | 36 | 8 | Gout is a disorder of | A - Purine metabolism |
| 40 | 39 | 8 | Most common manifestation of cardiac lupus | C - Pericarditis |
| 403 | 398 | 64 | Enlargement of the thyroid gland is called | C - Goitre |
And 1 ambiguous: app #38 (PDF 37, "False regarding gouty arthritis") has **two** highlighted options (B and D); the app picks B and shows the "verify" warning.

## Files
- `questions_extracted.csv/json` - every question, options, detected answer, status.

## UI refresh (v2.1)
Redesigned `public/style.css`: gradient accents, card shadows, lettered option badges (A/B/C/D) with ✓/✕ feedback, shake animation on wrong answers, smoother progress bar, styled upload dropzone, focus rings, mobile spacing, auto dark mode. Note: quiz mode skips questions without a detected answer (the 4 unmarked ones) until you set them in the admin editor.

## v2.2
- Admin password default `ac1205` (env `ADMIN_PASSWORD` still overrides on Vercel).
- Admin: real upload progress bar (upload % → extracting stage → done), answered/total progress bar, collapsible question cards (auto-collapse after choosing an answer and auto-open the next unanswered), expand/collapse all, show-only-unanswered.
- New home page (hero + 3 steps). `RULES.md` added with the "deliver zip before tokens run out" rule.

## v2.3 - student quiz UI
Question chips (Q n/total, ✔/✘ counters), thicker progress bar, larger question card, lettered options with instant ✓/✕ feedback banner showing the correct answer, sticky full-width Next button, keyboard shortcuts (A–E to answer, Enter for next), score ring + review cards on the results screen. Removed duplicate A./B. prefix in option text.

## v2.4 - student UI + fix-your-mistakes
- New intro card (question count, expiry, 3 feature tiles), `Start quiz` full-width button.
- Wrong answer feedback now shows **Your answer** and **Correct answer** side by side.
- Header chip `✘ n · Review` opens a slide-up **Fix your mistakes** sheet mid-quiz (Esc / tap outside closes).
- Results screen: interactive **Fix your mistakes** cards. Wrong pick is marked `YOUR ANSWER`, further wrong tries marked `TRIED`; picking the right option turns the card green. Progress bar "x of n corrected" and a live "With corrections: a / b" score.
- Corrections are saved to the attempt (`fixed` list via `POST /api/quiz/:id/attempt/:aid {fix:[...]}`); admin Results shows `✅ corrected` next to each first-try miss.
- Retry round of missed questions still works as before.
- Files changed: `public/quiz.html`, `public/style.css`, `public/results.html`, `server.js`, `STATUS.md`.

## v2.5 - timed test + layout polish
- Intro now has a mode picker: **Practice** (all questions, no limit) or **Timed test** (25 random shuffled questions from the PDF, 25-minute countdown). Constants `N` and `MINS` at the top of `public/quiz.html`.
- Timer chip in a sticky header (turns orange at 5 min, red + pulse at 1 min). Auto-submits at 0:00; unanswered questions are counted as missed, listed as "not answered" and can be fixed in the mistakes cards.
- Results show time used; missed questions can still be corrected or retried (retry rounds are untimed).
- Admin Results marks timed rounds with the time taken.
- Layout: no horizontal scroll (checked at 360px and desktop), long words wrap, top-aligned A/B/C/D badges for multi-line options, fluid question font size, sticky progress header, tighter mobile spacing.

## v2.6
- Fix-your-mistakes cards now start **clean**: the student's earlier clicked answers are cleared so every option is selectable again (new wrong tries during the fix are marked "Tried").
- Mode switch (📚 Practice | ⏱ Timed test) is now on the question page too, under the header chips. Switching asks for confirmation, resets progress and starts a fresh attempt.

## v2.7 - dedicated Wrong answers screen
- Wrong answers now open in their **own full screen** (not the long scrolling results page or a sheet): header with Back, a numbered navigator (red = still wrong, green = corrected), one question at a time, Previous/Next dock, arrow keys + Esc.
- Earlier clicked answers are cleared there; a right pick turns the card green.
- Going Back returns exactly where the student was: during the quiz the question, score and timer are untouched; on the results screen the score, rounds and a "x of n corrected" summary stay (button changes to "Continue correcting").
- Results page shows a compact Wrong answers card instead of the full list.

## v2.7.1
- Shuffle is OFF by default for students (resets on every start screen and when switching back to Practice; only the admin "Shuffle ON by default" setting turns it on). The timed test still always shuffles.

## v2.7.2
- Admin login: centered card (both axes) with a show/hide password eye button.

## v2.8 - sounds
- Soft Web Audio sounds (no files): rising chime for correct, low soft thud for wrong; also in the Wrong answers screen.
- Toggle: speaker button beside the mode switch on the question page and in the Wrong answers header, plus a "Sound effects" checkbox on the start screen. On by default; choice is remembered (localStorage "snd").

## v2.9 - answer extraction + admin UI (brainstorm-v10)
**Extraction (parser.js)**
- PDF bold was never detected (flag gated on a property that was never set) - fixed; also reads pdf.js font bold/black flags and font-family names.
- Highlight and bold tracked separately: highlight / star / tick / "(correct)" win; bold is used when nothing else marks an option, and ignored if every option is bold (plain formatting).
- Star markers: leading, trailing, after the label, wrapping (**x**) and inline "a) x *b) y" go to the right option; 2*3 or x*y are no longer markers; a star on a wrapped option line is honoured.
- DOCX: Strong/Bold character styles count as bold; bold val=false ignored.
- Tested on generated DOCX + PDF (bold, star start/end, inline options, all-bold, 2*3): all correct. Old parser missed every PDF bold answer.
**Admin UI**
- Real dialogs (confirm delete, discard changes, share link) + toasts replace alert/confirm.
- Copy link: works on http/older browsers (fallback), shows "Copied", manual-copy dialog if blocked.
- Save: Saving / Saved states, error toast, sticky save bar, unsaved-changes indicator, leave-page warning, share dialog after save.
- Quiz cards: link chip, expiry tag, Copy link / Results / Edit / Delete, empty state.
**Not verified**: PDFs that fake bold by stroking text; your real question PDF was not in this zip.

## v2.9.1
- Each extracted question records how its answer was found (`src`: marked / bold / answer line); the admin list shows "· bold" or "· marked" beside the letter so bold-only picks are easy to double-check.
- Remaining: run parser on the real PDF/DOCX and review any "verify" warnings; polish results page next.

## v2.10 - hardening + polish (brainstorm-v12)
- Server: security headers, timing-safe admin password check, brute-force throttle (429 after 20 bad tries/10 min), attempt-creation rate limit, max 50 rounds/attempt, no-store on API, JSON 404 for unknown API routes, static caching (HTML always revalidated).
- Quiz save (PUT) validates: >=1 question, text + >=2 options each, invalid answer index becomes "unanswered" instead of a 500.
- /api/health also reports defaultPassword (true if ADMIN_PASSWORD env is not set).
- Pages: theme-color + description meta, noindex on quiz/admin/results, social tags on home.
- Quiz: aria-live feedback for screen readers.
- CSS: visible keyboard focus rings, reduced-motion support.
- Not done: limiter is per server instance (not shared on Vercel).

## v2.11 - resume after refresh
- Quiz progress is saved in the student's browser (localStorage `qz:<quizId>`) after every answer, mistake fix and round: question order, position, score, wrong/fixed lists, timed-test deadline, attempt id.
- Reopening the link shows a "Welcome back" card: **Resume quiz** or **Start over**. Resume continues the same attempt (no new attempt row, no duplicate round posted).
- Timed test: the clock keeps running while the tab is closed; if time ran out meanwhile, resuming goes straight to "Time's up" and submits the round.
- Refreshing on the results screen offers **View results** (wrong-answers fixing still works; nothing is re-posted). A perfect score or "Back to start" clears the saved state.
- Saved state is ignored if older than 7 days or if the quiz's question count changed (admin edit).
- Replaced the earlier leave-page warning (no longer needed).
- Limits: progress is per browser/device (not synced across devices); private browsing that blocks storage just means no resume.
- Tested in jsdom: mid-quiz refresh, resume, finish, refresh on results, back-to-start, timed resume with time left and with expired deadline.

## v3.0 - universal numbered-option fix (brainstorm-v14)
- Bug: PDFs with **numbered options** (`1) x  2) y`) and `N. QUESTION` stems gave 318/400 questions and questions with 5-9 options. Causes: question number 5-8 looked like the 5th-8th option, a question missing its options swallowed the next ones, decimals like `INR 2.5-3.5` were split as options, cover-page/heading lines became pseudo-questions.
- New `buildStrict()` in parser.js: options accepted only in sequence, a question number is told apart from an option label (ALL-CAPS stem / different delimiter), decimals never split, headings and the reviewer's red `+` glyph are dropped, duplicate and skipped question numbers kept.
- `parseFile` runs both parsers and keeps the cleaner result (`quality()` score), so old lettered-option files behave as before.
- `node selftest.js file.pdf` prints a report (total, missing/duplicate numbers, >6 options, <4 options, no answer).
- Result on the Clinical Pharmacology PDF: **402 questions** (numbers 1-400, 393 absent in the PDF, 227/276/394 appear twice), all options correct, answer detected for all 402. Q88 and Q209 genuinely have only 3 options in the PDF.

## v3.1 - universal (brainstorm-v15)
- Strict parser now also handles: labels `A)` `a.` `(a)` `[a]` `1)` `1.`; stems `1.` `1)` `Q1.` `Question 1:`; Word auto-numbered lists (no number in the text); options inline on one line; answer marked by highlight (vector or annotation), bold, `*`, `✓`, `(correct)`, `Answer: B`, or an **answer key** at the end (`1-B 2-C`, `1. B`).
- Question-number vs option-number collisions are resolved by **lookahead** (the label that follows decides), with ALL-CAPS/delimiter checks as fallback.
- Upload response now includes `report` (missing/duplicate numbers, >6 or <4 options, unanswered).
- Regression tests: `python3 tests/gen_samples.py` (in a folder) then `node tests/run.js` - 11 synthetic DOCX/PDF layouts, all OK; real Clinical Pharmacology PDF = 402 questions, all answers detected.

## v3.2 - admin login fix (brainstorm-v17)
- Bug: "admin password not working / Log in button does nothing". Causes: (1) the login button swallowed every error except a plain 401 - a 429 throttle, a database error (login called `/api/quizzes`, which needs storage), a network error, or a non-latin-1 character in the password all left the button silently dead; (2) `ADMIN_PASSWORD` env values with a trailing space/newline or wrapping quotes never matched; (3) mobile keyboards auto-capitalising / adding a space to the typed password.
- Fix: new `GET /api/auth` (password check only, never touches storage); login shows every failure in the form ("Checking..." state, button always re-enabled); password trimmed client-side and sent URL-encoded; server trims/unquotes `ADMIN_PASSWORD` and accepts raw or encoded header; `autocapitalize/autocorrect/spellcheck` off on the field; quiz-list load errors shown with a Retry button instead of a dead page; sessionStorage failures no longer crash the page.
- Tested: 12 server password-logic cases + 11 browser cases (wrong pw, padded pw, Enter key, edit/copy/save/share dialog, non-latin-1 pw, DB error, 429, empty pw, reload) - all pass.
- Reminder: on Vercel the `ADMIN_PASSWORD` env var overrides the default `ac1205`; after changing it you must redeploy.
- Not verified: against a real Supabase/Vercel deployment (no network here).

## v3.3 - student dashboard (brainstorm-v18)
- Admin main page now has a **🎓 Student dashboard** card above "Your quizzes": quiz picker, group filter, Refresh, summary tiles (students, attempted, correct, wrong, accuracy) and a per-student table (attempted, correct, wrong, accuracy, progress bar, status).
- Same student (name + group, case-insensitive) across several attempts is merged. Counts add up all finished rounds; progress = largest round / quiz questions.
- Limitation: attempts are only sent to the server when a round finishes, so a student shows up after finishing a round (not live per-answer). Live tracking would need a per-answer sync - not done.
- Tested in browser with sample attempts (merge, totals, filters render). Files changed: `public/admin.html`.


## v18.1 - DB table fix
- Fixed `PGRST205 Could not find table public.quizzes`: the Supabase project (research-catalyst, shared) holds `brainstorm_quizzes` / `brainstorm_attempts`; `server.js` and `supabase.sql` now use those names. Redeploy to Vercel to apply.

## v18.2 - student dashboard for students + simpler quiz start
- Student dashboard moved out of Admin to a public **/students.html** (linked as "🎓 Students" on the home page). A student enters name + group (remembered in the browser) and sees only their own quizzes, attempted/correct/wrong/accuracy and progress. Backed by `POST /api/student/stats` (rate-limited; never returns other students' data).
- Quiz start screen: removed the Instant feedback / Mistakes list / Fix them tiles, Practice mode, mode picker, "Shuffle questions & options", "Sound effects (soft)" and the explanatory note. Only **Start test** remains (timed, shuffled, auto-submit). Practice/shuffle/sound controls also removed from the question page; sound effects are off.
- Not run here (no node_modules / network): syntax-checked all scripts only. Redeploy to apply.

## v18.3
- **Start test** now starts with **all questions** (no 25-question limit, no 25-minute countdown); original order unless the admin "Shuffle ON" setting is on.
- Typography/alignment: Inter font loaded on all pages, fluid heading sizes, consistent inputs/chips/rows, centered start screen, tidier home buttons. Student page renamed "My progress".

## v18.4
- Start screen stays minimal (Start test only, all questions). The **Shuffle**, **Timed test (25 Q · 25 min)** vs **All questions** switch, and **sound** toggle are on the test (question) page header. Defaults: all questions, shuffle off, sound on (remembered).

## v18.5
- Name/group start screen now has a **🎓 Student dashboard** button (saves the typed name/group, then opens /students.html which shows that student's progress).

## v18.6
- Fixed "[object HTMLDivElement]" on the student page (array passed to replaceChildren).
- Student dashboard now shows **all students** of a quiz (quiz picker, group filter, Refresh, summary tiles, table with attempted/correct/wrong/accuracy/progress/status); the current student's row is highlighted "You". Public endpoints: `GET /api/students/quizzes`, `GET /api/students/:id` (name, group and counts only).

## v19 - big PDFs + underline answers + outlined text (brainstorm-v19)
Causes found with the 64-page, 5.1 MB "Docs exam questions" PDF (parser gave 300 questions, 0 answers; upload failed):
1. **Upload failed**: PDF > Vercel's ~4.5 MB request limit (and app limit MAXMB=4). Fix: browser sends 2.5 MB parts (`/api/upload/chunk`), then `/api/upload/finish`; parts stored temporarily in Supabase table `brainstorm_quizzes` (ids start `zz`, never listed, auto-deleted, swept after 24h). Retries per part; real error text shown.
2. **Answers not detected**: correct answers are marked by *underlines in a transparent raster overlay* (tiled PNG images), not highlight/bold. New `pageUnderlines()` reads those images, finds thin horizontal strokes and flags the text line above (tolerates different line spacing).
3. **Questions 201-400 missing/garbled**: their stems (and some numbers/"WHICH...?" parts) are drawn as vector outlines - no text layer. New `outline_ocr.js` rasterises glyph outlines itself and OCRs them with tesseract.js (English), merging results into the normal text rows by position; OCR garbage (e.g. Cyrillic cover) and number-only rows are filtered.
4. OCR is slow (~55 s on 1 CPU) so it runs in time-boxed passes (38 s on Vercel, `maxDuration` 60) with progress saved; the admin page loops until done ("Reading scanned text... x of y pages").
Result on this PDF: **402 questions, answers detected for all**; 393 absent / 227,276,394 repeated and Q88, Q209 with 3 options are genuinely like that in the PDF. Q370 has two underlined options (warning shown).
Tested: `OCR_CACHE=/tmp/c.json node selftest.js file.pdf`; end-to-end chunk upload incl. 5 resumed passes locally. Not tested on real Vercel/Supabase. `npm install` needed (new deps tesseract.js, @tesseract.js-data/eng; `vercel.json` includes their files).
