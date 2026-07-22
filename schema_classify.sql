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

-- Regeln um Label-/Antwort-Aktionen erweitern (immer als X / nie antwortpflichtig).
alter table public.mail_rules add column if not exists set_label text;
alter table public.mail_rules add column if not exists set_needs_reply boolean;   -- true/false erzwingen, null = neutral
