-- Behavioural checks for 0001_init.sql. Run via run.sh; any failure aborts.
\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

select public.seed_starter_categories('[{"name":"A","color":"#112233"},{"name":"B","color":"#445566"}]') as first_seed;
do $$ begin
  assert (select count(*) from public.categories) = 2, 'seeded 2';
  assert public.seed_starter_categories('[{"name":"A","color":"#112233"}]') = false, 'seed only once';
  assert (select count(*) from public.categories) = 2, 'no reseed';
end $$;

-- insert parent + child atomically, integer priority enforced
select public.apply_changes(inserts => jsonb_build_array(
  jsonb_build_object('id','10000000-0000-0000-0000-000000000001','title','Parent','priority',3,
    'category_id',(select id from public.categories where name='A'),'due_date','2026-10-10'),
  jsonb_build_object('id','10000000-0000-0000-0000-000000000002','title','Child','priority',2,'depth',1,
    'parent_id','10000000-0000-0000-0000-000000000001',
    'category_id',(select id from public.categories where name='A'),'due_date','2026-10-08')));

do $$ begin
  assert (select count(*) from public.tasks) = 2, 'two tasks';
  begin
    perform public.apply_changes(inserts => jsonb_build_array(jsonb_build_object('title','Bad','priority',3.7,
      'category_id',(select id from public.categories where name='A'),'due_date','2026-10-10')));
    raise exception 'should have rejected 3.7';
  exception when raise_exception then
    if sqlerrm like 'should have%' then raise; end if;
  end;
  begin
    insert into public.tasks (title, priority, category_id) values ('No due', 3, (select id from public.categories where name='A'));
    raise exception 'should require due date';
  exception when check_violation then null;
  end;
end $$;

-- complete parent: history + delete cascades to child, atomically
select public.apply_changes(
  completions => jsonb_build_array(jsonb_build_object('task_id','10000000-0000-0000-0000-000000000001','outcome','completed','snapshot','{"title":"Parent"}'::jsonb)),
  deletes => '["10000000-0000-0000-0000-000000000001"]');
do $$ begin
  assert (select count(*) from public.tasks) = 0, 'cascade delete';
  assert (select count(*) from public.completions) = 1, 'history written';
end $$;

-- failed batch rolls back entirely
do $$ begin
  begin
    perform public.apply_changes(
      completions => jsonb_build_array(jsonb_build_object('task_id',gen_random_uuid(),'outcome','completed','snapshot','{}'::jsonb)),
      updates => jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','x','priority',1,'category_id',gen_random_uuid())));
  exception when others then null;
  end;
  assert (select count(*) from public.completions) = 1, 'rolled back';
end $$;

-- user B sees nothing of A's
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  assert (select count(*) from public.categories) = 0, 'RLS categories';
  assert (select count(*) from public.completions) = 0, 'RLS completions';
end $$;
-- B cannot attach a task to A's category
do $$ begin
  begin
    insert into public.tasks (title, priority, category_id, due_date)
      values ('x', 1, (select id from public.categories limit 1), '2026-01-01');
  exception when others then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.tasks) = 0, 'cross-user insert blocked';
end $$;
\echo ALL SQL CHECKS PASSED
