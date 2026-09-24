# Horizon Tasks — rules for every Claude session

Read `NOTES.md` first (decisions, schema, process). This file is the standing
**safety checklist**. Apply it to every change, and re-check the whole diff against it
before every push.

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
  `useStore().commit` → `apply_changes` (atomic); category inserts via
  `useStore().addCategory`. No second guard.
- **Errors:** always surfaced in the UI; never swallowed.
- **Dependencies:** add only well-known packages. Run `npm audit` after adding one.
- **CI/workflows:** least-privilege `permissions:`; untrusted values go through `env:`,
  never directly into `run:` via `${{ }}`.
- **Destructive actions** (delete history, delete task) need in-app confirmation.
  Never use `confirm/alert/prompt`.

## Checks before every push

`npm run typecheck && npm run lint && npm test && npm run build && ./supabase/tests/run.sh && npm run e2e`

- `supabase/tests/run.sh`: migrations + RLS checks + attack suite + app↔DB contract test.
- `npm run e2e`: browser suite (mocked Supabase, production build with CSP).
- Any new table/function/field: add attack checks. Any new user-visible text
  field: add it to the XSS scenario in `e2e/suite.mjs`.
