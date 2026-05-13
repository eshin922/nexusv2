# Round 7a — Designer notes (Navigation IA)

The audit landed five structural findings (F-5 structural, F-8, F-11, F-13, plus action-cluster grammar pulled out of F-5). The CD R7 ask wrapped them into five items (a)–(e). What follows is the design, the reasoning, and the pushbacks worth flagging before RI.9 wires them up.

## The load-bearing rule: one IA signal per surface

Rule (d) — breadcrumb standardization — wasn't decidable until rule (b) — rail visibility — was decided. They're a paired decision. Treating them as independent is what makes the R6 omission feel like an inconsistency in the first place.

**Rule:** every quote-scoped surface has exactly one IA signal — either the inner rail is visible OR a breadcrumb appears. Never both, never neither.

That single rule resolves the friction:

| Surface | Rail visible? | Breadcrumb? | Rationale |
|---|---|---|---|
| Setup | yes | no | Working surface. Rail is the where-am-I anchor. |
| Cost build | yes | no | R6's deliberate omission is now load-bearing across the IA. |
| Costing sheet | yes | no | Working surface. |
| Customer view | **no** | **yes** | Print-preview metaphor — chrome melts. Breadcrumb (in `.r2-eyebrow` register) compensates. |
| Mark-Accepted | yes | no | Confirmation workflow with sub-states; rail anchors. |

The structural elegance: the rail-visibility decision (which has its own metaphor-driven logic) drives the breadcrumb decision. You can't pick the breadcrumb register without first picking which surfaces shed.

## Home re-entry: surface, not project

F-8 was framed as "resume last quote." The actual unit a PM cares about is **the surface they last touched on that quote**. A PM who closed the tab while in Cost build doesn't want to land back on the Project page — that's where they were two clicks ago.

Round 4's Home was designed around the "What's my move" inbox (cross-project triage). R7a adds a **Resume** card next to it. They aren't competing — they're complementary:

- **Resume** answers "continue what I was doing"
- **Inbox** answers "what should I work on first today"

Same surface, two columns. The Resume card carries the last-edit timestamp and the last change (e.g., "Verre Pacific dropper $0.42 → $0.38") so a returning PM has immediate context for why they were there.

## Rail visibility follows surface metaphor

F-11 was an honest question and the answer is honest too: not every quote-scoped surface needs the rail. Two metaphors are in play:

- **Working surfaces** (Setup, Cost build, Costing) — the rail is the workflow anchor. PM is moving between scenarios, between surfaces of the same scenario, between projects via outer rail. Rail visible.
- **Print-preview surface** (Customer view) — the metaphor is "this is the artifact you're sending." Chrome should melt. The PdfPage already does this visually; shedding the rail completes the metaphor.
- **Confirmation surface** (Mark-Accepted) — multiple sub-states, override workflows, sibling-drop confirmation. Rail anchors PM during a high-stakes flow with steps that can branch.

Customer view sheds; Mark-Accepted keeps. Setup / Cost build / Costing keep.

## Per-surface next-move + Home inbox

F-13 was "no forward-pointing affordance after PM sends a quote." The fix is both:

- **Per-surface next-move.** Every working surface has a single forward affordance in its page-head action cluster (Setup → Cost build → Costing → Customer view → Mark-Accepted). Terminal surfaces (Mark-Accepted post-acceptance) carry an explicit "terminal — no forward affordance" note rather than fading the slot.
- **Home inbox** stays the cross-project landing. Each inbox row carries a `Next move` jump to the specific surface where the next decision happens.

The two don't compete because they answer different questions. The per-surface affordance is **in-flow** (what's next in this quote). The inbox is **out-of-flow** (what's next across my book of business).

## Action cluster grammar: direction is the grammar

F-5 surfaced this as an aside but Edward's RI.8 step 0 smoke confirmed it's a real problem. The Costing Sheet header today has Preview / Customer-accept / Mark-Accepted side-by-side with no signal that customer-accept is a workflow prereq for Mark-Accepted.

**Rule:** primary action on the right; secondary actions in the middle; back-direction affordances on the left of a vertical divider. The visual direction matches the workflow direction.

Applied across the five surfaces:

| Surface | Right (primary) | Middle (secondary) | Left of divider (back) |
|---|---|---|---|
| Setup | Save draft | + New scenario | — |
| Cost build | Save draft | View as customer, + New version | — |
| Costing | Mark Accepted *(gated)* | Customer accepted (manual) | — |
| Customer view | Send to customer | ↓ Download PDF, Edit notes | — |
| Mark-Accepted | Confirm acceptance *(gated)* | Request admin override | ← Resume Cost build |

Customer-accept on Costing sheet is **secondary**, not primary — it's the prerequisite signal (PM records the customer's verbal yes) but Mark-Accepted is the load-bearing action. The visual hierarchy now matches.

The disabled-primary pattern from R3 carries forward: when Mark-Accepted is gated, the button is disabled but visible, and the `title` carries the reason ("Below floor — admin override required"). The override-request affordance lives in the secondary slot, where it belongs as the path that unblocks the gated primary.

### Canon refinement — RI.9 step 10 smoke

`Preview` was originally included in Costing's secondary cluster. Edward's smoke caught the redundancy with the banner default CTA (`Preview quote PDF →`): both routed to Customer view, both were forward-pointing. The §5 placement canon below — "Forward next-moves live in the YOUR NEXT MOVE banner. Surface-state actions live in the page-head action cluster." — resolves the redundancy in the banner's favor.

`Preview` therefore drops from the Costing secondary cluster. Costing secondary = `Customer accepted (manual)` only. The banner remains the single forward affordance on the surface. The same rule applies anywhere a cluster button and a banner CTA target the same surface — banner wins; cluster reserves itself for state-changing or sideways affordances.

## Three pushbacks for CD

**Pushback 1 · "Resume" might compete with "What's my move" more than I'm claiming.**

The two cards sit side-by-side on Home. A PM in the morning could read either first. If the inbox surfaces a `now` urgency item from a different project than the Resume card, the PM has to choose between "where I left off" and "what's most urgent across everything." I think the right behavior is `now`-tier inbox items dominate (they're flagged BAD), but Resume wins for `today`-tier and below. RI.9 should land that rule explicitly rather than letting visual prominence dictate.

**Pushback 2 · The rail-shed decision for Customer view assumes PDF is the only metaphor.**

Customer view is also where the PM presses Send. That's a workflow action, not a print-preview action. If a PM wants to undo/redo a customer-facing notes edit before sending, the rail's "Setup" link is the path back. Shedding the rail makes that path one breadcrumb-click instead of zero. I think it's still right — the metaphor wins — but the breadcrumb has to be in `.r2-eyebrow` register, not buried in chrome.

**Pushback 3 · Action cluster direction grammar may not survive long button labels.**

"← Resume Cost build" is a back-direction affordance with explicit forward-direction language. The arrow says one thing, the verb another. If we end up with a button like "← Resume override flow" the grammar starts feeling like ceremony. RI.9 should pick a tighter convention for back-direction labels — maybe `← Cost build` (just the destination, leading arrow) rather than verb-laden.

## Considered and rejected

**Rejected: a global breadcrumb component on every surface.** Standardization for its own sake. The whole point of one-IA-signal-per-surface is that the rail and breadcrumb are alternative affordances, not partners. Putting both everywhere is the legacy state — that's what we're fixing.

**Rejected: shed the rail on Mark-Accepted too.** Tempting because it's a confirmation flow. But Mark-Accepted has real sub-states (request override → pending → confirm-or-cancel) and the PM can be interrupted mid-flow. The rail keeps the project context anchored so they can navigate out and back without losing where they were.

**Rejected: a tabs-style next-move affordance.** Considered putting Setup / Cost build / Costing as a horizontal tab strip across the top of each surface. That's what the inner rail already is, rotated. The rail does it better because it carries scenario state (margin pill, draft-after-send count) alongside surface state.

## One feature commitment for RI.9

**Resume-card recency persistence.** The Resume card's "what did I last touch" needs server-side state — currently the only place that's tracked is via `audit_log` (which is per-action, not per-surface-visit). RI.9 wires a lightweight `user_surface_visits` write on every quote-scoped page-load. Granularity: per (user, project, scenario, surface) tuple, last 5 entries. Small slice; unlocks the Resume card.

---

## Canon (post-CA review)

Five things to lock explicitly so RI.9 builds against the same vocabulary CD designed against.

### 1. Eyebrow vs Breadcrumb

Two registers, same visual token (`.r2-eyebrow`), different semantic component.

- **Eyebrow** — always present, never navigable. Answers "what is this?" Examples: `Lumen & Co. · Primary · v3`, `Admin · Audit log`. It's a label, not a path. Separators are `·`.
- **Breadcrumb** — conditional on rail-shed; navigable. Answers "where am I in the IA?" Renders only when the inner rail is shed (Customer view). Separators are `›` (right-pointing chevron, signaling traversal).

Rule: `<Breadcrumb when rail.shed /> ⊕ <Eyebrow otherwise>`. Never both on the same surface.

### 2. YOUR NEXT MOVE banner — three states

Structurally always present (consistent vertical rhythm); visually adaptive:

- **Default · prominent** — accent-bordered, CTA right. The in-flow forward affordance. Every working surface gets this.
- **Gated** — same prominence, but the CTA carries the *resolution path*, not the canonical next-move. On Costing-sheet-below-floor: "Resolve override before sending →" not "Preview Quote PDF →". Encoded as `surfaceMeta.next_move.gated_label` falling back to `.label`.
- **Terminal · muted** — Mark-Accepted post-acceptance. Same banner shell, neutral border, no CTA. Text reads "Terminal surface — return via Home or rail." Explicit silence rather than missing affordance.

### 3. Outer rail vs inner rail — hybrid state on Customer view

The Customer-view shed-rail rule is **inner-rail-only**. The outer rail stays.

- **Outer rail** = workspace nav. Always present across all quote-scoped surfaces. Cross-project hop is a workspace operation.
- **Inner rail** = within-project nav. Sheds on Customer view because the metaphor is artifact-not-workspace. Inner rail belongs to the PM's worldview; sheds for the customer's preview.

Hybrid: workspace chrome outside, artifact chrome inside. That's the design, not an oversight.

### 4. Two affordances worth canonizing explicitly

Both surfaced during R7a build and need their place in the rule table.

- **"View as customer"** — secondary action on the Cost-build cluster. In-flow check: "does this still read right after my last cost change?" Pre-send. Routes to Customer view; back via breadcrumb. **Not** a forward affordance — it's a sideways glance. Doesn't replace the banner's `Review Costing →`.
- **"Customer accepted (manual)"** — secondary action on the Costing-sheet cluster. The **prerequisite signal** for Mark-Accepted: PM records that the customer verbally said yes. NOT the same as Mark-Accepted itself (which writes the snapshot). On Costing sheet because that's where the PM is when the customer's reply lands. Flips quote into `customer_accepted: true`; unlocks the Mark-Accepted primary downstream. Two-step deliberately — recording the signal and locking the acceptance are different events.

### 5. Canonical placement rule

> **Forward next-moves live in the YOUR NEXT MOVE banner. Surface-state actions live in the page-head action cluster.**

The banner is forward-pointing; the cluster is surface-state-pointing. The test when they look similar — `Send to customer` vs `Preview Quote PDF →`:

> After this action, am I on a different surface? If yes → banner. If no (or same surface, different state) → cluster.

**Caveat:** back-direction affordances in the cluster (e.g., `← Resume Cost build` on Mark-Accepted) are surface-state operations, not forward next-moves. They escape a gated state. They stay in the cluster, left of the divider.
