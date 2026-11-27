-- Receipt Desk — สาขาเก็บในฐานข้อมูล ผู้ดูแลเพิ่ม/ซ่อนได้ในหน้า "กลุ่ม LINE" (รันหลัง receipt_desk_line_v2.sql)
-- เดิม: รายชื่อสาขามาจาก env RECEIPT_BRANCHES (ค่าเริ่มต้น 4 สาขา) แก้ต้อง deploy ใหม่ — ใช้ไม่ไหวเมื่อมีกลุ่ม LINE 40 กว่ากลุ่ม
-- ระบบยังถอยไปใช้ env เมื่อยังไม่มีตารางนี้ หรือยังไม่มีสาขาที่เปิดใช้ ใบสั่งซื้อเก็บชื่อสาขาเป็นข้อความ (ซ่อนสาขาไม่กระทบใบเก่า)
create table if not exists public.receipt_branches (
  name text primary key check (name = btrim(name) and length(name) between 1 and 60),
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists receipt_branches_touch on public.receipt_branches;
create trigger receipt_branches_touch before update on public.receipt_branches for each row execute function public.receipt_touch_updated_at();

create or replace function receipt_private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.receipt_users u where u.user_id = (select auth.uid()) and u.active and u.role = 'admin')
$$;
revoke all on function receipt_private.is_admin() from public, anon;
grant execute on function receipt_private.is_admin() to authenticated;

alter table public.receipt_branches enable row level security;
revoke all on public.receipt_branches from anon, authenticated;
grant select, insert, update on public.receipt_branches to authenticated;
drop policy if exists receipt_branches_select on public.receipt_branches;
create policy receipt_branches_select on public.receipt_branches for select to authenticated using ((select receipt_private.is_active_user()));
drop policy if exists receipt_branches_insert on public.receipt_branches;
create policy receipt_branches_insert on public.receipt_branches for insert to authenticated with check ((select receipt_private.is_admin()));
drop policy if exists receipt_branches_update on public.receipt_branches;
create policy receipt_branches_update on public.receipt_branches for update to authenticated
  using ((select receipt_private.is_admin())) with check ((select receipt_private.is_admin()));

-- เริ่มจากสาขาที่ใช้อยู่แล้ว (ค่าเริ่มต้นเดิม + ที่มีในใบสั่งซื้อ/กลุ่ม LINE)
insert into public.receipt_branches (name, created_by)
select distinct btrim(b), null::uuid from (
  select unnest(array['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต']) as b
  union select branch from public.receipt_orders
  union select branch from public.receipt_line_groups where branch is not null
) s where btrim(b) <> ''
on conflict (name) do nothing;

comment on table public.receipt_branches is 'Receipt Desk: รายชื่อสาขา (ผู้ดูแลเพิ่ม/ซ่อนในหน้า "กลุ่ม LINE") · active = แสดงในตัวเลือก';
