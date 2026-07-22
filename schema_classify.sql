-- Mehrdimensionale E-Mail-Klassifizierung (Relevanz, Zusammenfassung, Status)
-- In Supabase SQL-Editor ausführen.

alter table public.messages add column if not exists relevance text;          -- sehr_wichtig|wichtig|normal|niedrig|irrelevant
alter table public.messages add column if not exists summary text;            -- kurze Zusammenfassung
alter table public.messages add column if not exists classified_at timestamptz;
alter table public.messages add column if not exists user_relevance text;     -- Nutzer-Override
alter table public.messages add column if not exists user_message_type text;  -- Nutzer-Override (falls nicht vorhanden)

-- Für "noch nicht klassifiziert"-Abfragen.
create index if not exists messages_classified_idx on public.messages (user_id, classified_at);
create index if not exists messages_relevance_idx on public.messages (user_id, relevance);

-- Regeltabelle (falls früheres Skript nicht lief) + Label-/Antwort-Aktionen.
create table if not exists public.mail_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  match_type    text not null,          -- sender | domain | account
  match_value   text not null,
  set_category  text,
  set_hidden    boolean default false,
  created_at    timestamptz not null default now(),
  unique (user_id, match_type, match_value)
);
alter table public.mail_rules add column if not exists set_label text;
alter table public.mail_rules add column if not exists set_needs_reply boolean;   -- true/false erzwingen, null = neutral

alter table public.mail_rules enable row level security;
drop policy if exists "mail_rules_owner" on public.mail_rules;
create policy "mail_rules_owner" on public.mail_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
