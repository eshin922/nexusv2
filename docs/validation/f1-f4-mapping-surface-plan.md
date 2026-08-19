# F1/F4 — BV-011 destination mapping surface · bounded implementation plan

Companion to [the projection trace](f1-f4-frozen-column-projection-trace.md),
written against the six decisions closing it. Plan only; no projection code is
opened until the blocker in §2 is dispositioned.

## 1 · What V1 actually reaches — measured, not assumed

The surface is scoped to inputs the population produces. Asking an admin to map
destinations no quote can currently generate is asking them to guess.

**Service identities attached to any quote:**

```
filling_blending    1 quote,  0 non-draft
formulation         2 quotes, 1 non-draft
```

**OTC fee columns carrying a value, across all `assembly_production_inputs`:**

| column | rows with a value | separately billed |
|---|---|---|
| `setup_fee_total` | 17 | **12** |
| `tooling_artwork_total` | 13 | **10** |
| `rd_total` | 16 | **8** |
| `other_service_total` | 11 | **8** |
| `testing_micros_total` | 0 | 0 |

**Filling / Blending (43), CM Assembly (41) and Bulk Raw (12) are excluded on
purpose.** They carry values on many rows, but they are tier-total inputs
amortised into unit cost — `projectCommercial`'s OTC set is exactly the four
one-time fee columns above. Their economics already reach the Sales Order inside
the per-leaf unit rate. Counting them as OTC destinations would double-bill.

## 2 · BLOCKER — one Nexus column, two governed destinations, different item types

`tooling_artwork_total` is a single input. BV-011 §1.b governs two destinations
for it:

| Input | Destination | Item type |
|---|---|---|
| Tooling | `OTC - Tooling` | **Inventory Item** |
| Artwork | `OTC - Artwork` | **Non-inventory Item** |

**This cannot be resolved by admin configuration.** Decision 1 is explicit that
admins configure the NetSuite record, not the accounting meaning — and choosing
whether a given fee is tooling or artwork *is* the meaning. It also cannot be
inferred: the two differ in item type, so a wrong guess misclassifies inventory.

Ten rows in the live population are separately-billed on this column, so it is
not hypothetical.

Three ways out, needing your call:

- **(a) Split the input.** `tooling_total` and `artwork_total` as separate
  columns and separate operator cells. Truest to BV-011; costs a migration, a
  Costs-surface row, and a backfill decision for the 13 existing rows — which
  cannot be split by rule, so they would need an operator pass or a documented
  default.
- **(b) One destination for V1.** Map `tooling_artwork_total → OTC - Tooling`
  (Inventory), document the deviation in BV-011, split later. Cheapest; posts
  artwork fees as inventory until split.
- **(c) Block that fee.** Projection refuses any quote with a separately-billed
  `tooling_artwork_total` until the split lands. Honest, and blocks ten rows'
  worth of real quotes.

I'd take **(a)** if the Costs surface change is acceptable, because (b) writes a
known-wrong item type into accounting records that are hard to correct later,
and (c) blocks real work for a modelling gap. But the cost of (a) is real and
the call is yours.

## 3 · The re-key — and why the current table is the wrong shape

`netsuite_service_item_map` is keyed by `service_identity`. That conflates the
two things decision 1 separates: what a fee *means* (BV-011, fixed in code) and
which NetSuite record it *posts to* (admin-governed).

The measurement shows the conflation biting already: **`rd_total` and the
`formulation` service identity both resolve to `OTC - Formulation`.** Keyed by
identity, that is two rows for one item, free to drift apart. Keyed by
destination, it is one row and cannot.

So: a new `netsuite_destination_item_map` keyed by BV-011 destination, and the
existing table's single row migrates —

```
filling_blending → BLD-FILL / 14525      becomes
OTC - Filling    → BLD-FILL / 14525
```

`netsuite_service_item_map` is then superseded. Per Pattern 22 the DDL is
verified against `schema.ts` before it is written, and per the amended
deployment rule the drop is a **separate, later** migration — the additive
create and backfill land first, deployed code moves onto the new table, and only
then is the old one retired.

## 4 · The V1 destination set — seven, plus one blocked

| destination | item type | reached by |
|---|---|---|
| `OTC - Setup` | Non-inventory | `setup_fee_total` |
| `OTC - Formulation` | Non-inventory | `rd_total` **and** `formulation` service |
| `OTC - Other Service` | Non-inventory | `other_service_total`; `other_service` identity is **per-line**, not firm-level |
| `OTC - Filling` | Inventory | `filling_blending` service |
| `OTC - Packout` | Inventory | `packout_assembly` service |
| `OTC - Testing` | Non-inventory | `testing_micros` service |
| `OTC - Tooling` / `OTC - Artwork` | Inventory / Non-inventory | **BLOCKED — §2** |

`packout_assembly` and `testing_micros` are unattached today but included: a
service can be attached at any moment, the mapping costs one row, and an
unmapped destination blocks a push.

The remaining nine BV-011 destinations are out of V1 scope because no V1 input
reaches them. This is **not** a hard-coded scope list — per decision 6, scope is
"every frozen line whose governed destination has a valid mapping at push time".
The list above is what that rule currently selects, and it grows on its own when
an input is added.

## 5 · Steps

| # | step | notes |
|---|---|---|
| 0 | §0.5 schema verification | every entity below checked against `schema.ts` before DDL |
| 1 | **§2 disposition** | blocking; nothing else starts |
| 2 | `BV011_DESTINATION` constant + input→destination map, in code | fixed by BV-011, deliberately not configurable |
| 3 | migration: `netsuite_destination_item_map` (additive) + backfill the one row | old table dropped in a later migration |
| 4 | Settings surface at `/admin/netsuite` | extends #293's `service-item-map-table.tsx`; same list / save / verify actions, re-keyed to destination. Re-verification rules from #291 carry over — resolution at save plus explicit Verify, and a transient NetSuite failure is **indeterminate**, never stale-or-unmapped |
| 5 | per-line Other Service selection | already dispositioned; frozen with accepted state, no free text, no SKU guessing |
| 6 | one emit path | `quantity = 1`, `rate = amount = ` frozen `line_amount`, **no live recomputation**. Item type comes from the resolved record, not from the emit path — both Inventory and Non-inventory destinations exist |
| 7 | resolve at push, write back `netsuite_item_id` | posting provenance; documented as outside the Pattern 52 freeze set with the reason |
| 8 | REG-4 link A + link B | frozen cents on both sides; never re-derive `rate × qty` |
| 9 | refuse `total_is_provisional = true` | reachable today — the certification quote's Tier 3 |
| 10 | correct `composition-hash.ts:23-24` | same slice, per decision 2 |
| 11 | **remove the #293 block — last** | on the five conditions in the trace §6 |

## 6 · Falsifications the slice must carry

Each written to fail if the property is absent, in the shape #300 used.

- an unmapped destination **blocks the push and names the destination** — not a
  silent skip, which would produce a short order that still reconciled to a
  short sum
- a `total_is_provisional` tier is refused
- Σ emitted line amounts == Σ frozen `line_amount` == `tier_commercial_total`,
  in integer cents, on a quote carrying both OTC and a Direct Service
- an OTC line does **not** alter `composition_hash` — same physical kit, two
  different Setup fees, one group
- emitting changes no commercial column: matrix digest byte-identical across a
  push, the same check #300's Check 5 uses
- a Direct Service line and an Item Group OTC line take the **same** emit path —
  asserted structurally, not by comparing two outputs

## 7 · Out of scope, stated so it cannot drift in

- no customer-facing pricing change of any kind
- no hard-coded V1 destination list in the projection
- no admin control over what a fee *means*
- no re-freeze of pre-#300 sent quotes; they have no matrix and must not acquire
  one
- no new allocation authoring model
