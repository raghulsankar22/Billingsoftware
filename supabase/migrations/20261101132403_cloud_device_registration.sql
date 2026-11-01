begin;

-- Device secrets never leave the server in plaintext after registration.
alter table billing_sync_private.devices add column token_hash text not null
  check (token_hash ~ '^[0-9a-f]{64}$');
alter table billing_sync_private.devices add constraint devices_token_hash_key unique (token_hash);

create function public.register_cloud_device(p_owner_id uuid, p_device_id uuid, p_name text, p_token_hash text)
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
