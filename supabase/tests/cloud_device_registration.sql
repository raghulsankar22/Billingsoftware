begin;
do $$
declare approved uuid := gen_random_uuid(); unapproved uuid := gen_random_uuid();
begin
  insert into auth.users(id) values (approved), (unapproved);
  insert into public.billing_user_access(user_id,enabled) values (approved,true);
  perform set_config('billing_test.approved',approved::text,true);
  perform set_config('billing_test.unapproved',unapproved::text,true);
  if has_function_privilege('anon','public.register_cloud_device(uuid,uuid,text,text)','execute')
    or has_function_privilege('authenticated','public.register_cloud_device(uuid,uuid,text,text)','execute')
    or not has_function_privilege('service_role','public.register_cloud_device(uuid,uuid,text,text)','execute')
    or has_function_privilege('anon','public.verify_cloud_device(uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.verify_cloud_device(uuid,uuid,text)','execute') then
    raise exception 'Device function privileges are unsafe';
  end if;
end;
$$;
set local role service_role;
do $$
declare owner uuid := current_setting('billing_test.approved')::uuid; device uuid := gen_random_uuid(); result jsonb;
begin
  result := public.register_cloud_device(owner,device,'  Test device  ',repeat('a',64));
  if result->>'id' <> device::text or result->>'name' <> 'Test device' or result ? 'token_hash' then
    raise exception 'Device registration returned incorrect details';
  end if;
  if not exists (select 1 from billing_sync_private.devices where id=device and owner_id=owner and token_hash=repeat('a',64)) then
    raise exception 'Hashed device secret was not saved';
  end if;
  if not public.verify_cloud_device(owner,device,repeat('a',64))
    or public.verify_cloud_device(owner,device,repeat('b',64))
    or public.verify_cloud_device(current_setting('billing_test.unapproved')::uuid,device,repeat('a',64)) then
    raise exception 'Device verification did not enforce owner and secret';
  end if;
  if public.register_cloud_device(owner,device,'Test device',repeat('a',64)) <> result
    or (select count(*) from billing_sync_private.devices where id=device) <> 1 then
    raise exception 'A repeated registration did not return the existing device';
  end if;
  begin
    perform public.register_cloud_device(owner,device,'Test device',repeat('c',64));
    raise exception 'A different secret was accepted for an existing device';
  exception when raise_exception then
    if sqlerrm <> 'Device registration does not match' then raise; end if;
  end;
  update billing_sync_private.devices set revoked_at=now() where id=device;
  if public.verify_cloud_device(owner,device,repeat('a',64)) then raise exception 'Revoked device was accepted'; end if;
  begin
    perform public.register_cloud_device(current_setting('billing_test.unapproved')::uuid,gen_random_uuid(),'test',repeat('b',64));
    raise exception 'Unapproved device registered';
  exception when raise_exception then
    if sqlerrm <> 'User is not approved for billing' then raise; end if;
  end;
end;
$$;
reset role;
rollback;
