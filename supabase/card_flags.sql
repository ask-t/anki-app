-- Flag is per user-owned card and is independent of review scheduling.
alter table public.cards add column if not exists is_flagged boolean not null default false;
grant update (is_flagged) on public.cards to authenticated;
