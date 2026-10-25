# Architecture

```
browser (React SPA) ──HTTP /api──▶ FastAPI (uvicorn, 127.0.0.1:8000) ──SQLAlchemy──▶ SQLite  data/celpip.db
                                         │                                   data/audio, data/backups, data/logs
                                         └── AI provider (Anthropic | OpenAI), RSS feeds   [backend only]
```

The built frontend (`frontend/dist`) is served by FastAPI, so the whole app runs on one port. In dev mode Vite
(:5173) proxies `/api` to the backend.

## Backend (`backend/app`)

| Module | Responsibility |
|---|---|
| `config.py` | Paths, `.env` secret read/write (keys never touch the DB) |
| `db.py`, `models.py` | SQLAlchemy 2 ORM: 27 tables (see below); FK constraints on, WAL mode |
| `migrate.py`, `migrations/` | Alembic migrations, applied automatically at startup and after restore |
| `celpip_format.py` | Task catalog (names, item counts, timings), criteria, mistake categories |
| `routers/` | HTTP API: `system` (settings, keys, usage, diagnostics), `dashboard` (+analytics), `planner`, `practice` (questions, attempts, audio), `knowledge` (templates, notes, links, vocabulary, mistakes, search), `context` (topics, sources, current affairs), `mock`, `data` (backup/restore/export) |
| `services/ai.py` | Provider abstraction (Anthropic SDK, OpenAI SDK, Gemini REST), practice/mock routing, JSON-schema structured output, limits, usage log, error mapping |
| `services/evaluator.py` | Rubric prompts, evaluation schema + pydantic validation, persistence, mistake journal, recurring checks, template & vocabulary usage updates, template recommendation |
| `services/scoring.py` | Deterministic answer-key scoring, accuracy by question type |
| `services/planner.py` | Daily plan generation, carry-over, next-activity recommendation |
| `services/analytics.py` | Skill summaries, readiness heuristic, consistency, trends |
| `services/generator.py` | Topic-to-task generator: offline composer + AI generation with answer keys fixed at creation |
| `services/news.py` | RSS/Atom retrieval (metadata + feed summary only), categorization, AI enrichment |
| `services/srs.py` | Configurable interval-ladder spaced repetition |
| `services/search.py` | SQLite FTS5 index across notes, vocabulary, templates, mistakes, topics |
| `services/backup.py` | Online backup, validated restore with safety backup, JSON/CSV export, clear data |
| `services/sanitize.py` | bleach allow-list sanitization of rich text (frontend also uses DOMPurify) |
| `seed/` | Idempotent starter-content loader + JSON content files |

### Data model

UserSettings · StudyGoals · OfficialScores · StudyPlans → StudySessions · PracticeQuestions → PracticeAttempts →
Evaluations → EvaluationCriteria · Templates → TemplatePracticeHistory · NoteFolders → Notes · EntityLinks (generic
links/backlinks between notes, templates, vocabulary, attempts, mistakes, topics, questions) · VocabularyItems →
VocabularyReviewHistory · Mistakes → MistakeOccurrences · MockExams → MockExamSections, MockExamResults ·
TopicCategories → TopicItems · ContentSources → CurrentAffairsItems · ImportedResources (also records applied seed
files) · ApiUsage.

Deletion behaviour: children cascade (plan→sessions, attempt→evaluations→criteria, mistake→occurrences, mock→sections/
results/attempts); references to optional parents are `SET NULL` (e.g. deleting a question archives it instead, so
attempt history survives). Rich text is stored as sanitized **HTML** (TipTap output) plus a plain-text copy for search.

Three separate measurement types are never mixed: `PracticeAttempt.accuracy` (objective), `Evaluation.estimated_level`
(unofficial AI estimate), `OfficialScore` (entered by the user).

### AI evaluation pipeline

1. Attempt saved first (`POST /api/attempts`) — nothing is lost if AI fails.
2. `POST /api/attempts/{id}/evaluate` → task type → rubric criteria (writing 9 / speaking 10) + recommended template
   + the learner's top open mistakes.
3. One request with a JSON schema (`output_config.format` for Anthropic; `response_format: json_schema, strict` for
   OpenAI). The learner's text is wrapped in `<response>` and treated as data.
4. Output validated with pydantic (levels clamped 0–12, categories normalized); one automatic retry on invalid output.
5. Persist evaluation + criteria; update Mistake Journal (fuzzy-merge similar patterns per category), recurring
   checks (2 clean → improving, 4 → resolved), template progress, vocabulary active-use counts.
6. Errors map to typed codes (`no_key`, `auth`, `rate_limit`, `timeout`, `network`, `limit_spend`, `invalid_output`…)
   with readable messages; usage and estimated cost logged (no prompt content).

Listening/reading use deterministic scoring; AI is only used on request to *explain* missed items, with the stored
answer key given as authoritative.

### Key decisions

- **Three providers, two routes.** Anthropic, OpenAI and Gemini sit behind one `complete_json` interface. Settings hold
  a *practice* provider/model and a *mock-exam* provider/model; `evaluator.route_for()` sends attempts with
  `mode="mock"`/`mock_exam_id` to the mock route, everything else to practice. Gemini is called over its REST API
  (`responseJsonSchema` structured output; thinking tokens counted as output). Speech-to-text uses OpenAI if a key is
  set, else Gemini audio input.
- **Default model `claude-opus-5-5`, effort `medium`**, server-side refusal fallback enabled where supported.
- **Answer keys never reach the browser before submission.** Listening scripts are sent only to drive local speech
  synthesis (not displayed) or in explicit study mode.
- **TipTap 2 + HTML storage** for notes; internal links are `<a data-link-type data-link-id>` parsed server-side into
  `entity_links` for backlinks.
- **No external analytics, no auto-upload.** Only explicit actions call external services.

## Frontend (`frontend/src`)

React 18 + TypeScript + Vite 6, Tailwind 3 (CSS-variable theme, light/dark), TanStack Query, React Router 6,
Recharts 2, TipTap 2, DOMPurify, marked/turndown (Markdown import/export), lucide icons. Hand-written shadcn-style
components in `components/ui.tsx` (no Radix dependency).

| Area | Files |
|---|---|
| Shell | `components/Layout.tsx` (sidebar, ⌘K search, theme) |
| Practice | `SkillStudio`, `QuestionPicker`, `ObjectiveRunner` (reading/listening), `WritingRunner`, `SpeakingRunner`, `AttemptResult`, `EvaluationView`, `SessionBanner` |
| Pages | `pages/*.tsx` — one per sidebar item |
| Lib | `lib/api.ts` (fetch + typed errors), `lib/hooks.ts` (countdown, speech synthesis, recorder, browser STT), `lib/util.ts` |

Skill series colours were validated with the dataviz palette validator (all-pairs CVD and normal-vision separation;
light mode passes all checks, dark mode passes with a 6–8 ΔE CVD pair mitigated by legends + direct labels).

## Package versions

Backend: see `backend/requirements.txt` (FastAPI 0.157, SQLAlchemy 2.1, Alembic 1.20, anthropic 2.0, openai 3.36,
pydantic 2.14). Frontend: see `frontend/package.json` (React 18.3, Vite 6.4, Tailwind 3.4, TipTap 2.27, Recharts 2.15,
Vitest 3.2).
