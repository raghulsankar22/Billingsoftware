create extension if not exists pgcrypto;

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  business_name text not null,
  address text not null,
  phone text not null,
  logo_url text,
  next_bill_number integer not null default 1 check (next_bill_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.business_profiles(id),
  bill_number integer not null,
  bill_date date not null,
  delivery_no text,
  delivery_date date,
  customer_name text not null,
  father_name text not null,
  address text not null,
  phone text not null,
  government_id text,
  total_assessed_value numeric(14,2) not null,
  total_loan_amount numeric(14,2) not null,
  status text not null default 'issued' check (status in ('issued', 'void')),
  replacement_for_id uuid references public.bills(id),
  excel_sync_status text not null default 'pending' check (excel_sync_status in ('pending', 'synced', 'failed')),
  excel_sync_error text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  unique(profile_id, bill_number)
);

create table if not exists public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  particulars text not null,
  grams numeric(12,3) not null,
  assessed_value numeric(14,2) not null,
  loan_amount numeric(14,2) not null,
  sort_order integer not null
);

create table if not exists public.microsoft_connections (
  profile_id uuid primary key references public.business_profiles(id) on delete cascade,
  refresh_token_encrypted text not null,
  workbook_path text not null default 'Finance Billing Register.xlsx',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.business_profiles enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.microsoft_connections enable row level security;

create policy "owners manage profile" on public.business_profiles for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners view bills" on public.bills for select using (profile_id in (select id from public.business_profiles where owner_id = auth.uid()));
create policy "owners view bill items" on public.bill_items for select using (bill_id in (select b.id from public.bills b join public.business_profiles p on p.id = b.profile_id where p.owner_id = auth.uid()));

create or replace function public.create_bill(p_owner_id uuid, p_bill jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare profile_row public.business_profiles; created_bill public.bills; item jsonb;
begin
  select * into profile_row from public.business_profiles where owner_id = p_owner_id for update;
  if not found then raise exception 'Business profile is required'; end if;
  update public.business_profiles set next_bill_number = next_bill_number + 1, updated_at = now() where id = profile_row.id;
  insert into public.bills (profile_id, bill_number, bill_date, delivery_no, delivery_date, customer_name, father_name, address, phone, government_id, total_assessed_value, total_loan_amount)
  values (profile_row.id, profile_row.next_bill_number, (p_bill->>'billDate')::date, nullif(p_bill->>'deliveryNo',''), nullif(p_bill->>'deliveryDate','')::date, p_bill->>'customerName', p_bill->>'fatherName', p_bill->>'address', p_bill->>'phone', nullif(p_bill->>'governmentId',''), (p_bill->>'totalAssessedValue')::numeric, (p_bill->>'totalLoanAmount')::numeric)
  returning * into created_bill;
  for item in select * from jsonb_array_elements(p_bill->'items') loop
    insert into public.bill_items (bill_id, particulars, grams, assessed_value, loan_amount, sort_order)
    values (created_bill.id, item->>'particulars', (item->>'grams')::numeric, (item->>'assessedValue')::numeric, (item->>'loanAmount')::numeric, (item->>'sortOrder')::integer);
  end loop;
  return jsonb_build_object('id', created_bill.id);
end; $$;
