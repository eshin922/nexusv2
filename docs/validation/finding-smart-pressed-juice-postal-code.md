# Source-data finding · Smart Pressed Juice postal code

**Status: OPEN. Needs an operator to correct the HubSpot company record.**
**Blocks #431 Step 4 visual validation on this customer.**

Raised 2026-08-25 during #431 Step 2, when the company's governed business
address first became customer-facing data.

## What HubSpot holds

Company `17493436983` — Smart Pressed Juice:

```
address   15615 ALTON PRKWY
city      Irvine
state     CA
zip       15615          <-- duplicates the street number
country   United States
```

Composed for the document, that renders as:

```
15615 ALTON PRKWY
Irvine, CA 15615
United States
```

## Why it is a finding and not a bug

`15615` is the street number of `15615 ALTON PRKWY`, repeated into the postal
field. Irvine, CA postal codes are five digits beginning `926`, so `15615` is
not a plausible ZIP for that city and state — it is almost certainly a
data-entry slip in the CRM.

**Nexus is not wrong.** It renders what HubSpot holds, which is the intended
behaviour: HubSpot is authoritative for company identity, and the value is
passed through verbatim.

## What was checked, so "there is no correct value hiding somewhere" is a
## finding rather than an assumption

Every address-shaped property on the company record was queried, not just the
six the code reads — including the `hs_`-prefixed variants and billing/shipping
address fields. **Only six address properties exist on the record**, and there
is no alternate, corrected, or secondary postal value anywhere on it.

So the ZIP cannot be repaired by reading a different field. The record itself
has to change.

## Why Nexus must not fix it

Substituting a plausible postcode — say `92618` — would put a value in front of
the customer that exists nowhere in the CRM. The next person to compare the
quotation against HubSpot would find two different addresses with no way to tell
which was authored and which was inferred, and the inferred one would be on the
document the customer received.

A test pins the pass-through behaviour
(`tests/unit/hubspot-customer-identity.test.ts`, "a suspicious source value is
passed through, never corrected") so a future well-meaning normalisation does
not quietly acquire the habit.

## What needs to happen

1. An operator corrects the postal code on HubSpot company `17493436983`.
2. The normal deal sync refreshes `hubspot_deals_cache` — no manual step, and
   no Nexus-side data edit.
3. #431 Step 4 visual validation proceeds on a draft quote for this customer,
   confirming the PREPARED FOR block renders:
   - Smart Pressed Juice
   - Jennifer Sevilla
   - the company business address
   - **no role** — HubSpot `jobtitle` is empty, so it is correctly absent
   - **no customer email** — cached for operator surfaces, deliberately not
     printed on the customer's own document
4. A validation quote is then finalized to prove those fields freeze and stay
   unchanged on the sent read model.

## Related

Sent quotes are unaffected either way: `0106` deliberately did not backfill
contact or address, so quotes sent before this work render without them rather
than claiming an address they were never sent with.
