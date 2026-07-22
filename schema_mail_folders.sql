-- Lokale Ordner-Anzeigeeinstellungen (nur Cockpit-Anzeige, NICHT der Server-Ordner).
-- Der Sync schreibt diese Spalten nicht, sie bleiben also erhalten.
alter table public.mail_folders add column if not exists display_name  text;
alter table public.mail_folders add column if not exists sort_order    integer;
alter table public.mail_folders add column if not exists hidden        boolean default false;
alter table public.mail_folders add column if not exists type_override text;
