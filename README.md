# Task Assistant (desktop)

A small floating character that opens one private, editable overview of your work, pulled from
Asana, Google Calendar, a Google Doc checklist, Gmail and Slack DMs. All changes stay local, and the app
never writes anything back to those services.

**Status:** Phase 1 (Foundation) is done: sprite, popup, editable list, SQLite storage and sample data. Local AI
extraction (from Phase 4) is also in, so emails and DMs can be read by a free model running on your own computer.
Real connectors are Phase 2 and 3.

## Run it

Prerequisites: Node 22+, Rust (stable), and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/)
(on Windows: WebView2 and the MSVC build tools).

```bash
npm install
npm run tauri dev        # desktop app: sprite + tray + popup
npm run dev              # popup only, in a browser at http://localhost:1420 (uses sql.js + localStorage)
npm test                 # data layer tests (node:sqlite)
npm run check            # svelte-check / TypeScript
npm run tauri build      # installer (NSIS/MSI on Windows)
npm run eval             # score request detection on labelled messages (see "Local AI")
```

To try it: open ⚙ Settings, choose **Load sample data**, edit some tasks, then choose **Simulate refresh**. The
fake sources change (a renamed task, a moved deadline, a ticked Doc item, a new email) and your edits
survive.

## Layout

```
src/lib/core/types.ts      domain types (IncomingRecord, SyncBatch, TaskView…)
src/lib/core/repo.ts       TaskRepository: refresh-merge rules + all local edits
src/lib/core/views.ts      pending/done bucketing, filters, sort, daily summary
src/lib/db/                Db interface, migrations, adapters (Tauri plugin-sql / sql.js / node:sqlite)
src/lib/sync/engine.ts     Connector interface + runSync (per-source error isolation)
src/lib/sync/sample.ts     fake connectors for trying the app
src/lib/extract/           request detection: pre-filter, keyword rules, Ollama client, output checks, deadlines
scripts/eval-extract.ts    scoring script; evals/sample-messages.jsonl is a synthetic labelled set
src/lib/ui/                Svelte 5 components (Popup, TaskRow, ReviewCard, Settings, Sprite)
src-tauri/                 Rust shell: sprite + popup windows, tray menu, autostart, window-state
tests/                     data-rule and extraction tests (incl. a stand-in Ollama server)
```

## Popup layout

- **Pending**: everything still open in one list. Suggestions from mail and DMs sit on top under
  *Needs review* until you accept or reject them; then come tasks and meetings, sorted by date (or priority).
- **Done**: completed tasks, newest first, each with a delete icon (click once to arm, again to delete).
  Snoozed and dismissed items are folded away below and can be restored.
- The **filter icon** in the header opens search, sort and source filters. While a filter is active, the icon
  shows a dot and a "Filtered … Clear" line stays visible.

Deleting a task is permanent: syncing the same item again does not bring it back.

## Data model and merge rules

Source data and local state are stored separately:

- `source_records`: what a service says (service, account, source id, thread id, URL, timestamps, excerpt,
  fingerprint, `active`/`unavailable`). A refresh overwrites these.
- `tasks`: what you decided (title override, notes, due override, priority, completion, snooze, dismissal,
  review state). A refresh never overwrites these.
- `task_sources`: links tasks to records. It is many-to-many, so one task can carry several source badges.
- `subtasks`, `sync_state` (cursor, last success, last error per source), `settings`.

On every sync (`TaskRepository.applySync`):

| Situation | What happens |
|---|---|
| New record (Asana, Doc, Calendar) | New task in the main list |
| New message with a suggestion (Gmail, Slack) | New suggestion in **Review**; routine chat is stored for thread context but gets no task |
| Same record, same fingerprint | Source fields are refreshed and the task is untouched |
| Fingerprint changed (title, due, start or end) | Task flagged **Changed in source**. If you had completed or dismissed it, it reopens. Your edits are kept |
| Missing from a snapshot, or reported removed | Record becomes `unavailable` and the task stays until you resolve it |
| Rejected suggestion seen again | Stays rejected |

Edited fields win over source fields. If you edit a title back to the source title, the override is dropped,
so later renames show through again.

Each sync step is idempotent, and the cursor only moves forward after a successful merge. A sync that is
interrupted halfway converges on the next run. A failing source keeps its previous data, and the popup shows
which source is stale and why.

## Local AI (reading mail and DMs)

New emails and Slack DMs are checked for requests addressed to you. They land in **Review** as suggestions,
and nothing becomes a task until you accept it. Settings → *Reading mail and DMs* picks the engine:

- **Keyword rules** (default): no setup. It catches requests phrased the obvious way ("can you…", "please…").
- **Local AI model (Ollama)**: free, and messages never leave your computer. It also catches implicit and
  indirect requests.

Setting up Ollama:

1. Install [Ollama](https://ollama.com) and make sure it's running (it sits in the tray on Windows).
2. `ollama pull qwen3:8b` downloads about 5 GB and needs roughly 8 GB of free memory. On a lighter laptop use
   `qwen3:4b`. Any instruction-tuned chat model works; pick whichever scores best on your messages (below).
3. In the app: Settings → Local AI model → **Check connection**, pick the model, and enter your name and handles.

How it works (`src/lib/extract/`):

| Step | What happens |
|---|---|
| Pre-filter | Your own messages, newsletters/bulk mail, no-reply senders, calendar notifications and small talk ("thanks!") are skipped without calling the model |
| Extraction | The model gets the latest message plus up to 5 earlier thread messages and must answer in a fixed JSON format: is it a request, who it's for, a short action, an **exact quote**, and the **exact deadline words** |
| Checks in code | If the quote isn't really in the message, ownership becomes "unclear". The model never supplies a date: the app parses the deadline words itself and only accepts unambiguous ones ("by Friday", "Oct 10"). "The 15th" becomes a note, never a date |
| Fallback | If Ollama is down or too slow, that sync uses keyword rules and the popup says so |
| Once only | Each message is analysed once, when first seen. Re-fetches don't call the model again |

The **daily brief** at the top of the Pending tab is written by the local model from your stored tasks (3–6 bullets). Without
a model, or if the model fails, a rule-based brief is shown instead.

### Scoring it on your own messages

Copy 50–100 real messages into `evals/<anything>.local.jsonl`, one per line, in the format of
`evals/sample-messages.jsonl`, and label each one. Files ending in `.local.jsonl` are git-ignored. Then run:

```bash
npm run eval -- --engine both --model qwen3:8b --name Marcell --file evals/mine.local.jsonl
```

This prints requests found, suggestions that were correct, owner and due-date accuracy, invented dates, time per
message, and every miss. Use it to compare models, or to compare local against an API model later. On the
synthetic sample set, keyword rules find 6 of 9 requests and raise 1 false alarm.

### Switching to an API model later

Extractors share one small interface (`src/lib/extract/types.ts`). An API-backed extractor (e.g. Claude) is one
more file next to `ollama.ts` that reuses the same prompt, JSON format and checks, plus a settings option. Your
labelled `.local.jsonl` set then tells you whether the switch is worth it.

## Roadmap

| Phase | Deliverable | Acceptance check |
|---|---|---|
| 1 ✅ Foundation | Sprite, popup, editable list, SQLite, sample data | Tasks persist after restart; edits survive simulated refresh |
| 2 Explicit tasks | Asana (PAT), Google Doc checklist, Calendar | Assigned tasks, unchecked Doc items and real meetings show with links; time logs stay out |
| 3 Communications | Gmail + Slack DM incremental import, review queue | New requests appear once, chat can be dismissed, thread links work |
| 4 Refinement | ✅ Local model extraction + daily brief; next: tuning on real messages, relationship suggestions | Measured on a real message sample |
| 5 Packaging | Windows installer, settings, backup / clear data, reconnect flows | Usable without dev tools |

Phase 2 also adds OS keychain storage for tokens (`keyring` crate) and the Google loopback OAuth flow (PKCE).

## Known Phase 1 trade-offs

- `tauri-plugin-sql` uses a connection pool, so the merge doesn't run inside one SQL transaction. It relies
  on idempotency instead (see above). If this becomes a problem, the sync merge can move into a Rust command
  using `rusqlite` with a real transaction.
- "Hide" from the brief is treated the same as Dismiss. Dismissed items are listed under Done → Dismissed and
  can be restored.
