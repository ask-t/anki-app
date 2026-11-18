-- Preserve each card's latest recorded assessment for category filtering.
alter table public.cards add column if not exists last_rating text;
do $$ begin
 if not exists (select 1 from pg_constraint where conname='cards_last_rating_check' and conrelid='public.cards'::regclass) then
  alter table public.cards add constraint cards_last_rating_check check (last_rating in ('Again','Hard','Good','Easy'));
 end if;
end $$;
update public.cards c set last_rating = latest.rating
from (select distinct on (user_id,card_id) user_id,card_id,rating from public.review_logs order by user_id,card_id,reviewed_at desc,id desc) latest
where c.user_id=latest.user_id and c.id=latest.card_id and c.last_rating is null;
