-- Run after adaptive_review.sql. All writes are rolled back.
begin;
do $$
declare
 u uuid; other_u uuid := '99999999-0000-4000-8000-000000000999';
 cid uuid; c public.cards%rowtype; result jsonb; before_result jsonb; request uuid; i integer; j integer;
 expected text[] := array['perfect','okay','challenging','difficult'];
 minimum_seconds integer[] := array[86300,43100,7100,1100];
 maximum_seconds integer[] := array[86500,43300,7300,1300];
 saved_due timestamptz;
begin
 select id into u from auth.users order by id limit 1;
 if u is null then raise exception 'Test requires a user'; end if;
 if has_function_privilege('authenticated','public.record_adaptive_review(uuid,uuid,text,uuid)','EXECUTE') or
    has_function_privilege('anon','public.record_adaptive_review(uuid,uuid,text,uuid)','EXECUTE') then
  raise exception 'Browser can execute server-only function';
 end if;
 for i in 1..4 loop
  insert into public.cards(user_id,external_id,word,japanese_meaning) values(u,'qa:adaptive:'||gen_random_uuid(),'test','テスト') returning id into cid;
  for j in 1..(i-1) loop
   request := gen_random_uuid();
   before_result := public.record_adaptive_review(u,cid,'Again',request);
   result := public.record_adaptive_review(u,cid,'Again',request);
   if result<>before_result or (select count(*) from public.review_logs where request_id=request)<>1 then raise exception 'Idempotency failed'; end if;
  end loop;
  result := public.record_adaptive_review(u,cid,'Good',gen_random_uuid());
  select * into c from public.cards where id=cid;
  if c.mastery_level<>expected[i] or c.last_attempts<>i or c.review_failures<>0 or c.last_rating<>'Good' then raise exception 'Wrong category for % attempts',i; end if;
  if extract(epoch from c.due_at-c.last_reviewed_at) not between minimum_seconds[i] and maximum_seconds[i] then raise exception 'Wrong interval for % attempts',i; end if;
  if i=1 then
   saved_due := c.due_at;
   perform public.record_adaptive_review(u,cid,'Good',gen_random_uuid());
   if (select due_at from public.cards where id=cid)<>saved_due then raise exception 'Early practice extended interval'; end if;
   update public.cards set due_at=clock_timestamp()-interval '1 minute',interval_days=10 where id=cid;
   perform public.record_adaptive_review(u,cid,'Good',gen_random_uuid());
   if (select interval_days from public.cards where id=cid)<>20 then raise exception 'Successful review did not expand interval'; end if;
  end if;
  begin
   perform public.record_adaptive_review(other_u,cid,'Good',gen_random_uuid());
   raise exception 'Wrong owner was accepted' using errcode='P0003';
  exception when no_data_found then null; end;
 end loop;
end $$;
rollback;
select 'Adaptive review checks passed; all test data rolled back' as result;
