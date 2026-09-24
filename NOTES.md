# Horizon Tasks — working notes

Source of truth for scope and decisions. Update on every change that touches
data, forms, handlers, render or storage.

## Architecture

- `src/domain/` — pure, tested logic: types, dates, validation (incl. Quick Add),
  tab placement + sorting, action planners (complete/skip/delete/restore,
  recurrence subtree clone). No I/O.
- `src/data/` — Supabase client, row↔domain mapping (`api.ts`), and the single
  write guard (`writeGuard.ts`).
- Every mutation = a `ChangeSet` built by a planner in `domain/actions.ts`, sent
  through `guardedWrite(key, …)` to the `apply_changes` RPC, which applies it in
  one transaction (all or nothing).
- `supabase/migrations/` — versioned, additive-only SQL. `supabase/tests/run.sh`
  runs them against a local Postgres with a stub `auth` schema plus behavioural
  checks (RLS isolation, integer priority, atomic rollback, seed-once).

## Schema v1 (0001_init.sql)

- `categories(id, user_id, name, color #rrggbb, sort_order, created_at)`
- `tasks` — active tasks only. `priority smallint 1–5`, `due_date date`
  (required unless `ongoing`), `checklist jsonb[]`, `parent_id` (FK, on delete
  cascade), `depth 0–4`, `recurrence_every_n_days`, `recurrence_end_date`.
- `completions` — History: `task_id`, `parent_id`, `outcome completed|skipped`,
  `due_date`, `completed_at`, full `snapshot jsonb`. No update policy.
- `profiles(user_id, starter_seeded_at)` — makes starter-category seeding one-time.
- RLS on every table: `user_id = auth.uid()`. A trigger checks a task's
  category/parent belong to the same user.
- `strict_int()` rejects `3.7` for priority/depth/interval instead of rounding
  (Postgres would otherwise round silently).

## Design discipline (each was a real bug before)

- Integer-only priority, checked in `validateTask` *and* in the DB.
- Never render user text as HTML: no `dangerouslySetInnerHTML` (lint: `react/no-danger`).
- One write guard only (`guardedWrite`). Same key while in flight → same
  promise; different key → visible `BusyError`.
- Validate on write. No `confirm/alert/prompt` (lint: `no-restricted-globals`).
- Errors always shown in the UI (`ErrorBanner`); data-layer helpers throw.
- Dates: `YYYY-MM-DD` local-day for due dates; timestamps UTC, shown in America/Los_Angeles.

## Assumptions made (confirm or correct)

1. **Max depth**: top-level is depth 0; subtasks allowed down to depth 4 (5 levels total).
2. **Ongoing tasks with a due date** also appear in Daily/Weekly/Monthly (only
   Later excludes them explicitly).
3. **Subtask due after parent**: save is refused with an inline message naming
   the parent's date (nothing is moved automatically).
4. **Monthly list window**: today through today+30 inclusive.
5. **Restore from History removes that History entry** (it becomes active again
   with its original id, so any of its own completed children reattach if restored).
6. **Cascade-completing a parent** records each descendant with the parent's
   outcome and does *not* separately advance a descendant's own recurrence.
   (A recurring subtask completed directly does advance, as a sibling.)
7. Starter category colors are placeholders until the real hexes are provided.

## Open items

- Supabase project + Google OAuth client (user) — see README.
- Hosting (Vercel/Netlify) — decide at deploy time.
- Import from the v4 artifact — once schema is live, via backend, never via repo.
- PWA icons: currently only the SVG favicon; add 192/512 PNGs + maskable before install testing.

## Log

- 2026-09-24 — Session 1: scaffold, schema v1 + SQL tests, domain logic + 24
  unit tests, Google sign-in wiring, minimal signed-in shell.
