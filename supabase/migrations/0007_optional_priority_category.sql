-- 0007: priority and category become optional (owner decision 2026-10-05:
-- Quick Add / the task form may leave them blank to fill in later).
-- Relaxes two NOT NULL rules only. No row is deleted or changed. The value
-- rules still apply whenever a value is present: priority must be an integer
-- 1–5 (check constraint kept), and category_id must be one of the user's own
-- categories (foreign key + ownership trigger below).
alter table public.tasks alter column priority drop not null; -- guardrail-approved: owner approved 2026-10-05 in chat (optional priority for Quick Add); relaxes NOT NULL, no data changed
alter table public.tasks alter column category_id drop not null; -- guardrail-approved: owner approved 2026-10-05 in chat (optional category for Quick Add); relaxes NOT NULL, no data changed

-- The ownership trigger now allows "no category"; a given category must still
-- belong to the same user. (Parent check unchanged.)
create or replace function public.tasks_check_ownership() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'category % not found', new.category_id;
  end if;
  if new.parent_id is not null and not exists (
    select 1 from public.tasks p where p.id = new.parent_id and p.user_id = new.user_id and p.depth = new.depth - 1
  ) then
    raise exception 'parent % not found or depth mismatch', new.parent_id;
  end if;
  return new;
end $$;
revoke execute on function public.tasks_check_ownership() from public, anon;
grant execute on function public.tasks_check_ownership() to authenticated;
