-- Receipt Desk — ลบใบสั่งซื้อที่ดึงมาผิด (รันหลัง receipt_desk_schema_v1.sql และ receipt_desk_access_v1.sql)
-- กติกา: ลบได้เฉพาะใบที่ยังรอตรวจ/ต้องตรวจเพิ่ม และยังไม่ลง JST — ใบที่ยืนยันแล้วหรือปฏิเสธแล้วลบไม่ได้
-- ประวัติใน receipt_events ยังอยู่ (order_id กลายเป็น null แต่ details เก็บรหัสใบ/เลขที่บิล/ชื่อลูกค้าไว้)

alter table public.receipt_events
  drop constraint if exists receipt_events_order_id_fkey,
  add constraint receipt_events_order_id_fkey
    foreign key (order_id) references public.receipt_orders (id) on delete set null;

grant delete on public.receipt_orders to authenticated;

drop policy if exists receipt_orders_delete on public.receipt_orders;
create policy receipt_orders_delete on public.receipt_orders for delete to authenticated
  using ((select receipt_private.is_active_user())
    and review_status in ('needs_review', 'needs_check')
    and jst_status = 'none');

-- ลบรูปของใบที่ลบแล้วออกจาก Storage ได้ (เซิร์ฟเวอร์ทำให้หลังลบแถวสำเร็จ)
drop policy if exists receipt_images_delete on storage.objects;
create policy receipt_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipt-images' and (select receipt_private.is_active_user()));
