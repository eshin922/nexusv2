# CC · Customer-PDF Render Audit — Slice 11 brief input

Read-only audit of CD's customer-PDF render package committed under
`docs/design-prototypes/dist/Nexus Customer PDF Render/`. This is the
Slice 11 brief input per CA's §7 sequencing. CC produces no design
proposals, no implementation code, no timelines. Citations are
`file:line` against the committed prototype unless noted.

## 1 · Named-structure inventory (Pattern 30 contract)

### 1a · Components / helpers in `app/cpdf/pdf-render.jsx`

| Symbol | Kind | Line | CA's expected? | Notes |
|---|---|---|---|---|
| `D` (= `NXCPDF` alias) | const | 11 | n/a | data root |
| `SERVICE_FEES_TOTAL` | helper | 12 | yes | Σ `service_fees[i].amount` |
| `money` | fmt | 15–19 | n/a | $-prefixed; 0 dp ≥ $100 else 2 dp |
| `unit` | fmt | 20 | n/a | always 2 dp |
| `qtyK` | fmt | 21 | n/a | "5k" vs "5,000" |
| `longDate` | fmt | 22–24 | n/a | "May 17, 2026" |
| `lineTotal(price, ti)` | helper | 27 | yes | `price × tiers[ti].quantity`; null-safe |
| `tierGrand(skuSet, ti, foldFees)` | helper | 28–38 | yes | returns `{total, hasUnpriced, perUnit}` |
| `Masthead` | component | 41–55 | yes | first-page-only vendor + quote meta |
| `Parties` | component | 58–77 | yes | first-page-only "Prepared for / by" |
| `PricingTable` | component | 81–145 | yes | layout-aware; gains `continued` flag |
| `GrandTotalRow` | component | 148–181 | yes | per-tier turnkey row; +blended /unit |
| `TurnkeySummary` | component | 184–248 | yes | no-SKU-rows turnkey; cards or hero |
| `PricingFoot` | component | 250–257 | yes | footer caption + partial legend |
| `ChargesBlock` | component | 260–288 | yes | state-B only; service fees + freight |
| `TermsBlock` | component | 291–300 | yes | flex-wrap term grid |
| `NotesBlock` | component | 302–305 | yes | null-guarded callout |
| `HowToAccept` | component | 307–314 | yes | static instruction copy |
| `RunHead` | component | 317–324 | yes | pages 2+, fixed |
| `Footer` | component | 325–332 | yes | every page, fixed |
| `Sheet` | component | 335–343 | yes | wraps page; runhead + flow + footer |
| `Break` | component | 345 | (preview) | dashed `cpdf-break` marker between sheets |
| `StatePure` | composition | 348–384 | yes | 1 page either layout |
| `StatePassThrough` | composition | 387–447 | yes | 2 pages itemized; 1 page turnkey_only |
| `StatePartial` | composition | 450–509 | yes | 2 pages itemized; 1 page turnkey_only |
| `STATES` array | data | 512–516 | (preview) | toolbar state chips |
| `CustomerPdfHost` | component | 518–558 | (preview) | toolbar + DN banner — NOT production |

All 13 of CA's expected components + 3 state compositions + 3 helpers
ship and are named verbatim. No drift.

### 1b · CSS class register (`app/cpdf/styles.css`)

Preview-only (NOT production; strip from port): `.cpdf-stage`,
`.cpdf-toolbar` + descendants (`.grp`, `.ribbon`, `.seg`,
`.layout-toggle`, `.bar`, `.cpdf-dl`), `.cpdf-dn` + descendants
(`.eyebrow`, `code`, `strong`), `.cpdf-break`.

Paged-artifact register (`.pp-*` — implement verbatim per Pattern 30):

| Class | Modifiers | Line | Purpose |
|---|---|---|---|
| `.pp-sheet` | `.continuation`, `+ .pp-sheet` | 100–129, 331 | page box (816×1056) |
| `.pp-flow` | — | 130 | flowing content; footer pinned |
| `.pp-masthead` | `.v-id`, `.v-name`, `.v-sub`, `.v-meta`, `.v-meta .qnum`, `.v-meta strong` | 133–154 | first-page vendor block |
| `.pp-parties` | `.party`, `.label`, `.pname`, `.pline` | 157–167 | Prepared-for / by columns |
| `.pp-eyebrow` | — | 170–174 | mono uppercase eyebrow |
| `.pp-h2` | — | 175–179 | section H2 (Newsreader 18) |
| `.pp-h3` | — | 180–184 | section H3 (Newsreader 14) |
| `.pp-lede` | `em` | 185–189 | section lede paragraph |
| `.pp-section` | `.tight` | 190–191 | spacer between blocks |
| `.pp-table` | — | 194 | flex column wrapping head + body |
| `.pp-thead` | `.continued` | 195–200 | flex header row |
| `.pp-tbody` | — | 201 | flex body container |
| `.pp-tr` | `.pp-tbody .pp-tr:last-child` | 202–207 | flex SKU row |
| `.pp-c-prod` | — | 210 | flex column — product (flex 2.5) |
| `.pp-c-num` | — | 211–216 | flex column — numeric / tier (flex 1) |
| `.pp-c-rec` | (.pp-thead .pp-c-rec, .pp-grand .pp-c-rec) | 220–221, 366 | recommended-column bracket + tint |
| `.pp-th-lab` | (.pp-c-prod .pp-th-lab) | 224–228 | header cell label |
| `.pp-th-sub` | `.rec-word` | 229–232, 238 | header cell sub-line |
| `.pp-th-rec` | `.star` | 233–237 | recommended-header inline-flex |
| `.pp-prod-name` | — | 241 | SKU product name (Newsreader 13) |
| `.pp-prod-meta` | `.code` | 242–246 | SKU code · pack |
| `.pp-prod-flat` | — | 247 | flat-pricing caption |
| `.pp-price` | `.dash`, `.req` | 248–257 | price cell; recommended cell weight 600 |
| `.pp-table-foot` | — | 258–262 | mono footer caption + partial legend |
| `.pp-charges` | — | 265 | (kept-together) container |
| `.pp-charge-sub` | — | 266 | italic sub-caption |
| `.pp-charge-group-label` | — | 267–271 | mono group label |
| `.pp-charge-row` | `.c-label .t`, `.c-label .s`, `.c-qty`, `.c-amt`, `.c-amt .per` | 272–287 | flex row, label + qty + amt |
| `.pp-terms` | — | 290–294 | flex-wrap term grid |
| `.pp-term` | `.label`, `.value` | 295–301 | 50%-flex term cell |
| `.pp-notes` | `.label`, `p` | 304–314 | notes callout (left-rule) |
| `.pp-accept` | `p` | 317–318 | how-to-accept block |
| `.pp-runhead` | `.l`, `.l strong`, `.r` | 321–330 | running header (fixed) |
| `.pp-footer` | `.l strong` | 334–341 | page footer (fixed) |
| `.pp-linetotal` | (`.pp-c-rec .pp-linetotal`) | 348–353 | line-total stack under unit price |
| `.pp-grand` | `.g-label`, `.g-sub`, (`.pp-c-rec`) | 356–366 | grand turnkey row |
| `.pp-grand-num` | `.req`, `.from` | 367–374, 382 | per-tier total figure |
| `.pp-grand-unit` | `.per`, (`.pp-c-rec .pp-grand-unit`) | 375–381 | blended all-in /unit caption |
| `.pp-grand-notes` | — | 384 | notes column under grand row |
| `.pp-grand-note` | `.k`, `.amt`, `.freight` | 385–393 | per-note row (key + body) |
| `.pp-turnkey` | `.single`, `.pp-lede` | 396–397 | turnkey-only host |
| `.pp-tk-cards` | — | 400 | tier-row of cards |
| `.pp-tk-card` | `.rec`, `:last-child` | 401–412 | per-tier card |
| `.pp-tk-tier` | `.star` | 413–418 | card tier label |
| `.pp-tk-qty` | — | 419–422 | card qty caption |
| `.pp-tk-rec-word` | — | 423 | "recommended" tag |
| `.pp-tk-total` | `.req`, `.from` | 424–437 | card total figure |
| `.pp-tk-perunit` | `.per` | 430–435 | card per-unit caption |
| `.pp-tk-hero` | `.h-meta`, `.h-label`, `.h-tier`, `.h-tier .star`, `.h-qty`, `.h-num`, `.h-num.req` | 440–458 | single-tier hero figure |
| `.pp-tk-hero-unit` | `.per` | 459–464 | hero per-unit caption |
| `.pp-tk-included` | `.label` | 467–475 | what's-included block |
| `.pp-tk-scope` | `.code` | 476–477 | "covers N finished products" scope line |
| `.pp-tk-incl-list` | — | 478 | flex column of inclusion bullets |
| `.pp-tk-incl` | `.tick`, `.out` | 479–485 | inclusion bullet + tick |

61 paged-artifact selectors total. No name drift from designer notes
§8 + §A8. All Addendum-1 classes present.

## 2 · Data-source map verification (3-way)

| Block | Map's claimed source | data.js | JSX reader | quote.ts | Status |
|---|---|---|---|---|---|
| Vendor name | `vendor.name` | L14 `"The DPS"` | Masthead:45 | `CustomerViewVendor.name` | ✓ |
| Vendor tagline | `vendor.sub` | L15 | Masthead:46 | `vendor.sub` | ✓ |
| Vendor address | `vendor.address` | L16 | Parties:73 | `vendor.address` | ✓ |
| Prepared-by name | `vendor.contact_name` | L17 `"Maya Okafor"` | Parties:71 | `CustomerViewPreparedBy.name` | ⚠ **shape drift** — fixture nests under `vendor`; production type splits into top-level `preparedBy` (RI.7 DEC-8) |
| Prepared-by email | `vendor.contact_email` | L18 `"maya@dps.co"` | Parties:72 | `preparedBy.email` | ⚠ **shape drift** + fixture domain (see §9) |
| Prepared-by phone | `vendor.contact_phone` | L19 | Parties:72 | `preparedBy.phone` (nullable) | ⚠ **shape drift**; type permits NULL → JSX must null-guard before adopting |
| Quote # | `quote.quote_number` | L33 `"DPS-2418"` | Masthead:49, RunHead:320, Footer:328, PricingTable:90 | `quote.quoteNumber` (nullable for drafts) | ⚠ **snake↔camel** translation; type permits NULL (drafts) which prototype does not exercise |
| Issued date | `quote.issued_date` | L34 | Masthead:50 | `quote.sentDate` | ⚠ **name drift** — `issued_date` (fixture/map) vs `sentDate` (type); semantic intent is same (date sent), but no `issuedDate` field exists |
| Valid until | `quote.valid_until` | L35 | Masthead:51, TermsBlock:294 | `quote.validUntil` | ✓ |
| Payment terms | `quote.payment_terms` | L36 | TermsBlock:295 | `quote.paymentTerms` | ✓ |
| Lead time | `quote.lead_time` | L37 | TermsBlock:296 | `quote.leadTime` | ✓ |
| Incoterms (bundled) | `quote.incoterms_bundled` | L38 | StatePure:377, StatePartial:466/502 | `quote.incoterms` (single field) | ⚠ **resolution drift** — fixture carries both variants; type carries a single resolved string. Map notes "derived from freight treatment" → server-side selection expected |
| Incoterms (passthrough) | `quote.incoterms_passthrough` | L39 | StatePassThrough:404/440 | (same single field) | ⚠ same as above |
| Customer notes | `quote.customer_facing_notes` | L40–42 | NotesBlock via StateX:378/405/441/467/503 | `quote.customerFacingNotes` | ✓ |
| Customer name | `customer.name` | L24 | Parties:63 | `CustomerViewCustomer.name` | ✓ |
| Customer contact | `customer.contact` | L25 | Parties:64 | `customer.contact` (nullable) | ⚠ JSX renders `{contact} · {role}` un-guarded; type permits both NULL |
| Customer role | `customer.role` | L26 | Parties:64 | `customer.role` (nullable) | ⚠ same as above |
| Customer email | `customer.{email, address}` | L27 | Parties:65 | **NOT IN TYPE** | ❌ **field absent from `CustomerViewCustomer`** — type has name/contact/role/address only. JSX reads `customer.email`; map names it; type doesn't expose it. **Needs CA disposition** (add to type, or drop the line). |
| Customer address | `customer.address` | L28 | Parties:66 | `customer.address` (nullable) | ✓ |
| SKU name | `skus[i].name` | L58 etc. | PricingTable:120 | `CustomerViewSku.name` | ✓ |
| SKU code | `skus[i].code` | L58 etc. | PricingTable:121, TurnkeySummary:192 | `CustomerViewSku.label` | ⚠ **name drift** — fixture/map = `code`; type = `label`. Same semantic (friendly SKU label "GLW-30"). |
| SKU pack | `skus[i].pack` | L59 etc. | PricingTable:121 | `sku.pack` (nullable) | ⚠ type permits NULL (Slice 11 schema add still pending — see CustomerViewSku doc comment); JSX renders un-guarded — prototype has no NULL pack values |
| Tier label | `tiers[t].label` | L46 `"T1"` | PricingTable:102/106/107 | `CustomerViewTier.label` | ⚠ **semantic drift** — fixture uses short form `"T1"` for `.label` and reserves `tiers[t].full` for `"Tier 1"`; type carries only `label`. JSX uses both `tier.label` (column header) and `tier.full` (single-tier sub-line, hero). |
| Tier "full" form | `tiers[t].full` | L46 `"Tier 1"` | PricingTable:106, TurnkeySummary:215, ChargesBlock:268 | **NOT IN TYPE** | ❌ **field absent** — JSX expects `tier.full`; type has only `label`. Adapter must derive (`"Tier " + n`), or `full` is added to `CustomerViewTier`. |
| Tier quantity | `tiers[t].quantity` | L46 | PricingTable, GrandTotalRow, TurnkeySummary | `tier.quantity` | ✓ |
| Recommended flag | `tiers[t].recommended` | L47 `recommended: true` | PricingTable:96, GrandTotalRow:153, TurnkeySummary:235/240 | **NOT IN TYPE** (uses `recommendedTierIdx` at root) | ⚠ **shape drift** — fixture flags per-tier; type uses single index at root. Adapter must project the index into per-tier booleans OR JSX must dereference index against tier list. Functionally equivalent. |
| Per-tier unit price | `skus[i].tier_prices[t]` | L60 etc. | PricingTable:125, lineTotal | `sku.tierPrices` | ✓ |
| NULL price | `tier_prices[t] == null` | L80 (CAP-60 T1) | PricingTable:129 → "quote on request" | type contract (ReadonlyArray<number\|null>) | ✓ |
| Flat treatment | `skus[i].shape === "flat"` | L70 | PricingTable:116/130 | `sku.shape` string ("flat" enumerated) | ✓ |
| Partial treatment | `skus[i].shape === "partial"` | L80 | (drives StatePartial selection) | `sku.shape` ("partial" enumerated) | ✓ |
| Continued caption | "Tiered pricing · continued — {quote_number}" | DERIVED | PricingTable:90 | derived | ✓ |
| Layout | `pdf_layout` | (host prop) | StatePure passes through | `pdfLayout` | ✓ |
| Detail level | `detail_level` | (host prop) | StateX `detail` arg | **NOT IN TYPE** | ⚠ Addendum-1 axis. `detail_level: "itemized" \| "turnkey_only"` is not on `CustomerView`. Treated as render-time prop alongside `pdfLayout` (analogous shape). Needs disposition: add to type vs pass as separate render prop. |
| Service fee (project scope) | `service_fees[i] scope='project'` | L97–103 | ChargesBlock:271 | `CustomerViewServiceFee.scope='project'` | ✓ |
| Service fee (sku scope) | `service_fees[i] scope='sku'` | L104–110 + `sku_id` | ChargesBlock:271 (same loop) | `serviceFee.skuLabel?` | ⚠ fixture uses `sku_id`; type uses `skuLabel`. Mapping is reasonable (id→label) but verify adapter shape. |
| Service-fee label / sub / amount / qty | (same row) | L99–103 | ChargesBlock:273–275 | `label, sub, amount, qtyLabel` | ✓ |
| Freight line | `freight_lines[i]` | L114–127 | ChargesBlock:279 | `CustomerViewFreightLine` | ✓ |
| Freight tier_amounts[recIdx] | (per-row, recommended only) | L119 | ChargesBlock:283 | `freightLine.tierAmounts` (ReadonlyArray<number>) | ✓ |
| Retail benchmark | (intentionally NOT rendered) | L59/64/69/74/79/84 present | absent from JSX | `sku.retailBenchmark` (nullable; permitted on type) | ✓ holds — verified absent from JSX |
| State-A trigger | `freight_treatment='bundled' AND allocate_service_fees_to_cost=TRUE` | (production decision) | host prop | not on `CustomerView` (production-side composition) | ✓ |
| State-B trigger | `freight_treatment='pass_through' OR allocate=FALSE` | (production decision) | host prop | (same) | ✓ |
| State-C trigger | `tier_prices[t] == null for ≥1 SKU` | data-driven | derived | (same) | ✓ |

**Summary:** fixture↔type alignment is mostly snake↔camel translation
(adapter problem), but **3 real shape gaps** surface:
(a) `customer.email` rendered by JSX, named by map, missing from
type; (b) `tier.full` rendered, missing from type; (c) `detail_level`
not on `CustomerView`. Plus `preparedBy` lives at fixture's
`vendor.*` but production type has a top-level field. Adapter
contract decisions on every drift row — see §10.

## 3 · Boundary-guard assertion (Pattern 45)

Forbidden FIELD scan against `pdf-render.jsx` + `styles.css` +
`data.js`. Distinction: customer-facing PROSE mentioning these
concepts is permitted; reading the FIELD into the rendered tree
is the violation.

| Forbidden field | Grep result | Verdict |
|---|---|---|
| `margin_pct` / `margin` | jsx:9 comment "no cost/margin exposure"; data.js:5 comment "(margin, markup…)"; CSS `margin:` (1:1 unrelated CSS property) | ✓ absent from data + JSX |
| `markup` / `markup_pct` | data.js:5 comment only | ✓ absent |
| `unit_cost` / `cost` (per-component) | jsx:174 prose "Setup, tooling, freight, duty & tariffs are landed in the unit price"; jsx:278 "Pass-through freight · billed at cost"; data.js:117 "Container freight allocated per unit. Booked & billed at cost"; data.js:123 "actual billed at cost + 15%" | ⚠ **prose-mention permitted** (customer-facing context: "billed at cost" describes commercial treatment; no per-component cost rendered) |
| `supplier` | no matches | ✓ absent |
| `duty_pct` / `tariff_pct` | jsx:174/195 prose "duty & applicable tariffs"; data.js:38 prose "container freight, duty & applicable tariffs included in unit price" | ⚠ **prose-mention permitted** (incoterms-style language; no percent fields exposed) |
| `cbm_per_unit` / `sku_total_cbm` | no matches | ✓ absent |
| `version_number` | data.js:33 comment "friendly id — never version/scenario"; type comment | ✓ absent |
| `scenario_label` | data.js:33 comment only | ✓ absent |
| Audit fields (`audit_log.*`, `created_by`, `caused_by_audit_id`) | no matches | ✓ absent |
| `internal_note` | no matches | ✓ absent |
| Presence indicators ("Sarah is editing…") | no matches | ✓ absent |
| Debug / QA affordances | preview chrome only (`.cpdf-toolbar`, `.cpdf-dn`); excluded from artifact per `<Sheet>` boundary | ✓ absent from sheet tree |

**Special note on `retail_benchmark`:** present at `data.js:59, 64,
69, 74, 79, 84` on every SKU; **never read by any JSX in
`pdf-render.jsx`**. Confirmed by full-file grep of `retail` in
pdf-render.jsx → no matches. Designer notes §6 explicitly: "exists
in the data … but is **not rendered**." Boundary is honored.

**Special note on `shape`:** the per-SKU `shape: "step" | "flat" |
"partial"` is read by JSX (PricingTable:116, plus state-selection
in `skuSets`). Designer notes line 79 explicitly: "**The `shape`
field … drives render treatment and is not a forbidden field.**"
Banked as confirmed treatment-flag, not a forbidden cost-side field.

Build-time enforcement (R3 commitment #3 / Pattern 45) lives in the
production tree's `prebuild` verifier, not the prototype. The
prototype demonstrates a tree that satisfies the assertion.

## 4 · react-pdf portability flags (highest-value section)

For the F1.1 spike. Each row: prototype construct → react-pdf
equivalent → risk → file:line citation.

| Prototype construct | react-pdf equivalent | Risk | Citation |
|---|---|---|---|
| `<table>` / `<thead>` / `<tbody>` / `<tr>` / `<td>` | n/a — **none used**; flex rows/columns throughout | low | grep → zero hits in pdf-render.jsx |
| CSS Grid (`display: grid`, `grid-template-*`) | n/a — **none used** | low | grep → zero hits in styles.css `.pp-*` |
| CSS `gap` inside `.pp-*` tree | margins on children (per designer notes line 27 commitment) | **medium** | styles.css L234 `.pp-th-rec gap:4px`, L384 `.pp-grand-notes gap:3px`, L416 `.pp-tk-tier gap:4px`, L478 `.pp-tk-incl-list gap:5px`, L481 `.pp-tk-incl gap:8px` — **5 inside-sheet violations of the designer-stated "no gap" rule** |
| `position: absolute` running header / footer | `<View fixed>` + `Page` `padding` | low | styles.css L322 `.pp-runhead`, L335 `.pp-footer` |
| Hard-split `.pp-sheet` per state | **delete entirely** — production uses `<Page>` per page, automatic `wrap` + `break` | **HIGH — production must not hard-code** | pdf-render.jsx L335 `Sheet`, L433 `Break`, all StateX bodies. **Designer notes §2 caveat is explicit: hard splits are review affordance.** CC MUST replace with single `<Page>` + automatic-break flow. |
| `wrap={false}` candidates (kept-together) | react-pdf `wrap={false}` on `<View>` | low | designer notes §2 names charges block + terms block; CC reads as ChargesBlock + (eyebrow + h2 + TermsBlock + HowToAccept) atomic units |
| Repeating table header on overflow | `fixed` `<View>` inside the table region with `continued` flag | medium | designer notes Q2; prototype implements via `continued` prop on PricingTable (L81, L93) — react-pdf needs the `fixed` header pattern, not the prototype's per-sheet duplication |
| Web fonts (Newsreader, JetBrains Mono) | `Font.register({ family, fonts: [{src, fontWeight, fontStyle}] })` for each weight + italic | **HIGH** | styles.css L119 (sheet font-family), L148/171/225/249/etc. **Must register italic + bold variants** (lede emphasis, recommended-cell 600, partial-state italic) |
| `font-variant-numeric: tabular-nums` | font registration with `fontFeatureSettings: { tnum: 1 }` OR pick a font whose default is tabular (JetBrains Mono is monospace; Newsreader's tnum needs explicit opt-in) | **medium** | styles.css L250, L285, L351, L369, L378, L427, L433, L456, L462 — **9 instances** |
| `oklch()` colors | convert to hex / RGB at port time | **medium** | styles.css L103–111 `--pp-*` declarations all use `oklch()`; L306/411/469 standalone `oklch()` literals. **Spike must confirm react-pdf 3.x oklch support** — likely needs conversion. |
| CSS custom properties (`var(--pp-*)`) | inline literal values OR react-pdf `StyleSheet.create` with a shared palette object | low | declared L103–111; consumed throughout. Mechanical conversion. |
| `1.5px` borders | react-pdf `borderWidth: 1.5` (fractional supported in newer versions) | low | L136 (.pp-masthead), L197 (.pp-thead), L358 (.pp-grand), L442 (.pp-tk-hero), L409 (.pp-tk-card.rec) |
| `min-width: 0` on flex children | react-pdf supports via `style={{minWidth: 0}}` | low | L210, L211 |
| `align-items: baseline` | react-pdf Yoga baseline support is limited; may need `flex-end` fallback | **medium** | L203 (.pp-tr), L273 (.pp-charge-row), L323 (.pp-runhead), L336 (.pp-footer), L357 (.pp-grand), L441 (.pp-tk-hero) — **6 instances** |
| `display: inline-flex` | react-pdf has no inline-flex; use `<View style={{flexDirection:'row'}}>` inline within text | medium | L234 .pp-th-rec |
| `max-width: 42ch` / `64ch` | convert to px estimate (≈ 8px × ch for Newsreader at 12px) | low | L144 (vendor sub), L187 (lede), L318 (accept). ~336px / ~512px reasonable. |
| `&nbsp;` HTML entity inside `<Text>` | ` ` literal | low | pdf-render.jsx L173 "Per&nbsp;unit" |
| Negative margins on `.pp-tk-card.rec` | react-pdf supports negative margins; combined with `z-index` + `position: relative` | medium | L411 `margin: -2px -1px; z-index: 1; position: relative;` — the "lifted" recommended card relies on this stacking |
| `z-index` on `.pp-tk-card.rec` | react-pdf has limited z-index (renders in source order); may need DOM-order reshuffle | medium | L411 — recommended card needs to overlap neighbor borders; may need to render LAST or use a border-only re-paint trick |
| `box-shadow` on `.pp-sheet` | **drop entirely** — page-on-surface chrome; not artifact-bearing | low | L123–126; pure preview affordance |
| Pseudo-elements `::before` / `::after` | **none in `.pp-*` tree**; `cpdf-break::before/::after` is preview chrome (L93) | low | n/a |
| Media queries / dark-theme | none in `.pp-*` tree; `.cpdf-dn` (preview) has `[data-theme="dark"]` rules but PDF is theme-independent | low | designer notes §0 + styles.css L10 explicitly "fixed-light: the PDF is print-target, theme-independent" |
| Animations / transitions | none in `.pp-*` tree | low | grep `transition\|animation` → preview chrome only |
| SVG | none — `★` is a Unicode glyph (U+2605), rendered as text | low | font must contain U+2605 (Newsreader does; JetBrains Mono does) |
| Background gradients on artifact | none in `.pp-*`; `repeating-linear-gradient` is `.cpdf-stage` (preview only) | low | L17–22 preview only |
| Solid background colors | `oklch(0.97 …)` / `oklch(0.975 …)` warm tints on `.pp-c-rec`, `.pp-tk-card.rec`, `.pp-tk-included`, `.pp-notes` | low | convert oklch → hex same as colors |
| `font-style: italic` | requires italic variant of Newsreader registered | medium | L189 `.pp-lede em`, L247 `.pp-prod-flat`, L255 `.pp-price.req`, L266 `.pp-charge-sub`, L278 `.c-label .s`, L365 `.pp-grand .g-sub`, L372 `.pp-grand-num.req`, L382 `.pp-grand-num .from`, L436 `.pp-tk-total .from`, L437 `.pp-tk-total.req`, L458 `.pp-tk-hero .h-num.req`, L485 `.pp-tk-incl.out` |
| `text-transform: uppercase` | react-pdf has no `text-transform`; precompute uppercase string in JSX | medium | L161, L173, L228, L269, L298, L311, L329, L330, L341, L390, L423, L448, L474 — **13 instances**; JSX must call `.toUpperCase()` at render time |
| `letter-spacing` | supported as numeric value (em-equivalent) | low | many |
| `<em>` tags inside `<p>` | react-pdf needs nested `<Text>` with `fontStyle: italic` | low | StatePure:368, StatePassThrough:422, StatePartial:486 (the lede paragraphs) |
| `<strong>` tags inside `<div>` | react-pdf needs nested `<Text>` with `fontWeight: 500/600` | low | RunHead:320, Footer:328, Masthead:50–51 |
| Mixed inline elements with span children inside flex parents | react-pdf composes via `<Text>` (block) and inline `<Text>` (nested) | medium | PricingTable header cells (L98–108) chain `<span>` children for the `★` + label + sub-line |

Highest-risk three for the spike: **(1) the hard-split sheet model
must convert to automatic pagination**, **(2) web-font registration
(weights + italic + tabular figures)**, and **(3) `text-transform:
uppercase` requires JSX-side string transformation across 13
selectors**. All three are mechanical but touch every component.

## 5 · Pagination model summary

| Element | Value / source |
|---|---|
| Paper size | US Letter (8.5 × 11 in = 816 × 1056 px @ 96 dpi). Designer notes §2 + styles.css L114–115. CD did NOT design an A4 variant. |
| Page padding | `56px top / 64px sides / 88px bottom` (styles.css L120). Bottom band reserves the fixed footer. react-pdf `<Page padding={...}>`. |
| Continuation page padding | `64px top` (styles.css L331 `.pp-sheet.continuation`) to clear the running header. |
| First-page-only blocks | `Masthead` + `Parties`. Designer notes §2 "they are *not* `fixed`." → render in the page-1 flow, drop on pages 2+. |
| Running header (pages 2+) | `RunHead` — vendor name + quote # (left) · "Quotation · continued" (right). `fixed` in react-pdf, `render={({pageNumber}) => pageNumber > 1 ? <RunHead/> : null}`. |
| Footer (every page) | `Footer` — vendor + quote # (left) · "Page X of Y" (right). `fixed` + `render={({pageNumber, totalPages}) => …}`. |
| Kept-together blocks | Charges block (atomic — section eyebrow + h2 + sub + group label + rows). Terms block (eyebrow + h2 + TermsBlock + NotesBlock + HowToAccept). Designer notes §2 names both as `wrap={false}` candidates. |
| Where breaks fall — State A | Single page, both layouts, both detail levels. No break. |
| Where breaks fall — State B (itemized) | After charges block; commercial terms + notes + how-to-accept on page 2. **2 pages.** |
| Where breaks fall — State B (turnkey_only) | **Collapses to 1 page** — Addendum §A3 explicit. Turnkey suppresses itemized charges; fees fold into total; terms fit on page 1. |
| Where breaks fall — State C (itemized) | Mid-table between SKU 4 and SKU 5; recommended-column treatment + header repeat carries into page 2 continuation. Grand total + foot land on page 2 before terms. **2 pages.** |
| Where breaks fall — State C (turnkey_only) | 1 page — no SKU rows to overflow. |
| Repeating table header | `PricingTable` accepts `continued` prop → renders eyebrow caption "Tiered pricing · continued — DPS-2418" above re-rendered thead. In react-pdf this becomes a `fixed` header `<View>` inside the table region. |
| Page count surfacing | Footer reads `Page X of Y` — `totalPages` from react-pdf render callback. |

> **PRODUCTION HARD-RULE — LOUD CALL-OUT:**
>
> The prototype's three-state composition functions each emit
> **multiple `<Sheet>` elements separated by `<Break>` markers**
> (StatePassThrough L415–443: two `Sheet`s separated by `<Break>`;
> StatePartial L478–506: same). This is **REVIEW CHROME ONLY**
> per designer notes §2 third-from-last paragraph ("breaks here
> are *hard-split* into separate `.pp-sheet`s so the treatment is
> visible and reviewable. Production pagination is automatic.").
>
> **CC MUST NOT port the hard-split structure.** The production
> tree is **one `<Page>` per state-composition function**, with
> content as a single flowing `<View>` tree, and react-pdf's
> automatic break + `wrap` + `wrap={false}` props handle the
> physical splits. Hard-coding `<Page>` boundaries based on the
> prototype's `<Sheet>` boundaries replicates the review
> affordance, not the production pagination. The bug failure
> mode: a 6-SKU State-C table that should overflow at SKU 5
> instead gets jammed onto page 1 forever (or split at the
> wrong row) because the hard-coded boundary fires regardless
> of content height.

## 6 · B/W (grayscale) treatment

CD's 4 redundant recommended-tier signals (designer notes §4 Q1):

| Signal | Survives B/W? | Mechanism |
|---|---|---|
| **Bordered column** | ✓ yes | hairline box: `border-left: 1px solid var(--pp-rec-edge)` + matching right. Header gets top border (L221), grand row gets bottom (L366). Closes on the turnkey total — column literally boxed. Structural; renders as a dark hairline in B/W. |
| **Weight** | ✓ yes | `.pp-c-rec .pp-price { font-weight: 600 }` (L252); `.pp-tk-card.rec .pp-tk-total { font-weight: 600 }` (L429). All other tier prices are 500. Survives B/W as visible bolder strokes. |
| **Label** | ✓ yes | `★` glyph + "recommended" in `.pp-th-sub .rec-word` (L237–238). Glyph is a Unicode character (`★` = U+2605); not color-dependent. The "recommended" word renders in `--pp-star` (warm) on color, degrades to medium gray on B/W — but the **glyph itself** remains visible regardless. |
| **Tint** | ✗ no (decorative-only) | `background: var(--pp-rec-tint)` = `oklch(0.975 0.020 95)` (L109). Very faint warm fill; degrades to ~98% light gray on B/W. **Designer notes line 64 explicit: "Decorative only; degrades to light gray and is never the sole signal."** |

**Color is NEVER the sole signal.** Removing all four color
attributes would still leave three structural signals visible. In
`single_tier` layout the bracket drops (nothing to bracket against)
— the "★ T2 · 10k units · recommended" label carries the
treatment alone (PricingTable L106). Verified at jsx:106.

## 7 · Three-state × two-layout × two-detail (12-cell) matrix

| State | Layout | Detail | Pages | Where exercised in prototype |
|---|---|---|---|---|
| A · Pure tier-pricing | tier_table | itemized | 1 | StatePure L348–384, `turnkey=false` branch L364–375 |
| A | tier_table | turnkey_only | 1 | StatePure, `turnkey=true` branch L358–362 (TurnkeySummary cards) |
| A | single_tier | itemized | 1 | StatePure with `layout="single_tier"`; PricingTable cols collapse to recommended-only (L84) |
| A | single_tier | turnkey_only | 1 | StatePure with `layout="single_tier"` + `turnkey=true` → TurnkeySummary hero (L207–224) |
| B · Pass-through + fees | tier_table | itemized | 2 | StatePassThrough L413–446 (2 `<Sheet>`s; page 1 = table + charges; page 2 = terms) |
| B | tier_table | turnkey_only | **1 (collapse)** | StatePassThrough L392–411 (single sheet; fees folded into total; terms fit on p1) |
| B | single_tier | itemized | 2 | Same as B/tier_table/itemized but PricingTable layout=single_tier |
| B | single_tier | turnkey_only | 1 | StatePassThrough L392–411 with layout=single_tier → hero |
| C · Partial completeness | tier_table | itemized | 2 (table overflow) | StatePartial L477–507 (6 SKUs split 4+2; continued thead on p2; grand on p2) |
| C | tier_table | turnkey_only | 1 | StatePartial L455–472 |
| C | single_tier | itemized | 2 | Same as C/tier_table/itemized w/ single column |
| C | single_tier | turnkey_only | 1 | StatePartial L455–472 with layout=single_tier → hero with `partial` flag |

All 12 cells exercised. The State-B/turnkey_only 2→1 collapse
(designer notes §A3 trailing paragraph + Addendum L99 of data-source
map) confirmed at code level via separate JSX branch (L392 vs L413).

Page counts cited by designer notes §0 table:
| | `tier_table` | `single_tier` |
|---|---|---|
| A | 1 | 1 |
| B | 2 (terms on p2) | 2 |
| C | 2 (table overflows) | 2 |

Designer notes table predates Addendum 1; the addendum adds the
`turnkey_only` collapse for State B (and 1-page outcome for State C
turnkey_only). Production pagination must compute count from content
height, not hard-code per cell.

## 8 · Q-disposition capture (CD's as-built)

CA's brief enumerates Q1–Q4 + Addendum Q1–Q3. CD's resolutions:

| CA's Q | CD's resolution (verified against JSX/CSS) | Citation |
|---|---|---|
| **Q1 · Paper format** | US Letter — locked. No A4 path designed. | designer notes §2 + styles.css L114. CD acknowledges in §0; no A4 variant in CSS. |
| **Q2 · Recommended-tier highlight in B/W** | 4 redundant signals (bracket + weight + ★/label + tint); 3 survive grayscale; tint never sole signal. | designer notes §4 Q1; verified §6 above. |
| **Q3 · Pricing-table overflow / header repeat** | Table breaks; thead re-renders preceded by `pp-eyebrow` caption "Tiered pricing · continued — {quote_number}"; recommended-column treatment persists across the break. | designer notes §4 Q2; PricingTable L88–112 (`continued` prop renders eyebrow + repeats thead). |
| **Q4 · Partial-completeness sub-header placement** | **Inline** above the table in the lede paragraph (italic, naming SKU + pending milestone). NOT relegated to footnote. Footer legend reinforces ("quote on request — pricing finalizes once the noted milestone clears"). | designer notes §4 Q4; StatePartial L485–487 (lede); PricingFoot L254 (legend). |
| **Addendum Q1 · In-cell line-total stack** | Yes — line total stacks UNDER the unit price in same cell; `.pp-linetotal` mono 9.5px muted (L348–353); applies to both layouts. Flat SKUs: unit reads em-dash after first tier, **line total still shown per tier** (the unit may be flat but the order value scales). Caption clarified to "Flat **unit** across all volume tiers." | designer notes §A1; PricingTable L127 (lineTotal), L135 (.pp-linetotal render). |
| **Addendum Q2 · Grand-total weighting** | Per-tier sum row (`.pp-grand`) — heavy rule (`1.5px solid --pp-strong`), Newsreader 14/600 label, mono 14/600 figures, tabular. Outweights line totals; doesn't compete with per-tier read. Recommended column closes its bracket on the grand row (`border-bottom: 1px solid var(--pp-rec-edge)` L366). **Per-unit blended all-in** stacks below each tier figure ("$X /unit"); answers "what does all-in work out to per piece?" In single_tier collapses to single all-in figure. | designer notes §A2; GrandTotalRow L148–181; CSS L356–393. |
| **Addendum Q3 · Turnkey-only sparse treatment** | tier_table → row of `.pp-tk-card`s (recommended lifted via 1.5px border + tint + "recommended" tag); single_tier → `.pp-tk-hero` with 40px figure + recommended tier/qty meta. Both anchored by "What this turnkey price includes" block (`.pp-tk-included`) listing covered SKUs + inclusion checks. **Pass-through 2→1 page collapse** because turnkey suppresses itemized charges block. | designer notes §A3; TurnkeySummary L184–248; CSS L396–485. |

**Things CD considered and rejected** (designer notes §6 + §A6):
- Retail-benchmark column (in data, not rendered) — verified absent
- Per-tier freight amounts in charges block — only recommended-tier shown; "per-tier amounts available on request"
- Color-only recommended ring — rejected on grayscale reality
- Soft page breaks as dashed rules — rejected (hides runhead/footer behavior)
- Dedicated total column at 4 tiers — rejected (column-crush math)
- Folding pass-through freight into turnkey total — rejected (billed at cost, can't be a fixed quoted figure)
- Hiding charges block in itemized pass-through — kept (breakdown is the point)

## 9 · Fixture-vs-real wiring

| Field | Fixture value (`data.js`) | Real (LOCKED or production-derived) | Status |
|---|---|---|---|
| `vendor.name` | `"The DPS"` (L14) | `"The DPS"` (LOCKED per CA brief; firm_settings RI.7) | ✓ matches |
| `vendor.sub` | `"Turnkey product development & manufacturing for beauty, health & wellness brands"` (L15) | locked-real string (CA brief §4) | ✓ matches verbatim |
| `vendor.address` | `"3943 Irvine Blvd, #1129 · Irvine, CA 92602"` (L16) | locked-real (CA brief: `"3943 Irvine Blvd, #1129 Irvine, CA 92602"`) | ⚠ **minor formatting drift** — fixture inserts `·` separator between street and city (`#1129 · Irvine`); CA brief uses single space (`#1129 Irvine`). Cosmetic; either acceptable, but disposition needed before production. |
| `vendor.contact_name` | `"Maya Okafor"` (L17) | **fixture identity, NOT real** — per DEC-8, prepared-by resolves from the sending PM (`projects.sales_rep_user_id → users` snapshot at `sendQuote`, HubSpot one-shot fallback). | ⚠ fixture-only |
| `vendor.contact_email` | `"maya@dps.co"` (L18) | **fixture domain `@dps.co`; real domain is `@thedps.co`** (per Edward's email at top of file `edward@thedps.co`) | ⚠ fixture domain. Spike must NOT bake `dps.co` literal. |
| `vendor.contact_phone` | `"+1 (909) 555-0142"` (L19) | fixture (555-01XX is the reserved-for-fiction NANP range) | ⚠ fixture-only. Type permits NULL (RI.7) → graceful-degradation render when absent (Pattern 45 banked from PdfHeader `preparedBy.phone === null` pattern). |
| `customer.*` | `Lumen & Co. / Beth Yamamoto / VP Operations / beth@lumenco.com / 1450 Mission St SF` (L24–28) | from HubSpot deal projection at production-time | ⚠ fixture-only |
| `customer.email` | rendered at Parties L65 | **NOT IN `CustomerViewCustomer` type** | ❌ shape gap — see §10 |
| `quote.quote_number` | `"DPS-2418"` (L33) | `firm_settings.quote_number_prefix + quote_number_seq` (RI.7); NULL for drafts | ⚠ fixture-only value; null-render path not exercised by prototype |
| `quote.issued_date`/`sentDate` | `"2026-05-17"` (L34) | `quotes.sent_at` (production) | ⚠ field-name drift (`issued_date` vs `sentDate`) |
| `retail_benchmark` (per SKU) | 48 / 68 / 32 / 48 / 38 / 72 (L59–84) | from quote_skus / leaf table (RI.6 projection) | ✓ present in fixture, **confirmed NOT RENDERED** anywhere in `pdf-render.jsx` (full-file grep `retail` → 0 matches in JSX). Designer notes §6 explicit deferral; CustomerViewSku type permits it. |

## 10 · Open questions for CA + Edward (audit-surfaced)

Concrete items the audit couldn't resolve. Implementation /
design re-arbitration deliberately excluded.

- **Q-A · `customer.email` field absent from `CustomerViewCustomer`.**
  Map names it, JSX reads it (`Parties:65`), data fixture carries it,
  type has no field. Three resolutions possible: (a) add `email` to
  `CustomerViewCustomer`; (b) drop the JSX line; (c) inline render
  from a derived source. Disposition needed pre-brief.

- **Q-B · `tier.full` field absent from `CustomerViewTier`.** JSX
  reads `tier.full` ("Tier 1") at PricingTable:106 (single-tier
  sub-line), TurnkeySummary:215 (hero), ChargesBlock:268 (charges
  sub). Fixture carries it. Type has only `label` (the short form
  "T1"). Adapter can derive (`"Tier " + n`) or type can be extended.
  Disposition needed.

- **Q-C · `tier.recommended` per-tier flag vs `recommendedTierIdx`
  root-level index.** Functionally equivalent; mechanical choice.
  Fixture uses per-tier boolean; production type uses single index.
  Adapter normalization needed. Confirm direction (project index to
  per-tier boolean at adapter? or change JSX to dereference index?).

- **Q-D · `vendor.contact_*` (fixture) vs top-level `preparedBy`
  (type).** Slice RI.7 DEC-8 split prepared-by out of vendor. Fixture
  still nests under `vendor.contact_name/email/phone`. JSX reads
  `vendor.contact_name` at Parties:71. Adapter contract: either (a)
  fixture-shape preserved in JSX and adapter projects
  `preparedBy.*` → `vendor.contact_*`; OR (b) JSX is rewritten on
  port to read `preparedBy.*` directly. Pattern 30 verbatim-port
  would lean toward preserving fixture shape, but production type
  intent is the split. Disposition needed.

- **Q-E · `detail_level` field is not on `CustomerView`.** Addendum 1
  introduces `detail_level: "itemized" | "turnkey_only"` (analogous
  to existing `pdfLayout`). Type has `pdfLayout` but no
  `detailLevel`. Either add to type or pass as separate render
  prop. Disposition needed.

- **Q-F · `incoterms_bundled` vs `incoterms_passthrough` resolution
  site.** Fixture carries both variants; type carries single
  `incoterms` string. Data-source map says "derived from freight
  treatment." Confirm resolution lives in the projection adapter
  (server) or in the renderer (passing both, picking at render
  time). Cleaner contract = adapter-side; needs confirmation.

- **Q-G · `customer.contact` and `customer.role` are both nullable
  (type) but JSX renders `{contact} · {role}` un-guarded at
  Parties:64.** Two NULLs would render `null · null`. Either type
  drops the nullability OR JSX null-guards in port. Disposition
  needed.

- **Q-H · Designer notes §2 commitment "no CSS `gap` inside the
  sheet" contradicts 5 inside-sheet `gap` declarations** (styles.css
  L234, L384, L416, L478, L481). Treatment for port: (a) trust
  react-pdf's recent gap support and ship verbatim; (b) replace with
  margin equivalents per the stated design intent. F1.1 spike
  question — flagged here so disposition lands before spike
  finishes.

- **Q-I · `oklch()` color values throughout** (styles.css L103–111
  declarations + scattered literals). react-pdf 3.x oklch support is
  uncertain. Confirm at spike whether to (a) preserve oklch verbatim
  if supported, or (b) convert at port time (and own the conversion
  in a shared palette helper).

- **Q-J · `font-variant-numeric: tabular-nums` (9 instances)** —
  requires both font files (Newsreader + JetBrains Mono) to carry the
  OTF `tnum` feature AND react-pdf's `fontFeatureSettings` to opt
  in. Spike must confirm. JetBrains Mono is monospace and effectively
  tabular by default; Newsreader's prices/totals are where the
  feature actually matters.

- **Q-K · Vendor address formatting** — fixture uses `·` separator
  (`#1129 · Irvine`); CA's locked-real string uses single space
  (`#1129 Irvine`). Cosmetic but real. Confirm canonical formatting.

- **Q-L · `tier_table` State-B itemized: does the GrandTotalRow ship
  with `freightAtCost={true}` AND `foldFees={true}` simultaneously?**
  Verified at L425 `<GrandTotalRow … foldFees freightAtCost
  allInUnit={false} />` — both flags true; GrandTotalRow renders
  "Includes …" note (folded fees) AND "Plus …" note (freight at
  cost). PMs reading should see both side-by-side. Confirm this is
  the intended pairing (not a one-or-the-other affordance).

---

## Standing by

This audit is the Slice 11 brief input per CA's §7 sequencing. CC
produces next the **F1.1 react-pdf portability spike** (separate
artifact) — exercising the §4 portability flags against real
react-pdf primitives, with particular focus on the three highest-
risk items (automatic pagination model, web-font registration with
italic + tabular figures, `text-transform: uppercase` JSX-side
transformation). Spike result lands in a separate document and
informs the brief's choice of pagination library + bundle of
mechanical-conversion items.

Open questions Q-A through Q-L are flagged for CA + Edward
disposition. Items A–G and K are notation / contract decisions that
can land inline in the brief once dispositioned; items H–J + L
inform the brief's portability scope and may feed back from the
F1.1 spike results.
