begin;

create table billing_sync_private.issuer_recoveries (
  id uuid primary key,
  profile_id uuid not null,
  owner_id uuid not null,
  initiated_by uuid not null references public.billing_user_access(user_id),
  old_device_id uuid not null,
  replacement_device_id uuid not null,
  prior_epoch bigint not null check (prior_epoch >= 0),
  recovery_epoch bigint not null check (recovery_epoch = prior_epoch + 1),
  resolved_by uuid references public.billing_user_access(user_id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (profile_id,owner_id) references public.business_profiles(id,owner_id),
  foreign key (old_device_id,owner_id) references billing_sync_private.devices(id,owner_id),
  foreign key (replacement_device_id,owner_id) references billing_sync_private.devices(id,owner_id),
  unique (profile_id,prior_epoch),
  check ((resolved_at is null and resolved_by is null) or (resolved_at is not null and resolved_by is not null))
);
create unique index issuer_recovery_open on billing_sync_private.issuer_recoveries(profile_id) where resolved_at is null;
alter table billing_sync_private.issuer_recoveries enable row level security;
revoke all on billing_sync_private.issuer_recoveries from public, anon, authenticated;
grant all on billing_sync_private.issuer_recoveries to service_role;

-- Only an enabled administrator may start recovery. The old device is revoked;
-- unsynced work from it must be examined manually, not silently discarded.
create function public.start_offline_issuer_recovery(p_actor_id uuid,p_owner_id uuid,p_profile_id uuid,p_replacement_device_id uuid,p_recovery_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_issuer billing_sync_private.account_issuers; recovery billing_sync_private.issuer_recoveries;
begin
  perform 1 from public.billing_user_access a where a.user_id=p_actor_id and a.enabled and a.administrator for share;
  if not found then raise exception 'Administrator approval required'; end if;
  perform 1 from public.billing_user_access a where a.user_id=p_owner_id and a.enabled for share;
  if not found then raise exception 'Business owner is not approved'; end if;
  if p_recovery_id is null or p_replacement_device_id is null then raise exception 'Invalid recovery request'; end if;
  perform 1 from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  select * into recovery from billing_sync_private.issuer_recoveries r where r.id=p_recovery_id;
  if found then
    if recovery.profile_id <> p_profile_id or recovery.owner_id <> p_owner_id or recovery.initiated_by <> p_actor_id or recovery.replacement_device_id <> p_replacement_device_id then raise exception 'Recovery request does not match'; end if;
    return jsonb_build_object('profileId',recovery.profile_id,'recoveryId',recovery.id,'epoch',recovery.recovery_epoch,'resolved',recovery.resolved_at is not null);
  end if;
  perform 1 from billing_sync_private.devices d where d.id=p_replacement_device_id and d.owner_id=p_owner_id and d.revoked_at is null for share;
  if not found then raise exception 'Replacement device not found'; end if;
  select * into current_issuer from billing_sync_private.account_issuers where profile_id=p_profile_id for update;
  if not found or current_issuer.owner_id <> p_owner_id or current_issuer.mode <> 'assigned'
    or current_issuer.device_id = p_replacement_device_id or current_issuer.epoch >= 9007199254740991 then
    raise exception 'Offline permission cannot be recovered for this device';
  end if;
  insert into billing_sync_private.issuer_recoveries(id,profile_id,owner_id,initiated_by,old_device_id,replacement_device_id,prior_epoch,recovery_epoch)
    values(p_recovery_id,p_profile_id,p_owner_id,p_actor_id,current_issuer.device_id,p_replacement_device_id,current_issuer.epoch,current_issuer.epoch+1)
    returning * into recovery;
  update billing_sync_private.devices set revoked_at=now() where id=current_issuer.device_id and owner_id=p_owner_id;
  update billing_sync_private.account_issuers set mode='review',device_id=p_replacement_device_id,epoch=recovery.recovery_epoch,updated_at=now() where profile_id=p_profile_id;
  return jsonb_build_object('profileId',recovery.profile_id,'recoveryId',recovery.id,'epoch',recovery.recovery_epoch,'resolved',false);
end;
$$;

-- Explicit acknowledgement is required after manual review of unsynced bills
-- and deliveries. This cannot itself establish what was on a missing device.
create function public.finish_offline_issuer_recovery(p_actor_id uuid,p_owner_id uuid,p_profile_id uuid,p_recovery_id uuid,p_review_confirmed boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_issuer billing_sync_private.account_issuers; recovery billing_sync_private.issuer_recoveries;
begin
  perform 1 from public.billing_user_access a where a.user_id=p_actor_id and a.enabled and a.administrator for share;
  if not found then raise exception 'Administrator approval required'; end if;
  if p_review_confirmed is distinct from true then raise exception 'Manual review must be confirmed'; end if;
  perform 1 from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  select * into recovery from billing_sync_private.issuer_recoveries r where r.id=p_recovery_id and r.profile_id=p_profile_id and r.owner_id=p_owner_id for update;
  if not found then raise exception 'Recovery request not found'; end if;
  if recovery.resolved_at is not null then
    return jsonb_build_object('profileId',recovery.profile_id,'recoveryId',recovery.id,'deviceId',recovery.replacement_device_id,'epoch',recovery.recovery_epoch,'resolved',true);
  end if;
  select * into current_issuer from billing_sync_private.account_issuers where profile_id=p_profile_id for update;
  if not found or current_issuer.mode <> 'review' or current_issuer.owner_id <> p_owner_id
    or current_issuer.device_id <> recovery.replacement_device_id or current_issuer.epoch <> recovery.recovery_epoch then
    raise exception 'Recovery state has changed';
  end if;
  perform 1 from billing_sync_private.devices d where d.id=recovery.replacement_device_id and d.owner_id=p_owner_id and d.revoked_at is null for share;
  if not found then raise exception 'Replacement device is no longer active'; end if;
  update billing_sync_private.account_issuers set mode='assigned',updated_at=now() where profile_id=p_profile_id;
  update billing_sync_private.issuer_recoveries set resolved_at=now(),resolved_by=p_actor_id where id=p_recovery_id;
  return jsonb_build_object('profileId',recovery.profile_id,'recoveryId',recovery.id,'deviceId',recovery.replacement_device_id,'epoch',recovery.recovery_epoch,'resolved',true);
end;
$$;

revoke all on function public.start_offline_issuer_recovery(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_offline_issuer_recovery(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.start_offline_issuer_recovery(uuid,uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.finish_offline_issuer_recovery(uuid,uuid,uuid,uuid,boolean) to service_role;

commit;
