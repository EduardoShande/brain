-- =====================================================================
-- Recall cards for the paid courses
--
-- The free course ships its cards inside the page. These are the paid
-- ones, so they live here and are returned only to an account with
-- active access, exactly like course_content and lesson_content.
--
-- Rows are written by the temporary upload function in
-- 20261014030000_upload_review_cards.sql, which is dropped right after.
-- =====================================================================

create table public.review_cards (
  id         text primary key check (char_length(id) between 1 and 64),
  route      text not null check (char_length(route) between 1 and 32),
  lesson_id  text not null check (char_length(lesson_id) between 1 and 64),
  q_en       text not null check (char_length(q_en) between 1 and 400),
  a_en       text not null check (char_length(a_en) between 1 and 600),
  q_es       text not null check (char_length(q_es) between 1 and 400),
  a_es       text not null check (char_length(a_es) between 1 and 600),
  updated_at timestamptz not null default now()
);

create index review_cards_lesson_idx on public.review_cards (lesson_id);

alter table public.review_cards enable row level security;

create policy "review_cards: readable with active access"
  on public.review_cards for select to authenticated
  using (public.has_access());
