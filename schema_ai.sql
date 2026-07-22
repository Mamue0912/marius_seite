-- KI-Diagnose (Phase 2). Nur Metadaten, keine Schlüssel/keine Mailinhalte.
create table if not exists public.ai_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                 -- suggest | generate | refine | compose
  ok boolean not null,
  duration_ms integer,
  model text,
  error_category text,                -- not_configured | auth | rate_limit | timeout | overloaded | api_error
  subject_hint text,                  -- gekürzter Betreff (max 80 Zeichen), kein Inhalt
  created_at timestamptz not null default now()
);

create index if not exists ai_events_user_created_idx
  on public.ai_events (user_id, created_at desc);

alter table public.ai_events enable row level security;

-- Nur der Eigentümer sieht seine eigenen Diagnose-Ereignisse.
drop policy if exists ai_events_owner on public.ai_events;
create policy ai_events_owner on public.ai_events
  for select using (auth.uid() = user_id);
