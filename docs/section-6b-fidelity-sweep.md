# §6.b mid-slice R7b fidelity sweep

**Status:** Audit-only. No fixes shipped from this sweep — Edward + CA disposition the delta list (patch-now / defer / carve), then polish-amendment commits land, then Step 5 resumes.

**Read alongside:**
- `docs/r7b-designer-notes.md` — canonical visual + copy treatment per primitive
- `docs/r7b-data-source-map.md` — field-level data + schema commitments
- `docs/design-prototypes/dist/Nexus Round 7b.html` — prototype shell (rails inlined; setup body external; `app/r7b/{data.js,setup.jsx,styles.css}` NOT on disk — sweep falls back to designer notes + screenshots for body)
- `docs/design-prototypes/dist/docs/r7a-designer-notes.md` — R7a canon for page chrome inherited by §6.b
- Edward smoke screenshots `docs/design-prototypes/audit-screenshots/Screenshot 2026-05-12 214323.png` (R7b) + `Screenshot 2026-05-12 214423.png` (Nexus)

**Sweep dimensions per item:**
1. **STRUCTURAL** — column count, drawer state, primitives, action wiring
2. **POLISH** — accent borders, chips, layouts, typography, color tokens, hover/focus states
3. **COPY VERBATIM** — word-for-word strings from designer notes + prototype

**Tags:**
- ✅ matched
- ❌ missing
- 🟡 partial (specify which dimension)
- DEFERRED→Step X (correctly deferred per sequencing)
- N/A (out of scope or prototype-only review chrome)

---

## §A · Page chrome (RI.9 R7a canon, inherited by §6.b)

### A.1 Eyebrow line

| Dimension | R7b/R7a spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Non-navigable eyebrow component (`<Eyebrow>`) | `<Eyebrow>` rendered above title | ✅ |
| POLISH | `.r2-eyebrow` register: mono uppercase 10.5px, ink-3, tracking 0.13em, `·` separator | Matches via `.r2-eyebrow` class | ✅ |
| COPY | `{client} · {scenario} · v{N}` per R7a canon | `{project.clientName ?? project.dealName} · {scenarioLabel} · v{N}` | ✅ |

### A.2 Page title

| Dimension | R7b/R7a spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Display h1 + softened subtitle suffix | h1 with span subtitle | ✅ |
| POLISH | Display serif (Newsreader) ~28px weight 400, line-height ~1.1, suffix ink-3 weight 400 | 28px / 400 / -0.02em / line-height 1.1; suffix ink-3 weight 400 | ✅ |
| COPY | "Setup · SKUs, tiers, notes" verbatim | "Setup · SKUs, tiers, notes" | ✅ |

### A.3 Sub-copy below title

| Dimension | R7b/R7a spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Single paragraph, sans body, ink-3 | One `<p>` rendered | ✅ |
| POLISH | 13px UI sans, ink-3, max-width 60ch | `.r1-setup-sub`: 13px ink-3 max-width 60ch | ✅ |
| COPY | "The starting shape of the quote. What we're selling, in what quantities, with what context. Cost goes on the next surface." (R7b designer notes line 7 framing; sub-copy trimmed to fit register) | "The starting shape of the quote. What **you're** selling, in what quantities, with what context. Cost goes on the next surface." | 🟡 COPY: `you're` → `we're` (R7b uses first-person plural per designer notes line 7) |

### A.4 Action cluster

| Dimension | R7b/R7a spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Right=primary, Middle=secondary, no back-direction | `<ActionCluster secondary primary>` mounted | ✅ |
| POLISH | Primary blue `r2-btn primary`, ghost `r2-btn ghost`, both currently inert (Step 8 wires Add SKU modal) | `r2-btn ghost` for Add SKU, `r2-btn primary` for Save draft, both disabled | ✅ |
| COPY | "+ Add SKU" / "Save draft" | "+ Add SKU" / "Save draft" | ✅ |

### A.5 YOUR NEXT MOVE banner

| Dimension | R7b/R7a spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | `<YourNextMoveBanner>` default state, accent border + soft fill, CTA right, label + subtitle left | Component mounted in default state | ✅ |
| POLISH (label register) | Display 16px/500 ink color | Display 16/500 ink — matches | ✅ |
| POLISH (subtitle register) | **Inline after CTA arrow on the same visual line, italic, ink-3** | Subtitle wraps as a SECOND line below label (separate `<p>` via `helpText` prop) | ❌ POLISH: subtitle stacks below label instead of rendering inline-italic with the CTA |
| POLISH (eyebrow) | Small mono accent-ink "Your next move" | Renders correctly via `<YourNextMoveBanner>` | ✅ |
| POLISH (CTA button) | Primary accent fill + paper text, mono small caps | Matches | ✅ |
| COPY (CTA label) | "Continue to Cost build →" | "Continue to Cost build →" (after cure) | ✅ |
| COPY (subtitle) | "once SKUs and tiers are settled" | "once SKUs and tiers are settled" | ✅ COPY (placement ❌ above) |

### A.6 Rationale callout strip (orientation note below banner)

| Dimension | R7b/R7a spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Single-row strip between banner and grid; non-dismissable; informational | `<div role="note">` rendered between banner and `.r1-setup-grid` | ✅ |
| POLISH (fill) | warn-soft background, warn border | warn-soft + 30% warn border | ✅ |
| POLISH (prefix tag) | **"DN · R7B" mono-caps prefix tag** (R7b prototype) — see disposition below | "ⓘ" info-glyph prefix | 🟡 POLISH: prefix shape diverges — see §D |
| POLISH (body register) | 13px ink-2, line-height 1.5 | 13px ink-2 line-height 1.5 | ✅ |
| COPY (body) | "Setup is the **starting shape** of the quote: what we're selling, in what quantities, with what context. Cost goes on Cost build (the next surface). Pricing goes on Costing sheet. The customer-facing artifact lives on Customer view." (R7b designer notes line 7 verbatim, possibly trimmed to fit) | "Setup is the **starting shape** of the quote: what **you're** selling, in what quantities, with what context. The SKU and Tier tables are a coupled pair — same inline-edit pattern, same register, paired action vocabularies. Notes split into internal (PM-only) and customer-facing (renders on Quote PDF); per-SKU notes live in **the drawer**." | ❌ COPY: (a) `you're` → `we're`; (b) missing "Cost goes on Cost build (the next surface). Pricing goes on Costing sheet. The customer-facing artifact lives on Customer view." sentence; (c) "the drawer" → "the row drawer" (per designer notes §3.6 line 37); (d) my Step 1 amendment synthesized from notes §3.6 §12+13 instead of using the source line 7 verbatim |

---

## §B · §3.1 SKU table redesign

### B.1 Column structure

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Grip · Type · Product · ~~Category~~ · Retail bench · Components · ⋯ (Category carved per Pattern 22 #5 / Slice 9 deferral) | Same 6-column layout | ✅ (Category) DEFERRED→Slice 9 |
| POLISH (column widths) | Grip 36px · Type ~80px · Product 2fr · Retail bench 120px · Components 120px · ⋯ 36px | `grid-cols-[36px_80px_2fr_120px_120px_36px]` | ✅ |
| POLISH (header register) | Mono uppercase 10.5px ink-3 tracking 0.13em | Matches `.r2-eyebrow`-like header register | ✅ |
| COPY (header labels) | "Type · Product · Retail bench · Components" | "Type · Product · Retail bench · Components" | ✅ |

### B.2 Grip column

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | `⠿` glyph leftmost; drag wires Step 9 | Static glyph rendered, no handler | ✅ (handler) DEFERRED→Step 9 |
| POLISH | Glyph centered, hover cursor grab (Step 9), ink-4 in resting state | Centered, ink-4 | 🟡 POLISH: no `cursor: grab` on hover (correctly deferred to Step 9) |
| COPY | n/a | n/a | ✅ |

### B.3 Type badge (Step 2)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Click-to-toggle button; eligible-target check via `eligibleRoleTargets`; preserve-hidden semantics on assembly→leaf with children | `<button>` wired to `handleConvertRole` with eligible-target gate | ✅ |
| POLISH | `▤ ASY` accent-tinted bg + accent-ink color + accent-30%-alpha border; `○ LEAF` paper-3 bg + ink-2 color + rule border; both with hover lift | `.r6b-type-badge[data-role]` with both variants + hover | ✅ |
| COPY (badges) | "▤ ASY" / "○ LEAF" | "▤ ASY" / "○ LEAF" | ✅ |
| COPY (titles/a11y) | Disabled-tooltip "Cannot convert to leaf — assembly has children. Detach via ⋯ menu first." | Matches | ✅ |

### B.4 Product column stack

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Stacked: `{skuLabel}` bold / `{productName}` smaller / `{pack}` smallest (when present) + HAS NOTE chip inline | label + name rendered; pack hidden until Slice 11 | ✅ STRUCTURAL (pack) DEFERRED→Slice 11 |
| POLISH (label) | Mono(?) display label slightly bolder | `text-sm font-medium text-gray-900` (sans, not mono) | 🟡 POLISH: R7b screenshot shows `GLW-30` in mono-ish register (worth confirming); my impl is sans |
| POLISH (product name) | Smaller, ink-3 | `text-xs text-ink-3` | ✅ |
| POLISH (HAS NOTE chip placement) | Inline with the pack column (designer notes §3.6 line 37 + Pushback 1 watchpoint) | Inline next to skuLabel (top of stack) | 🟡 POLISH: chip placement is at label-row, not pack-row. R7b puts it adjacent to pack so PMs spot pack-specific commentary. v1 has no pack yet so chip-near-pack isn't visually possible — current placement defensible per Pattern 22 #6 carve. Re-place once Slice 11 lands. |
| POLISH (HAS NOTE chip styling) | warn-soft fill, warn color, 9-9.5px mono caps tracking | warn-soft + 9px mono caps | ✅ |
| COPY ("HAS NOTE") | "HAS NOTE" (uppercase) | "HAS NOTE" | ✅ |

### B.5 Retail bench column

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Inline editable numeric, blur-saves | `<input type="number">` debounce-saves | ✅ |
| POLISH (input register) | Transparent border → focused border on hover/focus (R5/R6 carry-forward) | `border-gray-200` → `focus:border-gray-400`; not theme-token | 🟡 POLISH: input border uses hardcoded `gray-*` Tailwind classes instead of theme tokens (`--rule` / `--accent`). Dark-mode safety concern. |
| POLISH (formatting) | R7b screenshot shows "$48.50" with "RETAIL" sub-caption per row | Plain numeric input value; no $ prefix or sub-caption | 🟡 POLISH: USD prefix + caption absent on input affordance. R7b's `$X.XX` style is read-mode rendering; current input is always edit-mode. Polish-amendment candidate. |
| COPY | n/a | n/a | ✅ |

### B.6 Components column

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Assemblies: `{N} comps ▸` clickable drawer trigger; leaves: `—` | Button on assemblies with click → toggle drawer; em-dash on leaves | ✅ |
| POLISH (trigger styling) | Quiet text-only affordance until hover (accent on hover); expanded state highlighted | `.r6b-components-trigger` with hover + aria-expanded states | ✅ |
| COPY (label) | "{N} comp" / "{N} comps" + chevron | "{N} comp" / "{N} comps" with `▸` ↔ `▾` | ✅ |

### B.7 ⋯ overflow column

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | R7b designer notes §3.2: ⋯ button also toggles drawer; v1 keeps existing overflow menu (move/delete/reassign/refresh/HubSpot-link) since ↑↓ + delete don't have drawer-internal homes yet | ⋯ opens existing overflow menu; drawer trigger is Components cell only | 🟡 STRUCTURAL: ⋯-as-drawer-trigger deferred per Step 3 manifest. v1.1 polish target after Step 9 drag-drop retires ↑↓ from menu. |
| POLISH | Rounded border button + popup menu | Matches | ✅ |
| COPY | n/a | n/a | ✅ |

### B.8 Assembly row left-border accent

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | 2px var(--accent) left border on assembly rows; transparent on leaves (same width for vertical alignment) | `borderLeft: isAssembly ? "2px solid var(--accent)" : "2px solid transparent"` | ✅ |
| POLISH | Accent color visible at glance scale (PM scanning 20-row table) | Renders correctly | ✅ |
| COPY | n/a | n/a | ✅ |

### B.9 Count caption

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Section header carries count caption right-aligned | `<Section action={count caption}>` | ✅ |
| POLISH | Mono uppercase 10.5px ink-3 tracking 0.13em | Matches | ✅ |
| COPY | "{N} SKUs · {M} assemblies" | "{N} SKUs · {M} assemblies" | ✅ |

### B.10 Footer affordances

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | "+ Add Product" (primary) + "↗ Pull from HubSpot" (ghost text+search panel); no "Pull from Inventory" per confirmation C | Both rendered below table | ✅ |
| POLISH (primary button) | `r2-btn primary` (blue fill) | `r2-btn primary` via AddAssemblyButton | ✅ |
| POLISH (HubSpot caption) | Mono "↗ Pull from HubSpot" caption above existing search panel | Mono caption + search panel below | ✅ |
| POLISH (drag rows hint) | "Drag rows to reorder" muted right-aligned, R7b shows it in bottom-right of card | Adjacent to "+ Add Product" button left-aligned with note "wires in Step 9" | 🟡 POLISH: hint position is row-1 with the button instead of bottom-right of card; copy adds Step-9 annotation that R7b doesn't have |
| COPY (button label) | "+ Add Product" | "+ Add Product" (via triggerLabel prop) | ✅ |
| COPY (HubSpot caption) | "↗ Pull from HubSpot" | "↗ Pull from HubSpot" | ✅ |
| COPY (drag hint) | "Drag rows to reorder" | "Drag rows to reorder · wires in Step 9" | 🟡 COPY: extra annotation added; strip the suffix |
| COPY (empty state) | n/a in R7b (prototype doesn't show empty state) | 'No SKUs yet. Use "+ Add Product" or "↗ Pull from HubSpot" below to start.' | ✅ (CC-authored fallback for empty state; R7b doesn't fixture it) |

---

## §C · §3.2 + §3.3 Per-row drawer (Step 3 + 4 already shipped)

### C.1 One-at-a-time drawer state

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | `openSkuId` lifted state; opening another row collapses prior; no URL param (ephemeral) | `<SkuRowList>` holds `openSkuId`, toggle handler collapses prior | ✅ |
| POLISH | Drawer renders as inline expansion (R6 drill-down pattern), paper-2 zone with rule top/bottom | `.r6b-drawer`: paper-2 bg, rule top/bottom borders, 16/20px padding | ✅ |
| COPY | n/a | n/a | ✅ |

### C.2 Drawer trigger sources

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Components ▸ on assemblies OR ⋯ button on any row | Components ▸ on assemblies; HAS NOTE chip on leaves with notes; "+ note" subtle affordance on leaves without notes; ⋯ retained as existing overflow menu | 🟡 STRUCTURAL: ⋯-as-drawer-trigger deferred; CC introduced HAS NOTE chip + "+ note" as leaf entry points (compensates for ⋯ retention but diverges from R7b's single-trigger ⋯ vision) |
| POLISH | n/a | HAS NOTE chip hover state warn-ring; "+ note" subtle ink-4 affordance | ✅ |
| COPY | n/a | "+ note" CC-authored leaf affordance copy; not from R7b | 🟡 COPY: "+ note" is CC-authored; R7b spec has no leaf-without-note affordance because ⋯ was the universal trigger |

### C.3 Drawer body — assembly (child-SKU navigation list, carved per Mismatch 1 γ)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | R7b spec calls for inline-editable nested component table. CARVED to navigation list per Pattern 22 (`packaging_inputs` on Cost build owns per-component cost data; unification banked as §6.c candidate) | Read-only child-SKU table + "↗ Cost build" link per leaf child + "+ Add child SKU" footer | ✅ STRUCTURAL (carve) |
| POLISH (subsection card) | Paper bg + rule border + 8px radius + 12-14px padding (R5 nested-card register) | `.r6b-drawer-section` matches | ✅ |
| POLISH (table headers) | Mono uppercase ink-3 caption + bottom-rule | `.r6b-drawer-table` matches | ✅ |
| POLISH (link styling) | Mono accent-ink + hover underline | `.r6b-drawer-link` matches | ✅ |
| COPY (column labels) | "Label · Product · Type · Qty/parent · Open" (CC-authored for carved navigation list — R7b spec was different columns per inline-edit) | Matches CC-authored | ✅ (carved; CC owns) |
| COPY (empty state) | n/a in R7b (carved feature) | "No child SKUs yet. Add one below or assign existing SKUs to this assembly via the row's ⋯ menu." (CC-authored) | ✅ (carved) |
| COPY ("↗ Cost build" link) | n/a in R7b (carved) | "↗ Cost build" | ✅ (carved) |
| COPY ("+ Add child SKU") | "+ Add child SKU" | "+ Add child SKU" | ✅ |

### C.4 Drawer body — per-SKU notes textarea

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Always present (assembly + leaf); writes `quote_skus.notes`; autosave on blur; "internal-only" label | `<DrawerNotes>`: blur saves via existing `updateSku` action with ⌘/Ctrl+Enter commit | ✅ |
| POLISH | Subsection card + textarea register matching the rest of the drawer | `.r6b-drawer-textarea`: paper-2 bg, rule border, UI sans 13/1.5, focus state lifts to paper + accent border | ✅ |
| COPY (section title) | "Per-SKU notes" + "internal-only" label per designer notes §3.6 line 37 | "Per-SKU notes · internal-only" | ✅ |
| COPY (sub-caption) | n/a (R7b's "internal-only" is the only label) | "Lives on this SKU. Never renders on the Quote PDF." (CC-authored explanatory caption) | 🟡 COPY: CC added explanatory caption beyond R7b's "internal-only" label. Polish-amendment candidate: trim to verbatim "internal-only" if Edward prefers minimal copy. |
| COPY (placeholder) | n/a in R7b | "e.g., 'PM follow-up: confirm pack with supplier before quote send.'" (CC-authored) | ✅ (CC-authored placeholder, R7b doesn't fixture) |

---

## §D · Rationale callout "DN · R7B" prefix tag — Pattern 21 investigation

**Edward's smoke flag:** R7b prototype shows the rationale callout with a "DN · R7B" mono-caps prefix tag (left-aligned, accent-tinted). Open question: is this production UI or prototype-only chrome?

**Investigation findings:**

1. **R7b designer notes** — searched the full document for "DN" / "designer note" / "R7B" prefix references. The string "DN · R7B" does NOT appear in the canonical visual treatment spec. The designer notes describe the rationale framing (line 7) but don't specify a prefix-tag affordance for it.

2. **R7b prototype source access** — `docs/design-prototypes/dist/app/r7b/{data.js,setup.jsx,styles.css}` are referenced by `Nexus Round 7b.html` but **don't exist on disk**. Only the HTML shell + designer-notes markdown + data-source-map markdown are present. Means I can't definitively verify the prefix's CSS class or label-rendering context from prototype source.

3. **R7b HTML shell inspection** — what IS on disk: the inlined rails JSX + the `.r7b-state-strip` review chrome (which Pattern 21 already confirms is prototype-only and is correctly NOT shipped in Nexus). The shell carries `data-theme` attribute + `TWEAK_DEFAULTS` postMessage chrome — both review-only patterns.

4. **Pattern recognition** — "DN · R7B" reads as "Designer Note · Round 7b": a tag identifying canonical-rationale text in the prototype context, for designers/reviewers walking the surface against the notes. Same shape as the R7b state strip's review chrome (`R7B states · ① All collapsed · ② Assembly drawer open · ...`) — both annotate the prototype with its round identity.

5. **Comparison to RI.9 R7a precedent** — R7a's "Resume" card + "YOUR NEXT MOVE" banner shipped without round-identifier prefix tags. R7a designer notes don't reference "DN · R7A" tags either. The R7-round prefix tag is not part of the shipped surface vocabulary in any prior slice.

**Disposition recommendation: prototype-only review chrome (Pattern 21).** Strip the prefix; do NOT ship "DN · R7B" as production text. The rationale callout body (Setup is the starting shape...) IS production text and stays. The prefix is the annotation framing.

**Replace with:**
- Current Nexus: "ⓘ" info glyph prefix
- Recommended: strip the prefix entirely, OR replace with a minimal mono caption like "ORIENTATION" or no prefix at all. Edward + CA disposition.

**Banking:** Pattern 21 third instance — first was R-round STATES tab strips (banked RI.9 / §6.b), second was R7a/R7b nav IA review widgets, third is the "DN · R<round>" prefix-tag pattern. Worth adding "round-identifier prefix tags" to the Pattern 21 list of recognized review-chrome shapes.

---

## §E · §3.4 Tier table parallel register (Step 5 — not implemented)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Coupled register with SKU table: same card chrome, inline-edit row cells, footer pill `+ Add tier`. Columns: Label · ★ Recommended · Qty · Price adj % · ×. ★ click sets recommended (unsets siblings) | Existing v1 TierRow / TierHeader / AddTierButton; not R7b-redesigned | DEFERRED→Step 5 |
| POLISH | Per §3.4 designer notes: card chrome (paper bg + rule border + 12px radius + padded card-head with title + meta); inline `<input>` cells with transparent-→-focused border; dashed-border `+ Add tier` pill | v1 styling carried | DEFERRED→Step 5 |
| COPY | "+ Add tier"; column labels "Label", "Quantity", "Actions" per data-source map | v1 copy | DEFERRED→Step 5 |

### E.1 ★ Recommended toggle (within Step 5)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Click toggles `quote_tiers.recommended`; one per quote (clicking another tier unsets prior) | Not implemented | DEFERRED→Step 5 |
| POLISH | Star glyph in dedicated column; filled when recommended, outlined when not | n/a | DEFERRED→Step 5 |
| COPY | n/a (glyph only) | n/a | DEFERRED→Step 5 |

---

## §F · §3.5 Tier preset picker (Step 6 — not implemented)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Empty state only — renders when `COUNT(quote_tiers) = 0`. 2×2 grid of 4 presets (3-tier step / 4-tier step / First-PO / Volume break). Click populates tiers + collapses picker. NOT re-shown after first tier exists. | Existing `<TierPresetSelect>` (v1) | DEFERRED→Step 6 |
| POLISH | Grid layout, each preset as click-target card | v1 styling | DEFERRED→Step 6 |
| COPY (preset names) | "3-tier step (5k · 10k · 25k)" · "4-tier step (5k · 10k · 25k · 50k)" · "First-PO (10k single tier)" · "Volume break (10k · 50k · 100k)" per data-source map §Tier preset picker | v1 copy (may differ) | DEFERRED→Step 6 |

---

## §G · §3.6 Notes split (Step 7 — pulled forward + shipped in commit `a22aa03`)

### G.1 Layout + card chrome

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Two side-by-side cards at page bottom | `.r6b-notes-grid`: `grid-template-columns: 1fr 1fr` with 16px gap; stacked under 900px | ✅ |
| POLISH (Internal accent) | Purple `--internal` left-accent 3px border | `border-left: 3px solid var(--internal)` via `data-zone="internal"` | ✅ |
| POLISH (Customer accent) | Green `--good` left-accent 3px border | `border-left: 3px solid var(--good)` via `data-zone="customer"` | ✅ |
| POLISH (card chrome) | Paper bg, rule border, 10px radius, padded | 16/18px padding, 10px radius, paper bg, rule border | ✅ |
| COPY | n/a | n/a | ✅ |

### G.2 Chips + subtitles

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Top-right chip per card | `.r6b-notes-chip` rendered top-right of each card head | ✅ |
| POLISH (Internal chip) | INTERNAL chip purple-soft bg + internal-color text | `data-chip="internal"`: `internal-soft` bg, `internal` color | ✅ |
| POLISH (Customer chip) | CUSTOMER chip green-soft bg + good-color text | `data-chip="customer"`: `good-soft` bg, `good` color | ✅ |
| COPY (Internal chip) | "INTERNAL" | "INTERNAL" | ✅ |
| COPY (Customer chip) | "CUSTOMER" | "CUSTOMER" | ✅ |
| COPY (Internal subtitle) | "PM-ONLY · NEVER CUSTOMER-VISIBLE" mono uppercase | "PM-only · never customer-visible" — same words, mixed case | 🟡 COPY: case differs (R7b uses uppercase per designer notes register). My implementation uses sentence case with mono uppercase CSS, which renders all-caps visually via `text-transform: uppercase`. Verify CSS does this on `.r6b-notes-card-subtitle` — yes, the class has `text-transform: uppercase` so visual output IS uppercase. ✅ effective. |
| COPY (Customer subtitle) | "RENDERS ON THE QUOTE PDF" | "Renders on the Quote PDF" + CSS uppercase | ✅ (same as Internal — CSS does the visual transform) |

### G.3 Audience footers

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Footer per card with audience-label prefix + descriptive text | `.r6b-notes-card-footer` rendered per card | ✅ |
| POLISH | Mono "Audience:" prefix uppercase ink-2; body 11.5px ink-3 line-height 1.55; top-rule separator | `.r6b-notes-audience-label` + footer text register | ✅ |
| COPY (Internal footer) | "Audience: you, other PMs, and admins. Sourcing dependencies, customer phone notes, R&D blockers go here." (R7b designer notes §3.6 line 38, paraphrased) | Same string | ✅ |
| COPY (Customer footer) | "Audience: the customer (renders on the Quote PDF and Mark-Accepted snapshot). Boundary-guard: this text travels with the quote artifact." | Same string | ✅ |

### G.4 Preview on Quote link

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Link in customer-zone footer; routes to Customer view per R7a breadcrumb register | `<Link>` to `/projects/{id}/quotes/{quoteId}/quote` | ✅ |
| POLISH | Mono `--good` color, hover underline | `.r6b-notes-preview-link`: mono 11px `--good` color, hover underline | ✅ |
| COPY | "Preview on Quote →" | "Preview on Quote →" | ✅ |

### G.5 Textarea register

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Per-zone textarea writing `quotes.{internal,customer_facing}_notes`; autosave on blur (R6 Blur+Enter pattern) | Debounced (800ms) save via `updateQuoteNotes` action | ✅ |
| POLISH | Paper-2 bg + rule border + 6px radius + UI sans 13/1.5, focus state lifts to paper + accent border | `.r6b-notes-textarea` matches | ✅ |
| COPY (placeholder Internal) | n/a | "e.g., 'Customer requested matte tube finish in Apr 24 call; pending sourcing confirm.'" (CC-authored) | ✅ |
| COPY (placeholder Customer) | n/a | "e.g., 'Pricing valid for 30 days. Lead time begins after artwork approval.'" (CC-authored) | ✅ |

---

## §H · §3.7 Add-product modal (Step 8 — not implemented)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Modal with fields: Product name · Type (leaf/assembly) · Pack · Category · Units per pack · HubSpot writeback toggle. Confirm inserts `quote_skus` immediately + async writeback (Slice 12 dependency) | Existing v1 `AddAssemblyButton` (placeholder); no modal | DEFERRED→Step 8 |
| POLISH (consequence-sentence) | R6 consequence-sentence pattern on writeback toggle: ON → "→ writes to HubSpot in background; row appears immediately" / OFF → "→ Nexus-local only; never syncs back to HubSpot" | n/a | DEFERRED→Step 8 |
| COPY (toggle copy) | Verbatim sentences above | n/a | DEFERRED→Step 8 |

---

## §I · §3.8 Drag-and-drop row reordering (Step 9 — not implemented)

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Grip glyph triggers drag; drop writes `quote_skus.sort_order` (Pattern 22 #4 — reusing existing column) | Static glyph; ↑↓ in overflow menu temporarily | DEFERRED→Step 9 |
| POLISH (cursor) | `grab` cursor on hover, `grabbing` during drag | None yet | DEFERRED→Step 9 |
| POLISH (animation) | Smooth reorder animation | None yet | DEFERRED→Step 9 |
| COPY (drag hint) | "Drag rows to reorder" (per R7b prototype footer hint) | "Drag rows to reorder · wires in Step 9" | 🟡 COPY: see §B.10 — strip the Step-9 annotation |

---

## §J · Pattern 21 review-chrome (should NOT ship)

### J.1 R7B STATES tab strip

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Pattern 21: prototype-only review chrome. R7b shell shows it (`① All collapsed · ② Assembly drawer open · ③ Leaf drawer open · ④ Empty tiers`). Production does NOT ship. | NOT shipped in Nexus | ✅ N/A (correctly absent) |

### J.2 "DN · R7B" rationale-callout prefix tag

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | Edward's smoke flag: prefix tag in R7b rationale callout. Investigation §D concludes: prototype-only chrome (Pattern 21 third instance). Production does NOT ship. | Current Nexus uses "ⓘ" info-glyph prefix — different but also CC-authored not from designer notes | 🟡 Polish-amendment: strip Nexus's "ⓘ" prefix per investigation, OR replace with minimal mono caption (Edward + CA disposition) |

### J.3 R7b shell features

| Dimension | R7b spec | Nexus state | Tag |
|---|---|---|---|
| STRUCTURAL | `data-theme="light"` attribute on `<html>` (prototype theme toggle); `TWEAK_DEFAULTS` postMessage chrome; back-link to R7a + Designer notes + Data-source map at top | NOT shipped in Nexus | ✅ N/A (review chrome) |

---

## Summary delta list

### ❌ Polish-amendment candidates (patch before resuming Step 5)

1. **Banner subtitle layout** — render inline italic after CTA on same visual line (not stacked below). Update `<YourNextMoveBanner>` primitive OR pass subtitle differently. (§A.5)
2. **Rationale callout prefix** — strip "ⓘ" CC-authored prefix per Pattern 21 §D investigation. Replace with minimal mono caption OR no prefix at all. Edward + CA disposition.
3. **Rationale callout body copy** — use R7b designer notes line 7 verbatim: "Setup is the **starting shape** of the quote: what we're selling, in what quantities, with what context. Cost goes on Cost build (the next surface). Pricing goes on Costing sheet. The customer-facing artifact lives on Customer view." Strip my synthesis from §3.6 §12+13. (§A.6)
4. **Sub-copy under title** — change `you're` → `we're` to match designer notes line 7 first-person plural register. (§A.3)
5. **Drag hint copy** — strip "· wires in Step 9" annotation; ship just "Drag rows to reorder". (§B.10)

### 🟡 Polish-partial (worth bumping; not load-bearing for foundation)

6. **HAS NOTE chip placement** — currently at label-row; R7b places adjacent to pack column. Wait for Slice 11 to land `quote_skus.pack`, then re-place. (§B.4)
7. **Retail bench input register** — uses hardcoded Tailwind `gray-*` classes; should use theme tokens (`--rule` / `--accent`) for dark-mode safety. (§B.5)
8. **Retail bench USD prefix + caption** — R7b shows "$X.XX" + "RETAIL" sub-caption; current is plain numeric input. Could add `$` prefix to input + read-mode sub-caption. Defensible polish-amendment. (§B.5)
9. **Per-SKU notes sub-caption** — CC added explanatory line beyond R7b's "internal-only" label. Trim to verbatim if Edward prefers minimal copy. (§C.4)
10. **"+ note" leaf affordance copy** — CC-authored compensation for ⋯-as-drawer deferral. Edward + CA disposition: keep as v1.1 or refine. (§C.2)
11. **Drag-hint position** — currently with "+ Add Product" left-aligned; R7b shows bottom-right of card. (§B.10)
12. **Product cell label font** — R7b shows mono-ish register for SKU label like `GLW-30`; CC uses sans-medium. Worth confirming via Edward + screenshot zoom. (§B.4)

### DEFERRED (correctly per sequencing)

- Tier table register → Step 5 (§E)
- ★ Recommended toggle → Step 5 (§E.1)
- Tier preset picker → Step 6 (§F)
- Add-product modal → Step 8 (§H)
- Drag-and-drop wiring → Step 9 (§I)
- ⋯-as-drawer-trigger universal → Step 9 follow-up (§B.7, §C.2)
- HAS NOTE chip re-placement to pack column → Slice 11 (§B.4)
- Category column restoration → Slice 9 (§B.1)
- Pack sub-text rendering → Slice 11 (§B.4)

### NOT-IN-ANY-STEP / carve candidates

- Inline-editable nested component table → §6.c or R7c (Pattern 22 #1 / Mismatch 1 carve disposition γ)
- Drag-and-drop nested drawer components → R7c (per R7b designer notes "Carry-forward to R7c")
- Multi-drawer mode → R7c (per R7b Pushback 2)
- Inline preview pane for customer-facing notes → R7c (per R7b Pushback 3)
- Bulk SKU import → separate slice (per R7b "Carry-forward to R7c")

---

## Recommended action order

1. **Edward + CA disposition** the ❌ list (items 1-5). All patch-now candidates; lightweight commits.
2. **Edward + CA disposition** the 🟡 partial list (items 6-12). Bucket into patch-now / defer / carve.
3. **CC ships polish-amendment commits** for the disposition'd ❌ + 🟡 items. Each commit carries the two-layer manifest (Pattern 27) + cites the §A-§J item it addresses.
4. **Resume Step 5** (Tier table parallel register).

After this sweep + amendments, the §6.b foundation reads as R7b-faithful across visual + copy dimensions before Steps 5-9 stack on top.

---

**Banked for Pattern 21 list update:** "round-identifier prefix tags" (`DN · R<round>`) added to the recognized review-chrome shapes alongside STATES tab strips + tweak panels.

**Banked for Pattern 26/27/28:** copy verbatim is now an explicit fidelity dimension (CLAUDE.md updated in commit alongside this sweep doc).
