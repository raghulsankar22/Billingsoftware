begin;

-- Only the authenticated server may call this function. The assigned mode
-- reserves both bill and delivery issuance for the same device until safely
-- released; disconnection alone never transfers a reservation.
create function public.assign_offline_issuer(p_owner_id uuid, p_profile_id uuid, p_device_id uuid, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_issuer billing_sync_private.account_issuers;
begin
  if not public.verify_cloud_device(p_owner_id,p_device_id,p_token_hash) then raise exception 'Device authentication failed'; end if;
  perform 1 from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  insert into billing_sync_private.account_issuers(profile_id,owner_id,mode,device_id,epoch)
    values(p_profile_id,p_owner_id,'online',null,0) on conflict(profile_id) do nothing;
  select * into current_issuer from billing_sync_private.account_issuers where profile_id=p_profile_id for update;
  if current_issuer.owner_id <> p_owner_id then raise exception 'Business account not found'; end if;
  if current_issuer.mode = 'assigned' and current_issuer.device_id = p_device_id then
    return jsonb_build_object('profileId',current_issuer.profile_id,'mode',current_issuer.mode,'deviceId',current_issuer.device_id,'epoch',current_issuer.epoch);
  end if;
  if current_issuer.mode <> 'online' then raise exception 'Account is reserved or requires manual review'; end if;
  update billing_sync_private.account_issuers set mode='assigned',device_id=p_device_id,epoch=epoch+1,updated_at=now()
    where profile_id=p_profile_id returning * into current_issuer;
  return jsonb_build_object('profileId',current_issuer.profile_id,'mode',current_issuer.mode,'deviceId',current_issuer.device_id,'epoch',current_issuer.epoch);
end;
$$;
revoke all on function public.assign_offline_issuer(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.assign_offline_issuer(uuid,uuid,uuid,text) to service_role;

commit;
