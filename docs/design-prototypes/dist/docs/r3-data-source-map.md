# Round 3 — Data-source map

Round 3 covers two surfaces: the **customer view** (PM-internal preview that becomes the PDF — Option A per Round 2 sign-off) and the **Mark-Accepted flow** (the gate that turns a sent quote into a locked, accepted record).

Every UI element below is traced to its source: **EXISTING** schema, a **named slice** (9.x, 11, 12, FR-11), the **UX_BACKLOG**, or **WISHFUL** (visual fiction the design assumes will be promoted).

Standing carries-forward from Round 2 (still in force):
- NULL-as-empty-signal (`tier_prices: [null, ...]` → "quote on request", never `$0.00`)
- Internal-vs-customer visual grammar (boundary guard fires if any internal token leaks across the line)
- Helper text, not narration
- Verdict-as-room-organizer (Mark-Accepted's "room" is the blended-margin verdict; the customer view's "room" is the unit-price tier table)

---

## A · Customer view (PDF-preview surface)

Three states cover the matrix: pure tier-pricing, pass-through freight + visible service fees, partial completeness.

### Page chrome (every state)

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| `Send as: tier table \| single tier` toggle | SLICE 11 | `quote.pdf_layout` (send-action param) | Per-quote choice at send. Default `tier_table`. Both layouts render from the same component tree; boundary guard applies to both. Snapshot captures which layout was sent. |
| `↓ Download PDF` | SLICE 11 | (action) | Generates PDF, saves to Downloads. PM attaches via their normal email client. |
| `↳ Download + open mail draft` | SLICE 11 | (action; mailto:) | Generates PDF, saves to Downloads, opens new draft in default mail client (mailto:) with quote attached. **No SMTP, no Gmail OAuth, no HubSpot send.** PM's email, PM's client. |

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Vendor block (Halcyon Goods · address · contact) | EXISTING | `vendor.{name, address, contact}` | Stable per project. |
| Customer block (Lumen & Co. · Priya Shah · address) | EXISTING | `customer.{name, contact, role, address}` | From HubSpot. |
| Quotation number (`HG-2418`) | EXISTING | `quote.quote_number` | Customer-facing friendly id. **Never** shows `version_number` or `scenario_label`. |
| Issued date | EXISTING | `quote.sent_date` | The send-date of the version being previewed. |
| Valid until | EXISTING | `quote.sent_date + 30d` | Derived. Confirm 30d default with Sales. |
| Payment terms · Lead time | EXISTING | `quote.{payment_terms, lead_time}` | Free text per quote. |
| Customer-facing notes | EXISTING | `quote.customer_facing_notes` | Distinct from internal notes — separate field. |
| Incoterms | EXISTING | `quote.incoterms` | String varies by `freight_treatment`. |
| Page-break markers (`page break · 1 of 2`) | WISHFUL | (preview-only chrome) | Preview-only annotation; not in PDF. |
| `PM-INTERNAL PREVIEW · THIS BECOMES THE PDF` callout | WISHFUL | (preview-only chrome) | Reminds PM the surface is non-interactive by intent. |
| Boundary-guard notice (top of preview) | BACKLOG | (build-time invariant) | The notice is design rhetoric; the **invariant** — that the `<PdfPage>` component tree imports zero costing primitives — is real and must be enforced in the implementation slice. |

### Pricing table (per-unit by tier)

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Per-SKU row (label, name, pack format) | EXISTING | `skus[i].{label, name, pack}` | Customer-visible subset only. |
| Retail benchmark (column) | UX_BACKLOG | `skus[i].retail_benchmark` | Optional per-SKU MSRP context. Hide column if all NULL. |
| Per-tier unit price | SLICE 9.1 / 9.2 | `skus[i].tier_prices[t]` (computed from `cost_inputs` + `markup_pct`, or `sell_price_override`) | Stays as-is unless overridden. |
| "quote on request" cell | EXISTING | `tier_prices[t] == null` | NULL-as-signal. **Never** renders `$0.00` or "—" with a price treatment. |
| Recommended-tier highlight (Tier 2 ring) | UX_BACKLOG | `costingByScenario.good.tier_summary[i].recommended` | Visual nod to PM's selected tier. Customer-facing copy stays neutral. |
| Tier quantity headers (10k / 25k / 50k / 100k) | EXISTING | `tiers[i].quantity` | |

### Charges block (one-time fees + pass-through freight)

Visible only when `service_fees` or `freight_lines` are non-empty (state B).

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Project-scope service fee row | EXISTING | `service_fees[i] where scope='project'` | One-time, per-project. |
| SKU-scope service fee row | EXISTING | `service_fees[i] where scope='sku'` | One-time, scoped to one SKU (e.g. mold tooling). |
| Pass-through freight line | EXISTING | `freight_lines[i].tier_amounts[recommendedTierIdx]` | Shown for the recommended tier only — "per-tier amounts available on request" is the escape hatch. |
| Charge-block subtitle ("Charges shown for Tier 2…") | UX_BACKLOG | (composed) | Tells the customer which tier the displayed charges apply to. |

### State-specific elements

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| State A: clean tier-pricing only (no charges block) | EXISTING | `freight_treatment='bundled'` AND `allocate_service_fees_to_cost=TRUE` | The cleanest customer-facing state — everything's in the unit price. |
| State B: pass-through freight + visible service fees | EXISTING | `freight_treatment='pass_through'` OR `allocate_service_fees_to_cost=FALSE` | Two settings, two visible-charge classes. |
| State C: partial completeness ("CAP-60 · T1 quote on request") | EXISTING | `tier_prices[0] == null` for one+ SKUs | Not an error state. The PM intentionally didn't price T1 for that SKU. |

---

## B · Mark-Accepted flow

Five visible states (GOOD, BOTH GATES, PENDING APPROVAL, LOCKED, plus the AcceptConfirm modal that bridges GOOD → LOCKED). Sent-vs-draft mismatch is its own affordance overlaid on GOOD.

### Verdict header (every state)

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Blended margin number (large) | SLICE 9.2 | `costingByScenario[s].blended_margin_pct` | Reused from Round 2 Costing Sheet — same number, same threshold logic. |
| Target / Floor caption | EXISTING | `costingByScenario[s].{target_pct, floor_pct}` | Per-quote settings; default project-wide. |
| Verdict label (`GOOD` / `BELOW FLOOR`) | SLICE 9.2 | derived from blended vs. floor/target | Not freeform — three values: GOOD, BELOW TARGET, BELOW FLOOR. |
| State-tab strip (GOOD · BOTH GATES · PENDING · LOCKED) | WISHFUL | (preview-only chrome) | Tweaks-panel state switcher. Not in production — production renders one state per quote. |

### State 1 · GOOD — tier selection + Mark Accepted

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| "Pick the tier on Lumen & Co.'s reply" prompt | SLICE 11 | (composed, references `customer.name`) | Frames the question — PM is recording what the customer chose, not picking a recommendation. |
| Sent-vs-draft mismatch banner (v3 sent, v4 draft) | UX_BACKLOG | `versions.{v3, v4}` | The PM has been editing v4 since v3 was sent. Mark-Accepted locks against **v3** (the sent version). v4 saved as a sibling, status `dropped`. |
| `View v3 (sent) preview` action | UX_BACKLOG | `versions.v3.snapshot_id` | Round 3 commitment: every sent version snapshots the customer-view tree at send time. |
| `Compare v3 ↔ v4 changes` action | UX_BACKLOG | (diff over snapshot json) | Diff surface lives with audit-log work. |
| Tier rows (radio-style) | EXISTING | `costingByScenario.good.tier_summary[i]` | Shows qty, unit_price, total, margin. Recommended tier pre-selected. |
| `Mark accepted · Tier N` primary button | SLICE 11 | (action) | Opens AcceptConfirmModal. |
| "Other active scenarios" rail | EXISTING | `sibling_scenarios` filter `status='active'` | Read-only here; auto-dropped on accept. |

### AcceptConfirm modal (GOOD → LOCKED bridge)

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| "What's about to happen" list | SLICE 11 + FR-11 | (composed from action contract) | Six bullets: status flip, captures, snapshot, sibling drop, HubSpot writeback, page lock. |
| Snapshot-write step | FR-11 | `quote_snapshots` table | Irreversible record. Snapshot is **the** canonical record post-acceptance. |
| Sibling auto-drop bullet | EXISTING | `sibling_scenarios` → status `dropped` | Auditable — `dropped_by`, `dropped_at`, `drop_reason='accept_sibling'`. |
| HubSpot writeback bullet | SLICE 12 | (deal stage → Closed-Won, amount → `tier.total`) | Async. UI shows "synced 2m ago" once complete. |
| Spinning lock state ("Locking quote…") | UX_BACKLOG | (transition UI) | Visible during the snapshot-write + writeback round-trip. |

### State 2 · BOTH GATES FIRING — quote-level + line-level blocks

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Margin verdict in `bad` treatment | SLICE 9.2 | `verdict='BELOW FLOOR'` | Same component as Round 2 Costing Sheet — verdict styling is shared. |
| `Mark accepted · blocked` (disabled primary) | SLICE 11 + SLICE 12 | (gate) | Disabled-button-with-reason — the gate is **visible**, not hidden. Carry-forward from Round 2 backlog item #8. |
| `Request admin override` (alternate primary) | SLICE 12 | (action) | Slack workflow — backlog item #11. |
| "Lines requiring review" panel | SLICE 9.2 | `costingByScenario.bothGates.flagged_lines[]` | Per-line firing rules. |
| Line-level rule label (`MARGIN_BELOW_FLOOR`) | EXISTING | `quote_warnings.rule` | Same rule namespace as Round 2 Costing Sheet. |
| Quote-level warning footer (`BLENDED_BELOW_FLOOR`) | EXISTING | `quote_warnings where scope='quote'` | Round 2 surfaced this on Costing Sheet; Round 3 carries it into Mark-Accepted as the second gate. |
| "Override workflow" (6-step list) | SLICE 12 | (composed from Slack workflow spec) | Documents the path: request → Slack DM → leadership reason → approval → audit log → unlock. |
| Override audit captures | SLICE 12 | `underpriced_override_user_id`, `underpriced_override_reason`, plus parallel `blended_below_floor_override_*` pair | Pair commitment — quote-level firings need their own audit fields, not piggybacking on line-level. **Round 3 commitment.** |
| "Two paths forward" cards (fix margin / request override) | UX_BACKLOG | (composed) | Decision aid — the gate doesn't dictate the path. |

### State 3 · PENDING APPROVAL

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Pending-approval banner | SLICE 12 | `override_request.status='pending'` | Shows requester, requested_at, awaiting approver. |
| Slack thread link | SLICE 12 | `override_request.slack_thread_url` | Cuts back to the conversation; doesn't reproduce it. |
| `Mark accepted · pending` (disabled) | SLICE 11 + SLICE 12 | (gate) | Same disabled treatment as State 2 — but reason is "awaiting approval" not "below floor". |

### State 4 · LOCKED (post-acceptance)

| UI element | Source | Field / slice | Note |
|---|---|---|---|
| Acceptance banner (date · tier · units · total · margin) | SLICE 11 | `quote_snapshots.{accepted_at, tier_id, total, margin_pct}` | Reads from snapshot, not live `cost_inputs`. |
| `HubSpot synced 2m ago` chip | SLICE 12 | `hubspot_writeback.{status, last_synced_at}` | Async writeback completion. |
| `⤓ Final PDF` action | SLICE 11 | (snapshot → PDF render) | Renders the snapshotted customer-view tree. |
| `View snapshot` action | FR-11 | `quote_snapshots.{id, json}` | Auditable — the canonical record. |
| Read-only treatment (full page) | SLICE 11 | `quote.scenario_status='accepted'` | All edit affordances disappear; sub-tabs render but are non-interactive. |
| Acceptance-audit table (accepted by, at, source) | SLICE 11 | `quote_snapshots.{accepted_by_user_id, accepted_at, accept_source}` | `accept_source` = `manual_button` here; `email_reply_parsed` is the v2 future. |
| "Other scenarios auto-dropped" summary | EXISTING | `sibling_scenarios` filter `status='dropped'` AND `drop_reason='accept_sibling'` | Forensically auditable — every drop is logged. |
| HubSpot writeback summary row | SLICE 12 | `hubspot_writeback.{deal_stage, amount, last_synced_at}` | Confirms what fired. |
| "If something's wrong · Request unlock (admin)" | UX_BACKLOG | (admin action) | Acceptance is locked but reversible by admin with reason; logged to audit. |
| What-happens-next list (PO, production schedule, in-production stage) | UX_BACKLOG | (downstream slices — Round 4) | Forward reference, not a Round 3 build. |

---

## Standing invariants (architectural, not per-element)

| Invariant | Where it bites |
|---|---|
| **Boundary-guard** — `<PdfPage>` and its descendants import zero modules from the costing surface. Any `markup_pct`, `cost_input`, `duty_pct`, `tariff_pct`, `CBM`, `version_number`, or `scenario_label` reaching that subtree is a build-time error. | Customer view (every state). Implementation-slice invariant. |
| **NULL-as-empty-signal** — A NULL `tier_price`, `cost_input`, or `freight_amount` renders as a domain-appropriate empty-state ("quote on request", "—" with no price treatment), never `$0.00` or `null`. | Customer view, Mark-Accepted tier rail, costing snapshot. |
| **Snapshot-as-canonical-record** — Once a quote is accepted, every read goes through `quote_snapshots`, never live `cost_inputs` / `markup_pct`. The snapshot's the receipt. | Locked state, Final PDF, audit-log views. |
| **Sent-version pinning** — Mark-Accepted always locks against the **sent** version, never the current draft. Drafts created after send are saved as sibling scenarios with status `dropped`. | Sent-vs-draft mismatch banner, AcceptConfirmModal copy. |
