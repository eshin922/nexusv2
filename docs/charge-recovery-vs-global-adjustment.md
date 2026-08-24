# Separating governed charge recovery from the global price adjustment

**Status — dispositioned and IMPLEMENTED.** Edward, 2026-08-24.
`included ↔ separate` is open; `absorbed` remains refused.

---

## 1 · The rule

> **A quote-level price adjustment must not change a one-time charge merely
> because the operator chose to present it inside the unit price rather than on
> its own line.**

`recoverableSell` is the authority for the charge in **both** placements. The
global adjustment continues to govern the ordinary unit-price sell ladder; it
does not re-mark-up a charge already priced by its own governed rate.

Otherwise `included` / `separate` is not presentation — it is a second pricing
lever, and an operator can change the customer's total by changing where the
same charge appears.

---

## 2 · What certification measured

`52bd0077`, `global_price_adj_pct = 0.2000`, electing `included` on
`project_setup`:

| | before | after | |
|---|---|---|---|
| tier 1 otc | 4340 | 4200 | −140 |
| tier 1 unit | 10566 | 10734 | **+168** |
| tier 1 total | 14906 | **14934** | **+28** |

`140 × 1.2 = 168`. The unit-price path receives the adjustment; the
separate-line path does not.

**The legacy boolean has the same asymmetry**, measured on the unit fixture:

```
allocation OFF (fee on its own line)   total 2600
allocation ON  (fee in the unit price) total 2880
difference 280 = 1400 x 0.20
```

So this is **pre-existing production behaviour**, not a recovery defect.
Recovery made it reachable by an operator, and therefore visible.

---

## 3 · Acceptance contract

1. same charge, same `recoverableSell`;
2. `included` places that exact recovery inside the unit price;
3. `separate` places that exact recovery on its own line;
4. **total customer revenue identical regardless of `global_price_adj_pct`**;
5. the global adjustment continues to apply to the non-charge unit sell;
6. clearing the election still restores the historical legacy behaviour;
7. **existing quotes with no election do not change** until migration is
   explicitly dispositioned.

Point 7 is why `PlacedCharge` now carries `source`. Legacy and elected
placements are priced **differently by decision**: legacy keeps the adjustment
reaching an allocated fee — what every existing quote was priced with — and an
election is neutral. Without that discriminator the engine can honour only one,
and honouring either alone would silently reprice 89 quotes or leave relocation
a pricing lever.

---

## 4 · Neutrality must not erase the Accounting distinction

**Settled 2026-08-24.** "The customer pays the same either way" is a statement
about the **amount**. It says nothing about the **invoice**.

A $1,400 recovered setup fee on 10,000 units:

| placement | governed recovery | Accounting |
|---|---|---|
| placement | cost | governed recovery | amortized | separate invoice line | Accounting |
|---|---|---|---|---|---|
| `included` | $1,000 | $1,400 | **$0.14/unit** | **$0** | amortized into unit price — do NOT invoice separately |
| `separate` | $1,000 | $1,400 | $0/unit | **$1,400** | invoice separately |
| `absorbed` | $1,000 | $0 | — | $0 | DPS retains the cost; unavailable for now |

**Three quantities, kept apart.** An amortized charge is exactly the case where
the invoice line diverges from the recovery, so the charge is neither deleted
nor zeroed to express amortization: `separateInvoiceAmount` is $0 as a
STATEMENT — "bill nothing separately, it is in the unit price" — while
`recoverableSell` still says what DPS intends to recover and `cost` still says
what DPS pays.

**Not an instruction about NetSuite.** Whether a zero-dollar OTC line is emitted
is a later Order Packet decision; the frozen recovery instruction is the
authority.

**Implemented already** (this branch): `PlacedCharge.amortization` carries
`{ totalRecovered, tierQuantity, perUnit }`, present exactly when the placement
is `unit_price`, the placement is **elected**, and the recovery is known.
`placement` itself answers *"invoice separately?"*.

### The legacy amortization has no per-unit figure to freeze

Surfaced while building the freeze, and it changes what the record can say.

A legacy allocated fee flows into the sell ladder, so the quote-level
adjustment reaches it. Measured end to end on a $1,000 fee at a 1.4 rate over
1,000 units:

| gpa | allocated | own line | delta | |
|---|---|---|---|---|
| 0.00 | 2400 | 2400 | 0 | the coincidence the original fixture mistook for neutrality |
| 0.20 | 2880 | 2600 | 280 | = 1400 x 0.20 |
| 0.50 | 3600 | 2900 | 700 | = 1400 x 0.50 |

The asymmetry is **proportional**, not a fixed offset — which is the load-bearing
part, and one measurement could not have distinguished the two. So the customer
pays `recovery x (1 + gpa)` for a legacy-amortized charge, and there is no fixed
per-unit recovery to state.

Freezing the governed `$0.14/unit` would therefore put a number an accountant
would act on beside a charge the customer paid `$0.168/unit` for. **Worse than
stating nothing**, so the basis is NULL for a legacy placement and the
instruction says why: *"the recovered amount is not independently governed,
because the quote-level price adjustment applies to it."*

An **elected** amortization IS fixed, because §5's precedence adds the governed
recovery after the ladder. That difference is the accounting substance of
electing rather than a detail of it: **electing converts an amortization nobody
can state into one that is frozen and reconcilable.** It is also the second
reason `source` is load-bearing, alongside §3 point 7.

Stated only where it is a fact — a separately-billed charge has no basis, and
emitting a zero would let a reader take it for an amortized charge spread over
nothing. Absent at an unknown recovery (BV-013) and at zero quoted quantity
(undefined is not zero). The basis is the **quoted** quantity: one that moved
with actual output would restate a sent quote.

That gives the eventual **Accounting Invoice Guidance** slice what it needs to
say *"this charge was amortized into unit price; do not invoice separately"* —
with the amount and the basis.

---

## 5 · Pricing precedence — DISPOSITIONED and IMPLEMENTED

**Edward, 2026-08-24.** Build the ordinary unit sell through its normal levers
first, then add the elected amortized recovery:

```
base sell -> surgical lift -> tier/global adjustment
                                        |
                          + amortized recovery      <- added LAST
```

So neither the adjustment nor a lift independently marks up a charge already
priced by its own governed rate.

**A terminal cell override remains terminal and is the all-in customer unit
price. The amortized recovery is NOT added on top of it.** Implemented by
placing the recovery rung BENEATH the override in the chain: the override
replaces that node, so it replaces the recovery with it, and the amortized
chain stays reachable as `superseded` for a trace.

Note the precedent this respects. OD-023 made the cell root a SUM of the
operator's price and the cell's freight, and the arithmetic half was judged
wrong (P-Direct-1). This is the opposite placement for the opposite reason:
beneath the override, so an operator's price stays whole.

**Cost lands in the contribution basis, not in factory cost.** Factory cost is
the duty and tariff basis, and a one-time service fee does not attract duty —
adding it there would invent a customs charge on a setup fee.

### Proven under all five conditions

| condition | evidence |
|---|---|
| non-zero global adjustment | fixture carries 0.20 — the dimension the original tripwire could not express |
| surgical lift | relocation neutral with a 15% lift applied |
| terminal cell override | override is the unit sell; asserted NOT override + recovery, and asserted non-vacuous |
| persistence + reload | `52bd0077` against the production database |
| clearing back to legacy | whole-result `deepEqual`, plus no mutation of the allocation boolean |

`PLACEMENT_NOT_NEUTRAL` is **lifted** — its own words were *"it opens once the
two placements recover the same amount"*, and they now do. The constant is
retained rather than deleted: it is the reason the precedence exists, and a
future change that re-couples the two should re-refuse rather than reinvent the
explanation.

`absorbed` stays refused. `absorbedCost` is read by nothing, so the charge would
vanish from cost truth while DPS still pays it.

---

## 6 · One consequence worth stating

**An election is not a no-op even when it agrees with the boolean.**

`source` is what the engine prices from, so ANY election puts the charge on the
governed contract — and electing `included` on a quote whose boolean already
allocates moves the fee out of the adjustment's reach and changes the
customer's total, though the placement did not move.

That is the contract working: the operator has opted the charge into governed
recovery, which is a real commercial act. But it *looks* like confirming the
current state, and the surface should not present it as a confirmation.

---

## 7 · Sequence

1. ~~pricing precedence dispositioned~~ **done**
2. ~~implemented; legacy path untouched~~ **done** — S-7 shows no new movement
3. ~~certified under all five conditions~~ **done**
4. ~~relocation refusal lifted~~ **done**
5. ~~freeze `totalRecovered` / `tierQuantity` / `perUnit` at SEND~~ **done** —
   `quote_snapshot_recovery_instructions`, written inside the send transaction,
   covering every PLACED charge rather than every elected one. Certified by
   `npm run gate1b:frozen-instruction-certify`: 86 instructions across the 10
   live quotes carrying a one-time charge, **0 of them elected** — so an
   elections-keyed freeze would have recorded 0 of 86. See
   `docs/pattern-52-freeze-list.md`.
6. **repeat the real click-path certification** on a surface where the
   authenticated session already works
7. **workspace copy states the CONTRACT, not the placement** — two states can
   both look "included" with different economics (§6), and the price impact
   must be shown before commit
8. **recapture S-7** last
