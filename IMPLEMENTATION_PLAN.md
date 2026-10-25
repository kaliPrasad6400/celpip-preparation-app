# Implementation plan

Built as vertical slices; each milestone ends with working, tested functionality.

| # | Milestone | Status | Verification |
|---|---|---|---|
| 1 | Local foundation: repo layout, FastAPI + React/Vite, SQLite + Alembic, design system, sidebar, Settings, startup script | Done | Migration from empty DB; `/api/health`; `./start.sh` build + serve |
| 2 | Dashboard + two-module daily planner (rotation, weakness weighting, carry-over, completion rules, week view, calendar) | Done | `test_daily_plan_has_two_distinct_skill_modules`, `test_session_completion_requires_attempt_and_review`, `test_dashboard_exam_date_and_days_remaining` |
| 3 | Notes (TipTap, folders, tags, favourites, autosave, links/backlinks, Markdown import/export), Vocabulary Vault (SRS, cards, quizzes, active use), Templates (status, confidence, recall checks, recommendation) | Done | `test_note_sanitized_and_backlinks`, `test_vocab_review_and_quiz`, `test_template_crud_and_recall`, `test_srs_schedule` |
| 4 | Writing practice + AI evaluation (schema, validation, retries, history, mistakes, cost controls, provider errors) | Done (live call blocked by invalid key — see TASKS) | `test_evaluation.py` (fake provider), `test_missing_api_key_is_handled_gracefully`, `test_spend_limit_blocks_calls` |
| 5 | Speaking: 8 tasks, official timers, recording, playback, transcription (OpenAI / browser / typed), retention controls | Done | Manual UI flow; `test_speaking_text_only_limitation` |
| 6 | Listening & Reading with verified answer keys, speech-synthesis audio, study mode, explanations | Done | `test_listening_reading_have_valid_answer_keys`, `test_objective_scoring_is_deterministic`, `test_answer_key_hidden_before_submission` |
| 7 | Canadian Context engine (68 topics, 12 reference pages, cross-skill generator), Current Affairs (source registry, RSS retrieval, enrichment, workflow) | Done | `test_topics_filter_and_offline_generation`; live RSS refresh against CBC/Canada.ca |
| 8 | Mock exams, analytics, backups/restore/export, documentation, final verification | Done | `test_mock_exam_flow`, `test_backup_and_restore_roundtrip`, `test_exports`, `test_analytics_keeps_data_types_separate` |

## Next iterations (suggested)

1. Re-run a live end-to-end evaluation once a valid API key is configured; compare estimates across two models.
2. Add more listening/reading sets per part (AI generation is available in-app; review generated keys).
3. Optional OpenAI TTS voices for listening audio (closer to real recordings).
4. Pronunciation analysis from audio (would require an audio-capable assessment service).
