-- TaskAI core schema: one row per thing, so a change moves one small row.
-- Every table has RLS. Helper checks live in the non-exposed "private" schema.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------- shared helpers ----------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  locale text not null default 'en' check (locale in ('en', 'he')),
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  accent text not null default 'plum' check (char_length(accent) <= 20),
  celebration text not null default 'stars' check (char_length(celebration) <= 20),
  remind_minutes smallint not null default 10 check (remind_minutes between 0 and 1440),
  time_zone text not null default 'Asia/Jerusalem' check (char_length(time_zone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- workspaces (personal now, teams later for B2B) ----------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'team' check (kind in ('personal', 'team')),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_owner_id_idx on public.workspaces (owner_id);
create unique index workspaces_one_personal_idx on public.workspaces (owner_id) where kind = 'personal';

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- ---------- folders / tasks / steps / notes / files ----------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  parent_id uuid references public.folders (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index folders_workspace_id_idx on public.folders (workspace_id);
create index folders_parent_id_idx on public.folders (parent_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  assignee_id uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 500),
  details text check (char_length(details) <= 10000),
  kind text not null default 'single' check (kind in ('single', 'checklist', 'stages')),
  status text not null default 'open' check (status in ('inbox', 'open', 'in_progress', 'done')),
  priority smallint not null default 0 check (priority between 0 and 3),
  due_at timestamptz,
  due_has_time boolean not null default false,
  snoozed_until timestamptz,
  remind_minutes smallint check (remind_minutes between 0 and 10080),
  source_kind text not null default 'manual'
    check (source_kind in ('manual', 'text', 'screenshot', 'photo', 'voice', 'document', 'chat')),
  source_text text check (char_length(source_text) <= 24000),
  needs_answer boolean not null default false,
  position double precision not null default 0,
  completed_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_workspace_updated_idx on public.tasks (workspace_id, updated_at);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_assignee_id_idx on public.tasks (assignee_id);

create table public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  done boolean not null default false,
  position double precision not null default 0,
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_steps_task_id_idx on public.task_steps (task_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 20000),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_workspace_updated_idx on public.notes (workspace_id, updated_at);
create index notes_created_by_idx on public.notes (created_by);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  uploaded_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  task_id uuid references public.tasks (id) on delete set null,
  note_id uuid references public.notes (id) on delete set null,
  storage_path text not null unique check (char_length(storage_path) <= 400),
  name text not null check (char_length(name) between 1 and 255),
  mime text check (char_length(mime) <= 120),
  size_bytes bigint check (size_bytes >= 0),
  summary text check (char_length(summary) <= 4000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index files_workspace_id_idx on public.files (workspace_id);
create index files_uploaded_by_idx on public.files (uploaded_by);
create index files_folder_id_idx on public.files (folder_id);
create index files_task_id_idx on public.files (task_id);
create index files_note_id_idx on public.files (note_id);

-- ---------- sharing and conversation ----------
create table public.task_shares (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  shared_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid references auth.users (id) on delete cascade,
  recipient_label text check (char_length(recipient_label) <= 120),
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'done', 'revoked')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_shares_task_id_idx on public.task_shares (task_id);
create index task_shares_shared_by_idx on public.task_shares (shared_by);
create index task_shares_recipient_id_idx on public.task_shares (recipient_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_task_id_idx on public.comments (task_id, created_at);
create index comments_author_id_idx on public.comments (author_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 24000),
  created_at timestamptz not null default now()
);
create index chat_messages_user_created_idx on public.chat_messages (user_id, created_at);
create index chat_messages_task_id_idx on public.chat_messages (task_id);

create table public.memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category text not null default 'other' check (category in ('person', 'about_me', 'preference', 'other')),
  subject text check (char_length(subject) <= 120),
  fact text not null check (char_length(fact) between 1 and 2000),
  source text check (char_length(source) <= 400),
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memory_facts_user_id_idx on public.memory_facts (user_id);

-- AI provider + encrypted key. No client access at all: only server code
-- (Edge Functions with the service role) reads or writes this table.
create table public.ai_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('openai', 'gemini', 'claude')),
  model text check (char_length(model) <= 80),
  key_ciphertext text,
  transcribe_provider text check (transcribe_provider in ('openai', 'gemini')),
  transcribe_key_ciphertext text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on public.ai_settings from anon, authenticated;

-- ---------- updated_at triggers ----------
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces for each row execute function private.set_updated_at();
create trigger folders_updated_at before update on public.folders for each row execute function private.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function private.set_updated_at();
create trigger task_steps_updated_at before update on public.task_steps for each row execute function private.set_updated_at();
create trigger notes_updated_at before update on public.notes for each row execute function private.set_updated_at();
create trigger files_updated_at before update on public.files for each row execute function private.set_updated_at();
create trigger task_shares_updated_at before update on public.task_shares for each row execute function private.set_updated_at();
create trigger comments_updated_at before update on public.comments for each row execute function private.set_updated_at();
create trigger memory_facts_updated_at before update on public.memory_facts for each row execute function private.set_updated_at();
create trigger ai_settings_updated_at before update on public.ai_settings for each row execute function private.set_updated_at();

-- ---------- access helpers (security definer, always scoped to auth.uid()) ----------
create or replace function private.is_member(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = (select auth.uid()));
$$;

create or replace function private.can_write(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = (select auth.uid())
                   and m.role in ('owner', 'admin', 'member'));
$$;

create or replace function private.is_admin(ws uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m
                 where m.workspace_id = ws and m.user_id = (select auth.uid())
                   and m.role in ('owner', 'admin'));
$$;

create or replace function private.shared_with_me(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_shares s
                 where s.task_id = t and s.recipient_id = (select auth.uid())
                   and s.status <> 'revoked');
$$;

create or replace function private.can_see_task(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks k where k.id = t and private.is_member(k.workspace_id))
      or private.shared_with_me(t);
$$;

create or replace function private.can_write_task(t uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks k where k.id = t and private.can_write(k.workspace_id));
$$;


-- ---------- new user: profile + personal workspace ----------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)));
  insert into public.workspaces (name, kind, owner_id) values ('Personal', 'personal', new.id) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, new.id, 'owner');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- new team workspace: creator becomes owner member
create or replace function private.handle_new_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'team' then
    insert into public.workspace_members (workspace_id, user_id, role)
    values (new.id, new.owner_id, 'owner') on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_workspace_created after insert on public.workspaces
  for each row execute function private.handle_new_workspace();

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.folders enable row level security;
alter table public.tasks enable row level security;
alter table public.task_steps enable row level security;
alter table public.notes enable row level security;
alter table public.files enable row level security;
alter table public.task_shares enable row level security;
alter table public.comments enable row level security;
alter table public.chat_messages enable row level security;
alter table public.memory_facts enable row level security;
alter table public.ai_settings enable row level security;

-- profiles: own row
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- workspaces
create policy workspaces_select on public.workspaces for select to authenticated
  using ((select private.is_member(id)) or owner_id = (select auth.uid()));
create policy workspaces_insert on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()) and kind = 'team');
create policy workspaces_update on public.workspaces for update to authenticated
  using ((select private.is_admin(id))) with check ((select private.is_admin(id)));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (owner_id = (select auth.uid()) and kind = 'team');

-- workspace members
create policy members_select on public.workspace_members for select to authenticated
  using ((select private.is_member(workspace_id)));
create policy members_insert on public.workspace_members for insert to authenticated
  with check ((select private.is_admin(workspace_id)) and role <> 'owner');
create policy members_update on public.workspace_members for update to authenticated
  using ((select private.is_admin(workspace_id)) and role <> 'owner')
  with check ((select private.is_admin(workspace_id)) and role <> 'owner');
create policy members_delete on public.workspace_members for delete to authenticated
  using (role <> 'owner' and ((select private.is_admin(workspace_id)) or user_id = (select auth.uid())));

-- folders, notes, files: workspace members read, writers write
create policy folders_select on public.folders for select to authenticated using ((select private.is_member(workspace_id)));
create policy folders_insert on public.folders for insert to authenticated with check ((select private.can_write(workspace_id)));
create policy folders_update on public.folders for update to authenticated
  using ((select private.can_write(workspace_id))) with check ((select private.can_write(workspace_id)));
create policy folders_delete on public.folders for delete to authenticated using ((select private.can_write(workspace_id)));

create policy notes_select on public.notes for select to authenticated using ((select private.is_member(workspace_id)));
create policy notes_insert on public.notes for insert to authenticated
  with check ((select private.can_write(workspace_id)) and created_by = (select auth.uid()));
create policy notes_update on public.notes for update to authenticated
  using ((select private.can_write(workspace_id))) with check ((select private.can_write(workspace_id)));
create policy notes_delete on public.notes for delete to authenticated using ((select private.can_write(workspace_id)));

create policy files_select on public.files for select to authenticated using ((select private.is_member(workspace_id)));
create policy files_insert on public.files for insert to authenticated
  with check ((select private.can_write(workspace_id)) and uploaded_by = (select auth.uid()));
create policy files_update on public.files for update to authenticated
  using ((select private.can_write(workspace_id))) with check ((select private.can_write(workspace_id)));
create policy files_delete on public.files for delete to authenticated using ((select private.can_write(workspace_id)));

-- tasks: members see; people it was shared with see; writers change
create policy tasks_select on public.tasks for select to authenticated
  using ((select private.is_member(workspace_id)) or (select private.shared_with_me(id)));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select private.can_write(workspace_id)) and created_by = (select auth.uid()));
create policy tasks_update on public.tasks for update to authenticated
  using ((select private.can_write(workspace_id))) with check ((select private.can_write(workspace_id)));
create policy tasks_delete on public.tasks for delete to authenticated using ((select private.can_write(workspace_id)));

-- steps follow their task
create policy steps_select on public.task_steps for select to authenticated using ((select private.can_see_task(task_id)));
create policy steps_insert on public.task_steps for insert to authenticated with check ((select private.can_write_task(task_id)));
create policy steps_update on public.task_steps for update to authenticated
  using ((select private.can_write_task(task_id))) with check ((select private.can_write_task(task_id)));
create policy steps_delete on public.task_steps for delete to authenticated using ((select private.can_write_task(task_id)));

-- shares: sender and receiver see; sender creates and removes; both may update status
create policy shares_select on public.task_shares for select to authenticated
  using (shared_by = (select auth.uid()) or recipient_id = (select auth.uid()) or (select private.can_write_task(task_id)));
create policy shares_insert on public.task_shares for insert to authenticated
  with check (shared_by = (select auth.uid()) and (select private.can_write_task(task_id)));
create policy shares_update on public.task_shares for update to authenticated
  using (shared_by = (select auth.uid()) or recipient_id = (select auth.uid()))
  with check (shared_by = (select auth.uid()) or recipient_id = (select auth.uid()));
create policy shares_delete on public.task_shares for delete to authenticated using (shared_by = (select auth.uid()));

-- comments: anyone who can see the task talks on it; authors edit their own
create policy comments_select on public.comments for select to authenticated using ((select private.can_see_task(task_id)));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and (select private.can_see_task(task_id)));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated using (author_id = (select auth.uid()));

-- AI chat and memory: private to each user
create policy chat_select on public.chat_messages for select to authenticated using (user_id = (select auth.uid()));
create policy chat_insert on public.chat_messages for insert to authenticated with check (user_id = (select auth.uid()));
create policy chat_delete on public.chat_messages for delete to authenticated using (user_id = (select auth.uid()));

create policy memory_select on public.memory_facts for select to authenticated using (user_id = (select auth.uid()));
create policy memory_insert on public.memory_facts for insert to authenticated with check (user_id = (select auth.uid()));
create policy memory_update on public.memory_facts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy memory_delete on public.memory_facts for delete to authenticated using (user_id = (select auth.uid()));
-- ai_settings: RLS on, no policies = no client access.

-- ---------- realtime: only changed rows are sent ----------
alter publication supabase_realtime add table public.tasks, public.task_steps, public.notes, public.comments, public.task_shares;

-- ---------- storage: private bucket, path = <workspace_id>/<file id> ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 20971520)
on conflict (id) do nothing;

create policy files_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'files' and (select private.is_member(((storage.foldername(name))[1])::uuid)));
create policy files_bucket_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (select private.can_write(((storage.foldername(name))[1])::uuid)));
create policy files_bucket_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (select private.can_write(((storage.foldername(name))[1])::uuid)));
