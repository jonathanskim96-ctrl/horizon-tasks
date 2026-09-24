-- 0004: reject stale writes from a second device.
-- Completing the same task on two devices used to record it twice and spawn
-- two next occurrences, because deleting an already-deleted task silently did
-- nothing. apply_changes now fails the whole batch (nothing is written) when
-- any task or history entry it expects to delete is already gone.
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
