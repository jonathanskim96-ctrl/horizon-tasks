-- 0005: live sync between devices. Adds the app's tables to Supabase's
-- realtime publication. Realtime enforces the same RLS policies, so each
-- signed-in user only ever receives change events for their own rows, and
-- signed-out visitors (no table access at all) receive nothing.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks') then
    alter publication supabase_realtime add table public.tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'categories') then
    alter publication supabase_realtime add table public.categories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'completions') then
    alter publication supabase_realtime add table public.completions;
  end if;
end $$;
