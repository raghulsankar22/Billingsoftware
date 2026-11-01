-- Infrastructure for offline synchronization. No public API is exposed here;
-- authenticated endpoints must verify user and device ownership before use.
begin;

create schema if not exists billing_sync_private;
revoke all on schema billing_sync_private from public, anon, authenticated;

-- Required for composite foreign keys that enforce account ownership.
create unique index if not exists business_profiles_id_owner_sync_key
  on public.business_profiles (id, owner_id);

create table billing_sync_private.devices (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 120),
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, owner_id)
);

-- An issuer epoch is never automatically reassigned because an unreachable
-- device may still be issuing physical bills offline.
create table billing_sync_private.account_issuers (
  profile_id uuid primary key,
  owner_id uuid not null,
  mode text not null check (mode in ('assigned', 'online', 'review')),
  device_id uuid,
  epoch bigint not null check (epoch >= 0),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, owner_id) references public.business_profiles(id, owner_id),
  foreign key (device_id, owner_id) references billing_sync_private.devices(id, owner_id),
  check ((mode = 'online' and device_id is null) or (mode in ('assigned', 'review') and device_id is not null))
);

-- Store operation identity and outcome atomically with the eventual bill
-- change so a retry after a lost response cannot apply the change twice.
create table billing_sync_private.operation_receipts (
  operation_id uuid primary key,
  profile_id uuid not null,
  owner_id uuid not null,
  device_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('accepted', 'needs_review')),
  created_at timestamptz not null default now(),
  foreign key (profile_id, owner_id) references public.business_profiles(id, owner_id),
  foreign key (device_id, owner_id) references billing_sync_private.devices(id, owner_id)
);

-- Replaced values and deletion tombstones are retained for manual recovery.
create table billing_sync_private.change_history (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  owner_id uuid not null,
  entity_type text not null check (entity_type in ('bill', 'delivery', 'customer', 'profile')),
  entity_id uuid not null,
  operation_id uuid not null references billing_sync_private.operation_receipts(operation_id),
  changed_at timestamptz not null,
  deleted boolean not null default false,
  snapshot jsonb,
  foreign key (profile_id, owner_id) references public.business_profiles(id, owner_id),
  unique (operation_id, entity_type, entity_id)
);

alter table billing_sync_private.devices enable row level security;
alter table billing_sync_private.account_issuers enable row level security;
alter table billing_sync_private.operation_receipts enable row level security;
alter table billing_sync_private.change_history enable row level security;
revoke all on all tables in schema billing_sync_private from public, anon, authenticated;
revoke all on all sequences in schema billing_sync_private from public, anon, authenticated;
grant usage on schema billing_sync_private to service_role;
grant all on all tables in schema billing_sync_private to service_role;
grant all on all sequences in schema billing_sync_private to service_role;

commit;
