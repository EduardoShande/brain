-- =====================================================================
-- Lesson progress in the account
--
-- Progress used to live only in the browser, so clearing site data wiped
-- a paid student's work and a phone and a laptop never agreed. One row
-- per lesson a student has finished, owned by them and nobody else.
-- =====================================================================

create table public.lesson_progress (
  user_id   uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null check (char_length(lesson_id) between 1 and 64),
  done_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create index lesson_progress_user_idx on public.lesson_progress (user_id, done_at desc);

alter table public.lesson_progress enable row level security;

create policy "lesson_progress: owner can read"
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "lesson_progress: owner can insert"
  on public.lesson_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "lesson_progress: owner can delete"
  on public.lesson_progress for delete to authenticated
  using ((select auth.uid()) = user_id);
