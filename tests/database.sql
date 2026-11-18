-- Integration check after schema.sql. All test writes are rolled back.
begin;
do $$
declare
 owner_id uuid;
 test_card_id uuid;
 changed_count integer;
 grant_hash text := encode(sha256(gen_random_uuid()::text::bytea),'hex');
 request_hash text := encode(sha256(gen_random_uuid()::text::bytea),'hex');
 access_hash text := encode(sha256(gen_random_uuid()::text::bytea),'hex');
 test_refresh_hash text := encode(sha256(gen_random_uuid()::text::bytea),'hex');
 new_refresh_hash text := encode(sha256(gen_random_uuid()::text::bytea),'hex');
 external_key text := 'qa:' || gen_random_uuid()::text;
begin
 select id into owner_id from auth.users where email_confirmed_at is not null limit 1;
 if owner_id is null then raise exception 'A confirmed test user is required'; end if;
 if has_table_privilege('authenticated','public.mcp_oauth_sessions','SELECT')
   or has_table_privilege('anon','public.mcp_oauth_grants','INSERT') then
  raise exception 'OAuth tables must be inaccessible to browser roles';
 end if;
 if exists(select 1 from pg_class where oid in ('public.mcp_oauth_grants'::regclass,'public.mcp_oauth_sessions'::regclass) and not relrowsecurity) then
  raise exception 'OAuth RLS must be enabled';
 end if;

 insert into public.cards(user_id,external_id,word,japanese_meaning,repetitions,interval_days,ease_factor,due_at)
 values(owner_id,external_key,'original','元の意味',5,30,2.8,'2040-01-01') returning id into test_card_id;
 insert into public.review_logs(user_id,card_id,rating) values(owner_id,test_card_id,'Good');
 insert into public.cards(user_id,external_id,word,japanese_meaning)
 values(owner_id,external_key,'updated','更新した意味')
 on conflict(user_id,external_id) do update set word=excluded.word,japanese_meaning=excluded.japanese_meaning;
 if not exists(select 1 from public.cards where id=test_card_id and word='updated' and repetitions=5
   and interval_days=30 and ease_factor=2.8 and due_at='2040-01-01'::timestamptz)
   or not exists(select 1 from public.review_logs where review_logs.card_id=test_card_id) then
  raise exception 'Import changed review data';
 end if;

 insert into public.mcp_oauth_grants(code_hash,request_hash,client_id,user_id,redirect_uri,resource,scope,code_challenge,expires_at)
 values(grant_hash,request_hash,'qa-client',owner_id,'https://chatgpt.com/connector_platform_oauth_redirect','https://qa.example/mcp','cards:write','qa',now()+interval '1 minute');
 update public.mcp_oauth_grants set consumed_at=now() where code_hash=grant_hash and consumed_at is null and expires_at>now();
 get diagnostics changed_count = row_count;
 if changed_count<>1 then raise exception 'First exchange failed'; end if;
 update public.mcp_oauth_grants set consumed_at=now() where code_hash=grant_hash and consumed_at is null and expires_at>now();
 get diagnostics changed_count = row_count;
 if changed_count<>0 then raise exception 'Code replay was allowed'; end if;

 insert into public.mcp_oauth_sessions(access_hash,refresh_hash,client_id,user_id,resource,scope,access_expires_at,refresh_expires_at)
 values(access_hash,test_refresh_hash,'qa-client',owner_id,'https://qa.example/mcp','cards:write',now()+interval '1 hour',now()+interval '30 days');
 update public.mcp_oauth_sessions s set refresh_hash=new_refresh_hash where s.refresh_hash=test_refresh_hash and s.refresh_expires_at>now();
 get diagnostics changed_count = row_count;
 if changed_count<>1 then raise exception 'Refresh rotation failed'; end if;
 update public.mcp_oauth_sessions s set refresh_hash=new_refresh_hash where s.refresh_hash=test_refresh_hash and s.refresh_expires_at>now();
 get diagnostics changed_count = row_count;
 if changed_count<>0 then raise exception 'Refresh replay was allowed'; end if;
end $$;
rollback;
select 'Database checks passed; all test writes rolled back' as result;
