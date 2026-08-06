# Phase 2 — Costs Workspace: Multi-SKU

**Status:** in progress · **freight sections superseded — see amendment below**
**Author:** CA
**Date:** 2026-08 · **Amended:** 2026-08-04
**Phase:** 2 of 4 · independently deployable · independently reversible

---

> ## ⚠️ AMENDMENT 2026-08-04 — the freight model in this document is superseded
>
> **Multi-SKU Packaging and Production scope is unchanged and remains
> governing.** Read those sections normally.
>
> **The freight sections are superseded.** After this specification was written,
> the freight business model was replaced outright:
>
> | | This document describes | Current model |
> |---|---|---|
> | Structure | Leg → Component → Tier | **Subcategory → Destination Candidates → Quantity Breaks** |
> | Cost basis | Per-component cost per leg | **Operator-determined shipment amount, recorded once** |
> | Ownership | Quote-level freight section | **Freight belongs to a Setup-owned commercial product** |
>
> **Why:** the leg/component/tier shape had no concept of comparing destination
> *candidates*, which is a routine part of the real Logistics workflow. The
> worksheet's structure is what Logistics actually works with — it is not a UI
> preference. See [`docs/AUTHORITY_TIMELINE.md`](docs/AUTHORITY_TIMELINE.md)
> Era 6.
>
> ### Superseded sections
>
> | Section | Status |
> |---|---|
> | Objective, ¶ *"Freight remains one Quote-level section…"* (line 32) | Superseded — freight is product-scoped |
> | Implementation Authority, *Freight* (lines 93–101) | Superseded — describes legs, vessel dates, component/tier cost |
> | In scope, items 6–8 (lines 183–226) | Superseded — component freight cost per leg; derived billable freight |
> | **Approved Freight Schema and Authority Plan** (lines 227–288) | **Superseded in full** — schema shipped as migrations 0053–0056 in the worksheet shape |
>
> **Retained from the freight sections and still governing:**
>
> - **BV-009** (line 63) — Nexus records Logistics' determined cost; it does not
>   allocate or spread freight. *(Reconstruction unratified —
>   [OD-001](docs/OPEN_DECISIONS.md).)*
> - **One Quote-owned freight markup authority** (line 64), preserved by the
>   Phase 1 sent-revision contract.
> - Every **Explicitly not in scope** exclusion (lines 214–226) — no duty/tariff
>   redesign, no CBM allocation, no automatic freight spreading, no customer/PDF
>   freight-line changes.
>
> ### Current freight authority
>
> [`docs/AUTHORITY_MAP.md`](docs/AUTHORITY_MAP.md) *(Freight authority
> register — the ordered list)* ·
> [`docs/design-authority/freight-1a/BUNDLE.md`](docs/design-authority/freight-1a/BUNDLE.md) ·
> [`docs/phase-2-freight-dom-parity-audit.md`](docs/phase-2-freight-dom-parity-audit.md)
> *(the live gap list)*
>
> **Implementation status:** freight persistence, propagation, snapshots,
> clone/revision and regression are **accepted**. The remaining work is design
> fidelity against the bundle.

---

## Success Criteria

**Business** — costing a multi-SKU Quote no longer depends on remembering that
other SKUs exist. Three owners work one page without any of them hunting.

**Implementation** — Packaging creation is extended to every existing SKU row
and nothing else changes. Every input, every control and every arithmetic result
is what it was.

**Operator** — a PM opens a five-SKU Quote and every cost entry point is on the
page. A single-SKU Quote looks exactly as it did yesterday.

---

## Objective

**Every cost entry point reachable on one page. No SKU switching.**

The approved structural read established that Packaging already renders all
existing SKU rows in one flat table and has no SKU selector. Its remaining
single-SKU constraint is creation: both `Add line` affordances target the first
cost-bearing leaf. Production already renders the complete assembly/leaf tree.
Freight remains one Quote-level section. The approved boundary amendment adds
manual component/tier cost entry beneath each leg without duplicating route or
shipment details.

**Success is a single sentence:** a PM opens a multi-SKU Quote and every cost
input for every SKU is on the page, in the section its owner works in, without
switching.

**This phase is a structural extension, not a redesign.**

---

## Business Authority

**The production Costs page as it exists.**

There is no design contract governing this phase, and that is deliberate.

**A design round was attempted and set aside.** Edward: *"I cannot take the
redesigned Costs workspace. It's too far from what we've built in production. CD
has lost too much context."* The design replaced data-entry surfaces with
computed summaries — every entry point in Packaging, Production and Freight
became a total. **It is not referenced by this specification and must not be
consulted during implementation.**

**Supporting authority:**

| Contract | Governs |
|---|---|
| **Edward's constraint** (2026-08) | Every entry point on one page. No switching. |
| **Bulk Raw scope decision** | Out of v1. Plumbing preserved, operator surface removed, term contributes zero. |
| **BV-009** | Nexus records Logistics' manually determined component freight cost; Nexus does not allocate or spread freight. |
| **Freight markup authority** | One Quote-owned commercial value, displayed once in the Freight header and preserved by the Phase 1 sent-revision contract. |

**The single constraint, as approved:**

> **Every cost entry point reachable on one page. No SKU switching.** The page
> scrolls. It does not paginate and it does not switch. Any control that hides a
> pending entry point is the same defect renamed.

---

## Implementation Authority

**The production page is authoritative for every surface it already has.**

Codex preserves and extends. **No workflow improvements beyond the approved
scope.** If a surface looks improvable, that is Phase 3's domain or a later
round — not this one.

**Specifically preserved, in full:**

**Packaging** — component rows · category · pricing source (HubSpot vendor
search) · per-line markup · inventory-eligible flag · `Add line` · per-tier cost
cells with computed per-unit beneath · line-group structure.

**Production** — Assembly block with LEAF children rolling up · seven line types
with `kind` badges (`tier total` / `one-time`) · category · supplier · per-line
markup · **both policy toggles with their consequence text** (*Customer ships
raws*, *Allocate service fees to unit cost*).

**Freight** — legs with mode, carrier/forwarder, incoterm, cargo-ready and
vessel dates · bundled/passthrough · component/tier actual freight cost · one
Quote-owned freight markup in the section header · derived per-unit billable
freight **with the arithmetic shown** · existing customs block unchanged ·
forwarder quote attachment.

**Final boundary:** Production remains a preservation surface. Phase 2 contains
Packaging multi-SKU presentation, Bulk Raw operator-surface removal, and the
approved Freight component-cost amendment below.

**All sections** — headers with owner, status, line count, per-tier totals ·
collapse behaviour · section ownership.

**Where an implementation choice is not determined by the production page or
this specification, stop and ask.**

---

## Out of Scope

- Any Pricing page change *(Phase 3)*
- The surgical lift *(Phase 3)*
- Margin Approval *(Phase 4)*
- Quote isolation and firm-settings pinning *(Phase 1)*
- **Any change to costing arithmetic.** This phase renders existing inputs; it
  computes nothing new.
- Renaming the freight `treatment` flag, or relocating it to customer-view
  settings. **Both are agreed and both are deferred** — a rename touching a live
  presentation contract does not belong in a structural phase.
- Duty and tariff redesign; HS-code modeling; CBM allocation; automatic freight
  spreading; customer/PDF freight-line changes
- Packaging `purchase_qty` — persisted, never reaches the engine. **BV.**
- The completeness ledger, owner-region rework, or any structure from the set-
  aside design.

---

## Dependencies

**None on other phases.** Phase 2 neither requires nor is required by 1, 3 or 4.

**The blocking structural read is complete and approved.** It established:

- Packaging already renders all existing SKU rows; no selector exists.
- `Add line` is the remaining first-leaf constraint.
- Production renders the complete assembly/leaf tree and is out of scope.
- Freight remains one Quote-level section and has no customer/PDF freight-line
  projection in the reachable production resolver.
- Quote-level section totals and existing costing arithmetic remain unchanged.

The remaining pre-operator rehearsal is the production-shaped range at one,
five-to-seven, and ten SKUs. It is validation, not an architecture dependency.

---

## Implementation Boundary

### In scope

**1 · Correct Packaging `Add line` targeting.**

Packaging already renders all existing rows. Provide an always-reachable `Add
line` entry point for every cost-bearing leaf instead of sending both existing
buttons to `leafSkus[0]`.

**2 · Make row-to-SKU association explicit.**

Preserve the current data and row model. Change presentation only as much as is
required for a PM to understand which SKU owns each existing or newly-created
row and which SKU an `Add line` action targets. Do not add switching, pagination,
or a new selector.

**3 · Preserve every Packaging control.**

Component row, category, HubSpot Pricing Source, per-line markup,
inventory-eligible flag, quantity per sellable unit, notes, per-tier unit cost,
computed per-unit output, line-group identity, and delete behavior all survive
unchanged.

**4 · Preserve Quote-level totals and all downstream behavior.**

Packaging's footer and section header remain Quote aggregates. Costing output,
customer projection, PDF, and NetSuite arithmetic do not change.

**5 · Remove Bulk Raw's operator surface.**

Out of v1. Plumbing preserved, term contributes zero. **Removing a surface that
accepts input which never reaches the price** — same treatment as Refresh and
Archive.

**6 · Persist manually entered component freight cost.**

Add one row per `freight leg × canonical quote_leaf × tier`. Persist only the
actual freight cost determined by Logistics. A component may participate in
multiple legs, including separate air and ocean legs. Nexus does not infer,
allocate, or spread the value.

Required integrity: canonical `quote_leaves.id`; uniqueness across leg, Quote
leaf and tier; all three parents belong to the same Quote; missing, duplicate,
cross-Quote or drifting identity fails closed. Null is valid during draft;
unresolved required cost blocks customer send and NetSuite completion.

**7 · Establish one Quote-owned freight markup authority.**

Move the freight-markup control from each leg to the Freight section header.
Default it from the firm value when appropriate, then persist it as Quote-owned
commercial state. Later firm-default changes never overwrite it. Sent revisions
preserve it through the Phase 1 commercial snapshot/pinning contract.

Remove `freight_legs.freight_markup_pct` and every production read/write after a
controlled migration. It must not remain as a deprecated shadow authority.

**8 · Derive billable freight.**

Do not persist billable freight:

`component freight cost × (1 + Quote freight markup) ÷ effective tier units`

Use existing numeric precision, effective-unit semantics, and rounding
boundaries.

### Explicitly not in scope

- Changing any input, control, or arithmetic that exists today
- Improving any surface while extending it
- Adding a completeness ledger, status matrix, or any summary layer
- **Any Production change.** Its tree rendering, assembly persistence,
  anchor-leaf compatibility mapping, policy toggles, one-time fees, and
  post-production reconcile remain exactly as they are.
- Any duty/tariff, customer/PDF freight-line, CBM, HS-code, or automatic
  allocation behavior

---

## Approved Freight Schema and Authority Plan

> **⚠️ SUPERSEDED IN FULL — see the amendment at the head of this document.**
>
> This section plans a leg/component/tier schema. What shipped is the worksheet
> schema: `freight_subcategories` · `freight_subcategory_items` ·
> `freight_destinations` · `freight_destination_breaks` ·
> `freight_customs_entries` · `freight_customs_breaks` ·
> `freight_destination_tracking` · `quote_snapshot_freight_workbooks`
> — migrations `0053`–`0056`. The `0054_phase_2_freight_authority_cutover`
> migration is where the change is visible in schema history.
>
> **`quotes.freight_markup_pct` as the sole Quote-owned freight-markup
> authority survives** and is still governing. The per-leg component-cost grain
> below does not.
>
> Retained as the record of what was planned before the model changed.

### Live commercial state

**`quotes.freight_markup_pct`** — nullable `numeric(5,4)`. This is the sole
Quote-owned freight-markup authority. A draft may initialize it from
`firm_settings.freight_markup_pct_default`; once written, it is never refreshed
from the firm value.

**`firm_settings.freight_markup_pct_default`** — nullable `numeric(5,4)` admin
default. It initializes Quote state only; it is never read as a fallback during
costing or historical rendering.

**`freight_leg_component_tier_costs`** — additive table:

| Column | Contract |
|---|---|
| `id` | UUID primary key |
| `quote_id` | Required Quote ownership key used by composite integrity constraints |
| `freight_leg_id` | Required FK to the existing leg definition |
| `quote_leaf_id` | Required FK to canonical `quote_leaves.id` |
| `tier_id` | Required FK to `quote_tiers.id` |
| `actual_freight_cost` | Nullable `numeric(12,2)`; nonnegative when present |
| `created_at`, `updated_at` | Audit timestamps |

Unique `(freight_leg_id, quote_leaf_id, tier_id)`. Add `quote_id` to
`freight_legs` as a required ownership key during migration and constrain it to
the Quote owned by its leg group. Composite foreign keys then require
`(freight_leg_id, quote_id)`, `(quote_leaf_id, quote_id)`, and
`(tier_id, quote_id)` to resolve against the same Quote. Application resolution
additionally fails closed on missing, duplicate, cross-Quote, or drifting
canonical identity.

The table persists no markup and no billable result. One component may have
rows under multiple legs.

### Sent-revision state

Add `freight_markup_pct` to `quote_commercial_settings_pins`. Add immutable
`quote_snapshot_freight_inputs` rows linked to `quote_snapshots.id`,
with UUID primary key, required `quote_snapshot_id`, source leg / canonical
Quote-leaf / tier identifiers, `actual_freight_cost numeric(12,2)`, and the
effective units required to reproduce per-unit math. Unique the three source
identifiers within a snapshot. Source identifiers are evidence, not cascading
foreign keys to mutable draft rows.

Snapshot, commercial pin, and component freight snapshot rows are written in
the existing customer-send transaction. Historical reads use the snapshot cost,
pinned Quote markup, and captured effective units; they never consult live firm
defaults or revised draft rows.

### Derived value

Billable freight is never persisted as commercial authority:

`actual_freight_cost × (1 + quotes.freight_markup_pct) ÷ effective_units`

Sent history uses the equivalent pinned/snapshotted inputs. Existing precision
and rounding boundaries remain authoritative.

---

## Migration Preflight

**Read-only result (2026-08-03): PASS.** The configured database contained 21
freight legs across 9 Quotes. Zero Quotes contained more than one distinct
`freight_legs.freight_markup_pct`; affected sanitized Quote identifiers: none.

The controlled migration may therefore promote each Quote's common leg value
without choosing among divergent commercial values. This result authorizes
planning only; migration still reports its source counts and proposed writes
before applying them.

---

## Controlled Migration Plan

1. Add the firm default, Quote markup, component-cost table, snapshot table, pin
   column, uniqueness, numeric checks, and same-Quote enforcement.
2. Re-run and archive the divergent-markup report immediately before writes.
   Abort on any divergence or count drift requiring review.
3. Report the proposed Quote markup writes. For each Quote with legs, copy its
   single common leg markup to `quotes.freight_markup_pct`.
4. Initialize the new firm default explicitly from the currently approved
   freight default; do not embed a costing fallback.
5. Preserve legacy sent Quotes on their historical calculation path. Do not
   infer component costs from `freight_leg_tiers.total_freight`.
6. Existing drafts convert explicitly: component entry and legacy Quote total
   are mutually exclusive for the same leg/tier. The conversion clears the
   legacy total only through a governed transaction after operator confirmation.
7. Wire Quote-owned reads, writes, pinning, snapshotting, clone and revision
   behavior. Verify no production consumer reads or writes leg markup.
8. Drop `freight_legs.freight_markup_pct` and its application inputs in the same
   controlled release. No deprecated shadow column remains.

Clone copies the Quote markup, remaps leg / canonical Quote-leaf / tier component
cost rows to the clone, and remains unpinned until its own send. Revision retains
prior snapshot rows and pin, copies their live working values into the new draft
revision, and writes a new immutable set on its next send.

---

## Implementation Plan

1. Run the read-only divergent leg-markup preflight. Stop if any Quote contains
   more than one leg markup value.
2. Add permanent regression coverage for Packaging row ownership, non-first-SKU
   `Add line` targeting, control parity, and single-SKU non-regression.
3. Adjust Packaging presentation so each existing SKU row has an unambiguous
   owner and its `Add line` action targets that row's governed leaf. Preserve all
   current Packaging controls and persistence behavior.
4. Remove only the Bulk Raw operator surface in a separately reviewable change;
   preserve its tables, adapters, and zero-valued costing term.
5. Add component freight persistence and fail-closed canonical identity guards.
6. Migrate the common legacy leg markup to the Quote authority, extend the
   Phase 1 pin/snapshot, then remove the leg markup column and all consumers.
7. Add component/tier Freight inputs and the single header markup control; update
   costing to derive billable freight without persisting it.
8. Run costing, lifecycle, customer/PDF, NetSuite arithmetic, Production, Freight,
   and 1 / 5–7 / 10-SKU non-regression checks, then stop for operator validation.

No implementation step may modify Production, duty/tariff behavior,
customer/PDF freight-line projection, Pricing Workspace, or Margin Approval.

---

## Repository Dependencies

| Component | Dependency |
|---|---|
| Costs page route and section components | Existing host and data loading; preserve |
| Packaging section + line-group components | Explicit row-to-SKU association and correct `Add line` target for each existing SKU row |
| Production section | **Untouched**; already renders the complete assembly/leaf tree |
| Freight section | One Quote-level section; add component/tier cost grid and one header markup control |
| `assembly_leaf_inputs` | Existing Packaging persistence key; preserve |
| `assembly_production_inputs` | Existing Production persistence; untouched |
| New component freight table | Actual cost keyed by freight leg, canonical Quote leaf and tier |
| Quote commercial authority + Phase 1 pin | One freight markup value; immutable at sent revision |
| `freight_leg_tiers`, freight legs and groups | Legacy total compatibility during controlled migration; remove leg markup authority |
| Section total computation | Preserve without arithmetic or meaning changes |
| Bulk Raw workspace components | removed from the operator surface |
| Bulk Raw tables and adapter path | **untouched** |

**Slice-1 note:** packaging inputs key on `assembly_leaves.id`; the canonical
attachment identity is `quote_leaves.id`. **Phase 2 renders existing rows and
should not need to choose between them** — if the SKU dimension cannot be
derived without picking one, that is a finding. **Stop and report.**

---

## Rollout Risk

| Risk | Severity | Mitigation |
|---|---|---|
| `Add line` targets the wrong SKU | **High** | Targeted multi-SKU persistence tests on non-first rows |
| Row ownership is visually ambiguous | **High** | Make the existing row-to-SKU association explicit without adding navigation |
| Divergent legacy leg markups lose commercial intent | **High** | Mandatory read-only preflight; stop for disposition if any exist |
| Component freight crosses Quote identity | **High** | Canonical FK, same-Quote enforcement, fail-closed tests |
| Legacy total and component costs double count | **High** | Mutually exclusive modes per leg/tier; reject mixed state |
| Live defaults overwrite Quote markup | **High** | Quote-owned value plus Phase 1 pin/snapshot regression |
| An input is dropped in the extension | **High** | Input inventory before and after; see Verification |
| Section totals silently change meaning | Medium | Explicit before/after comparison |
| Page length unusable at 10 SKUs | Medium | Structural read question 5; collapse only if it hides nothing pending |
| Render cost at 10 SKUs × 4 tiers | Medium | Measure before optimising |
| Bulk Raw removal breaks a shared component | Low | Plumbing preserved; removal is surface-only |
| Collapse reintroduced as switching | **High** | See stop conditions |

**The highest risk is silent input loss.** A section that renders all SKUs but
drops the pricing-source selector, or the inventory flag, or a markup field,
looks correct and is not. **The verification below exists for this.**

---

## 1 · Harness Invariants

**Permanent automated protections.**

**H1 · Packaging control parity.** Every editable Packaging control that exists
today remains available for every existing SKU row. This is enumerated, not
sampled.

**H2 · No SKU switching introduced.** Packaging continues to render all existing
SKU rows together. No selector, pagination or switching control is added.

**H3 · Packaging ownership and targeting persist.** Add a line and edit values
on the second, fifth and seventh SKU. Each row is created for, displayed under,
and remains associated with the intended SKU after reload.

**H4 · Freight identity and cardinality.** A component cost resolves through
canonical `quote_leaves.id`; duplicate, missing, cross-Quote and drifting leg /
leaf / tier relationships fail closed. One component may participate in
multiple legs.

**H5 · Section totals unchanged in meaning.** Same Quote, before and after: each
section header's per-tier totals are the same numbers.

**H6 · Costing output byte-identical.** This phase renders; it does not compute.
`requiredSellPerUnit` for an unchanged Quote is identical before and after.

**H7 · A single-SKU Quote is unchanged.** The majority case acquires no
multi-SKU chrome.

**H8 · Bulk Raw's operator surface is unreachable.** No route renders it.

**H9 · Freight authority.** The Quote has exactly one authoritative freight
markup. No production read or write remains for leg-level freight markup after
migration, and live firm-default movement cannot change an established Quote.

**H10 · Freight completeness and math.** Null component cost is valid in draft,
but customer send and NetSuite completion reject unresolved required cost.
Billable freight is derived—never persisted—using the Quote markup and existing
effective-unit and rounding contracts. Legacy totals and component rows cannot
both contribute for the same leg/tier.

**H11 · Historical reproducibility.** Sent revision snapshots preserve the
entered component costs and Quote freight markup. Clone and revision remap or
copy the commercial inputs without sharing source identities.

**H12 · Quote-markup movement.** Changing the draft Quote freight markup updates
every derived billable freight value while preserving every manually entered
actual freight cost byte-for-byte.

---

## 2 · Rehearsal Procedures

**Controlled operational proofs at a named gate.**

### R1 · The structural read — complete and approved

**Gate result:** passed before implementation.

The repository establishes that Packaging already renders all existing SKU
rows in one flat table; only creation is constrained by first-leaf targeting.
Production already renders the complete assembly/leaf tree and is out of scope.
Freight renders once at Quote level. Its legacy persistence has one leg/tier
total and one markup per leg; the approved amendment replaces those commercial
assumptions with manually entered component costs and one Quote markup while
leaving duty/tariff and customer/PDF projection unchanged.

### R2 · Production-shaped SKU range

**Gate:** before operator validation.

**Repository evidence shows real Quotes at 5–7 SKUs.** The earlier 2–3 estimate
was wrong and the fixture range follows the evidence.

Exercise the page at **one SKU · five to seven SKUs · ten SKUs**.

**Record:** render timing at each, page length at each, and confirmation that
every input is reachable and editable at each.

**Stop condition:** ten SKUs unusable and the only remedy is a control that
hides pending entry points. **That is switching under another name — report
rather than build it.**

### R3 · Customer projection unchanged

**Gate:** before deploy.

The reachable production resolver emits an empty Freight line collection for
Customer View and PDF. **This phase must not change that.** Generate the same
customer PDF before and after and compare it.

**Record:** both PDFs, and a statement of what differs. **Expected: nothing.**

---

## 3 · Regression Requirements

- **Every existing costing test passes unchanged.** This phase computes nothing.
- Customer view and PDF output identical for an unchanged Quote
- NetSuite payload arithmetic unchanged
- The four lifecycle guards still reject commercial writes at sent and accepted
- Existing Costs browser scenarios pass, with additions limited to Packaging
  row association, non-first-SKU `Add line` targeting, and the approved Freight
  component-cost/header-markup workflow
- **Production section behaviour unchanged** — it is a preservation surface,
  not a target

**Explicit non-regression:** a single-SKU Quote looks and behaves **exactly as
it does today.**

---

## 4 · Operator Validation Checklist

**Edward, before Phase 3 begins. This is the phase he has been waiting on.**

- [ ] Open a **single-SKU** Quote. **Indistinguishable from today.**
- [ ] Open a **five-to-seven-SKU** Quote — the production range. Every SKU's
      packaging visible without switching.
- [ ] Use `Add line` on the fourth SKU. The new row appears under that SKU and
      remains there after reload.
- [ ] Exercise the existing Packaging controls on a non-first SKU. They remain
      clear, usable and associated with that SKU.
- [ ] Confirm Freight still appears once and reads unambiguously as Quote-level.
- [ ] Enter different actual freight costs for multiple components on one leg.
- [ ] Apply separate air and ocean legs to one component and confirm both appear.
- [ ] Confirm the shared freight markup appears once in the section header and
      each row clearly shows actual cost, shared rate, and derived billable cost.
- [ ] Confirm Production looks and behaves as it did before this phase.
- [ ] Confirm section totals match what they showed before.
- [ ] Confirm Bulk Raw's operator surface is gone.
- [ ] Open a **ten-SKU** Quote. Usable.
- [ ] **Confirm no control anywhere switches SKU.**

**The judgement is not "does it render."** It is:

- Does each owner have **one region** to work in, or are they hunting?
- Does the majority case feel **light**, or does it carry chrome it doesn't need?
- At five to seven SKUs, is anything **harder** than it was?

**Stop if any check fails.** Do not proceed to Phase 3.

---

## 5 · Release Evidence Required

| Artifact | Content |
|---|---|
| **Harness results** | H1–H12, named |
| **Input inventory** | Before/after enumeration per section — the primary evidence |
| **Structural read** | Approved report covering rendering, ownership and single-SKU assumptions |
| **Freight migration preflight** | Divergent-markup count and sanitized Quote identifiers before writes |
| **Freight identity proof** | Canonical grain, same-Quote enforcement, multi-leg component proof |
| **Freight authority proof** | One Quote markup, no leg shadow authority, default-movement result |
| **Freight snapshot proof** | Atomic component-cost and Quote-markup preservation per sent revision |
| **SKU-range timings** | R2's render timing and page length at 1 / 5–7 / 10 |
| **Customer PDF comparison** | R3's before/after, with differences stated |
| **Costing non-regression** | `requiredSellPerUnit` identical, sampled |
| **Single-SKU proof** | Screenshots before and after |
| **Rollback proof** | Confirmation that no schema, data or arithmetic changed |
| **Operator sign-off** | Edward's completed checklist |


## Explicit Stop Conditions

**Stop and report. Do not proceed, do not work around.**

1. **The migration preflight finds divergent leg markup values within a Quote.**
   Stop; selecting the Quote-level authority requires business disposition.
2. **The SKU dimension cannot be derived without choosing between
   `assembly_leaves.id` and `quote_leaves.id`.** That is a Slice-1 decision, not
   a Phase 2 one.
3. **An input cannot be preserved** in the extension. Report which and why —
   **do not drop it and do not substitute a computed value for an editable one.**
4. **Section totals change meaning** and it is not obvious which is correct.
5. **Ten SKUs is unusable** and the only remedy is a control that hides pending
   entry points. **That is switching under another name.** Report rather than
   build it.
6. **The governed Packaging action cannot target every existing cost-bearing
   leaf without changing identity or persistence architecture.** Stop rather
   than inventing a second attachment model.
7. **Component Freight cannot enforce same-Quote leg, canonical leaf and tier
   ownership.** Do not rely on UI filtering.
8. **A leg-level freight markup production reader or writer would remain after
   migration.** Do not ship two commercial authorities.

---

## Open Questions

### A · Does collapse have a place here?

The set-aside design proposed collapsing completed sections. **Edward's
constraint permits collapsing what is complete and prohibits hiding what is
pending.**

**But collapse is not required by this phase**, and adding it means designing a
completeness rule the production page does not have. **Recommend deferring
unless ten SKUs proves unusable without it** — and if it does, that is a
stop condition, not an implementation choice.

### B · Should Bulk Raw removal ship separately?

**Resolved: yes, as a separately reviewable Phase 2 commit.** It remains inside
the approved Phase 2 boundary, while its plumbing and adapter path stay intact.

---

## What "done" looks like

> A PM opens a three-SKU Quote. Packaging shows all three, editable, with every
> control it has today. `Add line` creates the row for the SKU where it was
> pressed, and that association survives reload. Production remains unchanged.
> Freight remains one Quote-level section: Logistics enters actual cost by
> component and tier beneath a leg, the shared Quote markup appears once, and
> billable freight is derived visibly. One component can participate in both air
> and ocean legs. Sent history remains stable when firm defaults move. Duty,
> tariff and customer/PDF projection do not change. Bulk Raw is absent from the
> operator surface. A single-SKU Quote remains familiar.
