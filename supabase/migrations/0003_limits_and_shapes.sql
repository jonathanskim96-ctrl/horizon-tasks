-- 0003: fixes + hardening found by the contract/attack tests.
-- 1. Size limits now agree with the app's validator in the worst case
--    (multi-byte text): anything the app accepts, the DB accepts, and a task
--    at the limits can still be completed (its snapshot fits).
-- 2. Checklist items must be {text: string ≤ 500, done: boolean}.
-- 3. apply_changes refuses absurdly large batches.

-- ── 1. limits
alter table public.tasks drop constraint checklist_size;
alter table public.tasks add constraint checklist_size
  check (jsonb_array_length(checklist) <= 100 and pg_column_size(checklist) <= 262144);
alter table public.completions drop constraint snapshot_size;
alter table public.completions add constraint snapshot_size check (pg_column_size(snapshot) <= 524288);

-- ── 2. checklist shape
create or replace function public.is_valid_checklist(c jsonb) returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(c) = 'array' and not exists (
    select 1 from jsonb_array_elements(c) e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e->'text') is distinct from 'string'
       or jsonb_typeof(e->'done') is distinct from 'boolean'
       or length(e->>'text') > 500
  )
$$;
revoke execute on function public.is_valid_checklist(jsonb) from public, anon;
grant execute on function public.is_valid_checklist(jsonb) to authenticated;
alter table public.tasks add constraint checklist_shape check (public.is_valid_checklist(checklist));

-- ── 3. batch caps (same body as 0001 plus the guard at the top)
create or replace function public.apply_changes(
  inserts jsonb default '[]', updates jsonb default '[]', deletes jsonb default '[]',
  completions jsonb default '[]', history_deletes jsonb default '[]'
) returns void
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
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

  delete from public.tasks where id in (select (d#>>'{}')::uuid from jsonb_array_elements(deletes) d);

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
    if not found then raise exception 'task % not found', r->>'id'; end if;
  end loop;

  delete from public.completions where id in (select (d#>>'{}')::uuid from jsonb_array_elements(history_deletes) d);
end $$;
revoke execute on function public.apply_changes(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.apply_changes(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated;
