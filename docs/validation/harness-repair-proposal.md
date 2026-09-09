# Isolated validation harness — repair proposal

**Status: PROPOSED, not started. Separately scoped from #557.**
Author: CC, 2026-09-08. Requires Edward's approval before any work begins.

## Why this is worth doing now

The isolated harness is the only pre-merge path that can exercise the real
application under authentication. Without it, operator-facing changes are
verified by mounted-component tests with service doubles — which is genuine
coverage of component behaviour, and is not the same as running the workflow.

The alternative that keeps being reached for is an authenticated Vercel
preview. It is not available: a `nexus.thedps.co` session does not carry to a
`*.vercel.app` origin, and a sign-in screen is blocked access rather than
validation. That constraint is recorded in `CLAUDE.md` and in section 0 of the
operational runbook. Repairing the harness is what actually removes the gap.

## The defect

**One defect, one downstream symptom.** This is the whole finding, and the
distinction is the point.

`tests/harness/fixtures/world.ts` writes `assembly_leaf_inputs` in two places
(near lines 315 and 611) without `quote_leaf_id`:

```sql
insert into assembly_leaf_inputs (
  id, assembly_leaf_id, tier_id, line_group_id, supplier, ...
) values (...)
```

Migration 0066 made that column NOT NULL, so `npm run validation:seed` aborts
with `ExecConstraints` on `assembly_leaf_inputs.quote_leaf_id`.

`quoteLeafId` is already in scope at both call sites — it is bound one
statement earlier for the `assembly_leaves` junction insert. The change is the
column name and the value, twice.

### The sign-in refusal is NOT a second defect

`validation:app` returns 500 on every authenticated route:

```
[identity] Sign-in refused (non_corporate_identity).
pm@nexus-validation.invalid is not a corporate identity...
```

`seedFixtureWorld` runs a single transaction (line 136 to ~906) that also
inserts the `users` rows for `validation_clerk_pm` and
`validation_clerk_admin`. The failed insert rolls the whole transaction back,
so those rows never land. `ensureUserWithAuthentication` then finds no row at
step 1, falls through to `bindPendingUser`, and the production corporate-domain
rule correctly refuses a fake address.

**Do not relax `isCorporateEmail` for isolated mode.** That is the tempting
repair if the symptom is read as an auth defect, and it would weaken an
authentication rule to work around a missing NOT NULL column. Seed the database
and the identity resolves at step 1 without touching auth at all.

An earlier report of mine described these as two independent defects. That was
wrong, and it is corrected here and in both recorded places, because a wrong
diagnosis persisted in the agent instructions costs more than none.

## Proposed scope

**In:**

1. Add `quote_leaf_id` to both `assembly_leaf_inputs` inserts in
   `tests/harness/fixtures/world.ts`.
2. Run `validation:db:reset` → `migrate` → `seed` and confirm it completes.
3. Confirm `validation:app` serves an authenticated route, which establishes
   the identity symptom was downstream.
4. Run the existing harness browser suites (runbook section 7) and report what
   passes, what fails, and what has decayed while the harness was unusable.
5. A regression guard so the seeder cannot silently drift from the schema
   again — the cheapest form is a `verify:` script asserting every NOT NULL
   column on tables the seeder writes appears in its insert column lists.

**Out:**

- Any change to `isCorporateEmail`, `bindPendingUser`, or the identity
  providers.
- Any change to production code. This is harness-only unless step 4 surfaces a
  product defect, which would be reported and scoped separately.
- Certifying #557. That is a separate act, performed once the harness runs.

## Cost and risk

Step 1 is minutes. Steps 2–4 are the real cost and are unknown until the seed
completes: the harness has been unusable for long enough that other fixtures
may have drifted against later migrations in the same way, and step 4 is where
that surfaces. It is plausible this is a one-line-per-site fix and everything
else runs; it is also plausible the seeder needs several such corrections.

Risk to production: none by construction. The harness runs against an isolated
containerised database (`validation:prove-isolation` asserts credentials absent
and providers isolated), not the shared Supabase project.

**Recommended sequencing:** step 1–3 first, as a bounded change whose outcome
is binary and cheap to observe. Decide on steps 4–5 once the seed is known to
complete, rather than committing to an unbounded sweep in advance.

## Why the regression guard is included

The same omission caused a production outage. Migration 0066 tightened
`quote_leaf_id` to NOT NULL while a writer in `packaging-materialization.ts`
omitted it; that writer was fixed and the harness writer was not. It is the
cross-consumer audit gap the pattern library already records, in a place the
audit did not sweep — and nothing failed until someone tried to use the
harness, months later.

A guard that compares seeder insert column lists against NOT NULL schema
columns would have failed at build time on the day 0066 landed.
