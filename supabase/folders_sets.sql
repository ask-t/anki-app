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
