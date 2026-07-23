-- Ergänzt fehlende Spalten der mail_accounts-Tabelle, die der Verbinden-Code
-- erwartet (Basis-Schema schema_imap.sql kannte sie noch nicht). Idempotent –
-- kann gefahrlos mehrfach ausgeführt werden.
alter table public.mail_accounts add column if not exists display_name text;
alter table public.mail_accounts add column if not exists imap_secure boolean default true;
alter table public.mail_accounts add column if not exists smtp_secure boolean default true;
alter table public.mail_accounts add column if not exists auth_method text default 'password';
