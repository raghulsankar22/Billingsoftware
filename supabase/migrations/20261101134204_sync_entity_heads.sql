begin;

-- Entity heads and tombstones are private, and will be updated atomically by
-- future sync operations. They provide the basis for deterministic ordering.
create table billing_sync_private.entity_heads (
  profile_id uuid not null,
  owner_id uuid not null,
  entity_type text not null check (entity_type in ('bill','delivery','customer','profile')),
  entity_id uuid not null,
  operation_id uuid not null references billing_sync_private.operation_receipts(operation_id),
  occurred_at timestamptz not null,
  deleted boolean not null default false,
  primary key(profile_id,entity_type,entity_id),
  foreign key(profile_id,owner_id) references public.business_profiles(id,owner_id)
);
alter table billing_sync_private.entity_heads enable row level security;
revoke all on billing_sync_private.entity_heads from public, anon, authenticated;
grant all on billing_sync_private.entity_heads to service_role;

-- Add a head without changing it when a completed creation is retried after a
-- later edit. The caller computes the operation hash including occurred_at.
create function public.sync_issue_bill_v2(
  p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text,p_epoch bigint,
  p_operation_id uuid,p_operation_hash text,p_bill_id uuid,p_bill_number integer,
  p_payload jsonb,p_occurred_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare outcome jsonb;
begin
  if p_occurred_at is null then raise exception 'Sync operation time is required'; end if;
  outcome := public.sync_issue_bill(p_owner_id,p_profile_id,p_device_id,p_token_hash,p_epoch,p_operation_id,p_operation_hash,p_bill_id,p_bill_number,p_payload);
  if outcome->>'billId' <> p_bill_id::text or (outcome->>'billNumber')::integer <> p_bill_number then raise exception 'Sync operation does not match its receipt'; end if;
  if not exists (select 1 from public.bills b where b.id=p_bill_id and b.profile_id=p_profile_id)
    and not exists (select 1 from billing_sync_private.entity_heads h where h.profile_id=p_profile_id and h.entity_type='bill' and h.entity_id=p_bill_id) then
    raise exception 'Sync receipt has no bill or history';
  end if;
  insert into billing_sync_private.entity_heads(profile_id,owner_id,entity_type,entity_id,operation_id,occurred_at,deleted)
    values(p_profile_id,p_owner_id,'bill',p_bill_id,p_operation_id,p_occurred_at,false)
    on conflict(profile_id,entity_type,entity_id) do nothing;
  return outcome;
end;
$$;
revoke all on function public.sync_issue_bill_v2(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.sync_issue_bill_v2(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb,timestamptz) to service_role;

commit;
