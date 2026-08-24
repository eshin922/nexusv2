# Separating governed charge recovery from the global price adjustment

**Status — design. Authorizes no implementation.**
Dispositioned 2026-08-24 (Edward). The next required slice, and narrower than
another redesign.

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
| `included` | $1,400, embedded at **$0.14/unit** | **do NOT invoice separately** |
| `separate` | $1,400 | invoice the separate $1,400 line |
| `absorbed` | none | DPS retains the underlying cost |

**Implemented already** (this branch): `PlacedCharge.amortization` carries
`{ totalRecovered, tierQuantity, perUnit }`, present exactly when the placement
is `unit_price` and the recovery is known. `placement` itself answers *"invoice
separately?"*.

Stated only where it is a fact — a separately-billed charge has no basis, and
emitting a zero would let a reader take it for an amortized charge spread over
nothing. Absent at an unknown recovery (BV-013) and at zero quoted quantity
(undefined is not zero). The basis is the **quoted** quantity: one that moved
with actual output would restate a sent quote.

That gives the eventual **Accounting Invoice Guidance** slice what it needs to
say *"this charge was amortized into unit price; do not invoice separately"* —
with the amount and the basis.

---

## 5 · The open question — where the recovery sits relative to the other levers

**This needs disposition before implementation.** It is the same class of
question as §1 and I am not answering it by choosing.

The sell ladder is:

```
sell-before-adjustment
  -> x (1 + price adjustment)        <- must NOT reach a governed charge
  -> x (1 + surgical lift)           <- ?
  -> cell override                   <- ? (TERMINAL today)
  -> required sell
```

Contract point 5 places the charge recovery outside the **adjustment**. It does
not say where it sits relative to the other two:

**A · a surgical lift.** A lift is a targeted margin repair on a cell. Should it
lift the charge recovery too? If yes, the charge is adjustment-free but
lift-bearing, and relocation moves the total again whenever a lift applies —
the same defect in a second lever. If no, the lift applies to the non-charge
sell only, consistent with the adjustment.

**B · a cell override.** An override is **terminal today** — the operator set
the price and the computed chain hangs beneath it as `superseded`. If an
operator overrides a cell to $5.00 on a quote with an amortized charge, is
$5.00 the whole unit price *including* the charge, or the non-charge price with
the charge added on top?

Both readings are defensible and they charge the customer different amounts.
Getting it wrong is a wrong number on a customer document, so it is a business
call.

**Note the precedent.** OD-023 made the cell root a SUM of the operator's price
and the cell's freight, and the arithmetic half of that was later judged wrong
(`costing.ts`, P-Direct-1). A root sum has been tried here and reverted, so
option B is not a free choice.

---

## 6 · Sequence

1. **§5 dispositioned** — lift and override interaction. Blocking.
2. Implement: elected recovery placed outside the adjustment, legacy path
   untouched.
3. Certify against a **non-zero adjustment fixture** — the dimension the
   original tripwire could not express, which is why it reported nothing.
4. Re-run the `52bd0077` certification: placement moves, **total does not**.
5. Lift the relocation refusal.
6. Repeat the real click-path certification on a surface where the
   authenticated session already works.

`included ↔ separate` stays refused throughout.
