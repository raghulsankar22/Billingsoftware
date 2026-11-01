begin;

-- Preserve the same owner-wide customer ID across business accounts. The
-- customer relationship is checked against the bill's business owner.
create function public.set_bill_customer_code() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare customer_number bigint; number_text text;
begin
  if new.customer_id is null then return new; end if;
  select canonical.customer_number into customer_number
    from public.customers c
    join public.business_profiles p on p.id=new.profile_id and p.owner_id=c.owner_id
    join public.customers canonical on canonical.id=coalesce(c.canonical_id,c.id) and canonical.owner_id=c.owner_id
    where c.id=new.customer_id;
  if not found then raise exception 'Customer must belong to the business account owner'; end if;
  number_text := customer_number::text;
  new.customer_code := 'C' || lpad(number_text,greatest(6,char_length(number_text)),'0');
  return new;
end;
$$;
revoke all on function public.set_bill_customer_code() from public, anon, authenticated;
create trigger bills_set_customer_code before insert or update of customer_id,profile_id on public.bills
for each row execute function public.set_bill_customer_code();

commit;
