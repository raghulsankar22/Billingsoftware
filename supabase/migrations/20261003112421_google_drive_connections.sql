create table public.google_drive_connections (
  profile_id uuid primary key references public.business_profiles(id) on delete cascade,
  refresh_token_encrypted text not null,
  workbook_file_id text,
  workbook_name text not null default 'Finance Billing Register.xlsx',
  sync_lease uuid,
  sync_lease_until timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_drive_connections enable row level security;
revoke all on public.google_drive_connections from anon, authenticated;
grant all on public.google_drive_connections to service_role;

create function public.acquire_drive_sync(p_profile_id uuid, p_lease uuid)
returns boolean language sql security invoker set search_path = '' as $$
  with claimed as (
    update public.google_drive_connections
    set sync_lease = p_lease, sync_lease_until = now() + interval '5 minutes'
    where profile_id = p_profile_id and (sync_lease_until is null or sync_lease_until < now())
    returning profile_id
  ) select exists(select 1 from claimed);
$$;
create function public.release_drive_sync(p_profile_id uuid, p_lease uuid)
returns void language sql security invoker set search_path = '' as $$
  update public.google_drive_connections set sync_lease = null, sync_lease_until = null
  where profile_id = p_profile_id and sync_lease = p_lease;
$$;
revoke all on function public.acquire_drive_sync(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_drive_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_drive_sync(uuid, uuid) to service_role;
grant execute on function public.release_drive_sync(uuid, uuid) to service_role;
