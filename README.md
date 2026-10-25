# CELPIP Mastery 12 — My Personal Exam Coach

A local-first web app for preparing for the **CELPIP-General** test (target: **Level 12** in Listening, Reading,
Writing and Speaking; exam date **December 3, 2026** — editable in Settings).

It combines a two-module daily planner, timed practice for all four skills, AI evaluation of writing and speaking,
a Notion-style notes workspace, a spaced-repetition vocabulary vault, a mistake journal, a Canadian-context topic
library, a current-affairs practice centre, mock exams and progress analytics — all stored in a local SQLite database.

> **Practice content in this app is original. It is not official CELPIP material, and nothing here predicts exam
> questions.** AI levels are unofficial estimates; listening/reading accuracy is practice accuracy. Neither is a
> CELPIP score.

---

## Release notes (current version 1.2.1)

- **AI providers by purpose** — daily practice uses **Google Gemini** (`gemini-pro-latest`); mock-exam *writing* uses
  **Anthropic Claude** (`claude-opus-5-5`). Speaking is transcribed and evaluated by Gemini everywhere, including mock
  exams. Both routes are switchable in Settings.
- **Listening** — natural multi-voice audio (Gemini text-to-speech), cached locally after the first play. Part 1
  (Problem Solving) runs section by section like the real test: play a section → answer only its questions → next.
- **Writing** — spell-check is **on**, as in the CELPIP computer test (misspellings only; no grammar help, no autocorrect).
- **Speaking** — recordings can be transcribed by Gemini (filler words such as "um" are kept, so fluency clues reach
  the evaluator).
- Full history: [CHANGELOG.md](CHANGELOG.md).

## What is (and isn't) in this repository

Committed: source code, database migrations, starter content (original practice questions, templates, vocabulary,
notes, topics), tests, docs, and `backend/.env.example` with **empty** placeholders.

Never committed (see `.gitignore`):

| Path | Contains |
|---|---|
| `backend/.env` | your API keys |
| `data/` | your database (`celpip.db`), recordings, generated listening audio, backups, logs |
| `backend/.venv/`, `frontend/node_modules/`, `frontend/dist/` | installed/built dependencies (recreated by `start.sh`) |

After cloning on a new computer: run `./start.sh`, then add your keys in **Settings → AI & evaluation** (or copy
`backend/.env.example` to `backend/.env` and fill it in). To move your study history, copy a backup from
`data/backups/` and restore it in Settings → Data & backup.

## 1. Requirements

| Tool | Version tested | Notes |
|---|---|---|
| Python | 3.13.2 (3.11+ should work) | backend |
| Node.js / npm | 24.9 / 11.6 (Node 20+ should work) | builds the interface |
| Browser | Chrome, Edge, Safari or Firefox (latest) | Chrome/Edge recommended for recording + speech |

Internet is needed only for AI evaluation/generation and for refreshing news feeds.

## 2. Install & start

**macOS / Linux — one command:**

```bash
cd celpip-mastery-12
./start.sh            # installs deps on first run, migrates the DB, builds the UI, opens http://localhost:8000
```

`./start.sh --dev` runs hot-reload development mode (backend on :8000, Vite on http://localhost:5173).

**Windows:** double-click `start.bat` (or run it in a terminal). It does the same steps.

**Manual start** (any OS):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.migrate                    # create / upgrade the database
cd ../frontend && npm install && npm run build
cd ../backend && .venv/bin/uvicorn app.main:app --port 8000
```

Then open **http://localhost:8000**. Stop with `Ctrl+C`. Your data stays in `data/`.

## 3. Configure the AI key

The app supports **Google Gemini**, **Anthropic (Claude)** and **OpenAI**, with two independent routes:

| Route | Used for | Current setup |
|---|---|---|
| **Practice model** | daily modules, all four studios, question generation, explanations, news enrichment | Gemini `gemini-pro-latest` (≈40 s, ≈$0.05 per writing evaluation) |
| **Mock-exam model** | writing evaluation inside mock exams (and re-evaluating a mock attempt). Mock **speaking** stays on the practice model so one provider transcribes and evaluates it — toggle in Settings | Anthropic `claude-opus-5-5` (≈90 s, ≈$0.20) |

1. Open **Settings → AI & evaluation**, paste each key, click **Save key**, then **Test practice model** /
   **Test mock-exam model**. *Or* edit `backend/.env` (created from `backend/.env.example`):
   ```
   GEMINI_API_KEY=...           # Google AI Studio key; also transcribes recordings when no OpenAI key is set
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...        # optional
   ```
2. Pick the provider and model for each route. `gemini-flash-latest` is faster and cheaper still; `gemini-1.5-*`
   models are retired by Google and return "not found".
3. Set safeguards: daily request limit (default 60) and estimated daily spend limit (default $3).

Security: keys live only in `backend/.env` (gitignored, file mode 600) and backend memory. They are never stored in
the database, never returned by any API endpoint (only a masked form like `sk-ant-…abcd`), never sent to the
browser, and log lines are filtered to redact anything that looks like a key.

Without a key (or if the provider is down), everything else keeps working: notes, vocabulary, templates, previous
evaluations, listening/reading practice with answer keys, the planner, offline topic-based prompt generation,
mock exams (objective sections), analytics, backups.

## 4. Using the app day to day

1. **Dashboard** tells you what to do next and shows days remaining, today's two modules, readiness, skill
   performance, recent feedback, top mistakes and vocabulary due.
2. **Today's Study Plan** — two modules (default 90 min). Each module has an objective, steps, a practice question,
   a recommended template, a mistake to watch, and evaluation. A module is complete only when you have
   **submitted the practice** and **confirmed the mistake review**. Missed days are kept as carry-over.
3. **Studios** (Listening, Reading, Writing, Speaking) — timed practice, answer keys, AI feedback, retry exercises.
4. Save useful words from feedback, topics and news to the **Vocabulary Vault**; review daily.
5. Keep strategy notes and personal examples in **Notes**; link them to templates, vocabulary and mistakes.
6. Take a **Mock Exam** every week or two; check **Progress Analytics**.

### Audio, transcription and retention

- Recording uses the browser's MediaRecorder. Files are saved under `data/audio/` **only if "Keep recordings" is
  on** (Settings → Audio); delete one from the attempt page or all from Settings.
- Transcription options: **typed** (text-only evaluation), **browser speech recognition** (Chrome/Edge/Safari —
  may be processed by the browser vendor's cloud service), or **AI transcription** — audio is uploaded only when you
  click "Transcribe recording", to OpenAI if that key is set, otherwise to Gemini (`gemini-flash-latest`).
- Without an audio transcript, feedback explicitly states that pronunciation, fluency and delivery were not assessed.

### Listening audio

- **Natural voices** are generated with Gemini text-to-speech (`gemini-3.1-flash-tts-preview`, distinct voice per
  speaker), checked for completeness, and cached in `data/tts/` — each section is generated once, then plays offline.
  Use **Listening → Prepare all** to generate everything in advance. Without a Gemini key (or when the daily TTS quota
  is used up) the browser's built-in voice is used, with a notice.
- If a section sounds wrong or the voice is the robotic browser fallback, check the notice above the player — it
  explains why (no Gemini key, or the daily text-to-speech limit was reached).
- **Sections:** Part 1 (Problem Solving) plays one section, then shows only that section's questions; you then move
  to the next section and cannot go back (exam mode). Other parts play once, then show all their questions.
- Gemini's free tier allows about 100 TTS requests per model per day; a two-speaker section uses one request.
- In exam mode you hear each section once and the transcript is hidden until you submit. **Study mode** (explicit toggle) shows the transcript and allows replay — labelled
non-exam-equivalent. Answer keys are never sent to the browser before you submit.

### Writing editor

Spell-check is enabled (Canadian English) because the CELPIP computer test includes a spelling checker that flags
misspellings. Like the test, it does not check grammar or catch correctly spelled wrong words ("their/there"), and
autocorrect is off. If your browser also shows grammar suggestions (e.g. Safari with system grammar checking), ignore
them for realistic practice.

## 5. Backup, restore, export

- **Settings → Data → Create backup** writes a consistent copy to `data/backups/celpip-YYYYMMDD-HHMMSS-*.db`
  (SQLite online-backup API, safe while running). Download any backup from the same list.
- **Restore** (type `RESTORE` to confirm) from a listed backup or an uploaded `.db` file. The file is validated
  (SQLite header, integrity check, required tables) and the **current database is backed up first** (`*-pre-restore.db`),
  then migrations are applied.
- **Export**: full JSON (`/api/data/export.json`) or CSV per entity (notes, vocabulary, mistakes, attempts…).
- **Manual backup**: stop the app and copy `data/celpip.db`.
- **Clear all local data** (type `DELETE ALL MY DATA`) — makes a safety backup first, then recreates a fresh database
  with the starter content.

## 6. Tests

```bash
cd backend && .venv/bin/python -m pytest -q        # 34 tests: seed, planner, scoring, evaluation pipeline (fake AI), provider routing, listening sections, security, backup/restore…
cd frontend && npm test                              # 9 tests: API errors, evaluation labelling, utilities
cd frontend && npx tsc -p tsconfig.json --noEmit     # type check
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach the local server" | Start the app with `./start.sh`; check nothing else uses port 8000 (`lsof -i :8000`). |
| "The Anthropic API key was rejected" | The key is invalid or revoked — create a new key in the Anthropic Console and save it in Settings → AI. |
| "Model … was not found" | Choose another model in Settings → AI (your key may not have access to it). |
| "Daily AI request/spend limit reached" | Raise the limit in Settings → AI, or wait until tomorrow. |
| Evaluation times out | Raise the timeout in Settings → AI, or pick a faster model. Your response is already saved — click Evaluate again. |
| Microphone not working | Allow microphone access for localhost in the browser; macOS: System Settings → Privacy → Microphone. |
| Listening uses the robotic browser voice | Natural voices need a Gemini key; if the notice says the daily quota is used up, it resets within 24 h — then use Listening → **Prepare all**. |
| "The daily Gemini quota … is used up" | Free-tier Gemini limits requests per model per day. Wait for the reset, or raise the quota in Google AI Studio. |
| No listening audio at all | The browser lacks speech synthesis and no Gemini audio exists yet — enable study mode for text-based practice (non-exam-equivalent). |
| News refresh shows errors for a source | Feeds change; the error is recorded per source. Disable or edit the source in Current Affairs → Sources. |
| Interface didn't update after pulling changes | `./start.sh` rebuilds automatically when sources change; otherwise `cd frontend && npm run build`. |
| Logs | `data/logs/app.log` (no keys, no note contents). |

## 8. About scores — important limitations

- **Objective practice accuracy** (listening/reading) is calculated from this app's answer keys. It is *not*
  converted to a CELPIP level, because official scaling is not public.
- **AI-estimated levels** (writing/speaking) are unofficial rubric-based judgements by a language model. They vary
  between runs and models, may be lenient or harsh, and cannot assess pronunciation/fluency from typed text.
- **Readiness** is a transparent heuristic (60% recent performance index, 20% study consistency, 20% practice volume).
  It is not a probability of any result, and no number of practice attempts guarantees Level 12.
- **Official results** appear only if you enter them in Analytics.

## 9. Project documents

[ARCHITECTURE.md](ARCHITECTURE.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · [TASKS.md](TASKS.md) ·
[CONTENT_SOURCES.md](CONTENT_SOURCES.md) · [CHANGELOG.md](CHANGELOG.md)
