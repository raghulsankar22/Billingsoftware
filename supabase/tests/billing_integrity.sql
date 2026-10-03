-- Run against a migrated disposable Supabase/PostgreSQL database as an administrator.
-- Fixtures and all test mutations are rolled back.
begin;

do $$
<<billing_integrity>>
declare
  owner_id uuid := gen_random_uuid();
  other_owner_id uuid := gen_random_uuid();
  profile_id uuid;
  bill_id uuid;
  payload jsonb := '{"billDate":"2026-10-03","customerName":"Customer","fatherName":"Father","address":"123 Road","phone":"9876543210","totalAssessedValue":999,"totalLoanAmount":999,"items":[{"particulars":"Ring","grams":1.234,"assessedValue":100,"loanAmount":80,"sortOrder":99}]}'::jsonb;
begin
  insert into auth.users(id) values (owner_id), (other_owner_id);
  perform set_config('billing_test.owner', owner_id::text, true);
  perform set_config('billing_test.other_owner', other_owner_id::text, true);
  profile_id := (public.save_business_profile(owner_id, '{"businessName":"Original business","address":"123 Road","phone":"9876543210","nextBillNumber":18}'::jsonb)->>'id')::uuid;
  perform public.save_business_profile(other_owner_id, '{"businessName":"Other business","address":"456 Road","phone":"9876543211"}'::jsonb);
  bill_id := (public.create_bill(owner_id, payload)->>'id')::uuid;
  if not exists (select 1 from public.bills where id = bill_id and bill_number = 18 and total_loan_amount = 80 and total_assessed_value = 100) then
    raise exception 'Issued totals must come from actual pledge items';
  end if;
  if not exists (select 1 from public.bill_items i where i.bill_id = billing_integrity.bill_id and sort_order = 0) then
    raise exception 'Item order must come from array position';
  end if;
  perform public.save_business_profile(owner_id, '{"businessName":"Updated business","address":"123 Road","phone":"9876543210","nextBillNumber":1}'::jsonb);
  if (select next_bill_number from public.business_profiles where id = profile_id) != 19 then
    raise exception 'Stale profile saves must not reset the bill counter';
  end if;
  if (select business_snapshot->>'business_name' from public.bills where id = bill_id) != 'Original business' then
    raise exception 'Profile edits must not change the issued business snapshot';
  end if;
  begin
    perform public.create_bill(owner_id, jsonb_set(payload, '{billDate}', '"2026-02-30"'::jsonb));
    raise exception 'An impossible calendar date was accepted';
  exception when datetime_field_overflow then null;
  end;
  if (select next_bill_number from public.business_profiles where id = profile_id) != 19 then
    raise exception 'Failed issuance must roll back its number allocation';
  end if;
  if (select count(*) from public.bills b where b.profile_id = billing_integrity.profile_id) != 1 then
    raise exception 'Failed issuance left a partial bill';
  end if;
  perform public.create_bill(owner_id, payload);
  if (select array_agg(bill_number order by bill_number) from public.bills b where b.profile_id = billing_integrity.profile_id) != array[18, 19] then
    raise exception 'Successful issuance must be sequential';
  end if;
  if has_function_privilege('anon', 'public.create_bill(uuid,jsonb)', 'execute') or has_function_privilege('authenticated', 'public.create_bill(uuid,jsonb)', 'execute') then
    raise exception 'Untrusted clients can execute privileged issuance';
  end if;
  if has_function_privilege('anon', 'public.save_business_profile(uuid,jsonb)', 'execute') or has_function_privilege('authenticated', 'public.save_business_profile(uuid,jsonb)', 'execute') then
    raise exception 'Untrusted clients can execute privileged profile saves';
  end if;
  if not has_function_privilege('service_role', 'public.create_bill(uuid,jsonb)', 'execute') or not has_function_privilege('service_role', 'public.save_business_profile(uuid,jsonb)', 'execute') then
    raise exception 'The API server cannot execute its mutation RPCs';
  end if;
end;
$$ language plpgsql;

select set_config('request.jwt.claim.sub', current_setting('billing_test.owner'), true);
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('billing_test.owner'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare changed_rows integer;
begin
  if (select count(*) from public.business_profiles) != 1 or (select count(*) from public.bills) != 2 or (select count(*) from public.bill_items) != 2 then
    raise exception 'Owners cannot read their own rows or can read another owner''s rows';
  end if;
  update public.business_profiles set next_bill_number = 1;
  get diagnostics changed_rows = row_count;
  if changed_rows != 0 then raise exception 'Browser clients can rewind the counter directly'; end if;
  begin
    perform public.create_bill(current_setting('billing_test.other_owner')::uuid, '{}'::jsonb);
    raise exception 'Browser clients can invoke privileged issuance';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  if (select count(*) from public.business_profiles) != 0 or (select count(*) from public.bills) != 0 or (select count(*) from public.bill_items) != 0 then
    raise exception 'Anonymous clients can read billing data';
  end if;
end;
$$;
reset role;
rollback;
