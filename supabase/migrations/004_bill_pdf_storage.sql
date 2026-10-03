alter table public.bills
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_error text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bill-pdfs', 'bill-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
