# OD-028 — post-OD-017 SO projection identity mismatch

**Status: REPAIRED and proven end-to-end.** Order B completed to **SO2707**
after the repair.

**Third observed instance of the OD-017 same-type identity-space failure class.**

---

## 1 · Failure

Authorized Complete on DPS-1048 refused **pre-CREATE**:

> `SEND FAILED — No SO lines built — every leaf failed to resolve or had no
> per-tier rollup. Cannot push.`

Clean refusal. Zero Sales Orders for deal `59153706532`, zero
`netsuite_so_pushes` rows, quote still `accepted`, production HubSpot
unchanged. **No ambiguous CREATE outcome existed**, so the recovery path built
for that case was correctly not engaged.

## 2 · Root cause

`mark-complete.ts` built SO lines by joining tree nodes to costing output on:

```ts
.find(({ child }) => child.junctionId === leafRollup.skuId)
```

`leafRollup.skuId` is the **quote_leaf_id** (OD-017 re-keyed the math layer);
`child.junctionId` is the **assembly_leaf_id**. Different id spaces, both
`string`, so nothing failed to compile. Measured on Order B:

```
leaf skuRollups:  184f1fd6…  8d4ec58f…     ← quote_leaf ids
tree children:    c1ff6c6b…  90a9b8ab…     ← junction ids

matches by junctionId  : 0 / 2    ← the predicate in force
matches by quoteLeafId : 2 / 2
```

Every leaf hit `continue`, `lines` came out empty, and the fail-closed guard
refused the push. **The guard did its job** — it prevented an empty Sales Order
rather than creating a wrong one.

Blast radius: any quote costed after OD-017 (`d6a1df2`, 2026-08-12 00:12) could
not Complete through this path at all.

## 3 · Repair

- `AssemblyLeafNode` gains **`quoteLeafId`**, sourced directly from
  `j.quoteLeafId` (`assembly_leaves.quote_leaf_id`, NOT NULL, unique-indexed).
- The SO-line projection matches `leafRollup.skuId` against the node's
  canonical `quoteLeafId`.
- **No fallback to `junctionId`** — a fallback would silently re-absorb the next
  re-key, which is the mechanism by which this class keeps recurring.
- The empty-lines fail-closed guard is untouched.

## 4 · Regressions

`tests/unit/od-028-so-projection-identity.test.ts` — 6 tests: expected lines
build for a post-OD-017 quote (asserting the amounts sum to $3,500, so a
mis-join that still produced two lines could not pass); Box and Bottle each
resolve exactly once; grouped projection still honours `qtyPerParent`; the
guard still throws on empty; and source-level assertions that the join is on
`quoteLeafId` with no `||` fallback.

**Falsification:** the junction-id predicate resolves **0/2** and trips the
guard — the measured pre-repair behaviour, asserted directly.

Run: 6/6 new · 54/54 across the directly affected Complete/Track-B suites
(`grouped-so-recovery-core`, `netsuite-ambiguous-create-recovery`,
`sales-order-accounting-contract`, `durable-attempt-lifecycle`,
`complete-status-writer`, `product-structure-slice1-cutover`) ·
`tsc --noEmit` clean.

## 5 · Class record

Third instance of the same shape, all from OD-017's identity re-key:

1. **COSTS-RENDER-1** — Packaging row identity map keyed on `assembly_leaf_id`.
2. **Draft worksheet freight loader** — emitted the legacy id as its costing
   anchor (recorded in CLAUDE.md's OD-017 migration lessons).
3. **OD-028** — SO line projection, this record.

Each was a *producer or consumer of the same `string` type* carrying a
plausible-but-wrong value, which is precisely why none surfaced as a type error.
Per instruction, this repair was **not** expanded into another broad audit
before Order B; the class record is banked for when one is scheduled.

---

## 6 · Post-repair Complete — verified

Retried on the existing accepted DPS-1048. **Nothing was rebuilt, re-Sent or
re-Accepted.** Lifecycle: `pending → awaiting_rates → succeeded`, persisting the
SO identity at the recovery boundary before rate convergence.

```
PASS  exactly ONE Sales Order for the deal          1
PASS  customer = Root / buildwithroot.co            360189
PASS  order total                                   $3,500
PASS  exactly ONE Item Group                        ASY-89688023-1-G
PASS  Group qty                                     1,000
PASS  master = 2 members (Box + Bottle)             2
PASS  Box    1,000 @ $1.25 = $1,250                 class 10
PASS  Bottle 1,000 @ $2.25 = $2,250                 class 1
PASS  no $0.00 governed member
PASS  NO 1,000,000 member quantity                  (SO2703 defect absent)
PASS  quote status                                  complete
PASS  quote mirrors SO id / tranid                  361542 / SO2707
PASS  durable push                                  succeeded
PASS  HubSpot dealstage / amount / closedate / lastmodified  ALL UNCHANGED
```

**Artifact preserved:** SO2707 (internal id 361542) and Item Group
`ASY-89688023-1-G`.

### A measurement note worth keeping

The first verification pass reported three failures on quantity and amount. It
was **the instrument, not the data**: `transactionline` stores Sales Order line
quantities and amounts negative in this estate, while `transaction.foreigntotal`
is positive. Established by control rather than assumption — SO2704, a prior
certified Accounting artifact, shows `-1000, -1000, -1000` against a positive
header total of `12000`. Assertions were corrected to compare absolute values.

The control also re-confirms the SO2703 defect signature (`-1000000` member
quantities against a header total of `0`) is **absent** from SO2707.
