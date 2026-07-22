-- =====================================================================
-- Konsolidierte Reparatur: stellt alle für Mail + Klassifizierung nötigen
-- Spalten/Tabellen sicher. Idempotent (mehrfach ausführbar).
-- =====================================================================

-- Ordnerliste je Konto (linke Spalte im Mailbereich)
create table if not exists public.mail_folders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid not null references public.mail_accounts(id) on delete cascade,
  path         text not null,
  folder_type  text not null,
  unread       integer default 0,
  total        integer default 0,
  updated_at   timestamptz not null default now(),
  unique (account_id, path)
);
alter table public.mail_folders enable row level security;
drop policy if exists "mail_folders_owner" on public.mail_folders;
create policy "mail_folders_owner" on public.mail_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Nachrichten-Spalten (Typ, Labels, Klassifizierung, Nutzer-Overrides)
alter table public.messages add column if not exists message_type        text;
alter table public.messages add column if not exists is_bulk             boolean default false;
alter table public.messages add column if not exists has_list_unsub      boolean default false;
alter table public.messages add column if not exists action_status       text;
alter table public.messages add column if not exists priority            text;
alter table public.messages add column if not exists needs_reply         boolean default false;
alter table public.messages add column if not exists labels              text[] default '{}';
alter table public.messages add column if not exists user_labels         text[];
alter table public.messages add column if not exists user_action_status  text;
alter table public.messages add column if not exists user_message_type   text;
alter table public.messages add column if not exists user_needs_reply    boolean;
alter table public.messages add column if not exists user_category_override text;
alter table public.messages add column if not exists override_updated_at timestamptz;
alter table public.messages add column if not exists semantic_category   text;
alter table public.messages add column if not exists classification_source text;
alter table public.messages add column if not exists classification_confidence real;
alter table public.messages add column if not exists relevance           text;
alter table public.messages add column if not exists user_relevance      text;
alter table public.messages add column if not exists summary             text;
alter table public.messages add column if not exists classified_at       timestamptz;

create index if not exists messages_labels_idx on public.messages using gin (labels);
create index if not exists messages_classified_idx on public.messages (user_id, classified_at);
create index if not exists messages_relevance_idx on public.messages (user_id, relevance);

-- Regeltabelle + neue Aktionen (falls noch nicht vorhanden)
create table if not exists public.mail_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  match_type    text not null,
  match_value   text not null,
  set_category  text,
  set_hidden    boolean default false,
  created_at    timestamptz not null default now(),
  unique (user_id, match_type, match_value)
);
alter table public.mail_rules add column if not exists set_label text;
alter table public.mail_rules add column if not exists set_needs_reply boolean;
alter table public.mail_rules enable row level security;
drop policy if exists "mail_rules_owner" on public.mail_rules;
create policy "mail_rules_owner" on public.mail_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
