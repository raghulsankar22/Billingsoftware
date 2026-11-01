-- An authenticated account is not automatically an approved billing user.
-- Only trusted server-side administration can create or change approvals.
begin;

create table public.billing_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  administrator boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_user_access enable row level security;
revoke all on public.billing_user_access from public, anon, authenticated;
grant select on public.billing_user_access to authenticated;
grant all on public.billing_user_access to service_role;
create policy "users view own billing approval" on public.billing_user_access
  for select to authenticated using ((select auth.uid()) = user_id);

commit;
