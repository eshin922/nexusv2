# Order B · Step 3 — `detail_level` reachability

Discovery only. **No `detail_level` was written. No Send, Accept or Complete.**
Order B state verified unchanged at the end (§6).

**Headline.** A governed operator control for `turnkey_only` **exists and is
reachable**, but it has **no draft-time persistence path**. `quotes.detail_level`
has exactly one operator writer — **`sendQuote`** — so the required Accounting
state cannot be established, or verified, before Send.

---

## 1 · Every operator-facing control

Exhaustive sweep of `src/` for `detailLevel` / `detail_level`. **One** control:

| | |
|---|---|
| **File** | `src/components/quote/quote-host.tsx:196` |
| **Label** | `Detail:` |
| **Choices** | `Itemized` (`itemized`) · `Turnkey only` (`turnkey_only`) |
| **Write path** | **None.** `setDetailLevel` from `useQuoteAxis()` — React context only |
| **Workflow position** | Quote umbrella → sub-tab **1 · Preview Quote** |
| **State availability** | **Enabled on draft**; `disabled={isSent}` once sent |

Live confirmation on Order B: one `<select>` on the page,
`options ["itemized|Itemized","turnkey_only|Turnkey only"]`, `disabled: false`,
sub-tab strip showing `1 Preview Quote IN PROGRESS`.

**Surfaces searched and found to contain no control:** Send workflow
(`send-quote-flow.tsx` only *reads* context into FormData), Customer View / PDF
config (render-only consumers), commercial settings, Product Structure / ASY
surfaces, quote header. `production-drilldown`, Costs and Pricing do not
reference the axis at all.

### Why the control does not persist

`quote-axis-context.tsx` holds the axis in `useState`. Its own header documents
the trade-off:

> "Chose context (not URL query params) to avoid RSC refetch on every toggle …
> **Downside: post-load toggles don't rewrite URL**, so a PM's current toggle
> state isn't shareable via URL after they've interacted with the toggles."

So a toggle writes **neither the database nor the URL**.

### The only writers of `quotes.detail_level`

1. **`sendQuote`** — `quotes.ts:1890`, writing `detailLevelSnapshot` onto
   `quotes` and inserting the same value into `quote_snapshots` (`:1824`),
   in one transaction.
2. **Copy-scenario carry-forward** — `quotes.ts:3220`, inherits the source
   quote's value.

Neither is a draft-time set. Note the Drizzle field is **`detailLevelSnapshot`**
mapped to column `detail_level`: the column is a *send-time snapshot*, and the
schema says so — *"draft = live (searchParam ?? default); sent+ = snapshot
column."* Confirmed in `customer-view-resolver.ts:433-437`.

---

## 2 · What the UI tells the operator it means

Visible copy of the control's row, verbatim:

```
Detail:  [Itemized ▾]        Include spec addendum · pricing-only PDF
```

It renders **directly beneath** the customer-boundary notice:

> BOUNDARY GUARD · CUSTOMER VIEW — Nothing below this line is in the customer's
> tree. Margin, markup, cost stack, supplier names, duty %, tariff %, CBM,
> internal versioning — all forbidden.

There is **no** helper text, tooltip or label on or near the control mentioning
Item Group, grouping, projection, NetSuite or the Sales Order. A full text-node
sweep of the page found only two such strings, neither attached to the control:
the sub-tab label `Sales Order`, and a generic warning that *"step 5 pushes a
NetSuite Sales Order — the only irreversible act."*

**Answer: the operator is told it controls customer PDF presentation, and
nothing else.**

### The runtime disagrees

The same axis is the ERP grouping authority:

- `src/lib/netsuite/grouping-plan.ts:159` —
  `const applicability = input.detailLevel ?? "itemized"`.
- `src/lib/netsuite/mark-complete.ts:418-427` — `itemized` → do **not** group;
  `turnkey_only` → grouping **is required**; read from the send-time snapshot.

Recorded per instruction, not reinterpreted:

> **The operator can reach the state, but the UI presents it as a
> customer-presentation choice while the current runtime also uses it as ERP
> grouping authority.**

This is existing **OD-022** debt. It is not, on its own, a reason to prevent the
Accounting review.

---

## 3 · Persistence — the protocol was run and it fails at step 2

Executed against Order B through the real UI (focused the control, sent a real
`Down` keystroke — no scripted action, no direct write):

| Step | Result |
|---|---|
| 1 · Use the control | ✅ value → `turnkey_only`; preview iframe re-rendered `detail=turnkey_only` |
| 2 · `quotes.detail_level = turnkey_only` durably | ❌ **still `NULL`**; `updated_at` unmoved at `18:50:12` |
| 3 · Reload | ✅ |
| 4 · UI still shows selection | ❌ **reverted to `Itemized`** |
| 5 · Governing audit event | ❌ **none** — only `created` exists for this quote |

`quote_snapshots` rows: **0**.

**The selection is session-transient.** It exists only in React state until Send
consumes it.

### Operator-correctness risk this creates

A PM who selects `Turnkey only`, navigates away or reloads, then returns and
sends, will send **`itemized`** — silently, with the control reading "Itemized"
and nothing indicating a prior choice was discarded. For Order B that produces
flat lines instead of the Item Group, i.e. **the wrong Accounting artifact**.

Not raised as a blocker; flagged for classification alongside OD-022, since the
transience is what converts a presentation/grouping coupling into a
misconfiguration that can happen without the operator noticing.

### A safer reachable path exists — deep link

`?detail=turnkey_only` seeds the axis server-side
(`customer-view-resolver.ts` → `QuoteAxisProvider`). Verified live: landing on

```
/projects/{p}/quotes/{q}/quote?detail=turnkey_only
```

renders the select as **`Turnkey only`** and the preview as `detail=turnkey_only`,
and — unlike a post-load toggle — **survives reload**, because the URL carries
it. It is the same governed value through the same resolver Send reads; it is
not a hidden action or a direct write.

---

## 4 · What this means for the Accounting artifact

`turnkey_only` **is** operator-reachable — but it becomes durable **only at the
moment of Send**, as part of the send snapshot. Therefore:

- Step 3's "verify persistence, then reload, then verify" **cannot be satisfied
  before Send**, by construction, not by omission.
- The pre-Send evidence available is: the control exists, is enabled on draft,
  selects the correct governed value, drives the preview, and is read by
  `sendQuote` from context via `send-quote-flow.tsx:77` (`fd.set("detailLevel",
  detailLevel)`).
- Confirming `quotes.detail_level = turnkey_only` durably **requires a Send.**

That decision is reserved. **Not taken here.**

---

## 5 · Not done

- No `detail_level` write, direct or otherwise.
- No hidden server action called from a script.
- No reliance on the `NULL` fallback — note it defaults to `itemized`, i.e. the
  **wrong** value for Order B, so falling back is not an option regardless.
- No Product Structure change to manufacture the state.
- No Send, Accept or Complete.

---

## 6 · Order B unchanged-state verification

```
status=draft  detail_level=NULL  pdf_layout=NULL  gpa=0.0000
sent_at=NULL  accepted_at=NULL  netsuite_so_id=NULL

10064-GNX-Box    cost=0.6250  markup=1.0000 (manual_override)
DPS-BOTTLE-0001  cost=1.1250  markup=1.0000 (manual_override)

assemblies=1  assembly_leaves=2  quote_leaves=2  tiers=1  tier_qty=1000
overrides=0   production=0       snapshots=0

computedSellPerUnit=3.5   revenue=3500   marginPct=0.5
```

Costs unchanged · markups unchanged · tier unchanged · **$3,500** holds · status
draft · zero Pricing overrides · zero Production inputs · no Product Structure
mutation.

---

## 7 · Hard stop

Complete remains blocked. The NetSuite Sales Order CREATE response-loss /
idempotency gate is unresolved and independent of this step.

Probes: `.artifacts/ob-detail-level.ts`, `.artifacts/ob-unchanged.ts`.
