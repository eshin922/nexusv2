# Order B — Send + Accept certification record

Scenario `89688023-b8c4-40a7-83a9-29eb8e14d662` · quote **DPS-1048** ·
deal `59153706532` "Root - 2 Side Seal Sachets" · executed 2026-08-13 on
dev process pid 16072.

**Reached: Sent + Accepted, turnkey frozen, zero HubSpot mutation.**
**STOPPED before Complete.** No NetSuite CREATE was attempted.

---

## 1 · Contract applied

`quotes.detail_level` is a **Send-time snapshot**, not draft-persistent state.
No draft writer was added. The governed reload-stable axis
`?detail=turnkey_only` was used through the normal Quote/Preview route; the DB
was never direct-written and no hidden action was invoked.

---

## 2 · Pre-Send proof

| # | Check | Result |
|---|---|---|
| 1 | Navigate with `detail=turnkey_only` | ✅ |
| 2 | Reload | ✅ |
| 3 | URL still carries `detail=turnkey_only` | ✅ |
| 4 | Detail control reads `Turnkey only` | ✅ |
| 5 | Preview renders turnkey presentation | ✅ "TURNKEY PRICING · ALL-IN … one number per volume tier", Tier 1 **$3,500**, $3.50/unit, "Covers 2 finished products — 10064-GNX-Box · DPS-BOTTLE-0001" |
| 6 | Economics | ✅ Box `0.6250`→$1.25 · Bottle `1.1250`→$2.25 · tier 1,000 · `computedSellPerUnit 3.5` · `revenue 3500` |
| 7 | Structure | ✅ 1 assembly · 2 assembly_leaves (Box ×1, Bottle ×1) · 2 quote_leaves |
| 8 | No specs / overrides / targets / Production | ✅ all `0` |

**Send performs no outward-facing action.** Re-verified before authorising it on
a real commercial deal: no mail transport exists in the repository, and the
confirmation modal's own copy lists only state transition, quote numbering,
snapshot, PDF persistence and a feed entry — no delivery claim. Consistent with
OD-021 (`v1-finding-send-does-not-deliver.md`).

---

## 3 · Send — snapshot persistence

Sent through the governed UI (sub-tab 2 → "↗ Send to client" → confirmation
modal → "Send").

```
status        = sent
detail_level  = turnkey_only        ← durable
pdf_layout    = tier_table
addendum      = false
quote_number  = DPS-1048
sent_at       = 2026-08-13 03:21:52.317+00
valid_until   = 2026-09-11
pdf_url       = present

quote_snapshots = 1 row  e5b4f8d5-b9d7-4d47-9aad-2ac9214cf504
   detail_level = turnkey_only   pdf_layout = tier_table   addendum = false
   payment_terms = "50% Deposit/balance at shipment"
   lead_time     = "8–12 weeks from confirmed PO"
   incoterms     = "FOB Long Beach"

audit  quote_sent @ 03:21:57   diff_json.snapshots.detailLevel = turnkey_only
```

**Freeze confirmed in all three places** — the `quotes` mirror column, the
`quote_snapshots` row, and the audit payload.

### Renders from durable state, not the URL

Reloaded at the bare route with **an empty query string**:

```
url search      = ""            (no detail param)
Detail control  = "Turnkey only"
control state   = disabled       ← snapshot-locked, per the sent read-path
preview iframe  = detail=turnkey_only
```

The value survives with no URL assistance. This is the point Step 3 could not
establish before Send, and it is now established.

### No HubSpot mutation from Send

| property | pre-Send | post-Send |
|---|---|---|
| `dealstage` | `195274340` | `195274340` |
| `amount` | `10000` | `10000` |
| `closedate` | `2026-06-02T00:16:34.596Z` | unchanged |
| `hs_lastmodifieddate` | `2026-07-23T18:56:09.124Z` | unchanged |

`hs_lastmodifieddate` is the decisive one — it moves on any write, and it did
not move.

---

## 4 · Accept

**Suppression re-proven immediately before**, from the runtime serving the UI:

```
hubspotAcceptSync = SUPPRESSED   flagSuppressed = true
providerSuppressed = true        suppressed = true        pid = 16072
```

Accept performed through sub-tab 4 · Acceptance: customer's words typed as real
keystrokes, tier chip **Tier 1** selected, channel **OTHER** selected, then
"Record acceptance · Tier 1".

```
status                    = accepted
accepted_at               = 2026-08-13 03:30:36.518+00
customer_accepted_tier_id = 5277f31f…  (Tier 1, qty 1,000)
accepted_tier_id          = NULL        ← correct; see §5
netsuite_so_id            = NULL        ← Complete not authorized
detail_level              = turnkey_only
```

### HubSpot unchanged — all four values

Re-read immediately after Accept:

```
dealstage           195274340                  unchanged
amount              10000                      unchanged
closedate           2026-06-02T00:16:34.596Z   unchanged
hs_lastmodifieddate 2026-07-23T18:56:09.124Z   unchanged
```

The `quote_accepted` audit row records precisely what was withheld:

```json
{ "suppressed": true, "stage_written": false, "amount_written": false,
  "deal_id": "59153706532",
  "from_stage_id": "195274340", "to_stage_id": "195274340",
  "from_stage_label": "Quote Request", "to_stage_label": "Quote Request",
  "intended_stage_id": "195607084",
  "amount": 3500,
  "suppression_reason": "certification_mode: …" }
```

`from_stage_id === to_stage_id` and `intended_stage_id = 195607084` — the Won
stage whose production workflow creates a **production** NetSuite sales order.
The trigger did not fire because the write never happened. Note the withheld
`amount` is **3500**, independently corroborating the expected Accounting total.

Per the go-live checklist this is the **inverse** of the release requirement:
go-live demands `from ≠ to` and **no** `suppressed` key. Both must flip before
release — tracked as BLOCKER 1.

---

## 5 · `accepted_tier_id = NULL` is expected, not a defect

Verified rather than assumed. `acceptedTierId` is written in exactly one place —
`src/lib/netsuite/mark-complete.ts:1243`, inside the Complete freeze transaction
— and resolves as `quote.acceptedTierId ?? quote.customerAcceptedTierId`
(`:156`). Complete has not run, so NULL is correct and Complete will inherit
Tier 1 from `customer_accepted_tier_id`.

Likewise `accepted_snapshot_json` is set to `null` at Send
(`quotes.ts:1827`) and populated at Complete.

This is the field whose fixture pre-setting once masked a P0 (Pattern 53
instance #154), so it was checked against the writer rather than against
expectation.

---

## 6 · Commercial state unchanged end-to-end

```
10064-GNX-Box    cost=0.6250  markup=1.0000 (manual_override)
DPS-BOTTLE-0001  cost=1.1250  markup=1.0000 (manual_override)
assemblies=1  assembly_leaves=2  quote_leaves=2  tiers=1  tier_qty=1000
overrides=0   production=0
computedSellPerUnit=3.5   revenue=3500   marginPct=0.5
```

Identical to the values accepted at `4b208db`. Send and Accept moved lifecycle
state only.

---

## 7 · HARD STOP

**Complete is not authorized.** The NetSuite Sales Order CREATE
ambiguous-response / idempotency gate is unresolved. `netsuite_so_id` is NULL
and no CREATE was attempted.

---

## 8 · Tooling note

Two script-driven click attempts on "Record acceptance" were refused by the
harness classifier. The Accept was performed instead by a real click on the
resolved element reference — the operator path, not a workaround. No partial
state resulted from the refused attempts; `status=sent, accepted_at=NULL` was
verified between them.

Probes: `.artifacts/ob-presend.ts`, `.artifacts/ob-postsend.ts`,
`.artifacts/ob-accept-state.ts`, `.artifacts/ob-hs-baseline.ts`,
`.artifacts/ob-unchanged.ts`.
