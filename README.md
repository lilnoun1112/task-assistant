# Task Assistant (desktop)

A small floating character that opens one private, editable overview of your work, pulled from
Asana, Google Calendar, a Google Doc checklist, Gmail and Slack DMs. All changes stay local, and the app
never writes anything back to those services.

**Status: Phase 1 (Foundation) done.** That covers the sprite, popup, editable list, SQLite storage and sample data.
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
```

To try it: open ⚙ Settings, choose **Load sample data**, edit some tasks, then choose **Simulate refresh**. The
fake sources change (a renamed task, a moved deadline, a ticked Doc item, a new email) and your edits
survive.

## Layout

```
src/lib/core/types.ts      domain types (IncomingRecord, SyncBatch, TaskView…)
src/lib/core/repo.ts       TaskRepository: refresh-merge rules + all local edits
src/lib/core/views.ts      Today/Upcoming/Review/Done bucketing, filters, sort, daily summary
src/lib/db/                Db interface, migrations, adapters (Tauri plugin-sql / sql.js / node:sqlite)
src/lib/sync/engine.ts     Connector interface + runSync (per-source error isolation)
src/lib/sync/sample.ts     fake connectors for Phase 1
src/lib/ui/                Svelte 5 components (Popup, TaskRow, ReviewCard, Settings, Sprite)
src-tauri/                 Rust shell: sprite + popup windows, tray menu, autostart, window-state
tests/repo.test.ts         acceptance tests for the data rules
```

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

## Roadmap

| Phase | Deliverable | Acceptance check |
|---|---|---|
| 1 ✅ Foundation | Sprite, popup, editable list, SQLite, sample data | Tasks persist after restart; edits survive simulated refresh |
| 2 Explicit tasks | Asana (PAT), Google Doc checklist, Calendar | Assigned tasks, unchecked Doc items and real meetings show with links; time logs stay out |
| 3 Communications | Gmail + Slack DM incremental import, review queue | New requests appear once, chat can be dismissed, thread links work |
| 4 Refinement | Extraction tuning, relationship suggestions, optional local model | Measured on a real message sample |
| 5 Packaging | Windows installer, settings, backup / clear data, reconnect flows | Usable without dev tools |

Phase 2 also adds OS keychain storage for tokens (`keyring` crate) and the Google loopback OAuth flow (PKCE).

## Known Phase 1 trade-offs

- `tauri-plugin-sql` uses a connection pool, so the merge doesn't run inside one SQL transaction. It relies
  on idempotency instead (see above). If this becomes a problem, the sync merge can move into a Rust command
  using `rusqlite` with a real transaction.
- "Hide" from the brief is treated the same as Dismiss. Dismissed items are listed under Done → Dismissed and
  can be restored.
- Undated tasks go under Upcoming → No date, not under Today.
