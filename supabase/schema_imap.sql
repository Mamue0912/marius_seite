-- =========================================================
--  Cockpit – IMAP-Postfächer (iCloud, web.de, …)
--  Nach schema.sql + schema_reply.sql ausführen.
--  Ergänzt die Outlook-Struktur um klassische IMAP/SMTP-Konten.
-- =========================================================

-- ---------- IMAP/SMTP-Konten (Passwörter verschlüsselt) ----------
create table if not exists public.mail_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider           text not null,              -- icloud | webde | other
  email              text not null,
  imap_host          text not null,
  imap_port          integer not null default 993,
  smtp_host          text not null,
  smtp_port          integer not null default 587,
  username           text not null,              -- meist = email
  password_enc       text not null,              -- AES-256-GCM (App-Passwort)
  status             text not null default 'connected', -- connected | error | disconnected
  last_error         text,
  inbox_uidvalidity  bigint,
  inbox_last_uid     bigint default 0,
  last_synced_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, email)
);

alter table public.mail_accounts enable row level security;
-- Kein Client-Zugriff → nur Service-Role (Passwörter unlesbar vom Browser).

-- ---------- messages-Tabelle für IMAP-Konten öffnen ----------
-- account_id zeigte bisher zwingend auf ein Outlook-Konto (ms_accounts).
-- Für IMAP-Mails lassen wir es leer und nutzen mail_account_id.
alter table public.messages alter column account_id drop not null;
alter table public.messages
  add column if not exists mail_account_id uuid references public.mail_accounts(id) on delete cascade;

create index if not exists messages_mail_account_idx on public.messages (mail_account_id);
