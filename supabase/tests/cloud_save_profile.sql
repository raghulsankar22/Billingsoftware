begin;
do $$
declare
  owner uuid := gen_random_uuid(); unapproved uuid := gen_random_uuid();
  saved jsonb; saved_id uuid;
  details jsonb := '{"accountSlot":4,"businessName":"Test Finance","address":"Test Road 1","phone":"1234567890","licenseNumber":"LIC-4","nextBillNumber":99}'::jsonb;
begin
  insert into auth.users(id) values (owner), (unapproved);
  insert into public.billing_user_access(user_id,enabled) values (owner,true);
  saved := public.save_cloud_business_profile(owner,details);
  saved_id := (saved->>'id')::uuid;
  if (saved->>'account_slot')::integer <> 4 or (saved->>'next_bill_number')::integer <> 1 or saved->>'license_number' <> 'LIC-4' then
    raise exception 'Initial profile, license or bill numbering is incorrect';
  end if;
  update public.business_profiles set next_bill_number=23 where id=saved_id;
  saved := public.save_cloud_business_profile(owner,details - 'licenseNumber');
  if (saved->>'next_bill_number')::integer <> 23 or saved->>'license_number' <> 'LIC-4' then
    raise exception 'Saving a profile changed its counter or existing license';
  end if;
  saved := public.save_cloud_business_profile(owner,details || '{"licenseNumber":""}'::jsonb);
  if saved->>'license_number' is not null then raise exception 'License could not be cleared'; end if;
  begin
    perform public.save_cloud_business_profile(unapproved,details);
    raise exception 'Unapproved user saved a profile';
  exception when raise_exception then
    if sqlerrm <> 'User is not approved for billing' then raise; end if;
  end;
  if has_function_privilege('anon','public.save_cloud_business_profile(uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.save_cloud_business_profile(uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.save_cloud_business_profile(uuid,jsonb)','execute') then
    raise exception 'Profile function privileges are unsafe';
  end if;
end;
$$;
rollback;
