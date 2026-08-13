# Product Library + Product Setup V1 — implementation boundary review

**Status:** discovery only. Nothing implemented, no schema changed, no migration
authored, no UI touched.
**Date:** 2026-08-13

Findings are separated into **[DEFECT]** (observed, evidenced), **[DA]** (Design
Authority requirement, given), and **[REC]** (my recommendation, arguable).

---

## 1 · Current structural model

Three tables carry structure. Only one is canonical.

| Table | Role | Direct-capable? |
|---|---|---|
| `leaves` | **Product Library** — the product master (1,077 rows) | n/a |
| `quote_leaves` | **canonical attachment** of a library product to a quote | **yes — `assembly_id` is NULLABLE** |
| `assemblies` | grouped commercial structure (the ASY / Item Group) | — |
| `assembly_leaves` | legacy junction; carries both `leaf_id` and `quote_leaf_id` | compatibility only |

**The schema already models the target.** `quote_leaves.assembly_id IS NULL` *is*
a Direct Product. The Design Authority structure — Product and Item Group as peers
— is representable today with **no schema change**.

**Live population: 158 `quote_leaves`, 158 assembly-backed, `0` Direct.** The form
is legal and has never been produced, because no writer emits it (§6).

---

## 2 · ASY dependency classification

Traced Library → attachment → Setup → Costs → Pricing → Send → Accept → Complete
→ NetSuite. Much less is broken than the ASY-everywhere surface suggests: **OD-014
and OD-017 already converted the costing spine.**

| Stage | ASY dependency | Class |
|---|---|---|
| Costing loader — SKU population | **none.** `nm.quote_leaf_attachments` enters `quoteLeaves` scoped by `quoteId`, left-joins `assembly_leaves` as compatibility. Direct sorts last (ASC NULLS LAST) | **already Direct-capable** |
| Costing loader — cost inputs | **none.** `nm.assembly_leaf_inputs` joins through `quote_leaves`, not `assemblies` | **already Direct-capable** |
| Cost persistence | **none.** `assembly_leaf_inputs.quote_leaf_id` **NOT NULL**, `assembly_leaf_id` **nullable** (OD-017/0066) | **already Direct-capable** |
| Adapter → math | **none.** Every attachment emits as a leaf SKU with `parentSkuId = assemblyId` — **null for Direct**, so it becomes a root SKU. Packaging keys on `quoteLeafId`, "with no special case" | **already Direct-capable** |
| Freight anchor | assembly anchor with an explicit membership fallback for Direct-only shipments (OD-017) | **legitimate / handled** |
| `assembly_leaves` junction | dual identity retained for compatibility | **internal detail — may remain** |
| **`loadAssemblyTree`** | returns `AssemblyTree { assemblies }`; a Direct leaf has no node | **[DEFECT] blocks Direct** |
| **NetSuite projection** | `mark-complete.ts:341` — `if (!tree \|\| tree.assemblies.length === 0) throw "Quote has no assemblies to push."`; `:621` reads `treeLeaf.assembly.id` | **[DEFECT] blocks Direct** |
| **Attachment writer** | only two `insert(assemblies)` call sites exist; the Library attach path always creates an ASY | **[DEFECT] blocks Direct** |
| Setup UI | renders the assembly-rooted tree | **[DEFECT] blocks Direct** (follows from `loadAssemblyTree`) |

**Bottom line: the commercial spine is done; the ends are not.** Costing, pricing
and cost persistence already handle a Direct Product correctly. What blocks it is
the **structure loader**, the **writer**, and the **NetSuite projection** — three
places, not a system-wide migration.

---

## 3 · Minimum end-to-end Direct Product boundary

For `Quote → Add Product → direct SKU` to survive the governed lifecycle without
being dropped or forced into a group:

1. **`loadAssemblyTree` must return Direct attachments.** Today its return type
   admits only assemblies. It needs a peer collection of quote-level products.
   This is the keystone — the UI *and* NetSuite both consume it, so both are fixed
   by one correct change rather than two parallel ones.
2. **Attachment writer must not create an ASY.** Add Product writes
   `quote_leaves` with `assembly_id = NULL`. Materialization already keys on
   `quote_leaf_id` and needs no change.
3. **NetSuite projection must accept assembly-less members.** Remove the
   zero-assembly throw; project a Direct Product as a plain SO line rather than an
   Item Group member. `:621`'s `treeLeaf.assembly.id` needs a Direct branch.
4. **Setup UI renders two peer actions** (§8).

**Explicitly NOT required:** no schema change, no migration, no costing/math
change, no adapter change, no historical migration. **[DA]** Existing ASY-backed
quotes keep working because nothing in their path is altered — the change is
additive.

**[REC] Sequence 3 before 4.** Edward's instruction not to ship a UI-only ASY
removal is exactly right, and the ordering that enforces it is to make Complete
consume the structure *before* the UI can produce it. Otherwise the first Direct
quote is unsendable and the failure lands on an operator at the commit point.

---

## 4 · Product Library state model + production census

### 4.1 What the database can and cannot answer

**[DEFECT] `leaves` carries no NetSuite identity and no sync-health column at
all.** Full column list: `id, name, sku, url, image_url, product_type_id,
unit_cost, fsc_claim, fsc_status, supplier_verified, owner_id, archived,
created_at, updated_at, hubspot_product_id`.

There is **no** `netsuite_item_id`, no resolution cache, no last-synced marker, no
authority-health field. So three of the states in the brief — *unique NetSuite
resolution*, *unresolved*, *ambiguous/duplicate* — **cannot be censused from the
database at all**, because Nexus never persists them. Resolution happens live at
Complete, by SKU-match.

That absence is itself the headline finding, and it is the direct cause of §7.
I have not inferred those states from code; they do not exist as data.

Likewise **live HubSpot authority was not probed** — establishing it means ~1,077
API calls. Not run. `hubspot_product_id IS NOT NULL` records that a product *had*
authority, not that it still resolves.

### 4.2 Census — what is real (1,077 leaves)

| State | Count | Note |
|---|---|---|
| Total | **1,077** | |
| Active | **1,072** | |
| Archived | **5** | |
| Has `hubspot_product_id` | **1,061** | authority *claimed*, currency unverified |
| **No `hubspot_product_id`** | **16** | Nexus-authored or authority lost |
| **SKU missing or empty** | **47** | **cannot ever resolve in NetSuite** — SKU is the match key |
| `product_type_id` unset | **1,051** | 97.6% untyped |
| Attached to ≥1 quote | **25** | |
| Active, never attached | **1,047** | |
| Archived but still referenced by a quote | **0** | historical-only state has **no instances yet** |
| Duplicate SKUs **inside the library** | **0** | library-side ambiguity does not exist |

**Three things worth reading twice.** (a) **47 products are structurally
unprojectable** — no SKU, so NetSuite SKU-match cannot succeed, and nothing warns
anyone. (b) **Duplicate-SKU ambiguity is a NetSuite-side property, not a Nexus
one** — the library is clean, so the fail-closed resolver is guarding against the
*other* system, which is the correct place to guard but means Nexus cannot predict
it from local data. (c) The **historical-only** state is real in the model but has
**zero instances**, so it is currently unexercised — any behaviour claimed for it
is untested by production data.

**[DA] State-B preserved.** Nothing here reverses it: loss of current HubSpot
authority does not invalidate historical use, and 16 leaves already sit without a
HubSpot id while remaining valid.

---

## 5 · Identity boundary map

| Boundary | Authoritative identity | Producer | Consumer | Persistence | Semantics |
|---|---|---|---|---|---|
| HubSpot → Library | `hubspot_product_id` | HubSpot | pull / create | `leaves.hubspot_product_id` | **current** |
| Library → quote | `leaves.id` | operator attach | `quote_leaves.leaf_id` | `quote_leaves.leaf_id` (**RESTRICT**) | **current** — library edits reach attached quotes |
| Quote attachment | **`quote_leaves.id` — CANONICAL** | attach writer | costing, cost inputs, freight, pricing | `quote_leaves.id` | current |
| Legacy junction | `assembly_leaves.id` | attach writer | compatibility only | `assembly_leaves.quote_leaf_id` bridges | **compatibility** |
| Cost rows | `quote_leaf_id` **NOT NULL** | materialization | adapter → math | `assembly_leaf_inputs.quote_leaf_id` | current |
| Math / rollups | `quote_leaves.id` via `mathSkuId` | adapter | costing, pricing | in-memory | current |
| Spec | `leaf_specs` version | spec editor | PDF, NetSuite description | `quote_leaves.leaf_spec_version_id` | **SNAPSHOT** |
| NetSuite | **`leaves.sku` (text)** | operator/HubSpot | resolver at Complete | **not persisted** | **live match** |

**Two observations.**

The identity confusion OD-017/COSTS-RENDER-1/OD-028 fixed was structural, and the
structure now names the winner: `quote_leaf_id` is NOT NULL, `assembly_leaf_id` is
nullable. **The canonical key is the required one and the legacy key is the
optional one** — the constraint now encodes the intent, so a regression fails
loudly rather than type-checking.

**[DEFECT] The NetSuite boundary is the one identity that is a free-text match
with no persisted result.** Every other boundary above is a UUID with a foreign
key. `leaves.sku` is text, matched live, and the outcome is stored nowhere — so
the same product can resolve today and fail tomorrow with no record that anything
changed. **I did not find a legacy/canonical mismatch to repair** in this pass; per
instruction I have not repaired anything unproven against a fixture.

---

## 6 · Attachment lifecycle

Path: Library selection → `assemblies` (created) → `quote_leaves` → `assembly_leaves`
→ tier materialization → `assembly_leaf_inputs` keyed by `quote_leaf_id`.

- **[DEFECT] Non-atomic** — already recorded from the production incident. Structure
  commits; materialization can fail separately, leaving an assembly with no cost
  rows that reads as intentionally empty. **V1 consequence: low but not nil** — the
  operator sees an error while the product *is* attached, so the natural retry
  produces a duplicate rather than a repair.
- **[DEFECT] Attach always creates an ASY.** Only two `insert(assemblies)` call
  sites exist; the Library path is one of them. This is the writer half of §3.2.
- **Duplicate attachment** — the Library modal marks already-attached products
  `✓ ATTACHED` and disables the action, so the UI prevents it; I found no
  database-level uniqueness on `(quote_id, leaf_id)`, so the guard is presentational.
- **Tier-count changes** — materialization fills `(leaf × tier)` gaps and inherits
  the line-group shape, so adding a tier back-fills correctly. Verified live: the
  smoke produced exactly 4 rows for 4 tiers, one line group.
- **Detach/delete** — `quote_leaves.leaf_id` is **RESTRICT**, so a library product
  in use cannot be deleted. Archive is the intended path, consistent with State-B.
- **Historical identity after library changes** — `leaves` edits are **current**,
  not snapshot. Only `leaf_spec_version_id` is pinned. **[DEFECT-adjacent]** renaming
  or re-SKU-ing a library product **retroactively changes what a historical quote
  appears to contain**, except for spec values. Sent PDFs are immune (`pdf_url`
  snapshot); live quote views are not.

---

## 7 · NetSuite readiness

| Case | Behaviour today |
|---|---|
| Unique match | resolves, projects |
| No match | **fails at Complete** |
| Multiple active same SKU | **fail-closed — refuses** ✅ correct, preserved |
| Inactive item | resolver-dependent; not exercised in this pass |
| Stale HubSpot authority, valid downstream | **works** — State-B holds; SKU-match doesn't consult HubSpot |
| **Direct Product** | **impossible** — `assemblies.length === 0` throws |
| Item Group member | certified (SO2707/2708/2709) |

**Does Nexus know before Send that a product cannot project?**

**No — and it holds enough information to know for a large subset.** The 47
SKU-less products are **provably** unprojectable from local data alone: SKU-match
cannot succeed without a SKU. That requires no NetSuite call and no new
integration. Yet Product Setup presents them as normally attachable.

**[DEFECT — operator-governance gap]** An operator can build a complete quote,
price it, send it to a customer, obtain acceptance, and only discover at the
irreversible Complete step that a line was never projectable. The failure surfaces
at the one point in the lifecycle designed to be a commit.

The ambiguous-duplicate case is genuinely unknowable in advance without querying
NetSuite, and fail-closed at Complete is the right answer there. **The SKU-less
case is not in that category** — it is knowable at attach time and is not surfaced.

---

## 8 · Operator workflow

**[DA]** Target: `Add Product` and `Add Item Group → Add Product(s)` as peers. ASY
disappears from operator language; `assemblies` may remain internally.

**Minimum coherent Setup UI:**
- Two peer buttons. **[DA]** Never infer Item Group intent from product count.
- Direct Products render at quote level; Item Groups render as a labelled container.
- One shared Library modal; its "attaching to" target is the quote, or a named
  Item Group.

**[REC] Library state communication.** The census makes the vocabulary concrete —
and one state should be a hard gate rather than a badge:

| State | Signal | Attach? |
|---|---|---|
| Healthy | none (default) | yes |
| Degraded but usable — no HubSpot authority (**16**) | subdued marker | yes — **[DA]** State-B |
| **Not projectable — no SKU (47)** | **explicit, blocking** | **no** |
| Historical-only — archived, in use (**0 today**) | visible in historical context only | no |
| Ambiguous downstream | not knowable pre-Send | n/a — fail-closed at Complete |

The existing modal already renders `READY` / `ARCHIVED` / `ATTACHED`, so this is
an extension of a vocabulary that exists, not a redesign.

---

## 9 · Proposed V1 package

1. **Direct Product structural support** — `loadAssemblyTree` returns quote-level
   products; attach writes `assembly_id = NULL`; NetSuite projects a Direct
   Product as a plain SO line. *Keystone; everything else depends on it.*
2. **Setup UI: two peer actions.** After 1.
3. **Attach eligibility gate** — refuse attaching a SKU-less product; mark it in
   the Library. Small, and it closes §7 for the subset that is knowable.
4. **Library state vocabulary** — the five states above.

**[REC] Do 1 and 3 first even if 2 and 4 slip.** 1 is the Design Authority
requirement; 3 removes a defect that can reach a customer-facing commitment.

## 10 · Deferred post-V1

- **Attachment atomicity** — recorded defect; the failure is visible and
  recoverable, and fixing it means restructuring a transaction boundary that the
  Direct Product work is about to move anyway. Fix after, not during.
- **Persisted NetSuite resolution state** on `leaves` — the durable answer to §7,
  but it is a sync-model change and needs its own contract.
- **HubSpot authority-health surfacing** — requires a live probe model; the
  contract must be established before it is designed.
- **Snapshot-vs-current library semantics** for historical quotes (§6) — a real
  gap, but changing it touches Pattern 52 freeze semantics.
- **Product typing** — 1,051 untyped. Not blocking; it is a data exercise.
- **Historical-only state** — 0 instances; specify when it first occurs.
- **Identity consolidation, CI repair, OD-022, Order A** — explicitly out.

---

## 11 · Open question I could not resolve

**Does an Item Group with exactly one product differ commercially from a Direct
Product?** If the NetSuite projection differs, the operator's choice is a
commercial decision, not a presentation one — and the UI must say so. If it does
not differ, the two paths converge downstream and the distinction is organisational
only. This determines whether §9.1's "plain SO line" is a new projection or an
existing one, and it should be settled before implementation. It may be an
Accounting question rather than a Design Authority one.
