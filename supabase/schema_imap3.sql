-- =========================================================
--  Cockpit – Nachrichtentyp, Header-Signale, dauerhafte Overrides
--  Nach den übrigen Schemas ausführen.
-- =========================================================
alter table public.messages
  add column if not exists message_type        text,     -- personal_direct | transactional | system_notification | newsletter_marketing | survey_feedback | automated_bulk | security_notification | spam | unknown
  add column if not exists is_bulk             boolean default false,
  add column if not exists has_list_unsub      boolean default false,
  add column if not exists user_action_status  text,     -- Nutzer-Override Handlungsstatus
  add column if not exists user_message_type   text,
  add column if not exists user_needs_reply    boolean,  -- true/false vom Nutzer gesetzt
  add column if not exists override_updated_at timestamptz;

notify pgrst, 'reload schema';
