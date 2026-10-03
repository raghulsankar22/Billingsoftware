begin;

-- Keep every existing UUID, historical bill, snapshot and counter in account 1.
alter table public.business_profiles add column account_slot smallint not null default 1
  check (account_slot between 1 and 3);
alter table public.business_profiles drop constraint business_profiles_owner_id_key;
alter table public.business_profiles add constraint business_profiles_owner_account_key
  unique (owner_id, account_slot);

create or replace function public.save_business_profile(p_owner_id uuid, p_profile jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved_profile public.business_profiles;
  first_number integer := coalesce((p_profile->>'nextBillNumber')::integer, 1);
begin
  if first_number < 1 or first_number >= 2147483647 then
    raise exception 'Choose a first bill number between 1 and 2147483646';
  end if;
  insert into public.business_profiles (owner_id, account_slot, business_name, address, phone, logo_url, next_bill_number)
  values (p_owner_id, coalesce((p_profile->>'accountSlot')::integer, 1), p_profile->>'businessName', p_profile->>'address', p_profile->>'phone', nullif(p_profile->>'logoUrl', ''), first_number)
  on conflict (owner_id, account_slot) do update set
    business_name = excluded.business_name,
    address = excluded.address,
    phone = excluded.phone,
    logo_url = excluded.logo_url,
    updated_at = now()
  returning * into saved_profile;
  -- ON CONFLICT holds the same profile lock as issuance; stale forms cannot reset its counter.
  return to_jsonb(saved_profile);
end;
$$;

create or replace function public.create_bill(p_owner_id uuid, p_bill jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  profile_row public.business_profiles;
  created_bill public.bills;
  item jsonb;
  item_position integer := 0;
  assessed_total numeric := 0;
  loan_total numeric := 0;
  item_assessed numeric;
  item_loan numeric;
  item_grams numeric;
begin
  if jsonb_typeof(p_bill->'items') is distinct from 'array' then
    raise exception 'A bill needs pledge items';
  end if;
  if jsonb_array_length(p_bill->'items') not between 1 and 30 then
    raise exception 'A bill needs between 1 and 30 pledge items';
  end if;
  for item in select * from jsonb_array_elements(p_bill->'items') loop
    item_assessed := (item->>'assessedValue')::numeric;
    item_loan := (item->>'loanAmount')::numeric;
    item_grams := (item->>'grams')::numeric;
    if item_assessed is null or item_loan is null or item_grams is null
      or item_assessed not between 0.01 and 100000000 or item_loan not between 0.01 and 100000000
      or item_grams not between 0 and 100000 or item_assessed != round(item_assessed, 2)
      or item_loan != round(item_loan, 2) or item_grams != round(item_grams, 3) then
      raise exception 'Pledge amounts or grams are invalid';
    end if;
    assessed_total := assessed_total + item_assessed;
    loan_total := loan_total + item_loan;
  end loop;

  select * into profile_row from public.business_profiles where owner_id = p_owner_id and account_slot = coalesce((p_bill->>'accountSlot')::integer, 1) for update;
  if not found then raise exception 'Business profile is required'; end if;
  if profile_row.next_bill_number >= 2147483647 then raise exception 'Bill number limit reached'; end if;
  update public.business_profiles set next_bill_number = next_bill_number + 1, updated_at = now() where id = profile_row.id;
  insert into public.bills (
    profile_id, bill_number, bill_date, delivery_no, delivery_date, customer_name, father_name,
    address, phone, government_id, total_assessed_value, total_loan_amount, business_snapshot
  ) values (
    profile_row.id, profile_row.next_bill_number, (p_bill->>'billDate')::date, nullif(p_bill->>'deliveryNo', ''),
    nullif(p_bill->>'deliveryDate', '')::date, p_bill->>'customerName', p_bill->>'fatherName',
    p_bill->>'address', p_bill->>'phone', nullif(p_bill->>'governmentId', ''), assessed_total, loan_total,
    jsonb_build_object('business_name', profile_row.business_name, 'address', profile_row.address, 'phone', profile_row.phone, 'logo_url', profile_row.logo_url)
  ) returning * into created_bill;
  for item in select * from jsonb_array_elements(p_bill->'items') loop
    insert into public.bill_items (bill_id, particulars, grams, assessed_value, loan_amount, sort_order)
    values (created_bill.id, item->>'particulars', (item->>'grams')::numeric, (item->>'assessedValue')::numeric, (item->>'loanAmount')::numeric, item_position);
    item_position := item_position + 1;
  end loop;
  return jsonb_build_object('id', created_bill.id);
end;
$$;

create or replace function public.replace_bill(p_owner_id uuid, p_original_id uuid, p_bill jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare original_row public.bills; profile_row public.business_profiles; new_bill jsonb;
begin
  -- Lock the original ledger before its bill, matching issuance lock order.
  select p.* into profile_row from public.business_profiles p
  join public.bills b on b.profile_id = p.id
  where b.id = p_original_id and p.owner_id = p_owner_id for update of p;
  if not found then raise exception 'Original bill not found'; end if;
  if p_bill ? 'accountSlot' and (p_bill->>'accountSlot')::integer is distinct from profile_row.account_slot then
    raise exception 'A replacement must remain in the original account';
  end if;
  select * into original_row from public.bills where id = p_original_id for update;
  if original_row.status <> 'issued' then raise exception 'Only issued bills can be replaced'; end if;
  if exists (select 1 from public.bills where replacement_for_id = p_original_id) then
    raise exception 'This bill already has a replacement';
  end if;
  update public.bills set status = 'void', voided_at = now(), excel_sync_status = 'pending', excel_sync_error = null
    where id = p_original_id;
  new_bill := public.create_bill(p_owner_id, p_bill || jsonb_build_object('accountSlot', profile_row.account_slot));
  update public.bills set replacement_for_id = p_original_id where id = (new_bill->>'id')::uuid;
  return new_bill;
end;
$$;

revoke all on function public.create_bill(uuid,jsonb), public.save_business_profile(uuid,jsonb), public.replace_bill(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_bill(uuid,jsonb), public.save_business_profile(uuid,jsonb), public.replace_bill(uuid,uuid,jsonb) to service_role;

commit;
