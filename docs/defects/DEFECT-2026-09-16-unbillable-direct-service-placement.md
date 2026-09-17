# DEFECT · Direct Service charge placed on a separate line, billed to nobody

**Raised 2026-09-16 · tracked, NOT investigated, NOT repaired. The affected
quote is not touched.**

## What it is

A Direct Service leaf has no parent assembly. The customer projection keys
separately-billed one-time lines per assembly — `otc:${assemblyId}:${field}` —
so a charge owned by such a leaf has no key to bill under.

Placed at `separate_line` anyway, the engine counts its recovery as tier revenue
while the document bills nothing for it.

## Known amounts

Quote `4781e4bb`, as recorded in `src/lib/commercial-recovery/unbillable-placements.ts`:

```
$1,727.60  /  $3,283.00  /  $172.20  /  $1,727.60      across four tiers
```

Revenue the margin math believed in and the customer was never asked to pay.

## Current containment

- **Electing it is refused** — `DIRECT_SERVICE_NOT_SEPARATELY_BILLABLE`.
- `isUnbillablePlacement({ ownerKind, placement })` is the single rule, read by
  both the detector and the engine, so there is one authority on whether a quote
  may go out.
- The detector reads the **constructed** state rather than the persisted
  election, so a placement arriving by any route is caught.
- The send gate refuses; an operator decides.

## Why nothing here repairs it

Correcting one of these changes what a real customer owes. The module detects
and reports; it moves no number. **A silent repair would be a commercial
decision taken by a deployment.**

## What a separate investigation would need to establish

1. Which quotes hold such a placement today, and at what amounts.
2. For each: was the quote sent, accepted or completed, and did the customer pay
   a total that included revenue never billed?
3. Whether any NetSuite Sales Order carries the discrepancy.
4. Who decides the correction per quote, and whether a revision is owed.

None of this is in scope for #596, and none of it should be folded into a
feature change.

## Related

- `src/lib/commercial-recovery/unbillable-placements.ts` — the rule and the detector
- `docs/business-validation/fee-charge-decisions.md` §1 — the same keying
  asymmetry reached from the charge-instance side: component charges key
  `otc:instance:<id>` and bill for any owner, which is why they are the
  preferred mechanism
