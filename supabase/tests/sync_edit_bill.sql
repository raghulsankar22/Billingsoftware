begin;
do $$
declare owner_id uuid := gen_random_uuid();
begin
  insert into auth.users(id) values(owner_id);
  insert into public.billing_user_access(user_id,enabled) values(owner_id,true);
  perform set_config('billing_test.owner',owner_id::text,true);
  if has_function_privilege('anon','public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz)','execute')
    or has_function_privilege('authenticated','public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz)','execute') then
    raise exception 'Untrusted client can edit a synced bill';
  end if;
end;
$$;
set local role service_role;
do $$
<<edit_test>>
declare owner_id uuid := current_setting('billing_test.owner')::uuid; profile_id uuid; device_id uuid := gen_random_uuid(); bill_id uuid := gen_random_uuid();
  created uuid := gen_random_uuid(); delivery uuid := gen_random_uuid(); edit_id uuid := gen_random_uuid(); older_id uuid := gen_random_uuid(); review_id uuid := gen_random_uuid();
  payload jsonb; edited jsonb; result jsonb;
begin
  profile_id := (public.save_cloud_business_profile(owner_id,'{"businessName":"Test","address":"Test Road","phone":"1234567890"}'::jsonb)->>'id')::uuid;
  perform public.register_cloud_device(owner_id,device_id,'Device',repeat('a',64));
  perform public.assign_offline_issuer(owner_id,profile_id,device_id,repeat('a',64));
  payload := jsonb_build_object('billNumber',1,'billDate','2026-10-30','customerName','First Name','fatherName','Test Parent','address','Test address','phone','',
    'businessSnapshot',jsonb_build_object('business_name','Test','address','Test Road','phone','1234567890'),
    'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'metal','Gold','particulars','Ring 1','grams',2,'assessedValue',11000,'loanAmount',10000)));
  perform public.sync_issue_bill_v3(owner_id,profile_id,device_id,repeat('a',64),1,created,repeat('1',64),bill_id,1,payload,'2026-10-30T09:00:00Z');
  -- Simulate a delivery received from another device after the creation.
  update public.bills set delivery_no='5',delivery_date='2026-11-30',delivery_summary='{"principal":10000,"interest":200,"total":10200}'::jsonb where id=edit_test.bill_id;
  insert into billing_sync_private.operation_receipts(operation_id,profile_id,owner_id,device_id,payload_hash,outcome,result)
    values(delivery,profile_id,owner_id,device_id,repeat('2',64),'accepted','{}');
  insert into billing_sync_private.bill_revisions(profile_id,owner_id,bill_id,operation_id,base_operation_id,action,outcome,occurred_at,requested_change)
    values(profile_id,owner_id,bill_id,delivery,created,'delivery','applied','2026-11-30T10:00:00Z','{}');
  update billing_sync_private.entity_heads set operation_id=delivery,occurred_at='2026-11-30T10:00:00Z' where entity_id=edit_test.bill_id;
  edited := payload || jsonb_build_object('customerName','Latest Name');
  result := public.sync_edit_bill(owner_id,profile_id,device_id,repeat('a',64),edit_id,repeat('3',64),bill_id,created,edited,'2026-11-30T11:00:00Z');
  if result->>'outcome' <> 'applied' or not exists(select 1 from public.bills b where b.id=edit_test.bill_id and b.customer_name='Latest Name' and b.delivery_no='5' and b.delivery_date='2026-11-30' and b.delivery_summary->>'interest'='200') then
    raise exception 'A later edit did not preserve delivery';
  end if;
  if not exists(select 1 from billing_sync_private.bill_revisions r where r.operation_id=edit_id and r.prior_snapshot->'bill'->>'customer_name'='First Name' and r.resulting_snapshot->'bill'->>'customer_name'='Latest Name') then
    raise exception 'Edit did not preserve before and after history';
  end if;
  if public.sync_edit_bill(owner_id,profile_id,device_id,repeat('a',64),edit_id,repeat('3',64),bill_id,created,edited,'2026-11-30T11:00:00Z') <> result then raise exception 'Edit retry changed result'; end if;
  result := public.sync_edit_bill(owner_id,profile_id,device_id,repeat('a',64),older_id,repeat('4',64),bill_id,created,payload,'2026-11-30T09:00:00Z');
  if result->>'outcome' <> 'superseded' or (select customer_name from public.bills where id=edit_test.bill_id) <> 'Latest Name' then raise exception 'Older concurrent edit overwrote the latest change'; end if;
  update billing_sync_private.entity_heads set deleted=true where entity_id=edit_test.bill_id;
  result := public.sync_edit_bill(owner_id,profile_id,device_id,repeat('a',64),review_id,repeat('5',64),bill_id,created,edited,'2026-11-30T12:00:00Z');
  if result->>'outcome' <> 'needs_review' or not exists(select 1 from billing_sync_private.bill_revisions where operation_id=review_id and outcome='needs_review') then raise exception 'Edit to a deleted bill did not require review'; end if;
end;
$$;
reset role;
rollback;
