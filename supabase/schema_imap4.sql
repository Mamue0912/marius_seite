-- =========================================================
--  Cockpit – Mehrfach-Labels + Ordnerliste je Konto
-- =========================================================
alter table public.messages
  add column if not exists labels        text[] default '{}',
  add column if not exists user_labels    text[];   -- vom Nutzer gesetzt (Vorrang)

create index if not exists messages_labels_idx on public.messages using gin (labels);

-- Ausgelesene IMAP-Ordner je Konto (echte Namen + kanonischer Typ + Zähler).
create table if not exists public.mail_folders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  account_id   uuid not null references public.mail_accounts(id) on delete cascade,
  path         text not null,           -- echter IMAP-Ordnername
  folder_type  text not null,           -- inbox | sent | drafts | archive | spam | trash | other
  unread       integer default 0,
  total        integer default 0,
  updated_at   timestamptz not null default now(),
  unique (account_id, path)
);
alter table public.mail_folders enable row level security;
drop policy if exists "mail_folders_select_own" on public.mail_folders;
create policy "mail_folders_select_own" on public.mail_folders for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
