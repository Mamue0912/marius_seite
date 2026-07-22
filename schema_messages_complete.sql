-- =====================================================================
-- VOLLSTÄNDIGE Nachrüstung aller messages-Spalten, die der Sync schreibt.
-- Behebt: neue Mails werden nicht gespeichert / Einordnung schlägt fehl
-- (Ursache: fehlende Spalten wie folder_type aus schema_imap2/3/4).
-- Idempotent, jede Zeile eigenständig – kann nicht abbrechen.
-- =====================================================================

-- Ordner / Threading / Adressen (schema_imap2)
alter table public.messages add column if not exists folder_type           text default 'inbox';
alter table public.messages add column if not exists original_folder_name  text;
alter table public.messages add column if not exists account_display_name  text;
alter table public.messages add column if not exists thread_id             text;
alter table public.messages add column if not exists conversation_id       text;
alter table public.messages add column if not exists in_reply_to           text;
alter table public.messages add column if not exists message_refs          text;
alter table public.messages add column if not exists internet_message_id   text;
alter table public.messages add column if not exists message_id            text;
alter table public.messages add column if not exists to_recipients         text;
alter table public.messages add column if not exists cc_addresses          text;
alter table public.messages add column if not exists bcc_addresses         text;
alter table public.messages add column if not exists reply_to_addresses    text;
alter table public.messages add column if not exists has_attachments       boolean default false;
alter table public.messages add column if not exists is_flagged            boolean default false;
alter table public.messages add column if not exists sent_at               timestamptz;
alter table public.messages add column if not exists importance            text;
alter table public.messages add column if not exists graph_id              text;
alter table public.messages add column if not exists web_link              text;
alter table public.messages add column if not exists last_synced_at        timestamptz;
alter table public.messages add column if not exists last_modified_at      timestamptz;

-- Klassifizierung (schema_imap2/3/4 + classify)
alter table public.messages add column if not exists semantic_category     text;
alter table public.messages add column if not exists action_status         text;
alter table public.messages add column if not exists priority              text;
alter table public.messages add column if not exists needs_reply           boolean default false;
alter table public.messages add column if not exists message_type          text;
alter table public.messages add column if not exists is_bulk               boolean default false;
alter table public.messages add column if not exists has_list_unsub        boolean default false;
alter table public.messages add column if not exists relevance             text;
alter table public.messages add column if not exists summary               text;
alter table public.messages add column if not exists classified_at         timestamptz;
alter table public.messages add column if not exists classification_source text;
alter table public.messages add column if not exists classification_confidence real;
alter table public.messages add column if not exists labels                text[] default '{}';
alter table public.messages add column if not exists deadline_at           timestamptz;
alter table public.messages add column if not exists detected_task         text;
alter table public.messages add column if not exists category              text;
alter table public.messages add column if not exists status                text;
alter table public.messages add column if not exists hidden                boolean default false;

-- Nutzer-Overrides
alter table public.messages add column if not exists user_category_override text;
alter table public.messages add column if not exists user_action_status     text;
alter table public.messages add column if not exists user_message_type      text;
alter table public.messages add column if not exists user_needs_reply       boolean;
alter table public.messages add column if not exists user_labels            text[];
alter table public.messages add column if not exists user_relevance         text;
alter table public.messages add column if not exists override_updated_at    timestamptz;

-- PostgREST-Schemacache neu laden (wichtig nach vielen ALTERs)
notify pgrst, 'reload schema';
