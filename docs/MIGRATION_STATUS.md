# Migration status

Target: Frog Pace on o2switch using Node.js 22 + MariaDB, with no Vercel or Supabase runtime dependency.

## Ported

- Local email/password authentication with bcrypt and HTTP-only sessions
- MariaDB schema for users, athlete profile, provider connections, activities, goals, plans, workouts, feedback, weekly reviews, race strategies and coach data
- Local data access layer with enforced user isolation
- Local RPC engine for Goal/Plan/Feedback/Weekly Review/Progress/Race/Coach flows
- COROS OAuth + token refresh + 60-day sync
- COROS activity detail enrichment
- COROS workout-export capability check/preparation
- TrainingPeaks bridge using local database and encrypted credentials
- Account deletion
- Passenger startup server for o2switch

## Deployment validation still required

- GitHub CI typecheck/build
- Import `database/schema.sql` into production MariaDB
- Configure o2switch environment variables
- Smoke test: signup/login -> onboarding -> COROS connect -> sync -> goal -> plan -> activity feedback -> coach

The legacy `supabase/` directory remains only as migration reference and is excluded from TypeScript compilation. It is not used by the runtime.
