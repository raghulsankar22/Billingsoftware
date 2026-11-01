begin;

-- Preserve the earlier version before applying an edit. Concurrent edits use
-- the user's chosen latest-device-time rule; delivery fields are never erased
-- by an edit. Deleted or void bills require review instead of resurrection.
create function public.sync_edit_bill(
  p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text,
  p_operation_id uuid,p_operation_hash text,p_bill_id uuid,p_base_operation_id uuid,
  p_payload jsonb,p_occurred_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  profile public.business_profiles;
  current_bill public.bills;
  head billing_sync_private.entity_heads;
  base_revision billing_sync_private.bill_revisions;
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
  prior jsonb;
  resulting jsonb;
  decision text;
  outcome jsonb;
begin
  if p_operation_id is null or p_bill_id is null or p_base_operation_id is null or p_occurred_at is null
    or p_operation_hash is null or p_operation_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid sync operation'; end if;
  if not public.verify_cloud_device(p_owner_id,p_device_id,p_token_hash) then raise exception 'Device authentication failed'; end if;
  select * into profile from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  select * into receipt from billing_sync_private.operation_receipts r where r.operation_id=p_operation_id;
  if found then
    if receipt.owner_id <> p_owner_id or receipt.profile_id <> p_profile_id or receipt.device_id <> p_device_id or receipt.payload_hash <> p_operation_hash or receipt.result is null then
      raise exception 'Sync operation does not match its receipt';
    end if;
    return receipt.result;
  end if;
  select * into base_revision from billing_sync_private.bill_revisions r where r.profile_id=p_profile_id and r.bill_id=p_bill_id and r.operation_id=p_base_operation_id;
  if not found or base_revision.outcome='needs_review' then raise exception 'Base revision not available; retry or review required'; end if;
  select * into head from billing_sync_private.entity_heads h where h.profile_id=p_profile_id and h.entity_type='bill' and h.entity_id=p_bill_id for update;
  if not found or head.owner_id <> p_owner_id then raise exception 'Bill history not available; review required'; end if;
  select * into current_bill from public.bills b where b.id=p_bill_id and b.profile_id=p_profile_id for update;

  if jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'items') is distinct from 'array'
    or jsonb_array_length(p_payload->'items') not between 1 and 30
    or char_length(btrim(coalesce(p_payload->>'customerName',''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload->>'fatherName',''))) not between 2 and 120
    or char_length(btrim(coalesce(p_payload->>'address',''))) not between 5 and 500
    or (char_length(coalesce(p_payload->>'phone','')) not between 7 and 20 and coalesce(p_payload->>'phone','') <> '')
    or char_length(coalesce(p_payload->>'governmentId','')) > 80 then raise exception 'Invalid bill details'; end if;
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
      or item_loan is null or item_loan not between 0.01 and 100000000 or item_loan <> round(item_loan,2) then raise exception 'Invalid bill item'; end if;
    assessed_total := assessed_total + item_assessed;
    loan_total := loan_total + item_loan;
  end loop;

  if head.deleted or current_bill.id is null or current_bill.status <> 'issued' then
    decision := 'needs_review';
  elsif coalesce((p_payload->>'billNumber')::integer,0) <> current_bill.bill_number then
    raise exception 'Bill number cannot be changed';
  elsif current_bill.delivery_date is not null and (p_payload->>'billDate')::date > current_bill.delivery_date then
    decision := 'needs_review';
  elsif p_base_operation_id <> head.operation_id and (p_occurred_at < head.occurred_at or (p_occurred_at = head.occurred_at and p_operation_id < head.operation_id)) then
    decision := 'superseded';
  else decision := 'applied'; end if;

  select jsonb_build_object('bill',to_jsonb(b),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.bill_items i where i.bill_id=b.id),'[]'::jsonb))
    into prior from public.bills b where b.id=p_bill_id and b.profile_id=p_profile_id;
  if decision='applied' then
    update public.bills set bill_date=(p_payload->>'billDate')::date,customer_id=customer,customer_code=case when customer is null then null else customer_code end,customer_name=btrim(p_payload->>'customerName'),
      father_name=btrim(p_payload->>'fatherName'),address=btrim(p_payload->>'address'),phone=coalesce(p_payload->>'phone',''),
      government_id=nullif(p_payload->>'governmentId',''),total_assessed_value=assessed_total,total_loan_amount=loan_total,
      historical_missing_details=false,excel_sync_status='pending',excel_sync_error=null,pdf_storage_path=null,pdf_error=null,updated_at=now()
      where id=p_bill_id and profile_id=p_profile_id;
    delete from public.bill_items where bill_id=p_bill_id;
    for item in select * from jsonb_array_elements(p_payload->'items') loop
      insert into public.bill_items(id,bill_id,metal,particulars,remarks,grams,assessed_value,loan_amount,sort_order)
        values((item->>'id')::uuid,p_bill_id,item->>'metal',btrim(item->>'particulars'),nullif(item->>'remarks',''),(item->>'grams')::numeric,(item->>'assessedValue')::numeric,(item->>'loanAmount')::numeric,position);
      position := position + 1;
    end loop;
  end if;
  select jsonb_build_object('bill',to_jsonb(b),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.bill_items i where i.bill_id=b.id),'[]'::jsonb))
    into resulting from public.bills b where b.id=p_bill_id and b.profile_id=p_profile_id;
  outcome := jsonb_build_object('operationId',p_operation_id,'billId',p_bill_id,'outcome',decision);
  insert into billing_sync_private.operation_receipts(operation_id,profile_id,owner_id,device_id,payload_hash,outcome,result)
    values(p_operation_id,p_profile_id,p_owner_id,p_device_id,p_operation_hash,case when decision='needs_review' then 'needs_review' else 'accepted' end,outcome);
  insert into billing_sync_private.bill_revisions(profile_id,owner_id,bill_id,operation_id,base_operation_id,action,outcome,occurred_at,requested_change,prior_snapshot,resulting_snapshot)
    values(p_profile_id,p_owner_id,p_bill_id,p_operation_id,p_base_operation_id,'edit',decision,p_occurred_at,p_payload,prior,resulting);
  if decision='applied' then
    update billing_sync_private.entity_heads set operation_id=p_operation_id,occurred_at=p_occurred_at,deleted=false
      where profile_id=p_profile_id and entity_type='bill' and entity_id=p_bill_id;
  end if;
  return outcome;
end;
$$;
revoke all on function public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz) to service_role;

commit;
