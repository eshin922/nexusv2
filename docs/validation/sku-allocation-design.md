# SKU identity, allocation and recovery — design

**Status: PROPOSED. No implementation, no migration, no backfill.**
Author: CC, 2026-09-11. Requires approval before any code or DDL.

## Two corrections to my earlier survey

**The MISTR identifiers are not established as supplier part numbers.** I wrote
that `MISTRLBSTKS-SB-1` and its siblings "look like supplier part numbers"
because their shape differs from `DPS-<BRAND>-<NNNN>`. A different format does
not establish a different purpose — that was an inference presented beside
evidence, which makes it read as evidence. They stay exactly as they are, and
nothing in this design touches them.

**The NetSuite survey was SANDBOX.** The probe reported
`{"environment":"sandbox","accountIsSandbox":true}` against account
`7924416_SB2`, and I should have labelled that in the finding rather than
listing NetSuite beside Nexus and HubSpot as though all three were the same
class of evidence. **Production NetSuite inventory is unsurveyed.** What the
sandbox shows is that the `DPS-` convention is carried into NetSuite item ids
at all (`DPS-NEW-1001`, `DPS-SWW-1011/1012`); it does not establish what the
production account holds, and the production survey is a prerequisite before
counters are seeded.

## What is actually verified

| fact | source |
|---|---|
| `DPS-<BRAND>-<NNNN>`, per-brand counter from 1001 | 254 Nexus SKUs across 53 brands; contiguous ranges (ELE 1001‑1047, ATM 1001‑1028) |
| 227 numeric parts, 49 distinct | per-brand, not global |
| HubSpot carries the same values | 260 matching SKUs, same catalog |
| `hs_sku` has `hasUniqueValue: true` | the property definition, read live — not a code comment |
| bulk material uses the ordinary convention | `DPS-SPJ-1008` = "Smart Pressed Juice - Protein Bulk" |
| NetSuite carries `DPS-` item ids | **sandbox only** |

**What `hasUniqueValue: true` does NOT mean.** HubSpot will REJECT a duplicate
create; it will not return the existing product. Create is therefore **not
idempotent**, and a retry after an uncertain outcome must RECONCILE before
issuing another — never re-POST and interpret an error as a no-op.

## 1 · Uniqueness is on the whole SKU, catalog-wide

The overriding constraint, and it is not the counter's job.

- Uniqueness applies to the **complete normalized SKU**, across the entire
  catalog, for generated AND manually supplied values alike.
- **Normalization:** trim, collapse internal whitespace, upper-case. Both the
  raw and normalized forms are stored; the unique index is on the normalized
  one, so `dps-ele-1001 ` and `DPS-ELE-1001` cannot coexist.
- Brand prefixes and counters are **formatting and allocation mechanisms**.
  They make a value readable and allocable. They are not a substitute for the
  constraint and must never be treated as one.
- **Immutable once assigned. Never recycled**, including after archival — so
  allocations are never released and a counter never goes backwards.

A blank or whitespace-only SKU is not a value; it is the incomplete state, and
is rejected by the same normalization.

## 2 · The governed brand registry

Tokens are **registered, never derived**. Deriving `MISTR` from
"MISTR - 2oz Lube Silicone" is the invention this design exists to avoid: it
would mint a new namespace from a typo.

```
sku_brand_registry
  token                text PK        -- 'ELE', upper-case, immutable
  display_name         text NOT NULL  -- 'Elevate'
  hubspot_company_id   text NULL      -- links a customer, when it is one
  kind                 text NOT NULL  -- 'customer' | 'shared'
  active               boolean NOT NULL DEFAULT true
  created_at / created_by
```

- `kind = 'shared'` is the **approved shared namespace** for library-global
  items that belong to no customer. It is a registered row like any other, not
  a fallback and not a derivation.
- `active = false` retires a token for NEW allocation without invalidating
  anything already issued.

**Selection, never inference:**

- **From a customer quote:** the project's company resolves to a registry row
  and that brand is **preselected** — visible and overridable, not hidden.
- **Direct Library creation:** the operator must explicitly choose a registered
  brand or an approved shared namespace. There is no default, because the
  surface has no customer in context.
- Unregistered customer → creation states that the brand must be registered
  first. That is a governed gap with a clear next step, not a blocked operator
  with no path.

## 3 · Counter and allocation are separate

They answer different questions and fail differently.

```
sku_brand_counters
  brand_token   text PK REFERENCES sku_brand_registry(token)
  next_seq      integer NOT NULL
```

```
sku_allocations
  id                   uuid PK
  attempt_key          text NOT NULL UNIQUE   -- one creation intent
  sku_normalized       text NOT NULL UNIQUE   -- one identity
  sku_raw              text NOT NULL
  brand_token          text NOT NULL
  seq                  integer NOT NULL
  state                text NOT NULL          -- see below
  hubspot_product_id   text NULL
  leaf_id              uuid NULL
  last_error           text NULL
  created_at / updated_at
```

**One counter per brand. One durable allocation per creation intent**, keyed by
BOTH the attempt key and the SKU — two unique constraints, because they exclude
two different failures: a second allocation for the same intent, and a second
intent claiming the same identity.

**Recovery states:**

| state | meaning | next action |
|---|---|---|
| `allocated` | SKU reserved, nothing created | create in HubSpot |
| `create_uncertain` | HubSpot create outcome unknown | **reconcile**, then create only if absent |
| `hubspot_created` | product exists, Nexus row does not | insert the leaf |
| `complete` | leaf and product both exist | none |
| `conflicted` | the SKU resolves to a different product | **blocks**; needs resolution |

## 4 · Seeding, and the collision the counter cannot prevent

**Seed above existing allocated values, from actual catalog identities** — not
from Nexus alone. The seeding migration reads Nexus `leaves`, HubSpot products,
and **production** NetSuite items, takes the per-brand maximum, and sets
`next_seq` above it. That production NetSuite read is the prerequisite noted in
the corrections above.

**The atomic counter protects only Nexus allocations.** Someone creating
`DPS-ELE-1048` by hand in HubSpot, or an import doing so, collides with a value
this counter would later hand out. So allocation is a bounded loop, not a
single increment:

1. take the next value atomically;
2. check the candidate against the catalog identity index;
3. if taken, record the external value, advance, and retry (bounded, and the
   bound being reached is an operator-visible condition, not a silent give-up).

A periodic reconciliation raises counters when externally-created values appear
above them. Detection is not prevention, and the design says so rather than
implying the counter makes collisions impossible.

## 5 · Uncertain create, and what must be proven

**Reconcile before issuing another.** On timeout, network failure or 5xx the
allocation moves to `create_uncertain`. Recovery searches HubSpot by `hs_sku`
for the allocated value:

- **found** → adopt that product id; do not create;
- **authoritatively absent** → create;
- **search failed** → remain uncertain. A failed search is not an absence, and
  creating on it is how the two 4 oz entries happened.

`hasUniqueValue: true` makes a blind retry *fail* rather than duplicate — but
only when the SKU is present. It gives no idempotency, and the earlier
duplicates were created precisely because the retried product had no SKU for
uniqueness to act on.

**Falsifications required before this ships:**

- N concurrent calls, SAME attempt key → exactly one allocation row, one SKU, N
  identical results.
- N concurrent calls, DIFFERENT keys, same brand → N distinct contiguous SKUs,
  no gap and no duplicate.
- An externally-created SKU sitting on the next counter value → allocation
  advances past it rather than colliding.
- Uncertain create then recovery → the existing product is adopted; **no second
  product is created**.
- A search failure during recovery → stays uncertain; no create.

## 6 · Identity is not readiness

A generated SKU establishes an identifier. It does not establish that a
matching NetSuite item exists, and must never mark a leaf NetSuite-ready — item
resolution stays the separate gate it is today.

**The same product carrying its SKU in Nexus, HubSpot and NetSuite is the
expected state. Two distinct products sharing one is a conflict** that blocks
completion and requires resolution — so the readiness check compares
identities, not merely presence of a value.

## Out of scope, unapproved

The 58 existing SKU-less leaves — including services and the seven already
attached to quotes — are assessed separately. No backfill, no reassignment, no
merge, no deletion. Existing SKUs are preserved exactly as they are.
