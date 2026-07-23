-- Google-Kalender-Anbindung (nur Lesen). Tokens werden verschlüsselt
-- (AES-256-GCM, TOKEN_ENC_KEY) serverseitig gespeichert – niemals im Klartext.
create table if not exists public.google_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_sub text not null,                 -- stabile Google-Nutzer-ID (sub)
  email text,
  display_name text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text,
  status text not null default 'connected', -- connected | needs_reauth
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_sub)
);
create index if not exists google_accounts_user_idx on public.google_accounts (user_id);
alter table public.google_accounts enable row level security;
-- Kein direkter Client-Zugriff: Tokens werden nur serverseitig über den
-- Service-Role-Key gelesen/geschrieben. Policy dennoch owner-scoped.
drop policy if exists google_accounts_owner on public.google_accounts;
create policy google_accounts_owner on public.google_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
