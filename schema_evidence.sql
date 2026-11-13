-- =====================================================================
--  Personal Evidence Database (Motivationsschreiben)
--  Im Supabase SQL-Editor ausführen. Gefahrlos erneut ausführbar.
--  Ergänzt schema_motivation.sql; nichts Bestehendes wird verändert.
-- =====================================================================

create table if not exists public.motivation_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  period text,
  role text,
  situation text,
  challenge text,
  decision text,
  action text,
  result text,
  learning text,
  business_link text,
  value_keys text[] not null default '{}',
  -- CONFIRMED | USER_REPORTED | PLANNED | INFERRED | UNKNOWN
  -- Entscheidet darüber, ob und wie die Erfahrung im Text erscheinen darf.
  status text not null default 'USER_REPORTED',
  source text,
  interview_probe text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Gestellte Fragen und Antworten des dynamischen Interviews.
create table if not exists public.motivation_interview (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  letter_id uuid references public.motivation_letters(id) on delete cascade,
  question_key text not null,
  question text not null,
  answer text,
  -- offen | beantwortet | uebersprungen
  state text not null default 'offen',
  targets text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists motivation_evidence_user_idx on public.motivation_evidence (user_id, updated_at desc);
create index if not exists motivation_interview_user_idx on public.motivation_interview (user_id, created_at desc);
create unique index if not exists motivation_interview_unique_q
  on public.motivation_interview (user_id, question_key);

alter table public.motivation_evidence enable row level security;
alter table public.motivation_interview enable row level security;

do $$
declare t text;
begin
  foreach t in array array['motivation_evidence','motivation_interview'] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format(
      'create policy %I_owner on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- Tonalität und Prompt-Version je Schreiben mitführen.
alter table public.motivation_letters add column if not exists tone text default 'persoenlich';
alter table public.motivation_letters add column if not exists prompt_version text;
alter table public.motivation_letters add column if not exists last_review jsonb;
