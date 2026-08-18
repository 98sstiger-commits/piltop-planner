-- ============================================================
-- 필탑 플래너 · 독서실 관리 시스템 — Supabase 스키마
-- Supabase SQL Editor에서 그대로 실행하세요.
-- (기존 planner_students 테이블은 이미 존재한다고 가정합니다)
-- ============================================================

-- 확장 (gen_random_uuid 사용)
create extension if not exists pgcrypto;

-- ── 1. study_rooms : 독서실 정보 ──────────────────────────────
create table if not exists study_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default 'piltop',
  name text not null,
  description text,
  floor_image_url text,
  canvas_height integer not null default 420,
  academy_name text not null default '필탑학원',
  notify_enabled boolean not null default false,
  notify_channel text not null default 'sms' check (notify_channel in ('sms','kakao')),
  aligo_api_key text,
  aligo_user_id text,
  aligo_sender text,
  kakao_js_key text,
  auto_report_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── 2. seats : 좌석 정보 ───────────────────────────────────────
create table if not exists seats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references study_rooms(id) on delete cascade,
  seat_number int not null,
  label text,
  x numeric not null default 10,
  y numeric not null default 10,
  width numeric not null default 9,
  height numeric not null default 9,
  status text not null default 'empty' check (status in ('empty','reserved')),
  created_at timestamptz not null default now(),
  unique (room_id, seat_number)
);

-- ── 3. attendance : 출석 기록 ──────────────────────────────────
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references planner_students(id) on delete cascade,
  room_id uuid not null references study_rooms(id) on delete cascade,
  seat_id uuid references seats(id) on delete set null,
  checkin_at timestamptz not null default now(),
  checkout_at timestamptz,
  status text not null default 'checked_in' check (status in ('checked_in','checked_out')),
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_student on attendance(student_id);
create index if not exists idx_attendance_room_date on attendance(room_id, checkin_at);
create index if not exists idx_attendance_active on attendance(room_id) where checkout_at is null;

-- ── 4. planner_students 컬럼 추가 ─────────────────────────────
alter table planner_students add column if not exists student_pin varchar(4) unique;
alter table planner_students add column if not exists room_id uuid references study_rooms(id) on delete set null;
alter table planner_students add column if not exists parent_phone text;

-- 이미 위 SQL을 한 번 실행한 적이 있다면(테이블이 이미 존재하면) 아래 줄이
-- study_rooms에 좌석 배치판 높이 조절용 컬럼을 새로 추가해줍니다.
alter table study_rooms add column if not exists canvas_height integer not null default 420;

-- ── 5. Realtime 활성화 (좌석 실시간 업데이트용) ────────────────
alter publication supabase_realtime add table attendance;
alter publication supabase_realtime add table seats;

-- ── 6. RLS — 기존 planner_students와 동일하게 anon key로 전체
--      CRUD가 가능하도록 개방형 정책을 둡니다 (별도 로그인 없이
--      admin.html / checkin.html이 anon key만으로 동작하는 구조).
alter table study_rooms enable row level security;
alter table seats enable row level security;
alter table attendance enable row level security;

create policy "public full access" on study_rooms for all using (true) with check (true);
create policy "public full access" on seats for all using (true) with check (true);
create policy "public full access" on attendance for all using (true) with check (true);

-- ── 7. Storage — 도면 이미지 업로드용 버킷 ─────────────────────
insert into storage.buckets (id, name, public)
values ('floorplans', 'floorplans', true)
on conflict (id) do nothing;

create policy "floorplans public read"
on storage.objects for select
using (bucket_id = 'floorplans');

create policy "floorplans public write"
on storage.objects for insert
with check (bucket_id = 'floorplans');

create policy "floorplans public update"
on storage.objects for update
using (bucket_id = 'floorplans');

create policy "floorplans public delete"
on storage.objects for delete
using (bucket_id = 'floorplans');
