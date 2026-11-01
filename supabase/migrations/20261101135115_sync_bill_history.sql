begin;

-- Private, durable history is needed to distinguish concurrent delivery,
-- edit and deletion operations and to retain replaced values for review.
create table billing_sync_private.bill_revisions (
  sequence bigint generated always as identity primary key,
  profile_id uuid not null,
  owner_id uuid not null,
  bill_id uuid not null,
  operation_id uuid not null unique references billing_sync_private.operation_receipts(operation_id),
  base_operation_id uuid references billing_sync_private.operation_receipts(operation_id),
  action text not null check (action in ('create','edit','delivery','delete')),
  outcome text not null check (outcome in ('applied','superseded','needs_review')),
  occurred_at timestamptz not null,
  requested_change jsonb not null,
  prior_snapshot jsonb,
  resulting_snapshot jsonb,
  created_at timestamptz not null default now(),
  foreign key(profile_id,owner_id) references public.business_profiles(id,owner_id)
);
create index bill_revisions_lookup on billing_sync_private.bill_revisions(profile_id,bill_id,sequence);
alter table billing_sync_private.bill_revisions enable row level security;
revoke all on billing_sync_private.bill_revisions from public, anon, authenticated;
grant all on billing_sync_private.bill_revisions to service_role;
grant usage, select on sequence billing_sync_private.bill_revisions_sequence_seq to service_role;

-- Creation, receipt, head and initial history are committed together. A retry
-- must not replace the original snapshot with a later version of the bill.
create function public.sync_issue_bill_v3(
  p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text,p_epoch bigint,
  p_operation_id uuid,p_operation_hash text,p_bill_id uuid,p_bill_number integer,
  p_payload jsonb,p_occurred_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare outcome jsonb; snapshot jsonb;
begin
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
revoke all on function public.sync_issue_bill_v3(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.sync_issue_bill_v3(uuid,uuid,uuid,text,bigint,uuid,text,uuid,integer,jsonb,timestamptz) to service_role;

commit;
