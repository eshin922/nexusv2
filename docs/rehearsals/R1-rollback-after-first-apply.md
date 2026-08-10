# R1 · Rollback after first Apply

**Gate:** before deploy. Phase 3 cannot claim reversibility without this.
**Settles:** [OD-003](../OPEN_DECISIONS.md).
**Run:** 2026-08-10, Phase 3 Package 1, isolated validation environment.

---

## 1 · Objective

Phase 3 §2 R1 states the question, and it is deliberately not the obvious one:

> The question is **not** whether the current runtime renders lifts — it does
> not, because they do not exist. It is **what happens when a runtime without
> lift support meets a database containing them.**

Three outcomes, each with a different commercial consequence:

| Outcome | Consequence |
|---|---|
| **absorbs** | consumes rows it cannot explain · silent wrong price |
| **ignores** | computes a different price from the one displayed before rollback |
| **rejects** | fails visibly on the state |

## 2 · Prerequisites

- Validation environment, isolated at the **server**: PostgreSQL 16.14 in a
  local container, against production's 17.6 on Supabase. A tunnel cannot
  report a different major version.
- Migration `0063_pricing_lift_persistence` applied (62 migrations).
- The R3 operator fixture: 6 leaf SKUs × 4 tiers, 24 cells.
- Two runtimes, **both pointed at that same database**:
  - **Phase 3** — `phase-3/package-1-lift-persistence`, port 3100
  - **pre-Phase-3** — a git worktree at `bcd6469`, port 3101

The old runtime is *run*, not simulated. Passing `lifts: []` on the new branch
would model its behaviour and would very likely be right — but "very likely
right" is an argument, and R1 asks for a measurement.

## 3 · Steps

1. Open the quote on the Phase 3 runtime. Stage a surgical lift through
   CellAction: **Bottle · MOQ · 1,000 units**, at 21.0%, below the 25% floor.
   The panel offers a **5.3%** lift that clears it and affects no other cell.
2. **Apply.** One row lands in `quote_leaf_lifts`:
   `lift_pct = 0.0527`, keyed `(quote_leaf_id, tier_id)`.
3. Navigate away and back. The lift holds.
4. Capture the six comparisons on the Phase 3 runtime.
5. Capture the same six from the pre-Phase-3 runtime against the same rows.
6. Diff.

Numeric captures come from `scripts/rehearsal/r1-rollback-after-apply.ts`,
which runs unchanged on both runtimes. Rendered captures come over HTTP from
each runtime's own app.

## 4 · Results — the six comparisons

| # | Comparison | Phase 3 | pre-Phase-3 | |
|---|---|---|---|---|
| 1 | Computed sell · Bottle MOQ | **$15.932614** | **$15.135** | differs |
| 2 | Displayed sell (Pricing grid) | **25.0% · $15.93** | **21.0% · $15.14** | differs |
| 3 | Margin · that cell | **24.9966%** | **21.04%** | differs |
| 4 | Customer View unit price | **$15.93** | **$15.13** | differs |
| 5 | Customer PDF | 42,122 bytes | 42,119 bytes | differs |
| 6 | Completion / NetSuite amount · MOQ tier | **$19,732.61** | **$18,935.00** | differs |

Supporting counts:

- **23 of 24 cells identical.** Only the lifted cell moved. Nothing leaked.
- Tiers 2, 3 and 4 NetSuite amounts identical to the cent
  ($56,995.00 · $118,575.00 · $219,355.00).
- Blocked-tier count: **3 tiers below floor** → **4 tiers below floor**.
- APPLIED bar: **"1 pricing adjustment in effect on this quote"** → **absent**.
- `liftsInInput`: `1` → `field-absent` — the clearest single marker of which
  runtime produced a document.

On the PDF: both runtimes serve it from `resolveCustomerView`, whose output is
comparison 4 and differs. Decompressed streams are the same length and diverge
first inside the embedded font subset, which is what a changed digit produces.
The PDF is recorded as differing because its input differs and its bytes
differ; the rehearsal does not claim to have read the rendered glyphs.

## 5 · Outcome

> ## `ignores`

The old runtime did not error, so it is not `rejects`. It did not consume the
lift rows, so it is not `absorbs`. It **computed a different price from the one
displayed before rollback** — which is `ignores`, the middle row, and the one
whose failure is quietest.

**What that means commercially.** A cell that had been brought to exactly the
25% floor reverts to 21.04% and becomes a floor breach again. A quote that read
as one tier from sendable reads as four tiers blocked. A customer looking at
$15.93 would be quoted $15.13. The NetSuite amount for that tier falls by
**$797.61** — 1,000 units × the $0.7976 the lift added.

Nothing warns. The old runtime has no concept of the rows, so it has nothing to
warn about; every number it produces is internally consistent and wrong only by
reference to what was displayed before the rollback.

## 6 · Pass / fail

**PASS as a rehearsal.** R1 asks for the outcome to be *named with evidence*,
not for a particular outcome. It is named, and it is measured on both runtimes
against one database.

Phase 3's reversibility statement can now be made in full rather than left
open:

- **Before first Apply** — cleanly reversible. No rows exist; the two runtimes
  agree exactly.
- **After first Apply** — reversible with a **known and bounded** consequence:
  prices revert to their pre-lift computation, silently, on exactly the cells
  that carry a lift row and no others.

**The rollback procedure that follows from this.** Because the failure is
silent, rolling back the runtime is not sufficient — the rows must go with it:

```sql
-- Run BEFORE deploying a pre-Phase-3 runtime. Reverts every price to the
-- computation the old runtime will produce anyway, but visibly and on purpose.
DELETE FROM quote_leaf_lifts;
```

Deleting the rows makes the two runtimes agree exactly (the 23-of-24 result
above is the proof: with no lift rows, every cell matches). What must not
happen is a runtime rollback that leaves the rows in place, because then the
displayed price changes and nothing says so.

The table is additive, so a runtime rollback **without** the DELETE is safe in
the structural sense — nothing crashes, no data is lost, and re-deploying the
Phase 3 runtime restores every price exactly. The exposure is a window during
which quoted prices are lower than the ones the operator approved.

## 7 · Evidence

| Artifact | Path |
|---|---|
| Phase 3 capture | `docs/rehearsals/evidence/r1-phase3.json` |
| pre-Phase-3 capture | `docs/rehearsals/evidence/r1-pre-phase3.json` |
| Capture script | `scripts/rehearsal/r1-rollback-after-apply.ts` |
| Audit trail of the Apply | `audit_log` — `pricing_adjustments_applied` root + `pricing_lift_applied` derived |

Both captures were produced within minutes of one another against an unchanged
database, so the only variable is the runtime.

## 8 · Known exclusions

- **One lift, one cell.** The mechanism does not vary with count — the diff is
  per-row and the 23 unaffected cells demonstrate isolation — but a
  many-lift quote was not measured.
- **Direct prices and tier adjustments were not in effect** during the
  comparison. Both predate Phase 3 and are read identically by both runtimes,
  so they cannot contribute a divergence; they were cleared to isolate the
  lift.
- **The PDF was compared as bytes and by its input, not as rendered glyphs.**
  See §4.
- **No accepted or complete quote was rehearsed.** Lifts are draft-only
  authoring data guarded by `requireDraft`, so a sent quote cannot acquire one;
  the rows a rollback could meet on a sent quote are rows written while it was
  a draft, and those behave as measured here.
