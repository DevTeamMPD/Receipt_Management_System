-- Receipt Desk — รับรูปใบสั่งซื้อจากกลุ่ม LINE ผ่าน LINE OA (รันหลังไฟล์ receipt_desk_* ก่อนหน้า)
-- กลุ่ม LINE 1 กลุ่ม = 1 สาขา · รูปทุกรูปเข้า "กล่องรับรูป" ก่อน OCR ตัดสิน — เป็นใบสั่งซื้อจึงสร้างใบ ไม่ใช่ก็ทิ้งรูป
-- เขียนโดยบัญชีระบบของ LINE (ผู้ใช้ใน receipt_users) ผ่าน RLS เหมือนผู้ใช้ทั่วไป ไม่ใช้คีย์ service role

-- กลุ่มที่บอทอยู่ — branch ว่าง = ยังไม่ผูกสาขา (รูปจากกลุ่มนี้ยังไม่ถูกรับ จนกว่าผู้ดูแลจะตั้งสาขา)
create table if not exists public.receipt_line_groups (
  group_id text primary key,
  group_name text not null default '',
  branch text check (branch is null or length(btrim(branch)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- กล่องรับรูป: 1 รูปจาก LINE = 1 แถว (message_id ไม่ซ้ำ กัน LINE ส่ง webhook ซ้ำ)
create table if not exists public.receipt_line_inbox (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  group_id text not null references public.receipt_line_groups (group_id),
  branch text not null,
  sender_user_id text,
  sender_name text,
  image_path text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'order', 'ignored', 'failed')),
  attempts smallint not null default 0,
  last_error text,
  order_id uuid references public.receipt_orders (id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists receipt_line_inbox_todo_idx on public.receipt_line_inbox (status, updated_at) where status in ('pending', 'processing', 'failed');

create or replace function public.receipt_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
drop trigger if exists receipt_line_groups_touch on public.receipt_line_groups;
create trigger receipt_line_groups_touch before update on public.receipt_line_groups for each row execute function public.receipt_touch_updated_at();
drop trigger if exists receipt_line_inbox_touch on public.receipt_line_inbox;
create trigger receipt_line_inbox_touch before update on public.receipt_line_inbox for each row execute function public.receipt_touch_updated_at();

alter table public.receipt_line_groups enable row level security;
alter table public.receipt_line_inbox enable row level security;
revoke all on public.receipt_line_groups, public.receipt_line_inbox from anon, authenticated;
grant select, insert, update on public.receipt_line_groups to authenticated;
grant select, insert, update on public.receipt_line_inbox to authenticated;

drop policy if exists receipt_line_groups_select on public.receipt_line_groups;
create policy receipt_line_groups_select on public.receipt_line_groups for select to authenticated using ((select receipt_private.is_active_user()));
drop policy if exists receipt_line_groups_insert on public.receipt_line_groups;
create policy receipt_line_groups_insert on public.receipt_line_groups for insert to authenticated with check ((select receipt_private.is_active_user()));
drop policy if exists receipt_line_groups_update on public.receipt_line_groups;
create policy receipt_line_groups_update on public.receipt_line_groups for update to authenticated
  using ((select receipt_private.is_active_user())) with check ((select receipt_private.is_active_user()));

drop policy if exists receipt_line_inbox_select on public.receipt_line_inbox;
create policy receipt_line_inbox_select on public.receipt_line_inbox for select to authenticated using ((select receipt_private.is_active_user()));
drop policy if exists receipt_line_inbox_insert on public.receipt_line_inbox;
create policy receipt_line_inbox_insert on public.receipt_line_inbox for insert to authenticated with check ((select receipt_private.is_active_user()));
drop policy if exists receipt_line_inbox_update on public.receipt_line_inbox;
create policy receipt_line_inbox_update on public.receipt_line_inbox for update to authenticated
  using ((select receipt_private.is_active_user())) with check ((select receipt_private.is_active_user()));

comment on table public.receipt_line_groups is 'Receipt Desk: กลุ่ม LINE ที่บอทอยู่ และสาขาที่ผูกไว้ (branch ว่าง = ยังไม่รับรูป)';
comment on table public.receipt_line_inbox is 'Receipt Desk: รูปจากกลุ่ม LINE ที่รอ OCR ตัดสินว่าเป็นใบสั่งซื้อหรือไม่ (มีรูปลูกค้า ใช้สิทธิ์เดียวกับใบสั่งซื้อ)';

-- ผูกกลุ่มกับสาขาเอง (เมื่อชื่อกลุ่มไม่มีชื่อสาขา หรือมีหลายสาขา):
--   update public.receipt_line_groups set branch = 'บางนา' where group_name = 'ชื่อกลุ่ม';
-- บัญชีระบบของ LINE (สร้างที่ Authentication → Users ก่อน แล้วรันบรรทัดนี้):
--   insert into public.receipt_users (user_id, email, display_name, role)
--   select id, email, 'LINE OA', 'office_sales' from auth.users where email = '<อีเมลบัญชีระบบ>';
