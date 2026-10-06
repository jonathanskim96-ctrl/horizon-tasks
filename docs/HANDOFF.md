# Horizon Tasks — handoff (read this first)

Compact current state as of 2026-10-06. Details/history: `NOTES.md`. Rules:
`CLAUDE.md` (data safety + security checklist — always apply).

## What it is
Personal task planner PWA (single user: the repo owner). React + Vite + TS,
`vite-plugin-pwa`, Supabase (Postgres + Auth, Google sign-in). Public repo,
code only — task data lives only in Supabase and never goes in the repo.

- Live: https://jonathanskim96-ctrl.github.io/horizon-tasks/ (GitHub Pages,
  auto-deploys from `main` after the `verify` job passes).
- Supabase project ref: `szgrupwtdzmxnbijyyci`. This cloud environment can't
  reach Supabase or github.io — the owner runs SQL in the Supabase SQL Editor.
- Branch: `main` only (default; ruleset blocks deletion + force-push).
  Old artifact v4 is retired; its data was imported (4 tasks, 5 history).
- Installed on the owner's Android phone.

## Status
- Full spec built: Dashboard, Daily, Weekly/Monthly (list + calendar), Forever,
  Later, History (restore, confirmed permanent delete, JSON/CSV export,
  import), overdue popup (Dismiss / Not needed / Complete), Quick Add, task form
  (subtasks ≤ depth 4, move between parents, checklist, recurrence), categories
  (add/rename/recolor/delete-with-move), live sync (Realtime), offline editing
  (IndexedDB cache + ordered outbox), installable PWA (shortcuts, install
  button, iOS steps), auto-updating service worker (build id in footer).
- Migrations 0001–0007 are **all applied** in the owner's Supabase (0007,
  optional priority/category, run 2026-10-05: "Success"). The next migration
  is `0008_…`.
- Known gaps: none from the spec.

## Key decisions (owner-confirmed)
- Priority: **removed from the app** (2026-10-06, owner: "not using it").
  No picker in the form or Quick Add, no P-chips, not used for sorting, no
  "Needs priority" tag. The DB column stays (nullable, 0007) — no migration;
  old values are kept untouched on edit and still go in exports/imports.
  New tasks save priority = null.
- Category optional (starter: MPH, Core Lab, KFAM, Admin, Financial, Other).
  Blank = "fill in later": the task shows a "Needs category" tag.
- Sorting: overdue pinned first → due date → title (Forever: title → due).
- Depth: top-level 0, subtasks to depth 4. Subtask due ≤ parent due (save
  refused with message; a parent can't move earlier than its subtasks).
- Recurrence counts from the due date. A recurring subtask whose next
  occurrence would pass its parent becomes top-level.
- Weekly tab = rolling today..today+7 (not Sun–Sat). Dashboard "This week" =
  that window minus today/overdue (no repeats of "Today").
- Forever tasks with a due date also appear in date tabs. Monthly list =
  today..today+30. Restore removes the History entry; completing a parent
  cascades to subtasks (warn first).
- Quick Add: title / due / category; blank rows skipped, category optional, any invalid
  titled row (e.g. no due date) blocks the batch.
- Sign-out: this device only; wipes the offline copy (warns if unsynced).

## Architecture in one breath
Pure domain logic in `src/domain/` (validate, placement, actions/planners,
import/export) → every change is a `ChangeSet` sent through `guardedWrite` →
`useStore().commit` → RPC `apply_changes` (atomic; rejects stale writes,
caps mass deletes). DB: RLS everywhere, `safety_log` (append-only copy of
every update/delete), no TRUNCATE for app roles.

## Before any change
Run: `node scripts/check-migrations.mjs && npm run typecheck && npm run lint &&
npm test && npm run build && ./supabase/tests/run.sh && npm run e2e`
(e2e needs Playwright; `e2e/run.sh` installs it; Chromium at /opt/pw-browsers).
Migrations: new numbered file + `node scripts/check-migrations.mjs --record`;
have the owner export a backup (History → Export JSON) before running any.
Environment gotcha: don't `pkill -f` patterns that appear in your own command
line (it kills the tool shell); stop servers with `fuser -k <port>/tcp`.

## Where things are
- `docs/SETUP.md` (setup, all migration links), `docs/RECOVERY.md` +
  `supabase/recovery/restore_deleted.sql` (restore deleted data).
- Tests: `src/**/*.test.ts` (unit, fuzz), `scripts/guardrails.test.ts`,
  `supabase/tests/` (RLS, attack, recovery, contract), `e2e/` (browser, PWA,
  update).
