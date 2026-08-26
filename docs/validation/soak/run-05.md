# Soak run 5 — Lineage VI, frozen release `2f02912`

**Second of the two runs that were meant to settle the beta-readiness gate.**
Executed on the same frozen release as run 4, with no product change in between,
so the two runs measure one product rather than two.

**Verdict: NOT CLEAN. One product finding.** Every economic assertion held —
identically to runs 3 and 4, to the cent — but a governed action failed at the
transport layer and told the operator nothing.

| | |
|---|---|
| release under test | `2f02912` (production runtime byte-identical; `main` was `889df3d`, documentation-only ahead) |
| fixture | project `b855a1cd` · ZZ-VALIDATION — Soak Lineage VI · deal `64362942065` |
| quote | `364bb2b6` · `ZZ-SOAK-run-5` · **DPS-1065** |
| copy | `2fee4930` · `ZZ-SOAK-run-5-copy` |
| terminal | **SO2727** (NetSuite internal id `363242`) |
| order | W1–W8 → W10 → W11 → re-Finalize → re-Accept → W9 terminal |

---

## The walk

| step | result | evidence |
|---|---|---|
| project import | PASS | project `b855a1cd` created from deal `64362942065` |
| W1 open project | PASS | |
| W2 create scenario | PASS | quote `364bb2b6` |
| W3 structure | PASS | 1 group, 2 products, Tier 1 = 5,000 |
| W4 costs | PASS | Bottle `1.8500`, Box `0.4200`, setup `1200.00`, allocate = true |
| W5 clear the floor | PASS | lifts `0.0190` / `0.0257` — identical to runs 3 and 4 |
| W6 recovery placement | PASS | invariance held on the live surface (below) |
| W7 finalize + freeze | **FINDING** | froze correctly; **failed silently first** (below) |
| W8 acceptance | PASS | `accepted`; economics unmoved |
| W10 revise | PASS | → `draft` v2, same number, acceptance unwound |
| W11 copy | PASS | election + lifts carried; commercially identical |
| re-finalize | PASS | v2 froze byte-identical to v1 |
| re-accept | PASS | prior tier/channel/words carried forward |
| W9 sales order | PASS | **SO2727**, read back line-for-line |

---

## The economics, unchanged from runs 3 and 4

**Recovery placement invariance, measured on the real surface:**

```
included    13,933.48 + 2,800.16                     turnkey 16,733.64   $3.35/unit
separate    12,253.48 + 2,800.16 = 15,053.64
            + one-time 1,680.00                      turnkey 16,733.64   $3.35/unit
```

Only the split moves. The Bottle line drops by exactly `1,680.00` — the whole of
the charge, none of the lift. Run 2 measured `-28.05` at this step on the
pre-repair release.

**The Price Build reconciled to the customer document:**

```
ORDER RECONCILIATION · reconciles to the customer document
  Unit-price sell × quantity        $15,053.64
  + Total separate charges           $1,680.00
  Turnkey total                     $16,733.64
```

**The copy came out commercially identical to its source** — `15,053.64 +
1,680.00 = 16,733.64` at 25.0%, carrying both the `separate` election and both
applied lifts (`0.0190` / `0.0257`). In run 3 the same copy landed at
`16,435.00` and 23.639%, below the floor. #448 and #452 confirmed again.

**Freeze, revise and re-freeze were economically identical.** v1 and v2 both
froze to `15,053.64 + 1,680.00 = 16,733.64` with rates at full precision
(`2.45069600` / `0.56003200`) under a rounded display.

**SO2727 read back from NetSuite:**

| | frozen | posted |
|---|---|---|
| DPS-BOTTLE-0001 | 5000 × 2.45069600 = 12,253.48 | item 66476, 5000 × 2.450696 = 12,253.48, cost 1.85 |
| 10064-GNX-Box | 5000 × 0.56003200 = 2,800.16 | item 1024, 5000 × 0.560032 = 2,800.16, cost 0.42 |
| Project setup (`otc_setup`) | 1 × 1680.00 = 1,680.00 | **OTC-0024**, NonInvtPart 26348, 1 × 1680, cost 1200 |
| | 16,733.64 | subtotal = total = **16,733.64**, tax 0 |

The one-time charge is its own line. Not folded into a unit price, not counted
twice. Byte-identical in shape to run 3's SO2725 and run 4's SO2726.

---

## THE FINDING — a governed action failed and said nothing

**What was measured.** Finalize on v2 was clicked and the quote stayed `draft`.
No error appeared anywhere on the surface. The network layer recorded:

```
POST /projects/b855a1cd/quotes/364bb2b6/quote     503
```

A later click on the same button succeeded and froze the quote correctly.

**Why the operator saw nothing.** `finalize-quote-button.tsx:124` is

```ts
const r = await sendQuote(fd);
if (r.ok) return;
...
setError(r.error.message);
```

with **no `catch`**. A structured refusal — below floor, unresolved costs — comes
back as `{ok: false}` and is rendered in a `role="alert"`, deliberately and well.
A **transport-level** failure never produces a value at all: the promise rejects,
nothing sets `error`, `pending` clears, and the button returns to looking exactly
as it did before. The operator's evidence that a freeze failed is that the page
did not change.

**The shape is not local to Finalize.** Five components in the quote tree await a
server action inside a transition with no catch:

```
accounting-instruction.tsx
card-commercial-recovery.tsx
card-customer-presentation.tsx        (×2)
customer-notes-drawer.tsx
finalize-quote-button.tsx
```

**What this run did NOT establish**, and should not be reported as if it had:

- **The cause of the 503.** No function logs were available (the Vercel CLI is
  not installed in this environment), so whether it was a cold start, a function
  crash, or database contention is unknown. It did not recur.
- **The causal chain end to end.** The console was not captured at the instant of
  the failure, so the rejection was inferred from the code path and the observed
  silence rather than witnessed. The 503 itself was measured directly.

**Why it is a finding rather than an observation.** Freezing is the act that
converts a working quote into the artifact a customer receives and NetSuite
bills against. A failure of it that presents as a no-op is indistinguishable, to
the operator, from not having clicked — and the natural response to a button that
appears not to have worked is to click it again, which is how this one was
recovered. It is not an economic defect; no number was ever wrong. It is a
governed action whose failure is invisible.

---

## Withdrawn: the import search

Logged mid-run as "search did not filter — typing the deal name still showed
1–50 of 85". **It is not a product finding.** The typed text never reached the
input; the search ran with an empty query, and 85 is simply the unfiltered
active-pipeline count. Submitted properly:

```
?q=Soak+Lineage+VI   →   Showing 1–1 of 1 matching deals.
```

Recorded because it was written down before it was checked, and because this is
the fourth time this soak has produced a confident reading from an instrument
that could not express the opposite result.

## The instrument, again — and the actual root cause

Runs 1–4 spent nine of Edward's clicks on browser automation that would not
click, misdiagnosed three times, twice as a possible product regression. Run 5
finally measured it:

**The `computer` tool's coordinates are the screenshot's, not the page's.** The
screenshot is `1273×782` where the viewport is `2051×1260` — a scale of `0.608`.
Clicks aimed with CSS coordinates land at roughly 60% of the intended position,
which is close enough to hit a wide left-column button by accident and
systematically misses anything in the right rail. Calibrated by clicking a known
point and reading back `clientX/clientY`:

```
shot (1000, 600)  →  css (1644, 987)     scale 0.6081
```

Two further constraints, both learned the expensive way: taking a screenshot
**resizes the window**, invalidating every measurement taken before it; and a
measurement must be followed immediately by its click, with nothing in between.
Where the tool's input died entirely, recreating the tab restored it.

None of this is a product finding, and the product was never at fault for any of
it. It is recorded here because it has now cost more of this soak than every real
defect combined.

---

## Sequence note

W10 necessarily unwinds Acceptance — revising a sent-and-accepted quote runs
`unmarkAccepted` first, by design — so reaching terminal W9 afterwards costs a
re-Finalize and a re-Accept. Confirmed again; both behaved. The corrected order
from run 3 is still right, and still not free.

---

## Where the gate stands

The gate is **two consecutive clean full runs on the same release**.

```
run 4    frozen 2f02912    CLEAN      11/11, zero findings
run 5    frozen 2f02912    NOT CLEAN  one product finding
```

**The gate is not satisfied.** Run 5 is the second run on the same frozen
release, which was the hard part, and it reproduced every economic result of run
4 exactly — but it did not complete with zero correctness findings, and the gate
was not written to admit "clean apart from one".

What that costs is now concrete: **both validation lineages are spent.** Deal
`64200019819` went to SO2726 in run 4 and `64362942065` went to SO2727 here. A
further pair of clean runs needs a further pair of governed lineages, provisioned
the way `docs/validation/soak-fixture-budget.md` describes — new HubSpot deals on
the already-mapped company, reusing NetSuite customer `388800`, fabricating no
accounting identity.

Whether the finding above is a beta blocker, a queued repair, or accepted as-is
is Edward's adjudication, not this record's. It is written down as measured.
