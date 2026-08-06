# Costs Certification — status and handover

**As of 2026-08-06.** Live working state, not a historical record. Update it in
place; do not append session logs.

Costs is certified only when BOTH hold:

1. **Functional Certification** — calculations and business plumbing correct.
2. **Operational Certification** — the workspace behaves as a production-grade
   operator tool.

Neither is complete. Functional is open on one blocker; Operational has not
started and is correctly blocked behind Functional.

---

## 1 · Current state

| Item | State |
|---|---|
| Tier propagation | **PASSED** |
| Freight Type enum contract | **PASSED** |
| Tier ordering | Correction built, deployed, unit-proven — **browser proof pending** |
| Field calculation freshness | **OPEN · release-blocking** — instrumented, reproduction NOT run |
| Costs responsiveness / lag | **OPEN · release-blocking** — confirmed defect, cause unproven |
| PR #183 coalescing effectiveness | **NOT PROVEN** |
| Costs Functional Certification | **OPEN** |
| Costs Operational Certification | **NOT STARTED** |

Held, not abandoned: the nine-action responsiveness audit, PR #182
(`fix/setup-costs-inheritance`, Validation 3), PR #183, PR-F (#180),
publication `0036`, Phase 3.

**Do not** begin the nine-action audit or implement an optimistic Freight model
until the freshness reproduction yields a root-cause classification.

---

## 2 · Immediate resume point

Everything is staged. No rebuild required.

- **Branch** `certify/costs-operational` @ `8c31051` (pushed)
- **Deployment** `nexusv2-wl66dgpsg-eshin922s-projects.vercel.app` — READY,
  SHA-verified against local HEAD, signed in
- **Quote under test** `52bd0077-20af-4345-8856-45003bfca8b3`
  (project `71ced625-2b64-4887-925a-a524e038ce30`) — the Validation 2 evidence
  artifact, preserved deliberately
- Tiers 1-3 carry quantities (1,000 / 5,000 / 10,000). **Tier 4 has none and
  correctly renders `—`** — do not report that as staleness.

### Governed fixture must stay unchanged

`2f29af72-805b-446c-866c-73e9b0991b1a`. Re-verify these digests after any run:

| Slice | Digest |
|---|---|
| quote | `2905b287e4be07ac76a4d77b1913cdf3` |
| tiers | `8531e9c59e3dc36c17188b3e0e371c95` |
| breaks | `4935793b4851b6694db4557af9fd0748` |
| packaging | `aae4b5a05b36ddb600a05eb974d80cfe` |

---

## 3 · The pending reproduction (stale calculations)

Run order: **Packaging markup (store-backed control) → Freight amount →
Freight markup → Duty → Tariff.**

Produce ONE joined timeline per action: client submit revision + value; server
received; normalized; persisted + commit revision; authoritative worksheet
read; calculation inputs; calculation outputs; bundle authority + returned
values; reconciliation revision applied; final value visibly rendered.

**Join on the post-commit revision** the action now returns. The write and the
RSC read are separate requests, so the chain is two hops:
`traceId → commitRevision → rendered value`.

### Collection

- `[costs-trace]` — one JSON line per point, Vercel function logs
- `[costs-timing]` — spans + reconciliation cycles (armed / re-armed /
  superseded / applied), browser console

### Known instrumentation gap — label it, never infer it

Duty and Tariff write through `updateFreightCustomsBreak`, which is **not**
instrumented for points 2 / 2b / 3. Substitute a direct post-write DB read
stamped with `now()` and `pg_snapshot_xmax(pg_current_snapshot())`, place it in
the timeline by that stamp, and mark the three missing points NOT INSTRUMENTED.

### Flag explicitly

- revision moves backward
- authoritative loader reads older than the commit
- `calc input` differs from `worksheet read`
- calculation output correct but bundle or UI stale
- any previously valid Freight / Duty / Tariff / Cost Stack value that
  temporarily disappears during the sequence

### Final boundary

**Confirm the rendered revision and value in the DOM.** Network completion is
not operator-visible completion. Browser-reported request status has already
been wrong once here — see §6.

### Classify each path independently

calculation trigger failure · stale calculation input · stale authoritative
read · stale reconciliation snapshot · stale client render · correct but
operationally delayed. Dual classification is allowed: a functional blocker and
an operational blocker are not mutually exclusive.

---

## 4 · Standing hypothesis (static evidence only — NOT proven)

The bridge is present: `loadWorksheetFreightForQuote` (`costing.ts:369`) feeds
`freightShipmentBreaks` into the bundle, and `costing.ts:1237` sets
`worksheetIsAuthoritative`, shadowing the legacy leg model.

What the static trace does surface is a **split refresh path**:

| Surface | Source | Refresh | Gating |
|---|---|---|---|
| Worksheet cells, Freight per-unit | `freightWorkbook` **RSC prop** | `router.refresh()` | 400ms coalesce + full RSC render (measured 1-3s) |
| Cost Stack, Sell, margin | Zustand **store** | `scheduleReconcile` | 800ms wait-for-quiet + revision guard |

`grep freightShipmentBreaks src/lib/costing-store.ts` returns nothing. The
store carries `freightLegGroups / freightLegs / freightLegTiers` — the legacy
model that worksheet rows shadow. So the store holds inert legacy freight state
and lacks the authoritative worksheet inputs.

**Hypothesis:** a Freight edit cannot produce an optimistic recompute because
the client has no inputs to recompute from. Packaging moves the Cost Stack on
the next frame; Freight cannot move it until a full server round-trip
reconciles. Consistent with Pattern 41, which already names
`freight-drilldown.tsx` as an unfixed instance.

**This remains a hypothesis.** Do not build against it. The reproduction exists
to confirm or refute it.

---

## 5 · Branch map

| Branch | Head | Contents |
|---|---|---|
| `certify/costs-operational` | `8c31051` | Integration target — all five corrections + instrumentation + trace |
| `fix/costs-reconciliation-ordering` | `231967e` | Reconciliation ordering + causal revision authority (Validation 1 PASS) |
| `fix/freight-shipment-membership` | `461d2b2` | PR #183 — membership, Pattern 47f, coalescing |
| `fix/freight-mode-enum-contract` | `9f24145` | Enum contract (certified) |
| `fix/tier-freight-break-propagation` | `7972abf` | Tier propagation (certified) |
| `fix/freight-tier-ordering` | `fac311e` | Tier ordering (browser proof pending) |
| `validate/tier-freight-break-propagation` | `3f61a97` | Throwaway validation composite |
| `chore/costs-timing-instrumentation` | `1300be9` | Shared timing helper |
| `fix/setup-costs-inheritance` | `e0f30da` | PR #182 — Validation 3, not started |

One merge conflict was resolved in `freight-drilldown.tsx`: PR #183's
action-scoped pending vs the enum + ordering changes, both rewriting the same
lines. **Both** were kept — `busy(...)` / `submit(action, key)` scoping retained,
`cells.map` alignment applied on top. Invariants: `rows.map(` count is 0,
`busy(` count preserved.

Untracked on purpose: `q-validation.mjs` (scratch query helper, git-excluded)
and `tests/e2e/costing/costs-reconciliation-ordering.spec.ts` (belongs to its
owning branch; amended out of two commits already).

---

## 6 · Traps that have already cost time here

**Browser-reported 503s are unreliable.** Captures showed 503 for a POST that
demonstrably committed, with zero server-side errors in the Vercel logs.
Superseded / cancelled RSC requests are misclassified. Correlate with function
logs before treating any 503 as a signal.

**The `find` tool mislabels table columns.** It reported markup fields as
"Tier 1" twice and contaminated two validation runs. Establish column identity
from the DOM `aria-label` (now `Freight type · Tier N`) or from the database —
never from the tool's guess.

**Every preview deployment is a new origin,** so the Clerk session does not
carry and sign-in is required per deployment. Claude cannot enter credentials;
the operator must sign in.

**`form_input` does not fire blur.** Number and text inputs commit on blur, so
set the value then click the field and press Tab. `<select>` commits on change
and needs no blur.

**Do not run `npm run build` while `npm run dev` is live** — corrupts `.next`.

---

## 7 · Findings logged, not yet actioned

- **Presentation** — the destination summary chip renders an unset mode as
  `not set` after the ordering fix; verify in browser proof.
- **Documentation** — `freight-break-write.ts` prose corrected: flat mode
  governs commercial terms (amount **and** markup); operational identity (mode,
  description) never follows it. Behaviour unchanged; the prose was wrong.
- **Silent cost loss on Setup deletion** — open governance defect, untouched.
- **Scroll / context preservation** — FAIL, unfixed. Part of the operator
  context invariant (scroll, expanded state, selected tier, active section,
  input focus).
- **Journey / Item-Description** — unresolved governance decisions.

---

## 8 · Operational Certification scope (when unblocked)

Nine actions: Add Destination · Record Shipment · Freight Type change · Freight
amount change · Duty change · Tariff change · Packaging markup change ·
Component Attach · Cost Stack update.

Per action capture: visible completion time; reconciliation cycles; full Costs
renders; duplicate submission window; Cost Stack stability; Freight / Duty /
Tariff update timing; scroll and editing context preservation.

**Pass condition is not "fewer refreshes."** It must prove: one governed
reconciliation cycle per action burst; no duplicate submission window; no
disappearing / reappearing values; no Cost Stack temporary loss of Freight or
Duty; operator-visible completion in an acceptable range; scroll and editing
context preserved.

Also outstanding: partial multi-operator convergence test, with realtime
propagation recorded as **NOT TESTABLE** (blocked by PR-F and publication
`0036`) — never as PASS or FAIL. Do not pull PR-F or `0036` into the
certification branch merely to complete that test.

### Baseline measurement already taken (one add-destination)

```
05:04:56.119  POST starts    [bundle:tiers] 404ms
05:04:57.572  destination row committed        → ~1.45s write path
05:04:58.122  GET render #1  [bundle:nm.assemblies] 669ms · post-meta 768ms
05:04:58.505  GET render #2  [bundle:quote_lookup] 997ms · post-auth 566ms
05:04:58.987  GET render #3  post-auth 829ms
```

One write, three concurrent full-bundle re-renders. This is the amplification
shape; PR #183's coalescing was deliberately absent from that branch. Whether
it resolves this is the hypothesis to measure — not a claim.
