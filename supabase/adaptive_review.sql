-- Atomic, owner-scoped review transitions. Existing schedule/history remains intact.
alter table public.cards add column if not exists review_failures integer not null default 0;
alter table public.cards add column if not exists mastery_level text;
alter table public.cards add column if not exists last_attempts integer;
alter table public.review_logs add column if not exists request_id uuid;
alter table public.review_logs add column if not exists result jsonb;
do $$ begin
 if not exists (select 1 from pg_constraint where conrelid='public.cards'::regclass and conname='cards_mastery_level_check') then
  alter table public.cards add constraint cards_mastery_level_check check (mastery_level in ('difficult','challenging','okay','perfect'));
 end if;
 if not exists (select 1 from pg_constraint where conrelid='public.cards'::regclass and conname='cards_review_counts_check') then
  alter table public.cards add constraint cards_review_counts_check check (review_failures between 0 and 10000 and (last_attempts is null or last_attempts between 1 and 10001));
 end if;
end $$;
create unique index if not exists review_logs_request_id_idx on public.review_logs(request_id) where request_id is not null;

create or replace function public.record_adaptive_review(p_user_id uuid, p_card_id uuid, p_rating text, p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 c public.cards%rowtype; prior public.review_logs%rowtype; result_json jsonb;
 next_failures integer; next_attempts integer; next_level text; next_due timestamptz;
 next_interval integer; next_reps integer; next_ease double precision; review_time timestamptz;
begin
 if p_user_id is null or p_card_id is null or p_request_id is null or p_rating is null or p_rating not in ('Again','Good') then
  raise exception 'invalid review' using errcode='22023';
 end if;
 select * into c from public.cards where id=p_card_id and user_id=p_user_id for update;
 if not found then raise exception 'card not found' using errcode='P0002'; end if;
 review_time := clock_timestamp();
 select * into prior from public.review_logs where request_id=p_request_id;
 if found then
  if prior.user_id<>p_user_id or prior.card_id<>p_card_id or prior.rating<>p_rating or prior.result is null then
   raise exception 'request id conflict' using errcode='23505';
  end if;
  return prior.result;
 end if;
 if p_rating='Again' then
  next_failures := least(c.review_failures+1,10000);
  next_attempts := c.last_attempts; next_level := c.mastery_level;
  next_reps := 0; next_interval := 0; next_ease := greatest(1.3,c.ease_factor-0.2);
  next_due := review_time + interval '10 minutes';
 else
  next_attempts := c.review_failures+1; next_failures := 0;
  next_level := case when next_attempts=1 then 'perfect' when next_attempts=2 then 'okay' when next_attempts=3 then 'challenging' else 'difficult' end;
  next_ease := case when next_attempts=1 then least(3.0,c.ease_factor+0.05) else greatest(1.3,c.ease_factor-0.05) end;
  next_reps := c.repetitions+1;
  if next_attempts >= 4 then next_due := review_time + interval '20 minutes'; next_interval := 0;
  elsif next_attempts = 3 then next_due := review_time + interval '2 hours'; next_interval := 0;
  elsif next_attempts = 2 then next_due := review_time + interval '12 hours'; next_interval := 0;
  elsif c.last_reviewed_at is not null and c.due_at > review_time then
   -- Practising ahead of schedule must not artificially extend the interval.
   next_due := c.due_at; next_interval := c.interval_days; next_reps := c.repetitions; next_ease := c.ease_factor;
  else
   next_interval := case when c.interval_days<=0 then 1 else least(365, greatest(c.interval_days+1, round(c.interval_days*2.0)::integer)) end;
   next_due := review_time + next_interval * interval '1 day';
  end if;
 end if;
 update public.cards set review_failures=next_failures,last_attempts=next_attempts,mastery_level=next_level,
  repetitions=next_reps,interval_days=next_interval,ease_factor=next_ease,due_at=next_due,
  last_rating=p_rating,last_reviewed_at=review_time where id=p_card_id and user_id=p_user_id;
 result_json := jsonb_build_object('ok',true,'review_failures',next_failures,'last_attempts',next_attempts,
  'mastery_level',next_level,'repetitions',next_reps,'interval_days',next_interval,'ease_factor',next_ease,
  'due_at',next_due,'last_reviewed_at',review_time,'last_rating',p_rating);
 insert into public.review_logs(user_id,card_id,rating,reviewed_at,request_id,result)
 values(p_user_id,p_card_id,p_rating,review_time,p_request_id,result_json);
 return result_json;
end $$;
revoke all on function public.record_adaptive_review(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_adaptive_review(uuid,uuid,text,uuid) to service_role;
grant select,insert on public.review_logs to service_role;
grant select,update on public.cards to service_role;
