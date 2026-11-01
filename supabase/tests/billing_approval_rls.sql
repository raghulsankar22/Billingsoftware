-- Run in a single database session. All synthetic records are rolled back.
begin;
do $$
declare
  approved uuid := gen_random_uuid(); disabled uuid := gen_random_uuid();
  first_profile uuid := gen_random_uuid(); second_profile uuid := gen_random_uuid();
begin
  insert into auth.users(id) values (approved), (disabled);
  insert into public.billing_user_access(user_id,enabled) values (approved,true), (disabled,false);
  insert into public.business_profiles(id,owner_id,business_name,address,phone) values
    (first_profile,approved,'test','test address','0000000'),
    (second_profile,disabled,'test','test address','0000000');
  insert into public.customers(id,owner_id,profile_id,customer_number,name) values
    (gen_random_uuid(),approved,first_profile,1,'test'),
    (gen_random_uuid(),disabled,second_profile,1,'test');
  if has_table_privilege('anon','public.customers','select')
    or has_table_privilege('authenticated','public.billing_user_access','insert')
    or has_table_privilege('authenticated','public.billing_user_access','update') then
    raise exception 'Untrusted users have unexpected access';
  end if;
  perform set_config('billing_test.approved',approved::text,true);
  perform set_config('billing_test.disabled',disabled::text,true);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('billing_test.approved'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('billing_test.approved'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.customers) <> 1 then raise exception 'Owner isolation failed'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('billing_test.disabled'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('billing_test.disabled'),'role','authenticated')::text,true);
do $$ begin
  if (select count(*) from public.customers) <> 0 then raise exception 'Disabled user access was not blocked'; end if;
end $$;
reset role;
rollback;
