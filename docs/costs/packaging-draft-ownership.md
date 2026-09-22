# Packaging draft / pending ownership — repair, and what it does not close

Branch `fix/costs-draft-ownership`, from `5ac569d7`. Uncommitted. Database-free
verification only; Codex owns the browser and DB runs.

Repair brief: `focus-tab-regression-review.md` in
`C:/Code/nexus-validation-runs/financial-parity-diagnosis-20260918`.

---

## 1. What was wrong

`PackagingTierCell`'s sync effect set the local value from the store
unconditionally:

```tsx
useEffect(() => {
  setUnitCost(storeUnitCost ?? "");
}, [cell?.rowId, storeUnitCost]);
```

The provider's wait-for-quiet (`QUIET_PERIOD_MS = 800`) does not cover this. It
defers reconciliation while the operator is **typing**; both measured failures
are operators who had **paused**:

| Failure | Mechanism |
|---|---|
| Adjacent cell | Tier 1's save response lands, its revalidation delivers a snapshot in which tier 2 still holds its stored value, and the effect writes that over tier 2's open draft. Measured as `2.3456` → `0.5` with the caret still in the field. |
| Same cell, newer unsaved draft | An older receipt arrives after the operator has typed again. A generation advanced only on **save** still matched it, so the receipt cleared the dirty flag for a value that had never been sent, and the next reconcile took the field. |

Both reproduce identically on pre-M2 `5ac569d7` — pre-existing, not M2.

## 2. What was repaired

**`src/components/costs/packaging-drilldown.tsx`** — the only source file
changed. Two independent axes, because one flag cannot express both questions:

- **`draftGen`** advances on every **keystroke** and on a change of row
  identity. Answers *"has the operator typed since this save was dispatched?"*
  A completion carrying an older generation may report itself but may not clear
  the dirty flag, revert the field, or hand ownership back.
- **`saveSeq` / `lastAcked`** order the **responses**. Answers *"has a later
  attempt for this cell already been answered?"* A superseded outcome —
  success or failure — describes a state the cell has moved past and is
  dropped.
- **`inFlight`** (a set of dispatched, unanswered tickets) plus `dirtyRef` form
  the ownership predicate the sync effect consults. A **clean** cell still
  takes cross-tab updates; that is the behaviour the effect exists for.
- **`committedRef`** is the last **server-accepted** value and the rollback
  target. An accepted save advances it *before* the ownership check, so it
  advances even when a newer draft is open; a failure reads it **at failure
  time**, not at dispatch. This is the case the review flagged: an earlier
  acceptance arriving mid-flight must become the newer save's rollback baseline
  without clobbering the draft.
- **Row identity change** orphans the draft and any open save (`rowIdRef`), so
  a completion cannot advance a different row's baseline or attach its error to
  it.

The same contract was extended to the row's **markup** field, which had a dirty
flag but no generation and no in-flight guard: `markupGen` advances per
keystroke and on the category auto-fill; `metaInFlight` holds the field while a
line-meta save (every one of which carries a markup in its payload) is
unanswered; the success and rollback paths only touch the markup when the
generation still matches. Vendor and category semantics are untouched.

### Explicitly not done

No timer, no quiet-period of its own, no bounded release. No optimistic
store-equality treated as server confirmation. No input disabled while a save
is in flight (Pattern 47(e)). No new costing engine, no UI redesign, no change
to the server writer, to Freight, or to `costing-store-provider.tsx`.

## 3. Verification (real exit codes, this worktree)

| Check | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| `npm run test:unit` | **3263 pass / 0 fail**, exit 0 |
| `npm run verify:ci` | exit 0 (includes `verify:autosave-focus-stability`) |

New mounted coverage —
`tests/unit/packaging-cell-draft-ownership.test.tsx`, 11 tests, driving the
**real** `CostingStoreProvider` (real 100 ms debounce, real 800 ms quiet poll)
with an injected writer whose responses the test releases by hand. Covers:
adjacent-cell draft survival; older receipt vs newer unsaved draft in the same
cell; clean cross-tab update still applies; ownership released after a
confirmed commit; governed and thrown rollback; stale failure reports without
reverting; **accepted earlier save becomes the later save's rollback
baseline**; out-of-order responses; row-identity reset; input never disabled.

`tests/unit/canonical-attachment-operator-boundary.test.ts` — two source-shape
tests were re-aimed. They asserted the *spelling* of the code this repair
replaced (`preEditRef`, a second `const rollback = …` closure). The invariants
they protect — both write paths revert on a **thrown** failure as well as a
governed one, and the rollback target is never read back from the optimistic
store — are preserved and now also asserted behaviourally by the mounted
tests. The rewritten versions additionally lock the ordering the old shape
could not express (the baseline advances *before* the ownership check, and a
keystroke never advances it).

**Falsification.** Each control was run against a deliberately broken source
(mutate one line → run → restore; the script was throwaway and has been
deleted, the source restored and re-verified). Every control expressed the
failure it is used to exclude:

| Mutation | Detected by |
|---|---|
| ownership guard removed (the baseline defect) | mounted suite |
| `draftGen` no longer advanced by a keystroke | mounted suite |
| response ordering (`lastAcked`) removed | mounted suite |
| accepted save no longer advances the baseline | boundary suite |
| failed write no longer restores the store | boundary suite |

## 4. What this does NOT close — the markup restoration

**Still open. Diagnosed, not repaired.** Reproduced by the pre-existing
`costs-reconciliation-ordering` browser test: markup `0.0444` sent, action
returned `ok` with `markupPct 0.0444`, UI shows `20`.

The trace already excluded an omitted request and a bad parse. The code path
that remains is a **stale snapshot applied over a confirmed write**:

1. `updateAssemblyLeafInputLineMeta` succeeds. The success path does not set
   the input directly — it calls `updateLineMeta`, and the sync effect renders
   the field from the store (`packaging-drilldown.tsx`, the `storeMarkupPct`
   effect).
2. An optimistic store write does **not** advance `lastAppliedRevision`
   (`costing-store.ts`, `updatePackagingLineMeta`).
3. A snapshot produced by an **earlier** action's revalidation (RSC tree in
   that action's response) therefore still satisfies the store's only ordering
   gate, `snapshot.revision <= s.lastAppliedRevision` — it is newer than the
   last *applied* snapshot while predating the operator's write.
4. Its `packaging` slice carries the pre-write markup. The row is clean by
   then, so it is adopted, and `20` returns.

**Why the repair above does not reach it.** Ownership is released when the
commit is confirmed — which is required: a cell nobody is editing must show
what the server holds. The reverting snapshot arrives *after* that release.

**Why it is not fixable in this file.** Client-side, a snapshot carrying the
old value is indistinguishable from a genuinely newer one in which another
operator changed it back. Every client-only rule that could separate them is
one of: a timer (the rejected `CONFIRM_TIMEOUT_MS` heuristic — time does not
prove freshness, and a timeout postpones the loss rather than preventing it),
value equality against a store that carries this component's own optimistic
write (not server confirmation), or never accepting remote changes. All three
are excluded by the brief, and correctly.

**Why the existing marker is not the answer.** The provider's causal gate
(`awaitedRevision`, `CAUSAL_TIMEOUT_MS`) is armed from exactly one call site —
`freight-drilldown.tsx:228`. The packaging writers return no revision, so
Packaging never arms it. Arming it would not be sound anyway: the marker is
`pg_snapshot_xmax(pg_current_snapshot())` (`actions/costing.ts:1867`), and the
gate compares `snap.revision < awaited`. Codex falsified the ordering claim
locally with no application row touched — transaction A allocated xid 12608 and
stayed open, B allocated and committed 12609; the snapshot **before** A
committed was `12608:12610:12608` and **after** was `12610:12610:` — xmax
`12610` in both. An equal marker passes the gate, so a pre-commit snapshot is
applied. `xmax` is a bound, not a commit order.

### Concrete proposal (not implemented — needs DB work and a Codex decision)

Compare the **full snapshot**, which is exact, rather than `xmax`, which is
not. No migration, no schema change, no new table.

1. Each quote-scoped writer returns its own transaction id, captured **inside**
   the writing transaction: `pg_current_xact_id()::text`.
2. `getCostingBundle` returns `pg_current_snapshot()::text` — the whole
   `xmin:xmax:xip_list` — alongside (not instead of) today's `revision`.
3. The client holds a snapshot until it **provably contains** the awaited
   write. Parsing `xmin:xmax:xip_list`, a committed `xid` is visible iff
   `xid < xmin`, or (`xid < xmax` **and** `xid ∉ xip_list`).

That test decides Codex's own counterexample correctly in both directions: in
`12608:12610:12608`, xid 12608 is in `xip_list` → **not** visible, so the
pre-commit snapshot is held; in `12610:12610:`, `12608 < xmin` → visible, so
reconciliation resumes. It is an exact answer to *"does this read see that
write"*, not a heuristic — which is what the `xmax` comparison was standing in
for.

Deliberately **not** done here: it changes `getCostingBundle` and the writer
contract that Freight already depends on, it needs DB verification this session
could not run, and the brief reserves that call. The client half is also not
pre-wired — dead code that reads a field nothing supplies is not a repair.

## 5. Also observed, not repaired (out of scope)

- **Line-meta response ordering.** `fireMetaSave` is shared by vendor,
  category and markup; overlapping saves have no `lastAcked` equivalent, so an
  older completion can still write a stale `canonicalRef`. Only the *markup*
  axis was given a generation, to keep VAL-104 and P2-014 untouched.
- **`ProductionDrilldown` / `DirectServiceProduction` tier cells** synchronise
  from props unconditionally — the same source shape, not reproduced as
  defects. The review already lists them as M3 risk candidates.

## 6. For Codex

Browser runs on `:3102` against this branch. Expected to flip green:
`costs-focus-tab-commit.spec.ts` (both tests — assertions unmodified).
Expected unchanged: `costs-reconciliation-ordering` (the markup case above
remains open), `line-meta-clear-persistence`, `vendor-search-query-ownership`.

---

## 7. Verification follow-up — September 19, 2026

The implementation advanced after the original database-free repair review:
the full-snapshot witness protocol described in §4 is now wired through the
costing readers, successful write actions, store reconciliation and provider
prefilter. Section 4 and the expected browser outcomes in §6 are historical
checkpoint notes; they no longer describe the current branch. The witness
protocol fails closed on malformed/missing evidence and only arms after an
acknowledged write. It does not use a timer as proof of freshness.

Verified on `fix/costs-draft-ownership`, against the isolated browser app on
127.0.0.1:3102 and the marked local validation database on 127.0.0.1:55432.
The user's 3101 preview was not used or restarted. Browser networking remained
loopback-only; fixture reset/seed was owned by the Playwright validation
harness.

| Check | Result |
|---|---|
| `verify:types` | passed |
| `verify:autosave-focus-stability` | passed |
| full `test:unit` | **3,332 passed, 0 failed** |
| `costs-focus-tab-commit.spec.ts` | **2 passed** |
| `costs-reconciliation-ordering.spec.ts` | **2 passed**, including the markup/reconcile regression |

This closes the reproduced focus/save and markup-restoration regressions for
this local branch. It does **not** certify broader Costs/Pricing browser
acceptance, a fresh-environment merge gate, or authorize merge, deployment,
migration, or production data writes. The broader M1 acceptance items remain
tracked in `docs/validation/setup-costs-financial-parity-m1.md`.

Working tree carries only the repair, its tests, and this document — four
paths, listed in §3 and §2. Everything is uncommitted, as asked.
