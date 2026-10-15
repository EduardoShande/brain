-- =====================================================================
-- Temporary upload door for the paid cards
--
-- Paid content never goes in the repository, so it is pushed straight
-- into the database through this function and nothing else. It is
-- locked to a one-time token, runs as its owner, and is dropped the
-- moment the upload finishes:
--
--   drop function public.upload_review_cards(text, jsonb);
--
-- Replace REPLACE_WITH_A_LONG_RANDOM_TOKEN before running this, and use
-- the same token in the uploader.
-- =====================================================================

create or replace function public.upload_review_cards(p_token text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_token is distinct from 'REPLACE_WITH_A_LONG_RANDOM_TOKEN' then
    raise exception 'nope';
  end if;

  insert into public.review_cards (id, route, lesson_id, q_en, a_en, q_es, a_es, updated_at)
  select r->>'id', r->>'route', r->>'lesson_id', r->>'q_en', r->>'a_en', r->>'q_es', r->>'a_es', now()
  from jsonb_array_elements(p_rows) as r
  on conflict (id) do update
    set route = excluded.route, lesson_id = excluded.lesson_id,
        q_en = excluded.q_en, a_en = excluded.a_en,
        q_es = excluded.q_es, a_es = excluded.a_es, updated_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.upload_review_cards(text, jsonb) to anon, authenticated;
