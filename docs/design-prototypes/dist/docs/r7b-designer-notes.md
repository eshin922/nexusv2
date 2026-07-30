# Round 7b — Setup standalone redesign · Designer notes

The Setup R7 ask asked CD to design four coupled things (SKU table, Tier table, Notes section, feature enhancements) as one surface, not four. What follows is the design and the reasoning, with explicit fallback paths called out where Edward + CC may need to weigh implementation cost.

## The framing

Setup is the **starting shape** of the quote: what we're selling, in what quantities, with what context. Cost goes on Cost build (the next surface). Pricing goes on Costing sheet. The customer-facing artifact lives on Customer view.

Three things changed from the v1 Setup carried forward through RI.8 step 1.5:

1. **The SKU table loses its inline Notes column** in favor of a per-row drawer.
2. **The Tier table is redesigned as a coupled pair** with the SKU table — same inline-edit pattern, same register, same action vocabulary.
3. **The bottom-of-page Notes section splits** into internal vs. customer-facing zones, with per-SKU notes living in the SKU-row drawer.

The IA above Setup (page head, eyebrow, action cluster, "YOUR NEXT MOVE" banner) is R7a canon applied. Eyebrow line carries `{client} · {scenario} · v{N} draft` per R7a Eyebrow grammar.

## Decision 1 · Type as badge+glyph with click-to-toggle (Q3 Option 1)

`sku_role` is a mutation control, not a label. It's the schema column that determines whether a SKU is a single-line leaf or an assembly with nested components. The design:

- A small **badge with a glyph** in its own column: `▤ ASY` for assemblies, `○ LEAF` for leaves.
- The badge is **clickable** — click toggles `sku_role` between leaf and assembly. When toggling assembly → leaf with components, the components stay in the database (preserved) but stop rendering; toggle back and they reappear. (Same "preserve hidden" rule as R6.1's tier-shape handling.)
- The badge is **always visible**. Not buried in a drawer, not hidden behind a "click to edit" affordance. It's part of the row's at-a-glance signature.

**Fallback (Q3 Option 2):** if PM workflow patterns suggest role changes are rare mid-build (worth measuring in Slice 12+ telemetry), move the explicit toggle into the row drawer and let the badge be display-only. The visual register still distinguishes leaves and assemblies (different left-border accent — assembly rows get a 2px accent border, leaves get a transparent border), so discoverability isn't lost. CA flagged this as the cheaper fallback if telemetry shows badge-clicks are noise.

## Decision 2 · Notes split (Q2 Option 2)

The Setup R7 ask flagged three audiences for notes:

1. **Per-SKU notes** (`quote_skus.notes`) — internal, scoped to a single SKU. Sourcing dependencies, customer requests about a specific product, R&D blockers.
2. **Internal quote-level notes** — internal, scoped to the whole quote. Customer conversation notes, scenario rationale.
3. **Customer-facing quote-level notes** — render on the Quote PDF + Mark-Accepted snapshot. Commercial terms, validity dates, delivery caveats.

The shipped design treats all three as **Setup-anchored** (Gate 3 confirmed) and surfaces them in two places:

- **Per-SKU notes** live in the SKU-row drawer. Opening any SKU row reveals a `Per-SKU notes` textarea labelled `internal-only`. When a SKU has a non-empty note, the row shows a small `has note` warn-soft chip in the pack column so it's visible without opening the drawer.
- **Quote-level notes** live in two side-by-side zones at the bottom of Setup. Internal zone has the `--internal` border accent (purple); customer zone has the `--good` border accent (green) plus an explicit "renders on Quote PDF" audience label. Each zone has a `chip` (Internal / Customer) so accidental cross-pollination of audiences is hard.

The Customer zone helper text includes a `Preview on Quote →` link to the Customer view surface — useful when PM is composing customer-facing text and wants to see how it renders.

**The drawer pattern is shared** with feature enhancement #2 (assembly expand/collapse) and #4 (Leaf/Assembly inline edit). All three open the same row-drawer affordance with different content. Designing them as one drawer with multiple zones rather than three separate drawers means CC can ship the drawer once and add zones in subsequent slices.

## Decision 3 · Add-new-product Nexus-local with HubSpot writeback (Q4 Option 1)

PM types name + category + pack → row appears immediately. A non-blocking HubSpot writeback runs in the background to register the product as canonical (the canonical record lives in HubSpot).

The modal carries a **HubSpot writeback toggle** (`Push to HubSpot`, default ON). When ON, the modal closes immediately and the product appears in the SKU table; HubSpot writeback happens async. When OFF, the product is Nexus-local-only and never syncs back — used for true one-offs (a custom packaging trial, a sample run that won't be repeated).

The toggle uses R6's **consequence-sentence pattern**: the toggle row reads `→ writes to HubSpot in background; row appears immediately` when ON, or `→ Nexus-local only; never syncs back to HubSpot` when OFF. No silent footguns.

**Fallback (Q4 Option 3):** if HubSpot writeback infrastructure is heavier than v1 budget allows (overlaps with Slice 12 Mark-Accepted writeback + deferred HubSpot webhook), ship Option 3 as v1 placeholder. Modal opens HubSpot directly via product-create deep-link; on save, HubSpot webhook delivers the new product to Nexus. PM workflow: click + Add product → HubSpot modal opens → save → return to Setup → row appears within ~1s. Slower than Option 1 (~5s vs. instant) but no writeback infrastructure required. CA flagged this as the v1-feasibility fallback.

The schema impact is the same either way: `quote_skus` gets a `hubspot_product_id` reference. The difference is the order of operations — Option 1 writes to Nexus first then HubSpot; Option 3 writes to HubSpot first then Nexus receives via webhook.

## Decision 4 · Feature enhancements (Q5 + bundle)

Four enhancements land together because they share the drawer pattern + visual register decisions:

### Drag-and-drop row reordering

Replaces the v1 up/down arrows in the action cluster. The leftmost column on each SKU row is now a `⠿` grip glyph; hover shows `grab` cursor, drag reorders. Reordering writes `quote_skus.display_order` on every drop.

This frees the action cluster of two ↑↓ buttons, which simplifies the per-row affordance to: `⋯` (open drawer / context menu). The grip + ⋯ pattern matches Round 5's row layouts and reads as the same affordance vocabulary across surfaces.

### Assembly rows expand/collapse to nested components

Clicking the `Components` count cell on an assembly row toggles the drawer open/closed. The drawer holds two things, in order:

1. **Nested component table** (assemblies only) — editable inline. Each column is a `<input>` with transparent border that turns into a focused border on hover/focus. Saves on blur or Enter (R6 Blur+Enter pattern). The component table reuses the R6 cost-stack vocabulary (Component / Supplier / Category / Unit cost / Qty / Markup) so PMs who've worked Cost build recognize the grammar immediately.
2. **Per-SKU notes textarea** — always present (assembly or leaf).

The drawer is **per-row**, not modal. Only one drawer open at a time per page (clicking another SKU row collapses the prior drawer). Same architectural pattern as Round 4's Copy Scenario picker and Round 6's section drill-downs.

### Inline edit on nested components (in-scope decision)

The Setup R7 ask flagged this as in-scope but invited a carve into v1.5. CD's call: **keep inline-edit in-scope**. The reason: a drawer that opens but won't let you edit reads as broken. Half-shipping the drawer pattern would teach PMs that drawers are read-only, which contaminates the affordance for future surfaces where editing is the whole point.

The scope impact is real (~12 input bindings per assembly drawer, debounced autosave per field) but bounded — the schema is settled, the data is already on the SKU row, and the editor is plain `<input>` elements with no custom controls. If CC's RI.8 §6.b implementation pace makes this risky, carve at slice time but keep it in this design.

### Leaf vs Assembly visual distinction

Three signals carry the role:

1. **Type badge column** — `▤ ASY` (accent-tinted) vs `○ LEAF` (paper-3 tinted).
2. **Left-border accent** — assembly rows have a 2px `var(--accent)` left border; leaves have a transparent border (same 2px width so vertical alignment is identical).
3. **Components column** — assemblies show `N comps ▸` (clickable); leaves show `—`.

Three signals is intentional. The left-border accent reads at glance scale (PM scanning a 20-row table). The badge reads at row scale. The components column reads at hover scale.

## Decision 5 · SKU × Tier coupled register

The SKU and Tier tables share:

- **Same card chrome** (R5 grammar — paper background, rule border, 12px radius, padded card-head with title + meta).
- **Same row affordance** — inline `<input>` cells with transparent border that turns into a focused border on hover/focus; commit on blur or Enter.
- **Same footer treatment** — dashed-border CTA pill for `+ Add X`.
- **Paired action vocabulary** — `+ Add SKU` / `+ Add tier`; `+ Add product` (modal) / `+ Add preset` (modal-free quick-fill).

The Tier table gets a **preset picker as its empty state** (RI.4 commitment surfaced in v1). Four presets — `3-tier step` (5k/10k/25k), `4-tier step`, `First-PO` (single 10k), `Volume break` (10k/50k/100k). Click a preset, tiers populate, picker collapses, footer's `+ Add tier` appears for further customization. The preset picker is removed once any tier exists — adding a 4th tier to a 3-tier preset doesn't re-show the picker, it just appends.

## Three pushbacks for CD review

**Pushback 1 · Per-SKU note visibility on the row.**

The current design shows a `has note` warn-soft chip when a SKU has a non-empty note. That chip lives in the pack column, where it competes for space with the (long) pack string. On long pack strings (the GLW-50 case: `50ml glass dropper bottle, screw cap`), the chip may push the pack into ellipsis. RI.9 should measure whether PMs actually scan that chip or open the drawer to see notes — if drawer-open is the dominant pattern, the chip is decorative and should move to the action column or vanish.

**Pushback 2 · The drawer is one-at-a-time.**

When a PM is comparing notes across two assembly SKUs (`GLW-30` and `GLW-50` packaging deltas, say), they have to close one drawer to open the other. The drawer-per-row pattern matches R6 and R4 but in this specific Setup case, a two-drawer-open mode might serve the comparison workflow. CD's read: ship one-at-a-time for v1, watch usage, allow multi-open if comparison patterns dominate. Same argument applies to comparing tier price-adj values across tier rows — but tier rows are short and side-by-side already, so the case is weaker there.

**Pushback 3 · Customer-facing notes preview link.**

The customer-facing zone has a `Preview on Quote →` link in its helper text. That's a cross-surface jump from Setup to Customer view. R7a's IA arc has Setup → Cost build → Costing → Customer view as the forward path; jumping straight from Setup to Customer view skips Cost build + Costing. The preview link is convenient (PM wants to see how customer-facing text renders without doing cost work first) but the jump bypasses the IA grammar. Two answers possible:

- **Keep it.** Setup → Customer view is a deliberate, contextual shortcut for the specific notes-preview workflow. The full IA arc still exists in the rail.
- **Replace with inline preview.** The customer-facing zone has its own mini-render of just the notes block, styled like a Quote PDF excerpt. PM sees the rendering without leaving Setup.

CD's call: ship the link (cheap, contextual), watch usage, replace with inline preview if Customer view traffic from Setup turns out to be 90% notes-preview rather than real review.

## Considered and rejected

**Tabs across the SKU drawer.** Considered putting `Components | Notes | History | Lineage` as tabs inside the drawer. Rejected because Components and Notes are the only two zones in v1, and three of the four tabs would be future-empty. Stacked sections (Components above Notes, both visible) reads better than a half-empty tab strip.

**Notes as a single full-width block with audience checkboxes.** Considered keeping the v1 single-textarea Notes section and adding "internal" / "customer-facing" checkboxes per line. Rejected because the audience checkbox pattern was the source of past PM errors (PMs forgetting to check the box, or checking the wrong one). Splitting into two zones with distinct visual treatment forces the audience decision at write-time, not at audit-time.

**Add-new-product as an inline ghost row at the bottom of the SKU table.** Considered putting an empty editable row at the bottom of the table as the add-affordance. Rejected because the new-product fields (name, category, pack, units_per_pack, sku_role, writeback) don't fit in the SKU table's column structure. The modal carries them cleanly with a writeback toggle that wouldn't have a home in a row-based add.

**Tier table without preset picker.** Considered shipping the tier table with just `+ Add tier` and no presets. Rejected because the RI.4 telemetry showed 65%+ of new quotes use a familiar tier shape (3-tier step or 4-tier step). The preset picker turns four clicks into one.

## Commitments out of this round

1. **`quote_skus.display_order` integer column** — drives drag-and-drop ordering. Defaults to row creation order if not set.
2. **`quote_skus.notes` stays the canonical per-SKU notes column** (no schema change). Authored from the drawer.
3. **`quote_meta.internal_notes` and `quote_meta.customer_facing_notes`** — two distinct text columns. Customer-facing notes flow to the Quote PDF + Mark-Accepted snapshot; internal notes never leave Nexus.
4. **HubSpot writeback for new products** — Slice 12 / writeback foundation. Writes to HubSpot product registry async; updates Nexus `quote_skus.hubspot_product_id` on completion.
5. **Per-line markup defaults** — when a new component is added inside an assembly drawer, `markup_pct` defaults from `markup_categories` (R5 carry-forward). Already the rule on Cost build; reapplying it here so Setup's nested components are consistent.

## Carry-forward to R7c (if needed)

If telemetry on the shipped R7b surfaces shows specific workflow gaps, candidates for R7c:

- **Multi-drawer mode** for comparison workflows (Pushback 2).
- **Inline preview** of customer-facing notes (Pushback 3).
- **Drag-and-drop nested components** (drawer-internal reordering). Out of v1 scope; if PMs reorder assembly components frequently, the drawer-internal grip lands cleanly.
- **Bulk SKU import** from CSV or HubSpot product-list. Add-new-product handles one at a time; large catalog imports are a different affordance.

None of these are blocking. R7b ships as-designed; R7c only happens if real usage signals it.
