# Frog Pace

Frog Pace is a mobile-first endurance coaching platform built around athlete data, structured training, explicit plan adaptation and long-term coach memory.

## V1 foundation

- Next.js + TypeScript
- Frog Pace light design system (white / soft grey / green)
- Supabase Auth + PostgreSQL
- Row Level Security for multi-account isolation
- Provider abstraction starting with COROS
- Mobile navigation: Aujourd'hui / Plan / Activité / Progrès / Coach
- PWA manifest and service-worker foundation

## Supabase

Production project ref: `jnmbdnblnbujqzamwhqa`

The canonical schema migration is in `supabase/migrations/202609020001_lot0_foundation.sql`.

## Local development

Copy `.env.example` to `.env.local` and set the Supabase public URL and publishable/anon key, then run:

```bash
npm install
npm run dev
```

## Product rule

The database is the source of truth. Browser storage, cookies and serverless temporary files must never become Frog Pace's business database.
