# CB suite · execution 01

**Run:** 2026-08-10, isolated validation environment (Docker Postgres 16.14 on
`127.0.0.1:55432`), governed commands only.
**Purpose:** begin the comprehensive CB suite per the release plan. Every
passing section converts a future audit row; the suite cannot *complete* until
Track B lands, but it can start.

**Verdict: the suite ran end-to-end from the governed commands for the first
time, and a governed command had to be repaired to make that possible.**

---

## The finding that matters most

**`npm run validation:seed` could not work from a clean shell.**

`validation:fixtures` was the only script under `validation:*` without
`--env-file=.env.validation.local`. Every seeding path delegates to it —
`validation:seed`, `validation:fixtures:validate`, `validation:fixtures:reset` —
so all four inherited the gap. Without the env file `DATABASE_URL` is
unset and `postgres()` falls back to `localhost:5432`.

On this machine that is nothing, and the command fails loudly with
`ECONNREFUSED`. **On a machine with a local Postgres on the default port it
would not fail — it would seed the wrong database.**

The operational runbook §5 documents `npm run validation:seed` as the governed
step. It did not work as documented.

Fixed by adding the env file, matching all ten sibling scripts. After the fix
the seed reproduces the release-readiness record exactly:

```
projects 10 · quotes 10 · tiers 24 · canonical_attachments 44
invalid_identity_mappings 0 · invalid_external_ids 0
freight: 11 subcategories · 22 destinations · 64 breaks · 43 memberships · 52 customs breaks
```

**This is the CB suite paying for itself before a single scenario was
evidenced.** It is also why the suite's failures below are *unknown* rather than
*known* — a suite that cannot be run from its documented commands accumulates
drift silently.

## Result

| | |
|---|---|
| **Passed** | **7** |
| **Failed** | **12** |
| Did not run | 3 |
| Duration | 5.8m |

### Failures, by project

**`lifecycle-serial` — 6**
`lifecycle-surface-consistency` (PB-001/PB-005) ·
`product-library-create-component` ×2 (ASY default; PVS-018) ·
`pvs-020-refresh-performance` ×2 · `workspace-governance`

**`costing-serial` — 6**
`basic-quote-persistence` (VAL-101) · `bulk-pricing-lift` (VAL-208) ·
`costs-reconciliation-ordering` · `phase-2-component-freight` ×3

## Root cause — **not established**

Stated plainly rather than guessed at, because the banked rule is that a number
without a verified baseline is worse than no number.

What is known:

- The failing assertion in the freight specs waits for
  `button[aria-controls="section-freight-drawer"]`. **That selector is correct** —
  `section-with-drilldown.tsx:153` renders it and the Costs page passes
  `id="freight"`. This is not a stale selector.
- The captured page snapshot shows the **home page**, not the Costs page.
- The deep-linked quote **does exist** in the validation database.
- The database held **18 quotes** after the run against **10** seeded, which
  suggests `globalSetup` seeded a second world alongside the one I seeded.

That last point is the most likely thread and the one to pull first: a run-id
mismatch between the manually seeded world and the one `globalSetup` creates
would leave the specs reading a manifest that does not describe the data the
app is serving.

**No claim is made here that these 12 are regressions, or that they are
pre-existing.** Neither has been established, and this suite has no verified
green baseline to compare against — which is precisely the condition the broken
seed command produced.

## Next step, precisely

1. Establish whether `globalSetup` re-seeds under a different run id than
   `NEXUS_VALIDATION_RUN_ID`, and reconcile the two.
2. Re-run from a reset world (`validation:db:reset` → migrate → seed → e2e)
   so the run has one world, not two.
3. **Only then** classify the failures. A green baseline is what makes the
   next delta evidence.

## Scope respected

No Track A surface, no Track B surface, no S-7 input, no Pricing, no Phase 3.
The one change is a missing `--env-file` on an npm script.
