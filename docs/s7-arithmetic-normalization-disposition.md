# S-7 · certified arithmetic-normalization delta

**Dispositioned 2026-08-24 (Edward). Specific, not a policy.**

## What moved

12 per-SKU instances of `skuRollups[].perTier[].separateServicesMarkupSumPerUnit`,
maximum |d| = **3.55e-15**:

```
0.29250000000000004 -> 0.29249999999999998
0.13999999999999999 -> 0.14000000000000001
 23.799999999999997 -> 23.800000000000001
```

## What did not

- the customer document — captured and diffed, **identical**
- `quoteRollup` and `quoteSummary` — **clean**
- revenue, cost, margin — **unchanged**

## Why it is accepted

Not a business-value change. The movement is an internal per-SKU decomposition
scalar losing a **redundant divide → markup → multiply round trip**: the code now
reads the one constructed state instead of deriving the amount a second time.

**Preserving the old 17-digit values would mean deliberately reintroducing the
parallel derivation Step 5 exists to remove** — the harness would be defending an
implementation artifact against the architectural invariant it is there to
protect.

## The scope of this disposition

- **Accepted:** these 12 movements, for this cause.
- **NOT accepted:** any loosening of the global S-7 comparison. Per-SKU scalars
  keep full 17-digit scrutiny; the aggregate scopes keep their documented
  12-significant-digit quantization. Nothing about the harness changes.
- **NOT a precedent:** a future per-SKU movement is a finding until dispositioned
  on its own evidence. The governing statement is *"this exact movement is
  governed"*, never *"small floats do not matter"*.

## Recapture

**Not yet.** The baseline is recaptured only after Step 5 is otherwise certified,
as a deliberate act with its own record — never as a way to clear a failure.

Until then `verify:s7-preserved` reports these 12 and exits non-zero. That is
correct: an accepted movement that has not yet been rebaselined should still be
visible.
