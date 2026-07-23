-- Performance-Indizes für schnelle Mail-Abfragen (Liste, Zähler, Sync).
create index if not exists messages_user_folder_recv_idx
  on public.messages (user_id, folder_type, received_at desc) where is_deleted = false;
create index if not exists messages_user_unread_idx
  on public.messages (user_id, folder_type, is_read) where is_deleted = false;
create index if not exists messages_user_recv_idx
  on public.messages (user_id, received_at desc) where is_deleted = false;
create index if not exists messages_account_idx
  on public.messages (user_id, mail_account_id);
create index if not exists messages_graph_idx
  on public.messages (user_id, graph_id);
