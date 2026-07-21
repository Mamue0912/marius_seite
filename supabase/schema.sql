-- =========================================================
--  Cockpit – Outlook Live Sync · Supabase-Schema
--  Ausführen im Supabase SQL Editor (einmalig).
--  Sicherheit: RLS auf allen Tabellen. Nachrichten sind pro Nutzer
--  isoliert (auth.uid()); Tokens/Subscriptions sind NUR über den
--  Service-Role-Key (serverseitig) erreichbar – niemals vom Client.
-- =========================================================

create extension if not exists "pgcrypto";

-- ---------- Microsoft-Konten (Tokens verschlüsselt) ----------
create table if not exists public.ms_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  ms_home_account   text,
  ms_user_principal text,
  display_name      text,
  email             text,
  access_token_enc  text,               -- AES-256-GCM
  refresh_token_enc text,               -- AES-256-GCM
  token_expires_at  timestamptz,
  scopes            text,
  status            text not null default 'connected', -- connected | needs_reauth | disconnected
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, ms_user_principal)
);

-- ---------- Nachrichten (nur so viel wie das Cockpit braucht) ----------
create table if not exists public.messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  account_id          uuid not null references public.ms_accounts(id) on delete cascade,
  graph_id            text not null,      -- stabile Microsoft-Graph-Nachrichten-ID
  conversation_id     text,
  internet_message_id text,
  folder              text not null default 'inbox',
  from_name           text,
  from_address        text,
  to_recipients       text,
  subject             text,
  preview             text,
  received_at         timestamptz,
  sent_at             timestamptz,
  is_read             boolean default false,
  importance          text,               -- low | normal | high
  needs_reply         boolean default false,
  deadline_at         timestamptz,
  detected_task       text,
  category            text default 'analyse', -- Bucket (siehe classify.ts)
  status              text default 'analyzing', -- analyzing | classified
  web_link            text,
  last_modified_at    timestamptz,        -- lastModifiedDateTime aus Outlook
  last_synced_at      timestamptz not null default now(),
  hidden              boolean default false,  -- Newsletter/Automatik
  is_deleted          boolean default false,
  created_at          timestamptz not null default now(),
  unique (user_id, graph_id)
);
create index if not exists messages_user_recv_idx on public.messages (user_id, received_at desc);
create index if not exists messages_user_cat_idx  on public.messages (user_id, category);

-- ---------- Graph-Abonnements (Webhooks) ----------
create table if not exists public.graph_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  account_id       uuid not null references public.ms_accounts(id) on delete cascade,
  subscription_id  text not null unique,
  resource         text not null,
  folder           text not null,
  client_state     text not null,         -- pro Abo, wird bei jedem Webhook validiert
  expires_at       timestamptz not null,
  last_renewed_at  timestamptz,
  status           text not null default 'active',
  created_at       timestamptz not null default now()
);

-- ---------- Sync-Status je Konto/Ordner (Delta + Webhook-Zeitpunkte) ----------
create table if not exists public.sync_state (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  account_id      uuid not null references public.ms_accounts(id) on delete cascade,
  folder          text not null,
  delta_link      text,
  last_delta_at   timestamptz,
  last_webhook_at timestamptz,
  unique (account_id, folder)
);

-- ---------- Idempotenz für Webhook-Benachrichtigungen ----------
create table if not exists public.processed_notifications (
  dedupe_key   text primary key,
  received_at  timestamptz not null default now()
);

-- ============================ RLS ============================
alter table public.ms_accounts          enable row level security;
alter table public.messages             enable row level security;
alter table public.graph_subscriptions  enable row level security;
alter table public.sync_state           enable row level security;
alter table public.processed_notifications enable row level security;

-- Nachrichten: der/die angemeldete Nutzer:in darf NUR eigene Zeilen LESEN.
-- Schreiben erfolgt ausschließlich serverseitig über den Service-Role-Key
-- (der RLS umgeht). Deshalb gibt es bewusst KEINE insert/update/delete-Policy.
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages
  for select using (auth.uid() = user_id);

-- ms_accounts / graph_subscriptions / sync_state / processed_notifications:
-- KEINE Policy für authenticated/anon → nur Service-Role hat Zugriff.
-- (Tokens sind damit vom Client aus grundsätzlich unlesbar.)

-- ============================ Realtime ============================
-- Nur die Nachrichten-Tabelle wird live an den Client gepusht.
-- RLS gilt auch für Realtime → jede:r erhält ausschließlich eigene Zeilen.
alter publication supabase_realtime add table public.messages;
