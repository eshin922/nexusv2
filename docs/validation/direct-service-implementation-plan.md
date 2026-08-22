# Direct Service — implementation plan

**Written 2026-08-17 against `2330296`.** Ordered around the ten boundaries in
the disposition. Authority:
[BV-012 §5](../business-validation/BV-012-production-cost-ownership.md),
[BV-011](../business-validation/BV-011-production-otc-accounting-map.md),
[BV-013](../business-validation/BV-013-production-markup-authority.md).

**The decided questions are not reopened here.** This records sequencing,
architectural dependencies, and the questions that genuinely still block.

---

## What blocks, and what merely follows

**Three architectural dependencies constrain the order.** Everything else is
downstream of them.

**D-1 · Identity precedes storage precedes surface.** Stages 1 → 3 → 4 are a
hard chain. The Costs surface must be gated on service identity, not on the
presence of production rows (otherwise the first stray row recreates what #282
removed), and identity cannot gate anything before it exists.

**D-2 · The Production-ownership migration and the BV-013 category migration
touch the same table.** Stage 3 adds a second owner column to
`assembly_production_inputs`; stage 5 changes how its markup resolves. Running
3 before 5 means stage 5 handles rows with either owner — which it must
eventually anyway. Running 5 first means re-proving BV-013's invariance after
stage 3 moves the rows underneath it. **Stage 3 first**, deliberately.

**D-3 · Stage 8 depends on F2's mechanism, which is directed but not designed.**
"Separately billed Item Group charges must reach the SO" is settled as
direction. Whether that is a new SO line built at push time, an OTC line
materialised at accept time, or a change to what `totalRevenue` includes, is
undecided — and it determines whether REG-4's "lines sum exactly to the accepted
commercial total" needs its definition of *accepted commercial total* revised.
See Q-A below.

---

## The stages

### 1 · Product Library service identity + attachment constraint

Add a governed service classification to the library entry. Not
`product_types.scope` (that is `["assembly","leaf"]`, i.e. placement), not the
legacy `Service / labor` type, not HubSpot's field.

The attachment boundary is the load-bearing half: a service-classified entry may
attach only as a top-level Direct Service. Enforced at the governed write
boundary — the same posture as Client Target's refusal of an Item Group member.

**Falsification:** attaching a service entry beneath an Item Group is refused by
the action, not merely absent from the UI.

### 2 · Setup — `Add Direct Service`

A third intentional act beside `+ Add Product` and `+ Create Item Group`. The
operator states what the customer is buying; nothing is inferred from which
Costs fields hold values.

**Falsification:** a Direct Service exists in the quote before any cost is
entered, and its identity survives having no costs at all.

### 3 · Production-input ownership — Item Group XOR Direct Service

`assembly_production_inputs` grows a nullable `quote_leaf_id`, `assembly_id`
becomes nullable, and a CHECK enforces exactly one owner.

**This shape is already in production twice:** OD-017 moved packaging cost
identity onto `quote_leaf_id`, and migration 0077 (Client Target) runs the
`assembly_id XOR quote_leaf_id` CHECK with per-branch partial unique indexes.
Follow 0077.

**The invariant that must not be lost.** Today "a Direct Product cannot own
production" is guaranteed by a NOT NULL FK — a violation is *unrepresentable*.
After this it becomes *legal and merely wrong*, so it needs an explicit guard:
only a service-classified leaf may own production rows. This is the Pattern 56
shape exactly, and the reason to write the guard in the same change that removes
the FK, not after.

**Falsification:** a production row keyed to a non-service `quote_leaf_id` is
refused; existing assembly-owned rows are bit-identical; the costing witness
shows zero movement.

### 4 · Costs authoring for Direct Service, gated by identity

Service authoring surface driven by the library service identity — a Filling
service does not expose Formulation, Tooling or Pack-out. No allocation control
(BV-012 §5.d). No packaging-component masquerade.

**Do not undo #282:** no generic Production table returns to top-level leaves.
The surface appears because the unit *is* a service, never because it *has*
rows.

### 5 · BV-013 — `Production` at 40%, preserving pin invariants

Already traced. The three-rung fallback is the risk, not the rate: `Raw
ingredients → Other`, the implicit `"Other"` default arg, and
`FALLBACK_MARKUP = 0.3` all resolve to 30% today, so a half-migration looks
correct now and breaks the moment any rate moves. A missing `Production`
category must fail loudly.

**Carries a prerequisite already identified:** existing pins contain
`Manufacturing` and `Raw ingredients`, never `Production`. Pinned quotes must
resolve their historical rate after consolidation rather than falling through to
live 40%. Compatibility first, then the live authority.

**Falsification:** drafts adopt 40%; every pinned non-draft is bit-identical;
no non-draft resolves live; no Production or Bulk Raw path can reach `Other` or
the 30% global fallback.

### 6 · Customer Quote / PDF

`customer-view-resolver.ts` aggregates by `aggByAssembly` and labels fees with
the assembly's `skuLabel`. A Direct Service has no assembly and would be
**invisible on the document the customer signs** — the Pattern 45 failure mode.
Widen the aggregation key to the owning sellable unit. `FEE_COPY`'s four labels
are narrower than the service vocabulary.

### 7 · NetSuite — standalone Direct Service projection

A service leaf with its own NetSuite item projects as a line by the existing
leaf-line mechanism; library service identity + BV-011 mapping resolve the item.
This is the *closest* of the NetSuite work to already functioning.

### 8 · NetSuite — Item Group OTC lines + allocation-OFF reconciliation

The largest stage, and the one carrying **D-3**. OTC lines associate with the
owning Item Group **without joining `composition_hash`** — product structure
alone governs Item Group identity, so Setup/Tooling/Testing/Freight changing
between quotes must not manufacture a new group. OD-004 identity stability is a
falsifiable property here, not a hope.

### 9 · Engagement expansion

Explicit operator action, original Direct Service history intact, new Item Group
built from remaining economics, nothing silently duplicated/deleted/moved, and
the service product **not** attached beneath the group.

Existing shapes worth reusing rather than inventing: `copied_from_quote_id`, the
`scenario_copied` audit action with its `source_type` discriminator, and the
`quote_snapshots` supersede pattern.

### 10 · End-to-end sandbox certification

Representative NetSuite orders for all three sellable units, with operator
review. Certification is the gate, not the last coding step.

---

## The four blocking questions — SETTLED 2026-08-17

| # | Settled as | Authority |
|---|---|---|
| **Q-A** | `Accepted Commercial Total = unit-based sell revenue + separately billed OTC/service lines`. `totalRevenue` keeps its unit-economics meaning; the reconciliation authority composes OTC explicitly on top | BV-012 §5.g |
| **Q-B** | Bulk Raw is **not** a Direct Service — material/input economics, inside an Item Group envelope | BV-012 §5.f |
| **Q-C** | Five governed identities: Formulation · Filling / Blending · Pack-out / Assembly · Testing / Micros · Other Service. BV-011 destinations are **not** auto-promoted | BV-012 §5.f |
| **Q-D** | OTC lines freeze at the acceptance/send boundary; push consumes the frozen representation and never derives the set for the first time | BV-012 §5.h |

**Q-A's shape is the one to carry into stage 8.** The two candidate mechanisms
produced identical SO totals and different Pricing surfaces, and the chosen one
keeps them apart deliberately: `totalRevenue` was not widened, because every
margin read in the engine consumes it. Stage 8 composes; it does not redefine.

**Q-D binds stage 8 to stage 6, not only to stage 7.** If the authoritative OTC
set freezes at send, the snapshot must already carry it — so the customer-facing
representation and the frozen set are one piece of work, not a PDF change
followed later by a push change.

---

## Final sequencing

Confirmed as directed. Where a stage carries a guard that must not drift into a
later one, it is named.

| # | Stage | Ships with it |
|---|---|---|
| 1 | Product Library Direct Service identity + attachment prohibition | The prohibition is enforced at the governed write boundary, not in UI copy (BV-012 §5.c). Classification values come from the §5.f closed set |
| 2 | Setup `Add Direct Service` | Operator states intent; nothing inferred from which Costs fields hold values |
| 3 | **Production ownership XOR migration — with same-slice guards** | See below. Non-negotiable co-shipping |
| 4 | Direct Service Costs authoring/persistence | Surface gated on service **identity**, never on presence of rows (#282 must not be undone). No allocation control (§5.d) |
| 5 | BV-013 `Production = 40%` | After ownership is stable. Carries the fallback-ladder work and the existing-pin category compatibility |
| 6 | Customer Quote/PDF Direct Service + explicit OTC total | Widen `aggByAssembly` to the owning sellable unit; a Direct Service must not be invisible on the signed document (Pattern 45). Freeze per §5.h |
| 7 | NetSuite Direct Service line projection | Library service identity + BV-011 mapping resolve the item |
| 8 | Item Group separate-OTC SO lines + exact accepted-total reconciliation | Compose per §5.g. OTC association must not join `composition_hash` (F4) — OD-004 identity stability is falsifiable here |
| 9 | Engagement-expansion workflow | Explicit action; original history intact; §5.c holds through expansion |
| 10 | Sandbox + operator certification | All three sellable units, representative NetSuite orders |

### Stage 3 — what must ship in the same slice

Today "a Direct Product cannot own Production" is **unrepresentable**: the
`NOT NULL` FK to `assemblies` makes the violating row impossible to write.
Introducing the second owner branch makes it merely *illegal*.

So the following are one slice, not a slice and a follow-up:

1. the XOR migration (`quote_leaf_id` nullable, `assembly_id` nullable, CHECK
   exactly one) — following migration 0077's shape;
2. the **service-identity guard**: only a service-classified leaf may own
   production rows;
3. the **attachment constraint** from stage 1 enforced at the write boundary.

Pattern 56: a property that held because nothing could express the violation
leaves no symptom when it stops holding. The guard has no observable effect on
the day it ships, which is exactly why it cannot be deferred to the day it
would.

**Falsification for the slice:** a production row keyed to a non-service
`quote_leaf_id` is refused; a service entry attached beneath an Item Group is
refused; existing assembly-owned rows are bit-identical; the costing witness
shows zero movement.

---

## Carried, not lost

**`legacy_live` retirement** (step 5 of the pin sequence) remains outstanding
and is independent of every stage above. The pin backfill is complete — 14/14
pinned, economics bit-identical, `legacy_live` at zero today — but the runtime
path still exists, so a future unpinned non-draft quote would silently resolve
live again. Tracked in `UX_BACKLOG.md`.
