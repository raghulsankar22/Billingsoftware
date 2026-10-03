-- A correction is one transaction: void the old bill, issue the replacement,
-- and retain a link between their permanent bill numbers.
create or replace function public.replace_bill(
  p_owner_id uuid,
  p_original_id uuid,
  p_bill jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  original_row public.bills;
  profile_row public.business_profiles;
  new_bill jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized to replace bills';
  end if;

  select * into profile_row
  from public.business_profiles
  where owner_id = p_owner_id
  for update;
  if not found then raise exception 'Business profile is required'; end if;

  select * into original_row
  from public.bills
  where id = p_original_id and profile_id = profile_row.id
  for update;
  if not found then raise exception 'Original bill not found'; end if;
  if original_row.status <> 'issued' then
    raise exception 'Only issued bills can be replaced';
  end if;
  if exists (select 1 from public.bills where replacement_for_id = p_original_id) then
    raise exception 'This bill already has a replacement';
  end if;

  update public.bills
  set status = 'void', voided_at = now()
  where id = p_original_id;

  new_bill := public.create_bill(p_owner_id, p_bill);
  update public.bills
  set replacement_for_id = p_original_id
  where id = (new_bill->>'id')::uuid;

  return new_bill;
end;
$$;

revoke all on function public.replace_bill(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_bill(uuid, uuid, jsonb) to service_role;
create unique index if not exists one_replacement_per_bill
  on public.bills (replacement_for_id)
  where replacement_for_id is not null;
