# Quote umbrella — sub-tab restructure + NetSuite finalization — Brief

**Slice position:** v1 release-critical path, item 5 (after Leaf-detach micro-slice; before Slice 11 PDF customer-facing data bindings)
**Slice type:** Combined IA + structural UI + integration slice (does not split into X/Y per Edward disposition)
**Status:** Draft for Edward review; pending Architect Pattern 22 §0.5 verification post-canon-revision landing

---

## 1. Background & context

The post-pricing workflow has been operationally messy. PMs build a quote (Setup → Costs → Pricing) then enter an undifferentiated execute phase where the IA doesn't reflect the actual operational reality. Quote, Mark Accepted, and the eventual NetSuite SO push live in conceptually distinct workflow phases but share one undifferentiated surface (Quote) plus one peer surface (Mark Accepted) that's really a transition event.

Three operational facts drive the restructure:

1. **Customer picks one tier ~95% of the time.** The Pricing reframe surfaces per-tier compliance, but the operational artifact downstream (NetSuite SO) needs ONE tier's data — and there's no current explicit "which tier did customer pick" capture.
2. **HubSpot deal stage push happens at acceptance; NetSuite SO push happens at tier commit.** These are different events at different times, but the previous Mark-Accepted writebacks slice scoped them together.
3. **The customer-acceptance lifecycle has discrete phases.** Send to customer, wait, accept, tier-select, advance-to-NetSuite. Each phase has distinct work; the IA didn't reflect them.

The Quote umbrella restructure clarifies the IA, captures the tier selection explicitly, and splits the external system writebacks across the appropriate lifecycle events.

## 2. The problem — operational risk

**Symptom 1: Tier ambiguity at NetSuite push.** Today, when a quote is "accepted," there's no explicit record of WHICH tier the customer is buying. PMs encode this implicitly in NetSuite SO line items, but Nexus doesn't capture it. Downstream operational artifacts (BOM, packing list, freight) that will live in the Operations wrapper need a definitive answer to "which tier is this quote running on" — currently they'd have to guess.

**Symptom 2: HubSpot/NetSuite event conflation.** The prior Mark-Accepted writebacks scope pushed BOTH HubSpot deal stage AND NetSuite SO at the acceptance event. Conceptually, accepting and committing-to-execute are different decisions. Customer acceptance signals deal-won (HubSpot concern); tier commitment signals operational kickoff (NetSuite concern). Same event for both creates rigidity.

**Symptom 3: Workflow surface invisibility.** Between "send" and "accept" the user has no Nexus surface that says "this quote is sent; awaiting customer." PMs do this in HubSpot or email. Between "accept" and "advance to NetSuite" — same gap. The IA had no place for the waiting states.

**Symptom 4: Reversibility unclear.** Once a quote is "accepted," what can be undone? Pre-restructure, Mark Accepted was the irreversible event (fired writebacks). Post-restructure, the irreversible event is Tier Selection Advance (NetSuite SO push). This is operationally cleaner — PMs can mark accepted, then back out if customer hesitates, without leaving NetSuite in an inconsistent state.

## 3. The decision — scope and canon impact

**v1 ships the Quote umbrella + lifecycle finalization as a single comprehensive slice.** No X/Y split per Edward disposition.

**Canon impact** (pre-requisites land via the canon revision PR before this slice's brief verifies):

- Surface canon reverts from 5→6 to **4 peer top-level surfaces** (Setup, Costs, Pricing, Quote)
- **Quote umbrella has 4 sub-tabs:** Preview Quote · Send to Client · Mark Accepted · Tier Selection
- **Operations dissolves from peer surface entirely** — reframed as future orchestration wrapper, not v1 scope
- Mark Accepted dissolves from peer surface into Quote sub-tab

**Scope IN:**

- Quote sub-tab IA + structural UI (4 sub-tabs + Advance action mechanism)
- Migration of Mark Accepted UX from peer surface to sub-tab (preserves existing functionality)
- New Send to Client sub-tab UX (sending action + post-send waiting state)
- New Tier Selection sub-tab UX (PM-proxy tier choice capture)
- New Advance action mechanism between sub-tabs
- State enum extension (`quotes.status` adds `complete`)
- New column for tier selection capture (`quotes.selected_tier_id`)
- Finalization warning at Tier Selection Advance ("this will finalize the quote, no further changes, rollbacks require admin approval")
- HubSpot deal stage push at Mark Accepted Advance (moved from prior Mark-Accepted writebacks slice scope)
- NetSuite SO push at Tier Selection Advance (moved from prior Mark-Accepted writebacks slice scope)
- Pricing surface "Send to customer" CTA updates to advance to Quote > Send to Client sub-tab (minor)

**Scope OUT:**

- Operations wrapper / dashboard (post-v1, separate placement discussion)
- BOM generation, packing list, freight tracker (Operations wrapper artifacts)
- `lifecycle_events` schema table (deferred to Operations slice for forward-compat; v1 uses `audit_log` for state transitions)
- Customer self-serve tier selection (v2 candidate; v1 is PM-proxy)
- Customer self-serve acceptance flow (v2 candidate; v1 is PM-proxy)
- Quote versioning workflow for post-Complete changes (v1.5+ backlog; Complete state is forward-only in v1)
- Multi-tier orders (customer buys T1 quantity AND T2 quantity) — v2 candidate; v1 is single tier
- HubSpot webhook handler for inbound deal-stage updates (v2)
- NetSuite reconciliation for inbound SO state (v2)

## 4. Solution architecture

### 4.1 Quote umbrella IA

Quote remains a peer top-level surface (4th of 4: Setup → Costs → Pricing → Quote). Internally, four sequential sub-tabs:

| Sub-tab | Purpose | State on entry | Advance fires |
|---|---|---|---|
| **Preview Quote** | Internal review of the quote before sending — PDF preview, version selection, edit-or-finalize choice | `quote.status = 'draft'` | No external; sets `quote.status = 'preview_ready'` (internal flag) |
| **Send to Client** | Send action + post-send waiting state | `quote.status = 'preview_ready'` | Sends PDF (existing snapshot mechanism); sets `quote.status = 'sent'`; emits snapshot event |
| **Mark Accepted** | Record customer's acceptance (PM proxy) | `quote.status = 'sent'` | Sets `quote.status = 'accepted'`; **HubSpot deal stage push fires** |
| **Tier Selection** | Capture customer's chosen tier (PM proxy) and finalize | `quote.status = 'accepted'` | Sets `quote.selected_tier_id = <chosen>`; sets `quote.status = 'complete'`; **NetSuite SO push fires**; finalization warning shown before |

Each sub-tab carries an explicit **Advance** action button (the progression action between sub-tabs). Sub-tab is accessible only when the quote is in the appropriate state — earlier sub-tabs become read-only after their Advance has fired (no rewinding without admin override).

Pricing surface "Send to customer" CTA navigates to Quote > Preview Quote sub-tab (not directly to Send to Client — gives PM the explicit preview moment before send).

### 4.2 Advance action mechanism

Each sub-tab has one explicit Advance button. Click:

1. UI validation (each sub-tab has its own pre-advance guards — see §4.5)
2. Confirmation dialog if irreversible (Tier Selection Advance only — finalization warning)
3. Server action fires (state transition + external integration if applicable)
4. Audit log entry written (`audit_log.action = 'quote_advanced'` with `diff_json.from_state` and `diff_json.to_state`)
5. UI advances to next sub-tab automatically on success

**Reversibility:**
- Preview Quote Advance → Send to Client: reversible (PM goes back, no external side effects)
- Send to Client Advance → Mark Accepted: reversible BUT customer has received PDF (manual coordination required for retraction; PMs do this externally today)
- Mark Accepted Advance → Tier Selection: reversible (HubSpot deal stage push fired but is reversible via stage rollback action; existing HubSpot rollback patterns apply)
- Tier Selection Advance → Complete: **NOT reversible without admin override**. NetSuite SO push fires; quote locks. Post-Complete reversal requires admin approval workflow + NetSuite SO deletion + new quote version creation (versioning workflow is v1.5+ backlog).

### 4.3 Tier Selection sub-tab UX

PM records customer's communicated tier choice. UI:

- Read-only display of all tiers' final-priced compliance summary (post-Pricing-reframe-v1 per-tier compliance block, reused)
- Single-select radio/dropdown: which tier did customer pick?
- Default: ★ Recommended tier (if set) — PM can override
- Validation: tier must be selected before Advance; tier below floor blocks Advance (admin override path)
- Finalization warning preview shown before final Advance click

Tier choice persists to `quotes.selected_tier_id` (FK to `quote_tiers.id`). Audit log captures the selection.

### 4.4 State enum extension

Current state enum (assumed): `draft | sent | accepted | dropped`

Extended state enum: `draft | preview_ready | sent | accepted | complete | dropped`

`preview_ready` is an internal flag indicating the quote is at the Preview Quote sub-tab and ready for Send action. It exists to differentiate "draft being edited" from "draft ready for send" and is set automatically when PM clicks "Send to customer" CTA on Pricing surface.

`complete` is the new terminal state. Forward-only in v1: existing quotes don't backfill to `complete`; only new quotes that go through Tier Selection Advance get there.

### 4.5 Pre-advance validation guards

Per sub-tab, validation fires before Advance is allowed:

**Preview Quote → Send to Client:**
- All SKUs have complete data (Setup completeness check, existing)
- All cost rows populated (Costs completeness check, existing)
- Pricing has no below-floor violations (existing firm policy gate)
- PDF preview successfully rendered (no render errors)

**Send to Client → Mark Accepted:**
- PDF send action completed (snapshot event emitted)
- Quote in `sent` state (state check)

**Mark Accepted → Tier Selection:**
- Quote in `accepted` state
- HubSpot deal stage push succeeded (or error surfaced for retry)

**Tier Selection → Complete:**
- Selected tier ID set
- Selected tier not below floor (admin override required if below)
- Finalization warning shown + user confirmed
- HubSpot deal context present (NetSuite SO needs customer mapping)
- NetSuite SO push payload validates (line items, customer, terms)

### 4.6 HubSpot deal stage push (Mark Accepted Advance)

Existing HubSpot integration pattern (per the prior Mark-Accepted writebacks scope, repurposed for Mark Accepted Advance specifically):

- HubSpot deal stage maps from `hubspot_deal_id` on the quote
- Stage update target: "Closed Won" (or equivalent — discovery question Q4 below)
- Audit log captures the push event with response code
- Failure handling: surface error, allow retry; do NOT advance quote state until push succeeds

Uses `HUBSPOT_WRITE_ACCESS_TOKEN` per CLAUDE.md HubSpot token model.

### 4.7 NetSuite SO push (Tier Selection Advance)

New NetSuite integration. Push payload:

- **Header:** customer ID (mapped from HubSpot deal), terms (FOB Long Beach default per firm settings, 50/50 payment, 8-12wk lead, 30-day quote validity), SO ID prefix `DPS-1000+`
- **Lines:** SKUs from selected tier with selected tier's qty and sell-per-unit. Assembly structure preserved (line groups per assembly hierarchy)
- **Notes:** Quote ID reference, Nexus URL link back to quote
- **Status:** Created in "Pending Fulfillment" or equivalent (discovery question Q5 below)

NetSuite SO ID captured back to `quotes.netsuite_so_id`. Post-push confirmation UI shows the SO ID and link.

Failure handling: surface error, allow retry; do NOT advance quote to `complete` state until push succeeds. Idempotency key (Q6 below) prevents duplicate SOs on retry.

## 5. Schema verification gate (Pattern 25)

**Schema changes:**

1. `quotes.status` enum: add `preview_ready`, `complete` values
2. `quotes.selected_tier_id` column: nullable FK to `quote_tiers.id` (nullable until Tier Selection Advance fires)
3. `quotes.netsuite_so_id` column: nullable text (populated after NetSuite SO push)
4. `quotes.netsuite_pushed_at` column: nullable timestamp (audit timestamp for NetSuite push)

**Migration:**
- Existing quotes retain their current status; no backfill
- `selected_tier_id`, `netsuite_so_id`, `netsuite_pushed_at` default NULL on existing rows
- New migration file follows established naming + numbering convention

**Pattern 25 verification at Architect §0.5:**
- Confirm `selected_tier_id` FK semantics (cascade behavior on tier delete — recommend `ON DELETE RESTRICT` since deleting a tier that's been selected breaks audit integrity)
- Confirm `netsuite_so_id` shape (NetSuite IDs are numeric strings; varchar(50) safe)
- Confirm enum extension doesn't conflict with existing state machine guards (`quote-guards.ts` may need updates for `preview_ready` and `complete`)
- Confirm audit_log captures all state transitions cleanly (action enum extension if needed: `quote_advanced` may be sufficient OR per-state actions like `quote_advanced_to_sent`, etc. — Architect dispositions per Slice 9.2 audit source convention)

**Slice 9.2 `diff_json.source` convention:**
- Manual Advance from sub-tab UI → no `source` flag (absence = manual)
- Admin rollback action → `source: 'admin_rollback'`
- Future automated state advances (none in v1) → reserve namespace

## 6. Workflow scenarios to test against

**Happy path:**
1. PM builds quote (Setup → Costs → Pricing)
2. Pricing per-tier compliance clean; PM clicks "Send to customer" → lands on Quote > Preview Quote
3. PM reviews PDF preview; clicks Advance → lands on Send to Client; quote status `sent`; snapshot event emitted
4. PM externally communicates with customer; days/weeks pass; customer accepts
5. PM returns to Send to Client sub-tab; clicks Advance → lands on Mark Accepted; quote status `accepted`; HubSpot deal stage push fires
6. PM communicates with customer about tier choice; customer picks T2
7. PM advances to Tier Selection; selects T2; clicks Advance; finalization warning appears; confirms
8. NetSuite SO push fires; quote status `complete`; SO ID + link displayed; quote locks

**Edge cases:**

- **Tier below floor at Tier Selection.** Customer picked T1; T1 is below floor. Advance blocked with admin override path (R5 firm policy gate pattern). PM either selects different tier (T2+) or requests admin override.
- **HubSpot push failure at Mark Accepted Advance.** Network error or API rate limit. Error surfaces; Advance does NOT fire; PM retries. Quote remains in `sent` state until push succeeds.
- **NetSuite push failure at Tier Selection Advance.** Same as above but for NetSuite. Quote remains in `accepted` state.
- **NetSuite push partial failure (idempotency).** Push fires but client times out before response. Retry must not create duplicate SOs. Idempotency key (Q6 below) ensures retry returns the original SO.
- **Quote dropped mid-flow.** PM drops quote at any sub-tab; existing drop semantics apply (`status='dropped'`); sub-tab navigation blocks.
- **Customer requests changes post-send.** Out of scope for v1 (versioning workflow is v1.5+). PMs handle manually via email/dropping quote + new version.
- **Customer requests changes post-Complete.** Admin override path required. NetSuite SO deletion + new quote version creation. Out of scope for v1; surfaces as future workflow design.
- **Multiple PMs editing same quote.** Existing quote draft guard pattern applies (`quote.status !== 'draft'` blocks edits).
- **PM advances incorrectly (e.g., marks accepted when customer hasn't).** Reversible via "go back" UI on Mark Accepted sub-tab (rolls back HubSpot deal stage; emits rollback audit event). Tier Selection Advance is NOT reversible without admin override.

**Pattern 47 interaction (post-autosave-sweep):**

- Tier Selection sub-tab has the selected-tier radio/dropdown (form input). Pattern 47 applies — controlled input, optimistic store update, debounced save, wait-for-quiet reconcile.
- All sub-tab navigation respects Pattern 47 — no focus interruption during sub-tab transitions when typing in fields.

## 7. Discovery questions (Pattern 41 analogue)

CA recommendations included.

**Q1: Sub-tab order — strict sequential or flex?**

CA rec: **Strict sequential.** Sub-tabs accessible only when quote is in the appropriate state. Earlier sub-tabs become read-only after their Advance has fired. Prevents PM confusion about "where in the flow am I" and prevents skipping steps.

Alternative: Flex (PM can revisit earlier sub-tabs and re-execute Advance). Rejected because it muddies the irreversibility semantics and creates ambiguous audit trails.

**Q2: Finalization warning copy — strong or strongest?**

CA rec: **Strong, action-specific.** Example: "Advancing to Complete triggers NetSuite SO #{push_target} push. This finalizes the quote — no further changes. Rollbacks require admin approval. Confirm advance?"

Alternative: Generic "Are you sure?" — too weak for the irreversibility level. Stronger framing matches the operational stakes.

**Q3: Tier Selection default — recommended tier or no default?**

CA rec: **Recommended tier (★) as default.** PM still must explicitly confirm by clicking Advance, so defaulting saves time without removing the explicit confirmation step.

Alternative: No default (PM must explicitly select). Rejected because it adds friction without adding safety — PM is already going to click Advance.

**Q4: HubSpot deal stage mapping — what stage maps to Nexus `accepted`?**

CA rec: **Needs Edward call.** Options:
- "Closed Won" (signals deal won; standard CRM convention)
- "Verbal Commitment" (signals acceptance but not final commitment; "Closed Won" reserved for post-Complete)
- "Decision Maker Bought-In" (HubSpot default stage; pre-Closed Won)

This is HubSpot CRM workflow context that requires Edward's call. Recommend banking the mapping in `firm_settings.hubspot_deal_stage_on_accept` (and `_on_complete`) for future flexibility.

**Q5: NetSuite SO status on creation — "Pending Fulfillment" or similar?**

CA rec: **Needs Edward call.** NetSuite SO has multiple status options on creation. Common defaults:
- "Pending Approval" (requires manual NetSuite approval before fulfillment)
- "Pending Fulfillment" (auto-approved, ready for ops to fulfill)
- "Pending Billing" (different flow)

This is NetSuite workflow context that requires Edward's call. Recommend `firm_settings.netsuite_so_status_on_create` for future flexibility.

**Q6: NetSuite SO push idempotency — how?**

CA rec: **Idempotency key = `nexus_quote_id` + `nexus_quote_version`.** NetSuite API accepts an external ID parameter that prevents duplicate creation. Retry with same external ID returns the existing SO instead of creating a new one. Quote version ensures the rare case of post-Complete admin-override-revision creates a new SO with a different external ID.

Alternative: time-based locking. Rejected because race conditions in distributed retry are real.

**Q7: Mark Accepted reversibility — UI surface?**

CA rec: **Explicit "Roll back to Send to Client" button on Mark Accepted sub-tab.** Visible after Advance has fired (i.e., quote is `accepted`). Clicking it:
- Confirms with PM
- Reverses HubSpot deal stage push (rolls back stage)
- Sets quote back to `sent` status
- Audit log captures rollback event with `diff_json.source = 'manual_rollback'`

Alternative: Implicit (PM goes back via navigation, system detects state mismatch). Rejected — explicit action with explicit confirmation is the canonical pattern for reversible-but-side-effecting transitions.

## 8. Pattern 30 deliverables

This slice has substantial UI work (4 sub-tabs, new Tier Selection UX, finalization warning, post-push confirmation). **CD design round required before kickoff.**

Pattern 30 deliverables expected:
- Sub-tab navigation IA (visual treatment of sub-tab strip, active/inactive/locked states)
- Preview Quote sub-tab refresh (existing PDF preview lifted into sub-tab context)
- Send to Client sub-tab UX (send action, post-send waiting state, snapshot history)
- Mark Accepted sub-tab UX (acceptance recording, HubSpot push state, rollback affordance)
- Tier Selection sub-tab UX (per-tier compliance summary, tier selection control, finalization warning preview)
- Advance action button treatment (varies per sub-tab — informational on early sub-tabs, weighted on Tier Selection)
- Finalization warning modal/dialog
- Post-push confirmation state (NetSuite SO ID display, link to NetSuite)
- Error states for HubSpot/NetSuite push failures
- Stacked / narrow-viewport variant (per Pattern 30 standard)

Unbundled prototype source files + designer notes + data-source map per standing Pattern 30 deliverable shape.

**Design round designation:** This is genuinely a new design round. Treat as **R7** (between R6.2 freight and the v1.1 R8 Operations IA). Naming: "Quote umbrella + finalization."

## 9. Open items / pending Edward dispositions

1. **Approve combined-slice scope** (no X/Y split) — Edward already disposed: yes.
2. **HubSpot deal stage mapping for `accepted` and `complete`** (Q4) — Edward call needed.
3. **NetSuite SO status on creation** (Q5) — Edward call needed.
4. **`firm_settings.hubspot_deal_stage_on_*` and `firm_settings.netsuite_so_status_on_create` as configurable values vs. hardcoded** — CA rec: configurable via firm_settings; Edward confirms.
5. **Pattern 41 disposition for Q1-Q3, Q6-Q7** above — CA recommendations stand; Edward confirms or overrides.
6. **CD design round (R7) scheduling** — when does R7 start? Cannot kick off CC impl until R7 ships Pattern 30 deliverables.
7. **Frame doc dependency** — frame doc (`docs/post-pricing-flow-ia-frame.md`) is upstream of this slice's design. Does CD R7 wait for frame doc lock, or run partially in parallel?

CA lean for #7: frame doc locks first (small artifact; CA drafts during Pricing reframe impl). R7 starts when frame doc is locked. Brief verification + Pattern 22 §0.5 verification happen after R7 ships and Edward dispositions Q1-Q7.

## 10. Connections to other slices

- **Pricing reframe v1 (item 4 on v1 path)** — must ship first. Pricing reframe surfaces per-tier compliance; Tier Selection sub-tab REUSES the per-tier compliance summary as read-only context. Pricing reframe's `pricing_events` telemetry table is independent (no interaction with this slice).
- **Leaf-detach micro-slice (item 5)** — must ship first or in parallel. Leaf-detach doesn't touch Quote surface; no direct interaction.
- **Slice 11 PDF customer-facing data bindings (item 6 — formerly 4)** — lands AFTER this slice. PDF lives in Preview Quote sub-tab; Slice 11 implements customer-facing data bindings against the restructured sub-tab IA. Slice 11 brief should reference this slice's Preview Quote structure.
- **Microsoft OAuth (item 7)** — no direct interaction; sequentially independent.
- **Pre-launch review (item 8)** — verifies this slice's HubSpot + NetSuite integration error handling, finalization warning copy, audit log coverage. Customer-facing render verification (Pattern 45) covers Preview Quote sub-tab.
- **Old Mark-Accepted writebacks slice (was item 9)** — **absorbed into this slice.** HubSpot push (Mark Accepted Advance) and NetSuite push (Tier Selection Advance) are now part of Quote umbrella scope.
- **Operations wrapper (post-v1)** — this slice produces the v1 lifecycle state foundation that Operations wrapper consumes. Audit log captures all state transitions; Operations wrapper reads them when built. No forward-compat schema commitment in v1 (lifecycle_events table is Operations slice scope).
- **Quote versioning (v1.5+ backlog)** — referenced in finalization warning ("rollbacks require admin approval"). v1.5+ versioning slice implements the rollback workflow; v1 just commits to the irreversibility model.

## 11. Sequencing within the slice

**Phase 1 — Design (R7 design round, CD-led):**

Step 1: Frame doc locks (CA work, upstream of R7).
Step 2: CD runs R7 design round per Pattern 30 standard. Pushbacks and dispositions per standing pushback workflow.
Step 3: R7 ships Pattern 30 deliverables (designer notes, data-source map, unbundled prototype source).
Step 4: Edward dispositions Q1-Q7 from §7 with CD's design context.

**Phase 2 — Brief verification:**

Step 5: Architect runs Pattern 22 §0.5 schema verification on the (then-finalized) brief, incorporating Q1-Q7 dispositions.
Step 6: Brief PR opens; brief lands on main per established precedent (matches autosave brief PR #31 pattern).

**Phase 3 — Implementation (CC, fresh impl branch from main):**

Step 7: Sub-tab IA + structural UI scaffolding (Preview, Send to Client, Mark Accepted, Tier Selection — all sub-tabs render; navigation works; Advance buttons present but no-op on early sub-tabs).
Step 8: State enum extension migration + `quote-guards.ts` updates for new states.
Step 9: New schema columns (`selected_tier_id`, `netsuite_so_id`, `netsuite_pushed_at`) migration.
Step 10: Preview Quote sub-tab implementation (lifts existing PDF preview into sub-tab context).
Step 11: Send to Client sub-tab implementation (send action, snapshot mechanism reuse, post-send waiting state).
Step 12: Mark Accepted sub-tab implementation (acceptance recording, HubSpot push integration, rollback affordance).
Step 13: Tier Selection sub-tab implementation (selection UX, finalization warning, NetSuite push integration, idempotency).
Step 14: Pricing "Send to customer" CTA → Quote > Preview Quote navigation update.
Step 15: Audit log integration for all state transitions.
Step 16: Pattern 47 verification on all new form inputs (Tier Selection radio/dropdown).
Step 17: Edward smoke pass.
Step 18: Audit findings disposition.
Step 19: Designer audit (CD reviews implementation against R7 deliverables).
Step 20: Architect verification at impl completion.
Step 21: PR to main.

## 12. Notes for CC at kickoff

1. **This is the largest single slice in v1 path.** Phase 2 + Phase 3 impl is probably 5-7 working days. Smoke discovery on integration paths (HubSpot, NetSuite) likely surfaces 2-4 days of follow-up. Plan accordingly.

2. **NetSuite API integration is new territory.** Slice 12 (Mark-Accepted writebacks) was originally going to introduce NetSuite. Now this slice does. NetSuite-specific patterns will get banked during impl — Architect's MEMORY.md captures them for future slices that touch NetSuite (Operations wrapper, reconciliation, etc.).

3. **HubSpot pattern reuse.** HubSpot integration already has read-path patterns (Slices 2-11 use `HUBSPOT_ACCESS_TOKEN`). Write-path uses `HUBSPOT_WRITE_ACCESS_TOKEN` per CLAUDE.md token model. This slice is the first heavy write-path use; rate limiting + error handling deserve careful attention.

4. **Idempotency is load-bearing.** NetSuite SO push retry logic must not create duplicate SOs. Use `nexus_quote_id` + `nexus_quote_version` as external ID. Test the retry path explicitly during smoke.

5. **Finalization warning copy** is user-facing and load-bearing. Per Q2 disposition, action-specific framing. Don't drift to generic "Are you sure?" during impl.

6. **Architect-active per slice.** Architect verifies at brief Pattern 22 §0.5 and again at impl completion. Pattern coverage check at impl includes Pattern 47 on the Tier Selection input, namespace discipline on any new server actions, schema convention on the migration.

7. **R7 design context dependency.** CC cannot kick off impl before R7 ships and Edward dispositions Q1-Q7. The slice has substantial design surface that's not yet specified.

8. **Slice 9.4b two-call preview pattern may apply** if any "what happens when I Advance?" preview affordance is in scope. Specifically: if finalization warning preview shows the NetSuite SO payload before commit, that's a two-call preview (suggest helper returns payload; computeQuoteCosting or equivalent recomputes preview state). Designer review will clarify whether preview is in scope.

9. **Pattern 30 deliverable check at R7 ship.** Verify unbundled prototype source, designer notes, data-source map per standing pattern. Pattern 30 deliverable confirmation is part of pre-kickoff readiness.

10. **Pre-launch review (item 8 on v1 path) covers this slice's customer-facing render** (Preview Quote sub-tab, PDF preview) at Pattern 45 verification time. Customer-view boundary guard pattern applies — no costing data leaks into Preview render.
