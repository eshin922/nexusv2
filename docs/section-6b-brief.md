# §6.b — Setup wholesale redesign · Slice brief

**Status:** Ready to spawn. RI.9 closed (foundation primitives shipped); this slice consumes RI.9's R7a canon and adds R7b's Setup-specific redesign.

**Companion docs:**
- `docs/r7b-designer-notes.md` — R7b canon (8 design decisions, 3 pushbacks, considered-and-rejected reasoning, R7c carry-forwards). Promoted to top-level docs/ pre-kickoff per Edward's preferred convention; mirror remains at `docs/design-prototypes/dist/docs/r7b-designer-notes.md` until R7c lands.
- `docs/r7b-data-source-map.md` — Schema commitments + per-row field mapping + cross-surface contracts honored. Same promotion as designer notes.
- `docs/design-prototypes/dist/Nexus Round 7b.html` — R7b prototype (4 states: All collapsed · Assembly drawer open · Leaf drawer open · Empty tiers / preset picker)
- `docs/ri9-brief.md` — predecessor slice (foundation primitives §6.b inherits)
- `docs/design-prototypes/dist/docs/r7a-designer-notes.md` — R7a canon (eyebrow grammar, action cluster, banner, etc. — already shipped in RI.9, referenced here for inheritance)

---

## §1 · Scope

§6.b implements R7b — the wholesale redesign of the Setup surface. RI.9 shipped Setup's page-head primitives (eyebrow, YOUR NEXT MOVE banner, action cluster grammar). §6.b replaces Setup's BODY: SKU table, Tier table, Notes section, and adds new affordances (Add-product modal, drag-and-drop reordering, per-row drawer).

**Surfaces touched (1):** Setup.

**In scope:**
- 8 R7b implementation primitives (§3 below)
- 3 R7b pushback dispositions baked as implementation refinements (§4)
- 3 confirmation refinements from CD R7b confirms (§5)
- 1 new schema commitment (`quote_skus.display_order INTEGER`, §3.8)

**Out of scope (defer to other slices or R7c):**
- **R7B STATES tab strip** — review chrome only per confirmation B; do NOT ship as production UI (Pattern 21 compliance check)
- **Pull from Inventory affordance** — stripped from v1 per confirmation C; defers to its own scoping slice (which inventory / what filter / carry-back semantics unresolved)
- **Inline preview pane for customer-facing notes** — R7c carry-forward candidate per confirmation A; v1 ships the Preview-on-Quote link routing through R7a breadcrumb register; v1.1 or R7c swap for inline preview
- **Multi-drawer mode** for cross-SKU comparison workflows — R7c candidate (drawer is one-at-a-time in v1 per Pushback 2 disposition)
- **Drag-and-drop nested components** (drawer-internal reordering) — R7c candidate; v1 ships drag-drop on SKU rows only
- **Bulk SKU import** from CSV or HubSpot product-list — separate slice
- **Other surfaces** (Cost build, Costing, Customer view, Mark Accepted) — RI.9 shipped these; §6.b doesn't touch them

---

## §2 · Inherited foundation from RI.9

§6.b consumes (does not re-implement) these primitives shipped in RI.9:

| Primitive | RI.9 status | §6.b usage |
|---|---|---|
| `<Eyebrow>` component | ✅ Shipped | Setup eyebrow reads `{client} · {scenario} · v{N} draft` per R7a grammar |
| `<YourNextMoveBanner>` (3 states) | ✅ Shipped | Setup banner: "Continue to Cost build →" with subtitle "once SKUs and tiers are settled" |
| Action cluster grammar primitive | ✅ Shipped | Setup cluster: Save draft (primary right) · + Add SKU (secondary middle); no back-direction |
| Surface-routes table | ✅ Shipped | Setup forward-to = `cost_build` |
| Surface-render rules table | ✅ Shipped | Setup `rail.visible = true`, `breadcrumb.visible = false` |
| `<NavShell>` + `<SurfaceChrome>` (XOR enforcement) | ✅ Shipped | Setup keeps rail; no breadcrumb |

§6.b adds 8 new primitives below, all confined to the Setup surface body.

---

## §3 · Implementation primitives (R7b canon)

### 3.1 SKU table redesign

Replaces v1's seven-column SKU table. New column structure:

| Column | Width | Content |
|---|---|---|
| Grip | 36px | `⠿` drag glyph; hover shows grab cursor; drag reorders |
| Type | ~80px | Badge + glyph: `▤ ASY` (accent-tinted) or `○ LEAF` (paper-3 tinted); click toggles `sku_role` |
| Product | flex (2fr) | Stacked: `{label}` `{product_name}` / `{pack}` + optional HAS NOTE chip |
| Category | 1fr | `quote_skus.category` from `sku_categories` enum |
| Retail bench | ~120px | `quote_skus.retail_benchmark` formatted as USD |
| Components | ~120px | Assemblies: `{N} comps ▸` (clickable, opens drawer); Leaves: `—` |
| ⋯ | 36px | Overflow menu (existing R6 pattern; future: actions like Assign/Detach/Refresh-from-HubSpot) |

**Footer affordances:**
- `+ Add product` (primary blue) — opens add-product modal
- `↗ Pull from HubSpot` (secondary text) — existing HubSpot product lookup, relocated from dead Cost Inputs nav strip
- "Drag rows to reorder" hint (right-aligned, muted)

**Left-border accent for assembly distinction:** assembly rows get a 2px `var(--accent)` left border; leaf rows get a transparent border (same 2px width for vertical alignment).

### 3.2 Per-row drawer (one-at-a-time)

Per-row drawer pattern controlled by `openSkuId` local state. Clicking the `Components ▸` cell on an assembly row OR the `⋯` button toggles the drawer open/closed for that row. Only one drawer open at a time — opening a new row's drawer collapses any other open drawer.

Drawer contains two zones (in order):

1. **Nested component table** (assemblies only) — see §3.3
2. **Per-SKU notes textarea** — always present (assembly or leaf); writes `quote_skus.notes`; autosave on blur; "internal-only" label

**Implementation note:** drawer is per-row INLINE expansion, not a modal overlay. Same architectural pattern as R4 Copy Scenario picker and R6 section drill-downs.

### 3.3 Inline-editable nested component table

For assemblies, the drawer's first zone is a nested component table. Columns:

| Column | Source | Mutable |
|---|---|---|
| Component name | `quote_skus_components.product_name` | Yes — inline text input |
| Supplier | `quote_skus_components.supplier` | Yes — inline text input |
| Category | `quote_skus_components.category` → `markup_defaults.category` | Yes — inline select |
| Unit cost | `quote_skus_components.unit_cost` | Yes — inline numeric |
| Qty | `quote_skus_components.qty` | Yes — inline numeric |
| Markup | `quote_skus_components.markup_pct` (defaults from category) | Yes — inline numeric |
| × | n/a | Delete row |

**Inline-edit pattern (R5/R6 carry-forward):** `<input>` with transparent border that turns into focused border on hover/focus; commit on blur OR Enter (R6 Blur+Enter pattern). For numeric inputs in textarea-eligible contexts, follow RI.9 Pushback 2 precedent: ⌘+Enter to save explicitly (since plain Enter has different semantics in some contexts).

**Markup default sourcing (R5 carry-forward):** new component rows default `markup_pct` from `markup_defaults.markup_pct` for the selected category. Editable per-line on Cost build downstream.

**Footer:** `+ Add component line` affordance (dashed border pill).

### 3.4 Tier table parallel register

Coupled register pair with SKU table — same card chrome, same inline-edit pattern, same footer CTA grammar.

| Column | Source | Mutable |
|---|---|---|
| Tier label | `quote_tiers.label` (defaults to "Tier N") | Yes — inline text |
| ★ Recommended | `quote_tiers.recommended` (bool, one per quote) | Yes — click toggles; clicking on one row unsets siblings |
| Qty | `quote_tiers.qty` | Yes — inline numeric |
| Price adj % | `quote_tiers.price_adj_pct` | Yes — inline numeric |
| × | n/a | Delete row |

**Footer:** `+ Add tier` (dashed border pill).

### 3.5 Tier preset picker (empty state)

Renders only when `COUNT(quote_tiers) = 0`. Four presets in 2×2 grid:

| Preset | Tiers created | Recommended |
|---|---|---|
| 3-tier step | 5k · 10k · 25k | T2 |
| 4-tier step | 5k · 10k · 25k · 50k | T2 |
| First-PO | 10k single tier | T1 |
| Volume break | 10k · 50k · 100k | T2 |

Click a preset → tiers populate → picker collapses → footer `+ Add tier` appears for further customization. Picker is removed once any tier exists. Adding a 4th tier to a 3-tier preset does NOT re-show the picker.

**Rationale (R7b designer notes):** RI.4 telemetry showed 65%+ of new quotes use a familiar tier shape. Preset picker turns four clicks into one.

### 3.6 Notes split — internal / customer-facing zones

Bottom-of-page Notes section splits into two side-by-side cards:

**Internal zone (left):**
- Border accent: `--internal` (purple)
- Chip: `INTERNAL` (purple-soft)
- Subtitle: "PM-only · never customer-visible"
- Textarea writes `quotes.internal_notes`
- Audience footer: "Audience: you, other PMs, and admins. Sourcing dependencies, customer phone notes, R&D blockers go here."

**Customer-facing zone (right):**
- Border accent: `--good` (green)
- Chip: `CUSTOMER` (green-soft)
- Subtitle: "renders on the Quote PDF"
- Textarea writes `quotes.customer_facing_notes`
- Audience footer: "Audience: the customer (renders on the Quote PDF and Mark-Accepted snapshot). Boundary-guard: this text travels with the quote artifact."
- **`Preview on Quote →` link** — see §5.A for routing details

**Audience label distinction is load-bearing.** R7b rejected the v1 single-textarea-with-checkboxes pattern explicitly because audience checkboxes were a source of past PM errors. Splitting into two zones with distinct visual treatment forces audience decision at write-time, not at audit-time.

### 3.7 Add-product modal

Modal with fields:
- Product name → `quote_skus.product_name`
- Type (leaf / assembly) → `quote_skus.sku_role`
- Pack → `quote_skus.pack`
- Category → `quote_skus.category`
- Units per pack → `quote_skus.units_per_pack`
- **HubSpot writeback toggle** (default ON) — see §3.7.1

**Confirm action:** inserts into `quote_skus` immediately, row appears in table. Modal closes.

#### 3.7.1 HubSpot writeback toggle

Uses R6's **consequence-sentence pattern**:
- Toggle ON (default): `→ writes to HubSpot in background; row appears immediately`
- Toggle OFF: `→ Nexus-local only; never syncs back to HubSpot`

**Writeback path (toggle ON):**
1. Insert into `quote_skus` immediately. Row appears.
2. Async job writes to HubSpot product registry (uses Slice 12 writeback infrastructure if available; falls back to deferred queue if Slice 12 hasn't shipped yet).
3. On HubSpot success, update `quote_skus.hubspot_product_id` with canonical HubSpot ID.
4. On HubSpot failure, log + surface non-blocking notification; row stays Nexus-local until retry.

**Nexus-local path (toggle OFF):**
1. Insert into `quote_skus`. `hubspot_product_id` stays NULL.
2. Never syncs to HubSpot.

**Fallback (per Q4 Option 3):** if Slice 12 writeback infrastructure isn't ready in §6.b timeframe, ship the toggle UI as designed but route writeback to a deferred queue (or temporarily disable the ON path with a "coming soon" tooltip on the toggle). CC + Edward weigh feasibility at slice start; record decision in commit message.

### 3.8 Drag-and-drop row reordering

Replaces v1's up/down arrow buttons in the action cluster. New mechanism:

- Leftmost column on each SKU row is a `⠿` grip glyph
- Hover shows `grab` cursor
- Drag reorders rows
- Drop writes `quote_skus.display_order` for affected rows
- Reorder logic: assign sequential integers (1, 2, 3, ...) on every reorder OR use sparse spacing (10, 20, 30, ...) to allow inserts without renumbering — implementation choice for CC, but **document the choice in commit message**

**Schema commitment:** `quote_skus.display_order INTEGER` — defaults to row creation order if not explicitly set.

---

## §4 · Implementation refinements (R7b pushback dispositions)

### 4.1 Pushback 1 — HAS NOTE chip placement watchpoint

**Problem CD flagged:** The HAS NOTE chip (warn-soft) lives in the pack column. On long pack strings (e.g., GLW-50's "50ml glass dropper bottle, screw cap"), chip may push pack text into ellipsis.

**CA disposition:** Ship as designed, instrument for telemetry. Worth banking observation during smoke + designer audit. If chip causes ellipsis on common pack strings, decision tree:
- Move chip to action column (right side of row)
- Replace with glyph-only indicator (e.g., a small note icon in fixed slot)
- Make chip conditional on pack-string length

**Implementation note:** CC should add a CSS-only ellipsis truncation on the pack string with a `title` attribute carrying the full text (so hover reveals the full pack). This is a defense-in-depth move regardless of chip behavior.

### 4.2 Pushback 2 — Drawer one-at-a-time (no multi-open)

**CD's framing:** v1 ships one-at-a-time. Multi-open mode is deferred to R7c if comparison workflows dominate.

**CA disposition:** Ship one-at-a-time via `openSkuId` local state. Opening a new row's drawer collapses any previously-open drawer. No URL param needed (drawer state is ephemeral).

**Instrumentation suggestion:** if CC has bandwidth, log drawer-open events (anonymously / aggregated) so we can measure whether PMs open multiple drawers in sequence (signal of comparison workflow demand).

### 4.3 Pushback 3 — Customer-facing notes preview routing (per confirmation A)

**Disposition:** Ship the `Preview on Quote →` link in §6.b v1. Routes through R7a breadcrumb register cleanly:
- Link target: Customer view route from surface-routes table
- Customer view loads with rail shed + breadcrumb visible: `Setup › Customer view`
- PM clicks `Setup` in breadcrumb to return cleanly — no browser-back lottery

**R7c carry-forward candidate (CD pattern):** swap the link for an inline `<details>` preview pane:
- Collapsed by default inside the customer-facing zone
- When expanded, renders Quote-PDF excerpt of just the notes block
- Same typography, same paper background as `.pdf-page`, constrained to ~600px width
- Keeps PM on Setup, no IA arc bypass

Ship link in v1; swap for inline preview in §6.b v1.1 or R7c depending on which slice has bandwidth first.

---

## §5 · Confirmation refinements

### 5.A Preview link routing (confirmation A — re-stated from §4.3)

See §4.3 above. Routes through R7a breadcrumb register; v1 ships the link, v1.1/R7c swaps for inline preview pane.

### 5.B R7B STATES tab strip — DO NOT SHIP (confirmation B)

R7b prototype has a top tab strip exposing four states: `① All collapsed · ② Assembly drawer open · ③ Leaf drawer open · ④ Empty tiers (preset picker)`. **This is review chrome only**, not production UI.

Implementation builds the four states as native interaction:
- **Default** = nothing open (no drawer expanded, tiers populated)
- **Assembly drawer open** = PM clicks the SKU row's `Components ▸` cell or `⋯` button on an assembly row; drawer expands inline; `openSkuId = sku.id`
- **Leaf drawer open** = same trigger on a leaf row; drawer shows notes textarea only (no nested component table since leaves have no components)
- **Empty tiers (preset picker)** = render the preset picker conditionally on `COUNT(quote_tiers) = 0`; no toggle UI

**Pattern 21 compliance check applies.** Banked in CLAUDE.md from RI.9 session: "R-round prototype state strips are review aids, not production UI."

### 5.C Pull from Inventory stripped from v1 (confirmation C)

The SKU table footer ships with two affordances only:
- `+ Add product` (primary blue) — modal-based, see §3.7
- `↗ Pull from HubSpot` (secondary text) — existing HubSpot product lookup

**`📦 Pull from Inventory` is NOT shipped in §6.b v1.** It returns when its own dedicated slice spawns with the three scope questions answered:
1. Which inventory? — packaging-component inventory (R6.1 `inventory_eligible` flag on packaging lines) or SKU-level inventory (finished goods on hand from prior runs)?
2. What filter? — by client, by category, by date range?
3. Carry-back semantics? — historical SKU reference (cloneable lineage) or fresh row with copied fields?

The R7b design accommodates re-adding the affordance later; v1 SKU table footer is clean, focused, no disabled-button noise.

---

## §6 · Sequencing (12 steps, parallel to RI.8 §11 + RI.9 pattern)

| Step | Work | Owner |
|---|---|---|
| 0 | Schema migration: `quote_skus.display_order INTEGER` column with default | CC |
| 1 | SKU table column restructure — new layout per §3.1 | CC |
| 2 | Type badge + click-to-toggle `sku_role` mutation | CC |
| 3 | Per-row drawer infrastructure — `openSkuId` local state, one-at-a-time enforcement | CC |
| 4 | Nested component table inside drawer — inline-editable per §3.3 (R5/R6 patterns) | CC |
| 5 | Per-SKU notes textarea inside drawer + HAS NOTE chip indicator | CC |
| 6 | Tier table parallel register — card chrome + inline edit + ★ Recommended toggle | CC |
| 7 | Tier preset picker — empty state with 4 presets per §3.5 | CC |
| 8 | Notes split — internal + customer-facing zones with audience labels | CC |
| 9 | Add-product modal with HubSpot writeback toggle (consequence-sentence pattern) | CC |
| 10 | Drag-and-drop row reordering — `quote_skus.display_order` writes | CC |
| 11 | Edward smoke pass (across all 4 R7b states + new affordances) | Edward |
| 12 | Designer agent audit (full R7b fidelity pass + cross-surface coherence vs RI.9 primitives) — see §9 audit risks | CC + Designer |

**Note: post-Step-12, fix audit findings + PR-to-main.** Following RI.9 precedent, audit findings disposition before merge.

**Sequencing rationale:** core scaffolding first (1-3), then content (4-7), then auxiliary affordances (8-10). Drag-drop last because it's the lowest-risk addition (failure mode = arrows stay broken vs anything functionally broken).

---

## §7 · Dependencies

- **RI.9 primitives shipped** — `<Eyebrow>`, `<YourNextMoveBanner>`, action cluster grammar, surface-routes table, surface-render rules table. §6.b consumes; doesn't re-implement.
- **R5 markup defaults** (`markup_defaults.markup_pct`) — nested component table defaults markup from category. Reuses existing R5 logic.
- **R5 audit log** — every SKU add/remove/role-toggle, every component add/edit/remove, every tier add/remove/qty-change, every notes-textarea blur-save writes `audit_log`. Reuses existing R5 audit infrastructure.
- **R4 inner rail** — Setup is one of 5 quote-scoped surfaces; rail shows it as active per inner-rail data shape. Already shipped; no changes.
- **R6 inline-edit pattern (Blur+Enter)** — nested component table + tier table inline cells follow R6's commit-on-blur OR Enter convention.
- **R6 consequence-sentence pattern** — HubSpot writeback toggle reads "→ writes to HubSpot in background; row appears immediately" / "→ Nexus-local only; never syncs back to HubSpot".
- **Slice 12 HubSpot writeback infrastructure** — optional dependency for §3.7.1 writeback path. Fallback: deferred queue or "coming soon" tooltip on toggle.
- **New `quote_skus.display_order` migration** — Step 0 prerequisite for Step 10.

---

## §8 · Risks + open edge cases

- **Empty SKU table state** — when `COUNT(quote_skus) = 0`, table renders header row + "+ Add product" / "↗ Pull from HubSpot" footer. R7b prototype shows populated state only. Designer agent should verify empty state matches grammar (or flag as new dimension if R7b didn't fixture it).
- **Empty quote (no SKUs AND no tiers)** — both empty states render simultaneously. SKU side shows footer affordances; tier side shows preset picker. Worth a smoke confirmation that they coexist visually without competing for attention.
- **HAS NOTE chip ellipsis regression** (Pushback 1) — instrument; if smoke flags it on common pack strings, decision tree per §4.1.
- **Drawer-open during reorder** — drag-drop on a row with open drawer: should drawer close first, or reorder happen with drawer still expanded? Recommended: drawer closes on drag-start (cleaner UX, less DOM churn during reorder).
- **`hubspot_product_id` NULL handling** — Nexus-local products (toggle OFF) leave this NULL forever. Downstream surfaces (Cost build, Customer view) should not assume hubspot_product_id is always set.
- **Type toggle on assembly with existing components** — toggling assembly → leaf hides nested components but PRESERVES them in DB (per R7b designer notes "same preserve-hidden rule as R6.1's tier-shape handling"). Toggle back → components reappear. Verify this carry-forward is implemented; banks Pattern 8 (snapshot-vs-live discipline).
- **Drag-drop accessibility** — pure drag-drop without keyboard alternative is an a11y issue. R7b designer notes don't specify keyboard reorder; worth flagging for either §6.b implementation OR R7c carry-forward. v1 ships drag-drop only; a11y enhancement can land separately.
- **Designer-agent harness truncation** (RI.9 precedent) — Step 11 audit is HIGH value on this slice (wholesale redesign, lots of fidelity surface area). Mitigation in §9 below.

---

## §9 · Step 11 Designer audit scope + harness truncation mitigation

### 9.1 Audit scope — FULL R7b fidelity pass

Designer agent walks:
1. **All 4 R7b states** (default · assembly drawer open · leaf drawer open · empty tiers / preset picker) — verify each matches R7b fixture
2. **SKU table** — column widths, Type badge styling (`▤ ASY` blue tint vs `○ LEAF` paper-3 tint), label/product/pack stacking, HAS NOTE chip placement (Pushback 1 watchpoint), components count clickability
3. **Per-row drawer** — one-at-a-time enforcement (visual + behavioral), nested component table inline-edit affordances, per-SKU notes textarea
4. **Tier table** — card chrome parity with SKU table, inline-edit affordances, ★ Recommended toggle (sibling unset on click), preset picker rendering when count=0
5. **Notes split** — purple vs green accent borders, INTERNAL vs CUSTOMER chips, audience labels at bottom of each zone, Preview on Quote link (R7a breadcrumb routing)
6. **Add-product modal** — fields, HubSpot writeback toggle with consequence-sentence pattern (R6 carry-forward)
7. **Drag-and-drop** — grip glyph styling, grab cursor on hover, smooth reorder animation, `quote_skus.display_order` writes correctly
8. **Cross-surface coherence** — Setup primitives (eyebrow, banner, action cluster) shipped in RI.9 still render correctly post-§6.b body work
9. **Pattern 21 compliance** — R7B STATES tab strip is NOT shipped (review chrome only)
10. **Pull from Inventory** — affordance is NOT present in v1 SKU table footer (per confirmation C)

### 9.2 Harness truncation mitigation

**RI.9 precedent:** Designer agent ran successfully but tool return truncated; HIGH-3 + 4 MEDIUM + 4 LOW findings lost to truncation. Direct grep on named dimensions recovered HIGH-1/HIGH-2; unnamed findings stayed lost.

**Pre-audit mitigation:**
- **Agent writes findings to disk first.** Before audit invocation, instruct agent: `Write each finding to docs/audit-findings/section-6b-{timestamp}-{finding-id}.md as you discover it. Tool return = pointer + summary only.` This makes findings recoverable from disk regardless of harness truncation.
- **Pre-name expected sweep dimensions** (catalog the agent should consult):
  1. Type badge styling sweep — `▤ ASY` vs `○ LEAF` visual fidelity
  2. Drawer one-at-a-time enforcement — verify `openSkuId` collapses prior drawer
  3. Tier preset picker conditional render — verify only when count=0
  4. Notes audience label sweep — verify both zones have explicit audience footers
  5. HubSpot writeback toggle consequence-sentence pattern — verify both ON/OFF states render correctly
  6. Drag-grip column sweep — verify grip + cursor on every SKU row
  7. Pattern 21 compliance — R7B STATES tab strip NOT shipped
  8. Pull from Inventory absence — verify NOT present in footer

**Fallback if harness truncates anyway:**
- Read all banked memory files in `docs/audit-findings/` directly (treat as audit output)
- Direct grep on each pre-named dimension
- Log any unrecovered findings to UX_BACKLOG before PR

---

## §10 · Methodological patterns expected

Slice-ri.8 + RI.9 banked patterns 1-24 in CLAUDE.md. §6.b expected to exercise:

- **Pattern 1 — Source-first authoritative** — R7b docs + HTML prototype + data-source map as canonical reference. Designer agent compares against these.
- **Pattern 8 — Snapshot-vs-live discipline** — Type toggle assembly → leaf preserves components in DB but hides them. Tier preset picker disappears after count > 0. Both are live-state behaviors that should not snapshot.
- **Pattern 11 — Design illustrative; real data needs different proportions** — R7b prototype uses 5 SKUs / 2 assemblies / 3 tiers. Production may stress longer pack strings, more components, more tiers.
- **Pattern 18 — Region-scope vs trigger-scope** — if smoke surfaces multiple drawer-related issues, scope the drawer region not individual triggers.
- **Pattern 19 — Defer-with-rationale beats forcing uniformity** — Notes zones have different visual treatment (purple vs green) intentionally; preserve the divergence.
- **Pattern 21 — R-round prototype state strips are review aids, not production UI** — R7B STATES tab strip mitigation per §5.B.
- **Pattern 22 — Verify schema before encoding DDL** — `quote_skus.display_order` migration: verify the column doesn't already exist (it doesn't) and the default backfill strategy is sensible.
- **Pattern 23 — Action-cluster adoption sweep** — Setup action cluster reads from SURFACE_META.setup, doesn't hand-roll. Verify at audit.
- **Pattern 24 — Helper reachability check** — any helpers added for drawer state, tier preset hydration, drag-drop should have call sites. Zero-call-site helpers lie about invariants.

---

## §11 · Approval status

- [x] R7a + R7b deliverables landed and signed off (prior session)
- [x] RI.9 closed (foundation primitives shipped)
- [x] Brief drafted by CA (this doc)
- [ ] Edward review + approval
- [ ] Brief committed to `docs/section-6b-brief.md` (Edward or CC)
- [ ] CC kicks off §6.b implementation per §6 sequencing

Once Edward approves and commits, §6.b is unblocked.

---

## Quick reference card

**What §6.b ships:** SKU table redesign + Tier table parallel register + per-row drawer + Notes split + Add-product modal + drag-drop reordering + `quote_skus.display_order` schema.

**What §6.b does NOT ship:** R7B STATES tab strip, Pull from Inventory affordance, inline preview pane, multi-drawer mode, drag-drop nested components, bulk SKU import, other surfaces.

**Foundation inherited from RI.9:** eyebrow, banner, action cluster grammar, surface-routes/render rules, `<NavShell>` + `<SurfaceChrome>`.

**HIGH audit value at Step 11:** mitigate harness truncation via pre-named dimensions + agent-writes-to-disk pattern.
