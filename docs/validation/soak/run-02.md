# Soak run 02 — STOPPED at W6

**Release under test: `2e3581d`** — frozen for the run.
**2026-08-26. STOPPED, not completed.**

Fixture built by the walk: `ZZ-SOAK-run-2` / `b59cb2e3`, on ZZ-VALIDATION —
UAT Case 5, HubSpot deal `64203121535`. Chosen because its deal carries **no**
Sales Order, so W9 would have been exercisable.

**Stopped under rule 3** — the one exception to log-and-continue:

> **catastrophic findings stop the run** … wrong money on a customer-facing
> document

## Measurement

```
steps exercised             6  (W1-W6)
  PASS                      5
  STOPPED                   1  (W6)
steps not reached           5  (W7-W11)
findings                    1
  catastrophic              1
repeat-territory steps      6
findings in repeat          1   <- the number that must trend to zero
```

Every step walked was repeat territory. **The first repeat-territory
correctness finding of the soak**, which is precisely the signal the design
exists to produce.

## Steps

| Step | Result | Territory |
|---|---|---|
| W1 · open project, deal context | PASS | repeat |
| W2 · create scenario | PASS | repeat |
| W3 · Setup — group, products, tier | PASS | repeat |
| W4 · Costs — packaging + production | PASS | repeat |
| W5 · Pricing — clear the floor | PASS | repeat |
| W6 · Commercial Recovery | **STOPPED** | repeat |
| W7-W11 | not reached | — |

State reached, verified at the database: packaging `1.85` / `0.42`, production
`setup_fee_total 1200.00` with `allocate_service_fees_to_cost = true`, lifts
`0.0167` / `0.0257` applied with a `pricing_adjustments_applied` audit row,
election `project_setup = separate` persisted with an author.

## The finding · catastrophic · wrong money on a customer-facing document

**Electing a charge to its own line changed the all-in total the customer
pays.** Placement decides *where* money sits. It moved *how much*.

Same quote, same costs, same lifts. The only act between the two readings was
the placement election.

| | in unit price | separate line |
|---|---|---|
| Primary - Bottle | `$2.79` · `$13,933.87` | `$2.45` · `$12,225.82` |
| Genexa Box | `$0.56` · `$2,800.16` | `$0.56` · `$2,800.16` |
| Unit-price subtotal | — | `$15,025.98` |
| One-time fees | — | `$1,680.00` |
| **Turnkey total** | **`$16,734.03`** | **`$16,705.98`** |
| Per unit | `$3.35` | `$3.34` |

**Δ −$28.05.**

Each document reconciles **internally** — `12,225.82 + 2,800.16 = 15,025.98`,
and `15,025.98 + 1,680.00 = 16,705.98`. Both are self-consistent. They just
disagree with each other, which is the shape the standing rule warns about:

> Exact reconciliation is necessary but not sufficient.

**The arithmetic of the gap, recorded because it was already in hand — not as
a diagnosis.** The bottle line fell `$1,708.05`; the separate line added
`$1,680.00`.

```
1,708.05 / 1,680.00 = 1.0167 = the 1.67% lift applied to that SKU
```

So the recovered charge was carrying the SKU's price lift while it sat inside
the unit price, and stops carrying it once it moves to its own line.

**One of the two totals is wrong, and which one is a commercial-authority
question, not an engineering one.** Either a price lift legitimately applies
to a recovered one-time charge — in which case the separate-line presentation
under-recovers — or it does not, in which case the all-in presentation has
been over-charging by the lift on the recovery. Both figures are
customer-facing. Both have been shown to customers.

### Why this is a repeat-territory finding

Run 1 walked this exact step and recorded the opposite:

> **W6 — the election moved presentation without moving money.** … the turnkey
> total did not change: `14,755 + 1,680 = 16,435`, against `16,435` all-in
> beforehand.

Same charge shape, same `$1,200` setup fee, same `$1,680` recovery, same
election. Run 1 held flat; Run 2 moved. **Run 1 did not establish that the
total holds — it established that the total held once.** Whatever distinguishes
the two runs is the thing to find, and finding it is post-walk work.

### Why the run stopped rather than logging and continuing

W7 asserts *frozen == previewed*. It would have PASSED — the freeze copies
whatever the preview shows, and the preview is self-consistent. A pass there
would have added confidence about a figure whose correctness is in question,
and W7-W11 would have carried it into an acceptance and an order.

The rule exists for exactly this: not for findings that are severe, but for
findings that make everything downstream unreadable.

## Not a finding — but the reason it nearly was

Three instrument failures this run, all mine, all the same family as Run 1's:

1. **`+ New scenario` "did nothing"** — coordinate click missed. The DOM had
   no dialog, which correctly said *no modal*, and clicking by element
   reference opened it immediately.
2. **`Lift all 2 to floor` "did nothing"** — reported by BOTH the screenshot
   and `get_page_text`, and confirmed by the database showing no lift rows.
   Three instruments agreeing, all wrong. The lift had staged correctly; the
   staging tray was in the accessibility tree the whole time.
3. **A `503` attributed to the lift** — a POST did return 503, and I nearly
   filed it. Staging had in fact succeeded, so the 503 belongs to some other
   request. **Not reported as a finding: I cannot attribute it.** Worth
   watching in run 3.

**The method correction, which is sharper than Run 1's:**

> `get_page_text` reports its own scope — `Source element: <main>` or
> `<article>`. Anything rendered outside that root, including portals and
> fixed staging trays, is invisible to it. Screenshots come back `993×1011`
> against a `1286×1310` viewport and crop the right third.

Both of my fast instruments are structurally blind to the same class of
element, so their agreement is not corroboration — it is one blind spot
reported twice. The accessibility tree saw the tray on the first read.

That is the Pattern 60 lesson in a new place: **an instrument that cannot
express the thing it is being asked to rule on reports its absence.** Two such
instruments agreeing is worth no more than one.

## Observations — logged, not classified

1. **Run 1 observation 2 persists.** Setup still shows `$0.00 cost` on one
   product and `— cost` on the other. One asserts zero, the other says
   unknown. Repeat territory; unchanged.
2. **`Sales: HubSpot owner unavailable`** on the project header, where Run 1's
   fixture showed a rep. Different deal, so not necessarily the same
   condition.
3. **The recommended-tier card reads oddly.** It names `Tier 1 · below floor`
   and then reports `ORDER VALUE — Set a tier` and `BLENDED MARGIN — Set a
   tier` directly beside it. Plausibly "no tier is *recommended* yet", but the
   card has already named one.

## What was NOT reached

W7 Finalize, W8 Acceptance, W9 Sales Order, W10 Revise, W11 Copy.

**W9 was the reason this fixture was chosen.** Its deal carries no Sales
Order, so it is the first fixture on which the send could actually complete
rather than being refused as a duplicate.

**A constraint worth stating before run 3 is planned:** a completed W9
consumes its HubSpot deal permanently — one deal, one Sales Order, per the
2026-08-19 rule. Two consecutive clean end-to-end runs therefore need **two**
unconsumed deals, and the estate currently holds exactly two clean
ZZ-VALIDATION projects: UAT Case 5 (this one, still unconsumed — nothing was
sent) and UAT Case 6 (`255652dd`, held in reserve).
