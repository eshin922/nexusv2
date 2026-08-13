# Recovery certification harness — STALE

`scripts/smoke/mark-complete.ts` cannot certify grouped ambiguous-CREATE
recovery against current code. Registered 2026-08-13; **not** modernised, per
disposition — the fixture work sits outside the current risk/velocity threshold.

## Findings

1. **It predates the accepted-snapshot lifecycle.** `provision()` inserts
   projects, quotes, tiers, assemblies, assembly_leaves, cost inputs, deal cache
   and customer map — but **no `quote_snapshots` row**. `mark-complete.ts:196`
   therefore throws before reaching any NetSuite call:
   `Accepted Quote must resolve exactly one active sent snapshot; found 0.`
2. **It provisions `detail_level = 'itemized'`** (a flat order), and
   `groupingRequired = applicability === "turnkey_only"`, so `groups` is empty.
3. **It therefore cannot exercise grouped ambiguous-CREATE adoption.** Even once
   (1) is fixed, a flat fixture reaches the flat-order guard, which refuses
   automatic adoption by design — proving fail-closed refusal, not adoption.

Its own TODO corroborates (2): *"REWRITE THIS TEST when group creation is
reinstated… under Slice 12's flat-lines path."*

## When recovery certification resumes

- Prefer a **synthetic/local deal-cache fixture that makes no production HubSpot
  write.** `markComplete` needs a `hubspot_deals_cache` row with an associated
  company, not a live deal, and the Complete-side amount patch
  (`runAmountPatchIfNeeded` → `updateDealAmount`) is covered by the certification
  suppression — to be re-verified before relied upon.
- The fixture must insert a `quote_snapshots` row with
  `detail_level = 'turnkey_only'` and `superseded_at IS NULL`.
- **Do not write a new tagged fixture into the shared production database unless
  separately authorized for that certification work.**

## Scope

This does not affect the shipped repair. `create-reconciliation-rules.ts` and the
`duplicate_deal` classifier are unit-proven and mutation-checked
(`tests/unit/netsuite-ambiguous-create-recovery.test.ts`). What remains
uncertified is the **live provider walk** of the adoption branch.

Cross-references: `netsuite-ambiguous-create-recovery-implementation.md`,
`netsuite-idempotency-probe-and-recovery-design.md`.
