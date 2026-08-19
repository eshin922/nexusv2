# F1/F4 — NetSuite projection from the frozen accepted commercial column

Trace only. No implementation, and no customer-facing pricing change belongs in
the slice this describes.

Prerequisite shipped: [PR #300](pr-300-lifecycle-certification.md) froze the
commercial line set at SEND. This trace specifies how the Sales Order is built
from that frozen column instead of from live costing.

## The gap, stated exactly

`markComplete` calls `getCostingBundle(quoteId)` at push time
(`mark-complete.ts:225`) and builds one SO line per **leaf** from the live
`skuRollups` (`:691`). Its own comment states the invariant it relies on:

> Sum of all leaf-line amounts = tier's totalRevenue by construction

and the amount it reconciles against is
`currentAmount = tierRollup.totalRevenue` (`:306`).

F2 settled that

```
accepted commercial total = unit-based totalRevenue + separately billed OTC
```

Grepping the payload builder and `mark-complete` for every OTC term — setup,
tooling, R&D, other service — returns no line construction at all. **So the
Sales Order today under-bills by exactly the separately billed OTC.** On the
certification quote that is $140 / $700 / $1,400 depending on tier.

This is not a rounding discrepancy or an attribution question. It is a category
of charge that reaches the customer document and never reaches the order.

Two things follow. The projection must read the frozen column, and REG-4 must
compare against the frozen `tier_commercial_total` — because "sums to
totalRevenue by construction" is satisfied today by an order that is short.

---

## 1 · Item Group OTC lines — representation, association, and hash exclusion

**Representation.** A frozen OTC line already carries everything the SO needs:

| frozen column | value on an OTC line |
|---|---|
| `line_kind` | `otc` |
| `owning_assembly_id` | the Item Group's assembly id, non-null |
| `quote_leaf_id` | NULL — an OTC charge is not a leaf |
| `display_name` | `Setup`, `Tooling & artwork`, `R&D`, `Other services` |
| `unit_rate` = `line_amount` | quantity is 1; a one-time charge is its own amount |
| `allocation_state` | `separately_billed` (an `allocated` cell is unpriced and must not project) |

**Association.** `owning_assembly_id` is the association. It is persisted, not
re-derived at push time — which matters because the assembly's membership can
be edited on a later revision while this snapshot must keep saying what it said.

**Exclusion from `composition_hash` — and a comment that must change.**

`composition-hash.ts:23-24` currently states:

> members … Every leaf on the assembly participates — physical, OTC, and
> freight lines alike.

I checked whether that is describing current behaviour: it is not, and it is
also not currently false. No OTC member enters the hash today, because OTC is
not a leaf — it is columns on `assembly_production_inputs`, and no OTC SO line
exists at all. The sentence is anticipatory.

**It becomes wrong the moment F1/F4 emits OTC lines, so it must be corrected in
the same slice.** Leaving it would hand the next reader a contract that
contradicts the decision.

Why exclusion is the right rule, beyond it having been decided: the hash
identifies a **composition** — which physical items make up this kit for this
customer. Setup fees vary per tier and per quote. Folding them in would fork the
group identity on every fee change, so the same physical kit would create a new
NetSuite Item Group each time someone re-quoted it, and group reuse — the entire
point of the hash — would collapse.

---

## 2 · Direct Service lines use the same accounting-line model

A `direct_service` frozen line and an `otc` frozen line differ in exactly one
respect, and it is not their shape:

| | `otc` | `direct_service` |
|---|---|---|
| quantity on the SO | 1 | 1 |
| rate | `line_amount` | `line_amount` |
| `owning_assembly_id` | the group | **NULL** — top-level by BV-012 §5.c |
| `service_identity` | NULL | the governed identity |
| how the item resolves | destination map (does not exist yet) | `netsuite_service_item_map[service_identity]` |
| in `composition_hash` | no | no — it has no assembly to belong to |

So "the same accounting-line model" is literally one emit function taking
`(displayName, lineAmount, netsuiteItemId)`, with only the **resolution step**
differing. Both are one-time, quantity-1, non-inventory-shaped charges.

The one asymmetry worth naming: a Direct Service is a line the customer sees as
a product on the pricing table, whereas OTC appears under "Additional charges".
That is a presentation difference in the frozen matrix, already settled, and it
does not change the accounting line.

---

## 3 · Which BV-011 destinations are in V1 projection scope

BV-011 enumerates **16 destinations**. Measured against the live database:

```
netsuite_service_item_map: 1 row
  filling_blending    BLD-FILL    ns=14525
```

| identity / input | destination | governed today |
|---|---|---|
| Filling / Blending | `OTC - Filling` | **yes** — BLD-FILL, ns 14525 |
| R&D / Formulation | `OTC - Formulation` | no |
| CM Assembly / Pack-out | `OTC - Packout` | no |
| Testing / Micros | `OTC - Testing` | no |
| Other Service | `OTC - Other Service` | **by design, never firm-level** — the `0081` CHECK forbids the row; resolved per line |
| Setup · Artwork · Tooling · Bulk Raw · Freight/Duties/Tariffs · Customs · Dies · Print Plates · Samples · Processing Fee · Cartons | various | no destination table exists at all |

**So V1 scope is not a list to choose from — it is whatever is governed when the
slice ships, and today that is one destination.** Scope should be *defined* as
"every destination with a governed mapping at push time", with an explicit
refusal for any frozen line whose destination is unmapped. A hard-coded scope
list would drift from the mapping table the moment an admin adds a row.

The eleven inputs with no destination table are the substantive prerequisite.
Emitting them requires a mapping surface analogous to the one #291–#293 built
for service identities.

---

## 4 · How each frozen line resolves its NetSuite item

Three classes, one recommendation.

| `line_kind` | resolution |
|---|---|
| `item_group_member`, `direct_product` | SKU-match via `resolveItem(display_sku)` — the existing path, unchanged |
| `direct_service` | `netsuite_service_item_map[service_identity]`; `other_service` via per-line selection (not yet built) |
| `otc` | destination map — **does not exist**; this is the gap in §3 |

**Recommendation: resolve at PUSH time and write the result back to
`quote_snapshot_lines.netsuite_item_id`, which already exists and is written
NULL by the freeze.**

The reasoning is that the frozen column and the destination have different
authorities and different correction paths:

- The **amount** is a commercial statement made to the customer. It is frozen at
  send and must never move. #300 proves it does not.
- The **destination** is an accounting classification governed by an admin
  mapping table. An admin can correct a wrong mapping tomorrow. Freezing the
  destination at send would freeze whatever mapping happened to exist that day —
  including a wrong one — and the correction would then have to fight the freeze.

Writing the resolved id back to the frozen row after a successful push is not a
contradiction of the freeze: it records **which destination this line was
actually posted to**, which is history, not a re-statement of price.

`assertNotFrozen` (Pattern 52) governs the commercial columns. `netsuite_item_id`
should be explicitly documented as outside that set, with the reason above, or a
future reader will read the write as a violation.

---

## 5 · How REG-4 proves the SO sums exactly to the frozen accepted total

Today REG-4 rests on a comment: *"by construction"*. That is the same convention
shape #300 removed for the snapshot — and it is currently satisfied by an order
that is short by the OTC.

The proof becomes **two exact links rather than one float comparison**:

```
link A   Σ frozen line_amount (priced cells, accepted tier)  ==  tier_commercial_total
link B   Σ emitted SO line amounts                            ==  Σ frozen line_amount
```

Link A is already guaranteed twice over: the DB CHECK
`qstt_total_is_sum`, and `verifyProjectionTotals` refusing the freeze at send.
#300's Check 4 asserts it on the live record.

Link B is the new obligation. It must be asserted **before** the POST and refuse
on mismatch, not reconciled after.

Two hazards to handle explicitly rather than discover:

- **Rounding.** `line_amount` is `numeric(14,2)`, already rounded. Comparing
  Σ(rounded line amounts) to a rounded total is exact integer-cents arithmetic.
  Comparing a recomputed `rate × qty` to it is not. The assertion must sum the
  **frozen amounts**, never re-derive them.
- **Provisional tiers.** A tier with `total_is_provisional = true` was quoted as
  a floor — the PDF says `from $18,800.00`. **A provisional tier must be refused
  for projection outright.** You cannot post an order for a number the customer
  was told was not final. This is a new refusal with no equivalent today, and it
  is reachable: the certification quote's Tier 3 is exactly this state.

---

## 6 · When the #293 Direct Service projection block is removed

The block exists because the protection it provides used to be accidental. Before
Stage 2 a service quote failed because its Nexus-invented `SVC-*` SKU could not
resolve; supplying a mapping removed the accident, so #293 made the refusal
deliberate (Pattern 56). Removing it early re-creates precisely that situation.

Necessary and jointly sufficient conditions:

1. the four fixed service identities carry governed mappings — **1 of 4 today**;
2. `other_service` per-line selection exists and is frozen with accepted state;
3. OTC destination resolution exists (§3 — eleven inputs have no mapping surface);
4. the REG-4 link-B assertion is in place and refuses on mismatch (§5);
5. provisional tiers are refused (§5).

Removal is the **last** step of the slice, not the first. Until then the gate's
`kind: "projection"` verdict is the correct answer, and its `kind: "mapping"`
verdict continues to route operators to Settings.

---

## What this slice must not do

- No customer-facing pricing change. The frozen matrix is the input; nothing
  about what the customer was quoted moves.
- No re-freeze of already-sent quotes. Pre-#300 snapshots have no matrix and
  must not acquire one — projection for those quotes stays on whatever path they
  have, or is refused.
- No new allocation authoring model (out of scope per the #300 close).

## Settled after review (2026-08-19)

Both questions this trace left open are closed, and the consequences are worked
through in [the mapping-surface plan](f1-f4-mapping-surface-plan.md):

- **OTC destinations are fixed by BV-011, not per-firm.** Admins map each
  governed destination to a NetSuite record; they do not configure what a fee
  means. Scope is every frozen line whose destination has a valid mapping at
  push time — never a hard-coded list.
- **Item Group OTC sits inside the owning group's SO structure**, associated by
  `owning_assembly_id` and excluded from `composition_hash`.

One blocker surfaced while scoping the surface: `tooling_artwork_total` is a
single Nexus input against two governed destinations with **different item
types** (`OTC - Tooling` Inventory, `OTC - Artwork` Non-inventory). It cannot be
resolved by admin configuration, and ten live rows are affected. See the plan
§2.
