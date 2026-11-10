-- Task page: category, assignee, repeat schedule, updates log, automatic next occurrence.

alter table public.tasks
  add column category text check (char_length(category) <= 100),
  add column assignee_name text check (char_length(assignee_name) <= 100),
  add column recurrence jsonb check (recurrence is null or jsonb_typeof(recurrence) = 'object'),
  add column series_id uuid,
  add column occurrence_of uuid references public.tasks (id) on delete set null,
  add column next_occurrence_id uuid references public.tasks (id) on delete set null;
create index tasks_series_id_idx on public.tasks (series_id);
create index tasks_occurrence_of_idx on public.tasks (occurrence_of);
create index tasks_next_occurrence_id_idx on public.tasks (next_occurrence_id);

-- comments double as the task's updates log: 'update' = written by a person, 'event' = automatic.
alter table public.comments
  add column kind text not null default 'update' check (kind in ('update', 'event'));

-- Next date for a repeat rule {frequency: daily|weekly|monthly|yearly, interval, weekday?, anchorDay?}.
create or replace function private.next_recurring_date(base date, rule jsonb, today date)
returns date language plpgsql immutable set search_path = '' as $$
declare
  freq text := rule ->> 'frequency';
  iv int := greatest(1, least(365, coalesce((rule ->> 'interval')::int, 1)));
  wd int := (rule ->> 'weekday')::int;
  anchor int := coalesce((rule ->> 'anchorDay')::int, extract(day from base)::int);
  n int := 1;
  d date;
  last_day int;
begin
  if freq is null or freq not in ('daily', 'weekly', 'monthly', 'yearly') then
    return null;
  end if;
  loop
    if freq = 'daily' then
      d := base + n * iv;
    elsif freq = 'weekly' then
      d := base + n * iv * 7;
      if wd is not null then
        d := d + (wd - extract(dow from d)::int);
      end if;
    else
      d := (date_trunc('month', base) + make_interval(months => case when freq = 'monthly' then n * iv else n * iv * 12 end))::date;
      last_day := extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int;
      d := d + (least(anchor, last_day) - 1);
    end if;
    if d > base and d > today then
      return d;
    end if;
    n := n + 1;
    if n > 5000 then
      return null;
    end if;
  end loop;
end $$;

-- When a repeating task is marked done, create its next occurrence (once).
create or replace function private.handle_task_done()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  tz text;
  base_local timestamp;
  today date;
  nd date;
  new_due timestamptz;
  nid uuid := gen_random_uuid();
begin
  if new.status = 'done' and old.status is distinct from 'done'
     and new.recurrence is not null and new.next_occurrence_id is null and new.deleted_at is null then
    select p.time_zone into tz from public.profiles p where p.id = new.created_by;
    tz := coalesce(tz, 'UTC');
    base_local := coalesce(new.due_at, now()) at time zone tz;
    today := (now() at time zone tz)::date;
    nd := private.next_recurring_date(base_local::date, new.recurrence, today);
    if nd is null then
      return new;
    end if;
    new_due := case
      when new.due_at is null then (nd + time '09:00') at time zone tz
      else (nd + base_local::time) at time zone tz
    end;

    insert into public.tasks (id, workspace_id, created_by, assignee_id, assignee_name, title, details, kind, status,
                              priority, due_at, due_has_time, remind_minutes, source_kind, source_text, category,
                              recurrence, series_id, occurrence_of, position)
    values (nid, new.workspace_id, new.created_by, new.assignee_id, new.assignee_name, new.title, new.details, new.kind, 'open',
            new.priority, new_due, new.due_has_time, new.remind_minutes, new.source_kind, new.source_text, new.category,
            new.recurrence, coalesce(new.series_id, new.id), new.id, new.position);

    insert into public.task_steps (task_id, title, position)
    select nid, s.title, s.position from public.task_steps s where s.task_id = new.id and s.deleted_at is null;

    insert into public.comments (task_id, author_id, kind, body)
    values (nid, new.created_by, 'event', 'repeat:created');

    update public.tasks set next_occurrence_id = nid where id = new.id;
  end if;
  return new;
end $$;

create trigger on_task_done after update of status on public.tasks
  for each row execute function private.handle_task_done();

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
