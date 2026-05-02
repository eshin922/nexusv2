# `drizzle/manual/`

Supabase project-config SQL statements that are **not** applied by
`drizzle-kit migrate`. Must be run manually against each environment.

## What goes here

- `ALTER PUBLICATION supabase_realtime ADD TABLE ...` (which tables
  emit `postgres_changes` events)
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and policy definitions
  (if RLS is ever turned on — currently off across the project; see
  CLAUDE.md "Access model" section)
- Other Supabase-project-level config that the JS schema definition
  doesn't model (Realtime publication, RLS, Storage bucket policies,
  Edge Function deploy hooks, etc.)

## What does NOT go here

- DDL that Drizzle can model (table creates, column adds, indexes,
  constraints, FKs). Those go through `drizzle-kit generate` and live
  in the numbered `drizzle/NNNN_*.sql` files.
- Anything that should run automatically on deploy. These files are
  per-environment manual ops by definition.

## Running

Apply each SQL file against each environment exactly once. The Supabase
SQL editor is the lowest-friction path for prod (single click, visible
audit trail in Supabase logs). Local `psql` works too if you have it
installed.

```bash
psql "$DATABASE_URL" -f drizzle/manual/0001_supabase_realtime_publication.sql
```

Verify each file's effect via the matching `scripts/verify/*.ts`
checker where one exists. For the realtime publication:

```bash
DATABASE_URL='<env-url>' \
  node --experimental-strip-types scripts/verify/realtime-readiness.ts
```

## Idempotence

These statements are **not** idempotent in general. Re-running
`ADD TABLE` on a table already in the publication raises an error.
If a file's contents have already been applied to an environment,
skip it.

A file numbered `0002_*.sql` should never modify what `0001_*.sql`
created in a way that depends on `0001_*.sql` not having run — keep
each file independently meaningful where reasonable.

## Connection to the v1.5+ "manual per-environment ops" backlog item

This directory exists because some Supabase config can't be expressed
through versioned migrations and must be applied per-env. Same
foot-gun class as DATABASE_URL drift between dev and prod (see
UX_BACKLOG entry). Long-term fix proposals (CI/CD-only application,
`--confirm-prod` flag, host allowlist) generalize to this directory's
contents too.
