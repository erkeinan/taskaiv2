-- Spanish interface
alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('en', 'he', 'es'));

-- ---------- shared tasks: people who opened the link can work on the task ----------
create or replace function private.shared_with_me(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_shares s
                 where s.task_id = t and s.recipient_id = (select auth.uid())
                   and s.status in ('accepted', 'done'));
$$;

create or replace function private.can_write_task(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks k where k.id = t and private.can_write(k.workspace_id))
      or private.shared_with_me(t);
$$;

-- a workspace folder in storage that holds a task shared with me
create or replace function private.has_shared_task_in(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks k
                 join public.task_shares s on s.task_id = k.id
                 where k.workspace_id = ws and s.recipient_id = (select auth.uid()) and s.status in ('accepted', 'done'));
$$;

create or replace function private.can_read_file(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.files f
                 where f.storage_path = path and f.task_id is not null and private.shared_with_me(f.task_id));
$$;

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using ((select private.can_write(workspace_id)) or (select private.shared_with_me(id)))
  with check ((select private.can_write(workspace_id)) or (select private.shared_with_me(id)));

-- People a task is shared with can change its content, not who owns it or whether it is archived or deleted.
create or replace function private.guard_shared_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.can_write(old.workspace_id) then
    if new.workspace_id is distinct from old.workspace_id
       or new.created_by is distinct from old.created_by
       or new.archived_at is distinct from old.archived_at
       or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Only the owner of this task can do that.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tasks_guard_shared on public.tasks;
create trigger tasks_guard_shared before update on public.tasks
  for each row execute function private.guard_shared_task();

drop policy if exists files_select on public.files;
create policy files_select on public.files for select to authenticated
  using ((select private.is_member(workspace_id)) or (task_id is not null and (select private.shared_with_me(task_id))));
drop policy if exists files_insert on public.files;
create policy files_insert on public.files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and ((select private.can_write(workspace_id))
         or (task_id is not null and (select private.shared_with_me(task_id))
             and exists (select 1 from public.tasks k where k.id = task_id and k.workspace_id = files.workspace_id)))
  );

drop policy if exists files_bucket_select on storage.objects;
create policy files_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and ((select private.is_member(((storage.foldername(name))[1])::uuid)) or (select private.can_read_file(name))));
drop policy if exists files_bucket_insert on storage.objects;
create policy files_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and ((select private.can_write(((storage.foldername(name))[1])::uuid))
                                      or (select private.has_shared_task_in(((storage.foldername(name))[1])::uuid))));

-- ---------- invite links ----------
-- What the invite page shows before signing in: only the task title and who sent it.
create or replace function public.share_preview(p_token text)
returns table (title text, shared_by_name text)
language sql stable security definer set search_path = '' as $$
  select k.title, coalesce(nullif(p.display_name, ''), 'Someone')
  from public.task_shares s
  join public.tasks k on k.id = s.task_id
  left join public.profiles p on p.id = s.shared_by
  where s.token = p_token and s.status <> 'revoked' and k.deleted_at is null
  limit 1;
$$;

-- Opening an invite link after signing in. The same link can be used by several people.
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
    return s.task_id; -- the owner opened their own link
  end if;
  if not exists (select 1 from public.tasks k where k.id = s.task_id and k.deleted_at is null) then
    raise exception 'This task was deleted.';
  end if;
  if s.recipient_id is null then
    update public.task_shares set recipient_id = uid, status = 'accepted', responded_at = now() where id = s.id;
  elsif s.recipient_id = uid then
    update public.task_shares set status = 'accepted', responded_at = now() where id = s.id and status <> 'accepted';
  elsif exists (select 1 from public.task_shares x where x.task_id = s.task_id and x.recipient_id = uid) then
    update public.task_shares set status = 'accepted', responded_at = now()
      where task_id = s.task_id and recipient_id = uid and status <> 'revoked';
  else
    insert into public.task_shares (task_id, shared_by, recipient_id, status, responded_at)
    values (s.task_id, s.shared_by, uid, 'accepted', now());
  end if;
  return s.task_id;
end;
$$;

-- Names of everyone on a task (owner and the people it is shared with), for "who updated".
create or replace function public.task_people(p_task uuid)
returns table (user_id uuid, name text, is_owner boolean)
language sql stable security definer set search_path = '' as $$
  select k.created_by, coalesce(nullif(p.display_name, ''), 'Owner'), true
  from public.tasks k left join public.profiles p on p.id = k.created_by
  where k.id = p_task and private.can_see_task(p_task)
  union all
  select s.recipient_id, coalesce(nullif(p.display_name, ''), 'Guest'), false
  from public.task_shares s left join public.profiles p on p.id = s.recipient_id
  where s.task_id = p_task and s.recipient_id is not null and s.status in ('accepted', 'done') and private.can_see_task(p_task);
$$;

revoke execute on function public.share_preview(text), public.accept_share(text), public.task_people(uuid) from public;
grant execute on function public.share_preview(text) to anon, authenticated;
grant execute on function public.accept_share(text), public.task_people(uuid) to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;


-- editing a message already sent to the assistant
drop policy if exists chat_update on public.chat_messages;
create policy chat_update on public.chat_messages for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
