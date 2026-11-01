begin;
do $$
declare approved uuid := gen_random_uuid(); other_owner uuid := gen_random_uuid();
begin
  insert into auth.users(id) values (approved), (other_owner);
  insert into public.billing_user_access(user_id,enabled) values (approved,true),(other_owner,true);
  perform set_config('billing_test.approved',approved::text,true);
  perform set_config('billing_test.other',other_owner::text,true);
  if has_function_privilege('anon','public.assign_offline_issuer(uuid,uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.assign_offline_issuer(uuid,uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.assign_offline_issuer_v2(uuid,uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.release_offline_issuer(uuid,uuid,uuid,text,bigint,uuid)','execute') then
    raise exception 'Untrusted client can assign an issuer';
  end if;
end;
$$;
set local role service_role;
do $$
declare owner uuid := current_setting('billing_test.approved')::uuid; other_owner uuid := current_setting('billing_test.other')::uuid;
  profile uuid; first_device uuid := gen_random_uuid(); second_device uuid := gen_random_uuid(); release_id uuid := gen_random_uuid(); claim jsonb; released jsonb;
begin
  profile := (public.save_cloud_business_profile(owner,'{"businessName":"Test","address":"Test Road","phone":"1234567890","accountSlot":1}'::jsonb)->>'id')::uuid;
  perform public.register_cloud_device(owner,first_device,'First',repeat('a',64));
  perform public.register_cloud_device(owner,second_device,'Second',repeat('b',64));
  claim := public.assign_offline_issuer_v2(owner,profile,first_device,repeat('a',64));
  if claim->>'deviceId' <> first_device::text or (claim->>'epoch')::integer <> 1 or claim->>'mode' <> 'assigned'
    or (claim->>'nextBillNumber')::integer <> 1 or (claim->>'nextDeliveryNumber')::integer <> 1 then
    raise exception 'Incorrect offline designation';
  end if;
  if public.assign_offline_issuer_v2(owner,profile,first_device,repeat('a',64)) <> claim then
    raise exception 'Retry changed an existing designation';
  end if;
  begin
    perform public.assign_offline_issuer(owner,profile,second_device,repeat('b',64));
    raise exception 'Second device took the offline designation';
  exception when raise_exception then
    if sqlerrm <> 'Account is reserved or requires manual review' then raise; end if;
  end;
  begin
    perform public.assign_offline_issuer(other_owner,profile,first_device,repeat('a',64));
    raise exception 'Another owner claimed this account';
  exception when raise_exception then
    if sqlerrm <> 'Device authentication failed' then raise; end if;
  end;
  released := public.release_offline_issuer(owner,profile,first_device,repeat('a',64),1,release_id);
  if (released->>'releasedEpoch')::integer <> 2 then raise exception 'Incorrect release epoch'; end if;
  if public.release_offline_issuer(owner,profile,first_device,repeat('a',64),1,release_id) <> released then
    raise exception 'Retry changed the release result';
  end if;
  claim := public.assign_offline_issuer(owner,profile,second_device,repeat('b',64));
  if (claim->>'epoch')::integer <> 3 or claim->>'deviceId' <> second_device::text then
    raise exception 'Second device did not receive a new issuer epoch';
  end if;
  if public.release_offline_issuer(owner,profile,first_device,repeat('a',64),1,release_id) <> released then
    raise exception 'A delayed retry changed the release result';
  end if;
  begin
    perform public.release_offline_issuer(owner,profile,first_device,repeat('a',64),1,gen_random_uuid());
    raise exception 'Old device released a newer assignment';
  exception when raise_exception then
    if sqlerrm <> 'Offline permission does not match this device' then raise; end if;
  end;
end;
$$;
reset role;
rollback;
