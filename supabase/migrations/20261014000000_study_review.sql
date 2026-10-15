-- =====================================================================
-- Spaced review
--
-- The two study techniques with the strongest evidence behind them are
-- practice testing and distributed practice (Dunlosky et al. 2013), so
-- every lesson a student finishes turns into recall cards that come back
-- on a widening schedule.
--
-- study_state is one row per card per student: when it is due, how long
-- the current gap is, and how easily they recall it.
-- study_days is one row per day: what the review page and, later, a
-- progress report read to show the work actually done.
-- =====================================================================

create table public.study_state (
  user_id       uuid not null references auth.users (id) on delete cascade,
  card_id       text not null check (char_length(card_id) between 1 and 64),
  due_on        date not null,
  interval_days integer not null default 0 check (interval_days between 0 and 365),
  ease          smallint not null default 250 check (ease between 130 and 400),
  reps          integer not null default 0 check (reps >= 0),
  lapses        integer not null default 0 check (lapses >= 0),
  last_grade    smallint check (last_grade between 0 and 3),
  updated_at    timestamptz not null default now(),
  primary key (user_id, card_id)
);

create index study_state_due_idx on public.study_state (user_id, due_on);

alter table public.study_state enable row level security;

create policy "study_state: owner can read"
  on public.study_state for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "study_state: owner can insert"
  on public.study_state for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "study_state: owner can update"
  on public.study_state for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table public.study_days (
  user_id   uuid not null references auth.users (id) on delete cascade,
  day       date not null,
  reviewed  integer not null default 0 check (reviewed >= 0),
  recalled  integer not null default 0 check (recalled >= 0),
  minutes   integer not null default 0 check (minutes >= 0),
  primary key (user_id, day)
);

alter table public.study_days enable row level security;

create policy "study_days: owner can read"
  on public.study_days for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "study_days: owner can insert"
  on public.study_days for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "study_days: owner can update"
  on public.study_days for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
