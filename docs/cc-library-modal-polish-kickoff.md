# slice-library-modal-polish · Step 1 kickoff

**Branch:** `slice-library-modal-polish`
**Step:** 1 (kickoff + Pattern 30 path determination + Pattern 22
§0.5 verification + step plan lock)
**Date:** 2026-06-15
**Companion docs (CD-shipped):**
- `docs/design-prototypes/dist/library_modal.jsx` (263 lines)
- `docs/design-prototypes/dist/library_styles.css` (381 lines)
- `docs/design-prototypes/dist/library_data.js` (mock data)
- `docs/design-prototypes/dist/docs/cd-library-modal-designer-notes.md`
  (126 lines — Pattern 30 fidelity contract)
- `docs/design-prototypes/dist/docs/cd-library-modal-data-source-map.md`
  (113 lines — binding contract)
**Predecessor:** PR #51 (slice-library-first-creation-flow) merged
`5d1179e`. This slice polishes the LibraryBrowseModal that PR #51
established as the canonical "+ Add component" entry point.

---

## §1 — Slice purpose

Polish the LibraryBrowseModal per CD's redesign. PR #51 made the
modal canonical; this slice ships the visual + interaction
redesign per the CD prototype.

**The core decisions** (CD designer notes §1, §3):

1. **Table-rows over cards** — fixed-height (56px), columnar grid
   discipline (4px rail · 1fr name+sub · 150px Type · 120px Status
   · 96px Action). Scales to ~990 HubSpot catalog items without
   collapse.
2. **Persistent prominent attach-target bar** below header —
   reads as a real control (accent-ringed, bordered, named ASY
   with `ASY-id · N components` sub). Row buttons just say
   "Attach"; the bar is the single source of the destination.

Everything downstream (status rails + tint, source badges,
demoted usage caption, two empty shapes, subtle refresh, inline
progress band slot) flows from these two.

**UI + loader only.** No schema changes. No new server actions.

---

## §2 — Pattern 30 path determination

**Path B-default** (canonical CSS verbatim, prefix-clean
selectors).

CD's CSS uses `.lib-*` prefix throughout the modal-interior
chrome. Spot-checked selectors all carry the namespace:
`.lib-stage` (review chrome — drops), `.lib-strip` (review
chrome — drops), `.lib-modal`, `.lib-head`, `.lib-refresh`,
`.lib-close`, `.lib-pull-band`, `.lib-target-bar`,
`.lib-target-select`, `.lib-target-menu`, `.lib-filters`,
`.lib-search`, `.lib-seg`, `.lib-result-count`, `.lib-results`,
`.lib-table-head`, `.lib-row`, `.lib-empty`, `.lib-empty-cta`.

No collision risk with existing global classes. Drop-in at file
root; no parent-scope wrap needed.

**Imported verbatim from:** `docs/design-prototypes/dist/library_styles.css`
**Destination:** `src/styles/r-library-modal.css`
**Deliberate drops (review chrome only; not production UI):**
- `.lib-stage` + `.lib-stage-hint` (demo container)
- `.lib-strip` + `.lib-strip *` (scenario switcher review aid)
- `.lib-blurb` (designer commentary banner)
- `.theme-tog` styling under `.lib-strip .right`

Same precedent as Pattern 31 rejection of R7a/R7b state strips.
Drops documented in the file header per Pattern 30.

**Tokens verified:** all 19 tokens CD references exist in
`src/styles/design-tokens.css`. Zero token gaps; Path B-default
adoption is clean.

**Canonical frame reuse (no redesign):**
- `.a1v2-modal-backdrop` (PR #50 commit 4 fixed positioning)
- `.a1v2-modal` (sizing override via `.lib-modal` class:
  `width: min(940px, 100%)`)
- `.a1v2-toast` (attach confirmations — unchanged from PR #51
  Step 4)
- `.r-a1v2-modal-stacked` (AddProductModal-on-top — unchanged
  from PR #51 Step 4)

CD's data-source map §"Pattern 27 manifest" confirms this scope.

---

## §3 — §11 dispositions (Edward 2026-06-15)

CD designer notes §11 had three open-for-CA questions. All
locked per Edward + CC-lean concur:

| Q | Disposition |
|---|---|
| Q1 | Virtualization / pagination at 990 items: **defer to v1.1+**. Row height fixed for trivial future virtualization. Production currently ~30 leaves; perf threshold dozens-of-screens away. |
| Q2 | Archived row CTA: **`Restore`**. Concise; matches recovery vocabulary used elsewhere. |
| Q3 | Multi-target attach: **bank as v1.5+ carry-forward**. Single-target attach-target bar stays in v1. |

Banked in §6 carry-forwards below.

---

## §4 — Pattern 22 §0.5 verification ledger

Pre-build verification against current `main` post-PR-#51 merge.
Five catches dispositioned.

### Catch #1 — `leaf.readiness` derived field

CD data-source map §"Result row" expects `leaf.readiness` ∈
{`ready`, `attached`, `archived`} per row. Current
`LibraryBrowseRow` returns `archived` + `attachedAssemblyIdsInTargetQuote`
(both already present from library-first Step 2 lineage). Both
inputs to readiness derivation already available.

**Disposition (Edward confirmed):** derive **client-side** in
the modal per CD designer notes §7 "re-evaluate when target
changes" — readiness changes when the attach-target bar
selection changes; loader can't know the target. Step 5 derives
`readiness` in the row map alongside the existing `alreadyHere`
check.

### Catch #2 — Subtitle requires `client_name` + `quote.id`

CD subtitle format: `{client} · {qid}`. Current modal renders no
subtitle. `projects.client_name` exists at `schema.ts:225`;
joinable through `quotes.project_id`.

**Disposition (Edward confirmed):** **extend `loadLibraryBrowse`
loader** to surface `clientName` alongside the existing
`scenarioLabel`. Single trip (joins quotes → projects). Already-
proven pattern from library-first Step 2 (which added libraryTotal
+ scenarioLabel to the same loader). The `quote.id` portion of the
subtitle is the already-passed `targetQuoteId` prop; no new data
fetch.

### Catch #3 — `leaf.factory` search dimension

CD data-source map §"Filter row" Search row claims search by
"name, SKU, or factory." Schema check (`schema.ts:1676-1730`):
`leaves` columns are name, sku, url, image_url, productTypeId,
unitCost, fscClaim, fscStatus, supplierVerified, ownerId,
archived, hubspotProductId, createdAt, updatedAt. **No `factory`
column.**

**Disposition (Edward confirmed):** **drop "factory" from CD's
intent.** Schema doesn't carry the column; adding it for one
search dimension is scope creep into Slice 9 / catalog enrichment
territory. Current search (`leaves_loader.ts` ILIKE on name + sku)
preserved as-is. Bank as v1.1+ candidate if factory metadata ever
lands on the leaves table.

### Catch #4 — Status pill + source badge new visual primitives

CD adds two new visual primitives:
- **Source badge** — `Nexus` / `HubSpot` chip; derived client-
  side from `hubspotProductId != null`
- **Status pill** — small dot + word ("ready" / "attached" /
  "archived") in the Status column; driven by readiness derivation

Neither has a Nexus precedent class; CD's CSS introduces
`.lib-source` + `.status-pill.{ready,attached,archived}` rules
in `library_styles.css`.

**Disposition (CC):** ship as Pattern 30 canonical CSS adoption
(Path B-default) per §2 above. Class names from CD's source
preserved verbatim; Pattern 27 polish manifest documents the
new primitives.

### Catch #5 — Type filter taxonomy

CD's prototype hardcodes `TYPE_FILTERS` array: All types, Primary
(pp), Secondary (sp), Tertiary, Soft goods. These appear to be
**packaging categories**, not Nexus's full `product_types` set.

Current loader returns `leafTypesForFilter` (all leaf-scope
product types from the `product_types` table). The CD prototype
likely synthesized these for visual mock; production wires to
the real `leafTypesForFilter` chain.

**Disposition (CC):** wire to existing `leafTypesForFilter` prop
chain (already plumbed page → AssemblyTreeView → LibraryBrowseTrigger
→ LibraryBrowseModal from PR #51). The CD prototype's hardcoded
list is mock data; production list reflects the real
`product_types` set, scope-filtered to `leaf` per impl-3.
Segmented control renders any-N types (CD's grid handles 2-5
visible variants via CSS).

---

## §5 — Step plan (locked)

8 steps. Each implementation commit (Steps 2-7) carries a
Pattern 27 two-layer manifest per the standing protocol.

1. ✅ **Step 1** — Kickoff + Pattern 30 path determination + §0.5
   verification + step plan (this document)
2. **Step 2** — Canonical CSS import + design tokens audit +
   `loadLibraryBrowse` loader extension surfacing `clientName`
   from projects join; documented review-chrome drops
3. **Step 3** — Modal frame + header redesign (`.lib-head`,
   `.lib-refresh`, `.lib-close`, sizing override via `.lib-modal`)
4. **Step 4** — Persistent attach-target bar (`.lib-target-bar`,
   `.lib-target-select`, `.lib-target-menu` picker popover);
   row buttons simplified to "Attach" (target lives on the bar)
5. **Step 5** — Filter row consolidation (single row: search +
   type segmented + count) + 5-column results table grid + row
   rendering (rail · name+sub · type · status pill · action);
   `leaf.readiness` derivation client-side
6. **Step 6** — Two empty shapes (filtered-zero ∅, library-empty
   ⊹) + permission notes beneath CTAs when `!canCreateLeaves`
7. **Step 7** — Inline pull-progress band redesign (`.lib-pull-band`
   between header + attach-target bar — fixed slot, no reflow);
   replaces the Step 5 inline band from PR #51
8. **Step 8** — Smoke guide LMP-1..LMP-7 + cumulative Pattern 27
   manifest + §0.5 catch ledger

---

## §6 — Pre-merge gates

- [ ] Typecheck PASS every commit (`npx tsc --noEmit`)
- [ ] Pattern 47 verify PASS every commit (LibraryBrowseModal's
      search input is the existing instance to preserve)
- [ ] Pattern 22 §0.5 verification PASS (this kickoff; no further
      schema checks expected)
- [ ] Pattern 27 two-layer manifest per implementation commit
- [ ] Pattern 28 — fidelity contract is the CD prototype +
      designer notes; visual + copy verbatim from upstream
- [ ] Pattern 30 — Path B-default canonical CSS adoption;
      `src/styles/r-library-modal.css` matches upstream verbatim
      with documented review-chrome drops
- [ ] Pattern 45 customer-view boundary clean (no PDF tree
      impact; LibraryBrowseModal is PM-internal)
- [ ] CB end-of-phase smoke walk (merge gate)

---

## §7 — Carry-forwards (banked)

From CD designer notes §11 + CC review:

- **Virtualization / pagination at 990 items** (Q1) — v1.1+;
  row height fixed for trivial future virtualization
- **Multi-target attach** (Q3) — v1.5+; attach-target bar
  evolves to multi-select when the workflow lands
- **`factory` search dimension** — v1.1+ if metadata ever lands
  on the leaves table; not adding the column for this slice
- **Scenario filter** (CD designer notes §8) — dropped from
  primary filter row as chrome weight; banked as advanced /
  overflow affordance if PMs request

From the CD designer notes §11 also-tracked:
- Result count "16 of 990" — when full catalog lands, may want
  virtualized infinite scroll or pagination

---

## §8 — Predecessor state inherited

PR #51 merged 2026-06-15 (`5d1179e`). On `main`:

- LibraryBrowseModal as canonical "+ Add component" entry point
- `loadLibraryBrowse` extended return shape: `{ rows, total,
  libraryTotal, scenarioLabel }` — this slice extends to add
  `clientName`
- Two-shape empty-state copy split (truly-empty vs filtered-empty)
  — this slice replaces the simple `<p>` copy with CD's full
  `.lib-empty` shape (glyph + heading + body + dual CTA row)
- `+ Create new product →` CTA inside both empty shapes — this
  slice preserves the wire-up; only the visual treatment changes
- AddProductModal stacking with `r-a1v2-modal-stacked` z-index
  110 — unchanged
- Attach toast inside LibraryBrowseModal — preserved
- Inline pull-progress band — replaced by CD's `.lib-pull-band`
  spec in Step 7
- `↗ Refresh from HubSpot` button in header — replaced by CD's
  `.lib-refresh` spec in Step 3 (subtle bordered control; not
  the current ghost button)
- Permissions prop chain (`canCreateLeaves`) — preserved; CD's
  empty-states get permission notes beneath the CTAs

Heap-bump `a09ecb8` from PR #50 era gives the dev environment
8GB headroom across this slice's HMR cycles.

---

## §9 — Standing by

Step 1 PASS. Cleared to proceed to Step 2 on Edward's next
directive.

Loader extension + canonical CSS import + review-chrome drops
are the load-bearing changes of Step 2; Steps 3-7 build the
visual layers on top.

— CC, 2026-06-15
