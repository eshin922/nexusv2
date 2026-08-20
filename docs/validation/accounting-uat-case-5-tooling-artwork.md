# Accounting UAT — Case 5 · Tooling / Artwork split

**PASS**, 2026-08-20, against `390b119`.

The plan said Case 5 needed "nothing further but a fixture carrying separate
tooling and artwork amounts." That fixture now exists, authored through the
operator UI.

## Fixture

`ff90d502-28a1-4a11-bbd5-75e1b5b916e8` — `ZZ-VALIDATION-drag-drop`, draft,
Item Group `ASY-DRAG-2`. Authored on the Costs → Production drilldown:

```
Tooling total   3000.00     (own row, category Tooling, one-time)
Artwork total   1000.00     (own row, category Tooling, one-time)
tooling_artwork_total  NULL (the legacy combined column stays empty)
```

Both rows carry markup **40.0%**, which is BV-013's Production authority in
effect — independent corroboration of #310's decomposition.

## Proof set

| claim | evidence |
|---|---|
| the split is separately AUTHORABLE | live UI walk above; `tooling_total` and `artwork_total` persisted independently, legacy column untouched |
| both destinations are mapped | `netsuite_destination_item_map`: `otc_tooling → OTC-0005 / 4077`, `otc_artwork → OTC-0001 / 11012` |
| they carry DIFFERENT item types | `bv011ItemType("otc_tooling") = inventory`, `("otc_artwork") = non_inventory` |
| the columns route to those destinations | `OTC_COLUMN_DESTINATION.toolingTotal = "otc_tooling"`, `.artworkTotal = "otc_artwork"` |
| they project as SEPARATE lines | `tests/unit/bv011-destination-split.test.ts` — *"Tooling and Artwork project as SEPARATE lines carrying their own destinations"* |
| the legacy combined charge BLOCKS projection | `scripts/gate-1b/bv011-walk-proof.ts` check 6 against `97d25286` (CERT-300 frozen line set) |

Check 6 output:

```
PASS  projection is BLOCKED, not skipped
PASS  the blocker names the legacy combined charge specifically · legacy_combined_otc
PASS  exactly ONE line is legacy combined, not every null-destination line
PASS  the remediation names both governed inputs and where to enter them
```

The remediation reads: *"…is a legacy combined Tooling + Artwork charge. BV-011
governs those as separate destinations with different item types, and no rule
can say which half this amount is. Resolve it into the Tooling and Artwork
inputs on Costs, then revise and re-send."* — which now names an action the
operator can actually take, because the split inputs exist.

## What is NOT proven, and why

**No live NetSuite Sales Order carrying the two split lines.** Reaching a frozen
snapshot at an accepted tier requires Mark Accepted, which pushes a **production
HubSpot deal stage**. Every available draft fixture — `ff90d502`, `4781e4bb`,
`52bd0077` — sits under project *Smart Pressed Juice · Juice Cleanse Reorder
2026*, which is HubSpot-linked. Transitioning a real deal stage for testing is
prohibited, so the walk stops at the projection boundary by policy, not by
defect.

The projection behaviour itself is proven at the level below: the emitter's
line-splitting is unit-covered, both destinations resolve to live NetSuite
items, and the legacy refusal is proven against a real frozen line set.

Closing the remaining gap needs a fixture in a project with **no** HubSpot deal
linkage. That is a fixture-provisioning decision, not a Case 5 defect.

## Instrument defect noted (not repaired here)

`bv011-walk-proof.ts` check 6 ends with `FAIL NOTHING was committed — no
injected line, no accepted tier` when run against a **complete** quote. The
rollback is clean — zero injected lines, and the witness's `updated_at` predates
the run — but the assertion tests "the quote has no accepted tier", which a
complete quote legitimately has. Its own header says to pass a *sent* quote.

The check cannot distinguish its own residue from pre-existing legitimate state,
so it reports the wrong one. Same family as the collided-key defect in the Case
6 harness: a check that cannot express the difference between two states will
confidently report the wrong one.
