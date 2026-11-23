-- One membership per person per task: opening another invite link for a task you already joined
-- keeps that link free for the next person.
create or replace function public.accept_share(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  s public.task_shares%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into s from public.task_shares where token = p_token;
  if not found or s.status = 'revoked' then
    raise exception 'This link is no longer valid.';
  end if;
  if exists (select 1 from public.tasks k where k.id = s.task_id and k.deleted_at is null and private.is_member(k.workspace_id)) then
    return s.task_id;
  end if;
  if not exists (select 1 from public.tasks k where k.id = s.task_id and k.deleted_at is null) then
    raise exception 'This task was deleted.';
  end if;
  if exists (select 1 from public.task_shares x where x.task_id = s.task_id and x.recipient_id = uid) then
    if exists (select 1 from public.task_shares x where x.task_id = s.task_id and x.recipient_id = uid and x.status = 'revoked') then
      raise exception 'The owner removed you from this task.';
    end if;
    update public.task_shares set status = 'accepted', responded_at = now()
      where task_id = s.task_id and recipient_id = uid and status <> 'accepted';
  elsif s.recipient_id is null then
    update public.task_shares set recipient_id = uid, status = 'accepted', responded_at = now() where id = s.id;
  else
    insert into public.task_shares (task_id, shared_by, recipient_id, status, responded_at)
    values (s.task_id, s.shared_by, uid, 'accepted', now());
  end if;
  return s.task_id;
end;
$$;

create or replace function public.task_people(p_task uuid)
returns table (user_id uuid, name text, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select k.created_by, coalesce(nullif(p.display_name, ''), 'Owner'), true
  from public.tasks k left join public.profiles p on p.id = k.created_by
  where k.id = p_task and private.can_see_task(p_task)
  union
  select distinct s.recipient_id, coalesce(nullif(p.display_name, ''), 'Guest'), false
  from public.task_shares s left join public.profiles p on p.id = s.recipient_id
  where s.task_id = p_task and s.recipient_id is not null and s.status in ('accepted', 'done') and private.can_see_task(p_task);
$$;
