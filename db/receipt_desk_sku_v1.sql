-- Receipt Desk — ความจำ SKU: สินค้า + ขนาด + สี → SKU ที่เจ้าหน้าที่กรอกล่าสุด (รันหลัง receipt_desk_branches_v1.sql)
-- ใบใหม่ที่มีชุดเดียวกันจะถูกเติม SKU ให้อัตโนมัติ · ช่อง SKU ของรายการสินค้า (receipt_order_items.sku) มีอยู่แล้วตั้งแต่ schema v1
-- ยังไม่มีตารางนี้ = ช่อง SKU ยังกรอกและบันทึกได้ตามปกติ แค่ระบบยังไม่จำ
-- combo_key = สินค้า|ขนาด|สี แบบตัวพิมพ์เล็กและตัดช่องว่างทั้งหมด (สร้างโดยแอป — ดู src/sku.js) · ไม่มีข้อมูลลูกค้า
create table if not exists public.receipt_sku_memory (
  combo_key text primary key check (length(combo_key) between 1 and 700),
  product text not null check (length(product) <= 200),
  size text not null default '' check (length(size) <= 200),
  color text not null default '' check (length(color) <= 200),
  sku text not null check (sku = btrim(sku) and length(sku) between 1 and 100),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists receipt_sku_memory_touch on public.receipt_sku_memory;
create trigger receipt_sku_memory_touch before update on public.receipt_sku_memory for each row execute function public.receipt_touch_updated_at();

-- เจ้าหน้าที่ทุกคนที่เปิดใช้อ่านและสอนระบบได้ (กรอก SKU ตอนตรวจใบ) · ไม่มีสิทธิ์ลบ
alter table public.receipt_sku_memory enable row level security;
revoke all on public.receipt_sku_memory from anon, authenticated;
grant select, insert, update on public.receipt_sku_memory to authenticated;
drop policy if exists receipt_sku_memory_select on public.receipt_sku_memory;
create policy receipt_sku_memory_select on public.receipt_sku_memory for select to authenticated using ((select receipt_private.is_active_user()));
drop policy if exists receipt_sku_memory_insert on public.receipt_sku_memory;
create policy receipt_sku_memory_insert on public.receipt_sku_memory for insert to authenticated with check ((select receipt_private.is_active_user()));
drop policy if exists receipt_sku_memory_update on public.receipt_sku_memory;
create policy receipt_sku_memory_update on public.receipt_sku_memory for update to authenticated
  using ((select receipt_private.is_active_user())) with check ((select receipt_private.is_active_user()));

comment on table public.receipt_sku_memory is 'Receipt Desk: SKU ที่จำไว้ต่อชุด สินค้า+ขนาด+สี (เติมให้ใบใหม่อัตโนมัติ) ไม่มีข้อมูลลูกค้า';

-- เริ่มต้นจาก SKU ที่เคยกรอกไว้ในใบเดิม (ถ้ามี): ใช้ค่าล่าสุดของแต่ละชุด
insert into public.receipt_sku_memory (combo_key, product, size, color, sku, updated_by)
select distinct on (k) k, product, size, color, btrim(sku), null::uuid
from (
  select lower(regexp_replace(product, '\s', '', 'g')) || '|' || lower(regexp_replace(size, '\s', '', 'g')) || '|' || lower(regexp_replace(color, '\s', '', 'g')) as k,
         product, size, color, sku, created_at
  from public.receipt_order_items
  where btrim(coalesce(sku, '')) <> '' and btrim(product) <> ''
) t
order by k, created_at desc
on conflict (combo_key) do nothing;
