-- Notes live in the tasks table as kind = 'note', so they share categories, reminders,
-- files, updates, archive and delete with tasks (one row each, no extra table to sync).
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('single', 'checklist', 'stages', 'note'));

-- What the assistant knows about the user: keep the newest facts first.
create index if not exists memory_facts_user_updated_idx on public.memory_facts (user_id, updated_at desc);
drop trigger if exists memory_facts_updated_at on public.memory_facts;
create trigger memory_facts_updated_at before update on public.memory_facts
  for each row execute function private.set_updated_at();
