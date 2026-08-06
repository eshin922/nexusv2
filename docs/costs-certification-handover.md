# Costs Certification — session handover

**Written 2026-08-06. Amended 2026-08-06 (later).** Resume point for the Costs
Functional + Operational Certification. Everything below is verified state,
not intention.

> **Sections 1–2 below are SUPERSEDED.** The five-action reproduction is
> **held**. It was aborted at Action 1 by a release-blocking defect. Read
> **Section 0** first — it is the authoritative state of this workstream.
> Later sections remain accurate as reference for the deployment, the
> instrumentation and the corrections that had already landed.

---

## 0. Authoritative state (2026-08-06, later session)

### 0.1 Action 1 was aborted — it is not freshness evidence

The five-action reproduction never produced a freshness measurement. Action 1
(Packaging markup, the store-backed control) aborted, and surfaced two
release-blocking defects instead:

1. The Packaging row displayed an optimistic derived value for a write that
   **never persisted**. The operator saw a successful-looking edit that did
   not exist in the database.
2. `CanonicalAttachmentResolutionError` crashed the entire Costs workspace
   during the post-edit render — a full-page runtime boundary, not a handled
   error.

Action 1 must not be cited as a control. The freshness question is still
completely open.

### 0.2 Causal chain

One chain, four links:

```
canonical pointer missing (assembly_leaves.quote_leaf_id IS NULL)
  → lookupCanonicalAttachmentByLegacyId resolves ZERO rows
  → CanonicalAttachmentResolutionError escapes the action contract
      (runAction re-throws anything that is not ActionGuardError)
  → optimistic projection receives no governed failure, never rolls back
  → workspace crashes with an unpersisted value still on screen
```

`src/lib/action-result.ts:115-128` is the escape point: `runAction` converts
`ActionGuardError` and pg validation errors only, and re-throws everything
else.

The resolver is reached from exactly two call sites, both **write-path**
guards — `quoteForAssemblyLeaf` (`src/lib/quote-guards.ts:143`) and
`quoteForAssemblyLeafInputLineGroup` (`:213`). That is why affected quotes
render fine until an operator edits something.

### 0.3 Blast radius (measured)

| | |
|---|---|
| `assembly_leaves` rows total | 137 |
| Orphaned (`quote_leaf_id IS NULL`) | **129 (94%)** |
| Quotes containing legacy rows | 24 |
| Quotes containing orphans | 21 |
| Fully pointered quotes | 3 |
| `quote_leaves` rows database-wide | 17, across 4 quotes |

Affected quote statuses: 10 draft, 8 sent, 2 accepted, 1 complete.

**The three fully-pointered quotes are exactly the three outside the orphan
set** — confirmed, not assumed:

| Quote | Status | Legacy | Canonical | Orphans | Created |
|---|---|---|---|---|---|
| `f88c22e3` Ed's Test Scenario | draft | 3 | 3 | 0 | 2026-08-01 |
| `2f29af72` Primary (governed fixture) | draft | 3 | 3 | 0 | 2026-08-05 |
| `52bd0077` ZZ-VALIDATION-tier-propagation | draft | 2 | 2 | 0 | 2026-08-06 |

All three postdate migration `0048` (2026-08-01), which added the
`quote_leaf_id` column. They are clean because the **current writer** sets
both sides — not because any backfill ran.

Consequence: **Validation 1 and Validation 2 results stand.** Both fixtures
are clean. `27581262` (SAMPLE TEST 3 - ED) is 9/9 orphaned and is the
reproduction case.

### 0.4 Why only 17 canonical rows exist across 4 quotes

The fourth quote is `e23f0e2c` ("5K / 15K / 50K — China sources", **sent**,
2026-06-18): 9 legacy rows, 9 canonical rows, **9 orphans**. Its canonical
rows came from `scripts/seed-sample-order.mjs` at Slice 11.5 close, which
writes `quote_leaves` directly. It predates the pointer column, so nothing
ever linked the two sides.

So: 3 + 3 + 2 (current writer, linked) + 9 (sample seed, unlinked) = 17.

That also explains the earlier finding that only 9 of 129 orphans resolve to
exactly one candidate — those 9 are all `e23f0e2c`.

### 0.5 Migration `0049` root cause — it was deliberately gated, and never ran

`drizzle/0049_product_structure_slice1_backfill.sql` exists and performs
exactly the required repair. **It has never executed.** Four independent
confirmations:

1. **Its own header states the reason.** Line 1–2:
   *"Product Structure Slice 1 / Migration B (DRAFT — intentionally absent
   from `drizzle/meta/_journal.json` until the production review gate
   opens)."*
2. **The journal skips it.** `_journal.json` has 54 entries; idx 48 is
   `0048_product_structure_slice1_expand`, idx 49 is
   `0051_phase_1_commercial_settings_pins`. Neither `0049` nor `0050` appears.
   Drizzle executes only journalled migrations, so both files are inert.
3. **54 journalled, 54 applied** in `drizzle.__drizzle_migrations`. No gap,
   no partial run.
4. **Its schema does not exist.** `0049` line 20 is the only
   `CREATE SCHEMA product_structure_migration` in the tree, nothing drops it,
   and `pg_namespace` has no such row. Its run log
   (`slice1_backfill_runs` / `slice1_backfill_manifest`) is **durable**, not
   temp — had it ever run, the evidence would still be there.

**The real defect is sequencing, not SQL.** This is expand–migrate–contract
where `0048` (expand) shipped and was journalled, `0049` (migrate) and `0050`
(contract) were deliberately withheld behind a review gate that never
opened — **but the runtime resolver that requires the pointer shipped
anyway.** Code began depending on an invariant whose population step was
still gated.

Ruled out explicitly:

| Hypothesis | Verdict |
|---|---|
| Ran against an earlier, smaller dataset | **No** — the durable schema would survive |
| Predicate excluded valid legacy rows | **No** — replay classifies 129/129 cleanly |
| Later rows created by an old writer | **Only 9** (`e23f0e2c`), not 129 |
| Partial / failed execution | **No** — never started; postcondition would have raised |

`0049`'s postcondition (lines 286–304) raises unless **every** root-level
`assembly_leaves` row has a valid pointer at commit. A successful run is
incompatible with 129 orphans.

### 0.6 Replaying `0049`'s classification today — read-only

Its eligibility predicate is:

```sql
FROM assembly_leaves al JOIN assemblies a ON a.id = al.assembly_id
WHERE al.parent_assembly_leaf_id IS NULL   -- no nested legacy memberships
  AND al.quote_leaf_id IS NULL             -- not already pointered
```
classified `created` when no `(quote_id, assembly_id, leaf_id)` match exists,
`reused` otherwise.

Replayed against current data:

| Classification | Rows | Would become |
|---|---|---|
| `missing_canonical_row` | **120** | `created` |
| `exact_existing_match` | **17** | `reused` (9 eligible + 8 already pointered) |
| all six blocker categories | **0** | — |

Canonical-side blockers (`orphan_canonical_grouped_row`,
`cross_quote_product_reference`): **0**.

Eligible set = 129 = 120 `created` + 9 `reused`. Source count 137 is under the
migration's own 250-row ceiling. **Every guard `0049` enforces would pass
today.**

### 0.7 Is replay idempotent and safe?

The **logic** is idempotent by construction: `CREATE SCHEMA/TABLE IF NOT
EXISTS`; eligibility filtered on `quote_leaf_id IS NULL`; the `UPDATE` guarded
again with `AND al.quote_leaf_id IS NULL`; already-linked rows untouched;
`prior_created_mapping` exists specifically to keep ids stable across a
rollback-and-rerun.

But **`0049` should not simply be journalled as-is**, for three reasons:

1. It opens with `BEGIN;` and ends with `COMMIT;` while drizzle already wraps
   migrations in a transaction. Needs verification before execution.
2. Journalling `0049` invites `0050` (contract) to follow, and `0050`
   sets `assembly_leaves.quote_leaf_id NOT NULL` (line 103). **That is
   explicitly out of scope** until this investigation is reviewed.
3. Its header ties execution to a *"governed external Product Structure write
   pause"* which has not been arranged.

Recommended scope, **not yet authorized**: a new corrective migration that
takes `0049`'s classification, guards and postcondition verbatim, omits the
contract step, and is journalled normally.

### 0.8 Open uncertainty — frozen quotes

11 of the 21 affected quotes are **sent (8), accepted (2), or complete (1)**.
Backfilling a pointer is identity repair, not commercial mutation — no price,
cost, quantity or margin changes. But creating `quote_leaves` rows for frozen
quotes introduces rows that resolution and snapshot paths may read, and
Pattern 52 (draft-lock snapshot immutability) holds reproducibility by
**convention**, not by schema.

`0049` copies `quantity`, `position` and `created_at` from the legacy row and
sets `leaf_spec_version_id` and `pinned_at` to `NULL`, so no specification pin
is invented. That is reassuring but **not** a proof of commercial neutrality
for frozen quotes. **This remains open and must be reviewed before any
population runs.**

---

## 1. Where to resume — SUPERSEDED

**Superseded.** The five-action reproduction is held pending the canonical
population decision. Deployment facts below remain accurate.

| | |
|---|---|
| Branch | `certify/costs-operational` @ `8c31051` (pushed) |
| Preview | `https://nexusv2-wl66dgpsg-eshin922s-projects.vercel.app` |
| Quote under test | `52bd0077-20af-4345-8856-45003bfca8b3` |
| Project | `71ced625-2b64-4887-925a-a524e038ce30` |
| Costs URL | `/projects/71ced625-…/quotes/52bd0077-…/costs?section=freight` |

Deployment identity was verified by **SHA**, not by alias. Re-verify with
`vercel ls --json` if anything is redeployed.

> **Do not commit to `certify/costs-operational` before the run.** Any push
> triggers a new Vercel deployment on a NEW origin, which drops the Clerk
> session and forces another manual sign-in. Finish the reproduction first.

---

## 2. The open question

Operator reports **field calculations are stale**. This is a **Functional
Certification blocker** and is NOT yet classified.

The reproduction must identify the first point where the new value becomes
absent · incorrect · older than the committed revision · correctly calculated
but omitted from the returned bundle · correctly returned but not visibly
rendered · or correct throughout but operationally delayed.

Classification is per path, one of: calculation trigger failure · stale
calculation input · stale authoritative read · stale reconciliation snapshot ·
stale client render · correct but operationally delayed. **Dual classification
is allowed** — a functional blocker and an operational blocker are not mutually
exclusive.

### Standing hypothesis — NOT proven, do not act on it

`grep freightShipmentBreaks src/lib/costing-store.ts` returns **nothing**. The
Zustand store carries `freightLegGroups / freightLegs / freightLegTiers` — the
legacy leg model, which `costing.ts:1237` (`worksheetIsAuthoritative`) shadows
whenever worksheet rows exist. So the store holds inert legacy freight state
and does not hold the authoritative worksheet inputs.

If that is the cause, a Freight edit **cannot** produce an optimistic recompute
— the client lacks the inputs to recompute from — while Packaging can, because
`packaging` rows are store-backed. That is the reason Packaging markup is the
control case.

This is static evidence plus a hypothesis. It is textbook Pattern 41, which
CLAUDE.md already names `freight-drilldown.tsx` as an unfixed instance of.
**Do not implement an optimistic Freight model until the trace names the first
point where freshness is lost.**

---

## 3. Run procedure

Order: **Packaging markup (control) → Freight amount → Freight markup → Duty →
Tariff.**

Produce **one joined timeline per action**: client submit revision + value →
server-received → normalized → persisted + commit revision → authoritative
worksheet value read → calculation inputs → calculation outputs → bundle
authority + returned values → reconciliation revision applied → final value
visibly rendered.

**Join on the post-commit revision.** The write and the RSC read are separate
requests; the render cannot see the action's `traceId`. The action returns its
post-commit revision and the client logs `traceId` beside it:

```
traceId ──(action)──> commitRevision ──(bundle)──> rendered value
```

`clientRevision` is captured at submit, so **a reconciliation applying an older
snapshot shows up as a revision going backwards** rather than being inferred.

### Flag explicitly

- revision moves backward
- authoritative loader reads older than the commit
- `calc input` differs from `worksheet read`
- `calc output` correct but bundle or UI stale
- any previously valid Freight / Duty / Tariff / **Cost Stack** value that
  temporarily disappears during the sequence

### Boundaries

Use **trace events**, not arbitrary polling, as timing boundaries. Read the
affected worksheet cell and the Cost Stack value at three points: immediately
after submission, when `reconcile applied` fires, and when the RSC render
completes.

**The final boundary must be DOM-confirmed** — rendered revision and value.
Network completion is NOT operator-visible completion. (Browser-side request
status has already been wrong once this session; see §7.)

### Known gaps — label, do not infer

- **Duty and Tariff** write through `updateFreightCustomsBreak`, which is **not**
  instrumented for points 2 / 2b / 3. Substitute a direct post-write DB read
  stamped with its own `now()` and `pg_snapshot_xmax`, and mark
  server-received / normalized / action-persisted as **NOT INSTRUMENTED**.
- **Packaging** has client timing plus the shared `calc input` / `calc output` /
  `bundle returned` events (those live in the bundle and fire for every
  surface), but no packaging-specific 2 / 2b / 3. Edward ruled this sufficient
  for the control — do not add more before the run.
- **Tier 4 has no quantity** and correctly renders `—`. Use **Tiers 1–3 only**
  for per-unit freshness.

---

## 4. Instrumentation reference

Two collectors, both gated on `NEXT_PUBLIC_VERCEL_ENV !== "production"`
(deliberately not `NODE_ENV` — preview builds run `NODE_ENV=production`, which
would silence exactly the environment being measured).

**`[costs-trace]`** — `src/lib/costs-trace.ts`, follows a VALUE. One JSON line
per event; fields: `point`, `traceId`, `quoteId`, `action`, `destinationId`,
`breakId`, `tierId`, `clientRevision`, `serverRevision`, `authority`, `values`,
`at`.

| Point | Location | Captures |
|---|---|---|
| `submit` (client) | `freight-drilldown.tsx` | input, `traceId`, `clientRevision` |
| `action received` | `updateFreightDestinationBreakGroup` | raw values before coercion |
| `action normalized` | same, per break | next values **+ the priors they replace** |
| `action persisted` | same, post-commit | DB read-back + commit revision + `now()` |
| `worksheet read` | `loadWorksheetFreightForQuote` | what the authoritative loader read |
| `calc input` | bundle, pre-compute | exact inputs to `computeQuoteCosting` |
| `calc output` | bundle, post-compute | per-tier freight/packaging/production/serviceFees/totalCost/margin |
| `bundle returned` | bundle return | worksheet vs legacy row counts + authority |

`authority: worksheet | legacy | none` is emitted on every read-side event, so
a value sourced from the shadowed model is visible rather than deduced.

**`[costs-timing]`** — `src/lib/costs-timing.ts`, measures DURATION. All three
surfaces now share one format (Freight previously emitted its own
`[freight-timing]`, which made the surfaces incomparable). Stages: `submit`,
`action start`, `action complete`, `refresh coalesced`, `refresh start`,
`browser update` (fired on rAF, so it reports when the operator can READ the
value). `scheduleReconcile` marks **armed / re-armed / superseded / applied** —
counts, not durations, because one edit can arm, coalesce and apply repeatedly.

Server-side `[costs-trace]` and `[bundle:*]` / `[costs:<quote>]` marks land in
**Vercel function logs**; client marks in the **browser console**.

The client reads the revision through the store **API**, not a subscription, so
tracing cannot itself trigger a re-render and perturb what it measures.

---

## 5. Certification state

| Item | State |
|---|---|
| Tier propagation | **PASSED** — Validation 2, all seven checks |
| Freight Type enum contract | **PASSED** |
| Tier ordering | Correction built + deployed; **browser proof pending** |
| Field calculation freshness | **OPEN · release-blocking** — reproduction not run |
| Costs responsiveness / lag | **OPEN · release-blocking** |
| PR #183 effectiveness | **Not proven** |
| Costs Functional Certification | **OPEN** |
| Costs Operational Certification | **Not started** — correctly blocked behind functional |

### Held — do not start until functional is closed

- Nine-action responsiveness audit (Add Destination, Record Shipment, Freight
  Type change, Freight amount change, Duty change, Tariff change, Packaging
  markup change, Component Attach, Cost Stack update).
  Pass conditions are not "fewer refreshes": one governed reconciliation cycle
  per action burst · no duplicate submission window · no disappearing or
  reappearing values · no Cost Stack temporary loss of Freight/Duty ·
  operator-visible completion in an acceptable range · scroll and editing
  context preserved.
- Any optimistic Freight model.
- PR #182 (`fix/setup-costs-inheritance`) — Validation 3, not yet run, and
  deliberately **excluded** from the certification branch.
- PR #180 / PR-F, publication `0036`, PR-G, Phase 3.

### Responsiveness — measured, not impression

One add-destination on the pre-coalescing branch:

```
05:04:56.119  POST starts   [bundle:tiers] 404ms
05:04:57.572  destination row committed        → ~1.45s write path
05:04:58.122  GET render #1 [bundle:nm.assemblies] 669ms · post-meta 768ms
05:04:58.505  GET render #2 [bundle:quote_lookup] 997ms · post-auth 566ms
05:04:58.987  GET render #3 post-auth 829ms
```

Three concurrent full-bundle re-renders per write, stages approaching 1s.
Refresh amplification remains the **hypothesis**; PR #183's coalescing is in
the certification branch but its effectiveness is unproven.

---

## 6. Branch inventory

| Branch | Head | Contains |
|---|---|---|
| `certify/costs-operational` | `8c31051` | all five corrections + instrumentation |
| `fix/costs-reconciliation-ordering` | `231967e` | Validation 1 **PASS** |
| `fix/tier-freight-break-propagation` | `7972abf` | Validation 2 **PASS** |
| `fix/freight-mode-enum-contract` | `9f24145` | enum contract |
| `fix/freight-tier-ordering` | `fac311e` | tier alignment |
| `fix/freight-shipment-membership` | `461d2b2` | PR #183, coalescing |
| `validate/tier-freight-break-propagation` | `3f61a97` | propagation + enum + ordering |
| `fix/setup-costs-inheritance` | `e0f30da` | PR #182, **not** in certification branch |

**No PRs opened** for the correction branches. 222/222 unit tests, TypeScript
clean, all prebuild verifiers PASS on `certify/costs-operational`.

Merge note: `freight-drilldown.tsx` conflicted between PR #183's action-scoped
pending and the enum + ordering changes. Resolved keeping **both** —
`busy(...)` / `submit(action, key)` scoping retained, `cells.map` alignment
applied on top. `rows.map` count is 0.

---

## 7. Data state and cautions

**Governed fixture `2f29af72-805b-446c-866c-73e9b0991b1a` — untouched.**
Re-verify at close:

| Slice | Digest |
|---|---|
| quote | `2905b287e4be07ac76a4d77b1913cdf3` |
| tiers | `8531e9c59e3dc36c17188b3e0e371c95` |
| breaks | `4935793b4851b6694db4557af9fd0748` |
| packaging | `aae4b5a05b36ddb600a05eb974d80cfe` |

**`52bd0077`** is the Validation 2 evidence artifact — preserve. State: 3
destinations (Los Angeles CA selected, ZZ-VAL Newark NJ, ZZ-VAL Savannah GA),
4 tiers (1,000 / 5,000 / 10,000 / none), 12 break rows, LA in differs-by-break
with amounts 4200 / 4200 / 9000 / null at 18% markup.

### Cautions earned the hard way this session

- **Browser-reported 503s are unreliable.** `read_network_requests` reported
  503 for a POST that demonstrably committed. Vercel logs showed no error.
  Always correlate against server logs before treating a 503 as real.
- **The `find` tool mislabels table columns.** It reported markup fields as
  "Tier 1" twice and contaminated two validation runs. Verify column identity
  from the **database** or from the `aria-label` attributes added in
  `fac311e` (`Freight type · Tier N`, `Item or description · Tier N`).
- **`form_input` does not fire blur.** Number and text inputs commit on blur —
  set the value, then click the field and press Tab. `<select>` commits on
  change and needs no blur.
- **Shared dev/prod Supabase.** Any migration or manual SQL is a production
  change. Session-mode pooler `:5432` only.
- **`git add -A` sweeps scratch files.** `q-validation.mjs` / `q-watch.mjs` are
  in `.git/info/exclude`. `tests/e2e/costing/costs-reconciliation-ordering.spec.ts`
  is deliberately untracked — it belongs to
  `fix/costs-reconciliation-ordering`, not to any commit made so far.

---

## 8. Cleanup owed when certification closes

Both instrumentation modules are marked TEMPORARY and must be removed once the
verdict is recorded: `src/lib/costs-trace.ts`, `src/lib/costs-timing.ts`, and
their call sites in `freight-drilldown.tsx`, `packaging-drilldown.tsx`,
`production-drilldown.tsx`, `costing-store-provider.tsx`,
`freight-worksheet.ts`, `costing.ts`.

---

## 0.9 Confirmed findings logged 2026-08-06

### F-1 · Invariant-governance defect — six raw-SQL fixture writers

**Confirmed defect. Release-blocking for `NOT NULL` enforcement, not for Costs
certification.**

Production code cannot create an unpointered `assembly_leaves` row:
`src/lib/product-structure/grouped-membership-compatibility.ts` is the only
writer in `src/`, it inserts the canonical `quote_leaves` row first and always
sets `quoteLeafId`, and both callers (`actions/assemblies.ts` for create and
attach, `actions/quotes.ts` for clone, copy and revision) route through it.

Six writers under `scripts/` bypass it entirely with raw SQL:

| File | Line |
|---|---|
| `scripts/seed-sample-order.mjs` | 365 |
| `scripts/provision-cb-step10-fixture.ts` | 284 |
| `scripts/provision-cb-step8b-fixture.ts` | 169 |
| `scripts/provision-cb-step8c4-fixture.ts` | 221 |
| `scripts/smoke/mark-complete.ts` | 254 |
| `scripts/parity/so-field-parity.ts` | 395 |

All six do `INSERT INTO assembly_leaves (assembly_id, leaf_id, quantity,
position)` with no pointer. **These are the origin of the 129 orphans.** This
is Pattern 53 at structural rather than commercial grain: fixtures that do not
mirror what production writers do, which is how a structural invariant was
violated 129 times without any surface reporting it.

Sequence, in order, each as its own change:
1. Route all six through the canonical creation path.
2. Validate that fixture provisioning still produces pointered rows.
3. Only then propose `assembly_leaves.quote_leaf_id NOT NULL` as a separate
   governed change.

Applying the constraint before step 1 would break every fixture provisioner
and every CB smoke walk.

### F-2 · Process finding — shared-database migration authorization

**Standing process change, effective immediately.**

Migration `0056` was authored, journalled and applied inside a single working
session against the **shared dev/prod Supabase project**. It was transactional
and fail-closed, and the disposition authorizing the repair was explicit — but
authorization to *perform a repair* is not the same as authorization to
*execute it against production at a particular moment*.

**Future migrations against the shared database require explicit execution
authorization before application, separately from approval of the change
itself.** Transactional safety and a fail-closed postcondition reduce the blast
radius of a bad migration; they do not substitute for the operator choosing
when production is written to.

The correct shape: author the migration, report the predicted classification
and the digest plan, then STOP and request execution authorization. Apply only
on an explicit go.

Related: the existing "Single Supabase project" section of CLAUDE.md already
warns that any local migration is a production migration. That warning covers
the hazard; this finding adds the missing control.
