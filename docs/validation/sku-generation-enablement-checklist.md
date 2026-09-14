# Enabling SKU generation in production

The machinery is built and tested in isolation. This is what must happen before
a single identifier can be issued, and what has already been established.

**No seeding, enablement, or record change has been performed.** The schema
migration (0125) is applied and the production NetSuite survey is done — both
read-only or additive, and neither turns anything on. No scope grant, no
property creation, no SKU assignment, no backfill.

---

## Why nothing can fire yet

Generation requires three independent conditions, and production satisfies
none of them:

| condition | production today |
|---|---|
| the brand token is `approved` in `sku_brand_registry` | table does not exist; migration unapplied |
| its counter is seeded in `sku_counters` | same |
| `SKU_GENERATION_ENABLED=1` | unset |

This is deliberate. A flag alone would be one edit away from live; an unseeded
counter cannot issue a number that does not exist. Applying migration 0125 to
production would leave generation exactly as unavailable as it is now.

---

## 1 · Production NetSuite read-only access

**Status: not possible today.** The only configured NetSuite credentials are
sandbox — account `7924416_SB2`, `NETSUITE_ENV=sandbox`, and the client's own
inference agrees.

Needed: a production TBA token pair (consumer key/secret + token id/secret) on
a role with **read** permission on Items, for the account the sandbox derives
from. The account number appears to be `7924416` from the `_SB2` suffix, but
that is an inference from the identifier's shape and should be confirmed rather
than assumed.

This blocks **counter seeding**, because a seed must start above the highest
value in every system that holds one, and NetSuite production is the one system
nobody has looked at.

---

## 2 · HubSpot property and ownership controls — NOT a prerequisite

**This section is not on the enablement path.** The implementation makes no
reference to `nexus_allocation_id`: it records `hubspot_product_id`, which
comes back in the create response and needs no new property and no new scope.
So creating the property, and the scope grant it would require, are NOT
required to enable the button.

An earlier version of this document listed them as prerequisite 2. That was
carried over from the design document rather than derived from what was built,
and it would have blocked the feature on something the feature does not use.

What the property is actually for is AUTOMATIC ADOPTION, which is unavailable
regardless — see below. Nothing in the enablement sequence depends on it, and
dropping it from that sequence does not make adoption any more available than
it already was.

The findings below stand; they are recorded because they settle what is
possible, not because anything waits on them.

### The capability was tested, and the answer changes the design

Four custom product properties in production carry `readOnlyValue: true` and
were all app-created. That establishes the capability exists in the portal. It
does **not** establish that our app has it — those belong to other
integrations.

So it was tested, in the **dev portal `46710404`**, by creating a property,
reading back what HubSpot actually stored, and archiving it
(`npm run probe:hubspot-property-capability`):

```
readOnlyValue    requested true  ->  stored FALSE   (ignored)
hasUniqueValue   requested true  ->  stored true    (honoured)
```

**Our app cannot declare a property integration-controlled.** The assumption
that it could was wrong, and it was wrong in the direction that matters:
`nexus_allocation_id` would be editable by anyone with product permissions in
the HubSpot UI.

**Automatic adoption therefore remains unavailable, and the agreed design is
not relaxed by this.** `hasUniqueValue` was honoured, but it answers a
different question: it prevents two products holding the SAME token value. It
establishes nothing about who wrote that value or whether it is still the one
Nexus allocated. A value a person can edit cannot serve as proof of ownership,
so a search that finds a product by allocation id does not establish that this
is the product our allocation created — which is exactly what adoption has to
establish before claiming an uncertain create.

Under the agreed design an uncertain outcome that cannot be adopted ends
`conflicted`, for a human. That stands. Prerequisite 1 in the design document
— the property, created AND integration-controlled — is **not** satisfied by
uniqueness alone and is not marked satisfied here.

An earlier version of this document said adoption "works by searching for the
allocation id, which a unique property supports". That was wrong and it relaxed
a rule it had no authority to relax; it is corrected rather than quietly
edited, because the distinction between "no duplicates" and "we own this" is
the whole of it.

If automatic adoption is ever wanted, this is what would have to be decided
first: whether to accept an advisory-only allocation id, or to establish
ownership another way — a HubSpot-side permission or workflow restriction, or a
different mechanism entirely. That decision is not scheduled and nothing waits
on it; uncertain creates end held for a human either way.

### Permissions

| token | portal | can create a product property |
|---|---|---|
| `HUBSPOT_ACCESS_TOKEN` | 21497798 (prod) | **no** |
| `HUBSPOT_WRITE_ACCESS_TOKEN` | 21497798 (prod) | **no** |
| `HUBSPOT_DEV_ACCESS_TOKEN` | 46710404 (dev) | yes, via `e-commerce` |

Production needs `crm.schemas.products.write` (or `e-commerce`) granted on the
private app. *Correction to an earlier report: I said the dev token also lacked
this. It does not — it holds `e-commerce`, which my scope filter did not match.
The production finding stands.*

### The property, when approved

| field | value |
|---|---|
| object | `products` |
| name | `nexus_allocation_id` |
| type / fieldType | `string` / `text` |
| group | `productinformation` |
| `hasUniqueValue` | `true` — honoured. Prevents duplicate values; does NOT establish ownership |
| `readOnlyValue` | request it, but expect `false`. Adoption must not be designed as though it held |

---

## 3 · Registry entries and counter seeds, for approval

Proposed from the HubSpot product-library **folder** each product sits in — a
structural record an operator filed it under, never the spelling of the token.
Approval is per-entry and separate from this implementation.

### 3a · Proposed entries with a single folder and a numeric series

These are the ones where both halves of the evidence agree, so both a registry
entry and a counter seed can be proposed together. The seed is the highest
number seen **+ 1**.

| token | customer (folder) | highest seen | proposed seed |
|---|---|---|---|
| `SPJ` | Smart Pressed Juice | 1015 | **1016** |
| `SWW` | SWW | 1013 | **1014** |
| `TUBE` | Bryght | 1021 | **1022** |
| `LEM` | Lemme | 1012 | **1013** |
| `LMER` | La Mer | 1005 | **1006** |
| `DRSQ` | Dr. Squatch | 1004 | **1005** |
| `LOOV` | LOOV | 1004 | **1005** |
| `VOL` | Volta | 1004 | **1005** |
| `NEC` | Necessaire | 1003 | **1004** |
| `REJ` | Rejuvica | 1003 | **1004** |
| `EL` | Extract Labs | 1002 | **1003** |
| `KUJU` | Kuju | 1002 | **1003** |
| `YUNI` | YUNI Beauty | 1002 | **1003** |
| `DPS` | DPS | 1001 | **1002** |
| `ES` | Cosmetic Primary | 1001 | **1002** |
| `FACE` | Facetory | 1001 | **1002** |
| `FRE` | Freck Beauty | 1001 | **1002** |
| `HURR` | Hurr | 1001 | **1002** |
| `KIT` | Kitsch | 1001 | **1002** |
| `MOT` | Motivated | 1001 | **1002** |
| `MYTH` | Mythologie | 1001 | **1002** |
| `NEW` | New U Life | 1001 | **1002** |
| `OUT` | The Outset | 1001 | **1002** |
| `PCW` | Perfect Coffee Water | 1001 | **1002** |
| `RMS` | RMS | 1001 | **1002** |
| `SAS` | Stronger and Stronger | 1001 | **1002** |
| `WL` | White Label | 1001 | **1002** |

**These seeds are PROVISIONAL.** They are computed from Nexus and HubSpot only.
NetSuite production is unsurveyed, so a higher number may exist there, and
seeding below it would mint a colliding identifier. Item 1 must close first.

Several of these are visibly not customer brands — `ES` files under "Cosmetic
Primary", `WL` under "White Label", `DPS` under "DPS". They are listed because
that is what the folder evidence says; whether a non-customer namespace should
be registered at all is part of the adjudication, not something to silently
drop.

Eleven further tokens have single-folder evidence but **no numeric series**
(four-segment shapes like `DPS-ELE-CAP-1`), so they can be registered without a
seed and would remain unallocatable until one is agreed.

### 3b · Ambiguous — needs a decision, not a default

| token | products | folders |
|---|---|---|
| `ELE` | 52 | Elevate Manufacturing (47) · Elevate (5) |
| `JAR` | 7 | Kitsch (5) · Elevate (1) |

`ELE` is plausibly one customer under two folders, but merging them is a
judgement about who the customer is, which is yours.

### 3c · Unfiled — 25 tokens, 108 products

No folder on any product, so the folder evidence cannot classify them: `ATM`
28, `CFM` 18, `PE` 12, `KIALA` 10, `PEL` 10, `JOYMODE` 5, `SFUEL` 4, and
eighteen smaller, including `BOTTLE`, `TISSUE`, `FILL`, `UC`, `UPCHARGE` and
one malformed `DPS- CFM-Fl10` carrying an embedded space. Classifying these
means either filing the products in HubSpot or adjudicating them directly.

These do not block anything. An unregistered token simply cannot allocate.

### 3d · MISTR — proposed future namespace

Registering `MISTR` collides with nothing: **zero** `DPS-MISTR-*` identifiers
exist in either system. Its 21 existing products carry six inconsistent shapes
(`MISTR-1001`, `MISTR-SKU1`, `MISTR.1003`, `MISTRLBSTKS-SB-1`,
`MISTR-Sample-N`, and some with none), all **unfiled** in HubSpot — so unlike
the entries above, the evidence here is not a folder.

Registering it governs **future** allocation only. The 21 existing identifiers
stay exactly as they are.

**Tied to the customer record — and there are two.** The deals cache holds:

| company id | name | deals |
|---|---|---|
| `36909687931` | heymistr.com | 3 |
| `48843403658` | MISTR | 2 |

Proposed: **`36909687931` (heymistr.com)**, because both Nexus projects
resolve to it. The existence of a second record is itself worth knowing — if
they are one customer in HubSpot twice, preselection will work for whichever
is registered and silently not for the other.

Proposed entry:

| field | value |
|---|---|
| token | `MISTR` |
| customer_label | heymistr.com |
| hubspot_company_id | `36909687931` |
| status | `proposed` — cannot allocate until approved |
| counter | none. Seeding needs item 1 |

---

## Order of operations

1. ~~**Production inventory**~~ — DONE (§1, 2026-09-14). The seeds in §3a are
   three-way reconciled and final.
   **Registry adjudication remains**: which tokens are approved (§3a), the two
   ambiguous mappings (§3b), and whether MISTR is registered (§3d). Nothing can
   be issued without an approved token.
2. ~~**Approved schema migration**~~ — DONE. 0125 applied 2026-09-14; the tables
   were created empty, which turns nothing on.
3. **Approved seeding**, as a separately authorised operation, above every
   system.
4. **Enable the flag** — `SKU_GENERATION_ENABLED=1`.

Any one of them missing leaves generation refusing, which is the correct
behaviour rather than a failure.

The HubSpot property is deliberately absent from this sequence: the
implementation does not use it (§2).
