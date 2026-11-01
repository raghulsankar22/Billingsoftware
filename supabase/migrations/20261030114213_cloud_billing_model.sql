-- Data-model groundwork for the current offline features. API endpoints and
-- authenticated synchronization are implemented separately.
begin;

alter table public.business_profiles drop constraint business_profiles_account_slot_check;
alter table public.business_profiles alter column account_slot type integer;
alter table public.business_profiles add constraint business_profiles_account_slot_check check (account_slot between 1 and 2147483646);
alter table public.business_profiles add column license_number text;
alter table public.business_profiles add column next_delivery_number integer not null default 1 check (next_delivery_number > 0);

create table public.customers (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  profile_id uuid not null,
  canonical_id uuid,
  customer_number bigint not null check (customer_number > 0),
  name text not null,
  father_name text not null default '',
  address text not null default '',
  phone text not null default '',
  aadhaar text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, customer_number),
  foreign key (profile_id, owner_id) references public.business_profiles(id, owner_id),
  foreign key (canonical_id, owner_id) references public.customers(id, owner_id) deferrable initially deferred
);
create index customers_owner_name on public.customers(owner_id, name);
create index customers_owner_phone on public.customers(owner_id, phone) where phone <> '';
create index customers_owner_aadhaar on public.customers(owner_id, aadhaar) where aadhaar <> '';
alter table public.customers enable row level security;
revoke all on public.customers from public, anon, authenticated;
grant select on public.customers to authenticated;
grant all on public.customers to service_role;
create policy "owners view customers" on public.customers for select to authenticated using ((select auth.uid()) = owner_id);

alter table public.bills alter column father_name drop not null;
alter table public.bills alter column total_assessed_value drop not null;
alter table public.bills add column customer_id uuid references public.customers(id);
alter table public.bills add column customer_code text;
alter table public.bills add column delivery_bill_receipt_status text check (delivery_bill_receipt_status in ('has_bill', 'lost_bill'));
alter table public.bills add column delivery_summary jsonb;
alter table public.bills add column delivery_pdf_storage_path text;
alter table public.bills add column delivery_pdf_error text;
alter table public.bills add column historical_import boolean not null default false;
alter table public.bills add column historical_delivery boolean not null default false;
alter table public.bills add column historical_missing_details boolean not null default false;
alter table public.bills add column updated_at timestamptz;

-- Even privileged server code must not link a customer's record to another owner.
create function public.check_bill_customer_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.customer_id is not null and not exists (
    select 1 from public.customers c join public.business_profiles p on p.id = new.profile_id
    where c.id = new.customer_id and c.owner_id = p.owner_id
  ) then
    raise exception 'Customer must belong to the business account owner';
  end if;
  return new;
end;
$$;
revoke all on function public.check_bill_customer_owner() from public, anon, authenticated;
create trigger bills_customer_owner before insert or update of customer_id, profile_id on public.bills
for each row execute function public.check_bill_customer_owner();

alter table public.bill_items alter column grams drop not null;
alter table public.bill_items alter column assessed_value drop not null;
alter table public.bill_items add column metal text check (metal in ('Gold', 'Silver'));
alter table public.bill_items add column remarks text;

commit;
