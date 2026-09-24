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

## Security (see CLAUDE.md for the standing checklist)

- 0004_stale_write_guard: apply_changes rejects stale deletes/updates atomically.
- 0003_limits_and_shapes: size limits agree with the client, checklist shape
  constraint, apply_changes batch caps.
- 0002_hardening: `anon` has no table/function access; history has no UPDATE
  privilege; `strict_int` pins search_path; size limits (title 500, notes 20k,
  checklist ≤100 items/64KB, category name 60, snapshot 128KB).
- Auth uses the PKCE flow. The deploy workflow refuses secret/service_role keys.
- Supabase's "destructive operations" warning on 0001/0002 is triggered by the
  words `delete`/`revoke`; neither file removes data.
- After first sign-in: disable new sign-ups and the Email provider (SETUP Part 7).

### Security audit (session 2)

Methods: code review against CLAUDE.md; 30+ scripted attacks in
`supabase/tests/attack_test.sql` (cross-user read/write/delete/nesting,
identity spoofing, type confusion, injection, oversized batches, anon access);
mutation testing (deliberately removing RLS / trigger / constraints / grants —
each is caught by a named attack check); app↔DB contract test
(`supabase/tests/contract.test.ts`) with real planner payloads; browser attack
tests (XSS in every field, CSP injection + exfiltration, clickjacking); full
git-history secret scan; `npm audit`.

Found and fixed:
- **Size-limit mismatch** (bug): checklist/snapshot DB limits were byte-based and
  smaller than what the app allows with multi-byte text, so such tasks couldn't
  be saved or completed. 0003 raises them; the contract test proves agreement.
- **Checklist shape** was unchecked in the DB (malformed items could crash
  rendering): 0003 adds a shape constraint; the client also normalizes rows.
- **Batch caps**: apply_changes rejects non-array args and batches > 1000.
- **CSP** added to production builds (only own scripts; network only to self +
  Supabase). **Frame-busting** since GitHub Pages can't send frame headers.
- **Sync race**: a reload that started before a write could overwrite it with
  stale data; such reloads are now discarded.
- Subtasks no longer pre-fill the parent's category (spec: no default).

### Second pass (re-checking the first pass's own changes)

Found and fixed:
- **Checklist double tap silently dropped** (the write guard deduped the second
  tap). Items now lock visibly while saving; every tap takes effect or is visibly blocked.
- **Failed Google sign-in was invisible** (error came back in the URL and was
  ignored). Now shown on the sign-in screen, URL cleaned; getSession errors surfaced.
- **Sheet of a task removed on another device** stayed "open" invisibly (and
  hid error banners). It now closes with a notice; own completes/deletes excluded.
- **Discarded stale reload wasn't retried**, so other devices' changes could lag;
  now reloads again (bounded).
- A regression introduced during this pass (planning step moved outside the
  error handler) was caught in review and fixed before commit.
- Global safety net: unhandled errors/rejections show an on-screen banner.
- Keyboard: task rows are focusable and open with Enter/Space.
- Attack suite gap: removing the checklist-size or notes-length constraint went
  unnoticed; checks added, and every mutation is now caught.
- Verified: CSP doesn't block category colors; unit tests pass in 4 timezones
  (incl. UTC+14 / UTC−11); app updates never force-reload mid-edit.

### Session 3: full build + two review passes

Built: Weekly (list/week calendar), Monthly (30-day list/month calendar),
Later, History (restore, confirmed permanent delete, JSON/CSV export),
overdue popup (once per app open; Dismiss / Not needed / Complete; inline
cascade confirm; header pill reopens), Quick Add via the + menu (atomic,
all-or-nothing, resets), import from the v4 artifact or our own export
(preview first, idempotent, atomic), PNG/maskable/apple-touch icons,
60-second background sync while visible, offline banner.

Pass 1 (code-level: line review, property-based fuzzing, parser fuzzing,
DB contract) fixed: restore breaking the subtask-date rule; stale
history-delete sheet; misleading import error; lossy re-import of own export;
string-sorted history.

Pass 2 (black-box: two devices, 1000+1000 load, 320px, accessibility,
offline, published-bundle inspection) fixed: **completing the same task on
two devices recorded it twice and spawned two next occurrences** → migration
0004 makes apply_changes fail atomically when a task/history entry to delete
or update is already gone, and the app refreshes with a clear message;
technical offline errors → plain English + offline banner; faint/danger text
contrast raised to WCAG AA.

Documented behaviour (open question): a *recurring subtask*'s next occurrence
keeps its parent even when it lands after the parent's due date.

### Known gaps
Category rename/recolor/delete, moving a task under a different parent,
instant (realtime) sync (currently on focus + every 60 s), offline editing.

## Design discipline (each was a real bug before)

- Integer-only priority, checked in `validateTask` *and* in the DB.
- Never render user text as HTML: no `dangerouslySetInnerHTML` (lint: `react/no-danger`).
- One write guard only (`guardedWrite`). Same key while in flight → same
  promise; different key → visible `BusyError`.
- Validate on write. No `confirm/alert/prompt` (lint: `no-restricted-globals`).
- Errors always shown in the UI (`ErrorBanner`); data-layer helpers throw.
- Dates: `YYYY-MM-DD` local-day for due dates; timestamps UTC, shown in America/Los_Angeles.

## Confirmed decisions (2026-09-24)

1. **Max depth**: top-level is depth 0; subtasks allowed down to depth 4 (5 levels total).
2. **Ongoing tasks with a due date** also appear in Daily/Weekly/Monthly (only
   Later excludes them).
3. **Subtask due after parent**: save is refused with an inline message naming
   the parent's date (nothing is moved automatically).
4. **Monthly list window**: today through today+30 inclusive.
5. **Restore from History removes that History entry** (it becomes active again
   with its original id, so any of its own completed children reattach if restored).
6. **Cascade-completing a parent** records each descendant with the parent's
   outcome and does *not* separately advance a descendant's own recurrence.
   (A recurring subtask completed directly does advance, as a sibling.)
7. **Categories**: starters use the artifact's exact colors (MPH #5b8cff,
   Core Lab #34c2b0, KFAM #f2b84b, Admin #a687f0, Financial #4caf7d) plus
   **Other #8b929c** (neutral grey, outside the palette). Custom-category
   palette is the artifact's 10 colors.
8. **Build order**: Dashboard + Daily with full task form and Complete → overdue
   popup + History → Weekly/Monthly/Forever/Later → Quick Add → export → import.
9. **Hosting**: GitHub Pages via `.github/workflows/deploy.yml`, auto-deploy on
   push to the default branch, at https://jonathanskim96-ctrl.github.io/horizon-tasks/
   (Vite `base` from `BASE_PATH`). Supabase URL + publishable key come from repo
   *variables*, not committed files.
10. Visual theme: the artifact's dark palette (tokens in `src/index.css`).

## UI (session 2)

- `src/screens/Main.tsx` owns tabs, the single open sheet, toasts and action
  errors. Tabs built so far: Dashboard, Daily, Forever. The overdue pill opens
  Daily for now; the overdue popup comes next.
- `src/data/useStore.ts`: loads everything on sign-in, reloads when the app
  becomes visible (cross-device sync), `commit()` = guarded atomic write + local mirror.
- Forms validate with `validateTask` and show errors inline per field.
- **Added rule:** editing a parent to a due date earlier than one of its
  subtasks is refused with an inline message (mirror of the subtask rule).
- Browser-tested against a mocked Supabase (Playwright, scratch script):
  create/validate/subtask date rule/cascade complete/recurrence/delete/custom
  category/Forever; user text with HTML renders as plain text.

## Open items

- Supabase project + Google OAuth client (user) — step-by-step in `docs/SETUP.md`.
- Import from the v4 artifact — once schema is live, via backend, never via repo.
- PWA icons: currently only the SVG favicon; add 192/512 PNGs + maskable before install testing.

## Log

- 2026-09-24 — Session 1: scaffold, schema v1 + SQL tests, domain logic + 24
  unit tests, Google sign-in wiring, minimal signed-in shell.
- 2026-09-24 — Assumptions confirmed; real category colors + "Other"; dark theme; `docs/SETUP.md`.
- 2026-09-24 — GitHub Pages auto-deploy; setup guide rewritten browser-only.
- 2026-09-24 — Security pass: 0002_hardening, PKCE, size limits, safeColor, CLAUDE.md checklist.
- 2026-09-24 — Session 2: Dashboard, Daily, Forever, task form, detail, complete/delete flows.
- 2026-09-24 — Session 2b: test + security pass (contract, attack, mutation, browser suites), 0003, CSP.
- 2026-09-24 — Session 2c: second verification pass; 5 more fixes, suites extended (20 e2e, 60+ attack checks).
- 2026-09-24 — Session 3: full feature build; review pass 1 (code) + pass 2 (black-box); 0004.
