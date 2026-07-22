-- =====================================================================
-- Bewerbungszentrale + private Unterlagen
-- In Supabase SQL-Editor ausführen. Danach den privaten Storage-Bucket
-- "documents" anlegen (siehe unten).
-- =====================================================================

-- 1) Private Unterlagen ("Meine Unterlagen")
create table if not exists public.app_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  doc_type text,                       -- lebenslauf | zeugnis | zertifikat | empfehlung | anschreiben | sportnachweis | sonstiges
  storage_path text not null,          -- Pfad im privaten Bucket 'documents'
  mime text,
  size_bytes bigint,
  processing_status text not null default 'neu',   -- neu | verarbeitet | fehler
  extracted_text text,
  allowed_for_applications boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Aus Dokumenten extrahierte, zu bestätigende Fakten
create table if not exists public.app_document_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.app_documents(id) on delete cascade,
  category text not null,              -- schule | abschluss | note | praktikum | erfahrung | sprache | projekt | zertifikat | sport | faehigkeit | sonstiges
  value text not null,
  status text not null default 'offen',-- offen | bestaetigt | abgelehnt
  source text not null default 'ki',   -- ki | manuell
  created_at timestamptz not null default now()
);

-- 3) Bewerbungen (je Stelle ein Projekt)
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company text,
  position text,
  job_type text,                       -- praktikum | nebenjob | ausbildung | stelle | unbekannt
  job_url text,
  job_source text,                     -- url | text | pdf | screenshot | email
  job_text text,
  analysis jsonb,
  deadline date,
  contact text,
  status text not null default 'interessant',
  -- interessant | analyse_offen | unterlagen | bereit | beworben | rueckmeldung | gespraech | zusage | absage
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- 4) Zuordnung Unterlagen ↔ Bewerbung
create table if not exists public.application_documents (
  application_id uuid not null references public.applications(id) on delete cascade,
  document_id uuid not null references public.app_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (application_id, document_id)
);

-- 5) Durchgehender Chatverlauf je Bewerbung
create table if not exists public.application_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  role text not null,                  -- user | assistant
  content text not null,
  created_at timestamptz not null default now()
);

-- 6) Erstellte Dokumente je Bewerbung (Anschreiben usw.)
create table if not exists public.application_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  kind text not null,                  -- anschreiben | motivation | bewerbungsmail | kurzprofil | gespraech
  title text,
  body text not null,
  tone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indizes
create index if not exists app_documents_user_idx on public.app_documents (user_id, created_at desc);
create index if not exists app_document_facts_doc_idx on public.app_document_facts (document_id);
create index if not exists app_document_facts_user_idx on public.app_document_facts (user_id, status);
create index if not exists applications_user_idx on public.applications (user_id, last_activity_at desc);
create index if not exists application_messages_app_idx on public.application_messages (application_id, created_at);
create index if not exists application_docs_app_idx on public.application_docs (application_id, created_at desc);

-- =====================================================================
-- Row Level Security: nur der Eigentümer sieht/ändert seine Daten
-- =====================================================================
alter table public.app_documents enable row level security;
alter table public.app_document_facts enable row level security;
alter table public.applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_messages enable row level security;
alter table public.application_docs enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'app_documents','app_document_facts','applications',
    'application_documents','application_messages','application_docs'
  ] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- =====================================================================
-- Privater Storage-Bucket "documents"
-- =====================================================================
-- Der Bucket wird per API (Service-Role) angelegt/genutzt. Falls du ihn
-- lieber manuell anlegst: Storage → New bucket → Name "documents" →
-- PRIVATE (nicht public). Zugriff erfolgt ausschließlich serverseitig
-- über kurzlebige Signed-URLs; es gibt KEINE öffentlichen Datei-Links.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
