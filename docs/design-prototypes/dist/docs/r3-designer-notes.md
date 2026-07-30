# Round 3 — Designer notes

Three pushbacks, things I considered and rejected, and the feature commitments coming out of this round. Customer view + Mark-Accepted, per Option A from Round 2 sign-off.

---

## Round 3 close · what was accepted, what shifted

CD review accepted Pushbacks #2 and #3 in full and reframed #1. Three architectural commitments were locked. Three production-copy fixes were applied to strip CD scaffolding from the rendered surfaces.

**Architectural locks (cross-round commitments):**

1. **Sent-vs-draft mismatch UX (Pushback #2)** — locked as Slice 11 spec. The "v3 sent · v4 draft · accept locks against v3" surfacing is the load-bearing innovation of this round; prevents a real silent-data-corruption class of bug.
2. **Frozen Cost Build during pending approval (new commitment)** — locked as Slice 12 spec. The `pending` state freezes Cost Build edits to preserve the gate state @nina is approving against. Cancel-then-edit is the explicit path; tunes-mid-approval would let PM approve against a phantom.
3. **Boundary-guard as build-time invariant** — locked as cross-cutting architectural commitment. `<PdfPage>` and descendants import zero costing modules, enforced at build, not runtime. Failure mode: build error.

**Reframed:**

- **Pushback #1 — single-tier as PDF default** → reframed to **per-quote send-time choice**. CD's argued default (single-tier) was rejected on tier-tables-are-the-answer-not-leaky-disclosure grounds. CD's fallback (`pdf_layout: 'tier_table' | 'single_tier'`, default `tier_table`, PM picks) was promoted to the front. Both layouts ship.

**Production-copy fixes applied to the prototype:**

- **Schema field names stripped from override sidebar.** "Captures: `underpriced_override_user_id`, `underpriced_override_reason`, plus parallel pair for quote-level (Round 3 commitment)" → "Your reason and the approval thread are logged to the quote permanently. Anyone with quote access can see who overrode, when, and why." Same critique applies if it ever recurs: schema names live in designer notes only.
- **Rule-name codes softened in user-facing copy.** `BLENDED_BELOW_FLOOR (22.8% < 25%)` → "blended margin below floor (22.8% < 25%)". Same for the gate-summary line.
- **Prototype state-tabs labelled as such.** Mark-Accepted state-switcher prefixed "prototype state →"; customer-view state-tabs got a tooltip clarifying "production renders whichever state the data is in." Tabs themselves stay (they're how design review navigates) but their nature is now legible.
- **Send-to-customer scope clarified.** Two adjacent buttons resolved into "↓ Download PDF" (saves to Downloads) and "↳ Download + open mail draft" (saves to Downloads, opens mailto: in default mail client with quote attached). **No SMTP integration, no Gmail OAuth, no HubSpot send.** PM's email, PM's client. Captured in tooltips.

**New feature commitment surfaced by review:**

- **Send-time PDF layout choice (Slice 11 spec)** — `pdf_layout: 'tier_table' | 'single_tier'` parameter on the send action, default `tier_table`, PM picks per-quote at send time. Both layouts render from the same component tree (boundary guard applies to both). Snapshot captures which layout was sent.

---



### Pushback 1 · The PDF default is the *single recommended tier*, not the tier table

> **Pushback held — fallback promoted to the front per CD.** Send action takes a `pdf_layout: 'tier_table' | 'single_tier'` param, defaults to `tier_table`, PM picks per-quote at send time. Reasoning carried forward (CD): at DPS scale the customer is a human in a sales conversation, tier tables are the answer to "what do volumes look like?" not a leaky margin disclosure, and removing tier-pricing as default would introduce unwanted behavior change vs. today's Excel flow. But the single-tier mode is the right surface for the "customer confirmed volume, sending invoice-ready document" case. **Both layouts ship; PM picks at send.** Wired in the prototype as the `Send as: tier table | single tier` toggle next to the Send button.

**The brief assumed the PDF default would be the tier table** — show all four tiers, let the customer pick. That's the multi-tier Excel pattern, and it's what we've always done.

I'm pushing back. **The PDF default should be the recommended tier, single-price, with a "see all volume tiers" appendix.**

Reasoning:
- The tier table is a sales-internal artifact masquerading as a customer-facing one. PMs build tiers to negotiate ranges and stress-test margins, not because the customer wants a menu. Most customers are deciding between Yes and No on a specific quantity, not between four quantities.
- A single-price PDF is what the customer's procurement system expects. They paste one number into their PO. Four numbers is friction — they have to pick, then justify the pick.
- Tiered pricing leaks our negotiation hand. "Buy 4× more for 23% off" tells the customer how much margin we're willing to give up at scale.
- The tier table still exists — as an appendix the PM can include or omit per-quote. Default omitted; opt-in surfaced.

What survived the pushback: the tier table is still rendered in the preview (it's the right surface for PMs to inspect at send-time), and the recommended-tier flag still drives the customer-facing primary number. So the schema's unchanged, the surface story is what flipped.

**If this is rejected:** the customer-view component takes a `pdf_layout: 'single_tier' | 'tier_table'` prop, defaults to `tier_table`, and we revisit on Slice 17 user testing. Reversible either way.

---

### Pushback 2 · Sent-version pinning is a *first-class affordance*, not a hidden invariant

The brief treats Mark-Accepted as a button click against the current quote state. In practice, the PM has almost always edited the quote since they sent it — refining numbers for a future revision, exploring an adjacent scenario, mid-conversation tweaks.

If we lock against "current state," we lock against something the customer never saw. That's a quiet data-integrity bomb.

I'm pushing for: **the sent-vs-draft mismatch is surfaced inline on the Mark-Accepted screen, not deferred to a "are you sure?" modal.** The PM sees, before they click anything:
- "You sent v3 on Apr 28 · current draft is v4"
- The tier prices below reflect **v3** (the sent version)
- Mark-Accepted will lock against v3 and discard v4 (or save v4 as a sibling)
- Two actions — `View v3 (sent) preview` and `Compare v3 ↔ v4 changes`

Reasoning:
- Acceptance is the irreversible moment. Surface every meaningful disagreement *before* the click, not after.
- The PM's mental model is "I'm accepting the quote I sent." If the UI silently substitutes the draft, we've broken the model — even if the snapshot logic is technically correct.
- The Compare button gives the PM agency over what happens to v4 — discard outright vs. promote to sibling. Auto-drop-and-pretend-it-didn't-happen erodes trust in the system.

This is the rare case where I'm asking for *more* surface area, not less. The sent-vs-draft state is common enough (I'd bet >40% of acceptances) that hiding it is the wrong default.

**If this is rejected:** collapse the banner into a single "v3 will be locked, v4 saved as sibling — confirm" line in the AcceptConfirm modal. Loses the Compare affordance.

---

### Pushback 3 · The override surface belongs *next to* the disabled button, not in a separate modal

Round 2 already moved the gate enforcement earlier (Costing Sheet, not Mark-Accepted). Round 3 had a temptation: when the gate fires at Mark-Accepted, route the user to a modal-based override workflow. Modal pops up, form, submit, wait.

I'm pushing back on that pattern. **The override path is a sibling primary action, rendered next to the disabled Mark Accepted button.** No modal. No "click here to start the override flow." Just two CTAs side-by-side: `Mark accepted · blocked` (disabled) and `Request admin override` (active, warning-tone).

Reasoning:
- Modal-based override workflows hide the cost. Side-by-side rendering shows the PM exactly what's at stake — "you can't do A; B is your other option" in one glance.
- The PM is going to override 60–80% of the time when the gate fires (DPS reality, not aspiration — production realities and rush deals). Adding a modal step on the dominant path is friction for friction's sake.
- The "Lines requiring review" panel renders in-context, not in the modal. PM sees what's flagged, the rule, the deviation, and decides — fix the math vs. request override — without leaving the page.
- The "Two paths forward" cards (fix margin / request override) make the choice explicit at the bottom. They're decision aids, not action triggers — the actions are at the top.

The Slack-DM step still happens, just initiated by the inline primary, not by submitting a modal form.

**If this is rejected:** the override-request modal exists as a separate slice (12.1), and the inline primary opens it. Keeps the side-by-side rendering principle but adds a step.

---

## Things I considered and rejected

### Hosted customer-view URL (the v2 of Option A)
Option A from Round 2 was: PM-internal preview surface that becomes the PDF, no hosted customer view. I considered designing a hosted customer-view URL anyway — the kind that lets the customer click "Accept" and triggers Mark-Accepted with `accept_source: 'customer_link'`.

Rejected because:
- It re-opens every Round 2 question about auth, link-rot, telemetry, and "what does the customer actually do on the page besides click Accept" with zero new evidence that customers want it.
- Slice 17 user testing is the right place to find out. If real customer demand surfaces, it's a Round 5+ slice.
- Designing it speculatively now would constrain the Round 3 scope and likely produce a worse PM-internal surface (the two surfaces would compete for design budget).

### Inline diff view of v3 ↔ v4 (full implementation)
The Compare action on the sent-vs-draft banner is real but the surface it opens is a stub. I considered designing the diff view in Round 3.

Rejected because:
- The diff surface lives with audit-log work, which is its own slice. Designing it in Round 3 forks the scope.
- The Compare button can ship as a route to "audit log filtered to changes between v3 and v4" once the audit log lands. Until then, it can be a disabled button with a "ships with audit log" tooltip — the mental model is what matters, not the implementation.

### Customer-side "Accept" button in the PDF
PDFs can have form-fillable Accept buttons that submit back via mailto: or a URL. Considered as a low-cost path to a customer-side acceptance signal.

Rejected because:
- Mailto: in PDFs is unreliable across viewers (works in Acrobat, breaks in Preview, often blocked by enterprise email).
- A URL-based PDF Accept button is a hosted-customer-view in disguise. Same auth and telemetry questions as the rejected hosted-URL above.
- The current path — customer replies via email/Slack, PM clicks Mark Accepted — is the path DPS already uses. Don't fix what isn't broken.

### "Pending customer reply" interim state on the Mark-Accepted page
Considered adding a state between SENT and ACCEPTED that surfaces "we're waiting for the customer." Would show last-customer-touch, time-since-send, follow-up suggestions.

Rejected because:
- That belongs on the **Project view** (the PM's entry point), not on the Mark-Accepted screen. The Project page is where PMs ask "where is this deal" — Mark-Accepted is where they ask "did the customer say yes."
- Logged for Round 4 / Project-view rework. The Round 2 Project page already has a "next action" card that this would slot into.

### Per-tier acceptance (customer accepts T2 for some SKUs, T3 for others)
Considered as a flexibility play. Real procurement teams do split orders across volume tiers.

Rejected because:
- Split-tier acceptance is a different transaction model — it's two POs, not one. The schema supports it (each scenario can be its own snapshot) but the UI to compose a split-tier acceptance is a project of its own.
- DPS confirmed in the Round 2 close: split orders are handled today by sending two separate quotes. Don't redesign the workflow to accommodate the rare case.

---

## Feature commitments coming out of Round 3

These are the items where the design assumed something that needs to land in slices to ship:

1. **Quote snapshots on send** (FR-11 commitment, Round 3 scope) — every `sent` event writes a `quote_snapshots` row containing the full customer-view tree (vendor, customer, quote, tiers, skus.tier_prices, service_fees, freight_lines). The snapshot is the canonical record post-acceptance; every read on the LOCKED state goes through it.

2. **Sent-version pinning in Mark-Accepted action** (Slice 11) — the action takes `version_id` (always the sent version), not the current draft. Drafts created after send are saved as sibling scenarios with `status='dropped'`, `drop_reason='draft_at_accept'`.

3. **Quote-level warning override audit pair** (Slice 12) — `blended_below_floor_override_user_id` and `blended_below_floor_override_reason` as the quote-level analog to the existing line-level `underpriced_override_*` fields. Both pairs needed because both gates can fire independently.

4. **HubSpot writeback async confirmation** (Slice 12) — the LOCKED state shows "synced 2m ago" / "syncing…" / "sync failed · retry" based on `hubspot_writeback.status`. Async, not blocking. Failure is recoverable (retry button); success is auditable.

5. **Sibling auto-drop on accept** (Slice 11 contract) — `accept_source: 'manual_button'` triggers drop of all `status='active'` siblings on the same project, with `drop_reason='accept_sibling'` and `dropped_by_user_id` set. Auditable, reversible by admin.

6. **PDF render path** (Slice 11 / 17 boundary) — the customer-view component tree renders to PDF deterministically. Same component, two render targets (web preview + PDF). Round 3 designs the component; the PDF backend is its own slice.

7. **Snapshot-render path for LOCKED state** (FR-11) — the `View snapshot` and `Final PDF` actions on the LOCKED state render from `quote_snapshots.json`, not from live tables. Schema-versioned — if the customer-view shape changes, old snapshots still render against their captured shape.

8. **Boundary-guard build invariant** (cross-cutting, implementation-slice) — the build pipeline asserts that `<PdfPage>` and descendants import zero modules from the costing surface. Failure mode: build error, not runtime check. The visual notice on the preview ("Nothing below this line is in the customer's tree") is design rhetoric; the actual enforcement is structural.

9. **Send-time PDF layout choice** (Slice 11) — `pdf_layout: 'tier_table' | 'single_tier'` parameter on the send action, default `tier_table`, PM picks per-quote at send time. Both layouts render from the same component tree.

10. **Frozen Cost Build during pending approval** (Slice 12) — the `pending` Mark-Accepted state freezes Cost Build edits to preserve the gate state being approved against. Cancel-then-edit is the explicit path. Without this, PM tunes mid-approval and approver is approving a phantom.

11. **Send-event snapshot** (Slice 11 schema/action; pulled forward from spec section 10's v2 plan) — every `sent` event writes a `quote_snapshots` row capturing the customer-view tree (vendor, customer, quote, tiers, skus.tier_prices, service_fees, freight_lines, **plus pdf_layout**). Distinct from the accept-event snapshot. Two snapshots minimum per acceptance event. Promotes the inline `quotes.accepted_snapshot_json` column to the `quote_snapshots` table earlier than spec anticipated.

12. **`drop_reason` enum split** (Slice 11 contract) — two distinct drop reasons: `accept_sibling` (other active scenarios on the project, FR-9) and `draft_at_accept` (the draft of the accepted version itself, new behavior). Default read filter excludes `status='dropped'`; recovery affordance for "draft I lost at acceptance" deferred to Slice 13/16 read filter.

---

## Standing carries-forward (Round 2 → Round 3)

Still in force, no change:

- **NULL-as-empty-signal** survives the customer-view crossing. A NULL `tier_price` renders as "quote on request" — never `$0.00`, never `—` with a price treatment.
- **Internal-vs-customer visual grammar** is now build-time enforced (commitment #8 above), not just visual convention.
- **Helper text, not narration** — the customer view describes nothing; it prices.
- **Verdict-as-room-organizer** flips in this round: customer view's room is the unit-price tier table; Mark-Accepted's room is the blended-margin verdict (same component as Round 2 Costing Sheet).
- **Gate-enforcement-visible** (UX_BACKLOG #8) — Round 2 made the gate visible on Costing Sheet; Round 3 carries it forward as the disabled-Mark-Accepted button + sibling override primary, never a hidden affordance.

---

## What's queued for Round 4

Forward references in Round 3 surfaces that need landing slices:

- **Project-view rework** (post-acceptance) — what-happens-next list on LOCKED state references PO confirmation, production schedule emails, in-production stage on deal organizer. All Round 4 surfaces.
- **Email-reply parsing** — `accept_source: 'email_reply_parsed'` is reserved but not built. Round 4 or 5 — auto-parse "yes, T2 works" replies and pre-fill Mark-Accepted.
- **Audit-log diff surface** — the v3↔v4 Compare action stub-routes here. Lands with audit-log work.
- **Admin unlock workflow** — "Request unlock (admin)" on LOCKED state is the entry point for the rare reversal case. Round 4 or 5.
- **"Pending customer reply" interim state** — Project-view affordance, not Mark-Accepted.
