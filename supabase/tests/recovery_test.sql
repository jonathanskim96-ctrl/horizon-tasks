-- Proves the safety log captures destructive changes from every path and that
-- the steps in docs/RECOVERY.md bring the data back. Runs after the other tests.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-0000000000cc') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000e', 'owner@example.com') on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select public.seed_starter_categories('[{"name":"Work","color":"#112233"},{"name":"Home","color":"#445566"}]') is not null as seeded;
select public.apply_changes(inserts => jsonb_build_array(
  jsonb_build_object('id','e0000000-0000-0000-0000-000000000001','title','Thesis','notes','years of work','priority',5,
    'category_id',(select id from public.categories where name='Work'),'due_date','2026-12-01'),
  jsonb_build_object('id','e0000000-0000-0000-0000-000000000002','title','Chapter','priority',4,'depth',1,
    'parent_id','e0000000-0000-0000-0000-000000000001','category_id',(select id from public.categories where name='Work'),'due_date','2026-11-01')));
select public.apply_changes(completions => '[{"id":"e0000000-0000-0000-0000-0000000000c1","task_id":"e0000000-0000-0000-0000-000000000009","outcome":"completed","snapshot":{"title":"Old win"}}]');

-- A task legitimately completed (moved to History) must NOT be resurrected.
select public.apply_changes(inserts => jsonb_build_array(jsonb_build_object('id','e0000000-0000-0000-0000-000000000003','title','Done properly','priority',1,
  'category_id',(select id from public.categories where name='Work'),'due_date','2026-10-01')));
select public.apply_changes(
  completions => '[{"id":"e0000000-0000-0000-0000-0000000000c3","task_id":"e0000000-0000-0000-0000-000000000003","outcome":"completed","snapshot":{"title":"Done properly"}}]',
  deletes => '["e0000000-0000-0000-0000-000000000003"]');

-- Simulate a bad release: an edit that blanks notes, then a delete of the whole
-- tree (child removed by cascade), a history delete, and a category delete.
update public.tasks set notes = '' where id = 'e0000000-0000-0000-0000-000000000001';
select public.apply_changes(deletes => '["e0000000-0000-0000-0000-000000000001"]');
select public.apply_changes(history_deletes => '["e0000000-0000-0000-0000-0000000000c1"]');
delete from public.categories where name = 'Home';
do $$ begin
  assert (select count(*) from public.tasks) = 0, 'setup: tasks gone';
  assert (select count(*) from public.safety_log where table_name = 'tasks' and op = 'DELETE') = 3, 'cascade delete not logged';
  assert (select count(*) from public.safety_log where table_name = 'tasks' and op = 'UPDATE') >= 1, 'edit not logged';
  assert (select count(*) from public.safety_log where table_name = 'completions') = 1, 'history delete not logged';
  assert (select count(*) from public.safety_log where table_name = 'categories') = 1, 'category delete not logged';
  assert (select old_row->>'notes' from public.safety_log where table_name = 'tasks' and op = 'UPDATE' limit 1) = 'years of work', 'old value not kept';
end $$;
reset role;

-- ── Recovery: the exact script from supabase/recovery/restore_deleted.sql ──
\i restore_filled.sql

-- Undo an overwrite: put back the value from before the edit.
update public.tasks t set notes = l.old_row->>'notes'
  from (select distinct on (row_id) row_id, old_row from public.safety_log
        where table_name = 'tasks' and op = 'UPDATE' order by row_id, at asc) l
  where t.id = l.row_id and t.notes = '';
do $$ begin
  assert (select count(*) from public.tasks where user_id = '00000000-0000-0000-0000-00000000000e') = 2, 'tasks not recovered (or a completed one was resurrected)';
  assert (select count(*) from public.tasks where id = 'e0000000-0000-0000-0000-000000000003') = 0, 'completed task resurrected';
  assert (select parent_id from public.tasks where id = 'e0000000-0000-0000-0000-000000000002') = 'e0000000-0000-0000-0000-000000000001', 'structure not recovered';
  assert (select notes from public.tasks where id = 'e0000000-0000-0000-0000-000000000001') = 'years of work', 'edit not undone';
  assert (select count(*) from public.completions where id = 'e0000000-0000-0000-0000-0000000000c1') = 1, 'history not recovered';
  assert (select count(*) from public.categories where name = 'Home') = 1, 'category not recovered';
end $$;
\echo ALL RECOVERY CHECKS PASSED
