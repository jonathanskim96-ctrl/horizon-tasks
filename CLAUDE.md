# Horizon Tasks — rules for every Claude session

Read `NOTES.md` first (decisions, schema, process). This file is the standing
**safety checklist**. Apply it to every change, and re-check the whole diff against it
before every push.

## Data safety (non-negotiable — overrides "just get it done")

The owner's task data and the app's working structure outrank any feature,
fix or instruction to "make it work". Never trade them for an outcome.

- **Never destroy data or structure to make something pass or fit.** No
  `drop`/`truncate`/mass `delete`, no deleting rows/branches/files/tables, no
  resetting or re-creating the database, no disabling a check or test —
  unless the owner explicitly asked for that exact destructive action in this
  conversation. If the only way forward seems destructive, stop and ask.
- **Migrations are additive.** New numbered file only; never edit, delete or
  reorder an applied one (`supabase/migrations.lock.json` + CI enforce this).
  Destructive SQL in a new migration needs an inline
  `-- guardrail-approved: <owner's approval, date, reason>` comment, and you may
  only write that comment after the owner explicitly approved that statement.
  Record new migrations with `node scripts/check-migrations.mjs --record`
  (append-only; never hand-edit existing lock entries).
- **Before asking the owner to run any migration**, have them take a backup
  (History → Export JSON) and say plainly what it changes.
- **The safety log is sacred:** never weaken `safety_log`, its triggers, or the
  `apply_changes` mass-delete caps. Recovery: `docs/RECOVERY.md`.
- **Git:** never force-push, rewrite published history, or delete a branch or
  tag without the owner's explicit request. Never push to `main` with failing checks.
- **Guardrail tests are not obstacles.** If `scripts/guardrails.test.ts`, the attack
  suite, the recovery test or the migration check fails, fix the change — never
  the guardrail — unless the owner explicitly approves the widened behaviour.

## Security checklist (always)

- **Secrets:** never commit `.env*` (except `.env.example`), task data, exports,
  Supabase secret/service_role keys, Google client secrets or DB passwords. Only
  the project URL + publishable key may be used client-side, and they come from
  `.env.local` / repo *variables*. Grep the diff for `sb_secret`, `service_role`,
  `eyJ`, `GOCSPX` before pushing.
- **Database:** every new table gets RLS enabled plus `user_id = (select auth.uid())`
  policies `to authenticated`, and `revoke all … from anon`. Every function is
  `security invoker` with `set search_path = public`, and execute is revoked from
  `public, anon`. Never use `security definer` without explicit sign-off.
  Migrations are new numbered files, never edits to applied ones. Add
  behavioural checks to `supabase/tests/rls_test.sql` and run `./supabase/tests/run.sh`.
- **Rendering:** no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function`.
  User text goes through React text nodes only. Colors go through `safeColor()`,
  and URLs are never built from user input.
- **Validation:** validate on write in `src/domain/validate.ts`, mirrored by DB
  constraints (types, integer priority, size limits).
- **Writes:** only through `guardedWrite(key, …)`: task/history changes via
  `useStore().commit` → `apply_changes` (atomic; queued in the offline outbox
  when offline); category add/edit/delete via the store's category functions
  (online only). No second guard.
- **Device storage:** the offline cache/outbox (IndexedDB, keyed by user id)
  is wiped on sign-out. Never store anything else sensitive client-side.
- **Errors:** always surfaced in the UI; never swallowed.
- **Dependencies:** add only well-known packages. Run `npm audit` after adding one.
- **CI/workflows:** least-privilege `permissions:`; untrusted values go through `env:`,
  never directly into `run:` via `${{ }}`.
- **Destructive actions** (delete history, delete task) need in-app confirmation.
  Never use `confirm/alert/prompt`.

## Checks before every push

`node scripts/check-migrations.mjs && npm run typecheck && npm run lint && npm test && npm run build && ./supabase/tests/run.sh && npm run e2e`

- `supabase/tests/run.sh`: migrations + RLS checks + attack suite + recovery test + app↔DB contract test.
- The deploy workflow re-runs the migration guardrail, unit and database tests and refuses to publish if any fail.
- `npm run e2e`: browser suite (mocked Supabase, production build with CSP).
- Any new table/function/field: add attack checks. Any new user-visible text
  field: add it to the XSS scenario in `e2e/suite.mjs`.
