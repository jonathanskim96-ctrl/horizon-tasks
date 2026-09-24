-- Horizon Tasks schema v1.
-- Rules: migrations are additive and versioned (0002_..., 0003_...). Never edit
-- a migration that has already been applied; write a new one.
-- Dates: due dates are `date` (local-day semantics); timestamps are timestamptz (UTC).

-- ───────────────────────── categories ─────────────────────────
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) > 0),
  color       text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);
create index categories_user_idx on public.categories (user_id);

-- ───────────────────────── tasks (active only) ─────────────────────────
-- Completed/skipped tasks are removed from this table and snapshotted into
-- `completions`. Tiers (Daily/Weekly/…) are computed from these fields.
create table public.tasks (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                   text not null check (length(btrim(title)) > 0),
  notes                   text not null default '',
  priority                smallint not null check (priority between 1 and 5),
  category_id             uuid not null references public.categories (id) on delete restrict,
  ongoing                 boolean not null default false,
  due_date                date,
  checklist               jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  -- Deleting a parent cascades to its *active* descendants only; history is separate.
  parent_id               uuid references public.tasks (id) on delete cascade,
  depth                   smallint not null default 0 check (depth between 0 and 4),
  recurrence_every_n_days integer check (recurrence_every_n_days > 0),
  recurrence_end_date     date,
  created_at              timestamptz not null default now(),
  constraint due_date_required_unless_ongoing check (ongoing or due_date is not null),
  constraint recurrence_needs_interval check (recurrence_end_date is null or recurrence_every_n_days is not null),
  constraint recurrence_needs_due_date check (recurrence_every_n_days is null or due_date is not null),
  constraint parent_depth_consistent check ((parent_id is null) = (depth = 0))
);
create index tasks_user_idx on public.tasks (user_id);
create index tasks_parent_idx on public.tasks (parent_id);
create index tasks_due_idx on public.tasks (user_id, due_date);

-- ───────────────────────── completions (history) ─────────────────────────
-- Append-only log. `snapshot` holds the full task as it was (title, category
-- name/color, priority, parent info, due date, checklist, recurrence…).
create table public.completions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id       uuid not null,               -- original task id; no FK (task is gone)
  parent_id     uuid,                        -- original parent id, for restore-reattach
  outcome       text not null check (outcome in ('completed', 'skipped')),
  due_date      date,
  completed_at  timestamptz not null default now(),
  snapshot      jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at    timestamptz not null default now()
);
create index completions_user_idx on public.completions (user_id, completed_at desc);

-- ───────────────────────── profile (one row per user) ─────────────────────────
create table public.profiles (
  user_id             uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  starter_seeded_at   timestamptz,
  created_at          timestamptz not null default now()
);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.categories  enable row level security;
alter table public.tasks       enable row level security;
alter table public.completions enable row level security;
alter table public.profiles    enable row level security;

create policy "own categories"  on public.categories  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own tasks"       on public.tasks       for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own profile"     on public.profiles    for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- History is append-only: select/insert/delete, no update.
create policy "read own completions"   on public.completions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "insert own completions" on public.completions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "delete own completions" on public.completions for delete to authenticated
  using (user_id = (select auth.uid()));

-- A task's category and parent must belong to the same user.
create or replace function public.tasks_check_ownership() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.categories c where c.id = new.category_id and c.user_id = new.user_id) then
    raise exception 'category % not found', new.category_id;
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.tasks p where p.id = new.parent_id and p.user_id = new.user_id and p.depth = new.depth - 1
  ) then
    raise exception 'parent % not found or depth mismatch', new.parent_id;
  end if;
  return new;
end $$;
create trigger tasks_check_ownership before insert or update on public.tasks
  for each row execute function public.tasks_check_ownership();

-- ───────────────────────── RPCs ─────────────────────────

-- Seeds the starter categories exactly once per user (tracked in profiles),
-- so deleting them later never resurrects them.
create or replace function public.seed_starter_categories(starter jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into public.profiles (user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid and starter_seeded_at is null for update;
  if not found then return false; end if;
  insert into public.categories (name, color, sort_order)
    select s->>'name', s->>'color', (ord - 1)::int
    from jsonb_array_elements(starter) with ordinality as t(s, ord);
  update public.profiles set starter_seeded_at = now() where user_id = uid;
  return true;
end $$;

-- Applies a batch of changes atomically (one transaction): used for complete,
-- skip, recurrence clone, cascade delete and restore, so a failure midway can
-- never leave a task both in history and active, or lose it entirely.
-- The client computes the plan (pure, tested TS); the DB guarantees all-or-nothing.
--   inserts:      array of task rows (parents before children)
--   updates:      array of task rows with id (full replacement of editable fields)
--   deletes:      array of task ids
--   completions:  array of completion rows
--   history_deletes: array of completion ids (permanent)
create or replace function public.apply_changes(
  inserts jsonb default '[]', updates jsonb default '[]', deletes jsonb default '[]',
  completions jsonb default '[]', history_deletes jsonb default '[]'
) returns void
language plpgsql security invoker set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

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

-- JSON number → integer, rejecting non-integers (e.g. 3.7) instead of rounding.
create or replace function public.strict_int(v jsonb) returns integer
language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric) then
    raise exception 'expected an integer, got %', v;
  end if;
  return (v::text)::integer;
end $$;
