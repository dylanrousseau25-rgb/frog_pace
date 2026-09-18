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

## o2switch migration

The `o2switch-migration` branch contains the hosting migration work.

### Phase 1 — move the Next.js runtime to o2switch

Keep Supabase temporarily as the database/auth backend. This avoids rewriting the PostgreSQL/RLS/RPC layer during the hosting move.

Recommended cPanel Node.js application settings:

- Node.js: 22 or newer
- Environment: Production
- Application root: the Frog Pace repository directory
- Application startup file: `server.js`
- Domain/subdomain: the final Frog Pace hostname

Then install and build:

```bash
npm ci
npm run build
```

Required environment variables for the current application:

```text
NODE_ENV=production
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Also copy every provider/server-side secret currently configured in the production deployment (COROS, TrainingPeaks and any cron/bridge secrets). Never commit those secrets to Git.

After changing environment variables or rebuilding, restart the Node.js application from cPanel.

### Phase 2 — replace Supabase with o2switch MariaDB

Do this only after Phase 1 is stable. Frog Pace currently depends on Supabase-specific PostgreSQL features including `auth.users`, RLS, PL/pgSQL functions/RPCs, JSONB, PostgreSQL arrays, triggers and Edge Functions. Those features must be replaced deliberately in the Node.js application before Supabase can be removed.

The intended target is:

```text
Next.js / Node.js on o2switch
        |
        +-- application authentication/session layer
        +-- server-side authorization by user_id
        +-- COROS / TrainingPeaks services
        +-- scheduled jobs via cPanel cron
        |
        +-- MariaDB on o2switch
```

Do not import the existing Supabase SQL migrations directly into MariaDB: they are PostgreSQL/Supabase-specific.

## Product rule

The database is the source of truth. Browser storage, cookies and serverless temporary files must never become Frog Pace's business database.
