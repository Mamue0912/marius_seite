-- =====================================================================
--  Motivationsschreiben (Studienbewerbungen)
--  Im Supabase SQL-Editor ausführen. Ergänzt schema_applications.sql;
--  der Bewerbungsbereich bleibt unverändert.
--
--  Die Tabellen sind bewusst vom Bewerbungsbereich getrennt: beide
--  dürfen dasselbe persönliche Profil nutzen, haben aber eigene
--  Eingaben, Anweisungen und Entwürfe.
-- =====================================================================

-- 1) Persönliches Profil für Studienbewerbungen (genau eins je Nutzer).
--    Freie Felder in profile jsonb, damit neue Angaben ohne Migration
--    ergänzt werden können. KEINE Demo-/Beispieldaten: jede Zeile gehört
--    genau einem angemeldeten Nutzer.
create table if not exists public.motivation_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  birth_date date,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Ein Motivationsschreiben je Hochschule/Studiengang.
create table if not exists public.motivation_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Hochschul-/Studiengangsdaten: mit WHU vorbelegt, aber frei änderbar.
  institution text not null default 'WHU – Otto Beisheim School of Management',
  programme text not null default 'Bachelor in Internationaler BWL/Management',
  intake text,                                  -- z. B. "01.09.2027"
  preset text not null default 'whu_bachelor',  -- whu_bachelor | custom
  language text not null default 'de',          -- de | en
  title text,
  outline jsonb not null default '[]'::jsonb,   -- [{id,heading,intent,done}]
  body text not null default '',
  -- Status des geführten Ablaufs.
  stage text not null default 'entwurf',
  -- entwurf | ueberarbeitung | export | beispiele | profil | bezug | gliederung
  last_check jsonb,                             -- letztes Prüfergebnis (Anzeige)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Persönliche Beispiele/Antworten (Situation, Beitrag, Ergebnis, Bezug).
--    Gehören dem Nutzer; optional einem Schreiben zugeordnet.
create table if not exists public.motivation_examples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id uuid references public.motivation_letters(id) on delete cascade,
  question_key text not null,       -- stabiler Schlüssel der Rückfrage
  question text not null,           -- gestellte Frage im Klartext
  situation text,                   -- konkrete Situation
  contribution text,                -- eigener Beitrag
  result text,                      -- Ergebnis oder Erkenntnis
  link text,                        -- Bezug zum Studium
  -- Wichtig: geplante Vorhaben dürfen NIE als abgeschlossen gelten.
  is_planned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) Wiederherstellbare Versionen eines Schreibens.
create table if not exists public.motivation_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id uuid not null references public.motivation_letters(id) on delete cascade,
  body text not null,
  label text,                       -- z. B. "Vor Überarbeitung: konkreter"
  origin text not null default 'auto', -- auto | manuell | ki
  created_at timestamptz not null default now()
);

-- Indizes
create index if not exists motivation_letters_user_idx on public.motivation_letters (user_id, updated_at desc);
create index if not exists motivation_examples_user_idx on public.motivation_examples (user_id, created_at desc);
create index if not exists motivation_examples_letter_idx on public.motivation_examples (letter_id);
create index if not exists motivation_versions_letter_idx on public.motivation_versions (letter_id, created_at desc);

-- Eindeutigkeit: je Schreiben und Frageschlüssel nur eine Antwort.
create unique index if not exists motivation_examples_unique_q
  on public.motivation_examples (user_id, coalesce(letter_id, '00000000-0000-0000-0000-000000000000'::uuid), question_key);

-- =====================================================================
--  Row Level Security: nur der Eigentümer sieht/ändert seine Daten
-- =====================================================================
alter table public.motivation_profile enable row level security;
alter table public.motivation_letters enable row level security;
alter table public.motivation_examples enable row level security;
alter table public.motivation_versions enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'motivation_profile','motivation_letters','motivation_examples','motivation_versions'
  ] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- =====================================================================
--  Nachträge (gefahrlos erneut ausführbar)
-- =====================================================================
-- Der geführte Ablauf beginnt jetzt beim Entwurf, nicht beim Profil.
alter table public.motivation_letters alter column stage set default 'entwurf';
