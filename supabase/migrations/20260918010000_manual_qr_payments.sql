-- =====================================================================
-- Manual QR payments
--
-- A personal bank QR has no API, so nothing can tell the academy that a
-- payment arrived. Instead:
--   1. an admin uploads the bank QR once (bucket payment-qr)
--   2. the student pays it, writing the order's short code in the note,
--      and uploads the receipt (bucket receipts); the order moves to
--      'review'
--   3. the admin sees the money in the bank app, checks the receipt and
--      approves, which runs fulfill_order like any other payment
-- =====================================================================

alter type public.order_status add value if not exists 'review';

alter table public.orders
  add column ref_code     text,
  add column receipt_path text,
  add column claimed_at   timestamptz,
  add column reviewed_at  timestamptz,
  add column reviewed_by  uuid references auth.users (id) on delete set null,
  add column review_note  text check (char_length(review_note) <= 300);

create unique index orders_ref_code_key on public.orders (ref_code) where ref_code is not null;
create index orders_reviewed_by_idx on public.orders (reviewed_by);

-- ---------------------------------------------------------------------
-- is_admin(): lets the app show the payments page to admins only. The
-- Edge Functions check the admins table again on every admin action.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- storage: both buckets are private
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('payment-qr', 'payment-qr', false, 2097152,
   array['image/png', 'image/jpeg', 'image/webp']),
  ('receipts', 'receipts', false, 5242880,
   array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

-- a student may upload a receipt only into their own folder, and read it back
create policy "receipts: owner can upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "receipts: owner can read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- payment-qr has no policies: only the Edge Functions (secret key) read and
-- write it, and students get a short-lived signed link with their order
