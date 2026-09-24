-- Restore rows deleted in the last N days from the safety log.
-- Paste into Supabase → SQL Editor, edit the two lines marked EDIT, run.
-- Safe: it only ADDS BACK rows that are missing. It never deletes or
-- overwrites anything, and running it twice changes nothing the second time.
-- Tasks that were *completed* (they're in History) are not brought back.
do $$
declare
  owner_email text     := 'YOUR_EMAIL_HERE';   -- EDIT: the Google email you sign in with
  since       interval := '1 day';             -- EDIT: how far back the damage goes
  owner       uuid;
  n_cat int := 0; n_task int := 0; n_hist int := 0; n int; skipped int;
begin
  select id into owner from auth.users where email = owner_email;
  if owner is null then raise exception 'No user with email %', owner_email; end if;

  insert into public.categories
    select (jsonb_populate_record(null::public.categories, old_row)).*
    from (select distinct on (row_id) row_id, old_row from public.safety_log
          where user_id = owner and table_name = 'categories' and op = 'DELETE' and at > now() - since
          order by row_id, at desc) l
    where not exists (select 1 from public.categories c where c.id = l.row_id);
  get diagnostics n_cat = row_count;

  -- Tasks level by level, so a subtask only returns once its parent exists.
  for level in 0..4 loop
    insert into public.tasks
      select (jsonb_populate_record(null::public.tasks, old_row)).*
      from (select distinct on (row_id) row_id, old_row from public.safety_log
            where user_id = owner and table_name = 'tasks' and op = 'DELETE' and at > now() - since
            order by row_id, at desc) l
      where (old_row->>'depth')::int = level
        and not exists (select 1 from public.tasks t where t.id = l.row_id)
        and not exists (select 1 from public.completions c where c.task_id = l.row_id)
        and (old_row->>'parent_id' is null or exists (select 1 from public.tasks p where p.id = (old_row->>'parent_id')::uuid))
        and exists (select 1 from public.categories c where c.id = (old_row->>'category_id')::uuid);
    get diagnostics n = row_count;
    n_task := n_task + n;
  end loop;

  insert into public.completions
    select (jsonb_populate_record(null::public.completions, old_row)).*
    from (select distinct on (row_id) row_id, old_row from public.safety_log
          where user_id = owner and table_name = 'completions' and op = 'DELETE' and at > now() - since
          order by row_id, at desc) l
    where not exists (select 1 from public.completions c where c.id = l.row_id);
  get diagnostics n_hist = row_count;

  select count(distinct row_id) into skipped from public.safety_log l
    where user_id = owner and table_name = 'tasks' and op = 'DELETE' and at > now() - since
      and not exists (select 1 from public.tasks t where t.id = l.row_id)
      and not exists (select 1 from public.completions c where c.task_id = l.row_id);
  raise notice 'Restored % categories, % tasks, % history entries. % deleted task(s) could not come back (their parent or category is gone) — ask Claude for help with those.', n_cat, n_task, n_hist, skipped;
end $$;
