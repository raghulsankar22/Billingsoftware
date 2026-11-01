begin;
-- A device persists its own secret before registering. Repeating the identical
-- request after a lost response returns the original registration.
create or replace function public.register_cloud_device(p_owner_id uuid, p_device_id uuid, p_name text, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved billing_sync_private.devices;
  device_name text := btrim(p_name);
begin
  perform 1 from public.billing_user_access a where a.user_id = p_owner_id and a.enabled for share;
  if not found then raise exception 'User is not approved for billing'; end if;
  if p_device_id is null or device_name is null or char_length(device_name) not between 1 and 120
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Device registration details are invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-device:' || p_owner_id::text, 0));
  select * into saved from billing_sync_private.devices d where d.id = p_device_id;
  if found then
    if saved.owner_id <> p_owner_id or saved.revoked_at is not null or saved.name <> device_name or saved.token_hash <> p_token_hash then
      raise exception 'Device registration does not match';
    end if;
    return jsonb_build_object('id',saved.id,'name',saved.name,'registeredAt',saved.registered_at);
  end if;
  if (select count(*) from billing_sync_private.devices d where d.owner_id = p_owner_id and d.revoked_at is null) >= 20 then
    raise exception 'Device limit reached';
  end if;
  insert into billing_sync_private.devices(id,owner_id,name,token_hash)
    values(p_device_id,p_owner_id,device_name,p_token_hash) returning * into saved;
  return jsonb_build_object('id',saved.id,'name',saved.name,'registeredAt',saved.registered_at);
end;
$$;
revoke all on function public.register_cloud_device(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.register_cloud_device(uuid,uuid,text,text) to service_role;
commit;
