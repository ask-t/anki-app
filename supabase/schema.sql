-- Run in Supabase SQL Editor before starting the application.
-- Upgrade the original Notion schema without changing card IDs or review data.
do $$
begin
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name='cards' and column_name='notion_page_id')
    and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='cards' and column_name='external_id') then
  alter table public.cards rename column notion_page_id to external_id;
 end if;
end $$;
create table if not exists public.cards (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 external_id text not null,
 word text not null,
 japanese_meaning text not null default '',
 explanation text not null default '',
 example text not null default '',
 part_of_speech text,
 page_number integer,
 source_url text,
 repetitions integer not null default 0,
 interval_days integer not null default 0,
 ease_factor double precision not null default 2.5,
 due_at timestamptz not null default now(),
 last_reviewed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique (user_id, external_id)
);
create table if not exists public.review_logs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 card_id uuid not null references public.cards(id) on delete cascade,
 rating text not null check (rating in ('Again','Hard','Good','Easy')),
 reviewed_at timestamptz not null default now()
);
create index if not exists cards_due_idx on public.cards(user_id,due_at);
create index if not exists review_logs_user_idx on public.review_logs(user_id,reviewed_at desc);
alter table public.cards enable row level security;
alter table public.review_logs enable row level security;
drop policy if exists "read own cards" on public.cards;
create policy "read own cards" on public.cards for select to authenticated using (auth.uid()=user_id);
drop policy if exists "read own reviews" on public.review_logs;
create policy "read own reviews" on public.review_logs for select to authenticated using (auth.uid()=user_id);
grant usage on schema public to authenticated, service_role;
grant select on public.cards, public.review_logs to authenticated;
grant select, insert, update on public.cards to service_role;
grant insert on public.review_logs to service_role;
-- Server routes mutate data after verifying Supabase identity.

-- OAuth data is server-only. Store SHA-256 hashes, never bearer tokens or codes.
create table if not exists public.mcp_oauth_grants (
 code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
 request_hash text not null unique check (request_hash ~ '^[a-f0-9]{64}$'),
 client_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 redirect_uri text not null,
 resource text not null,
 scope text not null check (scope = 'cards:write'),
 code_challenge text not null,
 expires_at timestamptz not null,
 consumed_at timestamptz
);
create table if not exists public.mcp_oauth_sessions (
 id uuid primary key default gen_random_uuid(),
 access_hash text not null unique check (access_hash ~ '^[a-f0-9]{64}$'),
 refresh_hash text not null unique check (refresh_hash ~ '^[a-f0-9]{64}$'),
 client_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 resource text not null,
 scope text not null check (scope = 'cards:write'),
 access_expires_at timestamptz not null,
 refresh_expires_at timestamptz not null
);
create index if not exists mcp_grants_expiry_idx on public.mcp_oauth_grants(expires_at);
create index if not exists mcp_grants_user_idx on public.mcp_oauth_grants(user_id);
create index if not exists mcp_sessions_user_idx on public.mcp_oauth_sessions(user_id);
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_sessions enable row level security;
revoke all on public.mcp_oauth_grants, public.mcp_oauth_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.mcp_oauth_grants, public.mcp_oauth_sessions to service_role;
-- Existing cards stay unassigned; review history and card IDs are unchanged.
create table if not exists public.folders (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 1 and 100),
 created_at timestamptz not null default now(),
 unique (id, user_id)
);
create table if not exists public.study_sets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 folder_id uuid not null,
 name text not null check (char_length(trim(name)) between 1 and 100),
 created_at timestamptz not null default now(),
 unique (id, user_id),
 foreign key (folder_id, user_id) references public.folders(id, user_id) on delete restrict
);
alter table public.cards add column if not exists set_id uuid;
do $$ begin
 if not exists (select 1 from pg_constraint where conname = 'cards_set_owner_fk' and conrelid = 'public.cards'::regclass) then
  alter table public.cards add constraint cards_set_owner_fk foreign key (set_id, user_id) references public.study_sets(id, user_id) on delete restrict;
 end if;
end $$;
create index if not exists folders_user_idx on public.folders(user_id);
create index if not exists study_sets_folder_idx on public.study_sets(user_id, folder_id);
create index if not exists cards_set_idx on public.cards(user_id, set_id);
alter table public.folders enable row level security;
alter table public.study_sets enable row level security;
drop policy if exists folders_select_own on public.folders;
create policy folders_select_own on public.folders for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists folders_insert_own on public.folders;
create policy folders_insert_own on public.folders for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists sets_select_own on public.study_sets;
create policy sets_select_own on public.study_sets for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists sets_insert_own on public.study_sets;
create policy sets_insert_own on public.study_sets for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists cards_update_own_set on public.cards;
create policy cards_update_own_set on public.cards for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.folders, public.study_sets from anon, authenticated;
revoke update on public.cards from anon, authenticated;
grant select, insert on public.folders, public.study_sets to authenticated;
grant update (set_id) on public.cards to authenticated;
-- Invoked only by the server using its service role, after validating the payload.
create or replace function public.import_vocabulary_to_set(p_user_id uuid, p_folder_name text, p_set_name text, p_cards jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare folder_uuid uuid; set_uuid uuid; matches integer;
begin
 if p_user_id is null or p_folder_name is null or p_set_name is null or char_length(trim(p_folder_name)) not between 1 and 100 or char_length(trim(p_set_name)) not between 1 and 100 or jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) not between 1 and 100 then
  raise exception 'Invalid import';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
 select count(*) into matches from public.folders where user_id=p_user_id and name=p_folder_name;
 if matches > 1 then raise exception 'Ambiguous folder name' using errcode='P0001'; end if;
 select id into folder_uuid from public.folders where user_id=p_user_id and name=p_folder_name;
 if folder_uuid is null then insert into public.folders(user_id,name) values(p_user_id,p_folder_name) returning id into folder_uuid; end if;
 select count(*) into matches from public.study_sets where user_id=p_user_id and folder_id=folder_uuid and name=p_set_name;
 if matches > 1 then raise exception 'Ambiguous set name' using errcode='P0001'; end if;
 select id into set_uuid from public.study_sets where user_id=p_user_id and folder_id=folder_uuid and name=p_set_name;
 if set_uuid is null then insert into public.study_sets(user_id,folder_id,name) values(p_user_id,folder_uuid,p_set_name) returning id into set_uuid; end if;
 insert into public.cards(user_id,set_id,external_id,word,japanese_meaning,explanation,example,part_of_speech,source_url,updated_at)
 select p_user_id,set_uuid,c.external_id,c.word,c.japanese_meaning,c.explanation,c.example,c.part_of_speech,c.source_url,now()
 from jsonb_to_recordset(p_cards) as c(external_id text,word text,japanese_meaning text,explanation text,example text,part_of_speech text,source_url text)
 on conflict(user_id,external_id) do update set
 set_id=excluded.set_id, word=excluded.word, japanese_meaning=excluded.japanese_meaning,
 explanation=excluded.explanation, example=excluded.example, part_of_speech=excluded.part_of_speech,
 source_url=excluded.source_url, updated_at=excluded.updated_at;
end $$;
revoke all on function public.import_vocabulary_to_set(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.import_vocabulary_to_set(uuid,text,text,jsonb) to service_role;
grant select,insert on public.folders,public.study_sets to service_role;
-- Flag is per user-owned card and is independent of review scheduling.
alter table public.cards add column if not exists is_flagged boolean not null default false;
grant update (is_flagged) on public.cards to authenticated;
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
