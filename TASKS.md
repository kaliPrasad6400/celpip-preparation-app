# Tasks & acceptance checklist

Verified on 2026-10-21 (macOS, Python 3.13.2, Node 24.9, Chrome headless via Playwright).

## Acceptance criteria (master prompt §20)

| # | Criterion | Status | How verified |
|---|---|---|---|
| 1 | Start locally with documented instructions | ✅ | `./start.sh` from a clean `data/`: installs, migrates, seeds, builds, serves :8000, opens browser |
| 2 | Real SQLite database | ✅ | `data/celpip.db`, Alembic revision `0001`, 27 tables |
| 3 | Data persists across restarts | ✅ | Backup/restore round-trip test; E2E server restarts keep attempts/notes |
| 4 | Correct exam date & remaining days | ✅ | `test_dashboard_exam_date_and_days_remaining`; UI shows 43 days on 2026-10-21 (DST-safe rounding) |
| 5 | Planner creates two primary modules | ✅ | `test_daily_plan_has_two_distinct_skill_modules`; Today page |
| 6 | Practice exercises for all four skills | ✅ | Seed: 18 listening, 12 reading, 12 writing, 24 speaking; E2E reading flow |
| 7 | Writing submission → actual API-powered evaluation | ✅ | Live run on `claude-opus-5-5` (updated key): 9 criteria, 11 sentence corrections, vocabulary upgrades, 191-word improved response, 3-point comparison, next steps, 7 mistake patterns logged; ~91 s, ~$0.21. It correctly flagged an off-task test response as not level-estimable. |
| 8 | Speaking practice with feedback appropriate to transcript/audio | ✅ | Timers/recording/transcription UI; `test_speaking_text_only_limitation` |
| 9 | Listening/reading answer keys + reliable objective scoring | ✅ | `test_listening_reading_have_valid_answer_keys`, `test_objective_scoring_is_deterministic`, E2E |
| 10 | Save and reuse templates | ✅ | `test_template_crud_and_recall`; template panel in studios |
| 11 | Notion-style notes: create, edit, search, organize | ✅ | E2E (create → type → autosave → search); `test_note_sanitized_and_backlinks` |
| 12 | Save vocabulary + review exercises | ✅ | `test_vocab_review_and_quiz`; E2E keyboard review |
| 13 | Evaluations identify and track recurring mistakes | ✅ | `test_recurring_mistake_is_merged_and_tracked`, `test_recurring_check_improves_status` |
| 14 | Progress charts use real persisted data | ✅ | Analytics/dashboard endpoints compute from DB only; no hardcoded numbers |
| 15 | Missing/invalid API key handled gracefully | ✅ | `test_missing_api_key_is_handled_gracefully`; E2E shows "key was rejected" with response kept |
| 16 | API key never exposed to frontend | ✅ | `test_api_key_never_returned_or_stored_in_db`; E2E page scan; grep of dist/logs/DB |
| 17 | Backup and restore | ✅ | `test_backup_and_restore_roundtrip` (incl. safety backup) |
| 18 | Useful offline functionality | ✅ | Notes, vocab, templates, L/R practice, planner, offline topic generator, search (FTS5) need no internet |
| 19 | Meaningful automated tests | ✅ | 28 backend (pytest) + 9 frontend (Vitest) — all passing |
| 20 | README covers install, startup, config, troubleshooting, backup, score limitations | ✅ | README.md |
| 21 | Canadian Context Engine criteria (§18H) | ✅ | See below |

### §18H Canadian Context Engine

1. All major categories — ✅ 23 categories / 5 groups, 68 topics (17 workplace, 12 reference pages).
2. Filter by category, skill, difficulty — ✅ API + UI filters (`test_topics_filter_and_offline_generation`).
3. One topic → exercises for multiple skills — ✅ generator (offline W1/W2/S1/S2/S4–S7; AI for all incl. L/R).
4. Workplace & everyday scenarios — ✅.
5. Create and persist original practice items — ✅ stored as `PracticeQuestion` with `source_type`.
6. Current-affairs entries with working source links and dates — ✅ live refresh retrieved 83 items (CBC ×3, Canada.ca) with original URLs and publication dates; StatCan feed error recorded.
7. Never fabricates sources or predicts exam questions — ✅ only feed metadata stored; AI fields labelled interpretation; disclaimers throughout.
8. Save vocabulary from topics and evaluations — ✅ one-click endpoints + UI.
9. Daily practice uses topic variety and performance history — ✅ planner scoring (topic practice count, weakness, staleness, mistakes).
10. Useful offline — ✅ saved topics/news and the offline composer.

## Remaining limitations

- Cost/latency per writing evaluation (measured): Gemini `gemini-pro-latest` ≈39 s / ≈$0.056 (practice); Claude Opus ≈91 s / ≈$0.21 (mock exams). Gemini 'latest' aliases change over time, so prices are approximate.
- `gemini-1.5-pro` (originally requested) is retired by Google (404); `gemini-pro-latest` is used instead.
- **Pronunciation/fluency** cannot be assessed from text; even with OpenAI transcription the assessment is indirect.
- **Listening audio** uses browser speech synthesis — natural enough for practice, not studio recordings. Listening
  scripts are sent to the browser to be spoken (hidden in the UI until submission).
- **Speaking transcription** requires an OpenAI key or the browser's speech recognition (Chrome/Edge/Safari).
- **AI level estimates** vary between runs and models; treat trends, not single numbers, as signal.
- **Item bank size** is finite (30 L/R sets, 36 W/S prompts). Generate more in-app (AI-generated L/R keys should be
  spot-checked).
- celpip.ca blocked automated fetching on the check date; format was cross-checked via an official study pack and a
  current overview — re-confirm on celpip.ca before the exam.
- Statistics Canada's feed was in maintenance on the check date.
- `ConfirmModal` assumes one confirmation dialog is open at a time (true throughout the app).

## Done

- [x] M1 Foundation · [x] M2 Dashboard & planner · [x] M3 Notes/vocab/templates · [x] M4 Writing + AI evaluation
- [x] M5 Speaking · [x] M6 Listening/reading · [x] M7 Canadian context & news · [x] M8 Mock, analytics, backups, docs
