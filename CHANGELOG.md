# Changelog

## 1.2.1 — 2026-10-25

- Writing editor: spell-check **on** (Canadian English), as in the CELPIP computer test; no autocorrect or grammar help.

## 1.2.0 — 2026-10-21

- Listening: natural multi-voice audio via Gemini TTS (per-section, cached, fidelity checks, per-turn fallback,
  retries); browser voice only as fallback. Audio plays from an in-page `<audio>` element.
- Listening Part 1 now runs section by section: play section → answer its questions → next section (no going back in
  exam mode). Item→section mapping stored for starter sets (migration `0004`), inferred for generated sets.
- "Prepare all" pre-generation with progress; daily Gemini quota detected with a clear reset time. 34 backend tests.

## 1.1.0 — 2026-10-21

- Mock-exam speaking is transcribed *and* evaluated by the practice model (Gemini) by default; setting `mock_model_for_speaking` (migration `0003`) switches it to the mock-exam model.

- Google Gemini provider (`gemini-pro-latest` default; `gemini-flash-latest` etc.) with JSON-schema structured output.
- Separate **practice** and **mock-exam** AI settings (migration `0002`); practice → Gemini, mock exams → Anthropic Opus.
- Gemini speech-to-text for speaking recordings when no OpenAI key is configured.
- Settings: Gemini key, two model pickers, per-route connection tests. 28 backend tests.

## 1.0.0 — 2026-10-21

First complete release.

- Local FastAPI + SQLite (Alembic) backend and React/TypeScript/Vite interface served on one port; `start.sh` /
  `start.bat`.
- Dashboard with exam countdown, next-activity recommendation, readiness heuristic, skill tiles, trends.
- Two-module daily planner with weakness weighting, rotation, topic variety, carry-over, week view and calendar.
- Practice for all CELPIP-General task types: 18 listening sets, 12 reading sets (228 keyed items), 12 writing and
  24 speaking prompts with model answers; official-style timers; recording and transcription options.
- AI evaluation (Anthropic default, OpenAI supported) with structured JSON, validation, retries, criteria,
  sentence corrections, vocabulary upgrades, improved response, comparison, next steps, retry exercise, mistake
  tracking and recurring-mistake checks; usage/cost logging and daily limits.
- Templates Library (25 frameworks), Vocabulary Vault (141 starter items, SRS, cards, quizzes, active use),
  Notes Workspace (TipTap, folders, links/backlinks, Markdown import/export, 14 starter pages), Mistake Journal.
- Canadian Context engine (23 categories, 68 topics incl. 12 reference pages) with offline + AI topic-to-task
  generator; Current Affairs centre with source registry and RSS retrieval.
- Mock exams (full / section) with controlled navigation and summary reports; Progress Analytics.
- Backup/restore with validation and safety backups; JSON/CSV export; clear-data with confirmation.
- 26 backend tests, 9 frontend tests.
