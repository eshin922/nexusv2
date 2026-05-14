# Rest-of-app fidelity sweep — Designer audit

**Branch:** `slice-rest-of-app-sweep` (30 commits ahead of `main`)
**Date:** 2026-05-13
**Auditor:** Designer agent
**Source:** `docs/rest-of-app-fidelity-sweep-brief.md` §6 audit rubric +
CLAUDE.md Patterns 27/28/30/39/45 + dual-canon discipline.

---

## Verdict

**APPROVE-WITH-FIXES**

Two HIGH findings that should land as pre-merge hotfixes; the rest are
MEDIUM polish + LOW banked-as-followup. The Pattern 30 path-B
canonical-CSS migration discipline held across all four body surfaces
(R2 Pricing, R3 Quote+MarkAccepted shared, R4 Home CSS-only, R6 Costs
chrome). Dual-canon (R7b chrome + per-round body) is consumed
consistently. The cross-surface primitive extraction (`.calc-display`,
`.warn-band`, `.r7b-empty-state`) plus the `.r2-*` chrome-primitive
re-instate in `r7b-primitives.css` clearly resolved the Step 3.1/5
discard regression. Customer-view boundary guard is intact —
`scripts/verify/customer-view-boundary.ts` hooked into `prebuild`
verifies no `pdf/` descendant imports from costing/pricing/db/action
modules. The Step 9 hardcoded-fixtures strip (PASS_THROUGH_CHARGES
removal in `quote-host.tsx`) is the right shape and works end-to-end.

What blocks "APPROVE" cleanly: two customer-facing data-source
verification gaps survived Step 9's strip and now warrant Pattern 45
candidate promotion. (1) The pricing-table `sku.pack` field is
hardcoded to `"{pack-format-pending}"` in `quote/page.tsx:190` and
renders as plain text in the PDF (not via `.pdf-stub` synthetic-visible
treatment), meaning customer-sent PDFs ship with a synthetic
placeholder string in the product table. (2) `ReverseSolveDialog`
portals to `document.body` outside the `.r2-pricing` namespace scope
AND uses ~24 hardcoded `gray-*`/`bg-white`/`bg-blue-*`/`bg-amber-*`
Tailwind utilities — those route through the central
globals.css override layer for dark-mode safety, but the dialog's
visual register diverges from the R2 chip/button/border canon every
other Pricing surface consumes. Both are pre-merge fixable; both
deserve to land as part of this sweep rather than be banked as
follow-up because both touch customer-facing output (1) or first-class
PM workflow (2).

**Finding count:** 2 HIGH · 7 MEDIUM · 9 LOW = **18 total findings**

---

## Per-surface findings

### Setup (R7b) — body canon `r7b-setup.css` / chrome canon `.r7b-head`

**Status:** No regressions surfaced from the rest-of-app sweep against
Setup as merged in §6.b. The mid-slice smoke checkpoint protected the
shared cascade (`r7b-primitives.css` extraction + Costs chrome
migration + Pricing path-B all run AFTER `r7b-setup.css` in
globals.css cascade order, so cross-surface drift is structurally
unlikely). Setup composition (eyebrow + h1 + sub + actions + r7b-card
+ r7b-sku-row + r7b-tier-row + sku-row overflow menu via portal) all
intact.

No findings.

---

### Costs (R6 body + R7b chrome)

**Status:** Step 2 (chrome migration to `.r7b-head`) cleanly applied.
Surface body retains R6 canonical CSS register (verified file rename
in Step 7 — `r6-cost-build.css → r6-costs.css`). Pulse-dot sync
indicator preserved as Pattern 39 nexus extension inside `.lhs` slot.

#### MEDIUM-1 — Pulse-dot sync timestamp is stubbed

**State:** `src/components/costs/costs-header.tsx:54` — `const
syncLabel = "synced just now"` hardcoded.

**R6 source:** R6 designer notes data-source map traces the pulse-dot
to the HubSpot last-sync timestamp on the project. The chrome
component bakes a synthetic string rather than reading the real
timestamp.

**Why this matters:** Pattern 39 says nexus extensions are accepted
but must trace to real data. A pulse-dot that LIES about freshness is
worse than no pulse-dot. Cross-cousin to the Pattern 45 candidate
framing — display claims a property the underlying data doesn't
guarantee.

**Recommended fix:** Either wire the real `project.lastHubspotRefreshAt`
(or quote-level equivalent) into `CostsHeader` as a `lastSyncedAt`
prop, OR strip the pulse-dot + meta strip from the chrome and bank
the live-sync affordance to UX_BACKLOG. Half-implementation here is
the worst of both options.

**Disposition:** Edward decides — wire or strip.

#### LOW-1 — `r6-page-head-sync` comment refers to canonical class that's now obsolete

**State:** `costs-header.tsx:21-23` comment says "Lives in
r6-costs.css canonical CSS (already there as .r6-page-head .meta +
.live rules); we preserve the markup so the canonical CSS still
applies."

**Issue:** Chrome was migrated to `.r7b-head` in Step 2, so the
`.r6-page-head` parent selector no longer wraps the `.meta` + `.live`
elements. The canonical R6 CSS rules scoped to `.r6-page-head .meta`
won't bind to the new markup structure.

**Recommended fix:** Either re-scope the meta strip rules in
`r6-costs.css` to a class the component actually emits (e.g.,
`.r7b-head .meta`), or repurpose the sync indicator into a separate
sibling component below `.r7b-head` per the comment's stated intent.

**Severity:** LOW because the meta strip styling is likely falling
through to acceptable defaults; visual regression would have surfaced
in Step 2 smoke. But the comment is now misleading future-CC.

---

### Pricing (R2 body + R7b chrome)

**Status:** Path-B-namespace-scoped migration shipped under
`.r2-pricing { ... }` parent. Two-axis verdict + verdict band + per-
tier override card consume canonical R2 register. Chrome migrated to
`.r7b-head`. `.r2-*` cross-surface chrome primitives correctly
restored to `r7b-primitives.css` (Edward + CA hotfix disposition).
Pricing H1 em-size dual-canon collision fix banked as accepted
Pattern 39 extension.

#### HIGH-1 — `ReverseSolveDialog` portals outside `.r2-pricing` namespace + uses 24 hardcoded gray/blue/amber Tailwind utilities

**State:** `src/components/pricing/reverse-solve-dialog.tsx:259-429`.
Component calls `createPortal(<div>..., document.body)`, escaping the
`.r2-pricing { ... }` parent scope. Inside the portaled tree:
- `bg-gray-900/20` (scrim, line 264)
- `bg-white` (dialog body, line 270)
- `border-gray-200`, `text-gray-900`, `text-gray-600`, `text-gray-500`,
  `text-gray-700`, `text-gray-400`, `bg-gray-100` (frame + text, ~14
  occurrences)
- `bg-amber-50`, `text-amber-900` (consequence warn band, line 299)
- `bg-blue-50/40`, `bg-blue-700`, `text-white`, `border-blue-700`,
  `hover:bg-blue-800`, `text-blue-800`, `bg-blue-100` (origin-row
  highlight + primary CTA + assembly chip, ~6 occurrences)
- `bg-red-50`, `text-red-900` (error band, line 401)
- `divide-gray-100` (table row separators, line 324)

**R2 canon (`docs/design-prototypes/dist/docs/r2-designer-notes.md` +
`r2_costing.jsx` source):** All cross-surface chip / button / border /
band primitives consume the `.r2-chip` / `.r2-btn` / `.warn-band` /
`var(--rule)` token register. R2 has no Tailwind-utility-driven
visual register; every chip color comes from semantic token pairs
(--good / --good-soft, --warn / --warn-soft, --bad / --bad-soft).

**Why this matters:** Two issues stacked.

1. **Visual register divergence.** A central modal that PMs see every
   time they apply a suggested tier adjustment is the most-visible
   single piece of pricing UX, and it renders in a visual register
   distinct from every other Pricing chip/band/button. Globals.css
   central override layer makes the Tailwind utilities dark-mode-safe
   (per the existing `bg-gray-*` → `var(--paper-*)` mapping) but
   doesn't make the modal look like R2 canon — chip shapes, border
   radii, button outlines, and band corner-radii all differ from the
   `.r2-chip` / `.r2-btn` / `.warn-band` primitives the rest of
   Pricing consumes.

2. **Portal escapes namespace scope.** Even if the dialog WERE
   migrated to canonical R2 classes (`.r2-chip warn`, `.r2-btn
   primary`, etc.), the `createPortal(..., document.body)` placement
   means those classes resolve against the GLOBAL `r7b-primitives.css`
   home for `.r2-*` (which is correct now post-Step-3 restore), but
   any unprefixed R2 classes that exist ONLY inside the
   `.r2-pricing { ... }` scope wrap (`.eyebrow`, `.btn` base,
   `.formfield`, `.modal-head`, etc.) WOULDN'T resolve. If the
   migration follows R2's modal pattern (which uses `.modal-head` +
   `.modal-body` + `.btn` etc.), those classes only exist under
   `.r3-shared` (in `r3-shared.css`) or under `.r2-pricing` (in
   `r2-pricing.css`); neither resolves for `document.body`-mounted
   children.

**Recommended fix:** Two-part.

1. **Wrap the portaled root in `.r2-pricing` namespace.** Change the
   `createPortal` first arg's outer `<div>` className to include
   `r2-pricing` so the canonical R2 unprefixed classes resolve. This
   is the same shape Mark Accepted's `r3-shared` adoption uses for
   `.macc-*` and `.modal-*` classes — the parent class is the entry
   to the namespace.

2. **Migrate to canonical class register.** Replace the hardcoded
   Tailwind utilities with `.r2-chip warn`, `.r2-chip bad`, `.r2-btn`,
   `.r2-btn primary`, `.warn-band`, `.warn-band.bad` per the cross-
   surface chip/button/band canon. The frame should consume
   `var(--rule)` / `var(--paper)` / `var(--paper-2)` tokens directly.
   Origin-row highlight maps to `var(--accent-soft)`.

**Disposition:** **MUST FIX pre-merge.** ReverseSolveDialog is the
primary surface for one of Slice 9.4b's three signature affordances
(suggested-tier-adj reverse-solve). Sweep's purpose was specifically
"adopt canonical CSS everywhere"; this surface stayed un-migrated.

#### MEDIUM-2 — `client-target-cell.tsx` uses 9 hardcoded Tailwind utilities

**State:** `src/components/pricing/client-target-cell.tsx:176, 254,
276, 281, 312, 314, 335-336, 347`. Tailwind classes for the cell
input, the reverse-solve "→ apply suggested adj" chip, and the
error-state pill.

**R2 canon:** Per-cell client target affordance should consume the
canonical `.r2-chip` register for the apply chip. Input cell should
consume Pattern 29 read↔edit affordance per the brief §3.2 sub-
dimension 4 "ACCEPTED NEXUS EXTENSION" disposition (Pattern 39
candidate); currently uses `border-blue-400 bg-white` literals.

**Recommended fix:** Migrate to canonical register (consistent with
HIGH-1). Document Pattern 39 extension status in component header
(R2 canonical shows display-only; nexus accepts inline edit) per
the brief §3.2 disposition.

**Severity:** MEDIUM because globals.css central override mitigates
the dark-mode foot-gun; the visual register divergence is real but
not customer-facing.

#### MEDIUM-3 — `active-tier-selector.tsx` uses 6 hardcoded Tailwind utilities

**State:** `src/components/pricing/active-tier-selector.tsx:65-78,
99, 105`. `border-gray-200 bg-white`, `bg-blue-600 text-white`,
`text-gray-700 hover:bg-gray-100`, `text-blue-100`, `text-gray-400`,
`border-gray-300 bg-white`.

**R2 canon:** Tab pattern should consume the `.r2-chip` /
`.r2-btn.sm` primitive register; dropdown should consume `.r2-form`
or equivalent.

**Note:** Per the page composition (`pricing/page.tsx`), this
selector is NOT mounted because Cost Stack tier columns ARE the
selector (per R6 grammar). The selector exists as dead code or is
mounted on conditional paths. Either way, it doesn't render in
production — but the file still ships in the bundle.

**Recommended fix:** Either delete (if truly dead) or migrate to
canonical register (if it's a fallback). Grep for callers to
confirm.

#### MEDIUM-4 — Cost stack panel mounted on Pricing is undisposed R2 nexus extension

**State:** `src/app/projects/[id]/quotes/[quoteId]/pricing/page.tsx:
200-203` — `<CostStackHeader>` imported from `@/components/costs/`
and mounted as "Room 1 — Cost stack panel (R6 cost-stack-header
reused)."

**R2 canon:** R2 designer notes lines 122-127 ("Almost-decisions —
what I built and threw away") explicitly situate the cost stack at
the bottom of **Cost Build**, NOT Costing Sheet (Pricing). Source
`r2_costing.jsx` does NOT contain a cost-stack mount. R2's
verdict-as-room-organizer commits the Costing Sheet body to: verdict
band + per-tier table + per-cell overrides.

**Brief disposition reference:** Brief §3.2 Step 4 + Pricing seed
finding #4 explicitly anticipated this. Three dispositions offered:
(a) strip the cost-stack from Pricing per R2 canon; (b) replace with
a mini-stack reference + back-link to Costs; (c) PM workflow audit
during sweep reveals sanity-check value. **No disposition was
recorded in commit history.** The implementation persists as
status-quo cost-stack-on-Pricing.

**Why this matters:** Cross-cutting commitment "Pricing Control
Summary lives on Costing Sheet only" (§6.b precedent) — five-surface
cleanup principle. Pricing shouldn't host the Costs surface's
identity element. The cost stack IS the Costs surface; mounting it
on Pricing dilutes the surface-separation contract this sweep was
supposed to clean up.

**Recommended fix:** Edward + CA disposition. Three options:
- (a) Strip CostStackHeader from `pricing/page.tsx` Room 1; verdict
  band moves up. Largest visual change; truest to R2 canon.
- (b) Replace with read-only mini-stack reference; PM-facing copy
  makes it explicit "cost construction on Costs · this is read-only."
- (c) Bank the divergence as an explicit accepted Pattern 39
  extension; document the rationale in `pricing/page.tsx` header
  comment so future audits don't re-flag.

**Disposition:** **Bank as undisposed.** Recommend (c) — bank as
accepted Pattern 39 extension with rationale documented in
`pricing/page.tsx` header — for sweep merge; (a) or (b) ship as a
future small slice if Edward wants the divergence resolved.

#### MEDIUM-5 — `lines-requiring-review.tsx` not audited for canonical R2 register

**State:** Not deeply audited (file exists; reads costing-store; not
inspected against R2 canon).

**Recommendation:** Spot-check at PR review for canonical `.r2-card`
+ `.r2-eyebrow` + `.r2-chip` consumption.

#### LOW-2 — `MarginVerdictPill` has size="sm" inline-override after canonical migration

**State:** `margin-verdict-pill.tsx:48-49` — `sizeStyle: React
.CSSProperties | undefined = size === "sm" ? { padding: "2px 6px",
fontSize: 9 } : undefined`. Even though the chip migrated to `.r2-chip`
canonical, the `sm` size variant uses inline-style override.

**Recommended fix:** Add `.r2-chip.sm` to `r7b-primitives.css`
following the `.r2-btn.sm` precedent so the size variant lives in
CSS, not inline JSX.

---

### Quote (R3 body + R7b chrome)

**Status:** Path-B-namespace-scoped migration shipped — `.r3-shared
{ ... }` parent in `r3-shared.css` covers both Quote (Customer view)
AND Mark Accepted with single shared file. Customer-view boundary
guard intact (script-level + prebuild hook). Step 9 PASS_THROUGH_CHARGES
fixture strip clean. Notes-above-T&Cs ordering preserved (RI.9 step
10 smoke fix).

#### HIGH-2 — `quote/page.tsx` hardcodes `sku.pack = "{pack-format-pending}"` which ships in customer PDFs as plain text

**State:** `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:
190`:
```ts
return {
  label: rollup.skuLabel,
  name: rollup.productName,
  // Pack format not yet on quote_skus — Slice 11 schema add.
  pack: "{pack-format-pending}",
  ...
};
```

`PdfPricingTable` renders this verbatim via `<div style={skuPackStyle}
>{sku.pack}</div>` (`pdf-pricing-table.tsx:89`) — **NOT through
`<Stub>` or `.pdf-stub` synthetic-visible treatment.** The
`skuPackStyle` is a plain `JetBrains Mono, monospace` italicized
gray-ish caption.

**What customers see in the PDF:** every product row's secondary
caption reads "{pack-format-pending}" as a literal string in a
muted but unstyled register. PMs sending a real quote today get this
shipped to their customer's inbox.

**R3 canon (`pdf-pricing-table.tsx` source + `r3_data.js`):** The
pack field carries pack-format strings like "30 mL · airless
bottle" or "50 mL · glass dropper" — real per-SKU pack format
metadata. R3's canonical treatment renders the field as muted mono
caption below the product name; canonical assumes the field is
populated.

**Why this matters:** This is the **second Pattern 45 candidate
instance in the sweep** (PASS_THROUGH_CHARGES was the first; Step 9
already stripped that). The pattern is the same: hardcoded
placeholder data flowing through the customer-facing PDF render
tree without `.pdf-stub` synthetic-visible signaling. Pattern 45
candidate should now be **promoted to standing pattern** — two
instances in one sweep is the threshold.

**Recommended fix:** Two options for the immediate pre-merge fix.

1. **Promote to `.pdf-stub` synthetic-visible.** Apply the existing
   `<Stub>` component from `pdf-header.tsx:19-21` (or extract to a
   shared primitive). The pack caption renders as
   `{pack-format-pending}` with the dashed-underline `.pdf-stub`
   register — visible-synthetic so PMs catch the unplumbed surface
   in smoke. Move `packPending` to `QUOTE_STUBS` in
   `quote-fixtures.ts`.

2. **Suppress the line entirely when pack is null/synthetic.**
   `quote/page.tsx` sets `pack: null` instead of the synthetic
   string; `PdfPricingTable` conditionally renders the caption
   only when `pack` is truthy. Graceful-degradation — customer PDF
   shows just the product name when pack is unset.

**Disposition:** **MUST FIX pre-merge.** Customer-visible regression
in PDF output. Either fix is small (~10 LOC). Recommend option 2
(suppress when null) per the same shape as `preparedBy.phone` in
`pdf-header.tsx:77` — gracefully degrade rather than synthetic-
visible when the field truly doesn't exist yet.

#### MEDIUM-6 — Boundary-guard verification depth: forbidden patterns don't catch CSS file imports

**State:** `scripts/verify/customer-view-boundary.ts` checks
imports against `FORBIDDEN_PATTERNS` for ts/tsx files under
`src/components/pdf/`. Forbidden: `@/components/costs/*`,
`@/components/pricing/*`, `@/components/internal-only-badge`,
`@/lib/costing(-store)?`, `@/db(/schema)?`, `@/app/actions/*`.

**Issue:** Pattern set doesn't include CSS file imports
(`@/styles/*`) — although CSS imports inside `.tsx` files aren't a
real risk (CSS only adds visual rules; doesn't leak internal
data), the boundary guard's stated invariant per RI.6 PdfPage
comment says "NO costing, no schema, no internal-only-badge,
no theme tokens (literal OKLCH only — see r3-quote.css)."

**Why this matters:** Quote subtree currently consumes
`r3-shared.css` (because `<QuoteHost>` wraps in `.r3-shared
preview-chrome`), which is theme-token-driven. That breaks the
"literal OKLCH only" claim from `PdfPage` comment line 5. Either
the comment is outdated (R3 canonical R3 register WAS migrated to
tokens — `.r3-shared.css` uses `var(--paper-2)`, `var(--rule)`,
etc.), OR the boundary discipline was relaxed without updating the
comment.

**Recommended fix:** Update `PdfPage` comment to reflect post-Step-4
reality. Token consumption is FINE for `pdf/` subtree — the
boundary's real invariant is "no costing/schema/action imports,"
which the script enforces. Drop the "literal OKLCH only" line from
the comment.

**Severity:** MEDIUM. Comment-vs-reality drift is misleading
future-CC; the actual boundary is intact.

#### LOW-3 — `BoundaryGuardNotice` purpose deprecated

**State:** `src/components/quote/boundary-guard-notice.tsx` exists
and is mounted in `<QuoteHost>` (line 160).

**Recommendation:** Spot-check at PR review whether this is still
needed; the script-level enforcement makes the visual notice less
load-bearing. May still be useful as PM-facing reminder.

#### LOW-4 — Preview-toolbar flex-wrap nexus extension documented inline

**State:** `r7b-primitives.css:486-509` — `.r3-shared
.preview-toolbar` extends canonical with `flex-wrap: wrap` per
Pattern 39 nexus extension. Documented well in CSS file header
comment.

**No fix needed.** Cited as a good example of Pattern 39 hygiene.

---

### Mark Accepted (R3 body + R7b chrome)

**Status:** Path-B step 5 adoption of `.r3-shared` parent class on
`MarkAcceptedHost` wrapper. `accept-confirm-modal.tsx` uses
`<Modal>` primitive which renders inline (no portal) — so the modal
sits INSIDE `.r3-shared` namespace and `.modal-head` + `.modal-body`
+ `.modal-foot` + `.btn` classes resolve correctly from the
canonical R3 CSS.

#### MEDIUM-7 — `mark-accepted-host.tsx` top breadcrumb strip uses inline-style register, not canonical chrome

**State:** `mark-accepted-host.tsx:78-148` — 30+ inline-style props
on the top breadcrumb/state-switcher strip. Hardcodes `padding`,
`background: 'var(--paper-2)'`, `borderBottom: '1px solid
var(--rule)'`, etc.

**R3 canon:** R3 source `r3_mark-accepted.jsx` defines a
`.macc-stage`-anchored top strip that should consume the canonical
`.r3-surface-bar` register (similar grammar to the Quote
preview-toolbar).

**Recommended fix:** Migrate to canonical `.macc-stage`
descendant classes; offload styling to `r3-shared.css`.

**Severity:** MEDIUM — register divergence in a primary surface
chrome; tokens are correct, but Pattern 30 verbatim canonical-CSS
discipline isn't being applied.

#### LOW-5 — `accept-confirm-modal.tsx` mixes inline-style + canonical classes

**State:** `accept-confirm-modal.tsx:100-181` — modal body content
uses canonical `.formfield` + `.eyebrow` classes but layout uses
inline-style flex grammar. Hybrid is functional but visually
inconsistent with the modal's canonical structure.

**Recommendation:** PR review pass; not blocking.

#### LOW-6 — `mark-accepted-good.tsx:62-92` customer-acceptance affirmation card uses inline-style

**State:** Pattern 39 candidate extension or pre-canonical inline.

**Recommendation:** Bank as Pattern 39 candidate; if recurring, lift
to `.r3-customer-acceptance-card` canonical primitive.

---

### Home (R4 CSS-only; JSX deferred)

**Status:** Step 6.1/N adopted `r4-home.css` verbatim from upstream
`4bstyles.css`. JSX adoption deferred to Step 6.2-6.6 follow-up.
`src/app/page.tsx` still renders via Tailwind utilities + inline
styles, no `r4-*` class names. The brief explicitly carved
JSX adoption out of this sweep's scope.

#### LOW-7 — CSS file imported without consumers

**State:** `r4-home.css` is imported in `globals.css:8` but no
caller in `src/app/page.tsx`, `src/components/deal-organizer/*`,
or `src/components/nav/resume-card.tsx` consumes `r4-*` class names
(verified via grep).

**Why this is acceptable:** The brief carved JSX adoption to follow-
up. Pre-importing the CSS now means the future JSX adoption is a
class-rename pass, not a "translate the screenshot + import the
CSS" pass. CLAUDE.md Pattern 30 path-B "Drop-in adoption" note
covers this shape.

**No fix needed.** Banked for follow-up Step 6.2-6.6.

#### LOW-8 — Home page Tailwind utilities mostly token-driven

**State:** `src/app/page.tsx:57-83` uses `text-ink-3`, `text-ink`,
`border-rule pb-4`, `bg-accent`, `text-paper`, `hover:bg-accent-ink`
— all `@theme`-routed tokens. Visual register is consistent with
the token system; Pattern 30 path-B JSX adoption can be a fidelity
upgrade rather than a regression fix.

**No fix needed.**

---

## Cross-surface findings

### MEDIUM — Token discipline residue across non-sweep components

**State:** Grep on `gray-|bg-white|bg-blue|bg-amber|bg-red|
text-gray|border-gray|slate-` across `src/` returned **330
occurrences across 39 files** (excluding sku-row.tsx which uses
token-Tailwind utilities like `border-rule bg-paper`).

Per-surface tally (Pricing only — brief banked Pricing's 29 as
v1.1):
- `reverse-solve-dialog.tsx`: 24 (HIGH-1)
- `client-target-cell.tsx`: 9 (MEDIUM-2)
- `active-tier-selector.tsx`: 6 (MEDIUM-3)
- `competitive-indicator.tsx`: 2 (comment-only — references
  past `bg-white` removal)
- = 41 occurrences across 4 files (brief said 29; actual is 41
  excluding dead-code; up to 47 including dead-code).

Non-Pricing surfaces verified clean of gray/bg-white literals:
- `src/components/costs/`: 0 occurrences ✓
- `src/components/quote/`: 0 occurrences ✓
- `src/components/mark-accepted/`: 0 occurrences ✓

**Recommendation:** Brief's "Pricing's 29 hardcoded refs banked as
v1.1 cleanup" disposition holds. Re-count of actual occurrences (41)
and the modal-portal HIGH-1 finding mean the v1.1 cleanup scope is
slightly larger than initially banked. Update UX_BACKLOG entry with
the higher count + HIGH-1 callout if not landed pre-merge.

### MEDIUM — Pattern 45 candidate ("Customer-facing render data-source verification") earned promotion to standing

**State:** Pattern 45 candidate was first banked from Step 9
PASS_THROUGH_CHARGES fixtures strip. This audit surfaces a **second
instance** — HIGH-2's `{pack-format-pending}` hardcoded synthetic
shipping in customer PDFs.

**Promotion threshold per existing CLAUDE.md "Pattern 22 promoted
to standing protocol":** "three instances in two slices is the
trigger." We're at two instances in one sweep, but the second
instance (HIGH-2) is structurally identical to the first (Step 9):
hardcoded placeholder synthetic strings flowing through the
customer-facing PDF render tree without `.pdf-stub` synthetic-
visible signaling.

**Recommendation:** Promote Pattern 45 from candidate to standing
**now**, before the next slice. Bank in CLAUDE.md with the two
reference moments + the canonical fix shape (either `<Stub>` /
`.pdf-stub` for synthetic-visible, OR null-guard for graceful
degradation).

**Bank the pattern shape:** "Customer-facing render data-source
verification — every PDF block + customer-view component traces to
real bundle data; placeholder fixtures + hardcoded synthetic strings
flowing through `<PdfPage>` subtree without `.pdf-stub` treatment
are HIGH-severity findings regardless of slice." Adopt as
audit-rubric sweep criterion (coverage gap → banked dimension per
the existing "Audit rubric coverage gap signaling" pattern).

### LOW — Iconography sweep

**State:** Reviewed surfaces for icon-glyph consistency. Verified:
- Costs: `→` (forward CTA), `+` (new version button), pulse-dot
  `.live` indicator. Consistent.
- Pricing: `→` apply-suggested chip; `⚿` admin-override path; `↳`
  / `↗` placeholder dev-send button. Consistent.
- Quote: `✎` Edit notes; `⤓` Download PDF; `↳` Download + mail
  draft. Consistent.
- Mark Accepted: `✓` Confirm; `✕` Modal close; `⋯` overflow.
  Consistent.
- Setup: `○` LEAF; `▤` ASY; `+` Add. Consistent (§6.b discipline
  preserved).

**Note:** Iconography sweep was added per "Audit rubric coverage
gap signaling" from RI.8 step 11 banked finding. This is its second
application — clean across all surfaces this sweep touched.

### LOW — Dark-mode safety

**State:** `globals.css:155-281` central override layer maps the
common Tailwind `gray-*` / `bg-white` / `bg-blue-*` / `bg-amber-*` /
`bg-red-*` / `bg-green-*` to token-driven equivalents. Every
hardcoded utility currently in the codebase routes through one of
those mappings.

**Verification:** Cross-checked the HIGH-1 ReverseSolveDialog
utilities against the mapping — all 24 utilities resolve to tokens
via the central override. Dark-mode safety preserved. (The HIGH-1
issue is visual register, not dark-mode breakage.)

**No fix needed for dark-mode safety; HIGH-1 still stands on its
own grounds.**

### LOW — Cross-surface primitive consistency

**State:** `r7b-primitives.css` ships three extracted primitives
(`.calc-display`, `.warn-band`, `.r7b-empty-state`) plus the
restored `.r2-*` chrome primitives. Consumption verified:
- `.r2-chip` consumed in `margin-verdict-pill.tsx`, `verdict-band.tsx`,
  `lines-requiring-review.tsx`. ✓
- `.r2-btn` consumed in `pricing-page-head.tsx`,
  `customer-accept-toggle.tsx`. ✓
- `.r2-eyebrow` / `.r2-mono` / `.r2-card` consumed in `verdict-band.tsx`,
  `per-tier-override-card.tsx`. ✓
- `.calc-display` — extracted but no consumers found in the rest-of-
  app sweep diff. (Origin was §6.b modal margin row; cross-surface
  candidates listed in the CSS header comment haven't been migrated.)
  **MEDIUM finding within the LOW-banked category.**
- `.warn-band` — verified consumer in §6.b modal SKU dup-check; no
  rest-of-app sweep consumer.
- `.r7b-empty-state` — extracted but no rest-of-app consumers
  surfaced.

**Recommendation:** Document the three extracted primitives in
UX_BACKLOG as "available for consumption" — future surfaces that
need a calculated-display register or warn band should reach for
the primitive rather than rebuilding inline.

---

## Coverage gaps / rubric expansions

### Bank: Pattern 45 candidate → standing

Promote per MEDIUM-finding in cross-surface section. Two reference
moments in this sweep: Step 9 PASS_THROUGH_CHARGES strip + HIGH-2
`{pack-format-pending}` ship-through.

### Bank: Audit rubric expansion — "portal escape from namespace scope"

**Coverage gap:** This audit's rubric covered "canonical CSS adopted
verbatim" + "namespace scope intact" but didn't explicitly check
portal-mounted children of namespace-scoped trees. HIGH-1 surfaced
on grep, not on rubric drive. Future audits should explicitly grep
for `createPortal` mentions in any surface whose CSS lives under a
parent-scope wrap (R2 Pricing, R3 Quote+MarkAccepted).

**Rubric addition:** "For Path-B-namespace-scoped surfaces, every
portal-mounted child must either (a) carry the parent scope class
on its portal root, OR (b) explicitly opt into the cross-surface
global primitive register (`.r2-*` chrome primitives in
`r7b-primitives.css`)."

### Bank: Audit rubric expansion — "Pattern 39 nexus extension hygiene"

**Coverage gap:** Pattern 39 (Nexus-side extension precedent) is
referenced in the brief but doesn't have a clean rubric check. The
Cost Stack on Pricing finding (MEDIUM-4) surfaced because the brief
explicitly anticipated it; the pulse-dot sync timestamp stub
(MEDIUM-1) surfaced because of data-source tracing.

**Rubric addition:** "Every Pattern 39 nexus extension must (a)
document the delta from canon in the relevant component or CSS file
header, AND (b) trace to real data through the action layer or
costing store — synthetic strings shipping through extensions are
HIGH findings (Pattern 45 link)."

### Bank: Audit rubric expansion — "Component CSS comment drift"

**Coverage gap:** LOW-1 (`r6-page-head-sync` comment refers to
obsolete canonical class) and MEDIUM-6 (`PdfPage` comment refers
to obsolete "literal OKLCH only" claim) are both comment-vs-reality
drift after canonical migrations. Audit should explicitly check
component header comments against post-migration reality.

**Rubric addition:** "After any canonical CSS migration, comments
referencing the pre-migration class names + cascade scopes get
re-read against current reality. Comments lie longer than code
does."

---

## Summary by file action

**Pre-merge MUST FIX (HIGH):**
1. `src/components/pricing/reverse-solve-dialog.tsx` — wrap portal
   in `.r2-pricing` namespace + migrate 24 Tailwind utilities to
   canonical R2 register
2. `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:190` —
   replace `pack: "{pack-format-pending}"` with `pack: null` +
   add null-guard in `pdf-pricing-table.tsx:89`

**Pre-merge SHOULD FIX (MEDIUM):**
- `src/components/costs/costs-header.tsx` — wire real
  `lastSyncedAt` OR strip pulse-dot (MEDIUM-1)
- `src/components/pricing/client-target-cell.tsx` — migrate to
  canonical R2 register (MEDIUM-2)
- `src/components/pricing/active-tier-selector.tsx` — delete or
  migrate (MEDIUM-3)
- `src/app/projects/[id]/quotes/[quoteId]/pricing/page.tsx` —
  document cost-stack-on-Pricing as Pattern 39 banked extension
  with rationale in component header (MEDIUM-4)
- `src/components/mark-accepted/mark-accepted-host.tsx` — migrate
  top strip from inline-style to canonical `.macc-*` /
  `.r3-surface-bar` classes (MEDIUM-7)
- `src/components/pdf/pdf-page.tsx` — update outdated comment
  re: "literal OKLCH only" (MEDIUM-6)

**Post-merge BANKED (LOW):**
- LOW-1 through LOW-8 — comment drift, primitive consumption
  documentation, JSX adoption deferral confirmation

**Pattern banking:**
- Promote Pattern 45 (customer-facing render data-source
  verification) from candidate to standing
- Bank three new audit-rubric dimensions: portal escape, Pattern 39
  hygiene, comment drift

---

End of audit.
