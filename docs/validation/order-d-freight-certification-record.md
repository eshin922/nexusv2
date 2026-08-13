# Order D — Item Group + freight/customs Accounting artifact

**SO2709** (internal id 361741) · deal `59815074352` Nemah · customer `72173` ·
quote **DPS-1050** · completed 2026-08-13. All verification checks pass.

## Nexus commercial state

```
Group  ASY-9af5fe52-G   qty 1,000
  10064-GNX-Box     cost 0.6250 + 100% → $1.25 product
  DPS-BOTTLE-0001   cost 1.1250 + 100% → $2.25 product
                                product component  $3,500

Freight shipment · one destination · one break at tier 1,000
  freight 500 · duty 100 · tariff 50   (all markups 0)
                                additions           $650
                                ORDER TOTAL       $4,150
```

Freight and customs persist as **absolute amounts** — `freight_amount` on
`freight_destination_breaks`, and `charge_type` `duty`/`tariff` rows on
`freight_customs_breaks`. Markups were set to zero deliberately:
`computeShipmentContribution` divides each amount by tier units and multiplies
by `(1 + markup)`, so a non-zero markup would have silently inflated the
artifact past the approved $650.

**Freight is attached once, at the anchor leaf** — 1 of 2 leaves carries it, so
the additions total $650 and are **not multiplied by BOM quantity**. Every leaf
multiplicity is 1, so D does not double as the first field exercise of the
just-closed OD-025 dimension repair.

## Provider artifact

```
seq=1  ASY-9af5fe52-G   [Group]      qty 1,000
seq=2  10064-GNX-Box    [InvtPart]   1,000 @ $1.90 = $1,900   class 10
seq=3  DPS-BOTTLE-0001  [InvtPart]   1,000 @ $2.25 = $2,250   class 1
seq=4  EndGroup                                     4,150
                                     SO TOTAL      $4,150     customer 72173, Net 30
```

Guards: exactly one SO for the deal · one Item Group · no $0.00 governed member
· no 1,000,000 member quantity · quote `complete` · durable push `succeeded` ·
production HubSpot unchanged on all four values (stage `195274339`, amount
`10000`, closedate, lastmodified).

## Accounting interpretation point — NOT a D certification failure

**Classification, per Edward 2026-08-13: this is an interpretation point for
Accounting, not a defect and not a failure of D's certification.** D passed every
verification check; the SO is commercially correct at $4,150.

**Freight and customs do not appear as separate Sales Order lines.** They are
absorbed into the anchor member's rate: Box bills at **$1.90**, of which $1.25 is
product and $0.65 is freight + duty + tariff.

This is **designed behaviour, not a defect** — `mark-complete.ts:408-411` states
it directly: a *"single turnkey line ($X per unit) instead of the freight,
customs, and setup components separately … with freight/customs invisible — the
group doing its job."* There is no freight path in the SO projection at all, by
construction, and INV2978 is the precedent.

Two consequences worth stating plainly, because they are exactly what D exists
to show:

1. **The SO's product subtotal is $4,150, not $3,500.** The $3,500/$650 split is
   real and verifiable in Nexus, and is not recoverable from the Sales Order.
2. **$0.65/unit of freight and customs is attributed to a packaging component.**
   The Box line rate is not the Box's commercial price. Attribution is governed
   (anchor-leaf, per the costing-adapter contract) and the arithmetic is correct
   — but a reader who takes the line rate as a product price will misread it.

**The reconstruction limit, stated plainly:** NetSuite cannot reconstruct the
$3,500 product / $650 logistics-customs split from the SO lines alone. Nexus
holds that split; the Sales Order does not carry it.

Recorded for Accounting's disposition; no change made.
