-- 0006: data-safety guardrails. Nothing here deletes or rewrites data.
-- 1. App roles lose table powers they never need — notably TRUNCATE, which
--    ignores row-level security and could wipe every user's rows at once.
-- 2. An append-only safety log keeps a copy of every task, history entry and
--    category row before it is changed or deleted (by any code path), so data
--    is recoverable even after a bad release. The app can add to the log but
--    can never edit or erase it. Recovery steps: docs/RECOVERY.md.
-- 3. apply_changes refuses mass deletions a bug might attempt.

-- ── 1. Least privilege on tables and schema
revoke truncate, references, trigger on table public.categories, public.tasks, public.completions, public.profiles from anon, authenticated;
revoke create on schema public from public, anon, authenticated;

-- ── 2. Safety log
create table public.safety_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  table_name  text not null check (table_name in ('tasks', 'completions', 'categories')),
  op          text not null check (op in ('UPDATE', 'DELETE')),
  row_id      uuid not null,
  old_row     jsonb not null,
  at          timestamptz not null default now()
);
create index safety_log_user_idx on public.safety_log (user_id, at desc);
alter table public.safety_log enable row level security;
create policy "read own safety log" on public.safety_log for select to authenticated
  using (user_id = (select auth.uid()));
create policy "log own rows" on public.safety_log for insert to authenticated
  with check (user_id = (select auth.uid()));
revoke all on table public.safety_log from anon;
revoke update, delete, truncate, references, trigger on table public.safety_log from authenticated;
grant select, insert on table public.safety_log to authenticated;

create or replace function public.safety_log_capture() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  insert into public.safety_log (user_id, table_name, op, row_id, old_row)
  values (old.user_id, tg_table_name, tg_op, old.id, to_jsonb(old));
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.safety_log_capture() from public, anon;
grant execute on function public.safety_log_capture() to authenticated;

create trigger tasks_safety_log before update or delete on public.tasks
  for each row execute function public.safety_log_capture();
create trigger completions_safety_log before update or delete on public.completions
  for each row execute function public.safety_log_capture();
create trigger categories_safety_log before update or delete on public.categories
  for each row execute function public.safety_log_capture();

-- ── 3. Mass-deletion caps (same body as 0004 plus the guardrail block)
create or replace function public.apply_changes(
  inserts jsonb default '[]', updates jsonb default '[]', deletes jsonb default '[]',
  completions jsonb default '[]', history_deletes jsonb default '[]'
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  r jsonb;
  wanted int;
  removed int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(inserts) <> 'array' or jsonb_typeof(updates) <> 'array' or jsonb_typeof(deletes) <> 'array'
     or jsonb_typeof(completions) <> 'array' or jsonb_typeof(history_deletes) <> 'array' then
    raise exception 'apply_changes: every argument must be an array';
  end if;
  if jsonb_array_length(inserts) > 1000 or jsonb_array_length(updates) > 1000 or jsonb_array_length(deletes) > 1000
     or jsonb_array_length(completions) > 1000 or jsonb_array_length(history_deletes) > 1000 then
    raise exception 'apply_changes: batch too large';
  end if;
  -- Guardrails against mass deletion by a buggy client: the app never needs
  -- more than this in one save (one subtree; one history entry at a time).
  if jsonb_array_length(deletes) > 200 then
    raise exception 'guardrail: refusing to delete more than 200 tasks in one change';
  end if;
  if jsonb_array_length(history_deletes) > 1 then
    raise exception 'guardrail: history entries can only be deleted one at a time';
  end if;

  insert into public.completions (id, task_id, parent_id, outcome, due_date, completed_at, snapshot)
    select coalesce((c->>'id')::uuid, gen_random_uuid()), (c->>'task_id')::uuid, (c->>'parent_id')::uuid,
           c->>'outcome', (c->>'due_date')::date,
           coalesce((c->>'completed_at')::timestamptz, now()), c->'snapshot'
    from jsonb_array_elements(completions) c;

  -- Every task to delete must still exist (RLS: only the caller's own rows count).
  select count(distinct (d#>>'{}')::uuid) into wanted from jsonb_array_elements(deletes) d;
  with gone as (
    delete from public.tasks where id in (select (d#>>'{}')::uuid from jsonb_array_elements(deletes) d) returning 1
  ) select count(*) into removed from gone;
  if removed < wanted then
    raise exception 'stale: this task was already changed on another device' using errcode = 'P0409';
  end if;

  for r in select * from jsonb_array_elements(inserts) loop
    insert into public.tasks (id, title, notes, priority, category_id, ongoing, due_date, checklist,
                              parent_id, depth, recurrence_every_n_days, recurrence_end_date, created_at)
    values (coalesce((r->>'id')::uuid, gen_random_uuid()), r->>'title', coalesce(r->>'notes', ''),
            public.strict_int(r->'priority'), (r->>'category_id')::uuid, coalesce((r->>'ongoing')::boolean, false),
            (r->>'due_date')::date, coalesce(r->'checklist', '[]'::jsonb), (r->>'parent_id')::uuid,
            coalesce(public.strict_int(r->'depth'), 0), public.strict_int(r->'recurrence_every_n_days'),
            (r->>'recurrence_end_date')::date, coalesce((r->>'created_at')::timestamptz, now()));
  end loop;

  for r in select * from jsonb_array_elements(updates) loop
    update public.tasks set
      title = r->>'title', notes = coalesce(r->>'notes', ''), priority = public.strict_int(r->'priority'),
      category_id = (r->>'category_id')::uuid, ongoing = coalesce((r->>'ongoing')::boolean, false),
      due_date = (r->>'due_date')::date, checklist = coalesce(r->'checklist', '[]'::jsonb),
      parent_id = (r->>'parent_id')::uuid, depth = coalesce(public.strict_int(r->'depth'), 0),
      recurrence_every_n_days = public.strict_int(r->'recurrence_every_n_days'),
      recurrence_end_date = (r->>'recurrence_end_date')::date
    where id = (r->>'id')::uuid;
    if not found then
      raise exception 'stale: this task was already changed on another device' using errcode = 'P0409';
    end if;
  end loop;

  select count(distinct (d#>>'{}')::uuid) into wanted from jsonb_array_elements(history_deletes) d;
  with gone as (
    delete from public.completions where id in (select (d#>>'{}')::uuid from jsonb_array_elements(history_deletes) d) returning 1
  ) select count(*) into removed from gone;
  if removed < wanted then
    raise exception 'stale: this history entry was already changed on another device' using errcode = 'P0409';
  end if;
end $$;

revoke execute on function public.apply_changes(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_changes(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
