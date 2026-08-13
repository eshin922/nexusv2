# Product Type source fidelity — reconciliation record

**Status:** implementation complete and verified; **reconciliation to the live
HubSpot inventory is NOT yet done, and cannot be done from a dev runtime.**
**Date:** 2026-08-13
**Follows:** `product-type-integrity-investigation.md`

---

## 1 · What was built

`leaves.hubspot_product_type` (migration `0070`, additive/nullable) carries
HubSpot's **raw internal option value**. The Library filter predicates on it;
`productTypeId` is untouched and remains operator-authored via the TypePicker.
New Product → Add to HubSpot offers the fetched vocabulary, validates membership
before the provider call, and submits values rather than labels.

`npx tsc --noEmit` clean · `npm run test:unit` **1166/1166** · 16 new cases in
`tests/unit/hubspot-product-type-fidelity.test.ts`.

## 2 · The finding that changed the implementation

**The Products domain is dev/prod-aware and the two portals' `hs_product_type`
vocabularies are not the same.** This was discovered by running the governed
pull, not predicted.

| | `getReadClient()` | `getProductsClient()` in dev |
|---|---|---|
| token | `HUBSPOT_ACCESS_TOKEN` | `HUBSPOT_DEV_ACCESS_TOKEN` |
| portal | **production** | **sandbox** |
| products | **1,037** | **24** |
| visible options | 15 | 15 |

Same option count, different membership:

| | production only | sandbox only |
|---|---|---|
| values | `Finished Goods`, `Turnkey` | `Corrugated`, `Preliminary` |

The label/value divergence also differs by portal. Both diverge on
`Primary Packaging`→`Primary` and `Secondary Packaging`→`Secondary`. Production
additionally diverges on `Logistics`→`Third Party Logistics`; the sandbox stores
that option with label and value identical.

**Why this was a defect, not a curiosity.** The vocabulary loader initially used
`getReadClient()` — production — while `createProduct` and `listProducts` use
`getProductsClient()`. In dev that combination would have:

- offered `Turnkey` and `Finished Goods` chips matching nothing;
- left sandbox values `Corrugated` and `Preliminary` with no chip at all;
- and, worst, **validated a create against production's option set and then
  written it to the sandbox**, where the accepted value is not a legal option.

Fixed: the vocabulary is now read through `getProductsClient()`, so the option
set, the product listing, and the create all resolve to one portal. Pinned by
`"the vocabulary is read from the SAME portal that holds the products"`.

## 3 · Current database state — dev pull only

The governed pull was run locally to populate the column. Because dev resolves
to the sandbox, it processed **24 products, not 1,037**:

```
batch 1: processed=24 added=0 updated=24   (no next page)
```

Resulting `leaves` state (shared dev/prod database):

| | count |
|---|---|
| all leaves | 1,077 |
| with `hubspot_product_id` | 1,061 |
| **with `hubspot_product_type`** | **7** |
| with `product_type_id` (Nexus taxonomy) | 26 |

By source type: `Preliminary` 6 · `Labels` 1 · null 1,054.

**These seven values are sandbox classifications written to the shared
database.** That is pre-existing pull behaviour, not new to this change — the
dev/prod-aware Products client has always meant a dev pull writes sandbox data
— and it is the condition recorded under Pattern 32 (pre-production tolerance).
It is called out here because `Preliminary` is not a production option, so those
six rows will show no chip in a production Library until a production pull
overwrites them.

## 4 · Reconciliation — what remains, and where it must happen

The reconciliation the disposition asks for (1,037 products / 1,032 typed /
5 null / 16 distinct raw values) can only be produced where
`getProductsClient()` resolves to production, i.e. `NODE_ENV=production` — a
Vercel deployment. It cannot be produced from a local dev runtime, which is a
property of the token routing and not something to work around by borrowing the
read client: doing so would reintroduce exactly the portal mismatch in §2.

**The remaining step is therefore the operator path itself** — Refresh from
HubSpot in the Library modal on a Preview deployment — which populates the
column from production and simultaneously exercises the governed affordance.

Expected on completion, to be checked rather than assumed:

- `count(hubspot_product_type)` ≈ **1,032** of 1,061 HubSpot-linked leaves;
- distinct values **15**, all members of the production option set;
- `Secondary` ≈ 346 · `Primary` ≈ 171 · `Third Party Logistics` = 4;
- **zero** rows carrying a label (`Primary Packaging`, `Secondary Packaging`,
  `Logistics`) — a single one would mean a label reached the value column;
- `product_type_id` count still **26**, proving the Nexus taxonomy was not
  written.

Controls to trace by HubSpot id, chosen from the divergent options because they
prove internal-value handling rather than label matching:

| HubSpot id | sku | expected `hubspot_product_type` |
|---|---|---|
| `2008191375` | PP-0001 | `Primary` |
| `1833843360` | 22LP-01-SC00 | `Secondary` |
| `2008191385` | 3PL-0001 | `Third Party Logistics` |

## 5 · Round trip — still to prove

One create → HubSpot → pull → filter round trip, per the added requirement,
using a divergent option so the label/value handling is exercised end to end:
create a product with **`Primary` (label "Primary Packaging")**, confirm HubSpot
stores the value, pull it back, and confirm it appears under the Primary chip in
the Library.

## 6 · Access boundary

The portal comparison in §2 came from reading each client's own property
definition and first product page. No token, account id, or URL was printed or
recorded.
