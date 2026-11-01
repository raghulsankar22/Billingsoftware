begin;

-- This function is callable only by the server. Its caller must supply the
-- authenticated user's ID, never an owner ID from a request body.
create function public.save_cloud_business_profile(p_owner_id uuid, p_profile jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.business_profiles;
  selected_slot integer;
  business_name text := btrim(p_profile->>'businessName');
  business_address text := btrim(p_profile->>'address');
  business_phone text := btrim(p_profile->>'phone');
  business_license text := nullif(btrim(p_profile->>'licenseNumber'), '');
  business_logo text := nullif(btrim(p_profile->>'logoUrl'), '');
begin
  if p_owner_id is null or not exists (select 1 from public.billing_user_access a where a.user_id = p_owner_id and a.enabled) then
    raise exception 'User is not approved for billing';
  end if;
  selected_slot := coalesce((p_profile->>'accountSlot')::integer, 1);
  if selected_slot not between 1 and 2147483646 then raise exception 'Choose a valid business account'; end if;
  if business_name is null or char_length(business_name) not between 2 and 160
    or business_address is null or char_length(business_address) not between 5 and 500
    or business_phone is null or char_length(business_phone) not between 7 and 20
    or char_length(coalesce(business_license, '')) > 80 then
    raise exception 'Business profile details are invalid';
  end if;
  insert into public.business_profiles(owner_id,account_slot,business_name,address,phone,license_number,logo_url,next_bill_number,next_delivery_number)
  values(p_owner_id,selected_slot,business_name,business_address,business_phone,business_license,business_logo,1,1)
  on conflict (owner_id,account_slot) do update set
    business_name = excluded.business_name,
    address = excluded.address,
    phone = excluded.phone,
    license_number = case when p_profile ? 'licenseNumber' then excluded.license_number else business_profiles.license_number end,
    logo_url = excluded.logo_url,
    updated_at = now()
  returning * into saved;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_cloud_business_profile(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_cloud_business_profile(uuid,jsonb) to service_role;

commit;
