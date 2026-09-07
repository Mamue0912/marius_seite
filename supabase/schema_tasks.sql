-- =========================================================
--  Cockpit – Aufgaben (mit und ohne Fälligkeitsdatum)
--  Nach den übrigen Schemas ausführen.
-- =========================================================
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  note         text,
  priority     text default 'normal',        -- niedrig | normal | hoch
  due_at       timestamptz,                   -- NULL = ohne Frist (völlig gültig)
  status       text not null default 'offen', -- offen | warten | erledigt
  source       text default 'manuell',        -- manuell | mail | bewerbung | icloud_calendar
  category     text default 'Sonstiges',
  starts_at    timestamptz,
  ends_at      timestamptz,
  all_day      boolean not null default false,
  location     text,
  calendar_name text,
  external_id  text,
  external_url text,
  linked_calendar_event_id text,
  linked_application_id uuid,
  reminder_at  timestamptz,
  synced_at    timestamptz,
  linked_message_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS ergänzt bei älteren Installationen keine Spalten.
-- Deshalb fehlende Felder einzeln und ohne Datenverlust nachziehen.
alter table public.tasks add column if not exists note text;
alter table public.tasks add column if not exists priority text default 'normal';
alter table public.tasks add column if not exists due_at timestamptz;
alter table public.tasks add column if not exists status text default 'offen';
alter table public.tasks add column if not exists source text default 'manuell';
alter table public.tasks add column if not exists category text default 'Sonstiges';
alter table public.tasks add column if not exists starts_at timestamptz;
alter table public.tasks add column if not exists ends_at timestamptz;
alter table public.tasks add column if not exists all_day boolean not null default false;
alter table public.tasks add column if not exists location text;
alter table public.tasks add column if not exists calendar_name text;
alter table public.tasks add column if not exists external_id text;
alter table public.tasks add column if not exists external_url text;
alter table public.tasks add column if not exists linked_calendar_event_id text;
alter table public.tasks add column if not exists linked_application_id uuid;
alter table public.tasks add column if not exists reminder_at timestamptz;
alter table public.tasks add column if not exists synced_at timestamptz;
alter table public.tasks add column if not exists linked_message_id uuid;
alter table public.tasks add column if not exists created_at timestamptz default now();
alter table public.tasks add column if not exists updated_at timestamptz default now();
update public.tasks set status = 'offen' where status is null;
update public.tasks set source = 'manuell' where source is null;
update public.tasks set category = 'Sonstiges' where category is null;
alter table public.tasks alter column status set default 'offen';
alter table public.tasks alter column status set not null;
alter table public.tasks alter column created_at set default now();
alter table public.tasks alter column updated_at set default now();

alter table public.tasks enable row level security;
drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks for select using (auth.uid() = user_id);
create index if not exists tasks_user_idx on public.tasks (user_id, status, due_at);
with ranked as (
  select id, row_number() over (partition by user_id, source, external_id order by created_at nulls last, id) as rn
  from public.tasks where external_id is not null
)
update public.tasks set external_id=null where id in (select id from ranked where rn > 1);
create unique index if not exists tasks_source_external_uidx on public.tasks (user_id, source, external_id);
create index if not exists tasks_calendar_window_idx on public.tasks (user_id, source, starts_at);
