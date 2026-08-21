# Customer-visible rate precision — open, deliberately not repaired

**Banked 2026-08-21** alongside the frozen-rate precision repair
(`0091_frozen_rate_precision_8dp`). Recorded as open; **no presentation change
was made**, on Edward's direction that quote/invoice presentation must not be
folded into that repair.

## What changed, and what it does not decide

The repair made the posted rate a DERIVATION of the accepted amount at eight
decimal places, so `round(quantity × postedRate, 2)` reproduces the frozen line
amount exactly. That is an **arithmetic** boundary: it governs what NetSuite is
sent, not what a human reads.

A side effect is that rates now exist at a precision no customer document has
ever had to display:

```
ABH - Neoprene Bag   tier 1    5,000 × 6.76961800  = 33,848.09
                     tier 2   10,000 × 3.05030400  = 30,503.04
                     tier 3   20,000 × 1.57124300  = 31,424.86
```

## The open question

**What per-unit figure does a customer see, and what does NetSuite print?**

Three surfaces can disagree, and none of them is wrong on its own terms:

| surface | today | note |
|---|---|---|
| Customer PDF | rounded per-unit price | never showed 4dp either |
| NetSuite Sales Order | now the 8dp derived rate | what makes the amount exact |
| NetSuite printed forms | provider-controlled | not configured by Nexus |

A displayed `6.7696` beside an extended `33,848.09` does not multiply out, and a
displayed `6.76961800` is precision no one asked to read. Both are defensible;
the choice is a **display policy**, and it belongs with the Quote Presentation
Profile slice (#326), whose whole premise is that presentation may change how
governed commercial information is shown without changing the information.

## What is NOT open

- The **amount** the customer sees. Unchanged, and it is the authority.
- The **arithmetic**. Exact integer-cent, no tolerance, refusal when
  unrepresentable.
- Whether NetSuite receives the derived rate. It must, or the order does not
  reconcile.

Only the human-readable rendering of a per-unit rate is undecided.

## Cross-references

- `drizzle/0091_frozen_rate_precision_8dp.sql` — why scale 8, and the sandbox
  proof that NetSuite preserves it.
- `src/lib/commercial-rate.ts` — the derivation and its refusal path.
- `docs/quote-presentation-profile-brief.md` (#326) — where the decision belongs.
