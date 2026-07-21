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
  source       text default 'manuell',        -- manuell | mail | bewerbung
  linked_message_id uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.tasks enable row level security;
drop policy if exists "tasks_select_own" on public.tasks;
create policy "tasks_select_own" on public.tasks for select using (auth.uid() = user_id);
create index if not exists tasks_user_idx on public.tasks (user_id, status, due_at);
