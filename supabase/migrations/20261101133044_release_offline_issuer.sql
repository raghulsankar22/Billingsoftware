begin;

-- A release receipt is retained so a lost response can be retried without
-- incrementing the issuer epoch twice.
create table billing_sync_private.issuer_releases (
  id uuid primary key,
  profile_id uuid not null,
  owner_id uuid not null,
  device_id uuid not null,
  prior_epoch bigint not null check (prior_epoch >= 0),
  released_epoch bigint not null check (released_epoch = prior_epoch + 1),
  created_at timestamptz not null default now(),
  foreign key (profile_id, owner_id) references public.business_profiles(id, owner_id),
  foreign key (device_id, owner_id) references billing_sync_private.devices(id, owner_id),
  unique (profile_id, prior_epoch)
);
alter table billing_sync_private.issuer_releases enable row level security;
revoke all on billing_sync_private.issuer_releases from public, anon, authenticated;
grant all on billing_sync_private.issuer_releases to service_role;

-- This is server-only infrastructure. Call only after the device has durably
-- stopped issuing numbers and its pending changes have been acknowledged.
create function public.release_offline_issuer(p_owner_id uuid, p_profile_id uuid, p_device_id uuid, p_token_hash text, p_epoch bigint, p_release_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  current_issuer billing_sync_private.account_issuers;
  receipt billing_sync_private.issuer_releases;
begin
  if p_release_id is null or p_epoch is null or p_epoch < 0 or p_epoch >= 9007199254740991 then raise exception 'Invalid issuer release'; end if;
  if not public.verify_cloud_device(p_owner_id,p_device_id,p_token_hash) then raise exception 'Device authentication failed'; end if;
  perform 1 from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  select * into receipt from billing_sync_private.issuer_releases r where r.id=p_release_id;
  if found then
    if receipt.owner_id <> p_owner_id or receipt.profile_id <> p_profile_id or receipt.device_id <> p_device_id or receipt.prior_epoch <> p_epoch then
      raise exception 'Issuer release does not match';
    end if;
    return jsonb_build_object('profileId',receipt.profile_id,'releasedEpoch',receipt.released_epoch);
  end if;
  select * into current_issuer from billing_sync_private.account_issuers where profile_id=p_profile_id for update;
  if not found or current_issuer.owner_id <> p_owner_id or current_issuer.mode <> 'assigned'
    or current_issuer.device_id <> p_device_id or current_issuer.epoch <> p_epoch then
    raise exception 'Offline permission does not match this device';
  end if;
  update billing_sync_private.account_issuers set mode='online',device_id=null,epoch=epoch+1,updated_at=now()
    where profile_id=p_profile_id returning * into current_issuer;
  insert into billing_sync_private.issuer_releases(id,profile_id,owner_id,device_id,prior_epoch,released_epoch)
    values(p_release_id,p_profile_id,p_owner_id,p_device_id,p_epoch,current_issuer.epoch);
  return jsonb_build_object('profileId',p_profile_id,'releasedEpoch',current_issuer.epoch);
end;
$$;
revoke all on function public.release_offline_issuer(uuid,uuid,uuid,text,bigint,uuid) from public, anon, authenticated;
grant execute on function public.release_offline_issuer(uuid,uuid,uuid,text,bigint,uuid) to service_role;

commit;
