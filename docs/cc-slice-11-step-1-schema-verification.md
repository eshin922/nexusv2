# Slice 11 Step 1 — Pattern 22 §0.5 schema verification

**Author:** CC
**Date:** 2026-06-29
**Status:** read-only research; awaits Edward + CA disposition
**Brief:** `docs/cc-comm-slice-11-customer-pdf-brief.md`
**Audit input:** `docs/cc-customer-pdf-audit-slice11-input.md`
**Schema authoritative source:** `src/db/schema.ts` (1925 lines)
**Boundary-type authoritative source:** `src/types/quote.ts` (149 lines)
**Adapter authoritative source:** `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:184-263`

Step 1 §0.5 sweep verifies every schema entity the brief references against
current `schema.ts`, the `CustomerView` type, the current page-level
adapter, and the costing-bundle shape. Per Pattern 22 standing protocol
the brief is the scope contract; §0.5 catches dispositions before §0
(no migrations yet).

---

## §1 · Two pre-flagged catches (from brief approval)

### Catch A — `customer.email` source

**Brief commitment** (§3 Q-A): "Add `email` to the type. Real
customer-visible field; parties block renders it."
**CD source dependency:** `pdf-render.jsx:65` reads `customer.email`;
`data.js:27` carries `beth@lumenco.com`; data-source map L31 names it
`customer.{email, address}` (HubSpot projection).

**Schema reality** (verified against `src/db/schema.ts:216-253`,
`src/db/schema.ts:856-883`):

| Source | Customer-email-equivalent column | Status |
|---|---|---|
| `projects` (DB row, 216-253) | none — only `clientName` (225), `salesRepUserId` (226), `pmUserId` (229), `dealStage` (237) | ❌ missing |
| `hubspot_deals_cache` (856-883) | `salesRepEmail` (867), `pmEmail` (869), `associatedCompanyName` (871) — **NO `associated_company_email`** | ❌ missing |
| `users` (188-214) | per-user `email` (193), but `users` is internal staff, NOT customer contacts | n/a |

**HubSpot projection paths** (verified `src/app/actions/projects.ts:90,
143, 150, 161`): every `clientName` write resolves from
`hubspotDealsCache.associatedCompanyName`. There is no equivalent
`associatedCompanyEmail` field on the cache, and the
`src/lib/hubspot.ts` / `src/lib/hubspot-mapper.ts` paths do not pull a
contact-level email today (verified by grep on
`client_email|customer.email|company_email` over `src/lib/` — zero hits).

**Current adapter** (`quote/page.tsx:237-245`): hardcodes
`contact: null`, `role: null`, `address: null` on `CustomerView.customer`
because none of those fields ship from HubSpot yet either. `email` was
never present at all — the JSX-side disposition Q-G null-guard catches
all four nullable customer subfields uniformly.

**Disposition options:**

| Option | Shape | Cost | Surface |
|---|---|---|---|
| (a) wire existing | n/a — no column exists | — | — |
| **(b) additive migration** | `projects.client_email text` nullable + HubSpot company-record sync extension + adapter projection + JSX null-guard (Q-G) | medium — touches `projects` schema + `hubspot-mapper.ts` pull paths + `projects.ts` action layer | persists across deal refreshes; reusable for any future customer-email surface (Slice 12 HubSpot deal-stage push won't need it but Mark-Accepted email notifications might) |
| (c) NULL-safe render | type `email: string \| null` + adapter sets `null` + JSX drops the line when null (precedent: `preparedBy.phone === null` at `pdf-header.tsx:81`) | minimal — type field + 1 conditional | render-only; doesn't unblock any future read |

**Recommendation: option (c) NULL-safe render for v1.**

Rationale:
1. **HubSpot data wiring is itself a discovery item.** Pulling a
   contact email through the HubSpot company → contacts join is
   non-trivial (HubSpot deals have an Associated Company, but the
   "primary contact email" is on the Contact object joined separately).
   The brief is silent on which contact's email to surface (deal
   owner's? primary contact's? company-record's?).
2. **Pattern 32 pre-production tolerance applies.** No customer PDFs
   have shipped yet from Nexus; the email line in CD's prototype is
   `beth@lumenco.com` (fixture). Production v1 doesn't have a
   stakeholder asking for this field today.
3. **Precedent matches the existing customer subfields.** `contact`,
   `role`, `address` all carry `string | null` already (`types/quote.ts:45-47`),
   adapter hardcodes them `null` (`quote/page.tsx:242-244`), and the
   port plan (audit Q-G) calls for JSX null-guarding the whole parties
   block uniformly. Email folds into that workstream as a fourth
   nullable subfield — zero new disposition shape.
4. **Future-CC** can promote to (b) when HubSpot contact sync lands
   for a separate driver (Slice 12 Mark-Accepted's customer-acceptance
   email notification, hypothetical post-v1 outbound email integration,
   etc.). The type stays `string | null`; only the adapter changes.

**If Edward + CA prefer (b):** the column add is mechanical
(`projects.client_email text` + index optional); the wiring depth is in
`hubspot-mapper.ts` (decide which HubSpot field maps in) +
`hubspotDealsCache` cache row (add `associated_company_email` text +
backfill from a separate HubSpot Companies API call during
`syncDeals`) + `projects.ts` actions (`importProject` /
`refreshDealContext` paths to populate `clientEmail` from the cache).
Estimated migration + wiring scope: 1 day-equivalent. Slice 11 step plan
absorbs it as a sub-step under Step 4 (adapter contract); no separate
slice needed.

---

### Catch B — `quotes.detail_level` snapshot column

**Brief commitment** (§3 Q-E): "Add `detailLevel: 'itemized' |
'turnkey_only'` to `CustomerView`, mirroring `pdfLayout`. Sent-time
parameter; snapshots the same way."

**Schema reality — `pdfLayout` precedent verification** (the brief
references "the same way as pdfLayout"):

| Aspect | `pdfLayout` today | Notes |
|---|---|---|
| Live column on `quotes`? | **NO** | grep `pdf_layout` over `src/db/schema.ts` → 0 hits. `quotes` table inspected line-by-line (255-416); no `pdf_layout` column. |
| Snapshot column? | **NO** | grep on `pdfLayoutSnapshot|pdf_layout_snapshot` → 0 hits in schema |
| PG enum? | **NO** | no `pdf_layout` enum in `pgEnum` declarations (verified lines 22-185) |
| sendQuote writes? | **NO** | `sendQuote` (`quotes.ts:1293-1485`) snapshots tcs/paymentTerms/leadTime/incoterms/daysValid + preparedBy; does NOT touch pdfLayout |
| Current source | **render-time UI state** | `quote-host.tsx:127` `useState<CustomerViewPdfLayout>(view.pdfLayout)`; `view.pdfLayout` hardcoded `"tier_table"` at `quote/page.tsx:262` |

**This is the §0.5 finding.** The brief's assumption "mirroring
pdfLayout — sent-time parameter; snapshots the same way" inherits a
**non-existent precedent**. `pdfLayout` today is a render-time prop,
not a quote-row column, not a snapshot. There is nothing on the schema
for `detail_level` to mirror.

**Disposition fork** (Edward + CA pick one):

| Fork | Migration shape | sendQuote write | Read path |
|---|---|---|---|
| **(1) Both snapshot** | additive: `quotes.pdf_layout pdf_layout` + `quotes.detail_level detail_level` (two new pgEnums + two new columns; nullable until send, default after backfill) | `sendQuote` adds both writes inside the existing transaction (same shape as DEC-7 commercial snapshots) | drafts → URL search param or PM toggle UI state; sent+ → `quote.pdf_layout` / `quote.detail_level` columns |
| **(2) Render-time both** | no migration — both stay as `searchParams` / preview-toolbar `useState` | n/a | drafts AND sent quotes both derive from URL searchParam at render; sent quotes carry NO record of the PM's pre-send choice |
| **(3) Hybrid (existing-pattern asymmetric)** | additive: `quotes.detail_level detail_level` only (analog to RI.7 `payment_terms_snapshot` pattern) — but force pdfLayout to also gain a snapshot column for consistency | same as (1) | same as (1) |

**Recommendation: fork (1) — both snapshot.**

Rationale:
1. **Customer-visible artifact must reproduce post-send.** A PM who
   sent a tier_table itemized PDF in May 2026 needs the artifact
   re-downloadable in October 2026 in the same shape (Pattern 45
   audit-friendliness; Brief §7 persists exact bytes for the same
   reason — "the render path we don't get to apologize for"). Without
   columns, "re-render this sent PDF" is impossible — the layout
   choice is lost.
2. **Symmetry holds.** Fork (1) lands `pdfLayout` as a snapshot
   alongside `detailLevel` — same DEC-7-style pattern as RI.7's
   commercial snapshots. The brief's "snapshots the same way" framing
   becomes accurate; it just requires `pdfLayout` to be retrofitted
   into the snapshot fleet alongside the new column.
3. **Per-quote PM choice is a real edit state.** Today the layout
   toggle in `preview-toolbar.tsx:127-141` is render-time-only; a PM
   who wants tier_table for quote A and single_tier for quote B has
   no persistent way to set that pre-send. Fork (1) makes the
   toggle write the column (live for drafts, snapshot at send).

**Migration shape (proposed for Edward + CA disposition):**

```sql
-- 0022 (or next free number) — Slice 11 customer-PDF snapshot columns
CREATE TYPE "pdf_layout" AS ENUM ('tier_table', 'single_tier');
CREATE TYPE "detail_level" AS ENUM ('itemized', 'turnkey_only');

ALTER TABLE "quotes" ADD COLUMN "pdf_layout" "pdf_layout";
ALTER TABLE "quotes" ADD COLUMN "detail_level" "detail_level";

-- No backfill — existing sent quotes don't have either choice
-- on record (render-time-only). Live drafts pick up NULL → adapter
-- defaults to 'tier_table' + 'itemized' (current behavior).
-- sendQuote action writes both at send-time alongside DEC-7
-- snapshots in the existing transaction.
```

**Cross-consumer impact:**

| Site | Touch | Reason |
|---|---|---|
| `src/app/actions/quotes.ts:1429-1449` sendQuote SET clause | add `pdfLayout` + `detailLevel` writes inside the existing `.update(quotes).set({...})` | snapshot at send (DEC-7 analog) |
| `src/app/actions/quotes.ts:1455-1477` sendQuote audit row | add `pdfLayout`/`detailLevel` to `diff_json.snapshots` | audit forensics |
| `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:236-263` adapter | replace `pdfLayout: "tier_table"` with `isSent ? quote.pdfLayout : (searchParams.layout ?? 'tier_table')`; add `detailLevel` projection identically | live-vs-snapshot read path (DEC-7 analog) |
| `src/components/quote/preview-toolbar.tsx:124-141` layout toggle | when draft, surface URL searchParam writes; when sent+, render read-only display of snapshot value | UX consistency with the live-vs-snapshot split |
| `src/components/quote/quote-host.tsx:127` `pdfLayout` useState | wire from `view.pdfLayout` (which now resolves to real column on sent) | existing wiring works; just pulls real value |
| `src/types/quote.ts:131-149` `CustomerView` | add `detailLevel: 'itemized' \| 'turnkey_only'` field | type contract update |

**Edward override available.** If the persistence framing feels
heavy for v1 and forks (2) is the call, the Slice 11 implementation
simplifies to: `detailLevel` becomes a separate prop alongside
`pdfLayout` in `QuoteHost` (both URL-driven render-time choices), no
schema migration, no sendQuote change. Trade-off: a re-rendered sent
PDF in October 2026 may not match the original byte-for-byte if PMs
don't include the layout param in the bookmark URL. Pattern 45
audit-friendliness leans toward (1).

---

## §2 · Other schema entities the brief references

Walks every block in CD's data-source map (`docs/design-prototypes/dist/Nexus Customer PDF Render/docs/cd-customer-pdf-render-data-source-map.md`). Status legend:
✓ wired (real data flows today) · ⚠ adapter-only (type exists, adapter
hardcodes or stubs) · ❌ missing (no source).

| Block | Brief commitment | Schema source | Adapter / verification | Status |
|---|---|---|---|---|
| **Vendor name** | RI.7 live read | `firm_settings.vendor_name` (522) | `quote/page.tsx:123` `firm?.vendorName ?? VENDOR_FIXTURE.name` | ✓ |
| **Vendor tagline** | RI.7 live read | `firm_settings.vendor_tagline` (523) | `quote/page.tsx:124` | ✓ |
| **Vendor address** | RI.7 live read | `firm_settings.vendor_address` (524) | `quote/page.tsx:125` | ✓ |
| **Customer name** | HubSpot projection | `projects.client_name` (225) → from `hubspotDealsCache.associated_company_name` (871) via `projects.ts:90` | `quote/page.tsx:241` `project.clientName ?? "{customer-pending}"` | ✓ (the `"{customer-pending}"` fallback was a Pattern 45 HIGH finding pre-Step 10 sweep; resolved as fallback string acceptable when projects table guarantees clientName non-null in production) |
| **Customer email** | brief §3 Q-A: add to type | **none** — see Catch A above | adapter today hardcodes `customer.contact/role/address = null` (242-244); no `email` field at all | ❌ (Catch A) |
| **Customer contact / role / address** | nullable; Q-G null-guard | none on `projects`; not pulled from HubSpot today | adapter hardcodes `null` | ⚠ adapter-only; same family as Catch A (banked deferral) |
| **Quote number** | RI.7 DEC-4 | `quotes.quote_number` (358) + `quote_number_seq` sequence (drizzle/0020) | `quote/page.tsx:132` `isSent ? quote.quoteNumber : null`; PdfHeader stubs to `QUOTE_STUBS.quoteNumber` when null | ✓ |
| **Sent date** | RI.7 | `quotes.sent_at` (269) | `quote/page.tsx:248` `quote.sentAt.toISOString().slice(0, 10)` | ✓ |
| **Valid until** | RI.7 DEC-7 | `quotes.valid_until` (297); written by sendQuote (1435) | `quote/page.tsx:249` | ✓ |
| **Payment terms** | RI.7 DEC-7 split | drafts: `firm_settings.payment_terms_default` (527); sent+: `quotes.payment_terms_snapshot` (362) | `quote/page.tsx:133-135` | ✓ |
| **Lead time** | RI.7 DEC-7 split | `firm_settings.lead_time_default` (528) / `quotes.lead_time_snapshot` (363) | `quote/page.tsx:136-138` | ✓ |
| **Incoterms** | RI.7 DEC-7; brief §3 Q-F: adapter resolves bundled↔passthrough server-side | `firm_settings.incoterms_default` (529) / `quotes.incoterms_snapshot` (364); per-leg variant at `freight_legs.incoterm` (627) | `quote/page.tsx:139-141`; QuoteHost overlays `includeIncoterms` per dev sub-state | ✓ (note: per-leg incoterm vs quote-level snapshot is a render-time decision; brief's "single resolved string" plan holds) |
| **TCS** | RI.7 | `firm_settings.tcs_default` (526) / `quotes.tcs_snapshot` (365) | `quote/page.tsx:142` | ✓ |
| **PreparedBy name/email/phone** | RI.7 DEC-8 split | drafts: live via `users.name/email/phone` from `projects.sales_rep_user_id` join (226); sent+: `quotes.prepared_by_*_snapshot` (374-376) | `quote/page.tsx:144-182` | ✓ (HubSpot owner fallback wired at lines 172-181 + sendQuote 1392-1402) |
| **Customer-facing notes** | RI.7 | `quotes.customer_facing_notes` (295) | `quote/page.tsx:252` | ✓ |
| **Tiers (label, qty)** | bundle projection | `quote_tiers.label` (425) + `quote_tiers.qty` (426) | `quote/page.tsx:186-190` via `bundle.data.costing.tiers` | ✓ |
| **`tier.full` form** | brief §3 Q-B: derive at adapter (`"Tier " + n`) | n/a — derivable | adapter today projects `label: t.label` only; needs Q-B derivation pass at Step 4 | ⚠ disposition locked; adapter-only |
| **Recommended tier (per-tier or idx?)** | brief §3 Q-C: adapter normalizes idx → per-tier bool inside JSX; §6: wire REAL `recommendedTierIdx` | `quote_tiers.recommended` (440), `boolean NOT NULL DEFAULT false`, "one per quote" invariant action-layer-enforced (no DB constraint) | adapter today STUBBED at `quote/page.tsx:232-233` (`Math.floor(tiers.length/2)`). Real wiring: `tiers.findIndex((t) => t.recommended)`, fallback to null (or middle tier per Pattern 45 graceful-degradation). Schema source EXISTS — wiring is pure adapter work. | ⚠ adapter-only; no migration needed |
| **SKU name + label + pack + unitsPerPack** | NEW-model projection | `assemblies.name` + `leaves.name` (joined via `assembly_leaves`); `assemblies.sku` (1336) + `leaves.sku` (1386); `assemblies.pack_label` (1338) | `quote/page.tsx:197-228` reads `bundle.data.costing.skuRollups` (filtered to `skuRole === "leaf"`); pack hardcoded null at line 222 per Pattern 45 graceful-degradation | ✓ name/label; ⚠ pack (deferred per existing schema TODO at types/quote.ts:84-89 — Slice 11 owns it) |
| **Per-tier unit price** | bundle projection | derived from cost rows + adjustments; `bundle.data.costing.skuRollups[].perTier[].requiredSellPerUnit` | `quote/page.tsx:199-202` | ✓ |
| **Shape (step↓/flat/partial)** | derived at adapter | computed from tierPrices nullness + equality | `quote/page.tsx:203-210` | ✓ |
| **Retail benchmark** | brief §9 explicit drop | `quote_skus.retail_benchmark` (OLD model — now legacy); NEW model doesn't carry it | adapter projects `retailBenchmark: skuMeta?.retailBenchmark ?? null` at `quote/page.tsx:224`; **NEVER read by any pdf/ component** (grep verified `view\.retailBenchmark` over `src/components/` → 0 hits) | drop per §9 (see §3) |
| **Service fees** | brief §5 F1.5: wire real | NEW-model `assembly_production_inputs` (1784): `setup_fee_total` (1809), `tooling_artwork_total` (1810), `rd_total` (1813), `other_service_total` (1814) + per-assembly `allocate_service_fees_to_cost` (1797) | adapter today `serviceFees: []` at `quote/page.tsx:259`; bundle exposes via `bundle.data.production[].setupFeeTotal/toolingArtworkTotal/rdTotal/otherServiceTotal` | ⚠ F1.5 wiring (see §4 cross-consumer) |
| **Freight lines** | brief §5 F1.5: wire real | `freight_legs.treatment = 'pass_through'` (621) + per-tier amounts on `freight_leg_tiers.total_freight` (686); freight-line labels from `freight_legs.label` (616) + origin/destination (617-618) | adapter today `freightLines: []` at `quote/page.tsx:260`; bundle exposes via `bundle.data.freightLegs[].treatment === 'pass_through'` + sibling tier data | ⚠ F1.5 wiring (see §4 cross-consumer) |
| **recommendedTierIdx (root)** | brief §6 fold-in | `quote_tiers.recommended` (440) | adapter STUBBED (page.tsx:232-233); wire to `tiers.findIndex((t) => t.recommended)` | ⚠ adapter-only; no migration |
| **pdfLayout (root)** | type carries; brief §3 Q-E: snapshot same as detailLevel | **none** on schema today; render-time prop only | adapter hardcodes `"tier_table"` at `quote/page.tsx:262` | ❌ (folded into Catch B) |
| **detailLevel (root)** | brief §3 Q-E: add to type | none (see Catch B) | not yet in adapter | ❌ (Catch B) |

**Summary by status:**
- **✓ wired:** 15 blocks
- **⚠ adapter-only (no migration):** 4 blocks (`tier.full` derivation,
  `recommendedTierIdx` wire-real, F1.5 service fees, F1.5 freight lines)
- **❌ missing:** 3 blocks (`customer.email`, `pdfLayout` snapshot,
  `detailLevel` snapshot) — Catches A + B

---

## §3 · Type drops (per brief §9)

**Brief §9 commitment:** "drop the field from `CustomerViewSku` per
F1.4 / Track-6 — it's present in the bundle, rendered nowhere; remove
the type promise."

**Verification:**

| Question | Answer | Citation |
|---|---|---|
| Where is `CustomerViewSku.retailBenchmark` defined? | `src/types/quote.ts:92` | `retailBenchmark: number \| null;` |
| Where is it projected into `CustomerView`? | `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:224` | `retailBenchmark: skuMeta?.retailBenchmark ?? null,` |
| Where does it come FROM? | `bundle.data.skus[].retailBenchmark` (concept-anchored OLD-model field on `quote_skus.retail_benchmark`; per Slice 11.5.1 the NEW model adapter at `src/lib/costing-adapter.ts:215, 227` projects `retailBenchmark: null` for every NEW-model row) | `quote/page.tsx:198` reads `skuMeta = bundle.data.skus.find(...)`; `costing-adapter.ts:201-227` zero-init pattern in NEW model |
| Is it READ anywhere in the customer-view tree? | **NO** | grep on `view\.retailBenchmark|retailBenchmark` over `src/components/pdf/` + `src/components/quote/` → 0 hits |
| Is it READ anywhere ELSE (non-customer-view)? | YES — Pricing surface (`src/components/pricing/margin-sparkline.tsx:19`), validation engine (`src/lib/validation.ts:332`), sku tree (`src/lib/sku-tree.ts:22`), Costs page (`src/app/projects/.../costs/page.tsx:276`) — all internal surfaces (NOT in pdf/quote customer-view tree) | grep `retailBenchmark` over `src/` |

**Proposed deletion (Slice 11 Step 4):**

```ts
// src/types/quote.ts
export type CustomerViewSku = {
  label: string;
  name: string;
  pack: string | null;
  unitsPerPack: number;
-  retailBenchmark: number | null;
  tierPrices: ReadonlyArray<number | null>;
  shape: "step↓" | "flat" | "partial" | string;
};

// src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx
const skus: CustomerViewSku[] = leafSkus.map((rollup) => {
-  const skuMeta = bundle.data.skus.find((s) => s.id === rollup.skuId);
  const tierPrices = tiers.map((t) => { ... });
  // ... shape derivation unchanged ...
  return {
    label: rollup.skuLabel,
    name: rollup.productName,
    pack: null,
    unitsPerPack: 1,
-   retailBenchmark: skuMeta?.retailBenchmark ?? null,
    tierPrices,
    shape,
  };
});
```

**Migration:** none. `retail_benchmark` columns persist on the OLD
`quote_skus` table (concept-anchored data field, not surface-anchored)
and stay reachable by internal surfaces. Only the customer-view type
field + adapter projection retire.

**Pattern 45 hygiene:** drops a render-tree type field that ships
NULL to nowhere — exactly the "type drop when adapter never read it"
shape Pattern 45 prevention checklist (item #4) recommends.

---

## §4 · Cross-consumer audit (Pattern 70 discipline)

Per Pattern 70 ("when migrating tables, audit ALL consumers"), the
Slice 11 commitments touch:

### 4.1 — `customer.email` projection (Catch A disposition (b) only)

If Edward + CA pick (b): the column add ripples to four sites:

| Consumer | Site | Change |
|---|---|---|
| Schema | `src/db/schema.ts` projects table (216-253) | add `clientEmail: text("client_email")` column |
| Schema | `src/db/schema.ts` `hubspotDealsCache` (856-883) | add `associatedCompanyEmail: text("associated_company_email")` if HubSpot Companies API path lands |
| HubSpot mapper | `src/lib/hubspot-mapper.ts` | extend pull to fetch Company.email (or Contact.email — depends on which entity Edward picks as source) |
| Project actions | `src/app/actions/projects.ts:90, 143, 150, 161` (every `clientName` write site) | add `clientEmail` write alongside |
| Adapter | `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:241-245` | extend customer object: `email: project.clientEmail ?? null` |
| Type | `src/types/quote.ts:43-48` | add `email: string \| null` to `CustomerViewCustomer` |
| PDF JSX (new tree) | new `Parties` component on port | conditional render of email line (null-guard per Q-G) |

If (c) [recommended]: only the type + JSX (Parties) change. Adapter
sets `email: null`; JSX null-guards. Zero schema / HubSpot / actions
touch.

### 4.2 — `detailLevel` + `pdfLayout` snapshot columns (Catch B fork (1))

Ripples enumerated in §1 Catch B table. Cross-consumer worth flagging
explicitly:

- **Realtime publication membership:** `quotes` is already in the
  Supabase Realtime publication (per Slice 11.5.1 §A2 audit closure).
  Adding columns to `quotes` does NOT require publication membership
  changes (table-level subscription captures all columns). ✓
- **Audit log:** `sendQuote` already emits `quote_sent` action with
  `diff_json.snapshots` (`quotes.ts:1463-1469`); extending the snapshot
  sub-object with `pdfLayout` + `detailLevel` keeps the existing
  audit semantics. No new action name needed.
- **Existing sent quotes** (pre-migration) have NULL pdfLayout +
  NULL detailLevel. The adapter must default-render `'tier_table'` +
  `'itemized'` when NULL (matches today's hardcoded behavior so
  re-renders of pre-Slice-11 sent quotes don't shift). Same
  graceful-degradation shape as RI.7 introduced for sent-pre-RI.7
  quotes.

### 4.3 — Wiring real `recommendedTierIdx` (brief §6)

Schema source exists (`quote_tiers.recommended` 440). Cross-consumer:

| Consumer | Existing read | Change for Slice 11 |
|---|---|---|
| Adapter (this page) | hardcoded `Math.floor(tiers.length/2)` (page.tsx:232-233) | `tiers.findIndex((t) => t.recommended)`; null if no flagged |
| Mark-Accepted host | `mark-accepted-host.tsx:66-67` already correct (`tiers.find((t) => t.recommended) ?? tiers[Math.floor(tiers.length/2)]`) | no change |
| Mark-Accepted page RSC | `mark-accepted/page.tsx:171` already correct (`tierRecommendedRows.find((t) => t.recommended)?.id ?? null`) | no change |
| Pricing classifier | `pricing-classifier-context.tsx:339-340, 417` already correct | no change |
| Setup tier row | `tier-row.tsx:117, 126, 139` writes/reads recommended boolean | no change (write path) |

**Observation:** every NON-customer-view consumer already reads the
real `quote_tiers.recommended` column. The customer-view adapter is
the **last stub** for this field. Slice 11 wiring removes it. No new
DB constraint required (action-layer "one per quote" invariant is
still soft per the comment at schema.ts:438; brief §6 doesn't change
that).

### 4.4 — F1.5 service fees + freight lines

Per brief §5: wire from real bundle data. Bundle exposes:

| `CustomerView` field | Bundle source | Adapter projection logic |
|---|---|---|
| `serviceFees[]` | `bundle.data.production[]` rows where `allocate_service_fees_to_cost === false` | for each row carrying non-null `setup_fee_total`/`tooling_artwork_total`/`rd_total`/`other_service_total`/`cm_assembly_total`/`filling_blending_cost`, project one or more `CustomerViewServiceFee` entries. Choice point: ONE row per (assembly, column) emitting separate fees? OR ONE consolidated row per assembly with total? §0.5 catch — see §5 #78. |
| `freightLines[]` | `bundle.data.freightLegs[]` where `treatment === 'pass_through'` + sibling `freightLegTiers[]` per-tier `total_freight` data | per leg, one `CustomerViewFreightLine` with `label` from `leg.label || ${leg.origin} → ${leg.destination}`, `tierAmounts` = `freightLegTiers[].total_freight / tiers[].qty` (per-unit landed cost computed from the leg's per-tier totals) |

**Cross-consumer for F1.5:**

- **No new schema columns** (service-fee-shape fields exist on
  `assembly_production_inputs`; freight-leg-shape fields exist on
  `freight_legs` + `freight_leg_tiers`).
- **No new realtime channels.** Both tables already in publication
  membership for the Quote umbrella (per Slice 11.5.1 + R6.2).
- **`lib/` raw-SQL audit** (per Pattern 70 catch #73 hotfix
  precedent): grep `src/lib/` for raw SQL referencing
  `assembly_production_inputs` or `freight_legs` outside the adapter
  → none surface; safe.

### 4.5 — `retailBenchmark` drop (brief §9)

- **Type drop:** removes one promise from `CustomerViewSku`.
- **Adapter drop:** removes one line from `quote/page.tsx:224`.
- **Bundle source:** `bundle.data.skus[].retailBenchmark` continues to
  flow for the NON-customer surfaces (Pricing sparkline, validation,
  Costs page). The bundle shape doesn't change.
- **DB:** no migration. `quote_skus.retail_benchmark` (OLD model)
  + `costing-adapter.ts` NEW-model `retailBenchmark: null` projection
  unchanged.
- **No cross-consumer realtime / publication impact.**

---

## §5 · §0.5 catches summary

**Cumulative count this Step 1:** **3 new catches** surfaced.

| # | Catch | Class | Disposition status |
|---|---|---|---|
| 76 | `customer.email` source — `projects` has no `client_email` column; HubSpot cache has no `associated_company_email` field; HubSpot mapper has no contact-email pull path. Brief §3 Q-A presumed the field had a source. | B (audit coverage gap — brief didn't verify the field existed in projection chain) | recommends option (c) NULL-safe render; falls back to (b) if Edward + CA prefer column add now |
| 77 | `detail_level` + `pdf_layout` snapshot columns — brief §3 Q-E claims `detailLevel` "snapshots the same way as pdfLayout" but `pdfLayout` is render-time-only on schema today (no column, no snapshot). The cited precedent doesn't exist; the architecture decision is fresh, not a reuse. | C (architecture drift — brief assumes a pattern from `pdfLayout` that `pdfLayout` doesn't actually implement) | recommends fork (1) — both gain snapshot columns + sendQuote writes; Edward override (2) acceptable if v1 audit-friendliness can wait |
| 78 | F1.5 service-fee projection semantics — quote-host.tsx:20 reference comment says "production_inputs.is_one_time → tooling/setup service fees" but NEW-model `assembly_production_inputs` has structured columns (`setup_fee_total`, `tooling_artwork_total`, `rd_total`, `other_service_total`, `cm_assembly_total`, `filling_blending_cost`) with NO `is_one_time` flag. The brief's F1.5 description doesn't enumerate the projection contract: which columns become which `CustomerViewServiceFee[]` rows? One-per-column? Aggregated? Filtered by allocate_service_fees_to_cost=false? | B (audit coverage gap — F1.5 design carries over OLD-model semantics in comment that no longer match NEW-model schema reality) | needs adapter-shape disposition before Step 5 (data wiring); recommend per-column projection with column-name-derived label + filtered by `allocate_service_fees_to_cost === false` per assembly |

**Total cumulative §0.5 catches across all slices: 78 across 15+ slices** (was 75 per MS OAuth #75 milestone analysis 2026-06-25).

**Class distribution of this Step 1 trio:**
- Class A (infrastructure constraint): 0
- Class B (audit-coverage gap): 2 (#76, #78)
- Class C (architecture drift): 1 (#77)
- Class D (disposition-vs-implementation drift, candidate from P0 hotfix
  era): 0

Both Class B catches share the same fail mode: **the brief or
existing comment references a source/precedent that doesn't actually
exist in current code.** Class C catch is the same family at the
architecture layer rather than the field layer.

---

## §6 · Migration scope estimate

**If all dispositions go the recommended way:**

| Migration | Shape | Backfill | Sequencing |
|---|---|---|---|
| 0022 (or next free) — Slice 11 PDF snapshot columns (Catch B fork (1)) | `CREATE TYPE pdf_layout AS ENUM('tier_table', 'single_tier')` + `CREATE TYPE detail_level AS ENUM('itemized', 'turnkey_only')` + `ALTER TABLE quotes ADD COLUMN pdf_layout pdf_layout` + `ALTER TABLE quotes ADD COLUMN detail_level detail_level` | none — adapter handles NULL → `'tier_table'` + `'itemized'` defaults for legacy sent quotes | Step 4 (adapter contract) — lands BEFORE the sendQuote action layer touches the columns; Step 5 (data wiring) overlays the F1.5 work |

**That's the entire migration footprint for Slice 11** under the
recommended dispositions. If Edward + CA flip Catch A → (b), add
~30 lines of ALTER TABLE + HubSpot sync extension. Step 6
(persistence — Supabase Storage + `pdfUrl` writer) is **not a
schema migration** — `quotes.pdfUrl` column already exists at
`schema.ts:282` and was added in an earlier slice.

**No new tables. No FK relationships. No realtime publication
membership changes** (verified per Pattern 70 audit §4).

**Slice 11 is a low-migration slice.** Most of the engineering volume
is type port + react-pdf translation + adapter projection + F1.5
wiring + persistence pipe — all code, not schema.

---

## Standing by

Step 1 awaits Edward + CA disposition on Catches A + B + #78
(F1.5 projection semantics). Step 2 (palette precompute + font
vendoring) follows.
