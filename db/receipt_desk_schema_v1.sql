-- Receipt Desk schema v1: additive only, every object is prefixed receipt_
-- Applied to the Supabase project as migration "receipt_desk_schema_v1" on 2026-11-25.
-- Holds customer personal data (name, phone, address): RLS on, no policies, no anon/authenticated grants.

create or replace function public.receipt_orders_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end
$$;

create or replace function public.receipt_events_block_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'receipt_events is append-only';
end
$$;

-- ใบสั่งซื้อ 1 ใบ = 1 แถว (ฟิลด์ที่คนตรวจแล้ว แยกจากผล OCR ดิบ)
create table public.receipt_orders (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  code text generated always as ('RCP-' || lpad(seq::text, 4, '0')) stored,
  branch text not null check (length(btrim(branch)) > 0),
  source text not null default 'upload' check (source in ('upload', 'line')),
  sender_name text,
  received_at timestamptz not null default now(),
  image_path text,

  ocr_status text not null default 'pending' check (ocr_status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  review_status text not null default 'needs_review' check (review_status in ('needs_review', 'needs_check', 'confirmed', 'rejected')),
  reject_reason text,
  jst_status text not null default 'none' check (jst_status in ('none', 'queued', 'running', 'succeeded', 'failed', 'manual_required')),

  bill_number text not null default '',
  order_date date,
  total numeric(14,2) check (total is null or total >= 0),
  customer_name text not null default '',
  phone text not null default '',
  address text not null default '',
  sub_district text not null default '',
  district text not null default '',
  province text not null default '',
  postcode text not null default '',
  ship_date date,
  remark text not null default '',
  pos_number text not null default '',
  pos_total numeric(14,2) check (pos_total is null or pos_total >= 0),

  ocr_provider text,
  ocr_model text,
  ocr_confidence smallint check (ocr_confidence is null or ocr_confidence between 0 and 100),
  ocr_uncertain text[] not null default '{}',
  ocr_original jsonb,
  ocr_raw_text text,
  duplicate_of uuid references public.receipt_orders (id) on delete set null,

  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint receipt_orders_code_key unique (code),
  constraint receipt_orders_seq_key unique (seq),
  -- ตรวจซ้ำฝั่งฐานข้อมูล: ยืนยันได้ต่อเมื่อข้อมูลครบและถูกรูปแบบ (ตรงกับกฎใน UI)
  constraint receipt_orders_confirmed_is_valid check (
    review_status <> 'confirmed' or (
      length(btrim(bill_number)) > 0 and order_date is not null and total > 0
      and length(btrim(customer_name)) > 0 and phone ~ '^0[0-9]{9}$'
      and length(btrim(address)) > 0 and length(btrim(sub_district)) > 0
      and length(btrim(district)) > 0 and length(btrim(province)) > 0
      and postcode ~ '^[0-9]{5}$'
    )
  ),
  constraint receipt_orders_jst_needs_confirmed check (jst_status = 'none' or review_status = 'confirmed'),
  constraint receipt_orders_rejected_needs_reason check (review_status <> 'rejected' or length(btrim(coalesce(reject_reason, ''))) > 0)
);

create table public.receipt_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.receipt_orders (id) on delete cascade,
  position smallint not null default 0,
  product text not null default '',
  size text not null default '',
  color text not null default '',
  sku text,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

-- ประวัติการทำงาน (เพิ่มอย่างเดียว ห้ามแก้/ลบ) — อย่าเก็บค่าข้อมูลลูกค้าในช่อง details ให้เก็บแค่ชื่อฟิลด์ที่เปลี่ยน
create table public.receipt_events (
  id bigint generated always as identity primary key,
  order_id uuid references public.receipt_orders (id) on delete restrict,
  actor uuid,
  actor_label text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- บันทึกการเรียก OCR แต่ละครั้ง (ไม่มีข้อมูลลูกค้า) ไว้ดูโควตา ความเร็ว และอัตราล้มเหลว
create table public.receipt_ocr_runs (
  id bigint generated always as identity primary key,
  order_id uuid references public.receipt_orders (id) on delete set null,
  provider text not null,
  model text,
  ok boolean not null,
  http_status smallint,
  error_code text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  created_at timestamptz not null default now()
);

create trigger receipt_orders_touch before update on public.receipt_orders
  for each row execute function public.receipt_orders_touch();
create trigger receipt_events_no_update before update or delete on public.receipt_events
  for each row execute function public.receipt_events_block_change();

create index receipt_orders_branch_created_idx on public.receipt_orders (branch, created_at desc);
create index receipt_orders_review_created_idx on public.receipt_orders (review_status, created_at desc);
create index receipt_orders_dedupe_idx on public.receipt_orders (lower(bill_number), total) where bill_number <> '';
create index receipt_orders_duplicate_of_idx on public.receipt_orders (duplicate_of) where duplicate_of is not null;
create index receipt_order_items_order_idx on public.receipt_order_items (order_id, position);
create index receipt_events_order_idx on public.receipt_events (order_id, created_at);
create index receipt_ocr_runs_created_idx on public.receipt_ocr_runs (created_at desc);
create index receipt_ocr_runs_order_idx on public.receipt_ocr_runs (order_id) where order_id is not null;

-- ความปลอดภัย: เปิด RLS และไม่มี policy = เข้าผ่าน API ของ anon/authenticated ไม่ได้ (เปิดสิทธิ์ทีหลังพร้อม policy ตาม role)
alter table public.receipt_orders enable row level security;
alter table public.receipt_order_items enable row level security;
alter table public.receipt_events enable row level security;
alter table public.receipt_ocr_runs enable row level security;
revoke all on public.receipt_orders, public.receipt_order_items, public.receipt_events, public.receipt_ocr_runs from anon, authenticated;

comment on table public.receipt_orders is 'Receipt Desk: ใบสั่งซื้อ (มีข้อมูลส่วนบุคคลของลูกค้า: ชื่อ เบอร์โทร ที่อยู่)';
comment on table public.receipt_order_items is 'Receipt Desk: รายการสินค้าในใบสั่งซื้อ';
comment on table public.receipt_events is 'Receipt Desk: audit log แบบเพิ่มอย่างเดียว ห้ามเก็บข้อมูลลูกค้าใน details';
comment on table public.receipt_ocr_runs is 'Receipt Desk: บันทึกการเรียก OCR (ไม่มีข้อมูลลูกค้า)';
comment on column public.receipt_orders.ocr_raw_text is 'ข้อความ OCR ดิบ มีข้อมูลลูกค้า ใช้สิทธิ์เดียวกับตาราง';
