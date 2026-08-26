# V1 beta-readiness soak

**Status: DEFINED. Run 1 not started.**

The question this exists to answer, and it is not "are there bugs":

> Are we converging toward stability, or still uncovering defects because we
> keep walking new ground?

Those look identical from a list of findings. They are told apart by **where**
each finding was found, not how many there were.

## The measurement that makes it evidence

Every step of every workflow is marked, per run, as **new territory** (first
time this step has been exercised) or **repeat territory** (exercised and passed
in an earlier run).

- A defect in **new** territory says nothing about convergence. It is what
  exploration produces, and finding one is the walk working.
- A defect in **repeat** territory is the interesting one: either a regression,
  or a defect the earlier pass was not sharp enough to see.
- A step that passes in **three consecutive runs** with no product change
  between them is the unit of evidence we are accumulating.

Without that split, a run that surfaces six findings is unreadable — it could be
six regressions or six first looks, and the two mean opposite things.

**Honest prior.** Almost everything found in the run-up to this soak was new
territory: the first end-to-end Commercial Recovery walk, the first Finalize of
a fixture carrying elections, the first Preview click on a non-draft quote. That
is consistent with exploration, not with instability — but it is also not yet
evidence of stability, because almost nothing has been walked twice. This soak
is how that changes.

## Rules of the walk

1. **The product is frozen during a run.** No merges to `main`, no migrations,
   no config changes, from the moment a run starts until it is logged. A run
   spanning a code change measures two products and proves neither.
2. **Findings are logged, not repaired.** The urge to fix mid-walk is exactly
   what destroys the comparison — and the fix itself becomes unwalked new
   territory.
3. **One exception: catastrophic findings stop the run.** Defined narrowly, so
   the exception cannot swallow the rule:
   - data loss or corruption
   - wrong money on a customer-facing document
   - an irreversible act firing when it should not (NetSuite SO, HubSpot deal
     mutation, send)
   - the walk cannot continue at all
   Anything else — wrong label, missing affordance, confusing copy, slow
   surface — is logged and the walk continues.
4. **Runs are ordinary, not adversarial.** The point is what an operator meets
   on a normal day. Edge-case hunting is a different exercise and would
   contaminate this one: it manufactures new territory indefinitely, so the
   convergence signal could never arrive.
5. **Same fixtures, same order, every run.** A different path each time is not a
   repeat.

## Safety envelope

Unchanged from certification, and non-negotiable during the soak:

- `NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC=1` stays set — no production deal is
  touched.
- NetSuite stays sandboxed.
- **No real customer quote is mutated.** Walks run on ZZ-VALIDATION fixtures.
  Real quotes may be OPENED and read; nothing is written to them.
- The shared database is production. Every write in a walk is a production
  write, on a fixture.

## The workflow set

Ordinary operator paths, in the order an operator meets them. Each is a
sequence of steps; each step is the unit that gets marked new/repeat.

| # | Workflow | Ends at |
|---|---|---|
| W1 | Open a project, read the deal context | project detail renders |
| W2 | Create a scenario | new draft quote exists |
| W3 | Setup — add a product from the library, add an assembly, set tiers | SKU tree + tiers |
| W4 | Costs — packaging, production, freight legs, customs | cost inputs saved |
| W5 | Pricing — read compliance, adjust a cell, run a Global lift Preview + Apply | margins move as expected |
| W6 | Commercial Recovery — change an election, watch Card 1 and the quote agree | elections persisted |
| W7 | Quote · Preview + Finalize | frozen version, PDF, quote number |
| W8 | Quote · Client Review + Acceptance | accepted, tier captured |
| W9 | Quote · Sales Order projection | readiness honest; send only on a fixture |
| W10 | Revise a sent quote into v2 | draft again, number preserved |
| W11 | Copy a scenario within a project | new draft, economics carried |

W9's send is the only irreversible step. It runs against the sandbox on a
fixture, and only when the fixture is expendable.

## Recording

One file per run: `docs/validation/soak/run-NN.md`.

Each step: `PASS` / `FINDING` / `BLOCKED`, marked `new` or `repeat`, with the
quote id walked. Findings get a severity (`catastrophic` / `correctness` /
`presentation` / `performance`) and one line of what was seen — not a diagnosis.
Diagnosis is post-walk work.

A run ends with three numbers, which are the whole point:

```
steps exercised          N
repeat-territory steps   N   <- the coverage that is accumulating
findings in repeat       N   <- the number that must trend to zero
```

## What "ready" would look like

Not "no findings". A defensible beta gate:

- every workflow step exercised at least **three** times
- the **last two consecutive runs** surface **no new correctness findings in
  repeat territory**
- every open `catastrophic` finding closed, and its fix walked
- presentation and performance findings triaged, not necessarily fixed

If repeat-territory findings are still arriving on run 4, we are not converging
and the answer is more repair before more walking — which is a real answer, and
the one that is currently unknown.
