# CERT-303 — pure Direct Service / Testing certification walk

Quote `430b5ce4-975b-4262-8247-aee668f287a8` · project ZZ-VALIDATION — Nexus
Certification Lineage · **DPS-1055** · sent 2026-08-19T17:15:22Z.

Retained per Edward's direction as a permanent V1 release-harness fixture, not
a disposable walk. Its value is that it carries **no Item Group and no product**
— it removes the accidental coverage every prior certification enjoyed.

---

## Checkpoint

Corrected before SEND. The first checkpoint circulated assumed a 32% Production
markup; that number came from a unit-test fixture constant quoted as though it
were the firm rate. The governed rate in `markup_defaults` is **40%**.

| | |
|---|---|
| Testing cost | $3,200.00 |
| Production markup (governed) | 40% |
| Tier quantity | 2,000 |
| unit sell | **$2.2400** |
| total sell | **$4,480.00** |

`(3,200 / 2,000) × 1.40 = 2.24` · `2.24 × 2,000 = 4,480.00`. Observed on
Pricing, on the customer PDF, and in the frozen snapshot.

---

## Proven

| # | claim | evidence |
|---|---|---|
| 1 | a pure Direct Service quote SENDS with zero Item Groups | DPS-1055 assigned; the repaired gate counts commercial lines, not assemblies |
| 2 | Testing prices through the engine | cell 28.6% / $2.24; Production sell/unit $2.2400; unit cost $1.6000 |
| 3 | the customer PDF states it | "Testing / Micros · SVC-TESTING-MICROS · $2.24 · $4,480.00"; Turnkey total $4,480.00 |
| 4 | one frozen line, correctly typed | `direct_service`, `testing_micros`, destination **`otc_testing`**, `legacyUnresolved=false` |
| 5 | the per-line item selection froze at send | `selectedNetsuiteItemId=15323`, `selectedNetsuiteItemCode=OTC-0016` |
| 6 | REG-4 exact | qty 2000 × unitRate 2.2400 = lineAmount 4480.00; tier total 4480.00 = 4480.00 unit + 0.00 OTC |
| 7 | the picker is disabled post-SEND | DOM: `disabled: true`, `readOnly: false`, value `OTC-0016`; typing changed nothing |
| 8 | the server refuses a cost mutation | `assertDraft` on the real sent row → `QUOTE_NOT_DRAFT`; a draft control passes the same guard |

### 7 and 8 are recorded distinctly, and 8 has a stated limit

**7 · UI.** The control is `disabled`. Re-enabling it in the DOM and clicking
Save produced **no network request at all** — the component gates its handler as
well as its input, so the transport could not be exercised from the client
without forging a Next-Action id.

**8 · Server.** The guard was therefore run against the real post-SEND quote
row, with a draft quote as a control so a guard that threw unconditionally could
not pass unnoticed:

```
CERT-303 (sent)                    status=sent    REFUSED  code=QUOTE_NOT_DRAFT
control: ZZ-VAL pricing-authority  status=draft   PASSED (write would proceed)
```

**What 8 does not prove:** the HTTP transport. It proves the guard refuses this
quote. That the guard is what a mutator reaches *first*, before any write, is
asserted separately in `tests/unit/production-cost-lifecycle-guard.test.ts`.
Stated rather than glossed, because "the server refuses" and "this function
refuses" are different claims.

A draft fixture perturbed while attempting the transport proof
(`ZZ-VALIDATION-pricing-authority`, R&D tier 1) was restored to `123454.00` and
verified.

---

## Held at the push

**Frozen quantity is 2,000, not 1.** The verification list expected quantity 1 on
the emitted service line.

2,000 is the governed shape, not a defect. Quantity 1 is what
`commercial-projection.ts` emits for **assembly-owned** separately billed OTC
fees; a Direct Service is deliberately excluded from that emitter —
`if (!assemblyId) continue; // a Direct Service's production is its own unit line`
— so its economics ride its own unit line at tier quantity. Quantity 1 is not
reachable for a Direct Service today. See
[`trace-direct-service-allocation-off.md`](trace-direct-service-allocation-off.md).

Pushing would create a Sales Order whose line shape contradicts the stated
check, and the push is the one irreversible act in the lifecycle. Holding for
disposition.

---

## Logged, not repaired

**Display defect · the Price Build calls the priced service unpriced.**
Selecting *Testing / Micros* in the Price build unit switch renders "Testing /
Micros has no costs entered yet … Enter costs on Costs, then come back", while
the same screen shows that unit at 28.6% / $2.24.

`pricedUnits` (`pricing-surface-shell.tsx:773`) decides by scanning **packaging
rows only**:

```ts
const rows = packagingRows.filter((r) => ids.has(r.quoteSkuId));
if (rows.some((r) => r.unitCost !== null)) out.add(unit.id);
```

A pure Direct Service has no packaging rows, so it reads unpriced whatever
production carries. Display-only — SEND gates on structure and tier quantity,
not unit cost, and the quote sent normally. The adjacent comment claiming this
"reads the same signal the Send gate reads (an unentered `unitCost`)" is stale;
the Send gate reads neither.

**Method note · a stale cache produced a false negative.** The first read of
Pricing after a verified-green deploy on HEAD returned `NOT PRICED`. A
cache-busted load returned the priced figures. Trusting the first read would
have recorded "the fix did not work" and started diagnosing a defect that did
not exist. Post-deploy reads are indeterminate until cache-busted.
