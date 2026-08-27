# OD-032 — full capability scope, end to end, with three implementation shapes

**Analysis only. No implementation, and none proposed as a next action.** Phase 3 code,
Phase 4 authoring and any Costs rewrite remain held.

**Estimating unit.** Effort below is expressed in **governed phases of the size this
workstream has actually been shipping**, never in weeks and never inferred from how large the
change feels. The measurements are in §1 and every figure downstream refers back to them.

---

## 1 · Observed throughput — measured, not assumed

From `main` on 2026-08-27:

| Measure | Value |
|---|---|
| Merged PRs on `main` | **219** |
| Distinct commit days | 55 (first 2026-04-28) |
| PRs/day across the last 15 active days | 1 – 37, **median ≈ 12** |
| Median PR | **3 files · 199 insertions** |
| Mean PR | 5.7 files · 420 insertions |
| Migrations shipped in 2026-08 | 48 |
| Unit test files / assertions | 235 / **2,569** |
| Prebuild verifiers | 38 |
| Gate-1B harnesses | 115 |

**OD-032's own phases are the closest sample**, and they are the unit used throughout:

| PR | Content | Size |
|---|---|---|
| #468 | implementation plan (docs) | 13 files · 6,371 ins |
| #469 | phase 1 — instance identity | 9 files · 851 ins |
| #470 | phase 0(a) — layout amendment | 1 file · 60 ins |
| #471 | phase 1b — contract identity | 6 files · 387 ins |
| #472 | phase 2 — storage, registry, costing input | 14 files · 1,555 ins |
| #473 | contraction + proof | 5 files · 190 ins |

**Four governed phases landed across two active days**, each as one PR, each with its own
falsification set and its own migration where one was needed.

**So one "phase" ≈ 5–14 files, 200–1,600 insertions, one PR, one falsification set.** That is
the currency below. What it does *not* price is Edward's review, disposition and smoke time,
which has been the actual rate limiter on every phase so far and is not something this
document can measure.

---

## 2 · Where OD-032 already stands

Shipped and closed. Legacy population proved **byte-identical** across all of it (md5
`c70af124`, 107 quotes, 0 unresolved), and that same hash spans `main` before Phase 2, the
Phase 2 code, and the contraction.

| Layer | State |
|---|---|
| **Storage** | `quote_charge_instances` (+ `owner_quote_leaf_id` FK, owner-agreement CHECK, business unique) and `quote_charge_instance_tiers` (cost + recovery ask per instance × tier). Migrations 0107–0110 applied. |
| **Identity** | Generated `charge_instance_id`. Election PK re-keyed to it; the temporary quote-wide unique dropped and proven by transaction. |
| **Registry** | 5 component types, labels, `isComponentChargeKey`, `labelRequiredFor`. Two new enum values. |
| **Costing** | `ComponentChargeInput`, `componentChargeEconomics`, `QuoteCostingInput.componentCharges`, causal-owner filter on `canonicalQuoteLeafId`. 34 falsifications. |

**Nothing else is built.** Everything in §3 is remaining work.

---

## 3 · End-to-end scope against the current product

Each row states what exists, measured, and what OD-032 would require.

### 3.1 Storage / identity — **complete**

No remaining work for component-owned charges. One adjacent gap, found while scoping:

> **⚠ FINDING — copy loses component charge economics.** `cloneQuoteGraph` clones charge
> instances and elections (Phase 1 added `ensureChargeInstance` to the copy path), but
> **does not clone `quote_charge_instance_tiers`**. A copied quote would carry the election
> and lose the money. Unreachable today — nothing can author one — but it becomes a live
> defect the moment Phase 4 ships. **Roughly a third of a phase**, and it belongs to
> whichever phase makes authoring reachable, not to a later cleanup.

### 3.2 Costing — **complete**

The engine consumes component charges as data, once per tier, unscaled by component quantity,
with no lever reaching them. Proven behaviourally rather than structurally.

### 3.3 Commercial Recovery — **the largest remaining piece**

Measured: the recovery UI addresses charges by `chargeKey` in **3 files, 22 references**
(`card-commercial-recovery.tsx` 14, `use-recovery-draft.ts` 5, `customer-view-rail.tsx` 3).
**Zero component references to `chargeInstanceId`** — the instance grain reaches the action
layer and stops there.

Required: recovery becomes per-instance, plus the group action ("Set all Print plates → fee")
that the round trip says is not optional, because without it the operator's shortcut becomes
absorbing charges to quiet the rail — a margin event chosen for interface reasons.

**≈1.5 phases.** The count is small; the care is not, since this surface governs money.

### 3.4 Setup — the entry point

Measured: the assembly tree has **no row-level `···` menu today**. The two-phase sheet
(select types → enter economics) is entirely new UI, and it is the one place the Design
Authority draws in full detail, so fidelity is checkable rather than interpreted.

**≈1.5–2 phases** (Phase 4 as planned).

### 3.5 Costs — **unresolved, and the reason this document exists**

`costs/page.tsx` composes three regions. One-time charges are `one_time_fee` virtual lines
inside **Production**; duty and customs inside **Freight**. There is no one-time region.

Cost depends entirely on shape — see §4. This is the only line item whose range spans
an order of magnitude.

### 3.6 Copy / revise / freeze

- **Copy** — the §3.1 finding.
- **Freeze** — `quote_snapshot_recovery_instructions` carries `chargeKey` + `ownerRef` and
  **has no `charge_instance_id`**. Two same-type charges on one quote cannot be told apart in
  the frozen record. One additive migration + writer change. `quote_charge_instance_tiers` is
  also **not on the Pattern 52 freeze list** and must be added.
- **Revise** — the design's rule (charges do not migrate when the owning component is
  swapped; they are dropped with notice) is unbuilt.

**≈1 phase**, and the freeze half is not optional: it is what makes the record Accounting
bills from unambiguous.

### 3.7 Customer document

`commercial-projection.ts` enumerates OTC lines from **`OTC_FEES`, a fixed list of production
fee columns**. A component charge has no column, so it reaches no line — the boundary
recorded and asserted in Phase 2.

Required: emit component charges as commercial lines, plus the owner-disambiguation rule
(print the type name; add the owner only on collision).

**≈1 phase.** Pattern 45 applies in full — this is the surface the firm does not get to
apologise for.

### 3.8 NetSuite — **much smaller than it looks**

Measured, and the good news is concrete:

- `bv011_destination` **already contains `otc_print_plates`, `otc_dies`, `otc_samples`**, and
  `bv011-destinations.ts` already carries their labels and item types.
- Separately-billed OTC **already reaches NetSuite** as quantity-1 accounting lines.
- `OTC_COLUMN_DESTINATION` maps a production **column** → destination. Component charges have
  no column, so what is missing is a **`charge_key` → destination map** and the projection
  emission from §3.7.

No new accounting vocabulary, no new push mechanism, no Item Group interaction.

**≈0.5 phase**, and it rides §3.7 rather than standing alone.

### 3.9 Migrations and compatibility

0107–0110 applied. Remaining structural work is **one additive migration** (`charge_instance_id`
on the frozen instruction table). Everything else is code.

Migration risk is **low and bounded**, for a reason worth stating: every OD-032 migration so
far has been expand-only or a contraction gated on a deployed-writer proof, and the population
has stayed byte-identical throughout. The pattern is established and has held four times.

---

## 4 · Three implementation shapes

Common to all three: §3.1 copy, §3.3 recovery, §3.4 Setup, §3.6 freeze, §3.7 document,
§3.8 NetSuite. **They differ only in what happens to Costs** — which is why Costs is the whole
decision.

### Shape A · Minimal V1 — charges exist, Costs barely changes

**What it is.** Component charges are authored in Setup, priced per tier, elected per
instance in Recovery, printed, and pushed. In **Costs**, they appear nested under the
component row in Packaging, and Production gains **one attribution line**. Nothing moves
between regions. This is the placement drawn in the Costs Placement round trip.

| | |
|---|---|
| **Capabilities required** | Setup sheet · per-instance recovery + group action · copy clone · freeze instance id · document emission + collision rule · charge_key→destination map · Packaging nested block · Production attribution line |
| **Governed surfaces touched** | Setup, Recovery, Costs (2 additive elements), freeze, customer document, NetSuite |
| **What existing behaviour moves** | **Nothing.** No row changes region, no region is created, tier geometry untouched, no economics change |
| **Migration risk** | **Low** — one additive migration |
| **Validation burden** | Falsifications per phase as now; one full-population neutrality run; one permutation gate; Pattern 45 sweep on the document |
| **Size** | **≈5–6 phases** |

**The honest caveat.** Shape A leaves one-time charges split across two Costs regions and
duty/customs in Freight — compromises C1–C5 in the placement round trip. It is a **placement**,
not an architecture, and it is recorded as such so the post-V1 redesign inherits the questions
rather than the answers.

### Shape B · Moderate — one owner grammar across Costs

**What it is.** Shape A, plus a single consistent owner-attribution treatment across
Packaging and Production, and a Costs-level summary of one-time charges by owner. Still no
region moves and duty/customs stay in Freight.

| | |
|---|---|
| **Adds over A** | one shared owner-header primitive · a by-owner one-time summary · retreatment of Production's existing tables to the shared grammar |
| **What existing behaviour moves** | **Production's existing fee rows gain a new visual treatment.** No data moves; a certified surface changes appearance |
| **Migration risk** | Low — same single migration |
| **Validation burden** | A + designer fidelity pass on a surface that is currently certified and that operators are being trained on **this week** |
| **Size** | **≈7–8 phases** |

**What it buys.** It resolves compromise C5 (two regions, two treatments) and makes owner
attribution legible as one idea rather than two local ones.

**What it costs.** It re-treats a surface under active training for a consistency gain, and
it is the shape most likely to be undone by the post-V1 redesign — the redesign will decide
the owner grammar for the whole page, and this would be a first guess at it.

### Shape C · Full Costs restructure

**What it is.** Build `costs-page-layout` §4a: a standalone one-time region at the foot,
one-time lines moved out of Production, duty and customs moved out of Freight, the region
carrying `[line rows × tier columns]`.

| | |
|---|---|
| **Adds over A** | new Costs region · move 6 line types out of Production · move duty/customs out of Freight · new tier geometry · rework the Freight drilldown around the removal |
| **What existing behaviour moves** | **Two certified regions are restructured.** Every operator trained on the current Costs page is retrained |
| **Migration risk** | Still low structurally — but **behavioural** risk is the highest of the three, because Freight and Production are load-bearing for costs that are already being quoted |
| **Validation burden** | A + full Costs re-certification + freight/duty parity proof + a designer round for a screen **nobody has drawn** |
| **Size** | **≈12–15 phases**, and the range is wide because the design does not exist yet |

**The disqualifying fact, stated plainly.** There is no drawn Costs screen anywhere in the
Design Authority. Shape C would be built from prose, which is exactly the reinterpretation the
fidelity requirement rules out. It cannot be scoped honestly until a design exists, and
producing that design is itself a design round.

---

## 5 · Reading the three against the stated bias

The question asked was whether the minimal path is *still effectively a Costs redesign*.

**It is not.** Shape A's entire Costs footprint is **one nested block in Packaging and one
attribution line in Production**. No row changes region; no region is created; no economics
move; the tier grid is untouched. Measured against the median PR (3 files, 199 insertions),
the Costs portion of Shape A is smaller than a typical PR on this repository.

The Costs *redesign* is Shape C, and it is separable — nothing in Shape A forecloses it, and
Shape A's compromises are already written down as its inputs.

**What genuinely deserves caution is not Costs.** It is §3.3 Recovery and §3.7 the customer
document: 22 references to change on a surface that governs money, and a document boundary
with its own standing rule. Those are common to all three shapes, so they are the cost of
OD-032 at all rather than the cost of any particular Costs answer.

**Bounded-capability test.** OD-032 can be delivered as a bounded capability if and only if
Costs is treated as placement rather than architecture. Shapes B and C both make OD-032 the
vehicle for a Costs-page decision; Shape A does not.

---

## 6 · What this document does not claim

- **It does not price review.** Every phase so far has been rate-limited by disposition and
  smoke, not by implementation, and this document cannot measure that.
- **It does not assume Phase 4's design survives contact.** The Setup sheet is drawn in
  detail, but it has never been built, and the estimate assumes the drawing is right.
- **It does not decide.** Three shapes, measured, with the consequences of each stated.
