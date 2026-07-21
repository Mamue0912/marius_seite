-- =========================================================
--  Cockpit – Mehrkonten-Mail, KI-Kategorien, Regeln, SMTP
--  Nach schema_imap.sql ausführen. Erweitert nur; nichts wird gelöscht.
-- =========================================================

-- ---------- mail_accounts: Anzeigename, Verschlüsselung, Auth ----------
alter table public.mail_accounts
  add column if not exists display_name   text,
  add column if not exists imap_secure    boolean default true,
  add column if not exists smtp_secure    boolean default false,  -- 587 = STARTTLS
  add column if not exists auth_method     text default 'password';

-- ---------- messages: Adressen, Thread, Kategorien getrennt ----------
alter table public.messages
  add column if not exists cc_addresses          text,
  add column if not exists bcc_addresses         text,
  add column if not exists reply_to_addresses    text,
  add column if not exists thread_id             text,
  add column if not exists in_reply_to           text,
  add column if not exists message_refs          text,        -- References-Header
  add column if not exists semantic_category     text,        -- inhaltliche KI-Kategorie
  add column if not exists action_status         text,        -- Handlungsstatus
  add column if not exists priority              text,        -- normal | hoch | dringend
  add column if not exists classification_confidence real,
  add column if not exists classification_source text,        -- rule | ai | heuristic | user
  add column if not exists user_category_override text,
  add column if not exists has_attachments       boolean default false,
  add column if not exists is_flagged            boolean default false,
  add column if not exists folder_type           text default 'inbox',   -- kanonisch
  add column if not exists original_folder_name  text,
  add column if not exists account_display_name  text;

create index if not exists messages_thread_idx on public.messages (user_id, thread_id);
create index if not exists messages_semcat_idx on public.messages (user_id, semantic_category);

-- ---------- Manuelle Sortierregeln (Nutzer-Vorrang) ----------
create table if not exists public.mail_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  match_type    text not null,          -- sender | domain | account
  match_value   text not null,          -- z. B. trainer@verein.de | verein.de | mail_account_id
  set_category  text,                   -- semantische Zielkategorie
  set_hidden    boolean default false,  -- Newsletter ausblenden
  created_at    timestamptz not null default now(),
  unique (user_id, match_type, match_value)
);
alter table public.mail_rules enable row level security;
drop policy if exists "mail_rules_select_own" on public.mail_rules;
create policy "mail_rules_select_own" on public.mail_rules for select using (auth.uid() = user_id);
-- Schreiben nur serverseitig (Service-Role).
