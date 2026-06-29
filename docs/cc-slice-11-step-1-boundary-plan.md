# Slice 11 Step 1 — Pattern 45 customer-view boundary plan

**Author:** CC
**Date:** 2026-06-29
**Status:** read-only research; awaits Edward + CA disposition
**Brief:** `docs/cc-comm-slice-11-customer-pdf-brief.md`
**Audit input:** `docs/cc-customer-pdf-audit-slice11-input.md` §3 (boundary
grep against CD's prototype)
**Existing verifier:** `scripts/verify/customer-view-boundary.ts` (111 lines)

Pattern 45 (customer-facing render data-source verification, **promoted
to standing** during the rest-of-app sweep Step 10 audit, 2026-05-14) +
the original RI.6 boundary-guard build invariant frame this work. The
react-pdf port introduces a NEW component tree that must continue to
honor the boundary; this plan covers verifier extension, naming, gate
sequencing, and CB-walk smoke checklist.

---

## §1 · Existing verifier scope

`scripts/verify/customer-view-boundary.ts` (last touched RI.8 surface
canon rename) sweeps the tree as follows.

### 1.1 — Sweep targets

| Aspect | Current behavior | Citation |
|---|---|---|
| Root path | `src/components/pdf/` only — every `.tsx` or `.ts` file recursively under that directory | `customer-view-boundary.ts:30` |
| File-type filter | `.tsx` AND `.ts` (no `.test.ts` exclusion; tests don't live in that subtree) | `customer-view-boundary.ts:59` |
| Recursion behavior | full sub-tree walk via `listFiles(dir)` | `customer-view-boundary.ts:52-62` |
| Empty-directory tolerance | logs `[customer-view-boundary] src/components/pdf/ does not exist yet — nothing to verify.` and `exit(0)` if root doesn't exist | `customer-view-boundary.ts:69-72` |

### 1.2 — Forbidden import patterns (regex-based; matched against
the `from` clause of `import|export ... from '...'` statements):

| Pattern | Reason | Surface scope |
|---|---|---|
| `^@/components/costs` | Costs surface (post-RI.8 rename, was `cost-build`) | the Costs sub-tree |
| `^@/components/pricing` | Pricing surface (post-RI.8 rename, was `costing`) | the Pricing sub-tree |
| `^@/components/internal-only-badge` | customer-invisible signal | shared chrome |
| `^@/lib/costing(-store)?$` | costing math / store | the core math layer + Zustand store |
| `^@/db(/schema)?$` | full DB schema with internal columns | Drizzle schema |
| `^@/app/actions/` | server actions (costing-adjacent + side-effectful) | every action file |

### 1.3 — Failure mode

- Process-level: `process.exit(1)` with per-violation citation
  (`file + importPath + reason`) (`customer-view-boundary.ts:92-105`)
- npm-script-level: `verify:boundaries` runs the script via
  `node --experimental-strip-types`
  (`package.json` "scripts" block)
- Build-gate-level: `prebuild` chain calls
  `npm run verify:boundaries && npm run verify:autosave-focus-stability
  && npm run verify:pricing-classifier-invariants`. `next build`
  invokes `prebuild` automatically.

### 1.4 — What the existing verifier does NOT catch

The verifier is **import-statement-shape only**. It does not catch:

1. **Forbidden VALUES being rendered into customer-facing text.** A
   component could import `view.tierPrices` (legal) but format the
   number string with `view.somePrivateField` (illegal field if it
   existed on `CustomerView`). The boundary type (`src/types/quote.ts`)
   plus the TS compiler is what enforces "what fields exist on the
   prop"; the verifier doesn't second-guess that.
2. **Hardcoded synthetic strings shipping to customers.** Pattern 45
   Step 9 + Step 10 found two of these (`{customer-pending}`,
   `{pack-format-pending}`) — both **caught by smoke**, not by the
   verifier. Pattern 45 explicit prevention discipline at the
   authoring layer + manual smoke as backstop.
3. **Forbidden field VALUES read through indirect chains.** E.g., a
   component imports `@/types/quote` (legal), reads `view.foo`
   (legal), and `view.foo` happens to be sourced from a forbidden
   schema field at the adapter layer. Adapter discipline (Pattern 45)
   gates this.

The verifier IS the **structural** half of the boundary; data-shape
discipline (Pattern 45) is the **semantic** half. Both are required.

---

## §2 · Extension for the new react-pdf tree

### 2.1 — Naming and directory choice

The brief frames the port as Pattern 30 path-B (verbatim canonical
adoption — JSX/CSS translation, not re-design). Three placement
options for the new react-pdf tree:

| Option | Path | Trade-off |
|---|---|---|
| **(α) In-place at `src/components/pdf/`** | reuse existing path; old DOM components retire as each react-pdf equivalent lands | verifier needs no path change; smaller diff in `package.json`; coexistence period during Step 3 is mixed (some files DOM, some react-pdf) |
| **(β) Parallel at `src/components/pdf-customer/`** | new tree gets fresh directory; old `pdf/` retires after Step 3 lands | verifier needs path extension (sweep BOTH directories until old retires); cleaner separation; clearer git blame after retire |
| **(γ) Sub-directory `src/components/pdf/rpdf/`** | new tree nested inside old; old peers retire over time | verifier picks both up automatically (root walks subdirs); slightly awkward import paths (`@/components/pdf/rpdf/pricing-table`) |

**Recommendation: (α) in-place at `src/components/pdf/`.**

Rationale:

1. **Pattern 30 path-B precedent.** `r2-pricing.css` adoption put
   canonical CSS at `src/styles/r2-pricing.css` — the canonical
   location, not a sibling. Same pattern here: the new react-pdf
   tree IS the customer-pdf tree; it replaces the DOM-preview tree
   in-place.
2. **Verifier needs zero path change.** The forbidden-import
   discipline already sweeps `src/components/pdf/` recursively.
   New react-pdf files land in the same path; the verifier catches
   them automatically.
3. **PM-internal preview surface (`src/components/quote/quote-host.tsx`)
   already mounts the DOM-preview tree by direct import.** Step 3 of
   the port swaps those imports to react-pdf equivalents one at a
   time. The QuoteHost client component can use react-pdf's
   `<PDFViewer>` (client-side) or render `renderToBuffer` results to
   an `<iframe>` — TBD per spike + Step 3 design call.
4. **Single-file retirement clean.** Old `pdf-page.tsx` ≠ new
   `pdf-page.tsx`; they're literally not the same file (the old DOM
   `pdf-page.tsx` deletes and the new react-pdf `pdf-page.tsx` is
   written). Git blame on the retire commit cleanly shows the swap.

### 2.2 — Co-existing during Step 3 port

During the Step 3 mechanical port, both DOM and react-pdf components
will briefly coexist. The verifier sweeps both — they all live under
`src/components/pdf/` — and that's correct. Both must satisfy the
same forbidden-import set.

**Watch-item:** the new tree adds `@react-pdf/renderer` as an import.
The verifier does NOT forbid that. Should we add it? See §2.3.

### 2.3 — Should we forbid `@react-pdf/renderer` from outside
`src/components/pdf/`?

**Yes — recommended addition.** Pattern 30 path-B's canonical CSS
discipline scopes the canonical adoption to one location (the
`r2-pricing.css` import lands at one root component;
`r2-pricing-overrides.css` is colocated). Same shape here: the
react-pdf library is heavy (~1.4 MB minified + ~1.5 MB vendored fonts)
and its primitives (`Document`, `Page`, `View`, `Text`,
`StyleSheet`) shouldn't leak into other surfaces. Containing the
import to `src/components/pdf/` + sendQuote-server-action
(`renderToBuffer` lives in `src/app/actions/quotes.ts`) keeps the
bundle scoping clean.

**Proposed addition to the verifier (Slice 11 Step 7 — boundary-guard
build assertion):**

Two new sweep passes alongside the existing forbidden-import sweep:

1. **Inverse sweep: `src/` excluding `src/components/pdf/` AND
   `src/app/actions/quotes.ts` → forbid `@react-pdf/renderer` import**
   so the heavy library cannot be accidentally imported into another
   surface.
2. **Forward sweep: existing forbidden-import set (no change)** —
   keeps the customer-view boundary as-is.

The inverse sweep is new infrastructure; CC implements after Edward +
CA disposition on whether to include it in Slice 11 (low-risk, ~30
lines of script extension).

### 2.4 — Boundary verifier extension shape (proposed)

```ts
// scripts/verify/customer-view-boundary.ts (post-extension)

// Existing FORBIDDEN_PATTERNS unchanged.

// NEW: forbidden libraries that should ONLY appear in specific paths
const SCOPED_LIBRARIES: ReadonlyArray<{
  library: string;
  allowedPaths: ReadonlyArray<RegExp>;
  reason: string;
}> = [
  {
    library: "@react-pdf/renderer",
    allowedPaths: [
      /^src\/components\/pdf\//,
      /^src\/app\/actions\/quotes\.ts$/,
      /^src\/lib\/pdf-/,  // future palette / font registration helpers
    ],
    reason:
      "@react-pdf/renderer must stay scoped to the customer-pdf tree + sendQuote action layer to avoid heavy bundle leakage into other surfaces (~1.4 MB minified + ~1.5 MB vendored fonts).",
  },
];
```

The walk extends to **all of `src/`** instead of just
`src/components/pdf/`, looking for `from '@react-pdf/renderer'`. Each
hit checks whether the importing file's path matches any
`allowedPaths` regex; if not, violation.

**This is a proposal; CC does not implement it in Step 1.** Step 7
disposition decides whether to land alongside the forward verifier or
defer to a v1.1 hardening pass.

---

## §3 · Re-grep target list

Per the audit's §3 boundary-guard assertion + Pattern 45 forbidden-field
set, the verifier covers the IMPORT layer (modules forbidden from the
subtree); the **prose-vs-field discipline** governs textual
appearance in the rendered artifact.

### 3.1 — Forbidden field set (consolidated)

Field/concept names that must NOT be read into the rendered tree:

| Category | Field names | Notes |
|---|---|---|
| Margin / markup | `margin_pct`, `marginPct`, `markup_pct`, `markupPct`, `markup`, `markup_pct_source`, `component_markup` | percent values only — customer never sees margin or markup math |
| Per-component cost | `unit_cost`, `unitCost`, `cost` (as a field; "billed at cost" prose is permitted) | per-line cost data |
| Supplier | `supplier`, `supplier_id`, `supplierId`, `supplierName` (as fields; the word "supplier" in customer prose like "supplier of record" is permitted) | commercial confidence |
| Duty / tariff fields | `duty_pct`, `tariff_pct`, `dutyMarkupPct`, `tariffMarkupPct` (as field reads; the prose "duty & applicable tariffs included" is permitted) | percent values, raw |
| CBM | `cbm`, `cbm_per_unit`, `cbmPerUnit`, `sku_total_cbm`, `skuTotalCbm` | physical volume math; commercially neutral but internal |
| Internal versioning | `version_number`, `versionNumber`, `scenario_label`, `scenarioLabel`, `scenarioStatus`, `dropReason` | customer sees friendly `quoteNumber` only |
| Audit | `audit_log.*`, `created_by`, `caused_by_audit_id`, `audit_source`, `entity_type`, `entity_id`, `causedByAuditId`, `diffJson` | system-internal forensic data |
| Notes (internal) | `internal_note`, `internalNote`, `internal_notes`, `internalNotes` | distinct from `customer_facing_notes` |
| HubSpot owner internal | `hubspot_owner_id`, `hubspotOwnerId`, `owner.id`, `owner.archived` | internal CRM identity |
| Presence / multi-user | `lastUserEditAt`, `editing`, `editingUserId`, presence indicators | "Sarah is editing" — internal collaboration UI |
| Debug / QA | `__debug`, `dev`, `__edit_mode_set_keys` (R5-era prototype postMessage chrome) | dev-only affordances |

### 3.2 — Prose-vs-field distinction

CD's prototype JSX carries prose mentioning some of the forbidden
concepts as commercial language. **This is intentional and permitted.**
Examples (cited at `pdf-render.jsx`):

| Prose example | Field read? | Permitted? | Citation |
|---|---|---|---|
| "duty & applicable tariffs are included in the unit price shown" (StatePure lede) | NO — no `duty_pct` read | ✓ permitted (commercial language) | pdf-render.jsx:368 |
| "container freight, duty & applicable tariffs included in unit price" (data.js incoterms text) | NO — string is a customer-facing field | ✓ permitted (incoterms description) | data.js:38 |
| "Outbound freight — billed separately at cost (EXW)" (TurnkeySummary inclusion line) | NO — no `cost` field read | ✓ permitted (commercial language describing pass-through model) | pdf-render.jsx:198 |
| "Setup, tooling, freight, duty & tariffs are landed in the unit price shown" (GrandTotalRow note) | NO — no field reads | ✓ permitted | pdf-render.jsx:174 |

**Distinction rule:** the verifier checks **import statements +
type field projections at the adapter layer.** If the rendered text is
a static string constant or a customer-visible field's value
(`quote.incoterms`, `quote.customerFacingNotes`), the prose is fine
even when it mentions a forbidden concept name. If the rendered text
includes a **value read from a forbidden field**, that's a violation
regardless of the prose framing.

### 3.3 — Pattern 45 grep checklist (Step 7 manual sweep)

When Step 7 boundary-guard build assertion lands, also run a manual
sweep for:

```bash
# Hardcoded synthetic strings (Step 9 + Step 10 precedent — both
# caught real customer-leak risks)
grep -rn '"{[^}]*-pending}"\|"{[^}]*-stub}"' src/components/pdf/ src/components/quote/

# Hardcoded numbers in customer-facing display surfaces (Step 9
# fixture-substitution finding)
grep -rn 'PASS_THROUGH_CHARGES\|MOCK\|FIXTURE\|PLACEHOLDER' src/components/pdf/ src/components/quote/

# Forbidden field reads through adapter projections
# (cross-reference with src/types/quote.ts to confirm no unexpected
# fields land on CustomerView*)
grep -rn 'view\.\|customer\.\|quote\.\|sku\.\|tier\.' src/components/pdf/ | sort -u
```

None of these are scriptable verifier additions today (high false-
positive rate); they're audit-aid greps for designer + CB smoke.

---

## §4 · Build gate sequencing

### 4.1 — Current sequencing

| Stage | Command | Trigger |
|---|---|---|
| Local dev | `npm run verify:boundaries` (manual) | developer-initiated |
| `next build` (CI / Vercel) | `npm run prebuild` automatically | every CI build + every Vercel deploy |
| Composite | `prebuild` = `verify:boundaries && verify:autosave-focus-stability && verify:pricing-classifier-invariants` | first-fail aborts build |

### 4.2 — Slice 11 sequencing

**No structural changes needed.** The verifier already runs in
`prebuild`. The Slice 11 react-pdf port lands files under
`src/components/pdf/` (per §2.1 recommendation); the verifier
automatically sweeps them.

**Optional extension (per §2.3 proposal):** if the inverse sweep
(forbid `@react-pdf/renderer` outside `src/components/pdf/`)
lands in Step 7, the same verifier file gains a second sweep
pass; `prebuild` invocation count stays at one.

### 4.3 — Verifier drift risk during Step 3 port

During the port, files MOVE (DOM → react-pdf swap). The verifier
re-runs each commit's pre-build. No drift risk — the verifier is
stateless and grep-based; it re-evaluates against current tree
state every run.

### 4.4 — Recommended pre-commit hook (NOT in Slice 11 scope)

`prebuild` runs at `next build` time. A pre-commit Husky hook that
runs `verify:boundaries` shortens the feedback loop for the porter.
**Out of Slice 11 scope; bank for v1.1 hardening.** Today's developer
discipline (run `verify:boundaries` manually pre-PR) suffices.

---

## §5 · Manual smoke checklist (Slice 11 §10 Step 8 input)

A checklist Edward + CB can walk when Slice 11 wraps (Step 8 — CB
smoke guide). The structural verifier runs at build time; this
checklist is the **semantic** sweep — does the rendered PDF show only
customer-permissible values?

### 5.1 — Pre-walk setup

- [ ] CB on staging / preview deploy with Slice 11 merged (or local
  `next build && next start`)
- [ ] At least 3 test quotes available, one per state:
  - Quote A — pure tier_table itemized, 4 priced SKUs, no charges
  - Quote B — pass-through tier_table itemized, 4 priced SKUs +
    real service fees + real freight pass-through
  - Quote C — partial completeness tier_table itemized, 6 SKUs with
    one tier-NULL price
- [ ] If `detailLevel` is in scope (Catch B fork (1)), each of the
  above re-rendered with `detail_level = turnkey_only` too (12-cell
  matrix per audit §7)

### 5.2 — Field-by-field sweep on the rendered PDF

For each test PDF, **read the rendered text** and verify NO forbidden
field values appear:

- [ ] **No margin % anywhere.** Cost stack invisible — verify no
  number reading like `42.5%` or `0.425` shows on the page (margin
  values render in Pricing surface, not customer view).
- [ ] **No markup %.** Same as above — no `0.30 / 30%` style.
- [ ] **No per-component cost values.** Per-unit cost decomposition
  (`unit_cost`, packaging line costs, etc.) absent. Only customer
  unit PRICES (e.g., `$4.45`) appear.
- [ ] **No supplier name strings.** Verify no vendor-internal
  supplier name like "Ningbo Packaging Co." appears in the PDF text
  (customer sees firm-level vendor only — "The DPS").
- [ ] **No duty % or tariff % values.** Verify no `25%`,
  `0.25 duty` style reading. The prose "duty & applicable tariffs
  included" IS permitted (commercial language).
- [ ] **No CBM values.** No `cbm`, `m³`, or volume measurements.
- [ ] **No scenario_label or version_number.** Verify the only
  identity number on the page is the customer-facing `quoteNumber`
  (`DPS-2418`-style). NO `v3`, `Primary`, etc.
- [ ] **No internal_notes.** Verify the Notes block carries
  `customer_facing_notes` content only — NOT internal_notes (which
  often carry sourcing or sensitive commercial context).
- [ ] **No audit_log fields.** No author names with "edited by",
  no version timestamps from audit trail, no "last modified" chrome.
- [ ] **No presence indicators.** No "Sarah is editing" or
  multi-user state surfacing in the artifact.
- [ ] **No debug/QA affordances.** PDF carries no
  `__debug`, no `[DEV]` tags, no review-chrome (R7-era state strips,
  preview-only toolbars) baked into the artifact.

### 5.3 — Prose-vs-field cross-reference

If a forbidden concept appears in TEXT, confirm it's:

- Static string from JSX (e.g., GrandTotalRow's "Setup, tooling,
  freight, duty & tariffs are landed in the unit price shown" —
  not a `duty_pct` read, just a customer-facing description)
- OR a value from a customer-visible field
  (`quote.incoterms_snapshot` containing "FOB Long Beach — container
  freight, duty & applicable tariffs included in unit price")

If unclear, trace the rendered text back through the adapter →
schema → check whether the source field is on `CustomerView` (legal)
or on the costing tree (illegal).

### 5.4 — Pattern 45 specific spot-checks

Per Pattern 45 prevention checklist (CLAUDE.md):

- [ ] **No synthetic-string leakage.** Grep the rendered PDF text
  for `{` characters that aren't part of currency formatting or
  quote terms (legitimate `{` in customer prose is rare). Hits like
  `{customer-pending}`, `{pack-format-pending}`, `{quote-number-pending}`
  = HIGH finding even on dev/preview quotes — the field has no real
  source binding.
- [ ] **No `Stub` chrome in production-shape quotes.** The
  `<Stub>` / `.pdf-stub` register is dashed-underline mono
  caption — visible-synthetic on purpose. PMs on production quotes
  with everything wired shouldn't see ANY stub register on the PDF.
  Stubs surfacing = either a field unwired OR a missing seed (admin
  needs to populate firm_settings TCS, etc.).
- [ ] **No hardcoded fixture numbers leaking through.** The Step 9
  finding (PASS_THROUGH_CHARGES fixtures shipping as real
  numbers) is the model. Verify charges block on a State-B quote
  shows the test quote's REAL service-fee + freight values, not
  the fixture sample.

### 5.5 — Sign-off shape

CB walks the 12-cell matrix per audit §7 (3 states × 2 layouts × 2
detail levels) AND runs §5.2 boundary sweep on at least one cell per
state (3 cells minimum). If any forbidden-field appearance surfaces,
the finding is HIGH-severity and blocks merge regardless of which cell
surfaced it. If §5.2 sweep passes on all 3 sampled cells AND §5.4
spot-checks pass AND the structural prebuild verifier passes, Slice 11
clears the boundary-guard gate.

The 12-cell-walk findings + this checklist sign-off feed into the
final Pattern 27 manifest for the Slice 11 merge gate.

---

## Standing by

Step 1 awaits Edward + CA disposition on:
1. **§2.1 naming choice** — (α) in-place at `src/components/pdf/`
   recommended, vs (β) parallel `src/components/pdf-customer/` or
   (γ) sub-dir.
2. **§2.3 inverse-sweep extension** — forbid `@react-pdf/renderer`
   outside `src/components/pdf/` + sendQuote — recommended for Step 7;
   could defer to v1.1.
3. **§5 smoke checklist scope** — confirm CB walks the 12-cell matrix
   + at least one boundary sweep per state.

Step 2 (palette precompute + font vendoring/registration) follows.
