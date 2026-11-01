begin;

alter table billing_sync_private.operation_receipts add column result jsonb;

-- Internal building block, not exposed to browsers. The server authenticates
-- the user and device, computes the canonical operation hash, and only then
-- calls this function. A receipt and the bill commit in one transaction.
create function public.sync_issue_bill(
  p_owner_id uuid, p_profile_id uuid, p_device_id uuid, p_token_hash text,
  p_epoch bigint, p_operation_id uuid, p_operation_hash text, p_bill_id uuid,
  p_bill_number integer, p_payload jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  profile public.business_profiles;
  issuer billing_sync_private.account_issuers;
  receipt billing_sync_private.operation_receipts;
  item jsonb;
  item_id uuid;
  item_grams numeric;
  item_assessed numeric;
  item_loan numeric;
  assessed_total numeric := 0;
  loan_total numeric := 0;
  position integer := 0;
  customer uuid;
begin
  if p_operation_id is null or p_bill_id is null or p_bill_number is null or p_bill_number < 1 or p_bill_number >= 2147483647
    or p_epoch is null or p_epoch < 0 or p_operation_hash is null or p_operation_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid sync operation';
  end if;
  if not public.verify_cloud_device(p_owner_id,p_device_id,p_token_hash) then raise exception 'Device authentication failed'; end if;
  select * into profile from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;

  select * into receipt from billing_sync_private.operation_receipts r where r.operation_id=p_operation_id;
  if found then
    if receipt.owner_id <> p_owner_id or receipt.profile_id <> p_profile_id or receipt.device_id <> p_device_id or receipt.payload_hash <> p_operation_hash or receipt.outcome <> 'accepted' then
      raise exception 'Sync operation does not match its receipt';
    end if;
    if receipt.result is null then raise exception 'Sync receipt is incomplete'; end if;
    return receipt.result;
  end if;

  insert into billing_sync_private.account_issuers(profile_id,owner_id,mode,device_id,epoch)
    values(p_profile_id,p_owner_id,'online',null,0) on conflict(profile_id) do nothing;
  select * into issuer from billing_sync_private.account_issuers where profile_id=p_profile_id for update;
  if issuer.owner_id <> p_owner_id or issuer.epoch <> p_epoch or issuer.mode='review'
    or (issuer.mode='assigned' and issuer.device_id <> p_device_id) then
    raise exception 'Offline permission changed; manual review is required';
  end if;
  if profile.next_bill_number <> p_bill_number then raise exception 'Bill number does not match the next account number'; end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'items') <> 'array'
    or jsonb_array_length(p_payload->'items') not between 1 and 30
    or jsonb_typeof(p_payload->'businessSnapshot') <> 'object'
    or char_length(btrim(coalesce(p_payload->>'customerName',''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload->>'fatherName',''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload->>'address',''))) not between 5 and 500
    or char_length(coalesce(p_payload->>'phone','')) > 20
    or char_length(coalesce(p_payload->>'governmentId','')) > 80 then
    raise exception 'Invalid bill details';
  end if;
  customer := nullif(p_payload->>'customerId','')::uuid;
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    item_id := nullif(item->>'id','')::uuid;
    item_grams := (item->>'grams')::numeric;
    item_assessed := (item->>'assessedValue')::numeric;
    item_loan := (item->>'loanAmount')::numeric;
    if item_id is null or item->>'metal' not in ('Gold','Silver') or item->>'metal' is null
      or char_length(btrim(coalesce(item->>'particulars',''))) not between 2 and 180
      or char_length(coalesce(item->>'remarks','')) > 180
      or item_grams is null or item_grams not between 0 and 100000 or item_grams <> round(item_grams,3)
      or item_assessed is null or item_assessed not between 0.01 and 100000000 or item_assessed <> round(item_assessed,2)
      or item_loan is null or item_loan not between 0.01 and 100000000 or item_loan <> round(item_loan,2) then
      raise exception 'Invalid bill item';
    end if;
    assessed_total := assessed_total + item_assessed;
    loan_total := loan_total + item_loan;
  end loop;

  insert into public.bills(id,profile_id,bill_number,bill_date,customer_id,customer_name,father_name,address,phone,government_id,total_assessed_value,total_loan_amount,status,business_snapshot,excel_sync_status)
  values(p_bill_id,p_profile_id,p_bill_number,(p_payload->>'billDate')::date,customer,btrim(p_payload->>'customerName'),btrim(p_payload->>'fatherName'),btrim(p_payload->>'address'),coalesce(p_payload->>'phone',''),nullif(p_payload->>'governmentId',''),assessed_total,loan_total,'issued',p_payload->'businessSnapshot','pending');
  for item in select * from jsonb_array_elements(p_payload->'items') loop
    insert into public.bill_items(id,bill_id,metal,particulars,remarks,grams,assessed_value,loan_amount,sort_order)
    values((item->>'id')::uuid,p_bill_id,item->>'metal',btrim(item->>'particulars'),nullif(item->>'remarks',''),(item->>'grams')::numeric,(item->>'assessedValue')::numeric,(item->>'loanAmount')::numeric,position);
    position := position + 1;
  end loop;
  update public.business_profiles set next_bill_number=next_bill_number+1,updated_at=now() where id=p_profile_id;
  insert into billing_sync_private.operation_receipts(operation_id,profile_id,owner_id,device_id,payload_hash,outcome,result)
    values(p_operation_id,p_profile_id,p_owner_id,p_device_id,p_operation_hash,'accepted',jsonb_build_object('operationId',p_operation_id,'billId',p_bill_id,'billNumber',p_bill_number));
  return jsonb_build_object('operationId',p_operation_id,'billId',p_bill_id,'billNumber',p_bill_number);
end;
$$;
revoke all on function public.sync_issue_bill(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb) from public, anon, authenticated;
grant execute on function public.sync_issue_bill(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb) to service_role;

commit;
