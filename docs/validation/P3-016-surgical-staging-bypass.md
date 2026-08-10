# P3-016 · Recommendation CTAs bypass the R12 staging contract

**Status: OPEN — release blocker. Not repaired. One runtime observation
outstanding.**

**Discovered:** 2026-08-10, after the compliance audit closed. New row, not a
reopened one — IDs are append-only, so this takes the next free number in the
P3 block.

---

## The conflict

Two accepted positions, both currently true in the repository, that cannot both
be honoured.

| | says |
|---|---|
| **R12 interaction contract** *(accepted)* | The recommendation **stages first**. Page-level Apply persists the working set. |
| **Implemented model** *(shipped, commented, unit-tested)* | Per-tier adjustment is an **immediate-write lever authored outside** the working set. |

This is a **contract conflict**, not a wiring defect. The distinction decides
the repair: nothing here is unwired, and a one-line fix would silently pick a
winner between two accepted positions.

### Where the bypass is encoded as intentional

| location | |
|---|---|
| `src/app/actions/pricing-lifts.ts:94` | *"Nothing STAGES one of these — `applySurgicalAdj` and `applyGlobalAdj` write…"* |
| `src/lib/pricing-apply-plan.ts:50-51` | *"The fourth lever, and the one that is authored elsewhere… write `quote_tiers.tier_price_adj_pct` immediately"* |
| `src/components/pricing-surface/pricing-staging-context.tsx:351, 495` | Seeds around *"the layer (`applySurgicalAdj`) that revalidates without remounting"* |
| `tests/unit/pricing-apply-plan.test.ts:133` | **"The load-bearing case."** Asserts the write happens outside staging |

**A passing unit test calls the bypass load-bearing.** Any repair changes that
test — which is why this is a package, not a patch.

## Static determination — sufficient, and already made

The `Apply Surgical →` CTA (`action-zone.tsx:281`) is wired: `onApply` is
supplied (`pricing-surface-shell.tsx:574`), the handler runs, and it calls
`applySurgicalAdj` (`pricing-apply.ts:146`) — a direct write to
`quote_tiers.tier_price_adj_pct` plus an audit row. **No path from this CTA
stages anything.** The shell consumes `usePricingStaging()` but reads only
`previewResult` from it.

## The one runtime observation still required

**Exactly one click. Nothing further until the first mutation is fully
recorded.**

Against the isolated validation environment:

1. Record the target tier's `quote_tiers.tier_price_adj_pct`.
2. Click the Surgical recommendation **once**.
3. Capture the returned action result.
4. Immediately re-read the database value.
5. Record whether staging chips / deltas / working-set state changed.

### Classification branches

| observation | classification |
|---|---|
| **DB changed · staging unchanged** | Silent immediate-write / R12 staging-bypass defect |
| **DB unchanged** | Locate the failure after `applySurgicalAdj` |

## Before implementation — classify the second caller

**`pricing-surface-shell.tsx:238`** is a second `applyGlobalAdj` call site,
inside `onApplyGlobalPreview`. It has not been read.

**Caller audit as it stands:**

| action | production callers |
|---|---|
| `applySurgicalAdj` | `shell:156` — the CTA path only |
| `applyGlobalAdj` | `shell:171` (sibling CTA) **and `shell:238`** (detail-zone preview Apply) |

**Audit surgical and global together.** Two visually equivalent recommendation
paths must not carry different persistence semantics — that is a worse outcome
than either behaviour chosen consistently.

## Repair package — conditions, when it is authorised

If the global path is also an old immediate-write contract, both are repaired in
**one** release-blocker package:

- the working set carries **all** operator pricing levers;
- recommendations **stage existing solver outputs** — **no new arithmetic**;
- **page-level Apply owns persistence**;
- update or remove the comments and unit tests that encode the bypass as
  load-bearing, rather than leaving them contradicting the shipped behaviour;
- immediate-write actions survive **only** if a separately governed workflow
  genuinely requires them;
- rejected and throwing action paths surface **visibly**;
- a rendered surgical CTA with no surgical suggestion **fails loudly** —
  `onApply` currently has two guarded branches and no else, so that state
  returns silently today.

## Browser proof required to close

1. Recommendation click creates **staged state**.
2. Preview / deltas appear.
3. **Database does not change** before page-level Apply.
4. Discard restores the committed state.
5. Page-level Apply persists **exactly once**.
6. Reload reflects the persisted state.
7. **Surgical and global obey the same interaction contract.**
8. Thrown / rejected paths surface visibly rather than failing silently.

## Standing constraints

- **BASELINE-01 is immutable.** This work does not touch it.
- **S-7 must not move.** The repair changes where a lever is persisted, not what
  any commercial value is.
- VAL-101 classification resumes from the `frame.join` runtime failure **after**
  this blocker closes.
