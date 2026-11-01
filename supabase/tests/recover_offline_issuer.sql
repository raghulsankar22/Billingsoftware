begin;
do $$
declare owner_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid(); stranger_id uuid := gen_random_uuid();
begin
  insert into auth.users(id) values(owner_id),(admin_id),(stranger_id);
  insert into public.billing_user_access(user_id,administrator,enabled) values(owner_id,false,true),(admin_id,true,true),(stranger_id,false,true);
  perform set_config('billing_test.owner',owner_id::text,true);
  perform set_config('billing_test.admin',admin_id::text,true);
  perform set_config('billing_test.stranger',stranger_id::text,true);
  if has_function_privilege('anon','public.start_offline_issuer_recovery(uuid,uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.finish_offline_issuer_recovery(uuid,uuid,uuid,uuid,boolean)','execute') then
    raise exception 'Recovery functions are available to untrusted clients';
  end if;
end;
$$;
set local role service_role;
do $$
declare owner_id uuid := current_setting('billing_test.owner')::uuid; admin_id uuid := current_setting('billing_test.admin')::uuid; stranger_id uuid := current_setting('billing_test.stranger')::uuid;
  profile_id uuid; old_device uuid := gen_random_uuid(); replacement uuid := gen_random_uuid(); recovery_id uuid := gen_random_uuid(); started jsonb; completed jsonb;
begin
  profile_id := (public.save_cloud_business_profile(owner_id,'{"businessName":"Test","address":"Test Road","phone":"1234567890"}'::jsonb)->>'id')::uuid;
  perform public.register_cloud_device(owner_id,old_device,'Old',repeat('a',64));
  perform public.register_cloud_device(owner_id,replacement,'New',repeat('b',64));
  perform public.assign_offline_issuer(owner_id,profile_id,old_device,repeat('a',64));
  begin
    perform public.start_offline_issuer_recovery(stranger_id,owner_id,profile_id,replacement,recovery_id);
    raise exception 'Non-administrator started recovery';
  exception when raise_exception then
    if sqlerrm <> 'Administrator approval required' then raise; end if;
  end;
  started := public.start_offline_issuer_recovery(admin_id,owner_id,profile_id,replacement,recovery_id);
  if (started->>'epoch')::integer <> 2 or (started->>'resolved')::boolean then raise exception 'Recovery did not stop for review'; end if;
  if public.verify_cloud_device(owner_id,old_device,repeat('a',64)) then raise exception 'Lost device was not revoked'; end if;
  if public.start_offline_issuer_recovery(admin_id,owner_id,profile_id,replacement,recovery_id) <> started then raise exception 'Recovery retry changed state'; end if;
  begin
    perform public.assign_offline_issuer(owner_id,profile_id,replacement,repeat('b',64));
    raise exception 'Device claimed an account under review';
  exception when raise_exception then
    if sqlerrm <> 'Account is reserved or requires manual review' then raise; end if;
  end;
  begin
    perform public.finish_offline_issuer_recovery(admin_id,owner_id,profile_id,recovery_id,false);
    raise exception 'Recovery completed without review';
  exception when raise_exception then
    if sqlerrm <> 'Manual review must be confirmed' then raise; end if;
  end;
  completed := public.finish_offline_issuer_recovery(admin_id,owner_id,profile_id,recovery_id,true);
  if not (completed->>'resolved')::boolean or completed->>'deviceId' <> replacement::text or (completed->>'epoch')::integer <> 2 then
    raise exception 'Recovery did not assign the reviewed device';
  end if;
  if public.finish_offline_issuer_recovery(admin_id,owner_id,profile_id,recovery_id,true) <> completed then raise exception 'Recovery completion retry changed state'; end if;
end;
$$;
reset role;
rollback;
