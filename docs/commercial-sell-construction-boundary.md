# The commercial sell-construction boundary

**Status — proposed. Authorizes no implementation.**
Supersedes the invariant stated in the per-charge recovery model (#366 §2) and
records the architecture correction taken on 2026-08-23.

---

## 0 · The correction

The recovery model was built on this invariant:

> Layer 1 is invariant under recovery.

That is one sentence doing the work of two, and only one of them is load-bearing:

> **Recovery must never change cost truth.**
> **Recovery may change sell composition and revenue.**

Cost truth — vendor cost, production cost, raw, duty and freight inputs — is
invariant under every election. That is the accounting guarantee, and nothing
here weakens it.

**Sell construction is not invariant, and requiring it to be made recovery
unimplementable.** Moving a charge between the unit price, its own line, and
nowhere is *by definition* a change in how revenue is built. A model forbidden
to touch the layer that decides where a charge lives cannot relocate a charge;
it can only add one to a total or delete one from it.

That is not a theory about what went wrong. It is what was measured.

---

## 1 · What the too-strong invariant produced

Falsification: `tests/unit/commercial-recovery-election-effect.test.ts`.
A $1,000 fee at a 1.4 rate, per tier:

| election | assembly allocation | what the customer is actually billed |
|---|---|---|
| `included` | off | **$1,400 less** — the charge is not moved, it is **deleted** |
| `separate` | on | **$1,400 twice** — line emitted, fee still inside the unit price |
| `absorbed` | off | $1,400 less, with **no movement** in the margin the floor gate reads |
| *agrees with the boolean* | — | correct |

The mechanism is the same in all three. `allocate_service_fees_to_cost` is read
by the **costing engine**, which decides whether a one-time fee sits inside the
unit price. The election was applied in the **projection**, which can only
suppress or emit the customer's separate line. Suppressing a line the unit price
does not contain removes the charge; emitting one it does contain bills it twice.

So the only elections that are currently correct are the ones that agree with
the legacy boolean — the ones that change nothing. Every disagreeing election
now refuses (`src/lib/commercial-recovery/resolve.ts`).

**The `absorbed` case is the quietest and the most serious.** The engine records
separately-billed fees as *"billed as fixed charges; not part of the per-unit
sell"*, so they were never in `quoteRollup.totalRevenue` — which is what
`fingerprintCommercialState`, the send gate and the below-floor authorization
all read. Absorbing reduces what the customer pays **while the measured margin
does not move at all**. A reduction that is real and invisible to the control
that exists to catch it is worse than either of the other two.

---

## 2 · The boundary

Three layers, not two:

```
   cost engine   ──▶   charge economics          INVARIANT under recovery
                       vendor / production / raw / duty / freight

   commercial    ──▶   sell + recovery build     THE ELECTION APPLIES HERE
                       what is recovered, and where

   projection    ──▶   render + freeze           DECIDES NOTHING
                       customer document, frozen matrix, SO lines
```

For a $1,000 cost at a 1.4 rate the commercial layer must be able to say:

| election | unit sell | separate line | cost retained | margin |
|---|---|---|---|---|
| `included` | recovers **$1,400** | — | $1,000 | unchanged |
| `separate` | **$1,400 removed** | **$1,400** emitted | $1,000 | unchanged |
| `absorbed` | **$1,400 removed** | — | $1,000 | **falls** |

`included ↔ separate` is revenue-neutral because the same $1,400 is *moved*,
not added or removed on one side. `absorbed` is the only mode that moves the
total, which is exactly why it is the mode that can require an authorization.

### The charge must be handed over explicitly, never recovered by subtraction

**The cost / charge layer exposes charge economics as first-class values — the
cost, and the governed recoverable sell amount. The sell constructor decides
where that sell amount lives. It must never reverse-engineer a charge out of an
already-aggregated unit price.**

The shortcut this forbids is the obvious-looking one: let the cost layer hand
over a finished unit price, and have the constructor subtract the charge back
out when the election says `separate`. It is wrong twice over.

**It recreates the coupling under a new name.** To subtract a charge out of a
unit price you must know how it was put in — the amortisation basis, the
markup, the rounding. That knowledge is exactly what
`allocate_service_fees_to_cost` encodes today. A constructor that needs it has
not removed the allocation coupling; it has moved it and given it a new name,
and the next person to read the code will not be able to see that the two
layers are still joined.

**And subtraction does not reproduce the bits.** OD-025 is the case where a
repair whose entire premise was that it moved no money moved `blendedMarginPct`
on three real quotes, because `(v − f) × 1 + f` is exact algebra and inexact
IEEE-754. `included ↔ separate` is *precisely* that shape — remove a component
from one place, re-add it in another — so a constructor built on subtraction
would fail the revenue-neutrality invariant on real data while passing every
example anyone thought to write.

Handing the charge over explicitly makes both problems disappear rather than
managing them: the same value is placed in one of two positions, so
revenue-neutrality is structural, and the identity case needs no short-circuit
because nothing was ever taken apart.

Practically: whatever the cost layer emits per (charge, tier, owner) must carry
its cost and its recoverable sell amount as separate stated quantities. If a
value can only be obtained by subtracting one total from another, the layer
below has not finished its job.

### The single-consumer requirement

**Every consumer must read the same post-recovery construction:**

- `quoteRollup.totalRevenue` and the blended margin
- `fingerprintCommercialState` and the below-floor authorization
- the SEND gate
- the customer PDF
- the frozen commercial line set
- NetSuite SO line projection

A recovery that only some of those can see is the divergence this seam was built
to end, reintroduced one layer down. The PDF and the Sales Order once disagreed
about allocation-OFF fees while each stayed internally consistent; that is the
failure to design against, and the same structural proof applies — one
construction, one result, consumed by all of them, asserted by call-site count
rather than by comparing two reconstructions.

---

## 3 · What already exists and does not need rebuilding

The infrastructure is complete and proven, and is offered for review as an
**inert foundation** (PR #367):

- the governed charge registry — a closed enum, per-unit COGS deliberately
  absent, so recovery cannot spread to every numeric field
- the policy layer — `available` and `refusals` as exhaustive complements,
  a denied mode without a reason fails the coherence check
- `refusalFor` — one refusal question asked by resolution, the action layer,
  and any future surface
- resolution, with absence-of-a-row as the load-bearing legacy state
- the election table + snapshot mirror, frozen inside the send transaction
- `setChargeRecovery`, draft-locked, on the Pattern 52 freeze list
- the supersession warning — a read, comparing fingerprints, never a second
  definition of "material"
- preservation evidence — S-7 zero delta against pristine `main`
- the refusal tripwires that fail the moment a mode is opened without the
  property that makes it safe

**None of it changes when this boundary lands.** The election applies one layer
lower; the registry, policy, storage, freeze and warning are unaffected.

---

## 4 · Open, and deliberately not answered here

1. **Where the commercial layer sits relative to `computeQuoteCosting`.**
   A distinct module consuming the costing result, or a second phase inside it
   with a documented internal boundary. The single-consumer requirement is the
   constraint; the file layout is not settled.
2. ~~Whether `allocate_service_fees_to_cost` survives.~~ **DISPOSITIONED
   2026-08-23 — see §4.5 below.**
3. **Freight and duty.** Still refused, still for open decision 2 / BV-011 §4.5:
   freight's presentation authority and its accounting destination are
   unreconciled and "will be read as competing" unless stated explicitly. This
   boundary does not settle that, and shipping a freight election before it is
   settled would create the second source of truth the decision exists to
   prevent.
4. **The uniform-allocation departure** (BV-011 §4.9) is unchanged by this
   correction and still belongs to the Production / OTC workstream.

---

## 4.5 · `allocate_service_fees_to_cost` — dispositioned

**Kept representable for legacy compatibility. It stops being the future
commercial control.**

It currently conflates two things:

1. **where the old costing path placed the fee** — a fact about how existing
   quotes were built;
2. **how DPS intends to recover and present that charge** — a commercial
   decision.

The second responsibility moves to the recovery model. The first cannot simply
disappear, because existing quotes — including the mixed and frozen cases — were
built using it. It becomes **legacy provenance and compatibility state, not the
new commercial authority.**

| | rule |
|---|---|
| **existing / no-election quotes** | continue resolving through the boolean exactly as today |
| **new explicit elections** | resolved by the sell-construction layer **without rewriting the boolean** |
| **operator surface** | once the recovery workspace is certified, the boolean must **not** reappear as a separate commercial choice |
| **retirement** | only after the sell constructor can derive charge economics independently of the boolean, **and** no governed legacy read still needs it |

Two consequences worth stating plainly, because both are easy to lose:

**"Without rewriting the boolean" is what keeps clearing an election
meaningful.** An election that wrote the column would make its own removal
unrecoverable — there would be nothing left to fall back to, and the three real
mixed quotes (one already sent) would have been flattened by the first
operator who tried a mode and changed their mind.

**Two commercial controls for one decision is the failure mode the third row
prevents.** If the workspace ships and the legacy toggle stays visible as a
commercial choice, an operator has two ways to say the same thing and no way to
know which one wins. The boolean may remain visible as *provenance* — what this
quote was built with — but not as an *instruction*.

The retirement condition is deliberately two-part. "The constructor no longer
needs it" is necessary and not sufficient; a governed legacy read elsewhere
would still break, and the audit for that is the cross-consumer sweep this
codebase has already been caught by twice (queries + writes + realtime +
publication + raw SQL outside `actions/`).

---

## 5 · Sequence

1. **#367 merges as inert infrastructure, or does not merge.** Reviewed
   explicitly as a foundation — not as recovery implemented. The inertness claim
   is asserted in `tests/unit/commercial-recovery-inert-foundation.test.ts`
   rather than stated.
2. **This boundary is designed and dispositioned**, including item 4.2 above.
3. **The boundary is built**, with the single-consumer requirement proven
   structurally and `included ↔ separate` revenue-neutrality proven
   numerically — the existing tripwires convert from vacuous to governing on
   the first run.
4. **Only then** are the workspace controls enabled.

No control may be offered for a mode the system would mis-price. That ordering
is the whole point of stopping here.
