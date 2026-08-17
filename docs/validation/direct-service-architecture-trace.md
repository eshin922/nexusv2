# Direct Service — architecture trace

**Traced 2026-08-17 against `3829e57`.** Requested before any implementation.

**Reports only. Nothing here is implemented, and BV-013's markup migration
remains paused.**

---

## Headline

**Two of the three hard problems already have shipped precedents in this
codebase, and the third is a business decision nobody has taken.**

- Cost identity for a top-level non-grouped unit: **OD-017 already did this**
  for packaging.
- A cost owned by *either* a group *or* a direct unit: **migration 0077 already
  did this** for Client Target.
- What makes a Product Library entry a *service*: **nothing in the schema
  answers this today**, and the fields that look like they might do not.

---

## The dimensions

| # | Dimension | Classification |
|---|---|---|
| 1 | Product Library identity | **Business decision required** |
| 2 | Setup sellable-unit identity | Reusable with bounded extension |
| 3 | Quote persistence | **Business decision required** (then bounded extension) |
| 4 | Costs authoring / persistence | **Architectural change required** |
| 5 | Production markup consumption | Already aligned |
| 6 | Client Target / Pricing | Already aligned |
| 7 | Customer Quote / PDF | Reusable with bounded extension |
| 8 | Commercial snapshot / pin | Already aligned |
| 9 | NetSuite item resolution / SO projection | **Architectural change + business decision** |
| 10 | Engagement expansion | **Business decision required** |

---

### 1 · Product Library identity — BUSINESS DECISION REQUIRED

**Nothing today distinguishes a service from a packaging product as a
commercial identity.** The two fields that look like candidates are not:

- **`product_types.scope`** is `pgEnum("product_type_scope", ["assembly",
  "leaf"])`. That is *placement* — whether a type may be used for an Item Group
  or a component. It says nothing about services.
- **`product_types.name`** is a category taxonomy: `Primary (PP)`,
  `Secondary (SP)`, `Tertiary (TP)`, `Skincare`, `Body care`, and three entries
  explicitly marked *"Legacy migration target"* — `Component / part`,
  `Assembly sub-component`, and **`Service / labor`**.

`Service / labor` exists, but as a legacy migration target: a bucket old data
was swept into, not a governed commercial classification. **Matching on that
type name would be exactly the assumption the disposition warns against** —
inferring a governed identity from a field that was never given that job.

HubSpot's product-type field is also not usable as the authority: it is an
upstream vendor taxonomy, `hubspot_product_id` is nullable, and Nexus-authored
library entries have no HubSpot identity at all.

**The decision:** what makes a library entry a service? A new explicit column on
`leaves` (e.g. a `commercial_kind` enum), a governed `product_types.kind`
alongside `scope`, or a curated set of service product types promoted out of
legacy status. **This is an identity question, not a storage question**, and it
should be answered before the storage follows.

**A second, sharper question rides on it.** If a library entry is a service,
**may it ever be attached as a member of an Item Group?** Under BV-012 it must
not — that is precisely the "fake Filling product underneath the group to hold
costs" pattern the disposition forbids. So a service classification is not only
a label; it is an **attachment constraint**: service-classified entries are
attachable only as top-level Direct Services. That single constraint is what
preserves the Item Group ownership rule and the Direct Product packaging
boundary at the same time.

### 2 · Setup sellable-unit identity — REUSABLE, BOUNDED EXTENSION

Setup already offers two intentional acts — `+ Add Product` and
`+ Create Item Group` — and the destination selector already supports attaching
into a group or at top level. A third act, `+ Add Direct Service`, fits the
existing grammar.

The extension is bounded because the *identity* comes from dimension 1: Setup
does not decide what a service is, it lets the operator pick one. Nothing here
infers a role from Costs values, which is the failure mode the disposition names.

### 3 · Quote persistence — BUSINESS DECISION, THEN BOUNDED EXTENSION

The mechanical question — can a Direct Service ride the existing
`quote_leaves` row with `assembly_id IS NULL`? — is **yes**. That is exactly how
a Direct Product is represented today.

**And that is the problem.** If a Direct Service is *only* a `quote_leaf` with
`assembly_id IS NULL`, it is byte-for-byte indistinguishable from a Direct
Product, and every rule that keys off "top-level leaf" collapses the two. The
Costs surface could not know whether to show packaging authoring or service
authoring; the customer PDF could not label it; the SO could not project it.
**That weakens the Direct Product packaging boundary**, which the disposition
explicitly protects.

So the structure is reusable, but **only carrying an explicit classification** —
which returns to dimension 1. The honest ordering is: decide the identity, then
let persistence express it. Choosing `quote_leaves` because it needs no
migration would be choosing on code cost, which the disposition rules out.

**Recommendation, on business-identity grounds:** the classification belongs on
the **Product Library entry**, not on the quote attachment. "Formulation" is a
service wherever it appears; it does not become one by being attached a
particular way. The disposition says the same thing — *"the Product Library /
service identity determines the relevant Production authoring surface."* The
quote attachment then carries no new role column at all, and `quote_leaves`
extends by zero.

### 4 · Costs authoring and persistence — ARCHITECTURAL CHANGE REQUIRED

**This is the real blocker, and the precedent for fixing it already shipped.**

`assembly_production_inputs.assembly_id` is `NOT NULL REFERENCES assemblies`. A
Direct Service has no assembly, so **production economics for a Direct Service
have nowhere to live.** The FK I recorded in the BV-012 trace as enforcing
"no Item Group → no Production economics" is now the obstacle to the case the
business needs.

Two shipped precedents describe the fix:

- **OD-017** moved packaging cost identity onto `quote_leaf_id` — `NOT NULL` on
  `assembly_leaf_inputs`, with `assembly_leaf_id` demoted to a nullable legacy
  provenance column. Its own migration header states the reasoning: keeping a
  required structural key beside a nullable canonical one "creates two identity
  systems." Production was simply never migrated, because at the time production
  was Item-Group-only *by rule*.
- **Migration 0077** (Client Target) established the exact shape for a value
  owned by *either* a group or a top-level direct unit: nullable `assembly_id`,
  nullable `quote_leaf_id`, and a CHECK that exactly one is set, with partial
  unique indexes per branch.

So the change is architectural but not novel: `assembly_production_inputs`
grows a nullable `quote_leaf_id`, `assembly_id` becomes nullable, and a CHECK
enforces exactly one owner. **That is the same XOR this codebase already runs in
production for Client Target.**

**Two consequences that must not be lost:**

1. **The BV-012 boundary stops being FK-enforced and becomes CHECK-enforced.**
   Today "a Direct Product cannot own production" is guaranteed by the FK. After
   the change, a `quote_leaf_id` on a production row is *legal* — so the rule
   "only a service-classified leaf may own production" needs an explicit guard.
   Losing an invariant that a foreign key used to give for free is exactly the
   Pattern 56 shape: a property that held because nothing could express the
   violation.
2. **The authoring surface must be driven by identity, not by presence of
   values.** #282 established one Production surface per Item Group and none on
   leaves. A Direct Service surface must be gated on the service classification,
   not on "this leaf has production rows" — otherwise the first stray row
   creates an authoring surface, which is #282 undone.

### 5 · Production markup consumption — ALIGNED

BV-013's single `Production` category is category-based, not owner-based.
`lookupMarkup(markupDefaults, "Production")` does not care whether the cost
belongs to an assembly or a leaf. A Direct Service consumes the same authority
with no change, exactly as the disposition requires.

### 6 · Client Target / Pricing — ALIGNED

Pricing's sellable unit is already *"top-level rollup row"* —
`skuRollups.filter(r => r.parentSkuId === null)`, resolving to an `assemblies.id`
or a `quote_leaves.id` with `assembly_id IS NULL`. A Direct Service is such a
row by construction, so it appears in the compliance grid, carries a Client
Target (migration 0077's `quote_leaf_id` branch), and participates in lifts and
overrides with no extension.

### 7 · Customer Quote / PDF — REUSABLE, BOUNDED EXTENSION

`customer-view-resolver.ts` aggregates production into `aggByAssembly` and
labels each service fee with the **assembly's** `skuLabel`. A Direct Service has
no assembly, so it would produce no customer-facing line — it would be invisible
on the document the customer signs.

Bounded because the fix is to widen the aggregation key to the owning sellable
unit rather than the assembly, which is the same generalisation dimension 4
makes in storage. `FEE_COPY`'s four labels are also narrower than the service
vocabulary — a `Testing / Micros` service has no label today.

### 8 · Commercial snapshot / pin — ALIGNED

`quote_commercial_markup_pins` is keyed `(pin, quote_leaf_id, tier, category)`,
and `prepareQuoteCommercialPin` enumerates every `quote_leaves` row for the
quote. **A Direct Service is a `quote_leaves` row, so it is already pinned** —
including `Production` once that category exists. No change.

### 9 · NetSuite — ARCHITECTURAL CHANGE + BUSINESS DECISION

Today **every SO line is a leaf line**: `netsuiteItemId` from the library leaf,
`rate = requiredSellPerUnit`, and production embedded in that rate.

- **Direct Service SO** is the *closest* to already working: a service leaf with
  its own NetSuite item id would project as a line by the existing mechanism.
  Its `requiredSellPerUnit` would carry the service cost plus Production markup.
  What is undecided is whether that item is the BV-011 destination
  (`OTC - Filling`) or a distinct library item that *maps* to it.
- **Item Group SO** is the one that does not fit. The intended model wants
  packaging component lines *plus* `OTC - Raws` / `OTC - Filling` /
  `OTC - Packout` lines *plus* logistics lines, as one finished-good structure.
  Today those production economics are inside leaf rates and have no lines.
- **Direct Product SO** already matches the intent.

**OD-004 interaction.** Grouping follows the quote's agreed presentation
(`detail_level = turnkey_only` → group, `itemized` → do not), the assembly is
the boundary, and `composition_hash` is the identity. Adding OTC lines to an
Item Group raises two questions OD-004 did not face: are those lines *inside*
the group (changing `composition_hash`, and therefore group identity across
quotes) or siblings of it; and does REG-4's "lines sum exactly to the accepted
commercial total" still hold when an amount moves from inside a leaf rate to its
own line.

### 10 · Engagement expansion — BUSINESS DECISION REQUIRED

**No mechanism exists.** There is no relationship between a satisfied Direct
Service and a later Item Group, and nothing prevents charging Formulation twice.

What *does* exist and is directly relevant: `quotes.copied_from_quote_id`,
scenario families, and the `scenario_copied` audit action with its
`source_type` discriminator — the shape of "this quote derives from that one,
recorded." Whether engagement expansion is a copy relationship, a new
first-class link, or purely an operator-visible cross-reference is undecided.

The disposition's constraint is the useful boundary: *a safe operator path for
the real expansion, not a speculative lifecycle platform.* The minimum that
satisfies "do not silently duplicate or delete commercial economics" is an
**explicit operator act** with an audit record — not automatic inclusion and not
automatic exclusion.

---

## Authority mechanism — recommendation

**Amend BV-012 in place, with an explicit dated amendment. Do not open a new
BV.**

- **BV-012 is Approved, not Frozen.** BV-006 carries an explicit freeze and a
  clause that only a future Business Validation may extend it. BV-012 carries
  neither.
- **The governing principle does not change**, only the absoluteness of its
  inverse. The durable rule — *production economics may not belong to a
  packaging component* — is intact. What changes is that ownership now has two
  legitimate homes: the finished-good Item Group, and a Direct Service that is
  itself the sellable unit.
- **Splitting one principle across two documents would defeat AUTHORITY_MAP's
  purpose**, which is answering "which document governs this, right now" with a
  single answer. A reader who finds BV-012 must not have to know that a second
  document silently narrows it.

The amendment must mark the superseded §1.b text in place rather than delete it
— someone will arrive holding the old rule, and it needs to land somewhere that
explains what replaced it. `AUTHORITY_MAP.md`'s reconciliation date updates with
it.

---

## Reconciliation with the decision inventory (#284)

**F1 — do OTC destinations become SO lines?** *Now forced, not optional.* A
Direct Service's whole commercial content is a service; if OTC destinations
never become lines, a Direct Service SO has nothing to project but an embedded
rate on a leaf whose accounting destination is a service item. F1 and the
Direct Service model must be answered together.

**F2 — where are allocation-OFF fees billed?** *Sharpened.* F2 asked whether the
customer's turnkey total or `totalRevenue` is the accepted commercial total,
given fees are shown to the customer but absent from the SO. A Direct Service is
a quote whose economics are *entirely* of that kind. If allocation-OFF fees are
outside the SO, a Direct Service quote could push an SO of nearly zero. F2
stops being an edge case and becomes structural.

**F4 — are OTC lines inside or outside the Item Group?** *Unchanged in
substance, but now has a sibling question:* whether a Direct Service line is
ever inside a group at all. Under the recommendation in dimension 1 it is not —
a service is top-level or nowhere.

**Also affected: C1 and C2.** Allocation is one boolean over four one-time fees
today. A Direct Service selling *only* Filling has no "unit" to amortise into in
the same sense; whether allocation even applies to a service, and what it means
if it does, is a business question the inventory did not contemplate.

**Not affected: A2, D1, D2.** BV-013's single `Production` rate covers services
unchanged, and Bulk Raw's authority question is orthogonal.

---

## Impact on the paused BV-013 migration surface

**The markup migration surface does not grow.** Resolution is by category, the
pin already covers every `quote_leaves` row, and a Direct Service adds no new
markup authority. The three-rung fallback problem and the `Production` category
compatibility question for existing pins are unchanged.

**What does change is sequencing.** Dimension 4 makes `assembly_production_inputs`
grow a second owner column. Doing that *after* the BV-013 category migration
means two migrations over the same table; doing it *before* means the category
migration must handle rows with either owner. Neither is difficult, but the
order should be chosen deliberately rather than discovered.

**The pin/backfill work is unaffected and complete** — 14/14 pinned, economics
bit-identical, `legacy_live` at zero. Step 5 (retiring `legacy_live` as a
runtime path) is also independent of the sellable-unit model and can proceed
whenever dispositioned.

---

## Genuinely unresolved business questions

1. **What makes a Product Library entry a service?** (dimension 1)
2. **May a service-classified entry ever be an Item Group member?** My reading
   is no, and that constraint is what protects both boundaries — but it is a
   business rule, not an inference.
3. **Which Production inputs does each service expose?** The disposition says
   library identity determines it. Is that a per-type field schema
   (`product_types.field_schema` already exists and is unused for this), a
   curated mapping, or operator choice?
4. **Does allocation apply to a Direct Service?** (C1/C2 extension)
5. **Is a Direct Service's NetSuite item the BV-011 destination itself, or a
   library item that maps to one?** (F1)
6. **Is engagement expansion a recorded link, a copy relationship, or an
   operator-visible cross-reference only?** (dimension 10)
7. **Do OTC lines join the Item Group's `composition_hash`?** (F4) — this one
   changes group identity across quotes, so it is the highest-stakes of the
   NetSuite set.
