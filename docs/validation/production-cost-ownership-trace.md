# Production cost ownership — reconciliation trace

**Traced 2026-08-17 against `3f402c0`.** Authority:
[BV-012](../business-validation/BV-012-production-cost-ownership.md).

**This document reports. It decides nothing and authorizes nothing.** No
Production/OTC implementation follows from it without a separate disposition.

---

## Headline

**The persistence identity is already right. The divergence is above it.**

`assembly_production_inputs.assembly_id` is `NOT NULL` and references
`assemblies`, so Production economics are already keyed to the Item Group, and
a Direct Product structurally *cannot* hold a Production row. BV-012 §1.b is
enforced by a foreign key.

Everything that diverges does so **above** the storage layer — in the adapter
that re-keys Production onto a component before the math sees it, and in an
authoring surface that offers Production entry on objects that must not have
it.

Measured on the live database:

| | |
|---|---|
| `assembly_production_inputs` rows | 90 |
| rows whose assembly does not resolve | **0** |
| assemblies carrying non-zero Production | 17 |
| Direct Products (`quote_leaves.assembly_id IS NULL`) | 5 |
| Direct Products holding Production economics | **0 — structurally impossible** |

---

## The seven dimensions

| # | Dimension | Verdict |
|---|---|---|
| 1 | Persistence identity | **Aligned** |
| 2 | Authoring surfaces | **Materially wrong** — M-1, M-2 |
| 3 | Costing / rollup | **Structurally different** — S-1 |
| 4 | Allocation | **Aligned** |
| 5 | Freight interaction | **Aligned-adjacent** |
| 6 | Customer Quote / PDF | **Aligned** |
| 7 | NetSuite projection | **Unverified** — U-1 |

---

### 1 · Persistence identity — ALIGNED

`src/db/schema.ts:3013` — `assembly_production_inputs` is keyed
`(assembly_id, tier_id)`, `assembly_id NOT NULL REFERENCES assemblies(id)`.
Per-assembly policy (`customer_ships_raws`, `allocate_service_fees_to_cost`,
`notes`) and per-tier cost inputs live on the same row.

There is no column by which a Direct Product could own Production economics,
and no orphan rows exist. Nothing to change here, and **changing it is not
implied by BV-012** — the storage already says what the authority says.

### 2 · Authoring surfaces — MATERIALLY WRONG

**M-1 · A Direct Product renders editable Production cells that silently
discard input.**

`production-drilldown.tsx` iterates `buildTreeRenderOrder(skus)` and renders a
full `<ProductionTable>` for **every non-assembly SKU**. A Direct Product is a
leaf with no parent, so it takes that branch and displays Filling / blending,
CM assembly, Setup, Tooling/artwork, R&D and Other service as editable cells.

The write cannot land:

```ts
const assemblyId = sku.parentSkuId;
if (!assemblyId) return;   // leaf without a parent
```

An operator types a Filling fee on a folding carton, the value renders in the
input, and **nothing persists and nothing says so.** The guard returns before
the action is called, inside a fire-and-forget transition.

Note the two failures are independent, and both are real:

- **against BV-012** the affordance must not exist at all;
- **against operator trust** an affordance that accepts a value and discards
  it silently is a defect regardless of which authority is correct.

The economic *outcome* happens to match BV-012 — nothing is written, so no
Direct Product acquires Production economics. That is the FK doing the work,
not the UI. The surface is still making a promise the model refuses.

**M-2 · Member leaves each render a full Production table; only the anchor
carries data.**

Under an Item Group with N member leaves, N Production tables render. Only the
lowest-position leaf is fed by the adapter (see S-1); the rest render empty
cells that write to the *same* `(assembly, tier)` row via `sku.parentSkuId`.

So the surface presents Production as **per-component**, N times over, for
economics BV-012 says the Item Group owns once. Two operators editing two
member leaves of one assembly are editing one row through two doors.

### 3 · Costing / rollup — STRUCTURALLY DIFFERENT

**S-1 · The math layer's Production unit of account is a component.**

`CostingProductionInput.quoteSkuId` is a LEAF id (`costing.ts:191`).
`costing-adapter.ts` bridges the gap by attaching each assembly's Production
row to its **anchor leaf** — lowest `position` — leaving siblings with no
Production entry.

**Arithmetic is correct.** anchor (packaging + production) + siblings
(packaging only) = assembly total. The adapter's header documents this and
prefers it to fan-out-and-divide precisely because it stays auditable: one
`assembly_production_inputs` row ↔ one `production[]` entry.

**Attribution is wrong under BV-012.** The money is right; the owner is not.
Per-leaf reads of `skuRollups` see Production sitting on a bottle.

This is the Pattern 58 distinction exactly — membership may determine
attribution, never arithmetic — and it is why this is classed *structurally
different* rather than *materially wrong*: no figure moves. The adapter's own
header already anticipates the correction: *"extend the math layer to consume
production keyed by assembly_id directly (or add a per-assembly production
slot to `QuoteCostingInput`)."*

### 4 · Allocation — ALIGNED

`allocate_service_fees_to_cost` is stored per-assembly on the same row.
Quote-wide *authoring* was settled separately on 2026-08-17 and is not affected
by BV-012: authoring scope and ownership are different questions. Divergent
per-assembly values remain expressible in storage and are read honestly as
`mixed by product`.

### 5 · Freight interaction — ALIGNED-ADJACENT

Freight is a separate subsystem with its own attribution anchor discipline
(OD-017, OD-025, Pattern 58) and its own unratified treatment authority
(BV-009 / OD-001). BV-012 §1 lists freight among finished-good costs but does
not disturb how freight attributes. **No finding.** Flagged only so a future
reader does not infer that BV-012 silently re-opened BV-009.

### 6 · Customer Quote / PDF — ALIGNED

`customer-view-resolver.ts:379` aggregates Production into `aggByAssembly` and
emits each service fee with `skuLabel: assembly.skuLabel`, keyed
`${assemblyId}::${field}`. The customer already sees Production economics
presented as Item Group economics.

The customer-facing boundary is therefore **the one surface that already
implements BV-012** end to end.

### 7 · NetSuite projection — UNVERIFIED

**U-1.** A sweep of `netsuite/sales-orders.ts` and `netsuite/grouping-plan.ts`
found no Production-specific or service-fee-specific projection: the only
`production` matches are `custbody_dps_pp_production_ship_date`, an unrelated
date field. Completion pushes lines summing to the accepted commercial total
(REG-4), which carries Production economics implicitly rather than as
identified lines.

This is **not** a finding of correctness or incorrectness — it is an absence of
evidence, and BV-011's 16 destinations do not exist yet. It needs its own pass
before the Production/OTC workstream opens, and that pass should establish what
NetSuite receives today before deciding what it should receive.

---

## Separation, as asked

**Materially wrong business behaviour — 2**

| id | Finding |
|---|---|
| **M-1** | A Direct Product renders editable Production cells whose values are silently discarded. Violates BV-012 §1.b as an affordance, and loses operator input without notice regardless of authority |
| **M-2** | Production renders once per member leaf, presenting Item-Group economics as per-component and giving one stored row N authoring doors |

**Structurally different, no figure moves — 1**

| id | Finding |
|---|---|
| **S-1** | The math layer keys Production to a leaf; the adapter attaches it to an anchor leaf. Totals reconcile exactly; the unit of account is a component rather than the Item Group |

**Unverified — 1**

| id | Finding |
|---|---|
| **U-1** | NetSuite projection of Production economics is not established. Needs a dedicated pass |

**Aligned — 4:** persistence identity, allocation storage, freight adjacency,
customer-facing projection.

---

## One observation about sequencing

M-1 and M-2 are both in the **authoring surface**, and S-1 is in the
**adapter**. None is in storage, and none requires a migration. If the
Production/OTC workstream is later scoped, that ordering is worth knowing: the
business object is already correct where the data rests, and the corrections
are display-and-entry shaped rather than schema shaped.

That is an observation about what the trace found, **not** a recommendation
about what to do, which is not this document's to make.
