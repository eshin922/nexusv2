# CD Quote Workflow Recalibration — Phase A.1 Brief

## Product specs + audit log export

**Slice context:** v1 release-critical path, Phase A.1 round after Phase A (Quote umbrella sub-tabs) shipped
**Slice type:** Feature scope expansion — product specs IA shift (deal-level → leaf-level with library reuse) + ASY/LEAF distinction + type-aware spec entry across 3 surfaces + Quote PDF addendum + re-quote workflow + audit log export
**Trigger:** Edward promoted Aisha 1:1 backlog item ("Product specs storage + Quote PDF toggle") from v1.1 → v1 critical path after Phase A design started. This round adds the scope CD didn't have at Phase A brief-time.
**Status:** New design round; CD authorized to kick off

---

## 1. Background — why this round now

### What changed since Phase A

When CD started the Quote workflow redesign (Phase A), the scope was:
- Pricing surface placement in new IA
- Quote umbrella 4 sub-tabs (Preview / Send / Mark Accepted / Tier Selection)
- Workflow transitions

After Phase A started, two things happened:

1. **Aisha 1:1 surfaced product specs as a real PM pain.** PMs need spec data on quote PDFs as an optional addendum. Originally banked as v1.1 backlog ("Product specs storage + Quote PDF toggle").

2. **Edward promoted specs to v1 critical path.** Rationale: specs are operationally integral to DPS; the Quote workflow is being redesigned now; designing specs separately later means retrofit work. The IA shift implied (deal-level → product-level specs, industry-standard) is significant enough that doing it half-done at v1 would create migration debt for every quote produced in the gap.

This recalibration round adds the specs work CD didn't have when designing Phase A. **Phase A's work doesn't get redesigned** — it ships as designed, with this round layering the specs feature on top.

### Acknowledgment

Phase A landed strong. The full PDF render in every Preview/Send/Mark Accepted state, the persistent quote panel pattern, the dedicated Completed sub-tab with audit timeline, the below-target confirmation modal, the NetSuite push three-state pattern — all clean execution against the brief + first-round patches. The pushbacks CD raised (hybrid advancement, NetSuite retry compound modes, skipped-step warning strength) are correctly categorized for v1.1 follow-up.

This recalibration adds new scope, not corrections.

## 2. Scope of this round

**In scope:**

1. Product specs IA shift — deal-level → product-level data model
2. Per-SKU spec entry surface (Primary Packaging + Secondary Packaging panels)
3. Quote PDF addendum design (toggle + page layout + spec rendering)
4. Re-quote workflow when specs change after send
5. Add Product modal updates (Continue-to-specs two-step flow + HubSpot pull semantics)
6. Audit log discipline for spec changes
7. Audit log export capability (defensibility "exportable evidence")
8. Soft gate at Preview Quote for incomplete specs
9. RLS / authorized PM users for spec editing

**Out of scope (deferred to separate work):**

- Phase B: Pricing component repositioning (LinesRequiringReview / VerdictBand retire; CostStackHeader / SkuSummaryRowList move to Costs; PerTierOverrideCard stays). Designer notes Phase B addendum has the disposition; brief lands as separate round.
- HubSpot deal-level → product-level spec migration (v1.1 per Edward Q2 disposition; data reconciliation is its own effort)
- Executive approval gating for spec changes affecting active quotes (v1.5+ per Aisha 1:1 backlog)
- Tamper-evident audit log signing (v2 if ever; not v1)
- Scheduled send on Send sub-tab (Phase A carried this forward as backlog)

## 3. Product specs IA shift — ASY/LEAF model with library

### The structural distinction (load-bearing concept)

The tool's cost-stack tree has two node types:

- **ASY (assembly):** the quotable product/SKU (e.g., "Hydra-Glow Vitamin C Serum 30ml"). Carries commercial fields — unit price, margin, markup, tax schedule, owner, FSC claim/status, supplier verified. Appears as a line item on the Quote PDF. ASYs have a **Product Type for categorization** (Skincare / Supplement / etc. — separate concept from leaf types). ASYs do NOT carry spec data.
- **LEAF:** the reusable component nested under ASYs (e.g., "30ml Glass Dropper Bottle - Type III soda-lime"). Carries identity fields, **Product Type for spec rendering** (Primary packaging / Secondary packaging / Soft goods / etc.), and spec values per its type's field schema. LEAFs are **globally reusable across all scenarios** in the tool (library model).

**Specs live ONLY on leaves.** Assemblies aggregate; leaves carry. This is the load-bearing distinction CD's first iteration missed.

### Current state (problem)

Specs in HubSpot currently live at the **deal level** — meaning each quote/deal has its own copy of spec data. This creates:

- **Duplication.** Same component shows up across deals; specs re-entered each time.
- **Drift.** Component specs evolve; old deals capture stale specs.
- **No reuse.** When a new quote uses the same component, spec entry starts from scratch.
- **No replenishment continuity.** PMs can't verify "is the glass bottle in this new quote the same as the one we shipped last quarter?" without manual cross-reference.

### Target state — library of reusable LEAFs

Each LEAF is a library item with its own:
- Canonical identity (name, SKU, URL, image)
- Product Type (drives spec rendering)
- Spec values (per its type's schema)
- Version history (specs evolve over time; quotes pin at send)
- Reference count (how many ASYs across how many scenarios use this leaf)

Leaves are globally reusable. PMs building an ASY can:
1. Add an existing library leaf (browse / search / paste reference)
2. Create a new leaf (Add Product modal → LEAF mode)
3. Edit a leaf's specs (updates the library record; cascades to unsent quotes; sent quotes stay pinned)

This makes the tool an operational system of record for component continuity — not just a quoting tool.

### Replenishment workflow — the motivating use case

When PM re-quotes a product months later, they pull up the ASY's leaf composition and verify the canonical leaf specs. Same glass bottle = same Type III soda-lime, same Verre Pacific factory, same packout details. This is **continuity verification** — confidence that what was quoted before still represents the same physical components, suppliers, and packaging configuration.

If specs have changed (factory swap, material substitution, regulatory update), the leaf's version history surfaces the change. Old quotes retain their pinned version (Q4 disposition); new quotes auto-pin the current version.

### HubSpot phase-out trajectory (Edward Q1 disposition)

Per Edward Q1 disposition: **phase out HubSpot deal-level specs.** Our DB becomes source of truth for leaf specs going forward. HubSpot stays for CRM (contacts, deals at the relationship layer) but no longer carries spec data.

The tool becomes the operational system of record for product/manufacturing data; HubSpot becomes CRM-only.

### Migration (Edward Q2 disposition — v1.1 deferred)

Existing deal-level spec data in HubSpot doesn't cleanly map to leaves (Edward called this out — "big data reconciliation effort"). Migration of historical data deferred to v1.1. **v1 ships with empty `leaf_specs` going forward; PMs enter specs as needed; historical specs in HubSpot stay there for reference until v1.1 reconciliation.**


## 4. Spec entry — leaf-only, library, type-aware

Per the ASY/LEAF distinction in §3: **spec entry happens at the LEAF level only.** ASYs aggregate completeness; they don't carry spec data. Leaves are globally reusable library items with their own type-aware field schemas, version history, and per-quote pinning.

### 4.1 Three entry points for leaf spec management

**Entry point 1: Leaf context menu on Setup > SKUs page (tree view).**

The Setup > SKUs page shows the scenario's cost-stack tree — ASYs with their nested LEAFs. The existing leaf context menu (Move up / Move down / Delete cascade / Assign to parent) gains a new **Edit specs** option. PM clicks the leaf's context menu, selects Edit specs, and the leaf-spec entry surface opens.

ASY rows do NOT show Edit specs — ASYs don't carry spec data. ASY context menus retain their existing actions (Edit product / Duplicate / etc.) but Edit specs is leaf-only.

**Entry point 2: Add Product modal in LEAF mode.**

The Add Product modal gets an ASY/LEAF mode toggle (see §7 for full modal design). In LEAF mode, the modal surfaces Product Type + identity fields + a "Continue to specs →" CTA. Specs can be entered inline or deferred ("Add leaf · specs empty" alternate CTA).

When PM creates a new library leaf via this flow, the leaf becomes available across all scenarios going forward.

**Entry point 3: SKUs page browse + library access.**

The SKUs page on Setup also serves as the entry surface for browsing library leaves. PMs see:
- The active scenario's tree (ASYs with their child leaves)
- An affordance to browse the global leaf library (search, filter by type, reference an existing leaf)
- Per-leaf completeness chips visible at a glance

When PM wants to add an existing library leaf to an ASY in this scenario, they reference it from the library (creates an `assembly_leaves` association — no new leaf created).

### 4.2 Type-aware field rendering per leaf

Edit specs reads the leaf's **Product Type** and renders the appropriate field set. Type taxonomy lives on the leaf-level Product Type (distinct from ASY-level categorization Product Type — see §3 for the distinction).

**Starting leaf-type taxonomy (Edward confirms exact list before CD finalizes):**

| Leaf Product Type | Field set |
|---|---|
| Primary packaging | PP Description, PP Component Type, PP Quantities, PP Size, PP Material, PP Deco, PP Additional Details, PP Factory 1, PP Factory 2, PP Packout Details |
| Secondary packaging | SP Description, SP Material, SP Size, SP Color, SP Coating, SP Finishing, SP Quantities, SP Additional Details, SP Factory 1, SP Factory 2, SP Packout Details |
| Soft goods | TBD — Edward provides field list iteratively |
| Tertiary packaging | TBD — Edward provides field list iteratively (master cartons, pallets) |
| Component / part | TBD — Edward provides field list iteratively |
| Assembly sub-component | TBD — Edward provides field list iteratively |
| Service / labor | TBD — Edward provides field list iteratively (or may not need specs at all) |
| Other | TBD — Edward provides field list iteratively (or fallback to free-text notes) |

**CD designs the rendering pattern, not the field lists.** Field definitions per type are Edward-owned content; CD's prototype demonstrates the type-aware rendering using PP + SP as the worked examples (those field lists are known). Remaining types render with placeholder "Soft goods specs — fields TBD" treatment until Edward provides field lists.

### 4.3 Empty product type — Edit specs prompts type-picker first

If PM clicks Edit specs on a leaf that has no Product Type set (legacy data, or leaf created without type), the surface shows a **"Set product type first"** empty state with an inline type-picker. Once PM selects a type, the appropriate field set renders.

### 4.4 Completeness — per-leaf with ASY rollup

PMs need to see at a glance which leaves and which ASYs have complete specs vs. pending. CD designs:

- **Per-leaf completeness chip** on the SKUs page tree — `✓ Complete` / `⚠ N fields pending` / `— No specs entered` / `— No type set`
- **Per-ASY rollup chip** — aggregates child-leaf completeness (`✓ All complete` / `⚠ 2 of 4 leaves pending` / `— No leaves added`)
- **Aggregate quote-level completeness** — Quote umbrella > Preview Quote surface shows "N of M leaves complete across all ASYs"

Completeness is computed against the leaf's type-aware field set. A soft goods leaf with all soft-goods fields filled is `✓ Complete` regardless of whether other types' fields apply (they don't).

The completeness state drives the soft gate on Preview Quote (§9 below).

### 4.5 Library scope — globally reusable across scenarios

Per Edward disposition: **leaves are globally reusable across all scenarios in the tool.** Implications:

- A leaf created in Scenario A is available for use in Scenario B, C, D, etc.
- The leaf's library record (identity + specs + version history) is canonical across the tool
- ASYs in different scenarios reference the same leaf via `assembly_leaves` association
- Spec edits to a leaf cascade to all referencing ASYs (with versioning per §4.6)

**Surfacing library scope to PMs:**

- Leaf header shows reference count: "Used in 3 ASYs across 2 scenarios" (or similar copy)
- Leaf edit warning when leaf is widely-referenced: "This leaf is used in 3 active quotes across 2 scenarios. Editing specs will affect all of them. Sent quotes stay pinned to their version; unsent quotes will update."
- Library browse affordance on SKUs page (search by name, SKU, type, factory)

### 4.6 Spec versioning cascade — unsent updates, sent pins

Per Edward disposition + Q4 + Q6 (Hybrid):

- **Sent quotes pin spec version at send time.** When a quote is sent, each leaf in the quote pins its current `leaf_spec_version`. Future spec changes to that leaf do NOT update the sent quote.
- **Unsent quotes auto-update.** Drafts and in-progress quotes reference the leaf's current version. When a leaf's specs change, unsent quotes reflect the new specs automatically. (Optimistic-update / autosave pattern handles UI surfacing — Pattern 47 applies.)
- **Field-level audit events** per Q6 capture each spec change with `who/when/what`.
- **Version-number bumps at quote-pin events**, not at every field edit. Multiple edits between pins stay on the same version; version_number increments when a quote pins.

This gives PMs continuity (leaf is canonical; specs evolve in one place) plus quote integrity (sent quotes are immutable; customers see what they signed for).

### 4.7 Replenishment verification surface

The library model unlocks the replenishment workflow. When PM re-quotes an ASY months later, they need to verify "is this the same component as before?"

**Version-stamp callout per leaf row in Preview Quote (CA lean iii):**

Each leaf in the active quote's Preview surface shows a small version-stamp callout:
- `v4 · unchanged since QU-2024-0142` — same version as last quoted; PMs see continuity at a glance
- `v5 · changed since QU-2024-0142 (was v4)` — version bumped since last quoted; PM can hover/click for diff

The callout is informational — non-blocking. PMs decide whether to act on the change. Explicit side-by-side diff (option ii) deferred to v1.5+ if real demand surfaces.

### 4.8 Existing leaves treatment (legacy data)

PMs will have existing leaves in the tool from before this feature ships. Treatment per Q-Type4 disposition:

- **(i) Specs default empty.** Edit specs on existing leaves surfaces empty spec panels (or type-picker if no Product Type set). PMs fill in as needed.
- **(ii) Soft gate prompts at first quote send.** When PM tries to send a quote with leaves that have no specs, the soft gate fires (already in §9); PMs fill at that point.
- **(iii) No bulk migration in v1.** Historical data reconciliation is v1.1 work (Q2 disposition).

### 4.9 Visual layout for spec panels

CD's design call. The Aisha screenshots showed the existing 4-column grid layout for PP and SP. Whether to preserve, expand, or reshape — design exploration. The chrome conventions (card layouts, accent borders, mono captions for field labels per R7b grammar) inform the redesign.

Type-aware field count varies — PP has 10 fields, SP has 11 fields, soft goods may have more or fewer. Layout accommodates variable field counts gracefully (responsive grid, not fixed 4-column).

### 4.10 Edge cases to address

- **Product Type change on a leaf with existing specs.** Per CA lean: discard prior values with confirmation modal — "Changing Product Type clears existing spec values. Confirm." Type change is rare; cleanest behavior.
- **First spec entry for a new leaf** — empty state guidance per Product Type (e.g., "Enter primary packaging specifications for this leaf").
- **Editing widely-referenced leaf specs.** Surface the cascade warning per §4.5: "This leaf is used in N ASYs across M scenarios. Sent quotes stay pinned; unsent quotes will update." PM confirms before save.
- **Multiple PMs editing same leaf specs** — conflict resolution; existing optimistic-update pattern carries forward (Pattern 47 from autosave sweep).
- **Spec fields with structured values** (e.g., dimensions as `2.047" x 4.488"`) — structured input or free text? CD calls; suggest free-text for v1 with regex hint for known structures.
- **Leaf deletion when referenced by active quotes** — hard prevention (can't delete a leaf that's in any active or sent quote); soft archive instead.



## 5. Quote PDF addendum design

### Disposition recap (Edward call)

Specs render as a separate addendum page at the end of the Quote PDF, NOT inline in the pricing table. Reasoning (CA analysis Edward approved):

- Pricing table integrity preserved (no clutter)
- Spec completeness varies (many "--" fields in early-stage quotes look incomplete inline; addendum can render "specs pending" cleanly)
- Customer use case differentiation (pricing first, specs verification second)
- PDF layout breathing room (spec data is dense; addendum gets full page)

Inline 1-line product descriptor already exists in Phase A design (e.g., "30ml glass dropper, screw cap" under each product) — that's the inline hint; addendum is the full detail.

### Toggle UI

**Where does the toggle live?** Most likely Preview Quote sub-tab as an affordance — PM decides per-quote whether to include the addendum. Options for CD to explore:

- **(a) Toggle in Preview Quote action panel.** PM ticks "Include spec addendum" alongside the "Looks good" CTA. Clear placement; visible at the moment of pre-send review.
- **(b) Toggle per-product on Setup.** PMs indicate which products include specs at the product level; quote PDF auto-renders addendum for those products. More granular but harder to surface intent at quote-send time.
- **(c) Hybrid.** Per-product default toggle + per-quote override. Most flexible; most complex.

**CA lean: (a) per-quote toggle in Preview Quote action panel.** Simple, explicit, decision lives at the moment that matters (sending the quote). (b) and (c) add granularity that PMs may not need; promote to v1.5+ if real need surfaces.

### Addendum page layout

CD designs the addendum page following the Quote PDF design language (paper background, Newsreader display for headers, mono for field labels). Content per product:

- Product header (SKU + product name)
- Primary Packaging panel (all PP fields with values; "--" for empty fields)
- Secondary Packaging panel (all SP fields with values; "--" for empty fields)
- Factory references (PP Factory 1/2 + SP Factory 1/2)

For multi-product quotes, each product gets its own block; pagination handles the rest. Page footer matches Phase A pattern (`Page N of M` becomes meaningful with addendum on).

**Empty-spec handling:** When a product's specs are mostly empty, render the panels with "--" values (don't suppress the panels). Edge case: ALL specs across all products empty — the toggle could surface "No spec data — addendum will not render" preview state. CD calls.

### "What the customer sees" preview update

Phase A's "Customer view · matches what the PDF will render" panel shows the rendered PDF. With addendum on, the preview shows page 1 (pricing) and page 2+ (specs) — likely scrollable or tabbed. CD designs.

## 6. Re-quote workflow when specs change

### The operational reality (Edward + Aisha)

> "Sometimes quotes are accepted, then specs changed and need to be repriced or resent."

This is a common DPS workflow:
1. PM quotes product with current specs
2. Customer accepts (potentially using the spec addendum to verify)
3. Product spec changes (factory swap, material substitution, regulatory update, etc.)
4. Quote needs to be regenerated with updated specs and re-sent for customer re-acceptance

### Versioning model (Edward Q4 disposition)

**Quote captures spec version at send time.** The quote PDF reflects what was actually sent — historical accuracy preserved. When specs change AFTER send, the quote's pinned spec version remains intact (audit trail), but the QUOTE is now out of sync with current product reality.

Re-quote = new quote_id, predecessor link to the original quote, references current spec version. Old quote stays in audit history with its pinned spec version.

### Design surfaces needed

CD designs three integration points:

#### 6.1 Spec-change awareness on active quotes

When PM edits a spec for a SKU that's used in active (sent, not-yet-completed) quotes:

- **Warning surface at spec edit time** — "This SKU is used in N active quotes. Saving will not affect those quotes (they remain at the prior spec version), but you may want to re-quote affected customers."
- **Affected quotes list** — show the active quotes that use this SKU; click-through to each
- **No automatic re-quote** — PM decides whether to re-quote each affected case; this is a workflow decision, not automation

#### 6.2 Out-of-sync indicator on quote workflow

For quotes that have been sent but whose pinned spec version is now older than the current product spec:

- **Surface on Send to Client / Mark Accepted / Tier Selection sub-tabs** — small callout "Specs have changed since this quote was sent. Consider re-quoting." with affordance to inspect the diff or initiate re-quote.
- **Audit trail still references the pinned spec version** — out-of-sync is informational, not retroactive

#### 6.3 "Create new quote with updated specs" affordance

When PM decides to re-quote:

- **Trigger surface** — accessible from the affected quote (probably Send to Client or Mark Accepted sub-tabs)
- **What it does** — duplicates the quote with current spec version, creates new quote_id, predecessor link to original
- **What PM does next** — review pricing (specs change may imply cost change → pricing may need update), preview, send

**CA lean for re-quote scope (calibration 1 from prior conversation):** **Full duplicate-and-edit** as the primary path. PM gets the new quote with current specs and can modify pricing if needed. Treats spec change as a "verify pricing assumption" trigger rather than a fast-path swap. Confirms the operational realism Edward described.

The fast-path "spec swap only, pricing unchanged" option is rejected as primary — spec changes often imply cost changes; treating them as cost-blind is risky.

### Original quote status

When a new quote is created via re-quote:

- **Original stays in audit history** with its pinned spec version
- **Status indicator** — "Superseded by [new quote_id]" — appears on the original quote's Quote umbrella surface
- **No automatic cancellation** — superseded quotes don't auto-cancel; PM decides what to do (could be the customer accepts the new one and the old becomes stale; could be the customer rejects the new one and the old returns to active)

CD designs the visual treatment for superseded status (lock icon? muted color? explicit banner?).

## 7. Add Product modal — ASY/LEAF mode toggle

The Add Product modal gets a mode toggle at the top: **`Create as: [ASY] [LEAF]`**. The toggle determines what gets created and which fields render. PM picks mode based on what they're adding.

### Why the toggle

Per Edward's clarification: PMs use Add Product to create either a quotable product/SKU (ASY) or a reusable component (LEAF). Both are valid creation flows; the modal handles both via mode toggle.

This unlocks the **replenishment workflow** (§3, §4.7): when PM later re-quotes a product, they pull up its leaves and verify canonical specs. The Add Product modal feeds the leaf library with reusable components that have canonical specs traveling with them.

### ASY mode — quotable product

When ASY is selected, the modal renders commercial fields. **No spec entry at ASY level** (specs live on leaves).

Fields:
- **Name** * (e.g., "Hydra-Glow Vitamin C Serum 30ml")
- **Product Type** * — ASY-level categorization (Skincare / Supplement / Capsule / etc.). Distinct from leaf-level Product Type. Used for filtering / sorting; doesn't drive spec rendering.
- Description
- SKU, URL
- **Unit Price** *, Unit Cost
- Margin (computed display)
- Markup
- Tax Schedule
- Owner, Image URL
- FSC Claim, FSC Status, Supplier Verified

Single-step modal. CTA: `Add product`. PM creates ASY; leaves are added separately (via the SKUs page tree affordances or via leaf-mode Add Product flow).

### LEAF mode — reusable library component

When LEAF is selected, the modal renders component-identity fields + leaf-level Product Type + spec entry.

Fields:
- **Name** * (e.g., "30ml Glass Dropper Bottle - Type III soda-lime")
- **Product Type** * — leaf-level type (Primary packaging / Secondary packaging / Soft goods / etc.). Drives spec rendering.
- SKU, URL
- Unit Cost — component cost (contributes to ASY cost stack)
- Owner, Image URL
- FSC Claim, FSC Status, Supplier Verified

Note: ASY-level commercial fields (Unit Price, Margin, Markup, Tax Schedule) do NOT appear in LEAF mode — those are quote-line concerns at the ASY level.

**Step 2 (conditional):** When leaf-level Product Type is selected, CTA reads `Continue to specs →`. On click:

- **(b) Modal closes + Edit specs surface opens** (CA lean) — single canonical Edit specs surface for all entry points
- Alternative `Add leaf · specs empty` CTA defers spec entry — per Edward's "specs empty for now" allowance

PM can defer specs and fill in later via the leaf context menu on the SKUs page.

### Cross-scenario library scope (LEAF mode)

When PM creates a new LEAF, the leaf becomes a library item globally available across all scenarios in the tool. The modal should surface this:

- Header copy or sub-label: "Creating a reusable component. Available across all scenarios."
- After save, confirmation toast: "New leaf added to library. Used in: [current scenario]."

Optional: a "Library leaf already exists?" affordance — search the library before creating a duplicate. CA lean: defer to v1.5+ if duplicate creation becomes a real problem. v1 allows duplicates; PMs deduplicate manually.

### Existing library leaf — reference flow (not modal)

PMs adding an EXISTING library leaf to an ASY don't use this modal. Instead:
- SKUs page tree > Add leaf to ASY > Browse library > Select existing leaf → creates `assembly_leaves` association

The Add Product modal is for NEW creations only. Library reference is a separate affordance on the SKUs page.

### HubSpot pull semantics (post-phase-out per Q1)

The modal subtitle "Creates a new product in HubSpot and adds it to this scenario" — partial recalibration:

- **ASY mode:** Creates ASY in our DB; pushes to HubSpot (current contract). HubSpot stores ASY commercial-level info; not specs (no specs at ASY level).
- **LEAF mode:** Creates leaf in our DB (library item); push-to-HubSpot strategy TBD. Options: (a) leaves don't push to HubSpot (they're internal manufacturing data); (b) leaves push as HubSpot line-items under their parent ASYs. **CA lean: (a) leaves stay internal.** HubSpot phase-out + simpler architecture.

Confirm CA lean (or override).

### Visual surfaces CD designs

- Modal header with ASY/LEAF toggle
- ASY mode rendering (current commercial fields, no specs)
- LEAF mode rendering (identity + Product Type + step-2 spec entry trigger)
- Step 2 — type-aware spec entry (PP + SP as worked examples; placeholder for other types)
- "Defer specs" alternate CTA in LEAF mode
- Library scope copy + post-creation confirmation
- Existing-leaf reference flow on SKUs page (separate from Add Product modal)



## 8. Audit log export — defensibility evidence

### Edward Q4 disposition

> "Audit log here for defensibility is paramount (what changed, who changed, exportable evidence required)."

This is a legal/contractual capability. When DPS needs to produce evidence of what a customer received, when they accepted, and what changed afterward — the audit log captures it, and the export makes it shareable with legal, customers, or auditors.

### Scope (calibration 2 from prior conversation)

**CA lean: simple export — CSV download.** v1 ships:
- Trigger: PM-initiated export from a quote, product, or time range
- Format: CSV download with columns (timestamp, actor, action, target, before/after diff, audit_id)
- Filters: by quote, by product, by date range
- No cryptographic signing or tamper-evidence (v2 if ever)

Formal "evidence report" (formatted PDF with company header, signed by PM) is over-engineering for v1. v1.5+ can promote if a real legal-evidence use case emerges.

### Surfaces CD designs

#### 8.1 Export trigger on Quote umbrella

Per-quote export accessible from any Quote umbrella sub-tab (probably Completed makes most natural sense — the place PMs look when reviewing historical record). Affordance: "Export audit log" → opens scoping modal (which events? all? state-changes only? include spec changes? include push events?).

#### 8.2 Export trigger on product

Per-product export accessible from the Setup surface (or wherever spec entry lives per §4 placement decision). Surfaces the audit trail of spec changes for that product — useful when customer asks "what's the history of changes on this SKU."

#### 8.3 Export trigger globally (admin)

Time-range export accessible from a global affordance (settings? admin panel?). Used for audit-wide queries (e.g., "show me all quote state changes in Q4 2025"). v1 may defer this; v1.1 candidate. CD design call.

### Audit log entry shape (informs CC at impl)

Each audit_log row exported should carry:
- timestamp (ISO 8601)
- actor_type (system / user / external)
- actor_id (user_id or system reference)
- actor_name (denormalized for export readability)
- action (verb describing the change)
- target_type (quote / product / spec / etc.)
- target_id
- diff_json (before/after for state changes)
- diff_json.source (per Slice 9.2 namespace convention)
- caused_by_audit_id (for cascade audit pattern per Pricing reframe Disposition B)
- audit_id (the row's own ID for reference)

CD doesn't design schema, but the export UI should surface these fields in CSV columns. CA + Architect resolve schema at impl-brief time.

## 9. Soft gate at Preview Quote for incomplete specs

### Disposition (Edward Q3)

Soft gate at Preview Quote (PM awareness); no hard block at Tier Selection. PMs can send quotes with incomplete specs; they're warned.

### Surface design

When a quote contains SKUs with incomplete specs:

- **Soft warning on Preview Quote** — alongside the existing customer-info-gap and pricing-warning callouts. Similar visual register; non-blocking. Copy: "N SKUs have incomplete specifications. Spec addendum will render with missing fields shown as '--'. PM may proceed."
- **Per-SKU detail on hover/click** — which fields are missing per SKU
- **Affordance to fix inline** — quick-link back to Setup surface (or wherever specs are entered) to fill in fields before sending
- **No effect on "Looks good · advance to Send" CTA** — gate is informational only

### What about complete specs?

When all SKUs have complete specs, no surface; PM proceeds normally. The soft gate only fires when there's actually something to surface.

## 10. Authorized users for spec editing (Q5)

Edward disposition: only authorized users / PMs can edit specs.

### Pattern

Extends existing PM role pattern. RLS policies on `leaf_specs` table:
- Read: any authenticated user with quote/product visibility
- Write: PMs with explicit spec-edit permission (new permission flag on user role; existing role enums extend)

CD doesn't design schema or permissions, but spec-edit affordances on the entry surface need to be gated visually:
- For unauthorized users: spec panels are read-only; fields disabled; no edit affordance
- For authorized PMs: full edit access

### Surface treatment

When viewing specs as unauthorized user:
- Spec values render but inputs are disabled
- Edit-affordance area shows "Contact your administrator to enable spec editing" or similar muted copy
- No CTA visible

### Edge case: PM loses edit permission mid-session

Existing optimistic-update pattern should handle gracefully (write fails with permission error → revert + show denial). Impl concern; CD doesn't need to design.

## 11. Schema considerations

CD doesn't commit schema; just flag fields the design needs. CA + Architect resolve at impl-brief time.

**ASY/LEAF separation with library reuse + polymorphic specs.** ASYs and LEAFs are distinct entities. ASYs carry commercial fields; LEAFs carry identity + type + specs. LEAFs are globally reusable; many-to-many via `assembly_leaves`. Spec polymorphism handled via JSONB per Q-Type3 disposition.

### `product_types` table (taxonomy — shared by ASY and LEAF)

Two distinct taxonomies (or one taxonomy with a scope flag), since ASY-level Product Type (categorization) and leaf-level Product Type (spec rendering) are conceptually different.

**CA lean: single taxonomy with scope flag:**

```
product_types:
- id (uuid PK or text PK)
- name (text — display name)
- scope (enum: 'assembly' | 'leaf' — which entity uses this type)
- description (text — optional)
- field_schema (JSONB — defines fields, types, validation per type; only meaningful for scope='leaf')
- created_at, updated_at
```

ASY-scope types (Skincare / Supplement / etc.) have empty `field_schema` (no specs at ASY level). Leaf-scope types (Primary packaging / Secondary packaging / Soft goods / etc.) have populated `field_schema`.

Architect may prefer two separate tables (`assembly_types` + `leaf_types`) for clarity. Either works; CA lean is unified for simpler reference.

### `assemblies` table (ASY level)

```
assemblies:
- id (uuid PK)
- name (text)
- product_type_id (FK to product_types where scope='assembly')
- description, sku, url, image_url
- unit_price, unit_cost
- margin, markup
- tax_schedule_id, owner_id
- fsc_claim, fsc_status, supplier_verified
- scenario_id (FK to scenarios — current scope: ASY is per-scenario)
- created_at, updated_at
```

ASYs are scenario-scoped (each scenario has its own ASY tree). Cross-scenario ASY reuse is NOT in v1 scope — that would be a future "product template" concept; out of scope.

### `leaves` table (LEAF library — globally reusable)

```
leaves:
- id (uuid PK)
- name (text)
- product_type_id (FK to product_types where scope='leaf')
- sku, url, image_url
- unit_cost (component-cost contribution)
- owner_id
- fsc_claim, fsc_status, supplier_verified
- archived (bool — soft delete; can't hard-delete if referenced)
- created_at, updated_at
```

**Globally scoped — no `scenario_id`.** Leaves are library items available across all scenarios. References tracked via `assembly_leaves`.

### `assembly_leaves` join table (many-to-many)

```
assembly_leaves:
- id (uuid PK)
- assembly_id (FK to assemblies)
- leaf_id (FK to leaves)
- quantity (numeric — how many of this leaf in this ASY)
- position (int — tree ordering / sort)
- parent_assembly_leaf_id (FK to self — nullable; supports nested leaves if cost-stack tree is deeper than ASY > LEAF)
- created_at, updated_at
```

Same library leaf can be referenced by many ASYs (across scenarios). Reference count drives the cascade-warning UX in §4.5 ("This leaf is used in N ASYs across M scenarios").

### `leaf_specs` table (polymorphic spec values)

```
leaf_specs:
- id (uuid PK)
- leaf_id (FK to leaves)
- spec_values (JSONB — actual values keyed by field key from product_types.field_schema)
- version_number (int)
- is_current (bool)
- effective_from (timestamptz)
- effective_to (timestamptz, nullable)
- created_at, updated_at, created_by, updated_by
```

`spec_values` JSONB validated app-side against the leaf's `product_type.field_schema`. App enforces type-aware structure.

### Versioning model — Hybrid per Q6 disposition + cascade per Edward call

Per Edward Q4 + Q6 + the cascade disposition (auto-update unsent; pin at send):

- **Field-level audit events.** Each field change writes an `audit_log` row with `diff_json` capturing the specific field's before/after.
- **Version-number bumps at quote-pin events.** Between pins, edits update the current `leaf_specs.is_current=true` row in place.
- **Unsent quotes auto-update.** Drafts reference the leaf's current spec version. Spec edits to the leaf reflect in drafts automatically.
- **Sent quotes pin.** When a quote is sent, each leaf in the quote pins its current `leaf_spec_version` via `quote_leaves.leaf_spec_version_id` (or composite key). Future spec changes do NOT update sent quotes.

Implementation pattern: single `leaf_specs` row per leaf with `version_number` reflecting most recent pin; historical pinned versions reconstructable via `audit_log`.

### `quote_leaves` table — per-quote leaf pinning

```
quote_leaves:
- id (uuid PK)
- quote_id (FK to quotes)
- assembly_id (FK to assemblies — the ASY this leaf is under in the quote)
- leaf_id (FK to leaves)
- leaf_spec_version_id (FK to leaf_specs.id at pin time — null until quote is sent; populated at send)
- pinned_at (timestamptz — when pin occurred)
- quantity, position
- created_at, updated_at
```

`leaf_spec_version_id` is null for draft quotes; populated when quote is sent (Q4 disposition). Sent quotes are immutable on this field.

### Spec versioning cascade — implementation note

When a leaf's specs change:
1. Update `leaf_specs.spec_values` in place (current row)
2. Write field-level `audit_log` rows for each changed field
3. **Do NOT update** `quote_leaves.leaf_spec_version_id` on already-sent quotes (those stay pinned)
4. Unsent quotes (`quote_leaves` with null `leaf_spec_version_id`) reference the leaf's current spec automatically at render time

This avoids fan-out writes on edits (no UPDATE across N referencing quote_leaves rows) while preserving pin integrity.

### `audit_log` namespace additions

New `diff_json.source` values per Slice 9.2 namespace convention:
- `leaf_spec_field_edit` — single-field update (most common; field-level granularity per Q6)
- `leaf_spec_type_change` — Product Type changed on a leaf (rare; discards prior spec values per §4.10 edge case)
- `leaf_spec_create` — first spec values on a leaf (transition from empty to populated)
- `leaf_spec_version_pin` — version_number bumped on quote send (system event, not user edit)
- `leaf_create` — new leaf added to library
- `leaf_archive` — leaf soft-archived (can't be added to new ASYs; existing references intact)
- `assembly_leaf_attach` — leaf added to an ASY
- `assembly_leaf_detach` — leaf removed from an ASY (without deleting the leaf)

Cascade audit pattern applies if a single PM action triggers multiple field edits.

### RLS policies

New permission flags for spec edit + leaf creation:
- `can_edit_specs` — write access to `leaf_specs.spec_values`
- `can_create_leaves` — insert access to `leaves` (library-creation permission, possibly separate from edit)

RLS policies on `leaves`, `leaf_specs`, `assembly_leaves`:
- Read: any authenticated user with scenario visibility
- Write: users with appropriate permission flags

Standard pattern; no surprises.

### Polymorphic approach tradeoffs (informational)

For Architect at impl-brief time, three options were considered:

- **(α) JSONB column — CHOSEN.** `leaf_specs.spec_values JSONB` + `product_types.field_schema JSONB`. New types via row insert; field-level validation app-side.
- **(β) Field-definitions + values tables.** Separate `product_type_fields` + `leaf_spec_values` (key-value rows). Most normalized; queries are join-heavy.
- **(γ) Fixed table per type.** `primary_packaging_specs`, `secondary_packaging_specs`, etc. Rigid; new types need DDL.

Per Q-Type3 CA lean (accepted): **(α) JSONB.** New types Edward adds (or refines) don't require schema migrations. App-layer validation enforces type-aware structure.


## 12. Suggested scenario coverage

CD ships scenarios covering the new surfaces. Following Phase A's cadence. ASY/LEAF distinction + library reuse + type-aware rendering are the headline complexity.

### ASY tree + leaf context menu scenarios

- **① SKUs page tree view** — ASYs as parent rows with nested leaves; per-leaf completeness chips; per-ASY rollup chip; aggregate quote-level completeness
- **② Leaf context menu with Edit specs** — existing menu (Move up / Move down / Delete cascade / Assign to parent) gains **Edit specs** option
- **③ ASY context menu (no Edit specs)** — ASY row's menu shows different actions (Edit product / Duplicate / etc.); explicitly NOT Edit specs
- **④ ASY rollup completeness** — `✓ All complete` / `⚠ 2 of 4 leaves pending` / `— No leaves added` states

### Spec entry — type-aware leaf scenarios

- **⑤ Primary packaging leaf — complete specs** — PP field set fully filled; chip `✓ Complete`; version stamp `v4 · pinned by 2 active quotes`
- **⑥ Secondary packaging leaf — partial specs** — SP field set partial; chip `⚠ N fields pending`
- **⑦ Soft goods leaf — placeholder treatment** — "fields TBD" until Edward provides field list
- **⑧ Leaf with no Product Type** — "Set product type first" empty state with inline type-picker
- **⑨ Product Type change** — PM changes leaf's type from PP to SP; confirmation modal "Changing Product Type clears existing spec values"; on confirm, field set re-renders
- **⑩ Unauthorized user view (RLS)** — spec values render but inputs disabled; "Contact your administrator" copy

### Add Product modal — ASY/LEAF mode toggle scenarios

- **⑪ Modal in ASY mode** — toggle set to ASY; commercial fields render; no spec entry; single-step "Add product" CTA
- **⑫ Modal in LEAF mode — no Product Type selected** — toggle set to LEAF; identity fields render; CTA reads "Add leaf · specs empty" (deferred)
- **⑬ Modal in LEAF mode — Primary packaging type selected** — leaf-level Product Type chosen; CTA reads "Continue to specs →"
- **⑭ Modal in LEAF mode — Continue to specs flow** — step 2 (Edit specs surface) opens with PP fields ready for entry
- **⑮ Modal in LEAF mode — defer specs** — PM uses "Add leaf · specs empty" path; leaf created with no specs; chip `— No specs entered`
- **⑯ Library-scope copy on LEAF creation** — sub-label or post-creation toast: "Available across all scenarios"

### Library + replenishment scenarios

- **⑰ Add existing library leaf to ASY** — PM opens "Add leaf" affordance on ASY; browse library; pick existing leaf; `assembly_leaves` association created (no new leaf)
- **⑱ Library search** — search by name / SKU / type / factory; results show usage count (e.g., "Used in 3 ASYs across 2 scenarios")
- **⑲ Leaf reference count surface** — leaf header shows "Used in 3 ASYs across 2 scenarios" with click-through to see referencing ASYs
- **⑳ Edit widely-referenced leaf — cascade warning** — confirmation modal: "This leaf is used in 3 active quotes across 2 scenarios. Sent quotes stay pinned; unsent quotes will update."
- **㉑ Version-stamp callout in active quote — unchanged** — leaf row in Preview Quote shows `v4 · unchanged since QU-2024-0142`
- **㉒ Version-stamp callout in active quote — changed** — leaf row shows `v5 · changed since QU-2024-0142 (was v4)` with hover/click for context

### Quote PDF addendum scenarios — per-leaf rendering

- **㉓ Addendum off** — single-page pricing PDF (matches Phase A)
- **㉔ Addendum on — per-leaf blocks grouped by ASY** — page 1 pricing, page 2+ addendum: ASY header (e.g., "GLW-30 · Hydra-Glow Vitamin C Serum 30ml") followed by sub-blocks per leaf with type-specific rendering
- **㉕ Addendum on — mixed leaf types** — ASY with PP leaf + SP leaf + Soft goods leaf; each leaf renders its type-specific fields under the ASY header
- **㉖ Addendum on — partial specs** — `--` values where empty within each leaf's field set
- **㉗ Addendum on — zero spec data** — per Q5 disposition: suppress addendum entirely + PM-side preview note "Addendum was toggled on but won't render — no spec data"
- **㉘ Toggle UI on Preview Quote** — addendum on/off control + "renders N leaves across M ASYs" meta

### Re-quote workflow scenarios

- **㉙ Spec edit on leaf in active quotes** — cascade warning surface + affected quotes list
- **㉚ Out-of-sync indicator on sent quote** — leaf version pinned to v3; current is v5; callout + diff/re-quote affordances
- **㉛ Re-quote initiated** — duplicate flow with current leaf spec versions + predecessor link
- **㉜ Superseded quote status** — original quote with explicit superseded banner

### Audit log export scenarios

- **㉝ Per-quote export** — Completed sub-tab export trigger + CSV output preview (field-level audit events visible)
- **㉞ Per-leaf export (library)** — leaf context menu export option; spec edit timeline for one library leaf across all referencing ASYs
- **㉟ Export scoping modal** — event type / actor / date filters

### Soft gate scenario

- **㊱ Preview Quote with incomplete leaf specs** — soft warning callout + per-leaf detail; per-leaf type-aware completeness (a soft-goods leaf is complete if soft-goods fields are filled, regardless of PP/SP)



## 13. Pattern 30 deliverable expectations

CD ships standard Pattern 30 bundle:
- **Bundled HTML prototype** with all scenarios accessible
- **Designer notes** documenting design decisions, rationale, pushbacks/considered-and-rejected per Phase A precedent
- **Data-source map** updated to include all new schema implications (`product_types` taxonomy, `leaf_specs` polymorphic JSONB, audit_log namespace, RLS notes)
- **Unbundled source** (HTML + JSX + CSS) at `docs/design-prototypes/dist/...`
- **Designer notes + data-source map** also at `docs/` root per canonical-location convention from PR #37

## 14. Discovery questions — all dispositioned

All questions Edward + CA worked through before CD kickoff are dispositioned. Locked dispositions baked into the brief:

**Original Q1-Q8 (placement + scope):**

- **Q1 Spec entry surface:** Setup > SKUs page, per-leaf via context menu + Add Product modal + browse on SKUs page
- **Q2 Addendum toggle:** Per-quote toggle on Preview Quote
- **Q3 Re-quote affordance:** Send to Client only (canonical entry; reversal via existing unaccept flow precedes re-quote)
- **Q4 Audit log export:** Per-quote (Completed) + per-product (SKUs page) in v1; time-range admin deferred to v1.1
- **Q5 Empty-specs addendum:** Suppress entirely when zero spec data; render with "--" otherwise
- **Q6 Versioning granularity:** Hybrid — field-level audit events + version-level pins
- **Q7 Re-quote pricing:** Carry forward + warning
- **Q8 Scope phasing:** Full Phase A.1 (don't split)

**Q-Type1-6 (type-aware spec model):**

- **Q-Type1 Product Type taxonomy:** Starting list assumed (Primary packaging / Secondary packaging / Soft goods / Tertiary packaging / Component-part / Assembly / Service-labor / Other). Edward confirms exact dropdown options before CD finalizes.
- **Q-Type2 Field lists per type:** CD designs rendering pattern; Edward provides field lists per type iteratively. PP + SP are the worked examples in CD's prototype; other types render with "fields TBD" placeholder.
- **Q-Type3 Polymorphic schema approach:** JSONB column (option α) — new types via row insert in `product_types`, no DDL for new fields/types
- **Q-Type4 Existing leaves treatment:** Empty default + soft gate prompts at Preview Quote
- **Q-Type5 Leaves without product type:** Edit specs prompts type-picker first
- **Q-Type6 Add Product modal spec UX:** "Continue to specs →" two-step flow; CD chooses multi-step modal vs. modal-closes + Edit specs surface

**Q-ASY1-5 (ASY/LEAF/library model — added after CD's first iteration revealed model confusion):**

- **Q-ASY1 ASY vs LEAF distinction:** Specs live ONLY on leaves; ASYs aggregate; ASY context menus do NOT have Edit specs option
- **Q-ASY2 Add Product modal mode:** ASY/LEAF toggle at top of modal; conditional field rendering per mode; LEAF mode supports inline spec entry with "Continue to specs" or "specs empty for now" defer option
- **Q-ASY3 LEAF library scope:** Globally reusable across all scenarios; many-to-many via `assembly_leaves`; reference count surfaced to PMs
- **Q-ASY4 Spec versioning cascade:** Unsent quotes auto-update; sent quotes stay pinned at send-time version
- **Q-ASY5 ASY-level Product Type:** Kept as separate categorization concept (distinct from leaf-level Product Type); used for filtering/sorting; does NOT drive spec rendering

Designer's pattern-30 deliverables may surface additional sub-questions during exploration. Standard pushback pattern (Phase A precedent) — flag in designer notes, surface to Edward + CA for disposition.



## 15. Connections to other slices

- **Pricing reframe v1 (item 2):** ships independently. Phase A.1 specs work doesn't touch Pricing surface (other than soft gate copy borrowing the warning callout register).
- **Leaf-detach micro-slice (item 3):** ships independently. No interaction with specs.
- **Quote umbrella + NetSuite finalization (item 4):** Phase A landed; Phase A.1 specs adds the addendum + re-quote workflow + soft gate integration on the existing Preview Quote sub-tab. Implementation slice expands to absorb specs surfaces.
- **Slice 11 PDF customer-facing data bindings (item 5):** explicitly expands scope — PDF rendering now includes optional addendum page(s) with type-aware spec rendering; data bindings include `leaf_specs` reads scoped by `product_type`.
- **Product specs IA migration slice (NEW, item 4 placement TBD):** the schema migration + Add Product updates + RLS work that CD's design implies. CA drafts the impl brief after CD ships Phase A.1 deliverables.
- **Audit log export slice (NEW):** new small slice (CC + CA work) — CSV export endpoint + UI affordances per CD's design. Implementation belongs late in v1 path before pre-launch review.
- **Microsoft OAuth (item 6):** sequentially independent.
- **Pre-launch review (item 7):** Pattern 45 verification on customer-facing surfaces now includes the addendum render (customer sees specs if toggled on; internal-only data must not leak).

## 16. Open items pending Edward dispositions

Pre-CD-kickoff dispositions are locked (§14 above). Remaining open items, mostly content-level + post-CD-deliverables:

**Pre-CD-kickoff (content Edward provides):**

1. **Confirm exact ASY-level Product Type taxonomy** (Skincare, Supplement, etc.) — used for categorization
2. **Confirm exact LEAF-level Product Type taxonomy** (Primary packaging, Secondary packaging, Soft goods, etc.) — drives spec rendering. Starting list is CA-guessed; Edward enumerates for accuracy.
3. **Field lists per LEAF Product Type** for types beyond PP + SP. PP + SP are known (Aisha's screenshots). Soft goods, Tertiary packaging, Component-part, Assembly sub-component, Service-labor, Other — Edward provides field definitions as identified. CD's prototype uses placeholders until provided.
4. **HubSpot push semantics for LEAF mode** — CA lean: leaves stay internal (don't push to HubSpot). Confirm or override.

**Post-CD-deliverables (Edward confirms after CD ships Phase A.1):**

5. Confirm CD's choice of Add Product modal step-2 pattern (multi-step modal vs. modal-closes + Edit specs surface)
6. Confirm new schema commitments (CA drafts impl brief after CD lands)
7. Confirm authorized PM permission flag pattern (`can_edit_specs` + `can_create_leaves` granularity)
8. Confirm any new role/permission UX (administrator panel, user management surface?)
9. Disposition any pushbacks CD raises during design exploration (Phase A pattern)



## 17. Operating model notes for CD

1. **Phase A is shipped and stays shipped.** This recalibration adds scope; doesn't undo Phase A. The Quote umbrella 4+1 sub-tabs, the persistent quote panel, the audit timeline on Completed — all stay as designed.

2. **Phase B (Pricing component repositioning) remains deferred** per scope_calibration decision. Q1 aggressive-consolidation dispositions are locked; Phase B brief lands as separate follow-up after Phase A.1 ships and impl wraps. Don't redesign Phase B in this round.

3. **Brief location:** This brief at `docs/cd-quote-workflow-recalibration-brief.md` (or wherever Edward commits it). CD Pattern 30 deliverables follow canonical-location convention from PR #37 — designer notes + data-source map at `docs/` root.

4. **Pushback welcomed.** Phase A's three pushbacks were valuable; same applies. If any disposition reads wrong, surface in designer notes and we'll re-discuss.

5. **Schema commitments are flagged, not finalized.** §11 lists fields CD's design implies; exact schema shape is CA/Architect work at impl-brief time. CD just needs to flag the data the design needs.

6. **Aisha 1:1 backlog items** that may inform design choices:
   - Quote attachments / file storage (v1.1, Supabase Storage) — informs the Send to Client cover message area (Phase A already has a cover message; attachment surface adds later)
   - Executive approval gating for spec changes affecting active quotes (v1.5+) — out of scope here
   - AI-based price optimization (v2+) — out of scope here

7. **HubSpot phase-out trajectory.** Per Edward Q1 disposition, HubSpot phases out for specs in v1 (going forward); migration of existing deal-level specs is v1.1 work. Design assumes our DB is source of truth for new product specs from v1 onward. HubSpot pull semantics in Add Product flow reflect this (§7).

8. **Operations wrapper context.** Post-v1, an Operations dashboard wraps the per-quote flow. Specs surfaces from this round (Setup placement, audit log export) feed into Operations naturally — completed quotes' spec history becomes part of the operations dashboard's per-order view. CD doesn't need to design Operations now, but designs should leave room for it.

9. **The defensibility ask is the load-bearing concern.** Audit log + export aren't auxiliary — they're the legal/contractual capability that makes DPS confident in its quoting workflow. Don't shortcut the audit timeline + export surfaces; they earn their place in v1.

10. **Phase A.1 timeline:** revised estimate **~3-4 weeks** for full CD scope, up from initial ~2-3 weeks. The type-aware spec rendering adds meaningful design complexity (three entry points × N product types; the rendering pattern must scale across types as Edward provides field lists). Pattern 30 deliverable + pushback round + Edward dispositions. Concurrent with Pricing reframe impl wrap-up (CC working that now); CD's Phase A.1 lands ~same time impl branch for Quote umbrella opens (which now absorbs Phase A.1 surfaces).
