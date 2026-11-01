-- Direct database reads require both ownership and an enabled billing approval.
-- Server-side service-role operations must still perform their own checks.
begin;

drop policy if exists "owners view profile" on public.business_profiles;
create policy "approved owners view profile" on public.business_profiles for select to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.billing_user_access a where a.user_id = (select auth.uid()) and a.enabled
  ));

drop policy if exists "owners view bills" on public.bills;
create policy "approved owners view bills" on public.bills for select to authenticated
  using (exists (
    select 1 from public.business_profiles p
    where p.id = bills.profile_id and p.owner_id = (select auth.uid())
  ) and exists (
    select 1 from public.billing_user_access a where a.user_id = (select auth.uid()) and a.enabled
  ));

drop policy if exists "owners view bill items" on public.bill_items;
create policy "approved owners view bill items" on public.bill_items for select to authenticated
  using (exists (
    select 1 from public.bills b join public.business_profiles p on p.id = b.profile_id
    where b.id = bill_items.bill_id and p.owner_id = (select auth.uid())
  ) and exists (
    select 1 from public.billing_user_access a where a.user_id = (select auth.uid()) and a.enabled
  ));

drop policy if exists "owners view customers" on public.customers;
create policy "approved owners view customers" on public.customers for select to authenticated
  using (owner_id = (select auth.uid()) and exists (
    select 1 from public.billing_user_access a where a.user_id = (select auth.uid()) and a.enabled
  ));

commit;
