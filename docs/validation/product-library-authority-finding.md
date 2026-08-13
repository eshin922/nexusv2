# Product Library authority — V1 finding

**Read-only. Nothing repaired, no product master data created, no substitution.**
Reproduced by `scripts/validation/product-library-authority-census.ts` (governed
script, not a scratch artifact).

Surfaced while building Accounting Review Order A, which is **stopped** pending
disposition.

---

## 1 · The governing chain

```
HubSpot Product   ↔   Nexus leaf   →   exactly one eligible NetSuite Item
```

Nexus is **not** an independent product-master authority for commercial
component SKUs. Nexus-local structural objects (ASYs / Finished Product
composition) are a different thing and may legitimately be Nexus-owned.

### Proposed downstream-eligibility contract

> A commercial Nexus library product intended to become a NetSuite Sales Order
> line is downstream-eligible only when
> **(1)** its governed HubSpot Product exists,
> **(2)** the Nexus identity agrees with that HubSpot Product, and
> **(3)** the HubSpot product resolves to exactly one eligible NetSuite Item.

Therefore **`archived = false` is not evidence that a product is
downstream-capable.** Today it is the only signal an operator sees.

**Not implemented. Recorded for disposition.**

---

## 2 · Proven failure classes

### Class 1 — governed HubSpot Product exists, NetSuite Item missing

```
CC-12oz-Filling-1.4
  Nexus leaf   6ca21562  active=true
  HubSpot      2911930393 EXISTS · sku="CC-12oz-Filling-1.4"
                                   name="Coca Cola - 12Oz - Filling"
  NetSuite     NO ITEM
```

**Classification: HubSpot → NetSuite synchronization missing/failed.**

Explicitly **not** a Nexus mapping defect. Nexus and HubSpot agree exactly on
SKU and name; Nexus is faithfully representing a governed product. The break is
downstream of HubSpot. An earlier framing of this as "missing Nexus→NetSuite
mapping" was wrong and is corrected here.

### Class 2 — active Nexus leaf references a deleted HubSpot authority

```
10025-Fill   leaf 59146123  active=true  hs_id=2763571840  → DOES NOT EXIST
50010-Fill   leaf 1472242e  active=true  hs_id=2868852631  → DOES NOT EXIST
```

**Classification: Nexus Product Library stale/dangling authority.**

This one *is* a Nexus governance problem: the product remains operator-usable
after its governing HubSpot Product has disappeared. It is the more dangerous
shape, because Nexus presents an active, apparently-authorable product whose
authority is gone.

Found only because the SKU search returned nothing while the leaf claimed a
HubSpot id — the id was then checked directly rather than trusting the search.

### Class 3 — NetSuite SKU ambiguity

```
10025-Fill →  id=72978  InvtPart     class=42
           →  id=59156  NonInvtPart  class=42
```

**Resolver behaviour, read from `item-resolver.ts` rather than inferred from
this one case:**

- 0 matches → `not_found`; 1 → `found`; **>1 → `status:"ambiguous"` with ALL
  matches returned.**
- **It refuses ambiguity. It does not first-match.**
- Matches on `itemid` only, case-insensitive (`LOWER` both sides).
- Excludes `itemtype='Group'` — Groups share the itemid namespace (CA-caught
  2026-07-28 via `TCS-BAR-01`).
- **No identifier beyond SKU participates.**

So Class 3 is not a resolver defect. The resolver behaves correctly and refuses;
the defect is upstream, in a product namespace that permits two active items to
carry one SKU.

---

## 3 · Population census

Active commercial leaves with a SKU: **1,027**.
Eligible NetSuite namespace: **1,316 active non-Group items across 1,201
distinct itemids** — itself evidence of duplicate itemids.

| classification | count | % | e.g. |
|---|---|---|---|
| unique NetSuite resolution | **847** | 82.5% | `Carton_Capsule_Purr_v04`, `BA052701` |
| **multiple active matches** (would be REFUSED at Send) | **111** | **10.8%** | `Lollipop Co-packing, Blending & Filling`, `REV-RB-06` |
| no NetSuite item | **55** | 5.4% | `Raws-001`, `CC-12oz-Cap-1.2` |
| no HubSpot product id stored | **14** | 1.4% | `LEAF-GLW-FCT`, `LEAF-GLW-TP` |

**~17.5% of the active commercial library is not downstream-eligible**, and none
of it is distinguishable from the eligible 82.5% in the operator UI.

The largest class is **ambiguity (111)**, not the missing-item case the Filling
investigation started from. Had Order A used any of those 111, it would have
failed at Send-time resolution with a frozen snapshot behind it.

**Deliberately unmeasured:** how many of the 1,027 carry a *dangling* HubSpot id.
That is one API call per leaf. Class 2 proves the case exists; its population is
left unmeasured rather than guessed.

### Census method

The per-SKU resolver is serial by design (SuiteQL throttling), so 1,000+ calls
is impractical. The census pulls the eligible NetSuite namespace once and joins
in memory **using the resolver's own predicate** — active, non-Group,
case-insensitive `itemid`. Diverging from that rule would make the census a
different question wearing the same name.

---

## 4 · How products are meant to enter

- **Into Nexus:** `HubSpot Product → Nexus leaf`. `leaf_create` records a
  `source` discriminator — `nexus_authored` (PM-driven, **HubSpot-first**:
  `createProduct` fires first, so `hubspot_product_id` is always populated) or
  `hubspot_pull` (pull-driven).
- **Into NetSuite:** `HubSpot Product → NetSuite sync`, outside Nexus.

**No supported Nexus path creates a commercial library product independently of
HubSpot** — even PM-authored leaves are HubSpot-first by construction. That is
why Class 2 is a governance gap rather than a data-entry mistake: the leaves
were created correctly and their authority was removed afterwards.

---

## 5 · Consequence for Accounting Order A

**No Filling product has a complete chain**, so Order A is **stopped** per the
decision rule. No new master data was created, no NetSuite Item substituted, no
Nexus-only leaf authored.

Scenario `7f831413-2c48-409d-8988-6dd37b1848f9` remains a **draft shell** —
`detail_level` still unset, no lines authored, nothing sent.

**Action required from the product-master owner**, not from Nexus:

1. Sync `CC-12oz-Filling-1.4` (HubSpot `2911930393`) through to NetSuite; **or**
2. nominate a filling/service product that already has the complete chain; **or**
3. resolve the `10025-Fill` / `50010-Fill` dangling-authority state upstream.

Nexus should not manufacture a product to unblock a review fixture.

---

## 6 · Scope

**Kept separate from OD-026** (Direct Component quantity semantics). It *may*
become an OD-022 prerequisite, because Direct Components make library leaves
independently downstream-projectable and would expose all four classes above
directly to operators — but the two findings are **not merged without evidence**.

Open questions for disposition — ingestion validation, operator-visible
resolution status, authoring restriction, Send/Complete gate, or a combination.
**Not implemented here.**
