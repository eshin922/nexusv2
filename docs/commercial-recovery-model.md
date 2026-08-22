# Commercial recovery — model and migration design

**Status:** design for approval. **Nothing implemented, no UI.**
Predecessor: [`quote-presentation-commercial-recovery-trace.md`](quote-presentation-commercial-recovery-trace.md).

Approved architecture: do not rebuild Quote projection. Add the recovery layer
at the existing `projectCommercial()` seam and freeze it at SEND using the same
live-column + snapshot convention the presentation axes already use.

---

## 0 · Two corrections to the trace, both load-bearing

**The `pass_through` freight subcategory is on a COMPLETE quote, not a draft.**
`Nemah - 15ml` / "NEXUS V1 ACCOUNTING REVIEW — SANDBOX · Item Group + freight",
`status = complete`. This changes the migration rule the direction anticipated:
it is **immutable historical truth**, not something to adjudicate before freight
consequence lands. It also means **no live draft exercises pass_through at all**,
so giving the vocabulary consequence cannot silently change any open quote.

**Mixed allocation is real, and one instance is already sent.** Three quotes
carry OFF and ON simultaneously:

    f2db6e10  draft  1 off / 1 on
    f5f5ac14  draft  1 off / 1 on
    a264a755  SENT   1 off / 1 on

The other five are uniformly OFF. So "do not flatten mixed state" protects three
real quotes, one of them frozen.

---

## 1 · Recovery-profile schema

Discrete enum columns, not JSONB — mirroring the presentation axes, which are
`pdf_layout` / `detail_level` / `include_spec_addendum` as typed columns. A JSONB
blob would be easier to extend and impossible to constrain, and this is
commercial configuration that reaches a customer document.

```sql
CREATE TYPE recovery_service_fees AS ENUM ('per_assembly', 'allocate', 'separate');
CREATE TYPE recovery_freight      AS ENUM ('bundled', 'separate_line');

ALTER TABLE quotes
  ADD COLUMN recovery_service_fees recovery_service_fees,   -- NULL = legacy
  ADD COLUMN recovery_freight      recovery_freight;        -- NULL = legacy

ALTER TABLE quote_snapshots
  ADD COLUMN recovery_service_fees recovery_service_fees,
  ADD COLUMN recovery_freight      recovery_freight;
```

Both nullable, no default, no backfill. **`NULL` is a value with a meaning**, not
an absence awaiting one — see §6.

### `per_assembly` is the load-bearing enum member

It is what makes "preserve assembly-level exceptions" representable rather than
promised. The quote-level profile can say *"defer to each assembly's own
`allocate_service_fees_to_cost`"* — which is precisely today's behaviour.

Consequences, all of them deliberate:

- today's behaviour is a NAMED state, not the absence of configuration;
- the three mixed quotes are expressible without flattening;
- `NULL` resolving to `per_assembly` is exact, not approximate;
- a UI can offer a quote-level default while `per_assembly` remains selectable,
  and choosing `allocate` or `separate` is an explicit decision to override
  exceptions — visible in the audit diff rather than silent.

**`allocate` / `separate` do NOT write the per-assembly column.** They override
it at projection time. The per-assembly values survive underneath, so switching
back to `per_assembly` restores the exceptions instead of resurrecting nothing.

## 2 · Live vs snapshot representation

Copied from the presentation axes exactly:

| | |
|---|---|
| working value | `quotes.recovery_*` — editable while `status = 'draft'` |
| frozen at send | mirrored into `quote_snapshots.recovery_*` inside the send transaction |
| draft read | `quotes.recovery_*` |
| sent read | `quote_snapshots.recovery_*` for the durable record |

Immutability after send is the Pattern 52 draft-lock: `assertNotFrozen(quote)` at
the top of the recovery writer. **These columns join
`docs/pattern-52-freeze-list.md`** (currently 30 columns) and inherit its
dependency — a future writer that skips the guard breaks reproducibility
silently, which is why the freeze list is grep-able rather than lore.

## 3 · Service-fee allocation representation

Resolution, in order:

```
resolveServiceFeeRecovery(profile, assemblyId, tierId):
    profile === null           -> per-assembly value   (legacy; see §6)
    profile === 'per_assembly' -> per-assembly value
    profile === 'allocate'     -> true   for every assembly
    profile === 'separate'     -> false  for every assembly
```

The per-assembly read is unchanged: `row?.allocateServiceFeesToCost ?? true`
(`commercial-projection.ts:334`). Only its SOURCE becomes conditional.

`assembly_production_inputs.allocate_service_fees_to_cost` remains the storage of
record for exceptions. Not deprecated, not migrated, not defaulted.

## 4 · Freight recovery vocabulary and migration

`recovery_freight`:

- **`bundled`** — freight amortises into unit price; no separate customer line.
  Today's universal behaviour, and what `freightLines: []` hardcodes.
- **`separate_line`** — freight is recovered as its own customer-facing line;
  `CustomerView.freightLines` is populated from the projection rather than being
  a constant.

**Migration from `freight_subcategories.treatment`: none, and that is the point.**

The field keeps its data and its internal display label ("pass-through" /
"bundled · amortised across units") in the Costs drilldown. It stops being — and
has never actually been — a source of commercial consequence. There is no branch
on it anywhere in arithmetic or projection today, so removing its *future*
candidacy for consequence changes nothing that runs.

No backfill from `treatment` into `recovery_freight`:

1. the only `pass_through` row is on a **complete** quote, which is immutable;
2. inferring a quote-level commercial decision from a per-subcategory label is
   exactly the two-sources-of-truth error the direction forbids;
3. `NULL → bundled` (§6) reproduces every existing quote's behaviour exactly.

**The `freightLines: []` constant becomes a resolution.** BV-009 stays the
default; it stops being a constant and becomes the `bundled` branch.

## 5 · `projectCommercial()` input/output changes

```ts
// before
export function projectCommercial(bundle: HydrateSnapshot): CommercialProjection

// after
export function projectCommercial(
  bundle: HydrateSnapshot,
  recovery: ResolvedRecovery,      // ← explicit second argument
): CommercialProjection
```

An explicit parameter rather than a field on the bundle, for three reasons:

- the seam is **visible at every call site**, so a caller cannot forget it;
- it is **trivially testable** — same bundle, different profiles, compare;
- the bundle is the engine's output, and recovery is not an engine input.
  Putting it there would blur exactly the boundary this slice exists to draw.

`ResolvedRecovery` is the resolved shape, never the raw columns — resolution
(§3, §6) happens once, at the edge, so no consumer re-derives it:

```ts
type ResolvedRecovery = {
  serviceFees: "per_assembly" | "allocate" | "separate";
  freight: "bundled" | "separate_line";
  /** Provenance, for the UI to say WHY — legacy quotes read "legacy". */
  source: "live" | "snapshot" | "legacy";
};
```

**Output changes:** `CommercialProjection.lines` gains freight lines when
`freight === 'separate_line'`, and `tierTotals` accounts for them. `CommercialLineKind`
gains `"freight"`. No existing field changes meaning.

**`projectCommercial` remains the single producer** for the customer document and
the frozen matrix. Both already consume it; neither changes.

## 6 · Backward-compatible resolution — absence means legacy

```
NULL recovery_service_fees  ->  'per_assembly'
NULL recovery_freight       ->  'bundled'
```

**These are not defaults. They are the exact behaviour that produced every
existing quote and every one of the 29 existing snapshots.** `per_assembly`
reproduces the per-assembly reads; `bundled` reproduces `freightLines: []`.

So an old snapshot rendered today produces byte-identical output to the day it
was frozen, without a backfill and without a migration touching it. Reading a
snapshot NEVER falls through to a new default, because the resolution of NULL is
pinned to the legacy semantics and asserted by test (§8).

`source: "legacy"` is carried so a surface can distinguish "nobody chose" from
"someone chose the same thing" — the distinction that a bare boolean loses.

## 7 · Authorization invalidation

**The mechanism already exists and needs no new code.**

`projectApprovalTierState` compares each authorization's stored
`state_fingerprint` against the fingerprint of current economics, and returns
`superseded` when they differ (`below-floor-approval-state.ts:113`). Recovery
changes revenue → changes `fingerprintCommercialState` → the authorization
becomes `superseded` automatically. The SEND gate re-decides from the bundle and
refuses.

So per the disposition:

- the recovery edit on a draft is **allowed** — no guard, no refusal;
- invalidation is **automatic**, not a new write;
- what must be BUILT is the **warning surface**: the recovery UI states, at edit
  time, that a live below-floor authorization will be superseded and approval
  must be re-requested before Tier-1 commitment.

Not a silent consequence discovered later at SEND — an operator who just chased
an approval needs to be told before they spend it.

## 8 · Invariants and test matrix

### The invariant that defines the boundary

> **Layer 1 is invariant under recovery.** For one bundle and any two recovery
> profiles, every internal cost scalar is byte-identical; only revenue,
> line composition and presentation move.

Falsifiable, in the shape the freight-attribution proof used — assert the
CONSTANT half explicitly rather than inferring it from the moving half:

```
for profileA, profileB:
    a = projectCommercial(bundle, profileA)
    b = projectCommercial(bundle, profileB)
    assert costing.skuRollups            identical   // untouched by construction
    assert every *CostPerUnit scalar     identical
    assert a.tierTotals[i].total       !== b.tierTotals[i].total   // it MUST move
```

The second assertion matters as much as the first: a test that only proves cost
did not move would pass against a profile wired to nothing.

### Matrix

| # | case | expect |
|---|---|---|
| 1 | `NULL` profile vs explicit `per_assembly`/`bundled` | byte-identical projection |
| 2 | all 29 snapshots re-projected with `NULL` | identical to frozen values |
| 3 | the 8 allocation-OFF quotes under `NULL` | economics exactly preserved |
| 4 | the 3 mixed quotes under `per_assembly` | exceptions preserved per assembly |
| 5 | mixed quote under `allocate` | uniform, and per-assembly rows **unwritten** |
| 6 | `allocate` → `per_assembly` round trip | exceptions restored, not lost |
| 7 | `bundled` → `separate_line` | freight lines appear; cost scalars unchanged |
| 8 | recovery edit with live authorization | state becomes `superseded`; SEND refuses |
| 9 | recovery write on sent/complete quote | refused by `assertNotFrozen` |
| 10 | send freezes profile into `quote_snapshots` | snapshot carries the resolved values |
| 11 | `freight_treatment` changed | **no** commercial consequence (one source of truth) |
| 12 | Layer-1 invariant | as above, both halves |

Case 11 is the one that keeps the direction's "do not make `freight_treatment` a
second active source" enforced rather than intended.

## 9 · Migration plan

**No data migration. No backfill. No default written anywhere.**

1. Two enums + four nullable columns. Additive; safe ahead of code (every
   existing writer keeps working without mentioning them).
2. `ResolvedRecovery` + the resolution function, with §6 pinned by test.
3. `projectCommercial` takes the second argument; call sites pass a resolved
   profile. Behaviour identical while every quote resolves `legacy`.
4. Freight `separate_line` branch replaces the `freightLines: []` constant.
5. Send transaction mirrors the resolved profile into `quote_snapshots`.
6. Freeze-list entry + `assertNotFrozen` on the writer.
7. **UI last, and separately** — not in this PR.

Steps 1–3 are behaviour-neutral by construction and independently revertible.
Step 4 is the first that can change any output, and it changes none until a
quote opts into `separate_line`.

**Accounting Invoice Guidance remains out of scope** until the profile and its
SEND snapshot are frozen.

## 10 · Open for disposition

1. **Does `separate_line` freight change revenue, or only presentation?** If
   freight is already in unit price and is instead shown as its own line, the
   customer total can stay identical (re-presentation) or increase
   (re-recovery). These are different commercial acts and the model should not
   assume which. **This is the one question I would not answer on my own** — it
   decides whether recovery is a presentation lever or a pricing lever.
2. Should `quotes.recovery_*` be settable before first send only, or also on a
   revision? (`reviseQuote` creates a new version; the profile presumably
   carries forward.)
3. Does the quote-level UI show `per_assembly` as a selectable state, or infer
   it and show "mixed"? The former is honest; the latter is fewer concepts.
