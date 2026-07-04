-- Outlook Mail Center Bot VIP v1.2
-- Run this file in Supabase SQL Editor after reset_schema.sql for a clean install.

create extension if not exists pgcrypto;

do $$ begin
  create type bot_role as enum ('owner', 'user');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type bot_user_status as enum ('active', 'revoked');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type token_status as enum ('unknown', 'ok', 'error');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type user_state_kind as enum ('idle', 'awaiting_add_mail', 'awaiting_import_confirm', 'awaiting_broadcast');
exception when duplicate_object then null;
end $$;

create table if not exists bot_users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text,
  role bot_role not null default 'user',
  status bot_user_status not null default 'active',
  created_by uuid references bot_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists user_states (
  user_id uuid primary key references bot_users(id) on delete cascade,
  state user_state_kind not null default 'idle',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists mail_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references bot_users(id) on delete cascade,
  email text not null,
  alias text,
  provider text not null default 'microsoft',
  client_id text not null,
  refresh_token_encrypted text not null,
  token_status token_status not null default 'unknown',
  last_seen_message_id text,
  last_seen_received_at timestamptz,
  last_check_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_mail_accounts_owner on mail_accounts(owner_user_id) where deleted_at is null;
create index if not exists idx_mail_accounts_email on mail_accounts(lower(email));
create unique index if not exists uq_mail_accounts_owner_email_active on mail_accounts(owner_user_id, lower(email)) where deleted_at is null;

create table if not exists processed_messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references bot_users(id) on delete cascade,
  account_id uuid not null references mail_accounts(id) on delete cascade,
  message_id text not null,
  internet_message_id text,
  sender_name text,
  sender_email text,
  subject text,
  preview text,
  detected_code text,
  detected_type text,
  score integer not null default 0,
  received_at timestamptz,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  unique(account_id, message_id)
);

create index if not exists idx_processed_owner_account on processed_messages(owner_user_id, account_id, created_at desc);
create index if not exists idx_processed_received on processed_messages(account_id, received_at desc);

create table if not exists check_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references bot_users(id) on delete cascade,
  account_id uuid not null references mail_accounts(id) on delete cascade,
  event_type text not null default 'manual_check',
  created_at timestamptz not null default now()
);

create index if not exists idx_check_events_user_created on check_events(owner_user_id, created_at desc);
create index if not exists idx_check_events_account_created on check_events(account_id, created_at desc);

create table if not exists telegram_message_logs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references bot_users(id) on delete set null,
  chat_id bigint not null,
  message_id bigint not null,
  direction text not null check (direction in ('bot', 'user')),
  purpose text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(chat_id, message_id)
);

create index if not exists idx_telegram_logs_chat_created on telegram_message_logs(chat_id, created_at desc) where deleted_at is null;

create table if not exists bot_logs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references bot_users(id) on delete set null,
  account_id uuid references mail_accounts(id) on delete set null,
  level text not null default 'info',
  action text not null,
  message text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bot_logs_created on bot_logs(created_at desc);

create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references bot_users(id) on delete cascade,
  body text not null,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bot_users_updated_at on bot_users;
create trigger trg_bot_users_updated_at
before update on bot_users
for each row execute function set_updated_at();

drop trigger if exists trg_mail_accounts_updated_at on mail_accounts;
create trigger trg_mail_accounts_updated_at
before update on mail_accounts
for each row execute function set_updated_at();

-- RLS is intentionally not enabled because this bot only uses SUPABASE_SERVICE_ROLE_KEY server-side.
-- Never expose SUPABASE_SERVICE_ROLE_KEY in browser/client code or public GitHub files.
