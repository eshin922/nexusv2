# Enabling SKU generation in production

The machinery is built and tested in isolation. This is what must happen before
a single identifier can be issued, and what has already been established.

**GENERATION IS LIVE as of 2026-09-14.** All four conditions are satisfied: the
migration is applied, 19 brand tokens are approved, their counters are seeded
from a three-way reconciliation, and `SKU_GENERATION_ENABLED=1` is set for
Production. Section 4 is the record of the last two.

Still not done, and still deliberate: no scope grant, no HubSpot property
creation, no SKU assignment to any existing product, no backfill.

---

## What has to be true before anything can fire

Generation requires three independent conditions. **All three are now
satisfied** — this section is kept because the shape of the gate is the point,
not because anything is still missing:

| condition | production today |
|---|---|
| the brand token is `approved` in `sku_brand_registry` | 19 tokens approved (section 4) |
| its counter is seeded in `sku_counters` | 19 counters seeded (section 4) |
| `SKU_GENERATION_ENABLED=1` | set, Production only |

A token outside those 19 still cannot issue anything, and neither can one whose
counter is unseeded. Enabling the flag did not open the namespace; it opened
exactly the nineteen that were adjudicated.

This is deliberate. A flag alone would be one edit away from live; an unseeded
counter cannot issue a number that does not exist. Applying migration 0125 to
production would leave generation exactly as unavailable as it is now.

---

## 1 · Production NetSuite — SURVEYED 2026-09-14

**Done.** Account **`7924416`** (The DPS, Inc.), confirmed from the UI: no
`-sb` suffix, no sandbox banner. This also settles what was previously an
inference — `7924416` is indeed the production account behind `7924416_SB2`.

Surveyed read-only through an authenticated browser session. Nothing was
configured and no record was touched. The API credentials in `.env.local`
remain sandbox and were not altered.

| item type | items | `DPS-` items | inactive `DPS-` |
|---|---|---|---|
| InvtPart | 1,092 | **276** | 0 |
| NonInvtPart | 232 | **23** | 0 |
| Group | 36 | 0 | — |
| OthCharge | 18 | 0 | — |
| Service | 14 | 0 | — |
| Assembly | 9 | 0 | — |
| Kit | 0 | — | — |
| **total** | **1,401** | **299** | **0** |

**Inactive items were included** — "Show Inactives" was on throughout, and it
demonstrably changes results (one type went 228 → 232). No `DPS-` item is
inactive, so no seed depends on one.

**All item types were enumerated individually** rather than trusting an
unfiltered view. That mattered: the default Items list carried a remembered
`Item_TYPE=NonInvtPart` filter and reported "TOTAL: 232", which is one type,
not the catalog. The real figure is 1,401. A saved filter reporting a
plausible smaller number is exactly how a survey produces a confident wrong
answer.

Coverage within InvtPart is provable from the page boundaries, which are
contiguous and bracket the whole `DPS-` block:
`001…BA126800` · `BA146400…DPS-ATM-1017` · `DPS-ATM-1018…DPS-REJ-1003` ·
`DPS-RMS-1001…LMH38-CLIP`.

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

## 3 · Registry entries and counter seeds — 19 APPROVED 2026-09-14

Proposed from the HubSpot product-library **folder** each product sits in — a
structural record an operator filed it under, never the spelling of the token.
Approval was per-entry and separate from this implementation.

**19 of these were approved and seeded on 2026-09-14 — see section 4 for what
was written.** The numbers below are the snapshot the adjudication was made
against; the numbers actually seeded were re-measured at write time and are
recorded in section 4. Everything in 3b and 3c remains unadjudicated and cannot
issue anything.

### 3a · Reconciled entries and final seeds

Three-way: Nexus and HubSpot read live, NetSuite from the production survey
above. **Seed = max(Nexus, HubSpot, NetSuite) + 1.**

Customer comes from the HubSpot product-library folder each product is filed
in — a structural record an operator assigned, never the spelling of the token.

| token | customer | Nexus | HubSpot | NetSuite | **seed** |
|---|---|---|---|---|---|
| `SPJ` | Smart Pressed Juice | 1015 | 1015 | 1015 | **1016** |
| `SWW` | SWW | 1013 | 1013 | 1013 | **1014** |
| `TUBE` | Bryght | 1021 | 1021 | 1021 | **1022** |
| `LEM` | Lemme | 1012 | 1012 | 1012 | **1013** |
| `LMER` | La Mer | 1005 | 1005 | 1005 | **1006** |
| `DRSQ` | Dr. Squatch | 1004 | 1004 | 1004 | **1005** |
| `LOOV` | LOOV | 1004 | 1004 | 1004 | **1005** |
| `VOL` | Volta | 1004 | 1004 | 1004 | **1005** |
| `NEC` | Necessaire | 1003 | 1003 | 1003 | **1004** |
| `REJ` | Rejuvica | 1003 | 1003 | 1003 | **1004** |
| `EL` | Extract Labs | 1002 | 1002 | 1002 | **1003** |
| `KUJU` | Kuju | 1002 | 1002 | 1002 | **1003** |
| `YUNI` | YUNI Beauty | 1002 | 1002 | 1002 | **1003** |
| `DPS` | DPS | 1001 | 1001 | 1001 | **1002** |
| `ES` | Cosmetic Primary | 1001 | 1001 | 1001 | **1002** |
| `FACE` | Facetory | 1001 | 1001 | 1001 | **1002** |
| `FRE` | Freck Beauty | 1001 | 1001 | 1001 | **1002** |
| `HURR` | Hurr | 1001 | 1001 | 1001 | **1002** |
| `KIT` | Kitsch | 1001 | 1001 | 1001 | **1002** |
| `MOT` | Motivated | 1001 | 1001 | 1001 | **1002** |
| `MYTH` | Mythologie | 1001 | 1001 | 1001 | **1002** |
| `NEW` | New U Life | 1001 | 1001 | 1001 | **1002** |
| `OUT` | The Outset | 1001 | 1001 | 1001 | **1002** |
| `PCW` | Perfect Coffee Water | 1001 | 1001 | 1001 | **1002** |
| `RMS` | RMS | 1001 | 1001 | 1001 | **1002** |
| `SAS` | Stronger and Stronger | 1001 | 1001 | 1001 | **1002** |
| `WL` | White Label | 1001 | 1001 | 1001 | **1002** |

### Every number here is a DATED SNAPSHOT

**Measured 2026-09-14. Re-check immediately before seeding.**

These maxima are not durable facts. All three systems accept new items
continuously: someone can create a product in HubSpot, an item in NetSuite, or
a leaf in Nexus at any moment, and any one of those can raise a token's
maximum above what is written here. A seed computed from a stale snapshot is
exactly the error the survey existed to prevent — it would sit below an
identifier that was created in the interval.

So seeding is a two-step operation, not a transcription:

1. Re-run the three-way reconciliation against all three systems.
2. Seed from THAT result, and compare it against this table. Any token whose
   maximum has moved is a signal worth reading, not a number to paste over —
   it means that namespace is actively in use.

The same applies to the unfiled tokens in §3c. An earlier version of this
document said adjudicating one later "needs no further survey". That was
wrong: what it needs is no further ACCESS. The survey itself must be re-run.

**27 tokens. All three systems agree on every one**, so for these the NetSuite
survey confirmed the earlier provisional seeds rather than changing them. That
is a result, not a formality: it was unknown until measured, and the one token
below shows it could have gone the other way.

Three of these are visibly not customer brands — `ES` files under "Cosmetic
Primary", `WL` under "White Label", `DPS` under "DPS". They are listed because
that is what the folder evidence says. Whether a non-customer namespace should
be registered at all is part of the adjudication, not something to drop
silently.

### 3b · Ambiguous — needs a decision, not a default

| token | products | folders |
|---|---|---|
| `ELE` | 52 | Elevate Manufacturing (47) · Elevate (5) |
| `JAR` | 7 | Kitsch (5) · Elevate (1) |

`ELE` is plausibly one customer under two folders, but merging them is a
judgement about who the customer is, which is yours.

### 3c · Unfiled — 25 tokens, no folder evidence

No folder on any product, so folders cannot say whose they are. They block
nothing: an unregistered token simply cannot allocate. Seeds are computed
anyway so that adjudicating one later starts from a figure rather than a
blank — but see the freshness rule below: any of these still needs a re-check
before it is seeded.

| token | Nexus | HubSpot | NetSuite | seed |
|---|---|---|---|---|
| `PPS` | 1248 | 1248 | 1248 | 1249 |
| `ATM` | 1028 | 1028 | 1028 | 1029 |
| `PE` | 1012 | 1012 | 1012 | 1013 |
| `KIALA` | 1010 | 1010 | 1010 | 1011 |
| `PEL` | 1010 | 1010 | 1010 | 1011 |
| `JOYMODE` | 1005 | 1005 | 1005 | 1006 |
| `CFM` | 1005 | 1005 | 1005 | 1006 |
| `SFUEL` | 1004 | 1004 | 1004 | 1005 |
| `JOOP` | 1003 | 1003 | 1003 | 1004 |
| `PV` | 1003 | 1003 | 1003 | 1004 |
| **`NES`** | **—** | **—** | **1002** | **1003** |
| `FAN` | 1002 | 1002 | 1002 | 1003 |
| `HG` | 1002 | 1002 | 1002 | 1003 |
| `OS` | 1002 | 1002 | 1002 | 1003 |
| `PP` | 1002 | 1002 | 1002 | 1003 |
| `VER` | 1002 | 1002 | 1002 | 1003 |
| `ALI` | 1001 | 1001 | 1001 | 1002 |
| `EJ` | 1001 | 1001 | 1001 | 1002 |
| `SUP` | 1001 | 1001 | 1001 | 1002 |
| `WYN` | 1001 | 1001 | 1001 | 1002 |
| `BOTTLE` | 1 | 1 | 1 | 2 |
| `FILL` | 1 | 1 | 1 | 2 |
| `TISSUE` | 1 | 1 | 1 | 2 |
| `UC` | 1 | 1 | 1 | 2 |
| `UPCHARGE` | 1 | 1 | 1 | 2 |

**`NES` is the finding that justified the survey.** It exists in production
NetSuite at 1002 and in NEITHER Nexus nor HubSpot. It is the only token of 54
where NetSuite raises the seed — every other one agrees across all three.

Had `NES` been registered on Nexus + HubSpot evidence alone, its counter would
have seeded at 1001: one below an item that already exists. The survey was not
a formality, and the same shape could exist for a token nobody has proposed
yet.

### 3d · MISTR — APPROVED and seeded 2026-09-14

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
| status | `approved` 2026-09-14 |
| counter | **1001** — nothing in any of the three systems, so the 1001 floor applies |

---

## 4 · Seeding and enablement — DONE 2026-09-14

### the maxima were re-measured, not transcribed

Section 3a was already a dated snapshot, and the rule banked with it says a seed
must come from a fresh reading rather than from that table. So all three systems
were re-read in the hour the counters were written:

| system | population | how |
|---|---|---|
| Nexus | 1,052 leaf SKUs | read by the seeding script, in the run that wrote |
| HubSpot | 1,079 products, 11 pages, paging exhausted | same run |
| production NetSuite, account 7924416 | 1,403 items, 8 pages, inactives included, all types | authenticated browser session, read-only |

The NetSuite figure moved (1,401 to 1,403) and **no registered token's maximum
moved with it**. All 54 tokens matched the recorded snapshot exactly. That is a
result rather than a formality: it was unknown until measured, and the whole
reason for re-measuring is that it could have been otherwise.

Coverage is provable rather than asserted. The eight page boundaries are
contiguous end-to-start, and the `DPS-` block sits wholly inside pages 3 and 4
with non-DPS names on both sides, so no `DPS-` item can fall outside what was
read.

Two traps were caught during the survey, both worth recording because each
returns a plausible number rather than an error:

- the Items list opened with a remembered **Kit/Package** filter and reported
  `TOTAL: 0`, which reads as "there are none" rather than "you filtered them
  out" — the same shape as the `NonInvtPart` filter that produced a confident
  wrong total on the first survey.
- `&size=1500` was silently ignored; the page kept its own `size=200`. Only
  comparing row count against `TOTAL` distinguishes "one page held everything"
  from "one page is all you were given".

### what was written

Through `npm run admin:sku-registry`, the governed path: registration and
seeding are separate phases, the NetSuite survey arrives as a file that must
name its account and declare its own coverage, and it is refused past a
freshness limit. Each refusal was exercised rather than assumed — stale, sandbox
account, `complete: false`, and no file at all each exit non-zero.

19 registry rows, status `approved`, approver and timestamp recorded, and 19
counters, written in one transaction:

| token | customer | company id | counter |
|---|---|---|---|
| `SPJ` | Smart Pressed Juice | 17493436983 | **1016** |
| `TUBE` | Bryght | 15122910741 | **1022** |
| `LEM` | Lemme | 11075059228 | **1013** |
| `LMER` | La Mer | 17952713000 | **1006** |
| `DRSQ` | Dr. Squatch | 10427807265 | **1005** |
| `LOOV` | LOOV | 18603946796 | **1005** |
| `VOL` | Volta | 18363861820 | **1005** |
| `REJ` | Rejuvica | 15931327282 | **1004** |
| `EL` | Extract Labs | 19122235830 | **1003** |
| `KUJU` | Kuju | 18233927554 | **1003** |
| `YUNI` | YUNI Beauty | 10427868808 | **1003** |
| `FACE` | Facetory | 15340903790 | **1002** |
| `KIT` | Kitsch | 15532964962 | **1002** |
| `MOT` | Motivated | 17078076774 | **1002** |
| `MYTH` | Mythologie | 10427985012 | **1002** |
| `NEW` | New U Life | 18680822828 | **1002** |
| `OUT` | The Outset | 15341254760 | **1002** |
| `PCW` | Perfect Coffee Water | 19507987774 | **1002** |
| `MISTR` | heymistr.com | 36909687931 | **1001** |

`DPS`, `ES`, `WL` and every other token are deliberately UNREGISTERED and cannot
issue anything.

MISTR maps to `36909687931` (heymistr.com). The second company record,
`48843403658`, is recorded in that row's evidence as deliberately NOT merged or
aliased — which record is the customer remains unadjudicated, and picking one
quietly would have settled it.

### the seeding rule gained a floor, and the dry run is why

`max(nexus, hubspot, netsuite) + 1` is right only for a namespace that already
has items. MISTR has none in any of the three, so the rule yielded **1**, and
`DPS-MISTR-0001` is not what the convention produces — every customer namespace
in the catalog begins at 1001.

Fixed as a FLOOR rather than as a special case for the empty namespace, because
a floor can only ever RAISE a seed and therefore cannot mint a collision. The
other eighteen are unchanged by it. Each counter's `seed_basis` records the rule
it was computed under, both measurement timestamps, the account, and the
population sizes, so the number can be re-derived rather than trusted.

### enablement

`SKU_GENERATION_ENABLED=1`, added as a **Config** variable rather than a Secret
— it is a feature flag and the value should stay readable — scoped to
**Production** only. Current `main` was redeployed to activate it.

Verified on the deployed surface by inspection only. No SKU was generated and no
product was created or edited, because generating one writes a real reservation
row:

| check | result |
|---|---|
| Create new product | Auto-generate SKU present and enabled |
| Edit product, SKU missing | present and enabled; field editable |
| Edit product, SKU established | control ABSENT; field disabled; "Established..." hint shown |
| SKU typed by hand | control disappears on the first keystroke, returns when cleared |

The last two are the protections that matter. The control returns `null` rather
than rendering disabled in both cases — a disabled button beside a filled field
still advertises that generating over it is a thing one might do. And the server
refuses an established-SKU replacement independently, for every caller and every
role, so the UI is the second line rather than the only one.

---

## Order of operations

1. ~~**Production inventory**~~ — DONE (§1, 2026-09-14). The seeds in §3a are
   three-way reconciled and final.
   **Registry adjudication is DONE for 19 tokens** (§4), MISTR among them.
   What remains unadjudicated: the two ambiguous mappings (§3b) and the 25
   unfiled tokens (§3c). Neither can issue anything, which is the correct
   state rather than an outstanding task.
2. ~~**Approved schema migration**~~ — DONE. 0125 applied 2026-09-14; the tables
   were created empty, which turns nothing on.
3. ~~**Approved seeding**~~ — DONE (section 4, 2026-09-14). 19 tokens
   registered and their counters seeded above every system, in that order,
   each a separately authorised operation.
4. ~~**Enable the flag**~~ — DONE (section 4). `SKU_GENERATION_ENABLED=1`,
   Production only. Preview and Development remain unset, so a preview
   deployment cannot mint an identifier against the live counters.

Any one of them missing leaves generation refusing, which is the correct
behaviour rather than a failure. That is still true of every token OUTSIDE the
approved nineteen.

The HubSpot property is deliberately absent from this sequence: the
implementation does not use it (§2).

