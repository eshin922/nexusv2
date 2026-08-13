# Attach-product production failure — release boundary, cleanup plan, defect records

**Status:** analysis only. Nothing merged, deployed, migrated, retried, or deleted.
**Date:** 2026-08-13
**Incident:** digest `2907683680`, `PostgresError 23502` on
`POST /projects/b24756d0…/quotes/d1bbdb4e…`

---

## 0 · Two corrections to the earlier reading

Both were mine, both were load-bearing, and the analysis changes with them.

**0.1 — Production is not `main`.** The deployed commit `954163d` lives on
`release/v1-spec-compliance-audit`, not on `main`:

```
git branch --contains 954163d   → release/v1-spec-compliance-audit
git merge-base --is-ancestor 954163d main   → false
git rev-list --count 954163d..main          → 0     (main contains nothing 954163d lacks)
```

Production has been served from the release branch for some time. `954163d` is
itself a production hotfix — *"fix(costs): pass shipReads into ShipmentLedger —
production Costs crash (#261)"*. The framing of "promote main → branch" was
wrong; the real question is **how far along its own branch production should be
moved**.

**0.2 — The deployed code is not ignorant of the column.** An earlier grep used a
fixed 12-line window and truncated the column list. The deployed model at
`954163d` already declares `quoteLeafId` **`.notNull()`** on all four tables that
migration 0066 tightened. The defect is not a stale model. It is one write path.

---

## 1 · Root cause, precisely

`src/lib/packaging-materialization.ts` @ `954163d`, both row builders:

```ts
pending.push({
  assemblyLeafId: leaf.id,     // ← quoteLeafId absent
  tierId: tier.id,
  lineGroupId,
  sortOrder: 0,
  inventoryEligible: false,
});
```

Drizzle's `.notNull()` is a **declaration**, not a runtime check. Omitting the key
omits the column, and Postgres supplies NULL. Until 0066 the database column was
nullable, so every attach-product materialization in production has been writing
`quote_leaf_id = NULL` **silently and successfully**.

Migration 0066 made the database agree with the model:

```sql
ALTER TABLE assembly_leaf_inputs      ALTER COLUMN quote_leaf_id SET NOT NULL;
ALTER TABLE assembly_leaf_overrides   ALTER COLUMN quote_leaf_id SET NOT NULL;
ALTER TABLE assembly_leaf_targets     ALTER COLUMN quote_leaf_id SET NOT NULL;
ALTER TABLE freight_subcategory_items ALTER COLUMN quote_leaf_id SET NOT NULL;
```

0066 did not introduce the bug. It **removed the permissiveness that had been
absorbing it** — the same shape as Pattern 56, in a different medium: a
correctness property that held only because nothing was checking it.

**Blast radius is wider than attach-product.** Four columns were tightened, and
the deployed code populates none of them on the new-row paths. Attach-product is
simply the path an operator exercised first. Sell-price overrides, client targets,
and freight subcategory items are reachable by the same failure. This is not a
one-surface regression.

**Historical data is intact.** 0066 succeeded, which means its backfill resolved
every pre-existing NULL. Only *new* writes from the deployed code fail.

---

## 2 · Minimum baseline compatible with 0066

The write-path fix is **`d6a1df2`** (OD-017). It re-keys the row builder to the
canonical identity:

```ts
pending.push({
  quoteLeafId: leaf.id,
  assemblyLeafId: leaf.legacyId,
  …
});
```

**`d6a1df2` is not cherry-pickable, for three independent reasons:**

1. **The fix and the constraint are the same commit.** 0066 ships inside
   `d6a1df2`. There is no revision that fixes the writer without also carrying the
   migration — the commit is the repair *and* the tightening.
2. **It is 20 files / 936 insertions**, spanning `schema.ts`, `costing.ts`,
   `quotes.ts`, `costing-adapter.ts`, `freight-worksheet.ts`, `pricing-lifts.ts`,
   `quote-guards.ts`, `costs/page.tsx`, `freight-drilldown.tsx`. This is an
   identity-space change, not a null-guard.
3. **It is a known-defective intermediate on its own.** The freight half of the
   re-key completes in `4dd3444` (+ migrations 0067/0068), and `OD-025` and
   `OD-028` (`75e6ba0`) are corrections to OD-017-era identity discovered later.
   Landing `d6a1df2` alone would ship a state we have already proven wrong.

**Additionally, six migrations are applied to the shared database that the
deployed code predates:** 0064, 0065, 0066, 0067, 0068, 0069. Classified:

| Migration | Class | Deployed-code compatible? |
|---|---|---|
| 0064 below_floor_authorization | additive | yes |
| 0065 durable_attempt_lifecycle | + unique index | yes (index unmet, not violated) |
| **0066 direct_component_cost_identity** | **4 × SET NOT NULL + unique index** | **NO — this is the break** |
| 0067 freight_container_not_assembly_owned | additive | yes |
| 0068 freight_identity_guard_canonical | additive | yes |
| 0069 below_floor_approval_requests | additive + partial unique index | yes (table unused) |

Only 0066 is incompatible. That is the whole of the incompatibility.

---

## 3 · Recommendation — promote to a boundary, not to the tip

Neither option in the original framing is right.

- **A narrow hotfix/cherry-pick is not available.** Section 2 establishes this on
  three grounds, any one of which is sufficient.
- **Promoting the branch tip (`88ea96c`) is not appropriate either.** The tip
  carries the Slack below-floor approval workstream (`577d47c` → `88ea96c`) whose
  controlled walk is explicitly **paused and incomplete**. Promoting it would put
  an unwalked approval surface into production as a side effect of a cost-identity
  repair.

**Recommended boundary: `4b8f5b7`** — *"docs(certification): B/C/D closeout —
artifacts preserved, debt registered"*, the last commit before the Slack
workstream opens.

It includes everything the repair requires and nothing it does not:

- ✅ `d6a1df2` OD-017 cost-input identity + migration 0066 — **the fix**
- ✅ `4dd3444` freight re-key + 0067/0068
- ✅ `75e6ba0` OD-028 SO projection identity
- ✅ `2eddae0` COSTS-RENDER-1 packaging row identity
- ✅ `9587322` ambiguous-CREATE reconciliation, `788305c`/`0bf060b` HubSpot
  write suppression (already relied upon operationally)
- ❌ excludes `868bdff` / `88ea96c` Slack approval lifecycle — unwalked
- 0069 remains applied-but-unused: an additive table nothing reads. Safe.

**Verification required before promotion** — at `4b8f5b7`, after checkout, using
the repository-governed commands and nothing else:

```
npx tsc --noEmit
npm run test:unit
```

Both must be run *at that commit*. I have not run them there, and I am not
claiming the boundary is green — only that it is the correct boundary.

**Delta:** `954163d..4b8f5b7`. The full branch delta to the tip is 178 commits;
the recommended boundary is short of that by the Slack workstream.

---

## 4 · Cleanup plan for the orphan — PREPARED, NOT EXECUTED

Failed attach on quote `d1bbdb4e` (Kirby Beauty, scenario "Primary", draft).

### 4.1 Preconditions — all 14 proven read-only

| Check | Result |
|---|---|
| no `assembly_leaf_inputs` reference the orphan | PASS (0) |
| no `assembly_production_inputs` on the assembly | PASS (0) |
| no sell-price overrides | PASS (0) |
| no client targets | PASS (0) |
| no pricing lifts | PASS (0) |
| no below-floor authorizations on the quote | PASS (0) |
| no below-floor approval requests on the quote | PASS (0) |
| no NetSuite SO pushes | PASS (0) |
| no sent snapshots | PASS (0) |
| no freight subcategories owned by the assembly | PASS (0) |
| quote is an unsent draft (`status=draft`, `quote_number=NULL`, `sent_at=NULL`) | PASS |
| exactly 1 assembly on the quote — the orphan | PASS |
| exactly 1 quote_leaf on the quote — the orphan | PASS |
| library leaf `eabba094` (10064-GNX-Box) exists and must survive | PASS |

The quote was never a commercial artifact: no number, never sent, no
authorization, no accounting projection.

### 4.2 FK-safe deletion order — three rows, one transaction

```sql
BEGIN;
DELETE FROM assembly_leaves WHERE id = 'df69181a-…';   -- junction first
DELETE FROM quote_leaves    WHERE id = 'b7a85aa2-…';   -- then the leaf
DELETE FROM assemblies      WHERE id = 'bd53ac8e-…';   -- then the container
-- expect exactly 1,1,1; anything else → ROLLBACK
COMMIT;
```

Junction-before-parents is explicit rather than cascade-dependent so the row
counts are observable and a surprise is a rollback, not a silent widening.

**Explicitly NOT deleted:** quote `d1bbdb4e` (a legitimate draft), library leaf
`eabba094` (shared master data), and anything outside these three ids.

**Sequencing:** cleanup is optional relative to the release. The orphan is inert —
an assembly with no cost inputs. Deleting it before or after promotion makes no
difference to correctness, so it should follow the release rather than compete
with it.

---

## 5 · Follow-up defects — RECORDED, NOT REPAIRED

### Defect A — attach-product is non-atomic

Structure creation and cost materialization are separate transactions. When
materialization threw, `assemblies`, `quote_leaves`, and `assembly_leaves` stayed
committed. The operator saw a 500 while the product *was* attached — the surface
reported failure and the database recorded partial success.

Impact beyond this incident: any future materialization failure leaves an
assembly with no cost rows, which reads as an intentionally-empty component
rather than a failed write.

Repair direction (not taken here): one transaction spanning structure +
materialization, so an attach either lands whole or not at all.

### Defect B — migration governance does not distinguish additive from constraint-tightening

The standing rule is *"apply additive migrations BEFORE merging code that reads
them."* It is correct for additive migrations and **exactly inverted for
constraint-tightening ones**: a `SET NOT NULL` may only be applied *after* every
deployed writer populates the column. Applied early against a shared database, it
converts a dormant defect into a production outage — which is what happened.

The rule as written has no way to express that inversion, so 0066 was handled
under an additive-shaped discipline it does not fit.

Repair direction (not taken here): classify each migration at authoring time —
`additive` / `tightening` / `destructive` — and bind a deploy-order rule to the
class. Tightening migrations additionally need a pre-application probe proving
zero violating writers remain, which for a shared dev/prod database means proving
it against *deployed* code, not branch code.

**Both defects share a root:** the database was the only thing enforcing a
property the model claimed to guarantee, and nothing tested the claim against a
deployed writer.
