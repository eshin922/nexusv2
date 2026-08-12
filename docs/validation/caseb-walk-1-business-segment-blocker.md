# Case B walk 1 — halted at CREATE · Business Segment → NetSuite `class`

**2026-08-12 · sandbox `7924416_SB2` · DPS-1045 v2 · deal `58332160883`**

The walk reached the irreversible step and NetSuite refused the order:

> `Invalid Field Value 3 for the following field: class.`

**The deal was NOT consumed.** NetSuite rejected at validation before creating
anything — 0 Sales Orders carry `58332160883`. Case B remains executable on this
fixture once the finding is dispositioned. This is the fail-closed behaviour
working: a rejected payload cost nothing.

## State after the halt — restored

| | |
|---|---|
| NetSuite SOs for the deal | **0** — deal still free |
| `netsuite_so_pushes` | 1 row, `status=failed`, `error_class=validation`, no SO id |
| Nexus quote | rolled back to `sent`, `accepted_at` null |
| HubSpot `dealstage` | restored `195274340` via governed rollback |
| HubSpot `amount` | restored `10000` via the authorized amount-only repair |
| HubSpot `closedate` | **NOT restored** — `2026-06-01T21:12:46.036Z` → `2026-08-12T00:45:51.814Z` |

`closedate` moved as a side effect of the acceptance stage push and the governed
rollback does not reverse it. No authorization exists to write it, so it is
reported rather than silently corrected.

Restored ahead of the planned step 10 because Nemah is a real deal in the firm's
production CRM and was showing a false *Won - In production · $12,000*. Both
restore actions were already authorized; only their timing moved.

## Root cause — two taxonomies, one accidental integer collision

`sales-orders.ts` sends the **raw HubSpot `business_segment` enum id** as the
NetSuite `class`:

```ts
if (input.businessSegmentId) {
  body.class = { id: input.businessSegmentId };          // HubSpot enum id
  body.cseg_dps_bus_seg = { id: input.businessSegmentId };
}
```

`mark-complete.ts:606` passes `dealCache.businessSegmentId` — unresolved. The
type comment at `sales-orders.ts:70` claims *"NetSuite class id (resolved via BS
resolver → NS class)"*. **That comment is false.**
`business-segment-resolver.ts` resolves enum id → **label**, for display
backfill. Nothing maps anything to a NetSuite class id.

The resolver's own header already ruled out exactly what shipped:

> *"if the fetch fails OR the enum id has no label, BLOCK the push. **Don't send
> the raw id and hope NetSuite matches it** (that's option C and a wrong class on
> a real SO is an accounting error nobody sees until close)."*

Option C shipped.

**The two id spaces are unrelated.** HubSpot `business_segment` has exactly two
options — business units:

| enum | label |
|---|---|
| `1` | `Product 360°` |
| `3` | `DPS Packaging\t` *(note the trailing tab — separate data-hygiene item)* |

NetSuite `classification` is the **cost-category taxonomy**: Primary, Secondary,
Filling and Packout Services, Co-Packing, Freight, One Time Charges, Soft Goods
and Accessories, Raw ingredients, Passthrough, Turnkey, R&D / Testing, …

Neither `Product 360°` nor `DPS Packaging` exists in it. **There is no mapping to
wire — the correspondence is not a fact anyone has established.**

## Blast radius — 50 of 67, and the 17 that "pass" are worse

| `business_segment_id` | deals | against NetSuite `classification` |
|---|---|---|
| `3` | **50** | **not a class — rejected** |
| `1` | **17** | collides with class `1` = **Primary** — accepted |
| NULL | 3 | field omitted — unaffected |

**50 of 67 deals cannot create a Sales Order at all.** The earlier §11.1
classification recorded this as a *"3/70 residual"* with **"NO PAYLOAD CHANGE
REQUIRED"**; that is now falsified — it counted rows carrying the value, not
rows the value would break.

The 17 that succeed are the more dangerous half. HubSpot `1` (`Product 360°`)
collides numerically with NetSuite class `1` (`Primary`). Those orders are
**classified `Primary` on the authority of a value that does not mean Primary** —
a misattribution that reconciles perfectly and shows up at close. This is the
banked rule holding exactly: *total reconciliation cannot certify attribution.*
And it is Pattern 56 in another key — the path only ever worked by coincidence,
so nothing had proved it worked by construction.

## A prior question this raises — is the header even the right level?

Class appears to be **line-level** in this account, not header-level:

- `transactionLine.class` populated on **2,926 of 4,864** Sales Order lines.
- Querying `transaction.class` errors (`Unknown identifier "CLASS"` / 500).
- Legacy **SO2646** carries **different classes on different lines** —
  `42 Filling and Packout Services` ×2 and `61 One Time Charges` ×1.

So legacy practice classifies **each line by what that line is**, drawn from the
cost-category taxonomy. Nexus sends **one header value derived from a deal-level
business unit**. That is the wrong level *and* the wrong taxonomy — and Nexus
already holds the per-line notion that the legacy taxonomy actually mirrors.

## What is needed — business input, not engineering inference

**Not repairable from this side.** Any mapping I invented would be a guess about
the firm's accounting classification, which is the class of decision that C.1 and
C.3 both showed must come from outside.

1. **Should Nexus set `class` at all in V1?** Omitting it is the smallest honest
   option — a null class is visibly absent, whereas a wrong class is invisible.
   Against: 2,926 populated legacy lines suggest it is genuinely used.
2. **If yes — at which level, and from which source?** Line-level from the
   governed cost category is the shape the legacy data implies. Header-level
   from `business_segment` is what ships and cannot be made correct, because no
   HubSpot→class correspondence exists.
3. **Is the existing Nexus-created SO misattributed?** Any pushed with segment
   `1` carry class `Primary` on a `Product 360°` basis and should be reviewed.

Until 1 and 2 are answered, **Case B cannot complete** — Nemah is one of the 50.

## Not affected

The C.3 repair committed immediately before this walk is unrelated and did not
contribute: Nemah's `client_po` is null, so neither PO field was emitted. The
frozen payload confirms it.

Everything up to CREATE passed, and is re-provable on demand:
prerequisite chain **21/21**, duplicate-deal preflight clean, grouping plan
reconciling **12,000 = 12,000 = 12,000, Δ 0**, and the Sales Order surface
matching the frozen evidence target line for line. Evidence target:
`.artifacts/CASEB-EVIDENCE-TARGET.txt`.
