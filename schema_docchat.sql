-- Chat über die eigenen Unterlagen (optional; funktioniert auch ohne, dann
-- ohne dauerhafte Historie).
create table if not exists public.document_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,           -- user | assistant
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists document_messages_user_idx on public.document_messages (user_id, created_at);
alter table public.document_messages enable row level security;
drop policy if exists document_messages_owner on public.document_messages;
create policy document_messages_owner on public.document_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
