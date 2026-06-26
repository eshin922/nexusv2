# CC Comm — Slice 11 Audit Pre-Brief Inventory

**Driver:** Slice 11.5.1 closed (PRs #76-#88). Slice 11 audit is the next critical-path v1 item. This inventory maps the surface, identifies §0.5 catches, and proposes scope dispositions BEFORE brief drafting.

**Status:** Inventory work; not brief drafting. CC drafts; CA + Edward disposition; CC then drafts brief v1.

**Date:** 2026-06-25

**Companion docs:**
- 75-catch milestone analysis: `docs/cc-comm-slice-11-5-1-catch-shape-milestone-75.md` (PR #90)
- CLAUDE.md §0.5 ledger (now 75 / 15 slices)

---

## TL;DR — what surfaces in this inventory

**Six critical decisions needed before Slice 11 audit brief can land:**

| # | Decision | Why critical |
|---|---|---|
| **D1** | **PDF library selection** | Zero PDF generation code exists. `react-pdf`, `puppeteer`, `pdfkit`, etc. — none installed. Every "Preview PDF" / "Download PDF" button today is an `alert()` stub. Slice 11 must pick the library AND wire it. This is the biggest unknown in the v1 path. |
| **D2** | **Quote URL sharing model** | Middleware (Clerk + `@thedps.co` allowlist) precludes customer access. Today PMs deliver PDFs entirely out-of-band. Slice 11 must confirm "no customer URLs in v1" OR introduce a tokenized share path. |
| **D3** | **Email channel** | No email infrastructure exists (`resend`, `sendgrid`, `nodemailer` — all absent). The current stub copy says `mailto:` draft. Slice 11 must pick `mailto:` (zero infra, PM's mail client) vs SMTP (Resend/SendGrid; gives delivery receipts). |
| **D4** | **Sent-quote freeze scope** | Today only commercial defaults + PreparedBy freeze on send (DEC-7/DEC-8). Cost tables stay mutable in DB; UI guards block edits. Slice 11 audit must dispose: does sent = frozen (snapshot cost tree) OR does only accepted = frozen (Slice 12's `production_recipes`)? |
| **D5** | **PSR architectural gap dispositions** | Confirmed gaps: sell-price override + client-target affordances have no entry surface anywhere on Pricing (PR #79 deleted the cells; PSR moved verdict surface but never moved write affordances). Must dispose: row-expand editors v1 / admin-only v1 / defer to v1.1+. |
| **D6** | **Mark Accepted sub-tab vs peer surface** | CLAUDE.md canon revision says Mark Accepted is a Quote sub-tab, NOT a peer. Today it's still rendered at `/mark-accepted/` as a peer route. Slice 11 audit vs Slice 12 (Quote umbrella) must split this restructuring work. |

**Two new §0.5 catches surfaced during inventory** (ledger 75 → 77):

- **#76:** `leaf_specs` version-pin on quote send is documented as system event but **no code path fires it** in `sendQuote`. Orphan commitment.
- **#77:** `quote_attachments` Pattern 45 boundary-guard scope. `quote_attachments` is PM-internal (RFQ, supplier docs) but lives next to customer-facing PDF data; build-time invariant doesn't enforce non-import from `pdf/` subtree. Banked for verification.

**Two confirmed false-positives from CA's banked items:**

- Mark Accepted CTA redundancy on Pricing surface: **does not exist.** `customer-accept-toggle.tsx` is orphan-on-disk; no caller. Banking was based on misattribution.
- Freight drilldown RSC-prop-vs-store fix (Follow-up #2b): **already done.** Freight is the reference architecture; packaging + production are the laggards. Zero work needed.

**Recommended scope split:**

- **Slice 11 audit (in-scope):** PDF library selection + wiring · sent-quote freeze disposition · D2/D3 dispositions · Pattern 45 customer-view audit · sell-price + client-target affordance restoration (D5) · Track 7 anchor-leaf foot-gun fix · Tracks 8a/8b follow-up bundle.
- **Slice 12 (Quote umbrella; separate brief):** Mark Accepted sub-tab IA restructure + `markAccepted` action + `production_recipes` table + HubSpot stage push + NetSuite SO push.
- **v1.1+ (banked):** `retail_benchmark` render restoration (no consumer in PDF subtree today) · tier-chip discoverability promotion · per-assembly production math-layer extension.

---

## §0.5 catches surfaced during inventory

Two new catches landed during this inventory work; the ledger advances 75 → 77 once banked.

### #76 — `leaf_specs` version-pin on quote send

**Class:** Process discipline / orphan commitment.

**Discovery:** Track 3 (Snapshot system) — schema comment at `src/db/schema.ts:1525` references `leaf_specs` historical pinned versions queryable by `version_number`. The `leaf_spec_version_pin` audit action in CLAUDE.md namespace says "system event on quote send." Grep across `sendQuote` (`actions/quotes.ts:1293-1485`) returns **zero invocations** of any version-pin write.

**Disposition:** Bank to Slice 11 audit scope. Slice 11 audit must verify the pin actually fires somewhere, OR amend the documented commitment.

### #77 — `quote_attachments` Pattern 45 boundary-guard scope

**Class:** Code architecture / hydration discipline.

**Discovery:** Track 3 (Snapshot system) — `quote_attachments` table at `schema.ts:1649-1673` is PM-internal (RFQ, supplier docs, customer phone notes). It lives in the same schema namespace as customer-facing PDF data; **the customer-view boundary guard does not explicitly forbid importing it from `pdf/` subtree**. Per CLAUDE.md "Customer-view boundary guard — build-time invariant" section, the guard is enforced at build time but the precise list of forbidden imports may not include `quote_attachments`.

**Disposition:** Bank to Slice 11 audit scope. Verify the build-time boundary-guard rule includes `quote_attachments` in its forbid-list; if not, add it.

### Note on what's NOT a new catch

The PSR architectural artifacts in Track 5 (missing sell-price override + client-target affordances) are **gaps surfaced during PR #54 follow-up**, not §0.5 catches in the brief-verification sense. They're banked separately as Pricing-surface affordance gaps for Slice 11 audit disposition.

---

## §0.5.5 — Platform constraint enumeration (FIRST application per milestone bias correction)

Per the 75-catch milestone analysis (PR #90), `§0.5.5 — Platform constraint enumeration` is the proposed bias correction. Slice 11 audit is the first slice to apply it.

| Platform | Surface | KNOWN constraints (from CLAUDE.md + experience) | UNKNOWN to investigate pre-build |
|---|---|---|---|
| **PDF generation library** (TBD — `react-pdf` vs `puppeteer` vs `pdfkit` vs server-side Chromium) | Will render `src/components/pdf/` subtree to PDF artifact | None banked (library not yet selected) | (a) Memory ceiling per render on Vercel function (1024MB default, 3008MB max). Will a 5-page B2B quote PDF render under that ceiling? (b) Cold-start time impact (puppeteer/chromium = heavy; react-pdf = lighter). (c) Font embedding support — vendor brand fonts? (d) Tailwind / CSS support — full or subset? |
| **Vercel function memory + duration** | PDF render + email send on the send action | Hobby/Pro tier defaults; serverless cold-start latency | (a) Function timeout for PDF render (10s/60s/300s by plan). (b) Memory headroom for chromium if selected. |
| **Email channel** (TBD — `mailto:` vs SMTP via Resend/SendGrid) | sendQuote action; may also fire from Quote umbrella's Send-to-Client sub-tab Advance | `HUBSPOT_WRITE_ACCESS_TOKEN` reserved for Slice 12+ | (a) If SMTP: provider rate limits (Resend free: 100/day, Pro: $20/mo for higher). (b) Bounce handling. (c) DKIM/SPF setup for `thedps.co` domain. (d) If `mailto:`: max URL length per email client (~2KB ~32KB depending on client). |
| **Supabase Storage** | PDF artifact persistence (D4 territory — if pdfUrl wired) | Free tier 1GB storage / 2GB egress; Pro 100GB | (a) Storage CDN egress costs at scale. (b) Per-file size limits (50MB default). (c) Bucket privacy + signed URL TTL for customer access if D2 introduces tokenized share. |
| **HubSpot API** | Deal stage push (Slice 12 territory; in scope for Quote umbrella, not Slice 11) | Read-only token has stage IDs scoped; write token reserved | Slice 12 scope; not Slice 11. |
| **Clerk auth + middleware allowlist** | Today blocks customer access entirely | `@thedps.co` allowlist + `ALLOWED_EMAILS` env var | (a) If D2 introduces tokenized share, what's the bypass mechanism? Public route? Token verification middleware? (b) Token storage + expiry. |

**Pre-build investigation required for:** D1 library selection (1-4), D3 channel decision (email), D4 storage decision (Storage).

The §0.5.5 enumeration surfaces that Slice 11 audit hits **at least 5 external platforms with un-investigated constraints**. Brief should include a §0.5.5 spike before §0 migration begins.

---

## Track 1 — Customer-view PDF render

### Current state

**No PDF generation library exists in the codebase.** `package.json` deps: zero PDF libs. `@playwright/test` exists transitively as a dev tool but isn't used for PDF generation. IA-spec.md:463 + UX_BACKLOG.md:4147 explicitly defer the library selection.

**Every "Preview PDF" / "Download PDF" button is a stub:**

| Affordance | File:line | Behavior |
|---|---|---|
| Quote surface — Download PDF | `src/components/quote/preview-toolbar.tsx:178-185` | `alert("Stub — Slice 11 wires PDF render + download.")` |
| Quote surface — Download + mail draft | `src/components/quote/preview-toolbar.tsx:186-193` | `alert("Stub — Slice 11 wires PDF + mailto draft.")` |
| Quote surface — Mark sent (dev-only) | `src/components/quote/preview-toolbar.tsx:28-77` | **Actually works.** Calls `sendQuote()`. NODE_ENV !== production AND admin only. No PDF. |
| Pricing surface — `preview_pdf` action card | `src/components/pricing-surface/action-zone.tsx:111-120` | onClick = no-op placeholder; comment: "Slice 11 (Preview Quote sub-tab) wires preview_pdf" |
| Pricing page-head banner href | `src/components/pricing/pricing-page-head.tsx:34` | Routes to customer_view route (renders on-screen, no PDF artifact) |
| Surface-meta nav declaration | `src/lib/nav/surface-meta.ts:97` | Declares `["↓ Download PDF", "Edit notes"]` — declarative; no handler |

**Customer-view render path** (no actual PDF artifact today):

- Entry: `src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx:32` (RSC)
- Composes `CustomerView` shape → passed to `QuoteHost` client component (`src/components/quote/quote-host.tsx:101`)
- Renders `<PreviewToolbar>` + `<BoundaryGuardNotice>` + 1-2 `<PdfPage>` containers
- `<PdfPage>` is just `<div className="pdf-page">` — DOM only; no PDF emission

### Fields consumed by customer-view

All sourced via `getCostingBundle` + RSC fetches; assembled into `CustomerView` shape at `page.tsx:184-263`:

- Vendor identity (firm_settings vendor_*; fallback `VENDOR_FIXTURE`)
- Quote: quote_number, sent_at, valid_until, commercial snapshots (TCS/payment/lead-time/incoterms)
- Customer: project.clientName (synthetic fallback `"{customer-pending}"` — Pattern 45 violation, see below)
- preparedBy: users join + HubSpot owner fallback
- Tiers: `bundle.data.costing.tiers`
- SKUs: leaf skuRollups + skus join (label, name, tier prices, shape, retailBenchmark, pack, unitsPerPack)
- serviceFees + freightLines: **hardcoded `[]` at page.tsx:259-260** (Slice 11 work)
- recommendedTierIdx: **stubbed `Math.floor(tiers.length/2)` at page.tsx:232-233** (Slice 10 work)

### Stubs visible via `<Stub>` register

Pattern 45 dashed-underline mono caption visible to PMs:

| Stub | File:line |
|---|---|
| `{quote-number-pending}` | `pdf-footer.tsx:25` |
| `{payment-terms-pending}` | `pdf-terms.tsx:125` |
| `{lead-time-pending}` | `pdf-terms.tsx:132` |
| `{incoterms-pending}` | `pdf-terms.tsx:141` |
| `{tcs-pending — configure on /admin/firm-settings}` | `pdf-terms.tsx:160` |
| `{prepared-by-pending — deal owner unresolved}` | `pdf-header.tsx:85` |

**One Pattern 45 violation:** `customer.name = "{customer-pending}"` at `page.tsx:241` is a raw string, NOT routed through `QUOTE_STUBS`, NOT styled with `.pdf-stub`. Small drift; small fix.

### `retail_benchmark` — type promised, renderer absent

`CustomerViewSku.retailBenchmark` is typed (`types/quote.ts:91-92`: "Optional MSRP context. NULL hides retail column for this row.") and `page.tsx:224` populates it via `skuMeta?.retailBenchmark ?? null`.

**But:** `PdfPricingTable` does NOT read `retailBenchmark`. Grep across `src/components/pdf/**` returns zero matches. The field is plumbed into the type and through the data pipeline but no descendant component renders it.

**Schema source:** NOT in `src/db/schema.ts` (zero hits). Post Slice 11.5.1 OLD-table drop, the adapter at `src/lib/costing-adapter.ts:201-204` ALWAYS sets it to `null` (explicit comment: "deferred to v1.1+ unless Slice 11 PDF audit pulls it forward").

**Customer-view degrades on NULL:** silently — no consumer renders it.

### Findings

- **F1.1** No PDF library → Slice 11 must select + install + wire one. Highest-uncertainty deliverable.
- **F1.2** Every PDF affordance today is a stub `alert()` or no-op. Audit catalog: 6 affordances need real handlers.
- **F1.3** `customer.name` synthetic fallback violates Pattern 45 routing. Small fix.
- **F1.4** `retailBenchmark` type-vs-renderer drift — documentation drift. Either drop the field from the type to reflect actual scope OR note PdfPricingTable needs the column. Today the type promises something the renderer doesn't deliver.
- **F1.5** Service fees + freight lines hardcoded to `[]`. Slice 11 work surface.

### Disposition recommendations

- **Slice 11 audit absorbs:** F1.1 (library + install + wire), F1.2 (wire 6 affordances to real handlers), F1.3 (Pattern 45 routing fix), F1.5 (service fees + freight lines).
- **Banked:** F1.4 — either v1.1+ promote retailBenchmark renderer OR drop type field. Track 6 disposition.

### Scope estimate

- PDF library spike + wiring: 4-6 days (largest single unknown)
- Affordance wire-up: 2-3 days
- Pattern 45 + service fees + freight lines: 1-2 days

---

## Track 2 — Send-to-client action flow

### Current state

**`sendQuote` at `src/app/actions/quotes.ts:1293`:**

- Pre-flight: `ensureUser` + `loadQuoteOrThrow` + `assertDraft` + `≥1 tier with qty` + `≥1 assembly` + `firm_settings.quoteNumberPrefix`
- PreparedBy resolution (DEC-8): `salesRepUserId → users` first, else HubSpot owner fallback
- DB writes (single transaction):
  - `nextval('quote_number_seq')` → `${prefix}-${next}`
  - `UPDATE quotes SET status='sent', sentAt, quoteNumber, validUntil, *_snapshot (TCS/payment/lead-time/incoterms/days-valid), preparedBy_*_snapshot, updatedAt`
- **External side effects: none.** One HubSpot read call (PreparedBy fallback) — read-only.
- Audit: single row `quote_sent` with snapshots + preparedBy details
- Status: `draft → sent`
- Idempotency: not idempotent; `assertDraft` guards re-invocation

### Email infrastructure: zero

No `resend`, `sendgrid`, `nodemailer`, `postmark`, `aws-ses`, `mailgun`. No `react-email`, `mjml`. Two stub buttons reference "mailto draft" as intended channel.

### HubSpot deal-stage push: zero

`HUBSPOT_WRITE_ACCESS_TOKEN` defined at `src/lib/hubspot.ts:75` + dedicated `getWriteClient()` at `:100`. The write client is `// eslint-disable-next-line ... -- used by Slice 12+` — **defined but never invoked anywhere in production code today.**

Per `docs/quote-umbrella-brief.md:78`: HubSpot stage push fires at **Mark Accepted Advance** (not Send), NetSuite SO push at Tier Selection Advance. Both writebacks are explicit "Scope IN" for the combined umbrella+NetSuite slice.

### "Send to Client" UI affordance: doesn't exist as sub-tab

The Quote umbrella's 4-sub-tab structure (Preview Quote · Send to Client · Mark Accepted · Tier Selection) per CLAUDE.md is aspirational — no sub-tab routing, no sub-tab components. Today: single Quote page, no tabs.

Mark Accepted is still a peer surface at `src/app/projects/[id]/quotes/[quoteId]/mark-accepted/page.tsx` (per CLAUDE.md canon revision: "now a Quote sub-tab, not a peer surface" — restructuring not yet done).

### Quote URL sharing: PM-internal only

- Customer-view URL: `/projects/[id]/quotes/[quoteId]/quote` — same route PMs use
- Auth: Clerk + `@thedps.co` allowlist + `ALLOWED_EMAILS` env var (`src/middleware.ts:8-49`)
- **No public token, no anonymous access, no separate customer-facing route**
- Stub copy: "Download PDF" → save to PM's Downloads; "Download + open mail draft" → opens `mailto:` with PDF attached
- `quotes.pdfUrl text` (schema.ts:282) exists but unwired

### v1 contract gap

What "send" means today: status flip + quote_number assign + commercial defaults snapshot + audit row. **No PDF. No email. No HubSpot push. No customer URL.** PMs handle delivery entirely out-of-band.

What v1 needs (per CLAUDE.md Quote umbrella + brief): 4-sub-tab UI · state enum extension (`preview_ready`, `complete`) · PDF render path · email channel · HubSpot stage push at Mark Accepted Advance · NetSuite SO push at Tier Selection Advance · schema cols (`selected_tier_id`, `netsuite_so_id`, `netsuite_pushed_at`).

### Findings

- **F2.1** sendQuote works for status flip + snapshots; nothing else.
- **F2.2** No email infrastructure of any kind. D3 decision required.
- **F2.3** No HubSpot write actions wired; write-client defined but unused. Belongs to Slice 12 / Quote umbrella, not Slice 11.
- **F2.4** No customer-facing URL. D2 decision required ("no customer URLs in v1" vs introduce tokenized share).
- **F2.5** Send-to-Client sub-tab doesn't exist. Belongs to Quote umbrella restructure, not Slice 11 audit.

### Disposition recommendations

- **Slice 11 audit absorbs:** F2.2 (D3 email channel decision + wire), F2.4 (D2 sharing model decision)
- **Slice 12 / Quote umbrella owns:** F2.3 (HubSpot stage push), F2.5 (sub-tab restructure + Advance mechanism)
- **No change to sendQuote core logic** — it's working as designed; Slice 11 adds rendering + delivery on top, not behind it.

### Scope estimate

Depends on D2/D3 dispositions:
- `mailto:` + no customer URL: ~1 day (PDF artifact → blob → download → mailto link)
- `mailto:` + tokenized share: ~3-4 days (token middleware + signed URL + customer route)
- SMTP + no customer URL: ~2-3 days (Resend/SendGrid setup + send action + retry)
- SMTP + tokenized share: ~5-6 days

---

## Track 3 — Snapshot system

### Three-tier framing reality check

**Current architecture is two-tier, not three-tier:**

- **Draft quote:** fully mutable across `quotes` + cost tables. Confirmed.
- **Sent quote:** **partially frozen.** Only commercial defaults + PreparedBy + quote_number + valid_until freeze on send. Cost-table contents (packaging, production, freight, margins) remain mutable in DB; UI guards block edits via `status='sent'` checks. Re-rendering customer view reads live cost tables.
- **Accepted quote:** **not implemented.** `quotes.status='accepted'` enum exists; `accepted_at`, `accepted_tier_id`, etc. columns exist; **no `markAccepted` action writes them.** Mark-Accepted page is visual shell only (Slice 12 v4 brief is the implementation contract).

**Reframe recommendation:** two snapshot tiers — draft (live) + accepted (`production_recipes`). Sent is a status transition with commercial-defaults frozen, not a full snapshot tier.

### Schema inventory

| Table / Column | Status | Notes |
|---|---|---|
| `quotes` | Live | Carries send-time snapshot cols, orphan `accepted_snapshot_json jsonb`, versioning, lifecycle timestamps, unwritten `pdf_url` |
| `quote_attachments` | Live | PM-internal docs (RFQ, supplier quotes); Supabase Storage bucket `quote-attachments`. Pattern 45: must not import from `pdf/` subtree |
| `leaf_specs` | Live (versioned via `is_current` + `effective_from`/`effective_to`) | Versioning pattern exists; pin documented at quote send but **no current writer** (§0.5 catch #76) |
| `firm_settings` | Live (versioned) | Sent-quote DEC-7 snapshots COPY values into `quotes.*_snapshot` cols |
| `production_recipes` | **Does not exist** | Banked in Slice 12 v4 brief; canonical immutable record at acceptance |

### Versioning columns on `quotes`

- `version_number int NOT NULL` — **per-scenario sequence**, NOT version-history. Unique `(project_id, scenario_label, version_number)`. NO `effective_from`/`effective_until`. §0.5 finding doc (`docs/cc-slice-mark-accepted-section-0-5-findings.md:150-168`): "`quotes` is NOT versioned; no `versionedQuotesUpdate` helper exists or could exist."
- `scenario_label` — text PM picks ("Primary" / "Alt 1")
- `scenario_status enum` (`active` / `dropped` / `accepted`)
- `sent_at` — written by `sendQuote`
- `accepted_at` — declared but **no production writer**
- `copied_from_quote_id` — lineage only

### PDF artifact persistence

- `quotes.pdf_url text` declared at `schema.ts:282`, **zero writers in `src/`**
- PDF render today = server-rendered React tree in `src/components/pdf/` (DOM, no artifact)
- `quote_attachments` real Supabase Storage exists but is for **PM-internal docs**, NOT customer-facing PDF
- Sent quote artifact today = regenerated on demand from frozen `*_snapshot` cols + live cost reads

### Slice 11 vs Slice 12 boundary

**Slice 11 audit OWNS:**
- PDF customer-facing data bindings audit (Pattern 45 customer-facing render sweep)
- Sent-quote rendering verification (does it render correctly from frozen snapshots + live cost reads?)
- Orphan `accepted_snapshot_json` column flagging (Slice 12 drops it)
- Orphan `pdf_url` column status (decision: Slice 11 wires it OR confirm v1.1+ deferral)
- `leaf_specs` version pin verification (§0.5 catch #76)

**Slice 12 / Quote umbrella OWNS:**
- `production_recipes` table CREATE
- `markAccepted` action implementation
- Freeze enforcement via `status='accepted'` guards
- HubSpot stage push + NetSuite SO push
- Sub-tab IA restructure + Advance mechanism
- Drop orphan `accepted_snapshot_json` column

**Shared (already shipped Slice RI.7):** sent-time commercial snapshots (DEC-7/DEC-8). Slice 12 builds on but doesn't extend.

### Findings

- **F3.1** Architecture is two-tier; brief inventory's three-tier framing was conceptual not actual.
- **F3.2** `production_recipes` table doesn't exist; banked for Slice 12.
- **F3.3** `pdf_url` orphan — Slice 11 decision: wire it OR confirm v1.1+ deferral.
- **F3.4** §0.5 catch #76 — `leaf_specs` version pin documented but not implemented.
- **F3.5** §0.5 catch #77 — `quote_attachments` Pattern 45 boundary-guard verification.
- **F3.6** Sent-quote cost-tree freeze: today UI-guards-only, no DB snapshot. Decision D4: keep this posture (sent ≠ frozen; only accepted = frozen via Slice 12), OR promote send to full snapshot in Slice 11.

### Disposition recommendations

- **Slice 11 audit absorbs:** F3.3, F3.4, F3.5, F3.6 (D4 disposition)
- **Slice 12 owns:** F3.1 reframe banking, F3.2 production_recipes
- **CC recommendation on D4:** keep current posture — sent = UI-guards-only, only accepted = frozen. Avoids duplicating snapshot infrastructure across two slices. Pattern 32 pre-prod tolerance covers any drift between sent and DB until acceptance freezes.

### Scope estimate

- D4 disposition documentation + Pattern 45 audit + boundary-guard fix: 1-2 days
- §0.5 catch #76 verification + fix (if needed): 0.5 day

---

## Track 4 — Sibling drops + drop_reason audit

### `scenario_dropped` audit action

**Defined:** `audit_log.action` text value; enum `scenario_drop_reason` at `src/db/schema.ts:138-144` with 5 values: `superseded_by_copy`, `draft_at_accept`, `accept_sibling`, `manual`, `other`. Column `quotes.dropReason` at `schema.ts:330` + `droppedByUserId` + `droppedAt`.

**Fired by 2 paths** (both family-level updates within a transaction):

1. `createScenario` (`actions/quotes.ts:383-417`) — canonical modal "Drop current scenario" choice → `drop_reason: "manual"` + `audit_source: "canonical_modal"`
2. `copyScenarioWithinProject` (`actions/quotes.ts:1928-1968`) — when caller passes `dropCurrentScenarioId` → `drop_reason: "superseded_by_copy"` + `audit_source: "fr12_copy_supersede"`

Both flip every `(project_id, scenario_label, scenarioStatus='active')` row to `scenarioStatus='dropped'` (family-level write per Bug CSF-3-A) and emit ONE audit row at `entityType='project'` with `dropped_quote_ids[]`.

**Enum values NEVER written: `accept_sibling`, `draft_at_accept`.** Rendered in UI labels at `project/page.tsx:641-642` but unwritten.

### Mark-Accepted "Auto-drop N scenarios"

**Component:** `src/components/mark-accepted/accept-confirm-modal.tsx:154`. Surface copy "Auto-drop {activeSiblings.length} other active scenarios: {labels…}".

**Wiring: stub.** Confirm button (`:186-198`) calls `setStep("locking")` then `setTimeout(close, 1500)`. No server action. Header comment line 17-20 explicit: "Slice RI.6 — visual shell of AcceptConfirmModal. The Confirm button is wired to a console.log stub; real Mark-Accepted action contract (status flip, snapshot write, sibling drop, HubSpot writeback) lands in Slice 12."

### Slice 11 vs Slice 12 ownership

- **Send-driven drops (Slice 11):** sendQuote does NOT touch siblings today. Sending a quote does not drop other scenarios. Decision: does Slice 11 add a "warn if N other active scenarios exist" affordance, or leave send sibling-agnostic?
- **Accept-driven drops (Slice 12):** No `markAccepted` action exists; `accept_sibling` + `draft_at_accept` enum values are scoped here but unused. Slice 12 wires them.
- **Shared infrastructure:** the family-level "look up scenario_label → flip all active rows → audit" pattern is duplicated in `createScenario` + `copyScenarioWithinProject`. Candidate for extraction into `dropScenarioFamily(tx, projectId, scenarioLabel, reason, source, triggerId)` helper before Slice 12 lands its third caller.

### Findings

- **F4.1** `accept_sibling` + `draft_at_accept` enum values are orphan today; will be written by Slice 12 Mark-Accepted action.
- **F4.2** Mark-Accepted modal "Auto-drop" affordance is stub; Slice 12 wires it.
- **F4.3** Shared `dropScenarioFamily` helper candidate — extract before Slice 12 adds third caller.
- **F4.4** Slice 11 send-time sibling logic: today none. Decision: warn-only affordance, or leave send sibling-agnostic.

### Disposition recommendations

- **Slice 11 audit absorbs:** F4.3 (extract helper as part of audit; mechanical), F4.4 (D4 sub-question: warn vs sibling-agnostic — recommend sibling-agnostic per current behavior)
- **Slice 12 owns:** F4.1, F4.2
- **No new schema work in Slice 11** — enum + columns already exist.

### Scope estimate

Helper extraction: 0.5 day. Decision documentation: 0.25 day.

---

## Track 5 — PR #54 PSR architectural artifact reconciliation

### Top-band action source

**Component:** `src/components/pricing/pricing-page-head.tsx:48-178`. Mounts `<YourNextMoveBanner>` (`:165`).

**Classifier:** `PricingClassifierProvider` at page level (`pricing/page.tsx:181-187`); shared with `PricingSurfaceShell` (single source of truth per CB Patch round 2).

**Drives banner CTAs (per `:107-133`):**
- `sendable` mode → "Preview quote PDF →" linking to customer_view route
- `suggestion_led` mode → recommended action's label
- `blocked` mode → recommended action's label
- `terminal` (status=accepted) → silent

### Banked item #1 — Preview Quote PDF redundancy

- **Top-band path:** `pricing-page-head.tsx:111-120` — banner = sole functional path
- **Page-level path:** `action-zone.tsx:111-112` `CTA_COPY.preview_pdf = "Preview PDF →"` — ActionCard with documented no-op onClick
- **Both render simultaneously in sendable mode: YES**
- **Disposition:** Suppress the page-level ActionCard for `preview_pdf` until Slice 11 wires a real handler; banner already carries it. Alternative: convert ActionCard to a `<Link>` mirroring the banner href. CC recommendation: suppress until real handler lands.

### Banked item #2 — Mark Accepted CTA redundancy

**FALSE POSITIVE.** No page-level Mark Accepted CTA exists on Pricing.

- `customer-accept-toggle.tsx` is **orphan-on-disk** — defined but zero callers anywhere
- "Mark accepted ·" appears only at `mark-accepted-good.tsx:106` (which is the Mark-Accepted SURFACE, not Pricing)
- Pricing page-head explicitly removed it (`pricing-page-head.tsx:9-13`)

**Disposition:** No redundancy to resolve. Delete orphan `customer-accept-toggle.tsx` in cleanup. CA's banking was based on misattribution.

### Banked item #3 — Sell-price override action-zone affordance

**Does it exist? NO.** Action zone defines 8 `ActionKind`s; none opens a per-cell sell-price override editor.

- `updateSellPriceOverride` server action still exists; no UI surface invokes it from Pricing
- Detail zone renders `cell.override_applied` as read-only chip
- `RequiredSellCell` confirmed orphan-deleted (PR #79)

**Disposition:** **Confirmed PSR architectural gap.** PSR moved verdict surface but did not move the write affordance. PMs in `blocked` mode get `request_override` action (no-op stub); in `suggestion_led` mode they get apply paths; no per-cell override at any mode.

**CC recommendation:** Slice 11 audit absorbs. Decision: (a) row-expand editor inside `SkuBreakdown` (Pattern 4 functional-dependency restore) OR (b) explicit admin-only v1 deferral. Recommend (a) — functional-dependency check before dropping affordance is a CLAUDE.md banked rule.

### Banked item #4 — Client target action-zone affordance

**Does it exist? NO. Symmetrical to #3.**

- No `set_client_target` / `edit_client_target` ActionKind
- `updateClientTarget` action still exists; no Pricing UI calls it
- `ClientTargetCell` confirmed deleted in PR #79
- `tighten_to_target` action card surfaces the state but onClick is no-op (`pricing-surface-shell.tsx:157-164` documents tighten_to_target as banked v1.1+)

**Disposition:** Same as #3 — confirmed gap; recommend row-expand editor restoration.

### Banked item #5 — Tier chip discoverability

- Two tier surfaces, both inside collapsed DETAIL zone:
  - **DetailTierTable** (`detail-zone.tsx:234-296`) — full per-tier compliance table (collapsed by default, session-persisted)
  - **DetailPerSku → psr-tier-strip** (`:513-539`) — mini per-SKU per-tier bar viz
- **No "tier card with blue left-border" on action-zone or main surface** — visible only inside collapsed DETAIL
- From SENDABLE state, `SendableSummary` surfaces only the recommended tier as a single cell — no per-tier interactivity

**Disposition:** Discoverability gap. CC recommendation: defer to v1.1+ unless PMs flag during Slice 11 audit smoke; acceptable v1 posture per CB walks ("column cards ARE the chips" — visual affordance subtle but present in DETAIL).

### Broader PSR sweep — other redundancies

- `apply_surgical` / `apply_global` — clean (ActionCard list filters recommended out in suggestion_led mode)
- `suggestion_infeasible` — clean (banner shows label; SuggestionCard shows infeasible card; no ActionCard)
- `AcceptRiskBanner` — not redundant

**No remaining overlapping CTAs beyond #1.**

### Orphan-on-disk audit (PSR-related)

Files that should be deleted in Slice 11 audit cleanup pass:
- `customer-accept-toggle.tsx`
- `lines-requiring-review.tsx`
- `per-tier-override-card.tsx`
- `verdict-band.tsx`
- `pricing-section-head.tsx`
- `margin-sparkline.tsx`
- `competitive-indicator.tsx`
- `two-axis-verdict.tsx`

Per Catch #4 v1.1 re-mount option: preserve OR delete. Recommend delete in Slice 11 audit (clean repo state for v1).

### Findings

- **F5.1** Preview Quote PDF redundancy confirmed — suppress page-level ActionCard.
- **F5.2** Mark Accepted CTA redundancy: FALSE POSITIVE. No work.
- **F5.3** Sell-price override action-zone affordance: confirmed PSR architectural gap (D5).
- **F5.4** Client target action-zone affordance: confirmed PSR architectural gap (D5; symmetrical to F5.3).
- **F5.5** Tier chip discoverability: subtle but present; v1.1+ defer recommended unless PM flags.
- **F5.6** ~8 orphan-on-disk files for cleanup.

### Disposition recommendations

- **Slice 11 audit absorbs:** F5.1 (suppress + plan ActionCard wire-up), F5.3 + F5.4 (restore via row-expand or admin-only — D5), F5.6 (orphan-on-disk cleanup)
- **v1.1+ banked:** F5.5

### Scope estimate

- F5.1 suppress: 0.25 day
- F5.3 + F5.4 row-expand restoration: 2-3 days (per dimension; bundled = 4-5 days)
- F5.6 orphan cleanup: 0.5 day

---

## Track 6 — `retail_benchmark` deferral re-evaluation

### Current state (from Track 1 detail)

- Customer-view consumes the FIELD via `CustomerViewSku.retailBenchmark` type
- PdfPricingTable does NOT read it — zero matches in `src/components/pdf/**`
- Adapter at `src/lib/costing-adapter.ts:201-204` ALWAYS sets it to `null` post Slice 11.5.1 OLD-table drop
- Schema column NOT in `src/db/schema.ts` (zero hits in NEW model)
- Customer-view degrades on NULL silently — no consumer renders it

### Decision

The deferral to v1.1+ is **safe**. The field is in the type and data pipeline but no PDF block consumes it. Promoting it back to v1 would require:
1. Adding the schema column to `assemblies` (or wherever)
2. Adding a new PDF block / column
3. Wiring adapter to actually populate

None of this is in Slice 11 audit's likely scope unless PM demand surfaces.

### Findings

- **F6.1** v1.1+ deferral is structurally safe; no code crashes.
- **F6.2** Documentation drift: type promises a field the renderer doesn't deliver. Either drop the field from the type OR document the deferral inline.

### Disposition recommendations

- **Slice 11 audit absorbs:** F6.2 (drop from type OR add docstring referencing v1.1+ deferral; small)
- **v1.1+ banked:** F6.1 (if PM demand surfaces, promote)

### Scope estimate

0.25 day for documentation cleanup.

---

## Track 7 — Anchor-leaf production rendering UI clarity

### Current rendered shape

- Per-leaf production cost cell: `src/components/costs/production-drilldown.tsx:506-624` (`ProductionTierCell`)
- Anchor-leaf detection (math layer): `src/lib/costing-adapter.ts:260-301`
- Page → drilldown handoff: `src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx:400-447`
- Anchor leaf cell: input shows the value (e.g., `1.50`)
- Sibling leaves cell: input renders empty with `placeholder="—"` and `cell-num.empty` class

### Critical UX hazard discovered

**The empty cell is a live `<input disabled={!editable}>`** — a PM can type into a sibling cell. `handleChange` calls `updateProductionCell(sku.id, ...)` then `fireSave()`, which POSTs `FormData` with `quoteSkuId=sku.id` (the SIBLING leaf id).

`upsertAssemblyProductionInputs` resolves the assembly via that quoteSkuId. End state depends on action-layer behavior — but **at minimum the UX implies "type here and it saves," and the value the PM typed will not appear back where they typed it after reconcile**. Either:
- Silent wasted round-trip (best case)
- Silent data leak / write to wrong row (worst case)

**Either way it's a foot-gun, not just confusing emptiness.**

### Treatment options

- **(a) Tooltip + sibling-cell inert hardening (RECOMMENDED).** ~10 LOC. Extend the existing `title=` ternary on `ProductionTierCell` to read `isAnchor`. Sibling: tooltip explains "Production cost shown on {anchor.skuLabel}; represents total for this assembly." PLUS `disabled={!editable || !isAnchor}` on input for non-anchor leaves. Eliminates the foot-gun + explains the asymmetry.
- **(b) Visual differentiation (badge / left-edge accent).** ~10-15 LOC + CSS. Same `r6-badge accent` chip vocabulary already in file (line 270). Polish add-on but doesn't fix the foot-gun.
- **(c) Hide-from-non-anchor + assembly-level framing (math-layer extension).** ~30-50 LOC + costing-adapter restructure. The long-term right answer; banked in `costing-adapter.ts:57-62` as "v1.1+ revisit."

### Cross-tab sync state (overlaps with Track 8)

production-drilldown READS from `inputRows` PROP (not store) for value display. Cross-tab edits on production cells update the store on tab A but tab B keeps rendering the stale RSC snapshot — same RSC-prop-vs-store pattern as PR #87 fix on packaging. Track 8 Follow-up #2a covers this.

### Findings

- **F7.1** Anchor-leaf UX is currently a silent foot-gun (sibling cells editable + writes to wrong quoteSkuId).
- **F7.2** Cross-tab sync gap (Track 8 overlap).
- **F7.3** Three treatment options ranged from band-aid (a, 10 LOC) to structural (c, math layer extension).

### Disposition recommendations

- **Slice 11 audit absorbs:** F7.1 (treatment (a) — tooltip + inert hardening, ~10 LOC)
- **Bundled with Track 8 Follow-up #2a:** F7.2 (production drilldown store-subscribe)
- **v1.1+ banked:** F7.3 (c — math-layer extension)

### Open question for CA + Edward

What does `upsertAssemblyProductionInputs` ACTUALLY do when called with a sibling leaf's quoteSkuId? Wasted round-trip OR silent data leak? Action-layer behavior determines whether the inert-input fix is "polish" or "bug fix." Recommend immediate trace; if data leak, F7.1 escalates to P1.

### Scope estimate

Treatment (a): ~0.25 day. Bundled with F7.2 (Follow-up #2a): ~1 day total.

---

## Track 8 — Slice 11.5.1 close follow-ups

### Follow-up #1 — StoredPackagingRow extension

**Current:** `StoredPackagingRow = CostingPackagingInput & { rowId: string }` carries `unitCost`, `qtyPerSellableUnit`, `category`, `markupPct`. Missing: `supplier`, `markupPctSource`, `inventoryEligible`, `notes`, `purchaseQty`, `sortOrder`.

**Scope:**
- `src/lib/costing.ts` — no change (math layer doesn't need these; they're metadata)
- `src/lib/costing-store.ts` — extend `StoredPackagingRow` type with 6 fields, extend `PackagingLineMetaFields`. ~25 LOC.
- `src/app/actions/costing.ts` — extend `packagingList` snapshot construction at `:1610-1619` to include the 6 fields. ~6 LOC.
- `src/components/costs/packaging-drilldown.tsx` — switch supplier/inventoryEligible/notes from `line.*` prop reads to `storeLineRow?.* ?? line.*`. ~15 LOC.

**Total: ~45-50 LOC across 3 files. Risk: low.** `HydrateSnapshot.packaging` already uses `StoredPackagingRow[]`, so adding fields cascades through hydrate/reconcile.

### Follow-up #2a — production drilldown store-subscribe

- Cell reads `row?.[line.field]` from `inputRows` PROP (line 511-624 ProdCellInput)
- Only `selectUpdateProductionCell` + `selectActiveTierId` subscribed; not value reads
- `PolicyToggles` (line 622-719) reads `policy` prop, writes via server action; does NOT call `updateProductionPolicy` store mutator
- Selectors needed: `selectProduction` analog of `selectPackaging`; optionally `selectProductionByRowId(skuId, tierId)`
- `selectUpdateProductionPolicy` exists at costing-store.ts:886 — UNUSED by PolicyToggles

**Scope:** ~35 LOC. Same fix shape as packaging PR #87.

### Follow-up #2b — freight drilldown store-subscribe

**Already done.** Freight is the reference architecture; packaging + production were the laggards. Verified:
- `FreightDrilldown` reads `selectFreightLegGroups` + `selectFreightLegs` (line 113-114)
- `LegBlock` reads `selectFreightLegs` + `selectFreightLegTiers` + `selectFreightCustomerArrangesMeta`
- All input components write via store mutators alongside server actions

**Scope: 0 LOC.** Just verify in CB walk that cross-tab freight edits propagate.

### Disposition recommendation

**Single micro-PR `slice-11-5-1-followups`** shipping #1 + #2a (~80 LOC, 4 files). Slottable between Slice 11.5.1 close and Slice 11 audit kickoff — half-day scope. Mark #2b as verified-no-op in the PR description.

OR bundle into Slice 11 audit Step 1 (cleanup pass). Either works; standalone micro-PR is cleaner.

### Scope estimate

- Standalone: ~half day
- Bundled into Slice 11 audit Step 1: ~half day (same scope; just different PR)

---

## Cross-slice dependencies

### Slice 11 audit ↔ Slice 12 (Quote umbrella + NetSuite finalization)

| Topic | Slice 11 audit | Slice 12 |
|---|---|---|
| PDF rendering | Pick library + wire | Builds on Slice 11's PDF artifact for Mark Accepted preview |
| Send action | Audit current sendQuote; add PDF + email | Quote umbrella restructures sendQuote into Send-to-Client sub-tab Advance |
| Mark Accepted | Peer surface stays (Slice 11 doesn't restructure) | Restructures Mark Accepted into Quote sub-tab; adds markAccepted action |
| Snapshot | Sent quote freezes commercial defaults only | Accepted quote freezes via production_recipes |
| HubSpot writebacks | None | Stage push on Mark Accepted Advance |
| NetSuite writebacks | None | SO push on Tier Selection Advance |
| Customer URL | D2 decision (no customer URLs OR tokenized share) | Inherits from Slice 11 |
| Email | D3 decision (mailto OR SMTP) | Inherits from Slice 11 |

**Risk:** if Slice 11 picks SMTP, Slice 12's Quote umbrella sub-tab Advances inherit SMTP infrastructure. If Slice 11 picks mailto, Slice 12's Send-to-Client sub-tab Advance is a `mailto:` button. Decision compounds.

### Slice 11 audit ↔ Slice 11.5.1 follow-ups

If micro-PR `slice-11-5-1-followups` ships standalone before Slice 11 audit kicks off, Track 7 + Track 8 work simplifies. If bundled into Slice 11 audit Step 1, that's the audit's cleanup phase. Edward's call.

---

## Disposition matrix

### What's in Slice 11 audit (recommended)

| Item | From | Scope estimate |
|---|---|---|
| PDF library selection + install + wiring | D1 + F1.1 | 4-6 days |
| Wire 6 PDF affordances to real handlers | F1.2 | 2-3 days |
| Pattern 45 audit + customer.name routing fix | F1.3 | 0.5 day |
| Service fees + freight lines hardcoded `[]` fix | F1.5 | 1-2 days |
| D2 sharing model decision + wire | F2.4 | 1-4 days (depends on decision) |
| D3 email channel decision + wire | F2.2 | 1-4 days (depends on decision) |
| D4 sent-quote freeze disposition + Pattern 45 boundary audit | F3.3, F3.6 | 1-2 days |
| §0.5 catch #76 leaf_specs pin verification | F3.4 | 0.5 day |
| §0.5 catch #77 quote_attachments boundary-guard | F3.5 | 0.25 day |
| Track 4 shared dropScenarioFamily helper extraction | F4.3 | 0.5 day |
| Suppress page-level preview_pdf ActionCard | F5.1 | 0.25 day |
| Restore sell-price override + client-target affordances (D5) | F5.3, F5.4 | 4-5 days |
| Track 5 orphan-on-disk cleanup | F5.6 | 0.5 day |
| retail_benchmark documentation drift fix | F6.2 | 0.25 day |
| Anchor-leaf foot-gun tooltip + inert hardening | F7.1 | 0.25 day |
| Track 8 follow-ups (#1 + #2a; #2b verify) | F7.2, F8 | 0.5 day |

**Total estimate: 17-30 days. Wide range driven by D1 (library spike) and D2/D3 decisions.**

### What's banked for v1.1+

- retail_benchmark renderer + schema column promotion (Track 6)
- Tier chip discoverability promotion (Track 5)
- Per-assembly production math-layer extension / treatment (c) (Track 7)

### What's Slice 12 / Quote umbrella scope

- Mark Accepted sub-tab IA restructure
- `markAccepted` action
- `production_recipes` table
- HubSpot deal stage push
- NetSuite SO push
- Sub-tab Advance mechanism
- `accept_sibling` + `draft_at_accept` enum value wiring
- Drop orphan `accepted_snapshot_json` column
- Mark Accepted modal "Auto-drop" affordance wiring

### What's a standalone micro-PR before Slice 11 audit

Optional: `slice-11-5-1-followups` (Track 8 #1 + #2a). Or bundle into Slice 11 audit Step 1.

---

## Consolidated open questions for CA + Edward

**D-class (must dispose before brief drafts):**

- **D1.** PDF library selection. Spike during inventory disposition or first day of Slice 11 audit.
- **D2.** Quote URL sharing model: no customer URLs in v1 (confirm) OR introduce tokenized share path.
- **D3.** Email channel: `mailto:` (zero infra, PM's mail client) OR SMTP (Resend/SendGrid; delivery receipts).
- **D4.** Sent-quote freeze: keep current UI-guards-only posture (recommended) OR promote send to full DB snapshot.
- **D5.** Sell-price override + client-target affordance restoration: row-expand editor (recommended) OR explicit admin-only v1 deferral.
- **D6.** Mark Accepted sub-tab vs peer surface: confirm Slice 12 owns the restructure (recommended) vs pull into Slice 11.

**Scope-edge questions:**

- **Q1.** Track 7 — does `upsertAssemblyProductionInputs` silently leak data when called with sibling leaf's quoteSkuId? Trace action layer; if data leak, F7.1 escalates to P1.
- **Q2.** Track 4 — sendQuote sibling-aware warn affordance vs sibling-agnostic? Recommend sibling-agnostic (current behavior).
- **Q3.** Track 8 — micro-PR before Slice 11 audit OR bundle into audit Step 1?
- **Q4.** Should Slice 11 audit pre-emptively drop orphan `accepted_snapshot_json` column, or leave for Slice 12? Recommend leave for Slice 12 (canonical replacement scope).
- **Q5.** Should Slice 11 audit wire `quotes.pdf_url` writer (PDF artifact to Storage), or leave for v1.1+? Affected by D2 decision (if tokenized share, customer needs a stable URL → pdfUrl wired; if no customer URLs, optional).

**False positives to retire from inventory:**

- Mark Accepted CTA redundancy on Pricing surface (F5.2) — does not exist; CA banking was misattribution
- Follow-up #2b freight drilldown — already done; verified no-op

---

## Recommended Slice 11 audit step plan skeleton (informational only — brief work follows)

Sketch only; brief authors the actual plan:

- **Step 0:** §0.5 + §0.5.5 verification (this inventory IS Step 0 of that)
- **Step 1:** Cleanup pass — orphan-on-disk delete (F5.6), Track 8 follow-up bundle (F7.2, F8)
- **Step 2:** PDF library spike + selection (D1)
- **Step 3:** PDF infrastructure — wire library, render artifact, store to Supabase Storage if D2/Q5 says so
- **Step 4:** Send action audit — Pattern 45 sweep + D4 freeze posture + customer.name fix
- **Step 5:** PDF affordance wire-up — 6 stub buttons → real handlers
- **Step 6:** Send delivery — D3 channel decision implementation
- **Step 7:** PSR architectural gap fixes (D5: sell-price override + client target row-expand)
- **Step 8:** Anchor-leaf foot-gun fix (F7.1) + helper extraction (F4.3)
- **Step 9:** Comprehensive smoke + Designer audit + retail_benchmark documentation cleanup (F6.2)

---

## Standing by

**CC:**
- Inventory complete (this doc)
- Standing by for D1-D6 dispositions

**CA:**
- Review inventory + sign-off on dominant-class framing (PR #90 milestone analysis)
- Dispose D1-D6 with Edward
- Sign-off on §0.5.5 brief gate adoption for Slice 11 audit

**Edward:**
- Disposition of D1-D6
- Confirm Track 5 orphan-on-disk delete is acceptable for Slice 11 audit cleanup
- Confirm Track 8 sequencing preference (standalone vs bundled)

**§0.5 ledger:** 75 → 77 after this inventory's catches bank (Slice 11 audit brief absorbs both).

**Next deliverable:** Slice 11 audit brief v1 — after D1-D6 dispositions land.
