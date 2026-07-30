# Nexus Current-State Audit

## 1. Executive Assessment

Nexus is a mature, internally coherent quoting and BOM application whose core lifecycle now runs from HubSpot-sourced project data through costing, customer PDF, revision, customer acceptance, and direct NetSuite Sales Order creation.

Slice 12 is functionally complete in the narrow, implementation-branch sense: the promised five-tab quote umbrella and direct Sales Order mechanism are present, the full lifecycle was manually walked, the defects found during that walk were patched, and the branch passes its static verification suite.

Slice 12 is not complete in the stronger release sense:

- The current branch is 12 commits ahead of `origin/main`; the closing fixes are not on `main`.
- Local evidence calls the pending work “PR #160,” but no local PR #160 merge commit exists.
- Major original product commitments—HubSpot Quote objects, HubSpot line items with COGS, FR-7 UNDERPRICED enforcement, and BELOW FLOOR administrative override—were not delivered.
- Browser validation remains manual and fixture-dependent.
- Operational cutover, NetSuite configuration ownership, reversal procedures, customer mapping, item-group disposition, and training remain future work.
- Canonical documentation materially contradicts shipped behavior.

Confidence: high for repository findings; medium for live-environment claims because this audit did not contact Supabase, HubSpot, NetSuite, Vercel, or GitHub.

No files or Git state were changed during the audit.

## 2. Product and Architecture Overview

Nexus is The DPS’s internal manufacturer-of-record quoting and BOM system. It converts a customer opportunity into:

1. A project imported or synchronized from HubSpot.
2. One or more quote scenarios.
3. An assembly/leaf product structure.
4. Packaging, production, bulk-raw, freight, and landed-cost inputs.
5. Per-tier cost, price, margin, and compliance calculations.
6. A customer-facing PDF.
7. A reversible send/revise/re-send lifecycle.
8. Recorded customer acceptance.
9. A direct NetSuite Sales Order.
10. A frozen, auditable completed quote.

Transcript evidence: `AI transcripts/projects/019f145b-603c-751f-bd27-8ab72cf36f37.json`, document `NEXUS-CONTEXT-PRE-SLICE-12.md`, §1, created 2026-07-28; high confidence, historical/current.

The implementation is a Next.js 15/React 19 application using:

- Clerk for identity and domain admission.
- PostgreSQL/Supabase with Drizzle ORM.
- Supabase Realtime for client-side cost synchronization.
- Supabase Storage for quote attachments and PDFs.
- HubSpot APIs and a local deal cache.
- NetSuite REST with OAuth 1.0.
- `@react-pdf/renderer` for customer PDFs.
- Zustand for realtime/optimistic costing state.

Primary evidence: `package.json`, `src/db/schema.ts`, `src/db/index.ts`, and `src/middleware.ts`.

A key operational constraint is that development and production historically share one Supabase project. This explains the unusually strict fixture, migration, and “ask before state-changing click” process. Evidence: `CLAUDE.md`, “Single Supabase project — dev and prod share one DB”; high confidence, current documented posture.

## 3. Reconstructed Development History

### Slices 1–4

The initial system established the Next.js application, authentication, Drizzle/Postgres model, HubSpot OAuth/import path, projects, quotes, tiers, and early product/BOM structures. The original specification assumed a flatter `quote_skus` model and a HubSpot-master workflow.

Current status: substantially obsolete as documentation; foundational behavior survives in later architecture.

Evidence:

- `docs/SPEC.md`
- Git migrations `0000`–`0007`
- Transcript document `NEXUS-CONTEXT-PRE-SLICE-12.md`, §§1 and 3

Confidence: medium; historical.

### Slices 5–8

The domain expanded into assemblies, production inputs, freight and landed cost, admin controls, audit logging, realtime updates, and role/permission gating. Slice 5.5 introduced assemblies; 5.6 introduced the HubSpot cache; Slices 6/6.5/7 built production and freight inputs; Slice 8 added stronger audit/admin foundations.

Notable evolution:

- Flat quote-SKU assumptions gave way to assembly/leaf relationships.
- RLS remained off; Clerk plus server-action guards became the access model.
- Audit actions and realtime behavior became explicit architectural conventions.
- Manual Supabase publication operations were separated from Drizzle migrations.

Evidence:

- Git branches `slice-5.5-assembly-support`, `slice-5.6-hubspot-cache`, `slice-6-production-inputs`, and `slice-7-freight-inputs`
- `drizzle/manual/README.md`
- `src/lib/admin-guard.ts`

Confidence: high; historical/current patterns.

### Slices 9–10

Pricing matured into:

- Per-quote and per-tier price adjustments.
- Suggested GPA and margin classification.
- Client-target comparison.
- Per-cell overrides.
- Recommended-tier behavior.
- Two-axis verdicts and pricing-surface redesign.
- Scenario copy, creation, and organizer workflows.

The classifier/math layer became explicitly load-bearing and insulated behind adapters.

Evidence:

- Git branches `slice-9.2` through `slice-9.5.1`
- `src/lib/pricing-classifier.ts`
- `src/lib/costing-adapter.ts`
- `CLAUDE.md`, “Math layer is the load-bearing surface”

Confidence: high.

### Slice 11 and 11.5/11.5.1

Slice 11 implemented the customer PDF using react-pdf, including:

- Customer-view boundary isolation.
- Font vendoring.
- Render axes: layout, detail level, addendum.
- Preview/download path.
- Send-time PDF creation and storage.
- Snapshot-backed sent-PDF behavior.

Slices 11.5 and 11.5.1 migrated cost data from the old flat input tables to assembly-centric tables and dropped the old model.

Evidence:

- Git branches `feat/slice-11-*`, `slice-11-5-*`, and `slice-11-5-1-*`
- `src/components/pdf/customer-pdf-document.tsx`
- `src/app/api/quotes/[quoteId]/customer-pdf/route.tsx`
- Migrations `0034_slice_11_5_assembly_cost_extension_tables.sql` and `0035_slice_11_5_1_drop_old_cost_tables.sql`

Confidence: high.

### Slice 12

Slice 12 began as “Mark Accepted + HubSpot writeback,” then expanded into the quote umbrella and direct NetSuite finalization.

Progression:

- PR #131: pre-slice quote-number continuity fix.
- PRs #132–134: umbrella scaffolding, `complete` state, schema.
- PRs #135–139: version picker, snapshots, send writers, Send tab.
- PRs #140–143: Client Review log and revise-in-place.
- PRs #144–146: acceptance, HubSpot stage/amount push, rollback, revise-from-accepted.
- PRs #147 onward: acceptance redesign, Sales Order UI, NetSuite adapters, direct SO creation, closeout.
- PR #158 merged schema reconciliation into `main`.
- The current 12-commit branch contains the final full-walk fixes; transcript context calls its review PR #160.

Transcript evidence:

- `AI transcripts/conversations.json`, “Transferring work from another Claude account,” messages 298–343.
- `AI transcripts/conversations.json`, “Slice 12 handover continuation,” messages 4 onward.
- `AI transcripts/cb context 72906.txt`, lines 1058–1805.
- Nexus project handovers dated July 28–29.

Confidence: high, historical; merge state current and verified from Git.

### Team roles and process

- CA: advisory/product/architecture coordinator; drafted briefs and dispositions.
- CC: implementation engineer and repository investigator.
- CB: independent browser QA/operator.
- CD: designer producing canonical prototype/CSS/data-source-map packages.
- Architect: schema and architectural verification, especially §0.5 pre-DDL review.
- Edward: product owner, relay between agents, merge authority, and final decision-maker.

The process used small PRs, explicit scope contracts, schema verification, design-source fidelity, code review, fixture provisioning, browser walks, fix passes, and living pattern documentation.

Transcript evidence: `NEXUS-CONTEXT-PRE-SLICE-12.md`, §§2–3; `AI transcripts/cb context 72906.txt`, lines 1037–1053. Confidence: high, historical.

## 4. Current Repository Map

| Boundary | Main locations | Responsibility |
|---|---|---|
| Application shell | `src/app`, `src/components/nav`, `src/components/rails` | Next.js routes and navigation |
| Project/quote workspace | `src/app/projects/[id]` | Project, scenario, and quote surfaces |
| Quote actions | `src/app/actions/quotes.ts` | Creation, tiers, send, revise, acceptance, rollback, completion |
| Quote umbrella | `src/components/quote-umbrella` | Preview, Send, Review, Acceptance, Sales Order |
| Cost domain | `src/lib/costing*`, `src/components/costs` | Cost computation and realtime presentation |
| Pricing | `src/lib/pricing-*`, `src/components/pricing*` | Suggestions, classification, targets, overrides |
| Customer PDF | `src/components/pdf`, `src/lib/customer-view-*` | Frozen customer representation |
| HubSpot | `src/lib/hubspot*.ts`, `src/app/import` | Deal/product reads, cache, product synchronization, stage/amount writes |
| NetSuite | `src/lib/netsuite` | Auth, preflight, item/customer resolution, SO creation |
| Database | `src/db/schema.ts`, `drizzle` | Schema and migrations |
| Auth/authorization | `src/middleware.ts`, `src/lib/*guard*` | Clerk, domain gate, admin and capability guards |
| Audit | `audit_log`, admin audit renderer | Forensic action history |
| Verification | `scripts/verify`, `scripts/test-*` | Static and DB-backed checks |

There are 281 tracked source files, 242 tracked documentation files, 110 Drizzle files, and 51 scripts.

## 5. Quote Lifecycle and State Machine

```text
draft
  │ sendQuote: assign/reuse quote number, freeze commercial/PDF snapshots,
  │ create PDF + review event + audit
  ▼
sent
  ├─ reviseQuote ───────────────► draft, version + 1, same quote ID/number
  ├─ manual review log entries
  └─ markAccepted: validate tier, push HubSpot stage + amount
       ▼
accepted
  ├─ unmarkAccepted: HubSpot rollback + status sent
  ├─ reviseQuote: delegates rollback, then draft/version + 1
  └─ markComplete: NetSuite SO create, persistence, freeze
       ▼
complete
  └─ terminal/read-only in Nexus; cancellation occurs in NetSuite
```

Other statuses—`superseded` and `lost`—remain in the enum but are not part of the primary Slice 12 happy path. Evidence: `src/db/schema.ts`, `quoteStatus`.

Important field semantics:

- `customer_accepted_tier_id`: reversible record of the tier the customer named.
- `accepted_tier_id`: irreversible tier committed during Sales Order completion.
- `customer_accepted_*` persists through acceptance rollback as a prefill/history aid.
- `accepted_tier_id` is written in the completion freeze transaction.

This explains why `customer_accepted_tier_id` may be populated while `accepted_tier_id` remains null before NetSuite send. The distinction is valid, but exposing raw field names in PM-facing UI was correctly identified as poor UX.

Evidence:

- `src/db/schema.ts`, `quotes.acceptedTierId`
- `src/db/schema.ts`, `quotes.customerAcceptedTierId`
- `src/app/actions/quotes.ts`, `markAccepted`
- `src/lib/netsuite/mark-complete.ts`, `runMarkComplete`

Rollback behavior:

- Acceptance rollback reverses the HubSpot stage first.
- Quote returns to `sent`.
- Acceptance audit and review history remain append-only.
- Customer tier/channel/transcription can remain as prefill.
- Revise-from-accepted delegates to the same rollback primitive before reopening the draft.

Evidence: `src/app/actions/quotes.ts`, `unmarkAccepted` and `reviseQuote`.

## 6. Integration Status

### HubSpot

Implemented:

- Deal import and cache.
- Single-deal/full cache synchronization.
- HubSpot product search and product/library synchronization.
- Deal linkage validation before send.
- Acceptance-stage update.
- Deal `amount` update from the accepted tier.
- Durable, version-scoped prior-stage capture.
- Acceptance rollback to the prior HubSpot stage.
- Best-effort post-NetSuite amount patch.

Partially implemented or absent:

- No HubSpot Quote object creation.
- `quotes.hubspot_quote_id` is present but has no writer.
- No HubSpot quote line-item write path.
- No accepted-tier line-item COGS writeback.
- No `hs_cost_of_goods_sold` population on HubSpot Quote line items.
- Client Review is a manual log, not automated email/portal response ingestion.
- The legacy HubSpot→NetSuite workflow’s actual cutover status is not verifiable locally.

Evidence:

- `src/lib/hubspot.ts`
- `src/app/actions/quotes.ts`, `markAccepted`
- `src/db/schema.ts`, `hubspotQuoteId`
- `docs/cc-slice-12-doc-reconciliation-report.md`, §3

Status: deal-stage/amount integration verified implemented; Quote-object/line-item/COGS commitments missing. High confidence.

### NetSuite

Implemented:

- OAuth 1.0 client and error classification.
- Customer-map lookup.
- Item resolution and ambiguity reporting.
- Business-segment and project-source resolution.
- Sales Order preflight.
- Item-group discovery/mapping infrastructure.
- Idempotency-key usage.
- Persistent `netsuite_so_pushes` attempt records.
- SO internal ID persistence.
- SO `tranid` persistence, including a fresh-fetch fallback.
- Quote mirrors for fast receipt reads.
- Completion freeze and audit.
- Completed Sales Order receipt UI.
- Failure/retry state.

Evidence:

- `src/lib/netsuite/mark-complete.ts`
- `src/lib/netsuite/sales-orders.ts`
- `src/lib/netsuite/sales-order-preflight.ts`
- `src/components/quote-umbrella/tab-sales-order.tsx`

Transcript/manual QA claims real sandbox SOs including 360741 and 360841/SO2698. Those live records were not independently checked in this audit.

Operational gaps:

- Workflow cutover and duplicate-order prevention.
- Item Group final production strategy.
- Customer-map maintenance UI/ownership.
- Unresolved-item handling policy.
- Taxability confirmation.
- Full SO field parity.
- Sales Order reversal/cancellation procedure.
- Production credential/environment controls.
- Operator training.

### Database/Supabase

Implemented:

- Drizzle schema through migration 0046.
- Journal and snapshots through 0046.
- Supabase Realtime manual publication operations.
- Service-role server Storage client.
- Anonymous browser Realtime client.
- Session-mode pooler with bounded connection settings.
- Quote snapshot, review-event, item-group, customer-map, and SO-push tables.

Risks:

- RLS is off across application tables.
- Dev and production historically share one database.
- Manual environment operations have no automated manifest.
- DB-backed verification scripts require live database access and were not run.
- `.env.example` omits NetSuite variables used by the implementation.

### Other external systems

- Clerk is the identity provider.
- Supabase Storage holds attachments and quote PDFs.
- There is no implemented email provider; “send” means PDF generation/workflow recording, with delivery remaining out-of-band.
- Slack administrative override workflow remains a stub/deferred design.

## 7. Slice 12 Verification Matrix

| Capability | Transcript claim | Repository evidence | Status | Confidence |
|---|---|---|---|---|
| Five-sub-tab umbrella | Steps 1–8 delivered Preview, Send, Review, Acceptance, Sales Order | `src/components/quote-umbrella/subtabs.ts` | Verified implemented | High |
| `complete` terminal state | Step 2/Step 8 claim | `schema.ts`; migration 0037 | Verified implemented | High |
| Version picker | PR #135 | `version-picker.tsx` | Verified implemented | High |
| Immutable send snapshots | PRs #136–137 | `quoteSnapshots`; `sendQuote` | Verified implemented | High |
| Revise in place | PR #142 | `reviseQuote` | Verified implemented | High |
| Review log | PRs #140–141 | `quote_review_events`; `add-entry.tsx` | Verified; manual only | High |
| Acceptance + HubSpot | PRs #144–145 | `markAccepted` | Verified implemented | High |
| Acceptance rollback | PR #144/Step 10 walk | `unmarkAccepted` | Verified implemented | High |
| Accepted revise warning | Walk finding #1 fixed | `revise-button.tsx` | Present on current branch | High |
| Rollback confirmation | Walk finding #5 fixed | `tab-mark-accepted.tsx` | Present on current branch | High |
| SO creation | Step 8 claim | `runMarkComplete`; `createSalesOrder` | Verified implemented | High |
| Internal ID persistence | Step 8 claim | Quote and push-record fields | Verified implemented | High |
| `tranid` persistence | Q15/`5fbe2b1` claim | `sales-orders.ts`; quote mirror | Verified in code; live proof unverified | High/medium |
| `accepted_tier_id` at completion | Step 8c-4 fix claim | Completion freeze transaction | Verified implemented | High |
| Completed receipt reachable | `5fbe2b1` R1 | Quote page route guard | Verified on branch | High |
| Completed form bypass closed | Walk finding #2 | Route coercion plus `assertNotFrozen` | Verified on branch | High |
| AdvanceBar hidden in modal | `5fbe2b1` R2 | `tab-sales-order.tsx` | Verified on branch | High |
| Migration reconciliation | §0.5 close | Migration 0046 | Verified in repository | High |
| SO-push tier FK | §0.5 recommendation | `schema.ts`; migration 0046 | Verified implemented | High |
| Shared `assertDraft` | §0.5 recommendation | `action-result.ts` | Verified implemented | High |
| Shared `assertRevisable` | §0.5 recommendation | `action-result.ts`; separate `requireRevisable` remains | Implemented differently/duplicated vocabulary | High |
| HubSpot Quote + COGS | Original SPEC/Slice 12 claim | No writer found | Missing | High |
| FR-7 UNDERPRICED gate | Original SPEC | No accept-path enforcement | Missing | High |
| BELOW FLOOR override | Original SPEC | Hard rejection; UI stubs | Present but incomplete | High |

## 8. Transcript-to-Code Contradictions

1. **“Slice 12 complete” versus branch state.** The implementation branch contains the close fixes, but they are not on `main`. “Complete” currently means ready for PR review, not integrated release state.

2. **PR #160.** Local Git contains no #160 commit/reference. `AI transcripts/cb context 72906.txt:1026` only proposes “Review PR #160.” Unable to verify the actual GitHub PR without external access.

3. **Original Slice 12 HubSpot scope.** `docs/SPEC.md` promises Quote object/COGS writeback. Code only patches deal stage and amount.

4. **NetSuite as a v1 non-goal.** `docs/SPEC.md` says NetSuite read/write is a non-goal, while Slice 12 directly creates SOs. Later briefs changed the architecture without amending the spec.

5. **Existing HubSpot→NetSuite sync “unchanged.”** Direct Nexus→NetSuite creation contradicts this. Whether the old automation remains active is unknown and operationally important.

6. **FR-7 gates.** The specification requires UNDERPRICED and BELOW FLOOR gates with administrative overrides. Only hard BELOW FLOOR detection exists.

7. **Slice numbering.** “Slice 13” means multiple different things across SPEC, redesign documents, library-sync planning, and the newer launch-readiness drafts.

8. **Old data model.** SPEC still documents `quote_skus`, `packaging_inputs`, `production_inputs`, and `freight_inputs`; these have been replaced or dropped.

9. **Client Review naming.** It sounds like automated response tracking, but is an internal manual log. This reduction was explicitly accepted for v1 in the transcript, yet not consistently reflected in canonical product documentation.

10. **“Sales Order number” in UI.** The receipt historically displayed the NetSuite internal ID rather than `tranid`; the current branch adds/fixes `tranid` retrieval. The distinction must remain explicit.

## 9. Test and QA Assessment

### Automated checks

The following passed during the audit:

- Customer-view boundary verifier: 19 files.
- react-pdf import containment.
- PDF font coverage.
- Pattern 47 focus-stability verifier.
- Single allowed `complete` writer.
- Pricing classifier: 21 scenarios.
- NetSuite adapter tests.
- TypeScript `--noEmit --incremental false`.

These are useful architectural and pure-logic checks, but they are not a conventional application test suite.

### Missing test maturity

- No Playwright configuration.
- No tracked browser tests.
- No CI workflow under `.github/workflows`.
- No Jest/Vitest test harness.
- Lifecycle actions lack automated transactional integration tests.
- HubSpot rollback/retry behavior is manually proven.
- NetSuite idempotency and receipt behavior are partly pure-tested but end-to-end verified manually.
- Route coercion and modal layering fixes have no browser regression tests.
- Migration rebuild-from-zero is not automated.

### Manual CB coverage

The final CB walk covered:

- Sent quote orientation.
- Revise and resend.
- Acceptance.
- Acceptance rollback.
- Revise from accepted.
- NetSuite send.
- Completion freeze.
- Dev-state simulations.

It found numerous defects missed by implementation-side smoke, including:

- Accepted-revise modal omitting the HubSpot rollback warning.
- Completed quote direct-URL bypass.
- Incorrect margin percentage formatting.
- Internal tooltip/copy leakage.
- Missing rollback confirmation.
- Terms/lead-time drift.
- Raw internal field names.
- Completed receipt unreachability.
- Missing `tranid` presentation.

Most were patched on the current branch. This is strong exploratory QA but fragile regression coverage.

## 10. Migration and Data Integrity Assessment

### Ordering and tracking

Migrations are sequential through `0046`; `_journal.json` includes every entry from `0000` to `0046`.

The apparent 0036/0037 conflict was reconciled correctly:

- Automatic `0036` is the Slice 11 PDF-layout migration.
- Automatic `0037` adds `complete`.
- Former manual Slice 12 fixes also called 0036/0037/0046 were collapsed into automatic `0046`.
- The old manual files are no longer tracked.

Migration `0046_slice_12_step_10_reconcile_and_fk.sql` reconciles:

- HubSpot acceptance stage default/data to internal stage ID `195607084`.
- NetSuite tax-code default/nullability.
- `netsuite_so_pushes.accepted_tier_id` FK with `ON DELETE RESTRICT`.

Status: repository reconciliation is sound; actual application to every environment is unable to verify.

### Foreign keys

- `quotes.accepted_tier_id → quote_tiers.id ON DELETE RESTRICT`: correct for irreversible commitment.
- `quotes.customer_accepted_tier_id → quote_tiers.id ON DELETE SET NULL`: correct for reversible customer choice.
- `netsuite_so_pushes.accepted_tier_id → quote_tiers.id ON DELETE RESTRICT`: now present.

### Remaining risks

- Manual Supabase publication operations remain out of Drizzle by design.
- No automated per-environment migration manifest is evident.
- No clean-database reconstruction test exists.
- Shared dev/prod DB history increases accidental production-data risk.
- Stale `customer_accepted_*` values are deliberate for prefill, but consumers must always interpret them with quote status and audit context.

## 11. Security and Reliability Assessment

Strengths:

- Clerk authentication covers application and API routes.
- Access is restricted to `@thedps.co` plus explicit allowlist.
- Admin actions enforce server-side role checks.
- Capability-sensitive spec/library actions use server guards.
- Service-role Supabase client is server-only.
- NetSuite OAuth signing is isolated server-side.
- External-first ordering prevents local acceptance/completion claims when upstream writes fail.
- Audit logging is pervasive.
- Completion has a single-writer verifier.
- NetSuite push records support retry convergence.

Risks:

1. **RLS off.** Browser Supabase uses an anonymous key against realtime-publication tables. Security depends on publication scope and no unintended direct data access.

2. **Shared dev/prod database.** The largest operational safety risk. Transcript QA repeatedly used live systems and production data.

3. **Dev diagnostic API.** `src/app/api/dev/dump-deal-props/route.ts` is domain-authenticated but not admin-only and exposes HubSpot property metadata. Its own comment says to remove or tighten it.

4. **Service-role breadth.** Storage authorization relies entirely on server-action correctness; no row-level tenant boundary exists.

5. **Error code reuse.** NetSuite failures are returned as `ERR.HUBSPOT` in `quotes.ts`. This is operationally misleading.

6. **No automated concurrency test.** External-first operations inherently have partial-failure windows. The code handles many through idempotency, but formal fault-injection coverage is absent.

7. **Environment documentation gap.** `.env.example` contains no NetSuite credential/configuration variables.

## 12. Documentation Assessment

### Most useful current documents

- `CLAUDE.md`: architecture and pattern bank; generally current, but enormous and partly historical.
- `docs/pattern-52-freeze-list.md`: canonical freeze inventory.
- `docs/quote-umbrella-brief.md`: Slice 12 scope contract.
- R8/R9 designer notes and data-source maps: canonical UI intent.
- `docs/UX_BACKLOG.md`: deferrals, though not all “resolved” labels are accurate.

### Stale or contradictory

- `docs/SPEC.md`: materially obsolete architecture, schema, lifecycle, and roadmap.
- `docs/STRATEGIC_VISION.md`: contains old and revised NetSuite strategies simultaneously.
- `README.md`: too sparse for onboarding and contains encoding damage.
- Older handover documents: valuable historical evidence but superseded by later copies.
- Several old Mark Accepted components still contain “Slice 12 wires…” stubs even though the live umbrella implementation moved elsewhere.

The untracked `docs/cc-slice-12-doc-reconciliation-report.md` is the clearest description of these inconsistencies, but it is not committed.

## 13. Remaining Work

### P0 blockers

| Work | Reason | Modules | Dependency | Next action | Complexity |
|---|---|---|---|---|---|
| Merge/review current close branch | Final lifecycle fixes are not on main | Quote umbrella, quote actions, NetSuite | PR #160 state | Review diff, rerun checks, merge intentionally | Medium |
| Prevent duplicate SO paths | Legacy HubSpot→NetSuite workflow may still run | HubSpot workflow + NetSuite | Human/Vu discovery | Confirm current automation and execute cutover runbook | Large |
| Define SO reversal | Nexus completion is irreversible locally, but mistakes require a supported process | NetSuite, audit, operations | Finance/ops decision | Document cancellation authority and reconciliation | Medium |
| Resolve v1 scope contract | “v1 complete” is undefined while original HubSpot/FR-7 commitments are missing | SPEC, roadmap | Product decision | Explicitly accept deferral or implement commitments | Medium |

### P1 required before v1

| Work | Reason | Modules | Dependency | Next action | Complexity |
|---|---|---|---|---|---|
| FR-7 UNDERPRICED gate | Silent contractual gap permits line-level underpricing | Costing bundle, `markAccepted` | Override policy | Add server gate, audit, tests | Medium |
| BELOW FLOOR admin override | Legitimate exceptions are hard-blocked; UI is stubbed | Acceptance, roles, audit | Approval workflow decision | Implement minimal admin-only override with reason | Medium |
| Customer-map management | SO send depends on mappings that PMs cannot maintain safely | NetSuite customer map/admin | Ownership | Build gated CRUD + audit | Medium |
| Item Group decision | Current schema exists but production behavior remains unsettled | NetSuite item groups | NetSuite/Vu validation | Choose supported route and test full payload | Large |
| Full SO field parity | Direct SO must match business-required legacy fields | NetSuite payload | Business input | Close parity matrix and test | Medium |
| Migration reconstruction test | Prevent fresh-environment drift | Drizzle/manual config | Test database | Automated migrate-from-zero verification | Medium |
| Automated lifecycle regression | Manual-only coverage is too fragile | Quote umbrella/actions | Test fixtures | Add browser tests with isolated mocks/DB | Large |
| Document environment contract | Missing NetSuite and deployment configuration | `.env.example`, operations docs | Credential inventory | Document keys without secrets | Small |

### P2 recommended before v1

| Work | Reason | Modules | Dependency | Next action | Complexity |
|---|---|---|---|---|---|
| Replace raw field-name UI | Confuses customer choice with committed tier | Acceptance tab | None | Use business-language labels | Small |
| Formalize terms-drift behavior | Revise may pick up changed firm settings | Snapshots/mismatch banner | Product decision | Warn or explicitly re-snapshot | Medium |
| Tighten dev endpoint | Metadata exposure beyond necessity | `dump-deal-props` API | None | Remove or admin-gate | Small |
| Distinct NetSuite error code | Improves diagnosis and telemetry | Action result/quotes | None | Add `ERR.NETSUITE` | Small |
| CI pipeline | No automatic checks on PRs | Repository config | GitHub setup | Run typecheck/prebuild/rebuild test | Medium |
| Improve README/onboarding | Current entry document is insufficient | README/docs | Canon decision | Write repository map and safe commands | Small |

### P3 post-v1

- Automated customer-response ingestion.
- HubSpot Quote objects, line items, and COGS if still strategically desired.
- Slack approval workflow.
- SO cancellation automation.
- Snapshot retention policy.
- Rich sent-version comparison.
- Broader realtime/RLS architecture.
- Cleanup of obsolete Mark Accepted shells and historical stubs.

## 14. Slice 13 and Slice 14 Readiness

Slice 13 can begin as a planning and discovery slice. It should not begin as broad implementation until:

- The current branch is merged.
- Workflow cutover ownership is settled.
- The “Slice 13” numbering collision is resolved.
- The v1 scope decision on HubSpot Quote/COGS and FR-7 is explicit.
- NetSuite reversal, item groups, customer maps, taxability, and field parity have owners.

The latest transcript draft defines Slice 13 as NetSuite Readiness & Cutover, covering workflow cutover, Item Groups, unresolved leaves, customer mapping, taxability, field parity, reversal, and capability inventory. That is directionally correct.

Slice 14 should wait. Its launch-readiness remit—full lifecycle smoke, backlog burn-down, training, and launch preparation—depends on Slice 13 establishing an operable process rather than merely a working API mechanism.

Transcript evidence: project documents `SLICE-13-READINESS-SCOPE.md` and `SLICE-14-LAUNCH-READINESS-SCOPE.md`, updated July 29; medium confidence, proposed/uncommitted.

## 15. Recommended Execution Plan

1. Review and merge the current Slice 12 close branch without adding scope.
2. Re-run typecheck and prebuild checks on the merge result.
3. Run one isolated sandbox lifecycle walk after merge, with no production/shared data.
4. Confirm the old HubSpot→NetSuite SO workflow’s status and write the cutover runbook.
5. Amend the product canon:
   - Current architecture.
   - Actual lifecycle.
   - Actual v1 commitments and accepted deferrals.
   - New release-phase names that avoid numbering collisions.
6. Implement P1 commercial gates:
   - UNDERPRICED detection.
   - Minimal administrative override with reason and audit.
7. Close NetSuite readiness:
   - Customer mapping.
   - Item strategy.
   - Field parity.
   - Tax.
   - Reversal.
8. Add automated quote-lifecycle integration/browser coverage.
9. Add clean-database migration verification and CI.
10. Only then run Slice 14 launch smoke, training, and release approval.

This preserves the existing architecture; no broad rewrite is justified.

## 16. Unknowns and Required Human Decisions

Unknowns, not proven defects:

- Whether PR #160 currently exists or is merged remotely.
- Whether migration 0046 is applied in every environment.
- Whether the legacy HubSpot→NetSuite workflow is active.
- Whether direct Nexus SO creation currently risks duplicates.
- Whether NetSuite credentials/configuration are production-ready.
- Whether all customer mappings and item mappings are populated.
- Whether live `tranid` fetching succeeds consistently outside the reported fixture.
- Whether dev/prod still intentionally share one Supabase project.
- Whether a real customer email channel is required for v1.
- Whether HubSpot Quote objects and line-item COGS remain v1 requirements.
- Whether UNDERPRICED/BELOW FLOOR overrides should be local admin actions, Slack-mediated, or both.
- Whether “Slice 13/14” names should supersede or coexist with the original SPEC roadmap.

Required human decisions:

1. Define v1 against current business needs, not stale SPEC wording.
2. Assign authority for NetSuite cancellation/reversal.
3. Decide the legacy workflow cutover date and owner.
4. Decide the Item Group production posture.
5. Decide the minimum administrative override workflow.
6. Decide whether customer delivery remains out-of-band for v1.

## 17. Final Verdict

**Is Slice 12 complete?**

Implementation-complete on its feature branch, but not merged/release-complete. It also does not satisfy every capability historically assigned to “Slice 12.”

**Is the codebase internally consistent?**

Mostly. The core quote lifecycle, field semantics, migrations, and completion mechanism are coherent. The largest inconsistencies are documentation, duplicated guard terminology, stale UI shells, incomplete commercial gates, and operational assumptions outside code.

**Is it safe to begin Slice 13?**

Safe to begin discovery, cutover planning, and scope reconciliation. Not safe to begin broad production implementation or cutover until the current branch is merged and duplicate-SO/reversal questions are resolved.

**Top five risks:**

1. Legacy HubSpot→NetSuite automation may conflict with direct Nexus SO creation.
2. Final Slice 12 fixes are not on `main`.
3. FR-7 UNDERPRICED and administrative override requirements are missing.
4. End-to-end regression coverage is manual and uses risky shared-system fixtures.
5. Canonical documentation misstates the architecture, data model, and v1 scope.

**What should be done next?**

Review and merge the current branch, verify the merged lifecycle in an isolated sandbox, settle workflow cutover/reversal ownership, then reconcile the v1 specification before implementing the Slice 13 readiness work.
