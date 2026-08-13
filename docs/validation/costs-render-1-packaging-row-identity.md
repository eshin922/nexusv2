# COSTS-RENDER-1 — Packaging rows did not identify the component they cost

**Classification.** V1 operator-correctness defect.

> Packaging rows do not expose sufficient product identity for an operator to
> know which governed component they are costing. Incorrect per-leaf attribution
> can reconcile perfectly.

**Status: REPAIRED on this branch.** Surfaced by Order B Step 2
(`docs/validation/order-b-step-2-costs-record.md`), where identifying the rows
required reading `line.lineGroupId` through React props — not an
operator-reachable mechanism.

---

## 1 · Root cause — a join across two identity spaces

`d6a1df2` (OD-017, "one governed cost-input identity") re-keyed cost rows from
`assembly_leaf_id` to `quote_leaf_id`. The **cost-row producer** was converted.
The **identity-map producer** was not.

| | `skus[].id` (map key) | `quoteSkuId` (lookup key) | Result |
|---|---|---|---|
| `main` (deployed) | `al.id` | `assemblyLeafId` | same space — resolves |
| this branch, pre-fix | `al.id` | `quoteLeafId` | **never hits** |

`skuMap.get(line.quoteSkuId)` therefore returned `undefined` for **every** row,
`productName` and `skuLabel` both fell to `""`, and every row rendered the
fallback `"Unknown component"`.

Confirmed against Order B — the two spaces do not overlap:

```
10064-GNX-Box    assembly_leaf c1ff6c6b…   quote_leaf 184f1fd6…   SAME? false
DPS-BOTTLE-0001  assembly_leaf 90a9b8ab…   quote_leaf 8d4ec58f…   SAME? false
```

**Not deployed.** `main` still emits `assemblyLeafId`, so production is
unaffected. This is a branch regression, caught before release.

**Why nothing caught it.** Both ids are `string`, so the compiler saw a valid
program. This is the exact failure OD-017 itself banked — *"producers that emit
a plausible-but-wrong value of the same type"* do not surface in a type error —
recurring inside the very slice that documented it.

---

## 2 · The five diagnostic questions

1. **Governed identifier the row carries** — `quote_leaf_id`, in the legacy-named
   field `packaging_inputs.quoteSkuId`. `assembly_leaves.quote_leaf_id` is
   `NOT NULL` with unique index `assembly_leaves_quote_leaf_idx`, so the mapping
   is total and 1:1.
2. **Where name/SKU should resolve** — the library `leaves` row reached through
   `quote_leaves → assembly_leaves → leaves`. Already loaded by the Costs page
   as `newAssemblyLeafRows`; `leaves.name` and `leaves.sku` are both populated.
   **The data was never missing — only the join was wrong.**
3. **Did the loader omit identity?** No. The loader supplies it; the consumer
   looked it up under the wrong key.
4. **Does the branch differ from deployed?** Yes — see §1. Deployed renders
   labels correctly.
5. **Minimum correct source** — the library leaf's `productName`, with `skuLabel`
   as sub-text. This is the convention already used on this row; **no new
   Product Library naming model was introduced.**

Identity is **not** derived from render order, and **not** from supplier,
pricing vendor or category — the resolver cannot reach any of them, asserted in
`costing-surface-contract.test.ts`.

---

## 3 · Repair

Resolution extracted to **`src/lib/costs/packaging-row-identity.ts`** — domain
logic, not presentation, so the binding is assertable without rendering React.

- `buildPackagingIdentityMap` keys **strictly** on `quoteLeafId`.
- **No fallback to `s.id`.** A permissive lookup would silently re-absorb the
  next re-key, which is the defect itself.
- Assemblies are excluded — they own no cost row.
- Whitespace-only identity counts as absent; `" "` identifies nothing.
- `"Unknown component"` survives only for a leaf with genuinely no governed
  identity.

Call sites: `costs/page.tsx` now carries `quoteLeafId` on the synthetic SKU;
`packaging-drilldown.tsx` consumes a resolved `identity` prop.

---

## 4 · Regression proof

`tests/unit/costs-render-1-packaging-row-identity.test.ts` — 9 tests over the
real Order B fixture: two leaves, **different costs, equal markups**, rendering
in an order **inverted from creation order**.

Proves: each visible row resolves to the correct governed leaf; Box label stays
bound to `0.625` and Bottle to `1.125`; reordering rows and shuffling the SKU
array do not change identity; no fallback when governed identity exists; an
assembly is not a lookup target.

**Falsification included.** Swapping the two costs yields
`aggregateSellPerUnit = 3.5` **either way** — identical subtotal, sell, margin
and turnkey — so the test asserts outright that reconciliation *cannot*
discriminate, and that only per-row attribution can. That assertion is what
stops this suite being replaced by a totals check later.

**Mutation-checked.** Reintroducing the pre-fix join (`[[s.id, s]]`) fails 4 of
the 9 tests; restoring passes 9/9. The suite can express the failure it excludes.

Full governed suite after the final edit: **`npm run test:unit` 1005/1005**,
`npx tsc -p tsconfig.json --noEmit` clean.

---

## 5 · Live proof on Order B — no devtools

Reloaded and read from **rendered text only** (`.name .lab` / `.name .sub`);
no React internals inspected:

| Rendered row | Visible name | Visible SKU | Markup | Cost |
|---|---|---|---|---|
| 1 | `Primary - Bottle` | `DPS-BOTTLE-0001` | 100 | **1.125** |
| 2 | `Genexa - Box - Kids' Cough (10064-GNX)` | `10064-GNX-Box` | 100 | **0.625** |

`"Unknown component"` absent from the page. Cost stack unchanged: `Sell $3.50`,
`50.0% margin`.

**Authored values were not modified and were not re-authored.** Durable state
after the repair is identical to before it:

```
10064-GNX-Box    unit_cost=0.6250  markup=1.0000 (manual_override)
DPS-BOTTLE-0001  unit_cost=1.1250  markup=1.0000 (manual_override)
assembly_production_inputs 0 · assembly_leaf_overrides 0
status=draft · detail_level=NULL
```

Step 2 operator certification is complete: the existing durable rows visibly
identify the correct components without inspection.

---

## 6 · Scope held

**COSTS-RENDER-2 (Production markup rendering) is NOT the same cause.**
`prodRows` still emits `quoteSkuId: anchorLeafId` — the assembly-leaf space —
and `production-drilldown.tsx` has no identity map and no `"Unknown component"`
fallback. No shared resolver. It remains separate.

No Send, Accept or Complete occurred. **Step 3 `detail_level` reachability
remains held** and is now unblocked.
