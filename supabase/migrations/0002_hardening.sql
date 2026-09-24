-- Security hardening on top of 0001 (safe to run on an empty or populated DB).
-- 1. Signed-out visitors (role `anon`) get no access to any table or function.
-- 2. Every function pins its search_path.
-- 3. Size limits so no single write can be absurdly large.

-- ── 1. Lock out the anonymous role (RLS already hides rows; this removes access entirely)
revoke all on table public.categories, public.tasks, public.completions, public.profiles from anon;
revoke execute on function public.seed_starter_categories(jsonb) from public, anon;
revoke execute on function public.apply_changes(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.strict_int(jsonb) from public, anon;
revoke execute on function public.tasks_check_ownership() from public, anon;
grant execute on function public.seed_starter_categories(jsonb) to authenticated;
grant execute on function public.apply_changes(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.strict_int(jsonb) to authenticated;
grant execute on function public.tasks_check_ownership() to authenticated;
-- History stays append-only even at the privilege level (no UPDATE at all).
revoke update on table public.completions from authenticated;

-- ── 2. Pin search_path (the only function from 0001 without it)
alter function public.strict_int(jsonb) set search_path = public;

-- ── 3. Size limits (mirrored in src/domain/validate.ts)
alter table public.tasks
  add constraint title_length check (length(title) <= 500),
  add constraint notes_length check (length(notes) <= 20000),
  add constraint checklist_size check (jsonb_array_length(checklist) <= 100 and pg_column_size(checklist) <= 65536);
alter table public.categories
  add constraint name_length check (length(name) <= 60);
alter table public.completions
  add constraint snapshot_size check (pg_column_size(snapshot) <= 131072);
