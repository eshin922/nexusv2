# Trace — Direct Service one-time fees under allocation OFF

Opened 2026-08-19 at Edward's direction, during the CERT-303 walk. **Traces the
ownership/emission boundary and establishes the intended behaviour question.
Repairs nothing.**

---

## The observation that opened it

Every one-time service fee column prices at **0** on a Direct Service when
`allocateServiceFeesToCost` is false. The three COGS columns are unaffected:

```
field                  alloc=ON   alloc=OFF
testingMicrosTotal       2.24        0
rdTotal                  2.24        0
otherServiceTotal        2.24        0
setupFeeTotal            2.24        0
toolingTotal             2.24        0
artworkTotal             2.24        0
fillingBlendingCost      2.24       2.24
cmAssemblyTotal          2.24       2.24
bulkRawCost              2.24       2.24
```

Engine driven directly, $3,200 through one column at a time, 2,000 units, 40%
Production markup.

---

## Where the two halves are

**Costing side.** `oneTimeServiceFeeTotal` enters unit cost only when the fee is
allocated. With the flag false the fee is deliberately excluded — it is
*separately billed*, so folding it into the unit price would bill it twice.
Correct in isolation.

**Emission side.** `commercial-projection.ts:313-321` builds the separately
billed OTC lines per `(assembly, fee column)`:

```ts
for (const p of bundle.production) {
  const leaf = skuById.get(p.quoteSkuId);
  const assemblyId = leaf?.parentSkuId ?? null;
  if (!assemblyId) continue; // a Direct Service's production is its own unit line
  ...
}
```

The comment states the assumption plainly: **a Direct Service's production is
its own unit line.** That holds while the fee is allocated. It stops holding the
moment the fee leaves the unit line — and the emitter that would carry it has
already skipped the row.

So with allocation OFF the charge is removed by one half and not picked up by
the other. It reaches no line at all. Same operator-side signature as #298: a
cost authored, saved, displayed, and absent from what the customer is charged.

---

## But it is not currently reachable

Checked before characterising it as a live defect:

| | |
|---|---|
| `direct-service-production.ts` writes the flag | **never** — grep returns nothing |
| schema default | `NOT NULL DEFAULT true` |
| the only writer, `updateAssemblyProductionPolicy` | `where(eq(assemblyProductionInputs.assemblyId, assemblyId))` |
| a Direct Service row's `assemblyId` | **NULL** — so the writer cannot match it |
| live population | 5 Direct Service rows, **0** with `allocate=false`; 16 assembly-owned rows with `false` |

The toggle also reports itself inert on a quote with no Item Groups —
"→ no assemblies on this quote" — and the aggregate it reads is computed over
`assemblies` only.

**So a Direct Service row is created allocated and nothing can flip it.**

That is the finding, and it is worth more than the defect would have been:
the invariant holds by an **accident of keying plus a column default**, not by
construction. Nothing asserts it. Pattern 56 — a property that holds by
coincidence reads exactly like one that holds by design, right up until
something changes.

**What would open it**, none of which would look dangerous in review:

- a policy writer generalised to key on the leaf rather than the assembly
- a quote-wide "separately bill all service fees" affordance
- a copy path cloning an assembly row's policy onto a service row
- any backfill or migration touching the column

---

## The question to settle (not settled here)

For a Direct Service one-time fee, which is intended?

**(a) Always allocated.** The flag is meaningless without an assembly. Make that
explicit — a CHECK, or a guard refusing `false` where `assemblyId IS NULL` — so
today's correct behaviour becomes the only *representable* one rather than
merely the only reachable one. Cheapest, and it closes the gap permanently.

**(b) Emit a Direct-Service-owned OTC line at quantity 1.** Extend the emitter
past the `continue`. This is what quantity-1 accounting semantics would require,
and it is the assumption behind the CERT-303 checkpoint's "quantity 1". It also
changes what a Direct Service line looks like on the Sales Order, so it is a
commercial decision, not a repair.

**(c) Refuse at authoring.** A Direct Service with allocation OFF is an
unsendable state, surfaced as a warning.

(a) and (b) are not exclusive: (a) can hold until (b) is deliberately built.

---

## Bearing on CERT-303

CERT-303's Testing line is allocated, which is the only reachable state. Its
frozen shape — 2,000 × $2.2400 = $4,480.00 — is therefore the governed shape
for a Direct Service today, not an artefact of how the fixture was configured.
Quantity 1 is the shape for **assembly-owned** separately billed OTC fees, and
is not reachable for a Direct Service without decision (b).
