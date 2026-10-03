begin;
do $$
declare
  owner uuid := gen_random_uuid(); other_owner uuid := gen_random_uuid();
  p1 uuid; p2 uuid; p3 uuid; b1 uuid; b2 uuid; replacement uuid;
  details jsonb := '{"businessName":"Business one","address":"123 Road","phone":"9876543210","logoUrl":"https://example.com/one.png","nextBillNumber":18}';
  payload jsonb := '{"billDate":"2026-10-03","customerName":"Customer","fatherName":"Father","address":"123 Road","phone":"9876543210","items":[{"particulars":"Ring","grams":1,"assessedValue":100,"loanAmount":80}]}';
begin
  insert into auth.users(id) values (owner), (other_owner);
  p1 := (public.save_business_profile(owner, details)->>'id')::uuid;
  p2 := (public.save_business_profile(owner, details || '{"accountSlot":2,"businessName":"Business two","address":"456 Lane","phone":"9876543211","logoUrl":"https://example.com/two.png","nextBillNumber":1}'::jsonb)->>'id')::uuid;
  p3 := (public.save_business_profile(owner, details || '{"accountSlot":3}'::jsonb)->>'id')::uuid;
  if p1 = p2 or p2 = p3 then raise exception 'Accounts must have distinct stable profiles'; end if;
  begin
    perform public.save_business_profile(owner, details || '{"accountSlot":4}'::jsonb);
    raise exception 'Fourth account accepted';
  exception when check_violation then null;
  end;
  b1 := (public.create_bill(owner, payload)->>'id')::uuid;
  b2 := (public.create_bill(owner, payload || '{"accountSlot":2}'::jsonb)->>'id')::uuid;
  if not exists (select 1 from public.bills where id = b1 and profile_id = p1 and bill_number = 18)
    or not exists (select 1 from public.bills where id = b2 and profile_id = p2 and bill_number = 1
    and business_snapshot->>'business_name' = 'Business two' and business_snapshot->>'address' = '456 Lane'
    and business_snapshot->>'phone' = '9876543211' and business_snapshot->>'logo_url' = 'https://example.com/two.png') then
    raise exception 'Issuance leaked account counters or printed details';
  end if;
  perform public.save_business_profile(owner, details || '{"accountSlot":2,"nextBillNumber":99}'::jsonb);
  if (select next_bill_number from public.business_profiles where id = p2) != 2 then
    raise exception 'Profile save rewound account counter';
  end if;
  begin
    perform public.replace_bill(owner, b2, payload || '{"accountSlot":1}'::jsonb);
    raise exception 'Cross-account replacement accepted';
  exception when raise_exception then
    if sqlerrm <> 'A replacement must remain in the original account' then raise; end if;
  end;
  begin
    perform public.replace_bill(other_owner, b2, payload);
    raise exception 'Cross-owner replacement accepted';
  exception when raise_exception then
    if sqlerrm <> 'Original bill not found' then raise; end if;
  end;
  replacement := (public.replace_bill(owner, b2, payload)->>'id')::uuid;
  if not exists (select 1 from public.bills where id = replacement and profile_id = p2 and bill_number = 2 and replacement_for_id = b2)
    or (select status from public.bills where id = b2) <> 'void'
    or (select next_bill_number from public.business_profiles where id = p1) <> 19
    or (select next_bill_number from public.business_profiles where id = p3) <> 18 then
    raise exception 'Replacement changed another ledger or lost its link';
  end if;
  if (select business_snapshot->>'business_name' from public.bills where id = b2) <> 'Business two' then
    raise exception 'Profile edit changed historical printed details';
  end if;
  if has_function_privilege('authenticated', 'public.create_bill(uuid,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.save_business_profile(uuid,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.replace_bill(uuid,uuid,jsonb)', 'execute') then
    raise exception 'Untrusted clients can mutate ledgers';
  end if;
  perform set_config('billing_test.owner', owner::text, true);
end;
$$;
select set_config('request.jwt.claim.sub', current_setting('billing_test.owner'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('billing_test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.business_profiles) <> 3 or (select count(*) from public.bills) <> 3 then
    raise exception 'Owner RLS does not expose exactly its three ledgers';
  end if;
end;
$$;
reset role;
rollback;
