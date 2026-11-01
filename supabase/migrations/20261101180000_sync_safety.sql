begin;

-- Never used: bill_revisions holds replaced values and deletion history.
drop table billing_sync_private.change_history;

-- Recovery takes one account away from a device. The device keeps working for
-- that owner's other accounts, whose unsynced bills would otherwise be stranded.
create table billing_sync_private.account_device_blocks (
  profile_id uuid not null,
  owner_id uuid not null,
  device_id uuid not null,
  recovery_id uuid not null references billing_sync_private.issuer_recoveries(id),
  blocked_at timestamptz not null default now(),
  primary key (profile_id, device_id),
  foreign key (profile_id, owner_id) references public.business_profiles(id, owner_id),
  foreign key (device_id, owner_id) references billing_sync_private.devices(id, owner_id)
);
alter table billing_sync_private.account_device_blocks enable row level security;
revoke all on billing_sync_private.account_device_blocks from public, anon, authenticated;
grant all on billing_sync_private.account_device_blocks to service_role;

create or replace function public.start_offline_issuer_recovery(p_actor_id uuid,p_owner_id uuid,p_profile_id uuid,p_replacement_device_id uuid,p_recovery_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_issuer billing_sync_private.account_issuers; recovery billing_sync_private.issuer_recoveries;
begin
  perform 1 from public.billing_user_access a where a.user_id=p_actor_id and a.enabled and a.administrator for share;
  if not found then raise exception 'Administrator approval required'; end if;
  perform 1 from public.billing_user_access a where a.user_id=p_owner_id and a.enabled for share;
  if not found then raise exception 'Business owner is not approved'; end if;
  if p_recovery_id is null or p_replacement_device_id is null then raise exception 'Invalid recovery request'; end if;
  perform 1 from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  select * into recovery from billing_sync_private.issuer_recoveries r where r.id=p_recovery_id;
  if found then
    if recovery.profile_id <> p_profile_id or recovery.owner_id <> p_owner_id or recovery.initiated_by <> p_actor_id or recovery.replacement_device_id <> p_replacement_device_id then raise exception 'Recovery request does not match'; end if;
    return jsonb_build_object('profileId',recovery.profile_id,'recoveryId',recovery.id,'epoch',recovery.recovery_epoch,'resolved',recovery.resolved_at is not null);
  end if;
  perform 1 from billing_sync_private.devices d where d.id=p_replacement_device_id and d.owner_id=p_owner_id and d.revoked_at is null for share;
  if not found then raise exception 'Replacement device not found'; end if;
  select * into current_issuer from billing_sync_private.account_issuers where profile_id=p_profile_id for update;
  if not found or current_issuer.owner_id <> p_owner_id or current_issuer.mode <> 'assigned'
    or current_issuer.device_id = p_replacement_device_id or current_issuer.epoch >= 9007199254740991 then
    raise exception 'Offline permission cannot be recovered for this device';
  end if;
  insert into billing_sync_private.issuer_recoveries(id,profile_id,owner_id,initiated_by,old_device_id,replacement_device_id,prior_epoch,recovery_epoch)
    values(p_recovery_id,p_profile_id,p_owner_id,p_actor_id,current_issuer.device_id,p_replacement_device_id,current_issuer.epoch,current_issuer.epoch+1)
    returning * into recovery;
  insert into billing_sync_private.account_device_blocks(profile_id,owner_id,device_id,recovery_id)
    values(p_profile_id,p_owner_id,current_issuer.device_id,p_recovery_id) on conflict(profile_id,device_id) do nothing;
  update billing_sync_private.account_issuers set mode='review',device_id=p_replacement_device_id,epoch=recovery.recovery_epoch,updated_at=now() where profile_id=p_profile_id;
  return jsonb_build_object('profileId',recovery.profile_id,'recoveryId',recovery.id,'epoch',recovery.recovery_epoch,'resolved',false);
end;
$$;

-- Revoking everywhere is now a separate, deliberate step for a stolen device.
-- Any account it still holds needs recovery; that remains an administrator's call.
create function public.revoke_cloud_device(p_actor_id uuid,p_owner_id uuid,p_device_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.billing_user_access a where a.user_id=p_actor_id and a.enabled and a.administrator for share;
  if not found then raise exception 'Administrator approval required'; end if;
  update billing_sync_private.devices d set revoked_at=coalesce(d.revoked_at,now()) where d.id=p_device_id and d.owner_id=p_owner_id;
  if not found then raise exception 'Device not found'; end if;
  return jsonb_build_object('deviceId',p_device_id,'revoked',true);
end;
$$;
revoke all on function public.revoke_cloud_device(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.revoke_cloud_device(uuid,uuid,uuid) to service_role;

-- A bill from a device removed from this account goes to review. An operation
-- the server already accepted still returns its original receipt.
create or replace function public.sync_issue_bill_v3(
  p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text,p_epoch bigint,
  p_operation_id uuid,p_operation_hash text,p_bill_id uuid,p_bill_number integer,
  p_payload jsonb,p_occurred_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare outcome jsonb; snapshot jsonb;
begin
  if exists (select 1 from billing_sync_private.account_device_blocks b where b.profile_id=p_profile_id and b.device_id=p_device_id)
    and not exists (select 1 from billing_sync_private.operation_receipts r where r.operation_id=p_operation_id) then
    raise exception 'Offline permission changed; manual review is required';
  end if;
  outcome := public.sync_issue_bill_v2(p_owner_id,p_profile_id,p_device_id,p_token_hash,p_epoch,p_operation_id,p_operation_hash,p_bill_id,p_bill_number,p_payload,p_occurred_at);
  if not exists (select 1 from billing_sync_private.bill_revisions r where r.operation_id=p_operation_id) then
    select jsonb_build_object('bill',to_jsonb(b),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.bill_items i where i.bill_id=b.id),'[]'::jsonb))
      into snapshot from public.bills b where b.id=p_bill_id and b.profile_id=p_profile_id;
    if snapshot is null then raise exception 'Sync receipt has no bill history'; end if;
    insert into billing_sync_private.bill_revisions(profile_id,owner_id,bill_id,operation_id,action,outcome,occurred_at,requested_change,resulting_snapshot)
      values(p_profile_id,p_owner_id,p_bill_id,p_operation_id,'create','applied',p_occurred_at,p_payload,snapshot);
  end if;
  return outcome;
end;
$$;

-- The device states its counters so a mismatch stops before anything is reserved.
create function public.assign_offline_issuer_v3(p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text,p_next_bill_number integer,p_next_delivery_number integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare profile public.business_profiles; current_issuer billing_sync_private.account_issuers;
begin
  if not public.verify_cloud_device(p_owner_id,p_device_id,p_token_hash) then raise exception 'Device authentication failed'; end if;
  select * into profile from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id for update;
  if not found then raise exception 'Business account not found'; end if;
  if exists (select 1 from billing_sync_private.account_device_blocks b where b.profile_id=p_profile_id and b.device_id=p_device_id) then
    raise exception 'Account is reserved or requires manual review';
  end if;
  select * into current_issuer from billing_sync_private.account_issuers i where i.profile_id=p_profile_id for update;
  if not (found and current_issuer.mode='assigned' and current_issuer.device_id=p_device_id)
    and (p_next_bill_number is distinct from profile.next_bill_number or p_next_delivery_number is distinct from profile.next_delivery_number) then
    raise exception 'Bill or delivery numbers differ. Sync this account before enabling offline billing.';
  end if;
  return public.assign_offline_issuer_v2(p_owner_id,p_profile_id,p_device_id,p_token_hash);
end;
$$;
revoke all on function public.assign_offline_issuer_v3(uuid,uuid,uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.assign_offline_issuer_v3(uuid,uuid,uuid,text,integer,integer) to service_role;

-- Replaced so a bill edit matches the local app: a delivered bill's summary is
-- recalculated and its old delivery PDF cleared. The server route calculates the
-- summary and states which delivery date it used, so the rules live in one place.
drop function public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz);
create function public.sync_edit_bill(
  p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text,
  p_operation_id uuid,p_operation_hash text,p_bill_id uuid,p_base_operation_id uuid,
  p_payload jsonb,p_occurred_at timestamptz,p_delivery_date date,p_delivery_summary jsonb
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
  effective_delivery date;
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
  if exists (select 1 from billing_sync_private.account_device_blocks b where b.profile_id=p_profile_id and b.device_id=p_device_id) then
    raise exception 'Offline permission changed; manual review is required';
  end if;
  -- A future time would beat every genuine edit until the clock caught up.
  if p_occurred_at > now() + interval '5 minutes' then raise exception 'Device time is in the future'; end if;
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
    or char_length(coalesce(p_payload->>'governmentId','')) > 80
    or char_length(coalesce(p_payload->>'deliveryNo','')) > 60 then raise exception 'Invalid bill details'; end if;
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
  -- An edit can correct a delivery's details but never erases a recorded delivery.
  effective_delivery := coalesce(nullif(p_payload->>'deliveryDate','')::date, current_bill.delivery_date);

  if head.deleted or current_bill.id is null or current_bill.status <> 'issued' then
    decision := 'needs_review';
  elsif coalesce((p_payload->>'billNumber')::integer,0) <> current_bill.bill_number then
    raise exception 'Bill number cannot be changed';
  elsif effective_delivery is not null and (p_payload->>'billDate')::date > effective_delivery then
    decision := 'needs_review';
  elsif p_base_operation_id <> head.operation_id and (p_occurred_at < head.occurred_at or (p_occurred_at = head.occurred_at and p_operation_id < head.operation_id)) then
    decision := 'superseded';
  else decision := 'applied'; end if;

  if decision='applied' then
    if effective_delivery is distinct from p_delivery_date then raise exception 'Delivery changed; retry the edit'; end if;
    if effective_delivery is not null and not current_bill.historical_delivery and p_delivery_summary is null then raise exception 'Delivery summary is required'; end if;
  end if;

  select jsonb_build_object('bill',to_jsonb(b),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order) from public.bill_items i where i.bill_id=b.id),'[]'::jsonb))
    into prior from public.bills b where b.id=p_bill_id and b.profile_id=p_profile_id;
  if decision='applied' then
    update public.bills set bill_date=(p_payload->>'billDate')::date,customer_id=customer,customer_code=case when customer is null then null else customer_code end,customer_name=btrim(p_payload->>'customerName'),
      father_name=btrim(p_payload->>'fatherName'),address=btrim(p_payload->>'address'),phone=coalesce(p_payload->>'phone',''),
      government_id=nullif(p_payload->>'governmentId',''),total_assessed_value=assessed_total,total_loan_amount=loan_total,
      delivery_no=coalesce(nullif(p_payload->>'deliveryNo',''),delivery_no),delivery_date=effective_delivery,
      delivery_summary=case when historical_delivery then delivery_summary else p_delivery_summary end,
      delivery_pdf_storage_path=null,delivery_pdf_error=null,
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
    -- A slow clock must not move the bill's history backwards.
    update billing_sync_private.entity_heads set operation_id=p_operation_id,occurred_at=greatest(occurred_at,p_occurred_at),deleted=false
      where profile_id=p_profile_id and entity_type='bill' and entity_id=p_bill_id;
  end if;
  return outcome;
end;
$$;
revoke all on function public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz,date,jsonb) from public, anon, authenticated;
grant execute on function public.sync_edit_bill(uuid,uuid,uuid,text,uuid,text,uuid,uuid,jsonb,timestamptz,date,jsonb) to service_role;

commit;
