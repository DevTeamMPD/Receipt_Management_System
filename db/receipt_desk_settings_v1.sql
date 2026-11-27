-- Receipt Desk — ค่าตั้งของระบบที่ผู้ดูแลแก้ได้ในหน้าเว็บ (รันหลัง receipt_desk_branches_v1.sql ซึ่งสร้าง receipt_private.is_admin())
-- ตอนนี้มีคีย์เดียว: ocr_provider = ตัวอ่าน OCR เริ่มต้น (gemini | typhoon) ทับค่า env OCR_PROVIDER
-- ยังไม่มีตาราง/ยังไม่มีแถว = ระบบใช้ OCR_PROVIDER จาก env เหมือนเดิม
create table if not exists public.receipt_settings (
  key text primary key check (key in ('ocr_provider')),
  value text not null check (length(value) between 1 and 40),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint receipt_settings_ocr_provider check (key <> 'ocr_provider' or value in ('gemini', 'typhoon'))
);
drop trigger if exists receipt_settings_touch on public.receipt_settings;
create trigger receipt_settings_touch before update on public.receipt_settings for each row execute function public.receipt_touch_updated_at();

alter table public.receipt_settings enable row level security;
revoke all on public.receipt_settings from anon, authenticated;
grant select, insert, update on public.receipt_settings to authenticated;
drop policy if exists receipt_settings_select on public.receipt_settings;
create policy receipt_settings_select on public.receipt_settings for select to authenticated using ((select receipt_private.is_active_user()));
drop policy if exists receipt_settings_insert on public.receipt_settings;
create policy receipt_settings_insert on public.receipt_settings for insert to authenticated with check ((select receipt_private.is_admin()));
drop policy if exists receipt_settings_update on public.receipt_settings;
create policy receipt_settings_update on public.receipt_settings for update to authenticated
  using ((select receipt_private.is_admin())) with check ((select receipt_private.is_admin()));

comment on table public.receipt_settings is 'Receipt Desk: ค่าตั้งที่ผู้ดูแลแก้ในหน้าเว็บ · ocr_provider = ตัวอ่าน OCR เริ่มต้น (gemini|typhoon)';
