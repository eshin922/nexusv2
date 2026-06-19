# slice-11-5-1-old-table-drops — Brief AMENDMENTS v2

**Brief baseline:** v1 (`docs/cc-comm-slice-11-5-1-brief.md`
pre-2026-06-18 PM)
**Amendment driver:** CA critique on PR #74 draft (C1-C4 + A1)
+ CB walk MIG-4/5/6/8 investigation (A2-A4).
**Status:** 7 amendments locked. v2 supersedes specified
sections of v1. Canonical brief reads as **v1 + v2 merged
inline** at `docs/cc-comm-slice-11-5-1-brief.md`. This file is
the historical changelog.
**Date:** 2026-06-18

CA critique verdict on v1: "Architectural shape sound. 1
CRITICAL verification + 2 important polish items + 1 optional
safety net" (C1-C4 + A1). CB walk findings added 3 more
amendments (A2-A4) for realtime + orphan cleanup + spec update
banking. Core scope unchanged through both critique rounds; v2
sharpens verification gates + adds insurance + extends Slice
11.5 §3 commitment + absorbs MIG-8 realtime regression cleanly.

---

## §0 · C1 verification result (CONFIRMED YES)

**CA's question (v1 §2 brief, restated):**

> Does `bundle.data.costing.skuRollups` (and the rest of
> `bundle.data`) expose enough cell-level context for warnings.ts
> to surface specific cells without re-querying raw cost tables?

**Verification method (CC, pre-v2 draft):**

1. Read `src/lib/validation.ts` — `validateQuote(input,
   costing)` takes both `QuoteCostingInput` AND
   `QuoteCostingResult` as args
2. Read `src/lib/costing-store.ts` — `HydrateSnapshot` includes
   `packaging`, `production`, `cellOverrides`, `cellTargets`,
   `skus`, `tiers`, `firmSettings`, `markupDefaults`,
   `freightLeg*`, AND `costing: QuoteCostingResult`
3. Read `src/app/actions/warnings.ts` `loadCostingForQuote` —
   currently builds `QuoteCostingInput` from raw OLD-table
   reads, then calls `validateQuote(input, costing)`

**Verification result: YES — bundle exposes everything
warnings.ts needs.**

Concretely, `bundle.data` already contains the EXACT
`QuoteCostingInput` shape `validateQuote` consumes (see
canonical brief §2 for the full field list).

Override-source attribution is preserved transparently: the
adapter's packaging array already carries the markup_pct value
(which differs from category_default when manual override is
active). The engine reads it directly per
`checkLineLevelCompleteness` etc.

**Architectural commitment HOLDS unchanged.** v1 §2 warnings.ts
migration design proceeds as drafted: warnings.ts becomes a
pure projection of bundle data. No adapter changes; no fallback
path needed; no Pattern 22 §3 escape.

**§0.5 ledger update:** zero catches surfaced from C1
verification (architectural commitment was achievable). Slice
11.5.1 §0.5 contribution stays at 0; cumulative 68 across 14
slices (at C1 verification time; subsequent retrospective
catches #69 + #70 banked separately).

---

## §1 · C2 — Broad grep audit of 14 "delete" + 2 "audit" functions

CA flagged that v1 §2 actions/quotes.ts cleanup listed UI-orphan
status only. Real callers could exist in other actions, dev
scripts, test fixtures, API routes, webhook handlers.

CC ran broad grep across `src/` + `scripts/` for all 16
functions. Each match cross-referenced to confirm active code
vs documentation reference.

**Results:** all 16 functions zero active callers. All
"matches" outside `actions/quotes.ts` are LINEAGE COMMENTS —
references like "mirrors `deleteSku` in quotes.ts" or "pattern
from Slice 5.5 `deleteSku`". See canonical brief §2 for the
full per-function disposition table.

**Brief v2 amendment:** all 16 functions safe to delete in
Step 3. Lineage comments in other files stay (they're
historical context, not active references). Step 4 grep
verification re-runs the same scan post-deletion to confirm
zero hits.

Per CA C2 disposition, deletions get a comment in the commit
message explaining what was removed + why orphan (one-line
each; the lineage comments in other files provide the deeper
rationale for any future-CC pattern-matching).

---

## §2 · C3 — Parity verifier coverage extension

CA flagged that the seeded sample order has all-GOOD margins
(T1 37% / T2 42% / T3 46% per brief v2 A2 design). Parity of
"empty output vs empty output" proves zero. The actual warning-
generation logic isn't exercised.

**Disposition: CA option (a) — programmatic override mid-test.**

The verifier opens a transaction, applies override(s) to push
the seeded sample order below floor, runs warnings engine pre
vs post (or pre-migration vs post-migration in the actual run),
captures the warning list, rolls back the transaction.

This is testing-discipline-clean: no fixture state to maintain
outside the verifier; the seeded sample order stays unchanged
post-test; verifier is self-contained + re-runnable.

See canonical brief §3 for the full verifier spec.

---

## §3 · C4 — Archive-before-drop safety net

CA recommended creating `_archive_*` tables before the drop,
holding 30 days, then cleanup. CC concurs: 5 minutes of work
for queryable insurance vs. PITR ceremony.

**Disposition: CC INCLUDES.** Minimal cost; meaningful
insurance during Week 1 monitoring window when an unanticipated
regression could surface a need for OLD data.

See canonical brief §4 Step 4 + §5 for the archive + cutover
details. UX_BACKLOG entry for the calendar-anchored 30-day
cleanup follow-up lands in Step 4 docs.

---

## §4 · A1 — CLAUDE.md §3 commitment extension

CA observed that v1 brief's warnings.ts reframe extends the
Slice 11.5 §3 architectural commitment from "math layer is
load-bearing" to "math-layer output is load-bearing; downstream
consumers project from math output, not from raw schema."

**Disposition: CC FOLDS INTO STEP 4 CLAUDE.md DOCS.**

Step 4 docs update (originally adds the schema drop completion
note) gets an extension to the existing "Math layer is the
load-bearing surface" section banked in Slice 11.5 Step 8:

> **Extension banked Slice 11.5.1 (2026-06-18):** the load-
> bearing commitment extends to math-layer OUTPUT, not just the
> input contract. Downstream systems (warnings engine, audit
> projections, exports, future analytic surfaces) consume the
> bundle's computed result as data; they do not parallel-derive
> from raw schema. When a new downstream consumer surfaces,
> first question is: "does
> `getCostingBundle().data.costing.skuRollups` (or sibling
> bundle fields) expose what you need?" If yes, project from
> bundle. If no, propose a new bundle field; do not parallel-
> derive from cost tables.

Slice 11.5.1's warnings.ts migration is the canonical instance
of this extension; future-CC pattern-matches on "is this a
parallel raw-data consumer? → make it downstream of math
instead."

Also extends MIG wording: v2 A1's secondary disposition replaces
"identical to pre-migration" with "matches expected fixture
values" across MIG entries — wipe-and-reseed posture has no
pre-state; the force-warning fixture is the ground truth.

---

## §5 · A2 — MIG-8 realtime extension (CB walk fold-in)

**Catch:** Slice 11.5 added 4 new cost-data tables (Step 2),
migrated read paths (Step 3) + write actions (Step 4), but
**realtime subscriptions stayed on OLD tables**. CB walk MIG-8
surfaced empirically; CC investigation confirmed root cause:

- `src/components/costing-store-provider.tsx` subscribes to
  `quote_skus`, `packaging_inputs`, `production_inputs` (OLD)
- `drizzle/manual/0001_supabase_realtime_publication.sql`
  publication membership lists OLD tables
- `assembly_leaf_overrides` + `assembly_leaf_targets` never
  wired to realtime (Slice 8.5 omission; Slice 11.5.1 brings
  online — positive externality)

**Disposition: fold into Slice 11.5.1 as Step 5 (subsequently
renumbered Step 4 in canonical brief).**

Scope additions:
1. `drizzle/manual/0018_supabase_realtime_slice_11_5_1.sql` —
   publication ALTER (ADD NEW tables, DROP OLD tables)
2. `src/components/costing-store-provider.tsx` — subscription
   targets updated to NEW table names. Per-quote filter logic
   preserved.
3. Cutover sequencing: publication ADD NEW first (pre-merge) →
   code merge → publication DROP OLD → drizzle migration `DROP
   TABLE OLD`. The DROP TABLE migration depends on the
   publication DROP — can't drop a table while it's in a
   publication.

See canonical brief §2 + §4 + §5 for the full migration spec
and cutover sequencing.

**Bonus catch banked alongside:** `assembly_leaf_overrides` +
`assembly_leaf_targets` realtime subscriptions never existed in
OLD model. Slice 11.5.1 brings per-cell override + client-
target cross-tab propagation online for the first time.
UX_BACKLOG note in Step 4 docs.

---

## §6 · A3 — Orphan PSR-superseded component deletes

**Catch:** CB walk MIG-4/5/6 cannot-verify results led to CC
investigation. Three components are orphan-on-disk — wired by
Slice 11.5 Step 4 to call NEW write actions, but NOT rendered
by any active page.

- `src/components/required-sell-cell.tsx` (zero active imports;
  Step 4 wired to `updateAssemblyLeafOverride`)
- `src/components/pricing/client-target-cell.tsx` (zero active
  imports; Step 4 wired to `updateAssemblyLeafTarget`)
- `src/components/pricing/reverse-solve-dialog.tsx` (consumed
  only by orphan `client-target-cell.tsx`; audit for additional
  consumers and delete if confirmed orphan)

**Preserve** (Costs-surface still consumes):
- `src/components/pricing/active-tier-selector.tsx` — imported
  by `cost-stack-header.tsx` (Costs page tier-switching)

**Disposition: fold into Step 3 (orphan cleanup) scope.** Per-
file commit-message rationale ("orphan since PR #54 PSR
redesign; Step 4 wired to NEW action for forward-compat;
never rendered").

**NOT a Slice 11.5 regression:** the orphan state predates
Slice 11.5. PR #54 (PSR redesign predating Slice 11.5) shipped
PSR + left these components orphaned. Slice 11.5 Step 4 wired
the orphan components' action calls to NEW
`updateAssemblyLeafOverride` / `updateAssemblyLeafTarget` for
forward-compatibility, but they were never on the user-facing
page.

Open question deferred: did PSR move the override + target
input affordances to action-zone (Hypothesis A) or remove them
without replacement (Hypothesis B)? Banked for Slice 11 audit
pre-brief inventory; verification runs in parallel during
Slice 11.5.1 work.

---

## §7 · A4 — CB walk spec update banking

**Catch:** CB walker spent ~30 minutes on MIG-1/2/3 before the
503 EMAXCONNSESSION was identified as the actual root cause;
MIG-4/5/6 walks consumed time looking for inline cell-click
affordances that don't exist in PSR architecture.

**Disposition: bank for comprehensive CB test suite work** (v1
critical-path item #13).

Updates needed when that work runs:
1. **State-prep steps for state-gated affordances** — before
   walking MIG-4 (sell-price override), force classifier into
   SUGGESTION-LED or BLOCKED mode. Document the prep state
   explicitly.
2. **Affordance location specifications** — for MIG-5 (client
   target) + MIG-6 (tier chips), document the actual UI region
   where the affordance lives so CB walker doesn't need to hunt.
3. **Pre-walk verification** — confirm Path B (or whatever
   connection budget changes) deployed and pool healthy before
   starting any walk. The 503 anomaly burned CB time on
   MIG-1/2/3 before being identified as a known issue.

These spec updates fold into the comprehensive CB test suite
work — not blocking Slice 11.5.1.

---

## §8 · Summary of v2 changes

| # | Amendment | v1 impact |
|---|---|---|
| **C1** | skuRollups verification result CONFIRMED YES | v1 §2 architectural commitment HOLDS unchanged |
| **C2** | Broad grep audit — all 16 fns zero active callers | v1 §2 actions/quotes.ts step proceeds with per-fn rationale |
| **C3** | Parity verifier extended with force-warning fixture path | v1 §3 + v1 Step 1 deliverable |
| **C4** | Archive-before-drop safety net (5-min insurance) | v1 §5 cutover plan; v1 Step 4 |
| **A1** | §3 extension to math-OUTPUT-is-load-bearing + MIG wording | v1 Step 4 CLAUDE.md docs add; MIG entries updated |
| **A2** | MIG-8 realtime extension (Step 5 → Step 4 fold-in) | v1 step plan absorbs publication + subscription migration |
| **A3** | Orphan PSR component delete scope (Step 3 expansion) | v1 Step 3 orphan cleanup scope grows |
| **A4** | CB walk spec update banked for comprehensive CB suite | v1 §6 out-of-scope banking |

### Net effect

v1 architecture + warnings.ts pure-projection design stand
verbatim. v2 sharpens verification gates (C1 verified upfront,
C2 grep-confirmed, C3 force-warning fixture) + adds insurance
(C4 archive) + extends Slice 11.5 §3 commitment (A1) + absorbs
MIG-8 realtime regression (A2) + cleans up PSR orphan components
(A3) + banks CB walk spec update (A4).

**Step 1 kickoff is unblocked once Edward + CA review the
canonical brief (v1+v2 merged) and Edward greenlights.**

---

## Authorization

CC reads canonical set as **canonical brief
(`docs/cc-comm-slice-11-5-1-brief.md`) with v1 + v2 merged
inline**. This file is the historical changelog showing the
v1 → v2 deltas.

CA reviews v2 + Edward signals kickoff → Slice 11.5.1 Step 1
begins.

---

**End of v2 amendments.** Canonical brief reads as **v1 + v2
merged inline**. This file stays as historical changelog for
future-CC pattern-matching on the v1 → v2 disposition arc.
