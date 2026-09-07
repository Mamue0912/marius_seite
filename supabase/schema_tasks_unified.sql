begin;

alter table if exists public.icloud_accounts add column if not exists last_synced_at timestamptz;
alter table if exists public.icloud_accounts add column if not exists excluded_calendar_keys text[] not null default '{}';

create schema if not exists cockpit_backup;
revoke all on schema cockpit_backup from public, anon, authenticated;

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note text,
  priority text default 'normal',
  due_at timestamptz,
  status text not null default 'offen',
  source text default 'manuell',
  linked_message_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Einmalige, nicht öffentlich erreichbare Sicherung vor der Zusammenführung.
create table if not exists cockpit_backup.tasks_before_unification_20260907 (
  task_id uuid primary key,
  row_data jsonb not null,
  backed_up_at timestamptz not null default now()
);
insert into cockpit_backup.tasks_before_unification_20260907(task_id,row_data)
select t.id,to_jsonb(t) from public.tasks t
on conflict (task_id) do nothing;

-- Einheitliches Modell für Aufgaben, E-Mail-/Bewerbungsfristen und Kalendertermine.
alter table public.tasks add column if not exists category text default 'Sonstiges';
alter table public.tasks add column if not exists starts_at timestamptz;
alter table public.tasks add column if not exists ends_at timestamptz;
alter table public.tasks add column if not exists all_day boolean not null default false;
alter table public.tasks add column if not exists location text;
alter table public.tasks add column if not exists calendar_name text;
alter table public.tasks add column if not exists external_id text;
alter table public.tasks add column if not exists external_url text;
alter table public.tasks add column if not exists linked_calendar_event_id text;
alter table public.tasks add column if not exists linked_application_id uuid;
alter table public.tasks add column if not exists reminder_at timestamptz;
alter table public.tasks add column if not exists synced_at timestamptz;
alter table public.tasks add column if not exists note text;
alter table public.tasks add column if not exists priority text default 'normal';
alter table public.tasks add column if not exists due_at timestamptz;
alter table public.tasks add column if not exists status text default 'offen';
alter table public.tasks add column if not exists source text default 'manuell';
alter table public.tasks add column if not exists linked_message_id uuid;
alter table public.tasks add column if not exists created_at timestamptz default now();
alter table public.tasks add column if not exists updated_at timestamptz default now();

update public.tasks set status='offen' where status is null;
update public.tasks set source='manuell' where source is null;
update public.tasks set category='Sonstiges' where category is null;
update public.tasks set starts_at=due_at where starts_at is null and due_at is not null;
alter table public.tasks alter column status set default 'offen';
alter table public.tasks alter column status set not null;
alter table public.tasks alter column source set default 'manuell';
alter table public.tasks alter column category set default 'Sonstiges';

-- Doppelte externe Schlüssel werden gelöst, ohne Aufgaben zu löschen.
with ranked as (
  select id, row_number() over (partition by user_id, source, external_id order by created_at nulls last, id) as rn
  from public.tasks where external_id is not null
)
update public.tasks set external_id=null
where id in (select id from ranked where rn > 1);
create unique index if not exists tasks_source_external_uidx
  on public.tasks(user_id, source, external_id);
create index if not exists tasks_user_due_idx on public.tasks(user_id, status, due_at);
create index if not exists tasks_calendar_window_idx on public.tasks(user_id, source, starts_at);

-- Bestehende E-Mail-Aufgaben mit vorhandener Verknüpfung behalten ihre IDs.
with ranked as (
  select id, linked_message_id,
         row_number() over (partition by user_id, linked_message_id order by created_at nulls last, id) as rn
  from public.tasks where linked_message_id is not null
)
update public.tasks t
set source='mail', external_id='mail:' || ranked.linked_message_id::text, category='E-Mail'
from ranked
where t.id=ranked.id and ranked.rn=1 and t.external_id is null
  and not exists (
    select 1 from public.tasks existing
    where existing.user_id=t.user_id and existing.source='mail'
      and existing.external_id='mail:' || ranked.linked_message_id::text
      and existing.id<>t.id
  );

-- Alle bestehenden E-Mail-Fristen verlustfrei in das gemeinsame Modell übernehmen.
insert into public.tasks (
  user_id,title,note,priority,due_at,starts_at,status,source,category,
  linked_message_id,external_id,created_at,updated_at,synced_at
)
select m.user_id, coalesce(nullif(m.subject,''),'E-Mail-Frist'),
       coalesce(nullif(m.preview,''), nullif(m.from_name,''), nullif(m.from_address,'')),
       case when m.importance='high' then 'hoch' else 'normal' end,
       m.deadline_at,m.deadline_at,'offen','mail','E-Mail',m.id,
       'mail:' || m.id::text,now(),now(),now()
from public.messages m
where m.deadline_at is not null and coalesce(m.is_deleted,false)=false
on conflict (user_id,source,external_id) do update set
  title=excluded.title,note=excluded.note,priority=excluded.priority,due_at=excluded.due_at,
  starts_at=excluded.starts_at,linked_message_id=excluded.linked_message_id,synced_at=now(),updated_at=now();

-- Passende vorhandene Bewerbungsaufgaben werden zuerst verknüpft und behalten ihre IDs.
with possible_matches as (
  select t.id as task_id, a.id as application_id,
         row_number() over (partition by a.id order by t.created_at nulls last, t.id) as application_rank,
         row_number() over (partition by t.id order by a.created_at nulls last, a.id) as task_rank
  from public.applications a
  join public.tasks t on t.user_id=a.user_id and t.source='bewerbung' and t.external_id is null
   and lower(t.title)=lower(coalesce(nullif(a.position,''),nullif(a.company,''),'Bewerbungsfrist'))
  where a.deadline is not null
), candidates as (
  select task_id,application_id from possible_matches
  where application_rank=1 and task_rank=1
)
update public.tasks t
set linked_application_id=c.application_id,
    external_id='application:' || c.application_id::text,
    category='Bewerbung'
from candidates c
where t.id=c.task_id
  and not exists (
    select 1 from public.tasks existing
    where existing.user_id=t.user_id and existing.source='bewerbung'
      and existing.external_id='application:' || c.application_id::text
      and existing.id<>t.id
  );

insert into public.tasks (
  user_id,title,note,priority,due_at,starts_at,all_day,status,source,category,
  linked_application_id,external_id,created_at,updated_at,synced_at
)
select a.user_id,
       coalesce(nullif(a.position,''),nullif(a.company,''),'Bewerbungsfrist'),
       case when a.company is not null then 'Bewerbungsfrist bei ' || a.company else 'Bewerbungsfrist' end,
       'hoch', ((a.deadline::date + time '12:00') at time zone 'Europe/Berlin'),
       ((a.deadline::date + time '12:00') at time zone 'Europe/Berlin'), true,
       'offen','bewerbung','Bewerbung',a.id,'application:' || a.id::text,now(),now(),now()
from public.applications a where a.deadline is not null
on conflict (user_id,source,external_id) do update set
  title=excluded.title,note=excluded.note,due_at=excluded.due_at,starts_at=excluded.starts_at,
  linked_application_id=excluded.linked_application_id,synced_at=now(),updated_at=now();

-- Laufende Synchronisierung für neue/geänderte/gelöschte E-Mail-Fristen.
create or replace function public.sync_message_deadline_task() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    delete from public.tasks where user_id=old.user_id and source='mail' and external_id='mail:' || old.id::text;
    return old;
  end if;
  if new.deadline_at is null or coalesce(new.is_deleted,false) then
    delete from public.tasks where user_id=new.user_id and source='mail' and external_id='mail:' || new.id::text;
  else
    insert into public.tasks (user_id,title,note,priority,due_at,starts_at,status,source,category,linked_message_id,external_id,created_at,updated_at,synced_at)
    values (new.user_id,coalesce(nullif(new.subject,''),'E-Mail-Frist'),coalesce(nullif(new.preview,''),nullif(new.from_name,''),nullif(new.from_address,'')),case when new.importance='high' then 'hoch' else 'normal' end,new.deadline_at,new.deadline_at,'offen','mail','E-Mail',new.id,'mail:' || new.id::text,now(),now(),now())
    on conflict (user_id,source,external_id) do update set title=excluded.title,note=excluded.note,priority=excluded.priority,due_at=excluded.due_at,starts_at=excluded.starts_at,linked_message_id=excluded.linked_message_id,synced_at=now(),updated_at=now();
  end if;
  return new;
end $$;
drop trigger if exists messages_deadline_to_tasks on public.messages;
create trigger messages_deadline_to_tasks after insert or update of deadline_at,subject,preview,importance,is_deleted or delete on public.messages
for each row execute function public.sync_message_deadline_task();

-- Laufende Synchronisierung für Bewerbungsfristen.
create or replace function public.sync_application_deadline_task() returns trigger
language plpgsql security definer set search_path=public as $$
declare task_title text;
begin
  if tg_op='DELETE' then
    delete from public.tasks where user_id=old.user_id and source='bewerbung' and external_id='application:' || old.id::text;
    return old;
  end if;
  if new.deadline is null then
    delete from public.tasks where user_id=new.user_id and source='bewerbung' and external_id='application:' || new.id::text;
  else
    task_title := coalesce(nullif(new.position,''),nullif(new.company,''),'Bewerbungsfrist');
    insert into public.tasks (user_id,title,note,priority,due_at,starts_at,all_day,status,source,category,linked_application_id,external_id,created_at,updated_at,synced_at)
    values (new.user_id,task_title,case when new.company is not null then 'Bewerbungsfrist bei ' || new.company else 'Bewerbungsfrist' end,'hoch',((new.deadline::date + time '12:00') at time zone 'Europe/Berlin'),((new.deadline::date + time '12:00') at time zone 'Europe/Berlin'),true,'offen','bewerbung','Bewerbung',new.id,'application:' || new.id::text,now(),now(),now())
    on conflict (user_id,source,external_id) do update set title=excluded.title,note=excluded.note,due_at=excluded.due_at,starts_at=excluded.starts_at,linked_application_id=excluded.linked_application_id,synced_at=now(),updated_at=now();
  end if;
  return new;
end $$;
drop trigger if exists applications_deadline_to_tasks on public.applications;
create trigger applications_deadline_to_tasks after insert or update of deadline,company,position or delete on public.applications
for each row execute function public.sync_application_deadline_task();

alter table public.tasks enable row level security;
drop policy if exists tasks_select_own on public.tasks;
create policy tasks_select_own on public.tasks for select using (auth.uid()=user_id);

commit;