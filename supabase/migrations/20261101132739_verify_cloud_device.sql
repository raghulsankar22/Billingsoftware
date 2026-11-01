begin;

-- The application server first verifies the user session, then provides that
-- user's ID and a hash of the device secret. No device metadata is exposed.
create function public.verify_cloud_device(p_owner_id uuid, p_device_id uuid, p_token_hash text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(p_token_hash ~ '^[0-9a-f]{64}$', false) and exists (
    select 1 from billing_sync_private.devices d
    join public.billing_user_access a on a.user_id = d.owner_id
    where d.id = p_device_id and d.owner_id = p_owner_id and d.token_hash = p_token_hash
      and d.revoked_at is null and a.enabled
  );
$$;
revoke all on function public.verify_cloud_device(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.verify_cloud_device(uuid,uuid,text) to service_role;

commit;
