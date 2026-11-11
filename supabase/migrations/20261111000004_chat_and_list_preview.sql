-- AI chat: keep the assistant's question/options and the actions it saved with each message.
alter table public.chat_messages
  add column meta jsonb check (meta is null or (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 20000));

-- List rows show progress and a one-line preview without loading steps or long text.
alter table public.tasks
  add column steps_total smallint not null default 0,
  add column steps_done smallint not null default 0,
  add column preview text generated always as (left(regexp_replace(coalesce(details, ''), '\s+', ' ', 'g'), 120)) stored;

create or replace function private.refresh_step_counts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t uuid := coalesce(new.task_id, old.task_id);
begin
  update public.tasks k set
    steps_total = (select count(*) from public.task_steps s where s.task_id = t and s.deleted_at is null),
    steps_done = (select count(*) from public.task_steps s where s.task_id = t and s.deleted_at is null and s.done)
  where k.id = t;
  return null;
end $$;

create trigger task_steps_counts after insert or update or delete on public.task_steps
  for each row execute function private.refresh_step_counts();

update public.tasks k set
  steps_total = (select count(*) from public.task_steps s where s.task_id = k.id and s.deleted_at is null),
  steps_done = (select count(*) from public.task_steps s where s.task_id = k.id and s.deleted_at is null and s.done);

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
