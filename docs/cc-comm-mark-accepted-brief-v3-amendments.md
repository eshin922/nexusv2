# slice-mark-accepted-netsuite-so-push — Brief AMENDMENTS v3

**Brief baseline:** v1 (full brief) + v2 (Edward's 8 critiques)
**Amendment driver:** UI surface inventory + async mechanism — surfaced when CA verified existing scaffolding via codebase search
**Status:** Architecture approved (v1) + implementation gates locked (v2) + UI scope explicit (v3)
**Date:** 2026-06-16

This document amends v1 + v2. CC reads all three as the canonical brief set.

---

## §1 · Existing UI scaffolding inventory

Codebase search confirmed Slice RI.6 shipped visual stubs for the
Mark-Accepted flow. Scope was deliberately narrow (visual shell only;
console.log stubs) — real action wiring was always Slice 12 work.

### What exists today (extends in Slice 12)

#### `src/components/mark-accepted/accept-confirm-modal.tsx`

Two-step state machine: `confirm` → `locking`.

Current state:
- "This will:" bullet list mentions: status flip, sibling drop,
  HubSpot writeback ("deal stage → Closed-Won, amount → $X"), audit row
- Confirm button currently fires `setTimeout(1500ms)` then closes
  modal — pure visual stub
- "Locking quote…" spinner during the 1500ms delay
- Component header: *"Slice RI.6 — visual shell of AcceptConfirmModal.
  The Confirm button is wired to a console.log stub; real Mark-Accepted
  action contract (status flip, snapshot write, sibling drop, HubSpot
  writeback) lands in Slice 12."*

Slice 12 extensions:
- Add NetSuite SO push + production recipe freeze to "This will:" list
- Replace setTimeout stub with real `markQuoteAccepted` server action call
- Async progress wiring (see §3)
- Wire to two-status state model from v2 amendments
- Error surface for failure modes (per v2 amendments)

#### `src/components/mark-accepted/mark-accepted-locked.tsx`

Post-acceptance locked state component. Renders forward-projection
"What happens next" list:
- Generate PO confirmation (next-step action card)
- Production schedule emails out
- Project enters in-production stage (Round 4)

Includes "If something's wrong → Request unlock (admin)" affordance.

Slice 12 extensions:
- Replace forward-projection with actual current state surfaces
- Add SO ID display + link to NetSuite SO record (when `succeeded`)
- Add SO push status surfaces (all 6 states per v2 amendments)
- Add HubSpot stage status surface (all 6 states, separate from SO)
- Add production recipe link (read-only view; v1.1+ adds consumers)
- Keep "Request unlock" affordance unchanged

#### `src/components/mark-accepted/mark-accepted-host.tsx`

Host component with 5 sub-states (currently switcher-driven for prototype):
- `good`
- `awaitingMark`
- `bothGates` (gate failures)
- `pending` (admin approval pending)
- `locked`

Slice 12 considerations:
- The 5-sub-state switcher is prototype scaffolding. Production code
  doesn't use the switcher; routes to the appropriate sub-state based
  on actual quote state. Slice 12 wires real state inference.
- `locked` sub-state extends per `MarkAcceptedLocked` changes above
- New sub-state OR locked-sub-state extension for `pending` NetSuite/
  HubSpot push (in-flight states) — CC decides during Step 1

### Existing UI primitives reused (no new design needed)

Per codebase audit — these primitives already exist in `src/styles/`:

| Primitive | Source file | Existing use | Slice 12 use |
|---|---|---|---|
| `.pending-banner` | r3-shared.css | Round 3 pending-approval flow | In-flight push state |
| `.locked-ribbon` | r3-shared.css | Round 3 post-acceptance | Post-acceptance with SO ID |
| `.warn-band` (default) | r7b-primitives.css | Modal SKU duplicate-check | Soft warnings / informational |
| `.warn-band.bad` | r7b-primitives.css | Existing error variant | Failed-push retry surface |
| `.warn-band.accent` | r7b-primitives.css | Existing info variant | "Manual SO ID validated" confirmation |
| `.calc-display` | r7b-primitives.css | Modal margin read-only display | SO push status display |
| `.r7b-empty-state` | r7b-primitives.css | Empty-row contexts | "No NetSuite SO yet" pre-acceptance |
| Spinner pattern | refresh-header.tsx | HubSpot deal refresh button | In-flight async status |
| Pulse-dot | costs-header.tsx (stub) | Sync status indicator | NetSuite + HubSpot push status |

### What's net-new in Slice 12

Per the gap list — these need design + implementation:

1. **Two-status badge cluster** — render NetSuite + HubSpot push statuses side-by-side on Mark-Accepted-Locked surface (each can be in independent state per v2 amendments Critique #3)

2. **ManualSOIDEntryModal** — new modal for `netsuite_so_id_source = 'manual'` flow per v2 amendments Critique #4. Includes:
   - SO ID input field
   - Reason textarea
   - Validation status surface (spinner during RESTlet validate call)
   - Error register if SO not found / already bound to different quote

3. **RetryPushSurface** — banner-style component for `failed`/`retrying` states. Different surfaces for NetSuite vs HubSpot failures (since they're now independent per v2 amendments):
   - "SO push failed: {error_message}" with retry button + manual fallback CTA
   - "HubSpot stage advancement failed" with smaller affordance (lower-priority remediation)

4. **InflightProgressIndicator** — async progress visualization inside the modal during push. Visual register TBD with CD (Step 1 prototype):
   - Option A: pulse-dot + status text per leg ("HubSpot: pending · NetSuite: pending")
   - Option B: step-progression indicator ("1/3 freezing recipe · 2/3 pushing SO · 3/3 advancing stage")
   - Option C: spinner + cumulative status ("Locking quote…" copy preserved with sub-status detail)

5. **ProductionRecipeLink** — small affordance showing frozen recipe ID + timestamp. Read-only view of the snapshot. v1 scope: link surfaces; v1.1+ adds full recipe browser.

6. **AcceptedTierPickerModal** (mentioned in v1 brief §5; flagged here as net-new for completeness) — explicit tier picker before AcceptConfirmModal opens.

---

## §2 · Status state → visual register mapping

Per v2 amendments Critique #3, two independent enums. Visual register
per state below — these are CA-proposed; CD finalizes during Step 1
prototype.

### NetSuite SO push status

| State | Visual register | Copy |
|---|---|---|
| `not_pushed` | `.r7b-empty-state` register; em-dash placeholder | "—" / not rendered (pre-acceptance) |
| `pending` | `.pending-banner` register; pulse-dot active | "Pushing to NetSuite…" + relative timestamp |
| `succeeded` | `.calc-display.v` register; mono inline + ✓ glyph | "SO #SO2454 · {relative_timestamp}" with NetSuite link |
| `failed` | `.warn-band.bad` register; error glyph | "SO push failed: {error_message}" + Retry button + Manual fallback CTA |
| `retrying` | `.pending-banner` register + retry indicator | "Retrying push…" + spinner |
| `manual` | `.calc-display.v` register + `.warn-band.accent` adjacent | "SO #SO2454 (manual) · validated {relative_timestamp}" with NetSuite link + tooltip showing reason |

### HubSpot stage status

Lower visual priority than SO push (per v2 amendments — soft failure).

| State | Visual register | Copy |
|---|---|---|
| `not_advanced` | `.r7b-empty-state` register; em-dash | "—" / not rendered (pre-acceptance) |
| `pending` | Inline spinner + small text | "Advancing HubSpot stage…" |
| `succeeded` | Inline ✓ + small text | "HubSpot: Purchase Order ✓" |
| `failed` | `.warn-band` (default, not `.bad`) register | "HubSpot stage advance failed · Retry" (less urgent than SO push fail) |
| `retrying` | Inline spinner | "Retrying stage advance…" |
| `skipped` | `.calc-display.v.empty` register | "HubSpot stage: skipped (admin)" |

### Composition rules

- The two statuses render as **separate adjacent affordances**, not
  combined badges. PMs see independent status; can act independently.
- NetSuite SO status is the dominant affordance (larger, more visual
  weight) — it's the primary business-critical push
- HubSpot stage status is the secondary affordance (smaller, less
  urgent register) — soft failure per v2 amendments
- Both surfaces live within the `MarkAcceptedLocked` component
  structure (Slice 12 extension)

---

## §3 · Async progress mechanism

The 1500ms `setTimeout` stub in `accept-confirm-modal.tsx` has to be
replaced with real async progress. Three mechanisms considered:

### Mechanism A — Polling (CA lean for v1)

Modal stays open after `markQuoteAccepted` returns. Client polls
`/api/quote-acceptance-status?quote_id={uuid}` at 1s interval until
both `netsuite_so_push_status` AND `hubspot_stage_status` reach
terminal state (succeeded / failed / manual / skipped).

Pros:
- Simplest implementation; no new infrastructure
- Existing pattern in codebase (refresh-header.tsx polls HubSpot
  refresh similarly)
- Failure mode is trivial (poll times out → modal shows error)

Cons:
- 1s tick interval may feel sluggish to PMs (mitigation: aggressive
  polling first 5s, then back off to 2s)
- Server-side load if many concurrent acceptances (low concern at
  ~12-user scale)

### Mechanism B — Server-Sent Events (SSE)

Modal subscribes to `/api/quote-acceptance-stream?quote_id={uuid}`.
Server pushes status updates as they happen.

Pros:
- Instant feedback (no polling latency)
- Cleaner client code (subscription model)

Cons:
- Vercel functions don't support long-lived SSE connections well
  (max execution time)
- Edge runtime SSE has caveats with Drizzle/pgbouncer
- More moving parts; bigger Step 1 spec area

### Mechanism C — Webhooks + Redis pub/sub

NetSuite RESTlet posts back to a webhook; Nexus pushes update to
Redis; client subscribes via long-poll or SSE.

Pros:
- Real-time without polling
- Scalable

Cons:
- Heaviest infrastructure (Redis, webhook auth, additional services)
- Overkill for ~12-user internal tool
- Bank as v1.1+ if polling proves insufficient

### CA lean: **Mechanism A (polling)**

Aggressive polling (250ms first 3s, then 1s up to 60s, then 5s up to
5min, then surface "Push taking longer than expected — check back
soon"). Modal can be closed during pending state; status continues
to update on quote umbrella refresh.

Step 1 discovery: CC confirms Mechanism A fits production conventions
or proposes alternative. Bank Mechanism B/C as v1.1+ if real-time
ergonomics become a PM pain point.

### Implementation details

- New server endpoint: `GET /api/quote-acceptance-status/{quote_id}`
  - Returns `{ netsuite_so_push_status, hubspot_stage_status,
    netsuite_so_id, last_updated_at, errors }`
  - Permission-gated (only quote's PM or admin can read)
- Client-side polling hook (CA-proposed name: `useAcceptanceStatus`)
  - Lives in `src/components/mark-accepted/use-acceptance-status.ts`
  - Returns `{ status, isPolling, error }` to consumers
  - Backoff logic: 250ms × 12 → 1s × 60 → 5s × 60 → stop
- Modal behavior:
  - Stays open during pending
  - PM can close ("Continue working…") — status continues async; PM
    sees update on next quote umbrella visit
  - Auto-transitions to success state when both statuses terminal
  - Auto-transitions to error state when either failure surfaces

---

## §4 · CD coordination

Per Pattern 30 — multi-surface design work warrants CD prototype
delivery before CC implementation. Slice 12 hits this threshold:
4 modals + 2 surface extensions + status visual registers.

### CD Step 1 deliverables

Per Pattern 30 path-B-default convention:

1. **Prototype HTML + JSX modules** for:
   - Extended `AcceptConfirmModal` (with NetSuite + recipe lines)
   - New `AcceptedTierPickerModal`
   - New `ManualSOIDEntryModal`
   - Extended `MarkAcceptedLocked` with two-status cluster
   - InflightProgressIndicator visual treatment (Option A/B/C from §1.4)
   - RetryPushSurface for failed states

2. **Designer notes** documenting:
   - Visual register choices per state
   - Copy register for each status state
   - Inflight progress treatment decision (A vs B vs C)
   - Anchoring decision (within modal? On Locked component?)

3. **Data-source map** documenting which classifier/store fields
   each render element binds to

CD prototype delivery sequenced for Step 1 (parallel with CC §0.5
verification + Step 1 TBD resolution). CC waits for CD before Step 6
UI implementation begins.

### Specific CD decisions to surface

- **Inflight visual register** — Option A (parallel pulse-dots) vs
  Option B (step progression) vs Option C (preserved "Locking…"
  copy with sub-status detail). CA mild lean toward Option A
  (parallel statuses match the two-independent-leg architecture
  from v2 amendments). CD has final say.
- **Two-status cluster layout** — side-by-side vs stacked vs single
  composite affordance. CA lean: side-by-side with SO status
  visually dominant; CD finalizes.
- **Manual SO entry surface** — separate modal vs inline form on
  retry banner. CA lean: separate modal (matches existing modal
  conventions); CD decides.
- **Production recipe link visual treatment** — inline text link vs
  small badge vs drawer affordance. v1 is link-only (no recipe
  browser); CD picks placement.

---

## §5 · Cross-surface impact

Slice 12 UI work touches surfaces beyond Mark-Accepted host. Per
Pattern 34 candidate (multi-surface architectural features warrant
R-round design pass), confirming Slice 12 fits:

| Surface | Slice 12 impact |
|---|---|
| Quote umbrella Mark-Accepted sub-tab | Host extension (5 sub-states + locked extension) |
| Quote umbrella header | "Accepted · SO #SO2454" badge when applicable |
| Project view | Accepted quote rendering (post-acceptance terminal state) |
| Pricing surface | `frozen = true` quote → read-only render; "Accepted" banner |
| Costs surface | Same — frozen quote read-only |
| Setup surface | Same — frozen quote read-only |
| Audit drawer (cross-surface) | New audit actions: `quote_accepted`, `production_recipe_frozen`, `netsuite_so_pushed`, `netsuite_so_push_failed`, `hubspot_deal_stage_advanced`, `hubspot_deal_stage_advance_failed`, `netsuite_so_id_manually_set` |

Read-only render of frozen quotes on Pricing/Costs/Setup is critical
— PMs navigate to these surfaces post-acceptance and must see clear
"this quote is locked" state. CC verifies frozen-state rendering on
each surface during Step 6 implementation.

**Per Pattern 34 evaluation:** 6 surfaces touched. This IS a
multi-surface feature. CD prototype delivery is the design discipline
that prevents inconsistent treatment per surface.

---

## §6 · §0.5 verification additions

Extends v2 amendments §13 (already extends v1 §13). CC verifies before
implementation begins:

### UI-specific §0.5 verification

- [ ] Verify existing `accept-confirm-modal.tsx` two-step state machine
      cleanly extends to async progress wiring (or identify refactor cost)
- [ ] Verify `MarkAcceptedHost` 5-sub-state pattern accommodates new
      "accepting" in-flight sub-state (or extension model)
- [ ] Verify `MarkAcceptedLocked` component structure supports two-status
      cluster without architectural rewrite
- [ ] Verify `.r7b-*` primitives are sufficient for new error/manual states
      (no new CSS primitive needed)
- [ ] Verify `r3-shared.css` `.pending-banner` + `.locked-ribbon` work
      in modal context (Round 3 origin was page-level)
- [ ] Verify frozen-quote read-only rendering paths on Pricing/Costs/Setup
      — Slice 12 doesn't break existing render when `frozen = true` first
      lands as a column
- [ ] Verify async progress polling endpoint convention in codebase
      (or `import/refresh-header.tsx` pattern is the canonical reference)
- [ ] Verify CD has bandwidth for Step 1 prototype delivery (timeline
      coordination — CD parallel workstream)

---

## §7 · Updated Step 1 TBDs

Extends v1 §12 and v2 §9. Slice 12 implementation blocked until:

| # | Gate | Owner | Resolution |
|---|---|---|---|
| 1 | Identity mapping payload | CC + Aisha + Edward | Step 1 |
| 2 | RESTlet contract specifics | CC + Aisha + Edward | Step 1 |
| 3 | Idempotency mechanism | CC + Aisha + Edward | Step 1 |
| 4 | Sandbox validation phase | Edward + Aisha | Step 1 |
| **5** | **CD prototype delivery (Pattern 30)** | **CD** | **Step 1** |
| **6** | **Async progress mechanism confirmation** | **CC** | **Step 1** |

Plus non-blocking Step 1 TBDs (from v1 + v2):
- Complete OTC-* SKU enumeration
- Existing PO-creation trigger sunset coordination
- HubSpot "Purchase Order" stage internal ID
- Permission gating model
- Confirmation modal copy

---

## §8 · Summary of changes (v3)

| # | Amendment | Brief impact |
|---|---|---|
| 1 | UI surface inventory | §1 NEW — extends vs new components |
| 2 | Status-to-register mapping | §2 NEW — per-state visual decisions |
| 3 | Async progress mechanism (polling vs SSE vs Redis) | §3 NEW — CA lean: polling for v1 |
| 4 | CD prototype delivery (Pattern 30) | §4 NEW — Step 1 deliverable lock |
| 5 | Cross-surface impact (Pattern 34 eval) | §5 NEW — 6 surfaces affected |
| 6 | §0.5 UI verification additions | §6 — extends v2 §13 |
| 7 | Step 1 TBDs (+2 gates) | §7 — CD prototype + async mechanism |

### Net effect

v1 brief defined architecture + state machine + server actions.
v2 amendments locked identity mapping + idempotency + sandbox gate.
v3 amendments lock UI scope + design discipline + async mechanism.

**Slice 12 implementation blocked until Step 1 closes 6 gates**
(v2's 4 + v3's 2). Three of the new gates (RESTlet contract, sandbox
validation, CD prototype) are parallel workstreams — Step 1 should
sequence them to avoid serial blocking.

---

## §9 · Recommended Step 1 sequence

CC iterates; CA proposes:

1. **Parallel kickoff (Day 0):**
   - CC: §0.5 verification + identity mapping spec
   - Edward + Aisha: sandbox environment + RESTlet contract initial draft
   - CD: prototype kickoff against v1+v2+v3 brief set

2. **Mid-Step 1 (Day 2-3):**
   - CC: §0.5 findings dispositioned → CA + Edward
   - Edward + Aisha: RESTlet first iteration ready for review
   - CD: prototype HTML + JSX modules first pass

3. **Late Step 1 (Day 4-5):**
   - Edward + Aisha: RESTlet contract locked
   - CD: prototype delivery finalized + designer notes + data-source map
   - CC: async mechanism (Mechanism A polling) implementation spec
   - Edward + DPS NetSuite admin: OTC-* SKUs enumerated + created in sandbox

4. **Step 1 close (Day 6-7):**
   - Sandbox validation phase begins (SV-1 through SV-13)
   - All 6 gates closed
   - Edward + Aisha sign-off documented
   - Step 2 (schema migration) authorized

---

**Standing by for PR #54 merge → Slice 12 Step 1 kickoff.**

CC reads v1 brief + v2 amendments + v3 amendments. Step 1 sequencing
per §9 (above) or CC's own iteration. All three docs constitute the
canonical brief set.
