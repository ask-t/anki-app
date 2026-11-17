# Tango App — Conference Vocab MVP

Next.js 16 + Supabase + Notion API vocabulary flashcards for the October 2026 General Conference talk **O Be Wise**.

## Features

- Email magic-link sign in with Supabase Auth
- One-click import of Notion vocabulary properties, including Japanese meaning, explanation, examples and original source
- English→Japanese and Japanese→English flashcards
- Again / Hard / Good / Easy review buttons
- Review scheduling persisted in Supabase; per-user study history
- Database row-level security (read policies); server-side validated write API

## Setup

1. Create a Supabase project. Execute `supabase/schema.sql` in SQL Editor.
2. Create a Notion **internal integration** with read-content access. Share **O Be Wise — Vocabulary** with it.
3. Copy `.env.example` to `.env.local`, fill your values, and set `SYNC_ALLOWED_EMAILS` to your own Supabase account email. Keep service-role and Notion tokens **server-side only**.
4. In Supabase Authentication → URL Configuration, add `http://localhost:3000` to allowed redirect URLs. For production also add the Vercel site's URL.
5. Run `npm install` and `npm run dev`.
6. Sign in by email, press **Notionと同期**, and start studying.

## Vercel

Connect this repository in Vercel, set the same environment variables in Project Settings, and deploy. Update Supabase Authentication redirect URLs to include the production domain.

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Publishable/anon key
- `SUPABASE_SERVICE_ROLE_KEY`: Secret Supabase service-role key **never use NEXT_PUBLIC_**
- `NOTION_API_TOKEN`: Secret Notion integration token
- `NOTION_DATA_SOURCE_ID`: 41bd7fb8-403e-81bf-b252-000bd9c5f916
- `SYNC_ALLOWED_EMAILS`: comma-separated allowed accounts for importing Notion

The schema and Notion property names are taken from the current O Be Wise vocabulary database.

## Current limitations

- Manual synchronization only. Notion changes are pulled by pressing the sync button.
- The review algorithm is a **simple SM-2-inspired scheduler**, not FSRS.
- One deck and at most 1000 cards in the UI; designed for an individual learner.
- An answer is recorded through a server API; simultaneous requests can race. Review updates and logs are not yet atomic.
- Notion API and actual Supabase connection must be tested with your private credentials.
- Running install/build and deployment requires a connected execution environment; this repository update alone does not deploy the app.

Do not commit any `.env.local` file or API keys.
