# Training corpus · capability coverage matrix

**Written 2026-08-31**, after Order 1 reached PASS. Supersedes the staging plan
in `docs/validation/training-order-reconciliation-design.md` (#507) for the
question of *what each remaining order is for*.

**The rule this matrix serves:** an order is not certified because its screens
look complete. It passes only when its intended lifecycle reaches its designed
endpoint and its calculations and state **independently reconcile** — the
standard Order 1 was held to.

Each order must therefore **add governed capability coverage**. Fields are
populated because they are realistic and because a swap or propagation error in
them would be *numerically visible*, never to fill a screen.

---

## What Order 1 actually certified — measured, not assumed

`DPS-1072` · TRAINING · Serum Launch · **PASS** · `SO2730` / 363541.

**Certified:** the itemized NetSuite path end to end; one Item Group with four
members; the Item Group commercial line through `item_group_production` →
IGP-0001; member multiplicity (Label ×2 → 12,000); four tiers with a per-tier
price adjustment on T2 and a recommended tier; recovery elections `included` and
`separate`; separately-billed OTC as its own SO lines; bidirectional line
provenance against the frozen artifact.

**NOT certified — measured gaps, and the reason this matrix exists:**

| gap | measurement |
|---|---|
| **Freight** | `freight_leg_groups` = 0, `freight_subcategories` = 0. Completely uncovered. |
| **Specifications** | all four training leaves hold `spec_values = {}`. Zero coverage, PP/SP/TP alike. |
| **Component-owned charges** | all four charge instances are `owner_quote_leaf_id IS NULL` with **zero** per-tier rows — the LEGACY production-column path. The component-charge path was not exercised at all. |
| **Grouped NetSuite path** | not applicable: `detail_level = itemized`, and OD-004 forbids grouping it. |
| **Direct Products / Direct Services** | neither present. |
| **Tertiary packaging specs** | `tp_*` has **never** been written by any quote in the database. |

---

## The five projects

Four training projects exist with **no quote yet**, and their names already
suggest the capability each is suited to carry:

| project | order | subject |
|---|---|---|
| TRAINING · Serum Launch | 1 | ✅ **PASS** — itemized path |
| TRAINING · Import Programme | 2 | Freight, in depth |
| TRAINING · Retail Gift Set | 3 | Grouped path + component-owned charges |
| TRAINING · Contract Fill | 4 | Direct Services + Direct Products |
| TRAINING · Full Spec Reference | 5 | The specification reference |

---

## Coverage matrix

`●` primary subject · `○` secondary variant · `✅` already certified

| capability | O1 | O2 Import | O3 Gift Set | O4 Contract Fill | O5 Spec Ref |
|---|---|---|---|---|---|
| itemized NetSuite path | ✅ | ○ | | ○ | ○ |
| **turnkey_only grouped path** | — | | ● | | |
| composition hash / Group reuse | — | | ● | | |
| member multiplicity through a Group | — | | ● | | |
| **Freight — international, pass-through, customs** | — | ● | | | |
| Freight — bundled, domestic | — | ○ | ○ | | |
| Freight — per-tier values + propagation | — | ● | | | |
| Freight — multi-leg journey | — | ● | | | |
| **Primary packaging specs** (`pp_*`) | — | | ○ | | ● |
| **Secondary packaging specs** (`sp_*`) | — | | ○ | | ● |
| **Tertiary packaging specs** (`tp_*`) | — | | | | ● *first ever* |
| **component-owned one-time charges** | — | | ● | ○ | |
| multiple charge owners on one quote | — | | ● | | |
| multiple charge *types* | — | ○ | ● | | |
| charge recovery treatments (incl / sep) | ✅ | | ● per-instance | | |
| per-tier charge cost variation | — | | ● | | |
| tier-specific behaviour generally | ✅ adj | ● freight | ● charges | | ○ |
| **Direct Services** | — | | | ● | |
| **Direct Products** (top-level, ungrouped) | — | | | ● | |
| mixed structure (Group + Direct in one quote) | — | | | ● | |

**No axis is covered twice as its primary subject.** Secondary marks exist only
where a variant genuinely differs — bundled versus pass-through freight, or a
component charge under a Direct Product rather than a Group member.

---

## Order 2 · TRAINING · Import Programme — Freight

**Certifies:** the freight module in depth, and freight's propagation into
costing.

- multi-leg journey: an **inbound** international leg plus a **domestic**
  onward leg, so leg ordering and per-leg attribution are both visible;
- `crosses_international_border = true` with **customs**: duty *and* tariff, so
  the two are distinguishable rather than folded;
- `treatment = pass_through` on the international leg and `bundled` on the
  domestic one — the two treatments reach the customer document differently;
- modes and incoterms drawn from the governed enums (`ocean_fcl`, `ltl_truck`;
  `DDP`, `FOB`) rather than left default;
- **per-tier `total_freight` and `units_in_shipment`**, chosen so a tier swap
  moves the number by an obviously wrong amount;
- freight, duty and tariff markup percentages distinct from one another, so a
  markup applied to the wrong component is visible in the result.

**Endpoint:** itemized SO. Freight's certification is that its costing
contribution reconciles, not that it produces a new line kind.

---

## Order 3 · TRAINING · Retail Gift Set — grouping + component charges

**Certifies** the two largest remaining paths together, because a gift set is
the natural turnkey Item Group and the natural home for per-component charges.

**`detail_level = turnkey_only`**, which is what makes this the grouped-path
subject:

- `findOrCreateItemGroup` → composition hash → `nxs-grp-<hash>` → Group span;
- **member multiplicity inside a Group** — at least one member at qty/parent ≥ 2,
  so expansion through the ERP boundary is proven, which Order 1 could not do;
- `EndGroup` carries no independent economics;
- **idempotent reuse** — the same frozen composition resolves to the same Group.

**Component-owned charges**, the path Order 1 missed entirely:

- several charge **types** — `print_plates`, `tooling`, `samples`,
  `artwork_plate` — so charge-type → markup-category authority is exercised
  rather than assumed;
- **different component owners**, so a charge attributed to the wrong owner is
  visible;
- **per-tier cost variation**, so tier propagation is visible;
- **recovery treatment set per instance**, mixing `included` and `separate` —
  including two instances of one type treated differently, which is the
  capability OD-032 exists for.

Costs chosen to be mutually non-confusable — no two charges sharing an amount.

**Endpoint:** grouped SO, read back for both arithmetic and Group-span fidelity.

---

## Order 4 · TRAINING · Contract Fill — Direct Services and Direct Products

**Certifies** the structures the first three do not have:

- **Direct Services** with governed identities (`filling_blending`,
  `packout_assembly`, `testing_micros`), each resolving to its BV-011
  destination and posting at its own quantity and rate;
- **Direct Products** — a top-level product in no Item Group;
- **mixed structure** — a Group and a Direct Product on one quote, which
  `mark-complete` explicitly certified on 2026-08-13 and which no training order
  has exercised;
- a component charge under a **Direct Product** owner rather than a Group
  member.

**Endpoint:** SO carrying product, service and charge lines together.

---

## Order 5 · TRAINING · Full Spec Reference — specifications

**The specification reference**, as dispositioned. Every applicable field on
every schema, populated through the operator workflow:

- **Primary (`pp_*`)** — description, component type, size, material, deco,
  quantities, packout details, factory 1 and 2, additional details;
- **Secondary (`sp_*`)** — description, size, material, colour, coating,
  finishing;
- **Tertiary (`tp_*`)** — **first coverage in the database's history**; the
  field set is to be read from the live spec form at staging time, not
  guessed from the two schemas above.

Values are realistic and mutually distinguishable, so a field written to the
wrong key or a schema mapped to the wrong product type is visible on the
customer PDF's specification addendum.

**Endpoint:** SO plus a customer PDF **with the specification addendum on**, so
the frozen ordered-spec path is certified rather than only the live editor.

---

## Products

Reuse the four existing training leaves — `TRN-PP-BOTTLE-30`, `TRN-PP-PUMP`,
`TRN-SP-LABEL`, `TRN-SP-CARTON`. All four are currently **untyped** and hold no
spec values, so typing them is itself part of Order 5's coverage.

Orders 3–5 need products the corpus does not yet have — at minimum a tertiary
packaging item (master carton / pallet), and a service leaf for Order 4.
**Derive that list from what the matrix above actually requires**, and create
each through the operator workflow under the established `TRN-` / `TRAINING ·`
naming, rather than from any earlier provisional list.

---

## Certification rule, restated

For each order:

1. the lifecycle reaches its **designed endpoint** — for every order here, an
   actual NetSuite sandbox Sales Order;
2. the readback reconciles **independently** — NetSuite against the frozen
   accepted artifact, never against the emitter's own output;
3. **every expected fact appears exactly once**, and every emitted line traces
   back to exactly one governed frozen fact.

Populated screens are not evidence. Order 1 is the standard.
