# Recovering deleted or overwritten data

Every time a task, history entry or category is **deleted or changed** — by the
app, by a bug, or by anyone — the database first copies the old row into the
`safety_log` table (migration 0006). The app can add to that log but can never
edit or erase it, so nothing is truly lost.

Two layers of backup:

1. **Safety log** (automatic, in Supabase): recovers anything deleted or
   overwritten after migration 0006 was applied.
2. **Your exports** (manual): History → **Export JSON** saves a full copy to
   your device; History → **Import** brings it back (existing items are skipped,
   so it's safe to import over live data). Export before any database update
   and every so often.

## See what was deleted recently

Supabase → SQL Editor → run (read-only):

```sql
select at, table_name, op, old_row->>'title' as title, old_row->>'name' as category
from public.safety_log
order by at desc
limit 100;
```

## Bring everything back from a time window

1. Open the script:
   `https://raw.githubusercontent.com/jonathanskim96-ctrl/horizon-tasks/main/supabase/recovery/restore_deleted.sql`
   and copy all of it.
2. Supabase → **SQL Editor** → new query → paste.
3. Edit the two lines marked `EDIT`: your sign-in email, and how far back the
   damage goes (e.g. `'1 day'`, `'3 days'`).
4. **Run**. The message at the bottom says how many categories, tasks and
   history entries came back.

It only **adds back** rows that are missing — it never deletes or overwrites
anything — so it's safe to run more than once. It restores parents before
subtasks, skips tasks you *completed* (they're in History), and touches only
your account. This exact script is exercised by `supabase/tests/recovery_test.sql`
on every change.

## Undo an edit

The log keeps each row's value **before** every change. To see a task's past
versions:

```sql
select at, old_row from public.safety_log
where table_name = 'tasks' and old_row->>'title' ilike '%part of the title%'
order by at desc;
```

Ask Claude to write the exact `update` for the version you want back — and
review it before running.
