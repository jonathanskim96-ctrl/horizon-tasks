-- Adversarial checks: user B (and anon) actively trying to read, change or
-- break user A's data, plus malformed/injection payloads. Runs after rls_test.sql.
\set ON_ERROR_STOP on

-- Helper: the statement must fail (any error). Runs with the caller's role.
create function pg_temp.must_fail(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;
  end;
  raise exception 'ATTACK SUCCEEDED: %', label;
end $$;

-- A's real category id, captured as superuser so B's attacks can target it.
select id as a_cat from public.categories where name = 'A' \gset

-- A creates a secret task and a history entry.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.apply_changes(inserts => jsonb_build_array(jsonb_build_object(
  'id','a0000000-0000-0000-0000-000000000001','title','A secret','notes','private','priority',3,
  'category_id',(select id from public.categories where name='A'),'due_date','2026-10-10')));
select public.apply_changes(completions => jsonb_build_array(jsonb_build_object(
  'id','a0000000-0000-0000-0000-0000000000c1','task_id','a0000000-0000-0000-0000-000000000009',
  'outcome','completed','snapshot','{"title":"A done"}'::jsonb)));

-- ── B attacks A ─────────────────────────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.seed_starter_categories('[{"name":"B","color":"#123456"}]');

do $$ begin
  assert (select count(*) from public.tasks) = 0, 'B can read A tasks';
  assert (select count(*) from public.completions) = 0, 'B can read A history';
  assert (select count(*) from public.profiles) = 1, 'B sees only own profile';
end $$;

select pg_temp.must_fail($s$ select public.apply_changes(updates => '[{"id":"a0000000-0000-0000-0000-000000000001","title":"pwned","priority":1,"category_id":"00000000-0000-0000-0000-000000000000"}]') $s$, 'B updates A task via RPC');
select pg_temp.must_fail($s$ insert into public.tasks (user_id, title, priority, category_id, due_date) values ('00000000-0000-0000-0000-00000000000a','x',1,(select id from public.categories limit 1),'2026-01-01') $s$, 'B inserts task as A');
select pg_temp.must_fail($s$ insert into public.completions (user_id, task_id, outcome, snapshot) values ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'completed', '{}') $s$, 'B inserts history as A');
select pg_temp.must_fail($s$ insert into public.categories (user_id, name, color) values ('00000000-0000-0000-0000-00000000000a','evil','#000000') $s$, 'B inserts category as A');

-- Silent no-ops must really be no-ops (checked as A below).
select public.apply_changes(deletes => '["a0000000-0000-0000-0000-000000000001"]', history_deletes => '["a0000000-0000-0000-0000-0000000000c1"]');
update public.tasks set title = 'pwned' where id = 'a0000000-0000-0000-0000-000000000001';
delete from public.tasks where id = 'a0000000-0000-0000-0000-000000000001';
delete from public.completions where id = 'a0000000-0000-0000-0000-0000000000c1';
update public.profiles set starter_seeded_at = null where user_id = '00000000-0000-0000-0000-00000000000a';

-- B attaches its own subtask under A's task / uses A's category.
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"depth":1,"parent_id":"a0000000-0000-0000-0000-000000000001","category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'B nests under A task');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"category_id":"%s","due_date":"2026-01-01"}]') $s$, :'a_cat'), 'B uses A category');
select pg_temp.must_fail(format($s$ insert into public.tasks (title, priority, category_id, due_date) values ('x', 1, '%s', '2026-01-01') $s$, :'a_cat'), 'B uses A category directly');
delete from public.categories where id = :'a_cat';  -- must be a silent no-op (checked as A)

-- ── malformed / injection payloads (as B, on B's own data) ──
select pg_temp.must_fail($s$ select public.apply_changes(inserts => '[{"title":"x","priority":"5","category_id":"x"}]') $s$, 'priority as string');
select pg_temp.must_fail($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1e10}]') $s$, 'priority overflow');
select pg_temp.must_fail($s$ select public.apply_changes(inserts => '[{"title":"x","priority":true}]') $s$, 'priority boolean');
select pg_temp.must_fail(format($s$ insert into public.tasks select * from json_populate_record(null::public.tasks, '{"title":"x","priority":3.7,"category_id":"%s","due_date":"2026-01-01"}') $s$, (select id from public.categories where name='B')), 'PostgREST-style 3.7 insert');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"depth":-1,"category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'negative depth');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"recurrence_every_n_days":0,"category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'zero interval');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"   ","priority":1,"category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'blank title');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"checklist":["just a string"],"category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'checklist non-object');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"checklist":[{"text":{"nested":1},"done":false}],"category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'checklist text object');
select pg_temp.must_fail(format($s$ select public.apply_changes(inserts => '[{"title":"x","priority":1,"checklist":{"a":1},"category_id":"%s","due_date":"2026-01-01"}]') $s$, (select id from public.categories where name='B')), 'checklist not array');
select pg_temp.must_fail($s$ select public.apply_changes(completions => '[{"task_id":"a0000000-0000-0000-0000-000000000001","outcome":"deleted","snapshot":{}}]') $s$, 'bad outcome');
select pg_temp.must_fail($s$ select public.apply_changes(completions => '[{"task_id":"a0000000-0000-0000-0000-000000000001","outcome":"completed","snapshot":"str"}]') $s$, 'snapshot not object');
select pg_temp.must_fail($s$ select public.apply_changes(deletes => (select jsonb_agg(gen_random_uuid()) from generate_series(1,1001))) $s$, 'huge batch');
select pg_temp.must_fail($s$ select public.apply_changes(deletes => '{"not":"array"}') $s$, 'non-array arg');
select pg_temp.must_fail($s$ insert into public.categories (name, color) values ('x','red;background:url(javascript:alert(1))') $s$, 'CSS injection color');
select pg_temp.must_fail($s$ update public.completions set outcome = 'skipped' $s$, 'history update');

-- SQL injection text is stored literally and harms nothing.
select public.apply_changes(inserts => jsonb_build_array(jsonb_build_object('title', $t$'); drop table public.tasks; --$t$,
  'priority',1,'category_id',(select id from public.categories where name='B'),'due_date','2026-01-01')));
do $$ begin
  assert (select title from public.tasks limit 1) = $t$'); drop table public.tasks; --$t$, 'injection text altered';
end $$;

do $$ begin assert (select count(*) from public.tasks) = 1, 'B should own one task here'; end $$;
select pg_temp.must_fail($s$ update public.tasks set user_id = '00000000-0000-0000-0000-00000000000a' $s$, 'B gives own task to A');

-- No JWT subject at all (e.g. forged role without identity).
reset request.jwt.claim.sub;
select pg_temp.must_fail($s$ select public.apply_changes() $s$, 'no identity RPC');
select pg_temp.must_fail($s$ select public.seed_starter_categories('[]') $s$, 'no identity seed');

-- Anonymous visitor: nothing at all.
reset role;
set role anon;
select pg_temp.must_fail($s$ select count(*) from public.categories $s$, 'anon reads categories');
select pg_temp.must_fail($s$ select count(*) from public.completions $s$, 'anon reads history');
select pg_temp.must_fail($s$ select count(*) from public.profiles $s$, 'anon reads profiles');
select pg_temp.must_fail($s$ insert into public.tasks (title) values ('x') $s$, 'anon inserts');
select pg_temp.must_fail($s$ select public.is_valid_checklist('[]') $s$, 'anon calls helper');

-- ── A's data survived every attack ──────────────────────────
reset role;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$ begin
  assert (select title from public.tasks where id = 'a0000000-0000-0000-0000-000000000001') = 'A secret', 'A task changed or deleted';
  assert (select count(*) from public.completions where id = 'a0000000-0000-0000-0000-0000000000c1') = 1, 'A history deleted';
  assert (select starter_seeded_at from public.profiles) is not null, 'A profile changed';
  assert (select count(*) from public.categories where name = 'evil') = 0, 'category planted in A';
  assert (select count(*) from public.categories where name = 'A') = 1, 'A category deleted by B';
end $$;
reset role;
\echo ALL ATTACK CHECKS PASSED
