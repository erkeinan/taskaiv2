-- Settings from the old app that have no column of their own (font size, effect direction, sort, voice).
alter table public.profiles
  add column prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object' and octet_length(prefs::text) <= 4000);
alter table public.profiles alter column theme set default 'system';
