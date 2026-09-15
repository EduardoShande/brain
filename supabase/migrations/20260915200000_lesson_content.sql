-- lesson_content: one full explanation page per roadmap lesson.
-- Lessons of the free course are readable by any signed-in student; every
-- other lesson needs active Pro access, the same rule as course_content.

create table public.lesson_content (
  lesson_id   text primary key check (lesson_id ~ '^[a-z0-9]{2,12}$'),
  route       text not null check (route ~ '^[a-z0-9-]{2,40}$'),
  is_free     boolean not null default false,
  html        text not null,
  es          jsonb not null default '{}'::jsonb check (jsonb_typeof(es) = 'object'),
  updated_at  timestamptz not null default now()
);

create index lesson_content_route_idx on public.lesson_content (route);

alter table public.lesson_content enable row level security;

create policy "lesson_content: free lessons, or any lesson with active access"
  on public.lesson_content for select to authenticated
  using (is_free or (select public.has_access()));

create trigger lesson_content_set_updated_at
  before update on public.lesson_content
  for each row execute function public.set_updated_at();
