begin;
do $$
declare
  owner uuid := gen_random_uuid(); unapproved uuid := gen_random_uuid();
  first_account jsonb; second_account jsonb;
  profile jsonb := '{"businessName":"Test business","address":"Test address","phone":"1234567890","licenseNumber":"TEST"}'::jsonb;
begin
  insert into auth.users(id) values (owner), (unapproved);
  insert into public.billing_user_access(user_id,enabled) values (owner,true);
  first_account := public.create_business_account(owner,profile);
  second_account := public.create_business_account(owner,profile);
  if (first_account->>'account_slot')::integer <> 4 or (second_account->>'account_slot')::integer <> 5
    or (first_account->>'next_bill_number')::integer <> 1
    or (second_account->>'next_delivery_number')::integer <> 1
    or first_account->>'license_number' <> 'TEST' then
    raise exception 'Account allocation failed';
  end if;
  begin
    perform public.create_business_account(unapproved,profile);
    raise exception 'Unapproved account creation succeeded';
  exception when raise_exception then
    if sqlerrm <> 'User is not approved for billing' then raise; end if;
  end;
  if has_function_privilege('anon','public.create_business_account(uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.create_business_account(uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.create_business_account(uuid,jsonb)','execute') then
    raise exception 'Account creation function privileges are unsafe';
  end if;
end;
$$;
rollback;
