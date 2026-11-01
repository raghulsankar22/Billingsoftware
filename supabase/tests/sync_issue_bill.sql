begin;
do $$
declare owner_id uuid := gen_random_uuid(); other_owner uuid := gen_random_uuid();
begin
  insert into auth.users(id) values(owner_id),(other_owner);
  insert into public.billing_user_access(user_id,enabled) values(owner_id,true),(other_owner,true);
  perform set_config('billing_test.owner',owner_id::text,true);
  perform set_config('billing_test.other',other_owner::text,true);
  if has_function_privilege('anon','public.sync_issue_bill(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb)','execute')
    or has_function_privilege('authenticated','public.sync_issue_bill(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb)','execute')
    or has_function_privilege('authenticated','public.sync_issue_bill_v2(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb,timestamptz)','execute')
    or has_function_privilege('authenticated','public.sync_issue_bill_v3(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb,timestamptz)','execute') then
    raise exception 'Untrusted client can issue a synced bill';
  end if;
end;
$$;
set local role service_role;
do $$
<<sync_test>>
declare owner_id uuid := current_setting('billing_test.owner')::uuid; other_owner uuid := current_setting('billing_test.other')::uuid; profile_id uuid; second_profile uuid; other_profile uuid; canonical_customer uuid := gen_random_uuid(); alias_customer uuid := gen_random_uuid(); other_customer uuid := gen_random_uuid(); first_device uuid := gen_random_uuid(); second_device uuid := gen_random_uuid();
  bill_id uuid := gen_random_uuid(); operation_id uuid := gen_random_uuid(); later_operation uuid := gen_random_uuid(); payload jsonb; result jsonb; v2_result jsonb;
begin
  profile_id := (public.save_cloud_business_profile(owner_id,'{"businessName":"Test","address":"Test Road","phone":"1234567890"}'::jsonb)->>'id')::uuid;
  second_profile := (public.save_cloud_business_profile(owner_id,'{"businessName":"Test","address":"Test Road","phone":"1234567890","accountSlot":2}'::jsonb)->>'id')::uuid;
  other_profile := (public.save_cloud_business_profile(other_owner,'{"businessName":"Test","address":"Test Road","phone":"1234567890"}'::jsonb)->>'id')::uuid;
  insert into public.customers(id,owner_id,profile_id,canonical_id,customer_number,name) values
    (canonical_customer,owner_id,profile_id,canonical_customer,1,'Test'),
    (alias_customer,owner_id,second_profile,canonical_customer,2,'Test'),
    (other_customer,other_owner,other_profile,other_customer,1,'Test');
  perform public.register_cloud_device(owner_id,first_device,'First',repeat('a',64));
  perform public.register_cloud_device(owner_id,second_device,'Second',repeat('b',64));
  perform public.assign_offline_issuer(owner_id,profile_id,first_device,repeat('a',64));
  payload := jsonb_build_object('billDate','2026-10-30','customerName','Test Customer','fatherName','Test Parent','address','Test address','phone','','customerId',alias_customer,
    'businessSnapshot',jsonb_build_object('business_name','Test','address','Test Road','phone','1234567890'),
    'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'metal','Gold','particulars','Ring 1','grams',2,'assessedValue',11000,'loanAmount',10000)));
  result := public.sync_issue_bill(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('f',64),bill_id,1,payload);
  if result->>'billId' <> bill_id::text or (result->>'billNumber')::integer <> 1 then raise exception 'Incorrect issued bill result'; end if;
  if not exists(select 1 from public.bills b where b.id=sync_test.bill_id and b.profile_id=sync_test.profile_id and b.bill_number=1 and b.total_loan_amount=10000 and b.customer_code='C000001')
    or not exists(select 1 from public.bill_items i where i.bill_id=sync_test.bill_id and i.metal='Gold' and i.loan_amount=10000) then raise exception 'Bill or item was not saved'; end if;
  if public.sync_issue_bill(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('f',64),bill_id,1,payload) <> result
    or (select next_bill_number from public.business_profiles where id=profile_id) <> 2 then raise exception 'Retry changed a bill or counter'; end if;
  v2_result := public.sync_issue_bill_v2(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('f',64),bill_id,1,payload,'2026-10-30T09:00:00Z');
  if v2_result <> result
    or not exists(select 1 from billing_sync_private.entity_heads h where h.profile_id=sync_test.profile_id and h.entity_id=sync_test.bill_id and h.operation_id=sync_test.operation_id and h.occurred_at='2026-10-30T09:00:00Z') then
    raise exception 'Creation did not record a sync head';
  end if;
  perform public.sync_issue_bill_v3(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('f',64),bill_id,1,payload,'2026-10-30T09:00:00Z');
  if not exists(select 1 from billing_sync_private.bill_revisions r where r.operation_id=sync_test.operation_id and r.resulting_snapshot->'bill'->>'customer_name'='Test Customer') then
    raise exception 'Creation did not preserve its initial history';
  end if;
  update public.bills set customer_name='Later edit' where id=sync_test.bill_id;
  perform public.sync_issue_bill_v3(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('f',64),bill_id,1,payload,'2026-10-30T09:00:00Z');
  if not exists(select 1 from billing_sync_private.bill_revisions r where r.operation_id=sync_test.operation_id and r.resulting_snapshot->'bill'->>'customer_name'='Test Customer') then
    raise exception 'A retry changed the original history';
  end if;
  insert into billing_sync_private.operation_receipts(operation_id,profile_id,owner_id,device_id,payload_hash,outcome)
    values(later_operation,profile_id,owner_id,first_device,repeat('9',64),'accepted');
  update billing_sync_private.entity_heads set operation_id=later_operation,occurred_at='2026-10-31T09:00:00Z' where entity_id=sync_test.bill_id;
  perform public.sync_issue_bill_v2(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('f',64),bill_id,1,payload,'2026-10-30T09:00:00Z');
  if not exists(select 1 from billing_sync_private.entity_heads h where h.entity_id=sync_test.bill_id and h.operation_id=sync_test.later_operation) then
    raise exception 'A creation retry rewound a later change';
  end if;
  begin
    perform public.sync_issue_bill(owner_id,profile_id,first_device,repeat('a',64),1,operation_id,repeat('e',64),bill_id,1,payload);
    raise exception 'A different payload reused an operation ID';
  exception when raise_exception then if sqlerrm <> 'Sync operation does not match its receipt' then raise; end if; end;
  begin
    perform public.sync_issue_bill(owner_id,profile_id,second_device,repeat('b',64),1,gen_random_uuid(),repeat('d',64),gen_random_uuid(),2,payload);
    raise exception 'Another device issued a reserved number';
  exception when raise_exception then if sqlerrm <> 'Offline permission changed; manual review is required' then raise; end if; end;
  begin
    perform public.sync_issue_bill(owner_id,profile_id,first_device,repeat('a',64),0,gen_random_uuid(),repeat('d',64),gen_random_uuid(),2,payload);
    raise exception 'A stale issuer epoch was accepted';
  exception when raise_exception then if sqlerrm <> 'Offline permission changed; manual review is required' then raise; end if; end;
  begin
    perform public.sync_issue_bill(owner_id,profile_id,first_device,repeat('a',64),1,gen_random_uuid(),repeat('d',64),gen_random_uuid(),2,payload || '{"items":[]}'::jsonb);
    raise exception 'A bill without items was accepted';
  exception when raise_exception then if sqlerrm <> 'Invalid bill details' then raise; end if; end;
  begin
    perform public.sync_issue_bill(owner_id,profile_id,first_device,repeat('a',64),1,gen_random_uuid(),repeat('d',64),gen_random_uuid(),2,payload || jsonb_build_object('customerId',other_customer));
    raise exception 'Another user''s customer was linked';
  exception when raise_exception then if sqlerrm <> 'Customer must belong to the business account owner' then raise; end if; end;
  if (select next_bill_number from public.business_profiles where id=profile_id) <> 2
    or (select count(*) from public.bills b where b.profile_id=sync_test.profile_id) <> 1 then raise exception 'A failed operation changed the ledger'; end if;
end;
$$;
reset role;
rollback;
