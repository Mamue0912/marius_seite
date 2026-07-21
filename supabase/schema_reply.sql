-- =========================================================
--  Cockpit – E-Mail-Antwort-Assistent · Schema-Erweiterung
--  Nach supabase/schema.sql ausführen. Erweitert nur die
--  vorhandene messages-Tabelle (nur so viel wie nötig).
-- =========================================================

alter table public.messages
  add column if not exists suggested_replies    jsonb,     -- [{label, intent, explanation, binding}]
  add column if not exists selected_reply_intent text,
  add column if not exists custom_instruction   text,
  add column if not exists draft_body            text,
  add column if not exists draft_subject         text,
  add column if not exists draft_status          text,      -- entwurf | bereit | gesendet | spaeter | keine
  add column if not exists draft_language        text,
  add column if not exists draft_tone            text,
  add column if not exists draft_binding         boolean default false,
  add column if not exists draft_needs_attachment boolean default false,
  add column if not exists draft_missing_info    text,
  add column if not exists outlook_draft_id      text,      -- ID des echten Outlook-Entwurfs
  add column if not exists reply_sent_at         timestamptz,
  add column if not exists last_generated_at     timestamptz;

-- Die messages-Tabelle ist bereits in supabase_realtime (schema.sql) und
-- unter RLS (nur Lesen für auth.uid()). Schreibzugriffe auf die Draft-Felder
-- erfolgen ausschließlich serverseitig über den Service-Role-Key.
