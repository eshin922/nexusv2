# UX Backlog — Nexus Quoting

Feature commitments surfaced through Rounds 1–2 design work that don't have an
existing slice number. Logged here so they're not lost when Round 3+ volume
piles on. Each item: what, why, where it appeared in the design, where it
slots in build order.

CC paused. This is doc-only.

---

## 1. System-suggested GPA computation
**Slice:** 9.2 (committed)
**What:** When the user adjusts the global price adjustment on the Costing
Sheet, the system suggests the GPA value that lands the blended margin at
target (or, in BELOW FLOOR, lifts blended above floor). Surfaced as a
chip-and-Apply card in the verdict.
**Where designed:** Round 2 Costing Sheet, "System suggests +X%" row in the
right column of the verdict card.
**Why log it:** Originally flagged as wishful — promoted to committed in
Round 2 sign-off. Math lives in app code, not the schema.

## 2. Deep-link URL contract
**Slice:** Redesign-implementation, or 13.5 — pick the earlier
**What:** A documented URL shape that focuses one cell on Cost Build:
`/quote/:id/build?focus=:rowId:field`. Used by notification emails, audit-log
links, and Slack pings so PMs land on the exact cell they're being asked
about.
**Where designed:** "Demo · focus aluminum collar" button on Cost Build,
which scrolls + outlines the focused row and opens its supplier sub-panel.
**Why log it:** The whole "open Nexus, type, leave" thesis depends on this.
Without deep-links, the deep-link interaction-pattern doesn't exist.

## 3. Allocated-fee provenance
**Slice:** 13.5
**What:** When a production line cost is allocated from a setup fee
(`$5,250 setup ÷ 25k units = $0.21/u`), the source is logged structurally:
either an `allocation_source` field on `production_inputs` or a sibling
table that points back to the originating fee. The "÷ N units" caption on
Cost Build becomes data-backed, not display-only.
**Where designed:** Cost Build — Production cost-group rows show the
allocation math inline.
**Why log it:** Without provenance, "where did this $0.21 come from" is a
forensic question. With it, it's a click.

## 4. Multi-user presence layer
**Slice:** Redesign-implementation, or earlier if the design ships ahead
**What:** Per-quote presence channel, throttled to ~5s updates. Surfaced as
the "Live · X here" panel on Project view (avatar cluster) and per-section
presence chips on Cost Build (e.g. "Wei viewing freight · 4m"). Per-user
current-section indicator follows the user as they navigate.
**Where designed:** Project view top-right "Live" panel; Cost Build
section-headers showing who's currently in each cost group.
**Why log it:** Originally flagged as wishful — promoted to committed in
Round 2 sign-off. The data layer (presence channel + throttling + per-user
section indicator) is a real build, not just visual chrome.

## 5. Owner badges on cost groups
**Slice:** Existing schema (`owner_user_id` on cost_input rows), surface
work in redesign-implementation
**What:** Each cost-group section header on Cost Build shows the owning
user — Purchasing on packaging, Production on production fees, Logistics on
freight. Badge is read-affordance, not write — clarifies who fills it in
without changing edit-permission semantics.
**Where designed:** Cost Build section headers — "Owned · Wei · Purchasing"
caption.
**Why log it:** Schema already supports it; surface work just hadn't been
spec'd as a slice. Easy win.

## 6. Fresh-since-last-visit indicator
**Slice:** Read surface for the per-row case in cost change history; lives
with audit-log work
**What:** Diff dot on Cost Build rows that have been edited since the
current user last loaded the quote. Disappears on view. Aggregated form
("12 changes since you were last here · open log") is the project-page
read surface, deferred to Round 3+.
**Where designed:** Cost Build — small filled dots next to row identifiers
on rows touched after `last_visited_at`.
**Why log it:** Pairs with the audit log build. Don't ship one without the
other or the diff dot has nothing to point at.

## 7. ⌘K search / quick-jump
**Slice:** Cross-cutting, R3+ candidate
**What:** Keyboard-invoked search across SKUs, cost rows, and quotes.
Lands on a focused cell using the deep-link contract (#2). Replaces the
"scroll until you find it" interaction on long Cost Build screens.
**Where designed:** Implicit — referenced in Round 2 designer notes as the
keyboard counterpart to deep-link URLs. No surface yet.
**Why log it:** PMs who use Nexus daily will ask for this. Better to
acknowledge it now than discover it as a complaint.

## 8. Costing Sheet gate visibility
**Slice:** Already shipped in Round 2 Costing Sheet design; this entry just
names the principle so it survives implementation
**What:** The gate that prevents Mark Accepted (firm-floor margin) is
visible on the Costing Sheet — disabled button, admin-override path,
anchored review panel. Not deferred to the Mark Accepted moment.
**Where designed:** Costing Sheet BELOW FLOOR state, top of page.
**Why log it:** Per Pushback #2, the gate enforcement moved earlier in the
flow. Implementation must keep that semantic — a future "let's hide the
disabled button until they click Mark Accepted" optimization would
re-introduce the original problem.

## 9. Slice 9.3 reframe — per-cell escape hatch, not global mode
**Slice:** 9.3 (in progress, but reframed)
**What:** `sell_price_override` is a per-(SKU, tier) override, surfaced as
click-to-edit on each per-SKU breakdown card on the Costing Sheet. NOT a
page-level mode toggle. NULL = computed; non-NULL = overridden, badge
'OVR', revert affordance available.
**Where designed:** Costing Sheet per-SKU rows — sell-price field is a
button that opens an inline editor.
**Why log it:** Schema is unchanged; the surface story is what changed.
Document so a future "let's add a global edit mode" PR doesn't get merged.

## 10. Role-as-affordance principle
**Slice:** Cross-cutting design principle, no slice
**What:** Same Cost Build screen for PM / Purchasing / Production /
Logistics. Owned cost-groups stay editable; non-owned groups dim subtly
with a "read-only · viewing as Purchasing" caption. Single component tree
takes a `viewer` param — no per-role IA, no per-role route.
**Where designed:** Cost Build — visible by toggling viewer in the Tweaks
panel.
**Why log it:** Per Pushback #3, role differentiation is over-specified
for a 5–7 person team. Locking the principle prevents Round N+1 from
proposing per-role pages because "Purchasing's workflow is different."

## 11. Slack admin-override workflow
**Slice:** 12 (lock per Round 2 close)
**What:** When Costing Sheet is BELOW FLOOR and PM clicks "Request admin
override," a Slack DM goes to the configured approver (director or above —
e.g. `@nina (director)` or `@sales-leadership` channel). Approver
responds in Slack with approve/deny + written reason. Approval logs to
the quote's audit log with approver_user_id, reason, ts. Mark Accepted
unlocks for that quote until next material change.
**Where designed:** Costing Sheet BELOW FLOOR verdict card — "Admin
override path" sub-card explains the workflow inline.
**Why log it:** Promoted from "design intent" to "Slice 12 spec" at Round
2 close. Slack matches DPS's actual approval rhythm. Implements as the
real override workflow when Mark-Accepted writeback ships.

---

## Round 3 starts
**Scope:** Customer-facing quote view + Mark-Accepted flow.
**Constraint:** Option A — PM-internal preview surface that becomes the
PDF. No hosted customer-facing web surface in this round.
**Standing carries-forward:** NULL-as-empty-signal, internal-vs-customer
visual grammar, helper-text-not-narration, verdict-as-room-organizer
(flipped — customer view's room is the unit-price + tier table, not the
margin).
