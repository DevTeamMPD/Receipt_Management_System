-- Receipt Desk — แก้ให้ลบใบได้จริง (รันหลัง receipt_desk_delete_v1.sql)
-- ปัญหา: receipt_events มี trigger กันแก้/ลบทุกแถว (append-only) แต่ FK "on delete set null"
-- ต้องอัปเดต order_id ของเหตุการณ์เมื่อใบถูกลบ ทำให้การลบใบล้มเหลวด้วย "receipt_events is append-only"
-- ทางแก้: ยอมให้อัปเดตได้เฉพาะกรณีเดียว คือ order_id เปลี่ยนเป็น null เพราะใบนั้นถูกลบไปแล้ว
-- และคอลัมน์อื่นทุกคอลัมน์ต้องเหมือนเดิม — ส่วนที่เหลือยังแก้/ลบไม่ได้เหมือนเดิม

create or replace function public.receipt_events_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.order_id is not null
     and new.order_id is null
     and (to_jsonb(new) - 'order_id') = (to_jsonb(old) - 'order_id')
     and not exists (select 1 from public.receipt_orders o where o.id = old.order_id) then
    return new; -- FK on delete set null หลังลบใบ
  end if;
  raise exception 'receipt_events is append-only';
end
$$;
