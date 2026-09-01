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
-- 좌석 배정 방식: free(자유석, 아무 자리나) / assigned(지정자석, 학생마다 정해진 자리)
alter table study_rooms add column if not exists seating_mode text not null default 'free' check (seating_mode in ('free','assigned'));
-- 관리자가 admin.html [학생 입출입] 탭(키오스크 모드)에서 관리 화면으로 되돌아갈 때 필요한 4자리 비밀번호
alter table study_rooms add column if not exists kiosk_pin text;

-- ── 2. seats : 좌석 정보 ───────────────────────────────────────
-- kind='block'인 행은 실제 좌석이 아니라 배치도에서 "이 공간은 제외"
-- 표시용으로 쓰는 사각형입니다 (벽/기둥/통로 등).
create table if not exists seats (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references study_rooms(id) on delete cascade,
  seat_number int not null,
  label text,
  x numeric not null default 10,
  y numeric not null default 10,
  width numeric not null default 9,
  height numeric not null default 9,
  status text not null default 'empty' check (status in ('empty','studying','in_class','away')),
  kind text not null default 'seat' check (kind in ('seat','block')),
  created_at timestamptz not null default now(),
  unique (room_id, seat_number)
);
alter table seats add column if not exists kind text not null default 'seat' check (kind in ('seat','block'));

-- 지정자석용: 이 좌석이 어느 학생 전용인지 (자유석 모드에서는 무시됨)
alter table seats add column if not exists assigned_student_id uuid references planner_students(id) on delete set null;
create unique index if not exists idx_seats_assigned_student on seats(assigned_student_id) where assigned_student_id is not null;

-- 좌석 상태를 비어있음/공부중/학원수업중/외출중으로 확장했었으나('예약'은
-- 제거), 체크인 기록 없는 좌석에 관리자가 공부중/학원수업중/외출중을
-- 직접 칠할 수 있게 열어둔 게 "진짜 학생이 있는 건지 관리자가 그냥
-- 칠해둔 건지" 헷갈리게 만들어서 다시 없앴습니다. 이제 관리자 화면은
-- seats.status를 empty로만 다루고, 실제 상태는 항상 attendance.status
-- (학생의 체크인/PIN 입력)에서만 나옵니다. 예전에 칠해뒀던 값들도 정리합니다.
update seats set status='empty' where status not in ('empty','studying','in_class','away');
update seats set status='empty' where status<>'empty';
do $$
begin
  alter table seats drop constraint if exists seats_status_check;
  alter table seats add constraint seats_status_check
    check (status in ('empty','studying','in_class','away'));
exception when others then null;
end $$;

-- ── 3. attendance : 출석 기록 ──────────────────────────────────
-- status: studying(공부중) / in_class(학원수업중) / away(외출중) / checked_out(퇴실)
-- 체크인~체크아웃 사이에는 세션이 유지된 채로 status만 바뀝니다 (좌석은 계속 그 학생 것).
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references planner_students(id) on delete cascade,
  room_id uuid not null references study_rooms(id) on delete cascade,
  seat_id uuid references seats(id) on delete set null,
  checkin_at timestamptz not null default now(),
  checkout_at timestamptz,
  status text not null default 'studying' check (status in ('studying','in_class','away','checked_out')),
  created_at timestamptz not null default now()
);

-- 체크인 당시 좌석 번호를 그대로 저장해둡니다. seats.seat_id는 나중에 도면을
-- 다시 배치하거나 좌석을 삭제하면 값이 바뀌거나 사라질 수 있어서(on delete
-- set null), 지나간 출석 기록의 좌석 번호까지 함께 사라지는 문제가 있었습니다.
alter table attendance add column if not exists seat_number int;
update attendance set seat_number = seats.seat_number
  from seats where attendance.seat_id = seats.id and attendance.seat_number is null;

create index if not exists idx_attendance_student on attendance(student_id);
create index if not exists idx_attendance_room_date on attendance(room_id, checkin_at);
create index if not exists idx_attendance_active on attendance(room_id) where checkout_at is null;

-- ── 3-1. attendance_status_log : 상태 변경 이력(순공시간 계산용) ──────
-- attendance 한 건(체크인~체크아웃) 동안 상태가 바뀔 때마다 한 줄씩 기록됩니다.
-- 실제 순공시간 = 이 로그를 기준으로 status='studying' 구간의 합.
create table if not exists attendance_status_log (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendance(id) on delete cascade,
  status text not null check (status in ('studying','in_class','away','checked_out')),
  changed_at timestamptz not null default now()
);
create index if not exists idx_status_log_attendance on attendance_status_log(attendance_id, changed_at);

alter table attendance_status_log enable row level security;
drop policy if exists "public full access" on attendance_status_log;
create policy "public full access" on attendance_status_log for all using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table attendance_status_log;
exception when duplicate_object then null;
end $$;

-- ── 4. planner_students 컬럼 추가 ─────────────────────────────
alter table planner_students add column if not exists student_pin varchar(4) unique;
alter table planner_students add column if not exists room_id uuid references study_rooms(id) on delete set null;
alter table planner_students add column if not exists parent_phone text;
-- 학생 본인 휴대폰번호 (뒷자리 4개를 PIN으로 자동 사용)
alter table planner_students add column if not exists student_phone text;
-- 시험 성적(등수/수강자수) + 학습전략 — 플래니(index.html)에서 학생이 직접 입력
alter table planner_students add column if not exists exam_scores jsonb not null default '[]'::jsonb;

-- 이미 위 SQL을 한 번 실행한 적이 있다면(테이블이 이미 존재하면) 아래 줄들이
-- 새로 추가된 컬럼/상태값을 기존 테이블에 안전하게 반영해줍니다.
alter table study_rooms add column if not exists canvas_height integer not null default 420;

-- 수강 과목: ["kor","math","eng","sci","soc","hist"] 형태의 JSON 배열로 저장
alter table planner_students add column if not exists subjects jsonb not null default '[]'::jsonb;

-- 잠깐 쉬는 학생을 삭제하지 않고 "중단" 처리할 수 있도록 (기록은 그대로 보존)
alter table planner_students add column if not exists is_paused boolean not null default false;

-- attendance.status를 공부중/학원수업중/외출중/퇴실 4단계로 확장
-- (기존에 'checked_in'/'checked_out' 2단계로 실행했던 경우를 위한 마이그레이션)
update attendance set status='studying' where status='checked_in';
alter table attendance alter column status set default 'studying';
do $$
begin
  alter table attendance drop constraint if exists attendance_status_check;
  alter table attendance add constraint attendance_status_check
    check (status in ('studying','in_class','away','checked_out'));
exception when others then null;
end $$;

-- ── 5. Realtime 활성화 (좌석 실시간 업데이트용) ────────────────
-- 이미 등록돼 있으면 조용히 건너뜁니다 (여러 번 실행해도 안전).
do $$
begin
  alter publication supabase_realtime add table attendance;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table seats;
exception when duplicate_object then null;
end $$;

-- ── 6. RLS — 기존 planner_students와 동일하게 anon key로 전체
--      CRUD가 가능하도록 개방형 정책을 둡니다 (별도 로그인 없이
--      admin.html / checkin.html이 anon key만으로 동작하는 구조).
alter table study_rooms enable row level security;
alter table seats enable row level security;
alter table attendance enable row level security;

drop policy if exists "public full access" on study_rooms;
create policy "public full access" on study_rooms for all using (true) with check (true);
drop policy if exists "public full access" on seats;
create policy "public full access" on seats for all using (true) with check (true);
drop policy if exists "public full access" on attendance;
create policy "public full access" on attendance for all using (true) with check (true);

-- ── 7. Storage — 도면 이미지 업로드용 버킷 ─────────────────────
insert into storage.buckets (id, name, public)
values ('floorplans', 'floorplans', true)
on conflict (id) do nothing;

drop policy if exists "floorplans public read" on storage.objects;
create policy "floorplans public read"
on storage.objects for select
using (bucket_id = 'floorplans');

drop policy if exists "floorplans public write" on storage.objects;
create policy "floorplans public write"
on storage.objects for insert
with check (bucket_id = 'floorplans');

drop policy if exists "floorplans public update" on storage.objects;
create policy "floorplans public update"
on storage.objects for update
using (bucket_id = 'floorplans');

drop policy if exists "floorplans public delete" on storage.objects;
create policy "floorplans public delete"
on storage.objects for delete
using (bucket_id = 'floorplans');

-- ── 8. student_notes : 학생 상담 메모 (날짜별로 쌓이는 기록) ──────
create table if not exists student_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references planner_students(id) on delete cascade,
  note_date date not null default current_date,
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_student_notes_student on student_notes(student_id, note_date desc, created_at desc);

alter table student_notes enable row level security;
drop policy if exists "public full access" on student_notes;
create policy "public full access" on student_notes for all using (true) with check (true);

-- ── 9. 순공 랭킹 (학생에게 보여주는 이번주 TOP5) ──────────────────
-- 실명 대신 쓸 닉네임 (설정 안 하면 랭킹에서 "닉네임 미설정"으로 표시)
alter table planner_students add column if not exists nickname text;
-- 관리자가 켜야만 그 독서실 학생들에게 랭킹이 보여요 (기본은 꺼짐)
alter table study_rooms add column if not exists rank_visible boolean not null default false;
-- 학생 화면에 랭킹을 닉네임으로 보여줄지 실명으로 보여줄지 — 관리자
-- 화면(admin.html)의 랭킹은 이 설정과 상관없이 항상 실명으로 보여서
-- 관리자는 별명공개 상태여도 누가 누군지 바로 알 수 있습니다.
alter table study_rooms add column if not exists rank_name_mode text not null default 'nickname' check (rank_name_mode in ('nickname','realname'));

-- ── 10. 집중도 분석 (학생 태블릿 카메라, 지정자석 · 학부모 동의 전제) ──
-- 관리자가 켜야만 그 독서실에서 카메라 분석이 동작해요 (기본은 꺼짐).
-- 영상은 절대 저장/전송하지 않고, 태블릿 안에서 그 순간 얼굴 방향·눈
-- 감김만 판정해서 focused(집중/산만) 결과 한 줄만 남깁니다.
alter table study_rooms add column if not exists focus_tracking_enabled boolean not null default false;

create table if not exists focus_log (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendance(id) on delete cascade,
  checked_at timestamptz not null default now(),
  focused boolean not null
);
create index if not exists idx_focus_log_attendance on focus_log(attendance_id, checked_at);

alter table focus_log enable row level security;
drop policy if exists "public full access" on focus_log;
create policy "public full access" on focus_log for all using (true) with check (true);

-- ── 11. 실시간 공부모습 (관리자 화면에서 라이브로만 보기, 저장 없음) ──
-- 영상은 학생 태블릿 → 관리자 화면으로 WebRTC로 직접 전송되고 어디에도
-- 저장되지 않습니다. 시그널링(연결 정보 교환)만 Supabase Realtime
-- Broadcast로 주고받아서, 별도 DB 테이블은 필요 없습니다.
alter table study_rooms add column if not exists live_view_enabled boolean not null default false;

-- ── 12. 집중도 분석 사유 (리포트에서 "왜 이 점수가 나왔는지" 설명용) ──
-- focused만으로는 산만 판정의 이유(얼굴 안 보임/고개 돌림/졸음)를 알 수
-- 없어서, 판정 사유를 같이 남깁니다.
alter table focus_log add column if not exists reason text check (reason in ('focused','no_face','head_turned','eyes_closed'));

-- ── 13. 집중도 분석 학생별 제외 (일부 학부모/학생만 부담스러워하는 경우) ──
-- 방에서 집중도 분석을 켜면 그 방 학생 전체가 기본으로 대상이 되고,
-- 관리자가 특정 학생만 골라서 빼둘 수 있게 합니다.
alter table planner_students add column if not exists focus_tracking_opt_out boolean not null default false;

-- ── 14. 집중도 분석 사유에 "졸음(고개 숙임)" 추가 ──
-- 얼굴이 안 보인다고 무조건 자리 이탈로 보지 않고, 몸(어깨)은 보이는데
-- 얼굴만 안 보이면(엎드려 졸 때 등) 졸음으로 따로 구분합니다.
do $$
begin
  alter table focus_log drop constraint if exists focus_log_reason_check;
  alter table focus_log add constraint focus_log_reason_check
    check (reason in ('focused','no_face','head_turned','eyes_closed','dozing'));
exception when others then null;
end $$;

-- ── 15. 좌석 배치도 회전 (제외구역 등을 도면 각도에 맞게 돌리기) ──
alter table seats add column if not exists rotation numeric not null default 0;

-- ── 16. 제외구역이 좌석 번호를 차지하던 문제를 기존 데이터에도 적용 ──
-- 제외구역(kind='block')이 좌석(kind='seat')과 번호를 같이 나눠 쓰다 보니
-- 제외구역이 하나 생길 때마다 실제 좌석 번호에 구멍이 생겼습니다.
-- 이제부터 좌석은 방마다 1,2,3...으로 구멍 없이, 제외구역은 0 이하
-- 번호로 따로 관리합니다. unique(room_id, seat_number) 제약 때문에
-- 먼저 전부 큰 값으로 옮겨서 충돌을 피한 뒤 다시 정리합니다.
update seats set seat_number = seat_number + 1000000;

with ranked_seats as (
  select id, row_number() over (partition by room_id order by seat_number) as rn
  from seats where kind = 'seat'
)
update seats s set seat_number = ranked_seats.rn
from ranked_seats where s.id = ranked_seats.id;

with ranked_blocks as (
  select id, row_number() over (partition by room_id order by seat_number) as rn
  from seats where kind = 'block'
)
update seats s set seat_number = -ranked_blocks.rn
from ranked_blocks where s.id = ranked_blocks.id;

-- ── 17. 학생별 학교/학원/과외 고정 시간표 ──
-- 매일 새로 짜는 게 아니라, 학원을 옮기거나 시간표가 바뀔 때만 가끔
-- 수정하는 "요일별 반복 일정"이에요. 그래서 날짜가 아니라 요일(dow,
-- 0=일요일~6=토요일)과 시각(자정부터 몇 분째인지)로 저장해서, 특정
-- 날짜/시간대(timestamptz)로 저장할 때 생기는 시간대 변환 문제를
-- 아예 피합니다. 관리자는 이 시간표를 보고 그 학생이 독서실에서
-- 순공할 수 있는 빈 시간을 파악할 수 있어요.
create table if not exists student_weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references planner_students(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  start_min smallint not null check (start_min >= 0 and start_min < 1440),
  end_min smallint not null check (end_min > start_min and end_min <= 1440),
  label text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_student_weekly_schedule_student on student_weekly_schedule(student_id);
alter table student_weekly_schedule enable row level security;
drop policy if exists "public full access" on student_weekly_schedule;
create policy "public full access" on student_weekly_schedule for all using (true) with check (true);
