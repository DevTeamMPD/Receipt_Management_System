-- Receipt Desk access control v1: allowlist of staff + RLS policies + private image bucket + atomic save function.
-- Applied to the Supabase project as migration "receipt_desk_access_v1" on 2026-11-25 (after receipt_desk_schema_v1).
-- Only users listed (and active) in public.receipt_users can touch receipt_* data. Other apps' auth users are not allowed.

create schema if not exists receipt_private;
revoke all on schema receipt_private from public, anon;
grant usage on schema receipt_private to authenticated;

create table public.receipt_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'office_sales' check (role in ('office_sales', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.receipt_users enable row level security;
revoke all on public.receipt_users from anon, authenticated;
grant select on public.receipt_users to authenticated;
comment on table public.receipt_users is 'Receipt Desk: รายชื่อเจ้าหน้าที่ที่ใช้ระบบได้ (เพิ่ม/แก้ด้วย SQL โดยผู้ดูแลเท่านั้น)';

create or replace function receipt_private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.receipt_users u where u.user_id = (select auth.uid()) and u.active)
$$;
revoke all on function receipt_private.is_active_user() from public, anon;
grant execute on function receipt_private.is_active_user() to authenticated;

create policy receipt_users_select_self on public.receipt_users
  for select to authenticated using (user_id = (select auth.uid()));

grant select, insert, update on public.receipt_orders to authenticated;
grant select, insert, update, delete on public.receipt_order_items to authenticated;
grant select, insert on public.receipt_events to authenticated;
grant select, insert on public.receipt_ocr_runs to authenticated;

create policy receipt_orders_select on public.receipt_orders for select to authenticated using ((select receipt_private.is_active_user()));
create policy receipt_orders_insert on public.receipt_orders for insert to authenticated with check ((select receipt_private.is_active_user()));
create policy receipt_orders_update on public.receipt_orders for update to authenticated
  using ((select receipt_private.is_active_user())) with check ((select receipt_private.is_active_user()));

create policy receipt_items_select on public.receipt_order_items for select to authenticated using ((select receipt_private.is_active_user()));
create policy receipt_items_insert on public.receipt_order_items for insert to authenticated with check ((select receipt_private.is_active_user()));
create policy receipt_items_update on public.receipt_order_items for update to authenticated
  using ((select receipt_private.is_active_user())) with check ((select receipt_private.is_active_user()));
create policy receipt_items_delete on public.receipt_order_items for delete to authenticated using ((select receipt_private.is_active_user()));

create policy receipt_events_select on public.receipt_events for select to authenticated using ((select receipt_private.is_active_user()));
create policy receipt_events_insert on public.receipt_events for insert to authenticated
  with check ((select receipt_private.is_active_user()) and actor = (select auth.uid()));

create policy receipt_ocr_runs_select on public.receipt_ocr_runs for select to authenticated using ((select receipt_private.is_active_user()));
create policy receipt_ocr_runs_insert on public.receipt_ocr_runs for insert to authenticated with check ((select receipt_private.is_active_user()));

-- บันทึกการแก้ไขแบบอะตอมมิก: ตรวจ version (กันแก้ทับกัน) + แก้ได้เฉพาะใบที่ยังรอตรวจ + แทนที่รายการสินค้าทั้งชุด
create or replace function public.receipt_save_order(p_id uuid, p_version integer, p_fields jsonb, p_items jsonb default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new integer;
begin
  update public.receipt_orders o set
    bill_number   = case when p_fields ? 'bill_number'   then coalesce(p_fields ->> 'bill_number', '')   else o.bill_number end,
    order_date    = case when p_fields ? 'order_date'    then nullif(p_fields ->> 'order_date', '')::date else o.order_date end,
    total         = case when p_fields ? 'total'         then nullif(p_fields ->> 'total', '')::numeric   else o.total end,
    customer_name = case when p_fields ? 'customer_name' then coalesce(p_fields ->> 'customer_name', '') else o.customer_name end,
    phone         = case when p_fields ? 'phone'         then coalesce(p_fields ->> 'phone', '')         else o.phone end,
    address       = case when p_fields ? 'address'       then coalesce(p_fields ->> 'address', '')       else o.address end,
    sub_district  = case when p_fields ? 'sub_district'  then coalesce(p_fields ->> 'sub_district', '')  else o.sub_district end,
    district      = case when p_fields ? 'district'      then coalesce(p_fields ->> 'district', '')      else o.district end,
    province      = case when p_fields ? 'province'      then coalesce(p_fields ->> 'province', '')      else o.province end,
    postcode      = case when p_fields ? 'postcode'      then coalesce(p_fields ->> 'postcode', '')      else o.postcode end,
    ship_date     = case when p_fields ? 'ship_date'     then nullif(p_fields ->> 'ship_date', '')::date else o.ship_date end,
    remark        = case when p_fields ? 'remark'        then coalesce(p_fields ->> 'remark', '')        else o.remark end
  where o.id = p_id and o.version = p_version
    and o.review_status in ('needs_review', 'needs_check') and o.jst_status = 'none'
  returning o.version into v_new;

  if v_new is null then
    if exists (select 1 from public.receipt_orders x where x.id = p_id and x.version = p_version) then
      raise exception 'locked';
    end if;
    raise exception 'version_conflict';
  end if;

  if p_items is not null then
    delete from public.receipt_order_items where order_id = p_id;
    insert into public.receipt_order_items (order_id, position, product, size, color, sku, quantity)
    select p_id, (t.ord - 1)::smallint, coalesce(t.item ->> 'product', ''), coalesce(t.item ->> 'size', ''),
           coalesce(t.item ->> 'color', ''), nullif(t.item ->> 'sku', ''), 1
    from jsonb_array_elements(p_items) with ordinality as t (item, ord);
  end if;
  return v_new;
end
$$;
revoke all on function public.receipt_save_order(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.receipt_save_order(uuid, integer, jsonb, jsonb) to authenticated;

-- ที่เก็บรูปแบบ private: อ่าน/เขียนได้เฉพาะเจ้าหน้าที่ในรายชื่อ ไม่มีสิทธิ์แก้หรือลบ
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-images', 'receipt-images', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy receipt_images_select on storage.objects for select to authenticated
  using (bucket_id = 'receipt-images' and (select receipt_private.is_active_user()));
create policy receipt_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipt-images' and (select receipt_private.is_active_user()));

-- เพิ่มเจ้าหน้าที่ (สร้างบัญชีที่ Authentication → Users ในแดชบอร์ด Supabase ก่อน แล้วรันบรรทัดนี้ทีละคน):
--   insert into public.receipt_users (user_id, email, display_name, role)
--   select id, email, 'ชื่อที่แสดง', 'admin' from auth.users where email = 'staff@example.com';
-- ปิดการใช้งาน:  update public.receipt_users set active = false where email = 'staff@example.com';
