begin;

-- The client must finish inbound and outbound synchronization before claiming
-- offline permission, then compare both counters before enabling issuance.
create function public.assign_offline_issuer_v2(p_owner_id uuid,p_profile_id uuid,p_device_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare assignment jsonb; profile public.business_profiles;
begin
  assignment := public.assign_offline_issuer(p_owner_id,p_profile_id,p_device_id,p_token_hash);
  select * into profile from public.business_profiles p where p.id=p_profile_id and p.owner_id=p_owner_id;
  if not found then raise exception 'Business account not found'; end if;
  return assignment || jsonb_build_object('nextBillNumber',profile.next_bill_number,'nextDeliveryNumber',profile.next_delivery_number);
end;
$$;
revoke all on function public.assign_offline_issuer_v2(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.assign_offline_issuer_v2(uuid,uuid,uuid,text) to service_role;

commit;
