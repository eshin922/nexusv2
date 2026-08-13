# Order B · Step 2 — Costs entry, certification record

**Scenario** `89688023-b8c4-40a7-83a9-29eb8e14d662` ·
`NEXUS V1 ACCOUNTING REVIEW — SANDBOX · single Item Group` ·
deal `Root - 2 Side Seal Sachets` · status `draft`.

Executed 2026-08-12 through the operator path on the running dev process
(pid 16072). **No Send, Accept, Complete, Pricing override, or `detail_level`
write occurred.** Order B remains paused before Send.

---

## 1 · Before state (observed, not assumed)

| | |
|---|---|
| `assembly_leaf_inputs` | 2 rows, both `unit_cost = NULL`, `markup_pct = NULL` |
| `assembly_production_inputs` | 0 rows |
| `assembly_leaf_overrides` | **0 rows** |
| quote | `status=draft` · `detail_level=NULL` · `gpa=0.0000` · `target=NULL` |

Recorded so each write is compared against a known prior value rather than
against emptiness.

---

## 2 · Row identity — established from React props, NOT from ordering

Both Packaging rows render as **"Unknown component"** (see §5). Row identity was
therefore read from the `line.lineGroupId` prop on each input's fiber:

| Rendered row | `lineGroupId` | Component | Entered |
|---|---|---|---|
| **1** | `d5db8a89-c03a-4264-8a0a-fc6c294750cf` | `DPS-BOTTLE-0001` | cost `1.125`, markup `100` |
| **2** | `f9738441-8fa2-4230-946a-14889ad99083` | `10064-GNX-Box` | cost `0.625`, markup `100` |

**The rendered order inverts creation order.** Box was created first
(`18:51:49`), Bottle second (`18:52:38`), but Box renders **second**.

**Why this mattered.** Assuming creation order would have swapped the two costs.
Because both markups are 100%, the swap sums to the same `$3.50/unit` and the
same **`$3,500`** turnkey — the quote would have reconciled exactly while both
line attributions were wrong. This is precisely the failure the standing rule
*"exact reconciliation is necessary but not sufficient"* describes: completeness
is structurally incapable of detecting it, and only per-line attribution is.

The mapping was subsequently confirmed empirically — the first write landed on
the Bottle cell, as the props predicted.

---

## 3 · Entry method and focus discipline

Coordinate clicking was **abandoned** after it collapsed the Packaging drawer
instead of focusing a cell. Cause: `devicePixelRatio = 1.25`, so screenshot
pixels are 1.25× CSS pixels, and the layout additionally reflowed between
measurement and click.

Method used instead, per field:

1. `el.focus()` on the input resolved **by `lineGroupId`**, never by index.
2. Assert `document.activeElement === target`, `hasFocus`, `visibilityState`,
   `!disabled`, and the element's `lineGroupId`.
3. **Real keystrokes** via the browser `type` action.
4. Re-assert focus is *still* on the same input, and the input never became
   `disabled` — Pattern 47(e).
5. Commit with `Tab`; verify durable DB value.

Focus was retained through every keystroke of every field, and no input was
disabled mid-save. Pattern 47(e) holds on this surface.

---

## 4 · Verification — three independent instruments

**Durable DB value**

```
10064-GNX-Box    unit_cost=0.6250  markup=1.0000 (manual_override)
DPS-BOTTLE-0001  unit_cost=1.1250  markup=1.0000 (manual_override)
```

**Math layer** (`getCostingBundle` → `computeQuoteCosting`), assembly
`91509967…` @ tier 1,000:

```
packagingCostPerUnit   = 1.75      computedSellPerUnit = 3.5
contributionCostPerUnit= 1.75      revenue             = 3500
marginPct              = 0.5       cost                = 1750
```

Per-leaf **attribution**, checked separately from the total:

```
leaf 184f1fd6 (Box)     packagingCostPerUnit = 0.625   markupSum = 1.25
leaf 8d4ec58f (Bottle)  packagingCostPerUnit = 1.125   markupSum = 2.25
```

**Reload agreement** — after a full page reload, the surface re-renders
`d5db8a89 → 1.125 / 100` and `f9738441 → 0.625 / 100`, Cost stack `PKG $3.50`,
`Subtotal $3.50`, `Sell $3.50`, `50.0% margin`.

Order B's approved structure expects **3,500.00**. Met.

---

## 5 · FINDING — Packaging rows are operator-indistinguishable

Both rows render the literal string **"Unknown component"**, with `CATEGORY` as
`—` and no other distinguishing text. The label resolves at
`src/components/costs/packaging-drilldown.tsx:792`:

```ts
const componentName = productName || skuLabel || "Unknown component";
```

Both `productName` and `skuLabel` are falsy for these lines, so the fallback
renders for *every* row and the rows become identical on screen.

**Severity is higher than a cosmetic label gap.** On this surface an operator
enters per-component costs into rows they cannot tell apart. Entering the two
costs into the wrong rows produces a quote that reconciles perfectly at every
total — subtotal, sell, margin, turnkey — while both line attributions are
wrong. Nothing downstream would flag it. This is the same defect class as T-4
and Proof 5, reached through data entry rather than through display.

The DB binding is correct (`assembly_leaf_inputs → assembly_leaves → leaves`
resolves to Box and Bottle); the defect is confined to the rendered label.

**Not fixed here** — out of Step 2 scope, and Order B is mid-sequence. Raised
for disposition.

---

## 6 · Post-state

Unchanged from §1 except the two intended cost lines:
`assembly_production_inputs` 0 · **`assembly_leaf_overrides` 0** ·
`status=draft` · `detail_level=NULL`.

Still gating, untouched: **Step 3 `detail_level` reachability** (stop-before-Send
boundary) and the **six-question NetSuite CREATE idempotency trace**
(stop-before-Complete boundary).

Probes: `.artifacts/ob-costs-before.ts` (state + guardrails),
`.artifacts/ob-sell.ts` (math layer), `.artifacts/ob-struct.ts` (structure).
