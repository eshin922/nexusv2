# Card 1 · operator validation debt

**Open. Edward, 2026-08-25.**

The Card 1 commercial-grain repair (#403, #404) is **engineering-certified** and
merged: the actionable amount equals what the control moves, on every quote in
the production population, and the costing global hash is identical to `main`
so no commercial number moved.

It has **not** had a meaningful operator validation, because no commercially
representative scenario was available at the time. The three production checks
that were run confirmed the *figures* and the *absence of a control* on
service-only rows. They could not confirm that an operator, working a real
quote, now sees the recovery movement clearly in the customer document — which
is the property the whole repair exists to restore.

## What is owed

One operator walk, on a realistic quote, at the **next realistic Customer View
validation point** — preferably the same quote used to validate Card 2, Card 3
and Finalize, so it is one session rather than three.

## What that scenario must contain

Not any quote. It has to be able to *show* the thing:

- **at least one actionable one-time fee** — a charge whose recovery control
  genuinely moves money, so electing it visibly changes the customer document;
- **at least one distinct service contribution** — a Direct Service leaf, so
  the context row appears beside a control and the two are visibly different
  kinds of thing;
- ideally **both on the same charge** (the `rd_formulation` shape), since that
  is the case that produced the original report and is the one an operator is
  most likely to misread.

A quote with only fees cannot exercise the service context. A quote with only
services cannot exercise the movement. Either one alone would produce a green
walk that could not have failed — the same shape of non-evidence this
workstream has been caught by repeatedly.

## What the walk must show

1. Electing a fee `Separate → In unit price` visibly moves it out of One-time
   fees and into the unit prices, and the operator can see that it did.
2. The service contribution stays put, is labelled as a service line, and
   offers no recovery control.
3. The turnkey total does not move — the treatment decides HOW a charge is
   recovered, not whether.

## Explicitly not reopening

The implementation is not to be reopened for this. If the walk finds a defect,
that is a new finding on its own merits; until then #403 stands.

Related, and also deferred: the `Tooling & artwork` label collision, which is a
bounded UX cleanup rather than a commercial blocker. If the same walk shows it
still causes an operator to misread the document, it graduates; otherwise it
stays parked.
