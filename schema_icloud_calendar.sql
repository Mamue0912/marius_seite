-- iCloud-Kalender-Anbindung (CalDAV, nur Lesen). Das app-spezifische Passwort
-- wird verschlüsselt (AES-256-GCM, TOKEN_ENC_KEY) serverseitig gespeichert –
-- niemals im Klartext. Analog zu google_accounts.
create table if not exists public.icloud_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  apple_id text not null,                    -- Apple-ID / iCloud-E-Mail
  app_password_enc text not null,            -- app-spezifisches Passwort (verschlüsselt)
  calendar_home_url text,                    -- via CalDAV-Discovery ermittelt (Cache)
  status text not null default 'connected',  -- connected | needs_reauth
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);
create index if not exists icloud_accounts_user_idx on public.icloud_accounts (user_id);
alter table public.icloud_accounts enable row level security;
-- Kein direkter Client-Zugriff: Zugangsdaten werden nur serverseitig über den
-- Service-Role-Key gelesen/geschrieben. Policy dennoch owner-scoped.
drop policy if exists icloud_accounts_owner on public.icloud_accounts;
create policy icloud_accounts_owner on public.icloud_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
