# CC Comm — Slice 11 · Customer-PDF Implementation Brief

**To:** CC
**From:** CA
**Re:** Implement the customer-facing PDF render — port CD's committed source to react-pdf
**Status:** Approved by Edward (2026-06-29). Kick off per §10 sequencing.
**Sources of truth (in priority order):** CD committed package (`docs/design-prototypes/dist/Nexus Customer PDF Render/`) · the audit (`docs/cc-customer-pdf-audit-slice11-input.md`) · the spike (`docs/cc-customer-pdf-library-spike-slice11.md`) · this brief for dispositions.

---

## §0 · Frame

Slice 11 ships the customer-facing PDF: the paged artifact a PM downloads and sends out-of-band. CD's design is **locked and committed** — this is a **mechanical Pattern-30 port** of that source to react-pdf, plus the data wiring that makes it real (F1.2/F1.3/F1.5), persistence, and the DEC-8 prepared-by path. The spike is **green light, high confidence** (`@react-pdf/renderer@4.5.x`). No design decisions remain open; no new visual grammar. Where this brief and CD's source disagree on structure, **CD's source wins** (Pattern 30).

**This is not a redesign and not a from-scratch build.** The component tree, class register, pagination model, B/W treatment, and totals/turnkey behavior are all in CD's committed `pdf-render.jsx` + `styles.css`. CC translates that tree to react-pdf primitives verbatim.

---

## §1 · Gate 0 — react-pdf smoke (AUTHORIZED — run first, before any implementation)

Edward has authorized the ~1-hour verification. Run it as Step 0 on a throwaway branch `spike/slice-11-react-pdf-smoke` exactly per spike §8:

- `npm i -D @react-pdf/renderer@^4.5.0`
- Vendor `Newsreader-Regular.ttf` + `JetBrainsMono-Regular.ttf` to `public/fonts/`
- Add `src/app/actions/_spike-pdf.ts` (spike §8 step 4 verbatim) + a `_spike/page.tsx` trigger
- Confirm `renderToBuffer` returns a non-empty buffer in `next dev` **AND** on a Vercel preview deploy
- Confirm `fontFeatureSettings: 'tnum'` applies to `$1,234.56`
- Resolve the issue #3074 ("PDFDocument is not a constructor") ambiguity definitively

**Go/no-go:** buffer > 1 KB, no exception, renders on Vercel preview, both fonts + tabular figures correct → **green, throw the branch away, proceed to §2.** Any hard failure (#3074 reproduces, font silent-fail, function-size blowout) → **STOP, file `docs/cc-slice-11-spike-findings.md`, escalate to Edward + CA. Do NOT silently switch to the puppeteer fallback** — that's an Edward + CA decision (spike §7 fallback).

Everything below assumes the smoke goes green.

---

## §2 · Pattern-30 port — the three mechanical conversions

Per spike §7, the port is three mechanical passes against CD's committed source. **Canonical CD files stay pristine** (Pattern 30 / Pattern 39 overrides discipline — never edit the upstream `styles.css`/`pdf-render.jsx`; the react-pdf translation is the consumer layer, mirroring the `r2-pricing.css` precedent).

1. **OKLCH → hex/rgb precompute.** The 11-token palette at `styles.css:101-111` (+ the inline `oklch()` backgrounds on `.pp-notes` and `.pp-tk-included`, and any scattered literals — 28 occurrences total per the audit). Embed as JS consts in `src/lib/pdf-palette.ts`, **maintaining `--pp-*` name parity** for traceability. react-pdf has no OKLCH parser; this is non-negotiable. Precomputed sRGB matches the DOM preview (spike §6 color-sanity).
2. **Font vendoring + registration.** Vendor 7 files (Newsreader R/Italic/Medium/SemiBold + JetBrains Mono R/Medium/SemiBold) to `public/fonts/`; register at module load. Wire `fontFeatureSettings: ['tnum']` on the money styles (Q-J). Both fonts open-licensed.
3. **`.pp-*` → `StyleSheet.create({})`.** Translate every canonical `.pp-*` rule to react-pdf `StyleSheet` objects in TSX. Class-name parity preserved for audit traceability. The component tree (`Masthead` · `Parties` · `PricingTable` · `GrandTotalRow` · `TurnkeySummary` · `PricingFoot` · `ChargesBlock` · `TermsBlock` · `NotesBlock` · `HowToAccept` · `RunHead` · `Footer` · `Sheet`; states `StatePure`/`StatePassThrough`/`StatePartial`) ports verbatim — these are the Pattern-30 implement-as-named contract.

---

## §3 · Adapter contract — A–G dispositions (governing principle + per-item)

**Governing principle (applies to A–G):** the prototype was authored to a fixture shape; production has a typed `CustomerView`. Pattern 30's verbatim target is CD's **structure** (the `.pp-*` tree + component composition), **not** the fixture field names. So all contract mismatches resolve at the **adapter (server projection)**, and JSX is ported to read the production type — fidelity is about render structure, not data shape.

| Q | Item | Disposition |
|---|---|---|
| **A** | `customer.email` missing from `CustomerViewCustomer` | **Option (c) — NULL-safe render** (post-Step-1 amendment 2026-06-29). Step 1 §0.5 catch #76 confirmed no source exists: no `projects.client_email`, no `associated_company_email` in HubSpot cache, no contact-email pull in the mapper. Add `email: string \| null` to the type; adapter sets `email: null` (alongside the existing `contact`/`role`/`address` nulls); JSX's Q-G null-guard handles email uniformly as a fourth nullable subfield. Option (b) (add column + HubSpot company/contact sync) **banked** for whenever a real driver lands (e.g. Slice 12 Mark-Accepted customer notification). Type stays `string \| null`; only the adapter changes when wired. |
| **B** | `tier.full` missing | **Derive at adapter** (`"Tier " + n`). Don't add a derivable string to the type. |
| **C** | `tier.recommended` boolean vs `recommendedTierIdx` | **Adapter normalizes index → per-tier boolean.** JSX keeps reading `tier.recommended` (CD structure verbatim). See §6 — depends on real `recommendedTierIdx`. |
| **D** | `vendor.contact_*` vs `preparedBy` (DEC-8 split) | **Adapter projects `preparedBy.*` → the contact slots; JSX parties structure preserved.** Honors Pattern 30 (structure) + DEC-8 (per-deal prepared-by). Wire the live-vs-snapshot read path: draft → live resolve from `sales_rep_user_id → users`; sent/accepted/superseded/lost → `prepared_by_*_snapshot` from the quote row (per RI.7 §3.10.h + DEC-8). |
| **E** | `detail_level` not on type | **Fork 1 — both persist** (post-Step-1 amendment 2026-06-29). Step 1 §0.5 catch #77 confirmed the cited precedent doesn't exist: `pdfLayout` is render-time-only on schema today (no live column, no snapshot, no enum, no sendQuote write). `pdfLayout` is *retrofitted* into the snapshot fleet alongside `detail_level` so every sent PDF reproduces identically from frozen state. **Migration 0022 lands in Step 4** (adapter contract, before send-action layer touches the columns) — `CREATE TYPE pdf_layout AS ENUM ('tier_table','single_tier')` + `CREATE TYPE detail_level AS ENUM ('itemized','turnkey_only')` + add both nullable columns to `quotes`. No backfill — adapter defaults NULL → `'tier_table'` / `'itemized'` for legacy sent quotes. Wiring: `sendQuote` writes both inside the existing DEC-7 snapshot transaction + audit `diff_json.snapshots` carries both; adapter read path `isSent ? quote.{col} : (searchParams.{param} ?? default)`; `preview-toolbar.tsx` toggle writes live value for drafts, renders read-only for sent+; `CustomerView` type adds `detailLevel: 'itemized' \| 'turnkey_only'`. This is the **only migration in Slice 11**. |
| **F** | `incoterms_bundled` vs `_passthrough` resolution site | **Adapter-side.** Projection resolves `freight_treatment` → the single `incoterms` string the type carries (RI.7 already wired `incoterms_snapshot` + the pass-through render conditional). Renderer receives one resolved string. |
| **G** | `customer.contact`/`role` nullable, rendered unguarded | **JSX null-guards on port.** Keep type honest (these can be absent); guard `{contact} · {role}` so two NULLs don't render `null · null` — render present parts only, drop the separator if one's missing. |

---

## §4 · Portability — H/I/J/L dispositions (spike-confirmed)

| Q | Item | Disposition |
|---|---|---|
| **H** | `gap` inside the sheet (5 declarations; CD's "no gap" note was aspirational) | **Ship verbatim — react-pdf 4.x supports `gap`** (spike §1 portability table). No margin-conversion. Pin `@react-pdf/renderer@^4.5.0`. |
| **I** | `oklch()` colors (28 occurrences) | **Precompute to hex/rgb** per §2.1. Canonical CSS untouched; conversion owned in `pdf-palette.ts`. |
| **J** | `tabular-nums` (9 instances) | **`fontFeatureSettings: ['tnum']` at registration** (§2.2). Spike confirms supported (PR #2740, 4.5.1); smoke verifies API shape. Graceful fallback: JetBrains Mono tabular by default, Newsreader ships `tnum` default — columns stay straight regardless. |
| **L** | State-B itemized: `foldFees` AND `freightAtCost` both true | **Confirmed intended — both notes render side-by-side.** This is the double-count-prevention design: "Includes [fees] folded into total above + itemized below" + "Plus [freight] billed at cost, not in total." Keep the pairing (CD `pdf-render.jsx:425`). |

**Q-K (vendor address separator):** single space, not `·` — `3943 Irvine Blvd, #1129 Irvine, CA 92602`. Adapter emits the plain real string (CA brief §4 locked); the fixture `·` was CD stylization.

**Other mechanical port items (spike):** `★` glyph → `<Svg>`+`<Path>` for cross-reader portability (recommended) or rely on Newsreader glyph coverage (verify in smoke); `wrap={false}` on `.pp-charges` + `.pp-terms` kept-together blocks; `text-transform: uppercase` applied JSX-side (react-pdf doesn't transform); **automatic pagination** — react-pdf reflows via `<Page>` + `wrap`; **CC must NOT hard-code page splits.** The prototype's hard-split `.pp-sheet`s are a review affordance only (audit §5, designer notes §2 caveat).

---

## §5 · Data wiring — the F-findings (this is the real work beyond the port)

The render structure ports mechanically; these make it real:

- **F1.5 — service fees + freight lines.** Currently hardcoded `[]` at `page.tsx:259-260`. Wire real `serviceFees` + `freightLines` from the costing bundle. **This is the load-bearing dependency for the turnkey total** (Addendum §2 folds allocated fees in) — the totals can't be correct until F1.5 lands; ship them as one unit.
  - **Eligibility carve (post-Step-1 amendment 2026-06-29; §0.5 catch #78):** project ONLY the four one-time service fee columns into `CustomerViewServiceFee[]`: `setup_fee_total` · `tooling_artwork_total` · `rd_total` · `other_service_total`. **NEVER project `cm_assembly_total` or `filling_blending_cost`** — these are per-unit COGS already baked into the sell price; projecting them as "service fees" would both double-bill the customer AND expose cost structure (Pattern 45 leak). Hard exclusion.
  - **Filter:** project only where `allocate_service_fees_to_cost === false` for that assembly. When `true`, fees fold into unit price (states A/C → "included in unit price", no charges block) per CD's design.
  - **Label + scope mapping** (humanized labels; project-scope vs SKU/assembly-scope per CD's `sf1`/`sf2` split): CC + CD confirm at Step 5 against the data-source map. Eligibility + filter above are LOCKED now; label/scope is the Step-5 detail.
  - **Freight lines** unchanged: `bundle.data.freightLegs[]` where `treatment === 'pass_through'`, per-unit landed from `freightLegTiers[].total_freight / tiers[].qty`.
- **F1.3 — Pattern 45 violation.** `customer.name = "{customer-pending}"` raw string at `page.tsx:241` — route through `QUOTE_STUBS` + `.pdf-stub`, or wire real `project.clientName`. Small fix; required (it's a customer-facing leak risk).
- **F1.2 — the 6 stub affordances.** Wire to real handlers:
  - `preview-toolbar.tsx:178-185` Download PDF → generate + download the buffer
  - `preview-toolbar.tsx:186-193` Download + mail draft → generate + save + `mailto:` (no SMTP — out-of-band delivery, D3 locked)
  - `pricing-surface/action-zone.tsx:111-120` `preview_pdf` card → wire
  - `pricing/pricing-page-head.tsx:34`, `surface-meta.ts:97` → wire/declare
  - `preview-toolbar.tsx:28-77` Mark sent → already works; leave
- **Derive totals from the bundle, not parallel computation.** Line/grand/turnkey totals derive in the adapter/render from `bundle.data.costing` sell-side values (CLAUDE.md "math-output is load-bearing; project from the bundle, don't parallel-derive"). `lineTotal` / `tierGrand` / `SERVICE_FEES_TOTAL` per CD's helpers — confirm they consume bundle fields, not raw cost tables.

---

## §6 · `recommendedTierIdx` — folded into Slice 11 (CA disposition)

`recommendedTierIdx` is currently **stubbed** (`Math.floor(tiers.length/2)`, `page.tsx:232-233`, flagged Slice 10 work). The entire recommended-tier treatment (bracket · ★ · `single_tier` selection · turnkey hero) and Q-C's adapter normalization depend on a **real** recommended tier. **CA call: wire real `recommendedTierIdx` into Slice 11** — the customer PDF is the first surface where a wrong recommended tier ships to a customer, so the stub can't ride along. Small addition; real downstream consequence. *(Edward override available if he'd rather defer with the stub explicitly accepted for v1.)*

---

## §7 · Persistence — Supabase Storage + internal-only signed URL (CA disposition)

Per spike §5 Option A, adapted to our locked D2 (no customer URLs):

- `sendQuote` calls `renderToBuffer`, uploads to Supabase Storage bucket `quotes-pdfs/<quoteId>/<send-event-id>.pdf` (service-role key), writes the signed URL to `quotes.pdfUrl` (schema column already exists, currently unwired).
- **Signed URL is INTERNAL-ONLY** — PM-accessible for re-download + audit reproducibility; **never handed to the customer** (D2: PMs deliver out-of-band). This is the one deviation from the spike's Option-A framing, which floated a customer-facing link — we do not do that in v1.
- **Why Option A:** Pattern 45 calls the customer PDF "the render path we don't get to apologize for" — persisting exact bytes per send makes a dispute defensible. Resend creates a new file under a new event id; old file remains for forensics. Storage cost trivial (~$0.002/mo at scale).
- Bucket RLS posture: private bucket + signed URLs (no public bucket, since no customer-facing access). This flips the prior D-class **Q5** from "optional" to **wired**.

---

## §8 · Boundary guard (Pattern 45) — non-negotiable

The audit confirmed CD's committed tree carries zero forbidden numeric fields (margin/markup/cost/supplier/duty_pct/tariff_pct/cbm/version/scenario/audit/internal_note); customer-facing prose ("freight & duty included") is permitted and is not a violation. **Preserve this on port:** the react-pdf document tree imports zero costing-surface modules (build-time assertion, R3 commitment #3). Every total is a sum/product of customer-visible sell prices — no cost/margin/BOM math enters the tree. Re-run the boundary grep on the ported tree as a build gate.

---

## §9 · Out of scope (explicit do-NOT)

No email infrastructure (SMTP/Resend/etc.) · no tokenized or public customer URL · no separate customer-facing route · no HubSpot stage push (Slice 12 / Quote umbrella) · no NetSuite SO push (Slice 12) · the 4-sub-tab Quote-umbrella restructure (Slice 12) · `retailBenchmark` renderer (**drop the field from `CustomerViewSku` per F1.4 / Track-6 — it's present in the bundle, rendered nowhere; remove the type promise**) · the spec-addendum page (impl-6 territory, separate toggle).

---

## §10 · Step plan + gates

0. **Smoke gate** (§1) — throwaway branch, ~1hr. Green → proceed; red → escalate. ✓ PASSED 2026-06-29.
1. **Kickoff + Pattern 22 §0.5 schema verification + Pattern 45 boundary plan.** Promote `@react-pdf/renderer@^4.5.0` to runtime dep. ✓ COMPLETE 2026-06-29 (3 §0.5 catches dispositioned: #76 NULL-safe email, #77 fork-1 dual snapshot, #78 service-fee eligibility carve).
2. **Palette precompute + font vendoring/registration** (§2.1–2.2).
3. **`.pp-*` → StyleSheet translation + component tree port** (§2.3), verbatim against CD source.
4. **Adapter contract** (§3 A–G) + type changes (`email`, `detailLevel`; drop `retailBenchmark`) + real `recommendedTierIdx` (§6) + **migration 0022** (per amendment E — `pdf_layout` + `detail_level` PG enums + columns on `quotes`; sendQuote writes both inside DEC-7 snapshot transaction).
5. **Data wiring** (§5 F1.5/F1.3/F1.2) + totals derivation from bundle. F1.5 honors the eligibility carve + filter per §5 amendment; CC + CD confirm label/scope at this step against the data-source map.
6. **Persistence** (§7) — Storage bucket, `pdfUrl` writer, `sendQuote` integration.
7. **Boundary-guard build assertion** (§8) + re-grep + **inverse sweep** (Step-1 boundary plan §2.3 disposition — `SCOPED_LIBRARIES` check forbids `@react-pdf/renderer` imports outside `src/components/pdf/`, `src/app/actions/quotes.ts`, and `src/lib/pdf-*`; ~30 LOC).
8. **CB smoke guide + Pattern 27 manifest wrap.** CB walks the 12-cell matrix (3 states × 2 layouts × 2 detail levels) — Edward-ready handoff (resolved URLs, seed, walk script).

**Merge gate:** CB smoke walk per standing requirement. CD-fidelity check (Designer audit): the ported `.pp-*` structure matches CD's committed source — segmented turnkey cards are cards, recommended bracket brackets, tiers-as-flex-columns hold.

---

## §11 · Approval status

- [x] Brief drafted by CA
- [x] react-pdf smoke authorized (Edward)
- [x] A–L dispositioned (§3/§4); persistence locked (§7); `recommendedTierIdx` folded (§6)
- [x] Edward review + approval (2026-06-29)
- [x] Committed to `docs/cc-comm-slice-11-customer-pdf-brief.md`
- [ ] CC runs Gate 0 smoke → proceeds per §10
