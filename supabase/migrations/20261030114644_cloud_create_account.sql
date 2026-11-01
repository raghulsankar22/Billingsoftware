begin;

-- Service-only: the server must supply the ID of the authenticated user.
-- A transaction-scoped lock serializes account-slot allocation for that user.
create function public.create_business_account(p_owner_id uuid, p_profile jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  next_slot integer;
  saved public.business_profiles;
  business_name text := btrim(p_profile->>'businessName');
  address text := btrim(p_profile->>'address');
  phone text := btrim(p_profile->>'phone');
  license_number text := nullif(btrim(p_profile->>'licenseNumber'), '');
  logo_url text := nullif(btrim(p_profile->>'logoUrl'), '');
begin
  if p_owner_id is null or not exists (select 1 from public.billing_user_access a where a.user_id = p_owner_id and a.enabled) then
    raise exception 'User is not approved for billing';
  end if;
  if business_name is null or char_length(business_name) not between 2 and 160
    or address is null or char_length(address) not between 5 and 500
    or phone is null or char_length(phone) not between 7 and 20
    or char_length(coalesce(license_number, '')) > 80 then
    raise exception 'Business profile details are invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));
  select greatest(3, coalesce(max(account_slot), 3)) + 1 into next_slot
    from public.business_profiles where owner_id = p_owner_id;
  if next_slot > 2147483646 then raise exception 'Business account limit reached'; end if;
  insert into public.business_profiles(owner_id, account_slot, business_name, address, phone, license_number, logo_url, next_bill_number, next_delivery_number)
  values (p_owner_id, next_slot, business_name, address, phone, license_number, logo_url, 1, 1)
  returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.create_business_account(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.create_business_account(uuid,jsonb) to service_role;

commit;
