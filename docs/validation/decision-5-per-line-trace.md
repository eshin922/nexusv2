# Decision 5 — per-line selection · mechanism trace

Written 2026-08-19, **before implementation**, per the Decision 5 gate: *"trace
the smallest shared mechanism so we do not grow five separate selectors."*

No code written. The trace found something that changes the scope, so it is
reported rather than built around.

---

## Headline

**Four of the five named destinations cannot produce a quote line at all today.**

| destination | reachable in a quote today? | by what path |
|---|---|---|
| **Testing** | **yes** | Direct Service, identity `testing_micros` |
| Dies | **no** | — |
| Samples | **no** | — |
| Cartons | **no** | — |
| Print Plates | **no** | — |

Building per-line selectors for the bottom four would build a selector for a
line that can never exist. That is the outcome the trace instruction was for.

---

## How a line acquires a destination — the only two paths

Verified against three registries, all of which are closed sets in code.

**Path 1 — an OTC fee column.** A separately billed one-time charge exists only
if its column appears in **both** `OTC_FEES` (`commercial-projection.ts:173`),
which emits the customer line, and `OTC_COLUMN_DESTINATION`
(`bv011-destinations.ts:98`), which gives it an accounting destination:

| column | destination |
|---|---|
| `setupFeeTotal` | `otc_setup` |
| `toolingTotal` | `otc_tooling` |
| `artworkTotal` | `otc_artwork` |
| `rdTotal` | `otc_formulation` |
| `otherServiceTotal` | `otc_other_service` |
| `toolingArtworkTotal` | *none* — legacy, blocks by design |

**Path 2 — a Direct Service identity** (`SERVICE_IDENTITY_DESTINATION`):

| identity | destination |
|---|---|
| `formulation` | `otc_formulation` |
| `filling_blending` | `otc_filling` |
| `packout_assembly` | `otc_packout` |
| **`testing_micros`** | **`otc_testing`** |
| `other_service` | `otc_other_service` |

**Neither path reaches Dies, Samples, Cartons or Print Plates.** Those four
exist in the BV-011 destination enum and appear as rows on the Settings page —
which is why they looked mappable — but nothing in a quote can emit a line
carrying them.

### The near-miss worth naming

`assembly_production_inputs` **does** carry a `testing_micros_total` column. It
is not in `OTC_FEES`, so it produces no separately billed customer line; it is
allocated into unit cost like any non-separately-billed fee. Testing is
reachable through the Direct Service path instead.

So Testing has *two* possible readings, and they are not the same change:

- **as a Direct Service** — reachable today, and the smallest mechanism covers it
- **as a separately billed OTC fee** — would require adding `testingMicrosTotal`
  to `OTC_FEES` and `OTC_COLUMN_DESTINATION`, which is a commercial change (a
  charge that is currently absorbed into unit cost would start appearing as its
  own customer line), not a selection change

The second is emphatically not what "operator chooses per line" asked for, and
should not be smuggled in under it.

---

## The smallest shared mechanism, for what is reachable

For **Testing as a Direct Service**, the existing pattern extends with **no
schema change and no new selector**:

| clause of the disposition | already generic? | change needed |
|---|---|---|
| operator selects while draft | selector currently renders only for `other_service` | widen the render condition |
| frozen at SEND | yes — `quote_snapshot_lines.selected_netsuite_item_id` | none |
| required readiness | yes — keyed on `isPerLineDestination` | none |
| immutable after SEND | yes — frozen row is read, never the live one | none |
| posted provenance separate | yes — `netsuite_item_id` is a distinct column | none |

Three of the six clauses need nothing. The mechanism is already destination-
driven; what makes it Other-Service-only is a single predicate:

```ts
export function isPerLineDestination(key: Bv011Destination): boolean {
  return key === "otc_other_service";          // ← the whole switch
}
```

So the shared mechanism is: **turn that predicate into a set**, and follow the
two places that still hardcode `other_service` rather than asking it —
`commercial-projection.ts`'s `selectedNetsuiteItem` population, and the Costs
selector's render condition. That is the entire extension.

---

## The tripwire that decides whether a migration is needed

`quote_other_service_items` is keyed by owner — `(quote_id, assembly_id XOR
quote_leaf_id)` — with **no destination discriminator**. That is sound today
because per-line is a single destination, so each owner has at most one
selection.

**It stops being sound the moment two per-line destinations can attach to the
same owner.** An assembly with both an Other Service charge and a per-line
Testing charge would need two rows and the key admits one.

- **Testing via Direct Service:** safe. A leaf has exactly one service identity,
  therefore exactly one destination. No migration.
- **Any per-line destination added as an OTC fee column:** unsafe. Needs a
  `destination` column plus a unique key on `(quote_id, owner, destination)`,
  and a backfill of existing rows to `otc_other_service`.

Stated here so the decision is made deliberately rather than discovered by a
constraint violation on a real quote.

---

## What this needs from Accounting

Dies, Samples, Cartons and Print Plates cannot be selected per line because they
cannot be charged at all. The prior question is whether they should be:

1. **Are these charges DPS bills separately today?** The NetSuite history says
   they are used — `OTC-0004` Printing Plates alone carries 73 lines. So they
   are billed *in NetSuite*; the question is whether they are billed *from a
   Nexus quote* or added to the order by hand afterwards.
2. **If they should come from Nexus**, each needs a cost input and a commercial
   line before any selection question arises. That is a Costs-surface change
   with customer-visible consequences, and it is a different slice from this one.
3. **If they are added downstream by Accounting**, then no Nexus work is needed
   and the four rows should be marked as such on the Settings page rather than
   sitting there looking mappable.

**Recommendation:** implement the extension for Testing-as-Direct-Service now —
it is small, needs no migration, and satisfies the disposition for the one
destination that can exercise it. Hold the other four pending the answer above.

---

## What was not done

No code. No schema. No selector. The extension is ready to write the moment the
scope question above is settled, and the tripwire is recorded either way.
