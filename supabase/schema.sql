-- Run in Supabase SQL Editor before starting the application.
create table if not exists public.cards (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 notion_page_id text not null,
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
 unique (user_id, notion_page_id)
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
-- Server routes mutate data after verifying Supabase identity.
