# PREPARED FOR — customer identity

**Status: NOT STARTED. Sequenced after #428 Part B.**

Recorded 2026-08-25. Scope is strictly customer identity and presentation.

## What the historical trace established

**Finding C — never implemented.** There is no lost capability to restore.

In every version of the resolver that has ever existed, the assignment is
literally:

```js
name: project.clientName ?? "{customer-pending}",
contact: null, role: null, address: null,
```

The RI.6 commit (May 2026) is byte-identical to today, comment included: *"fuller
customer contact/role/address fields are HubSpot-side data not yet imported into
Nexus schema (Slice 11)."* Slice 11 came and went; the import never landed.

- No migration ever added a customer contact or address column. The only
  `customer_contact` in the migration history is on
  `freight_customer_arranges_meta` — a freight-leg field for customer-arranged
  shipments, unrelated to the quote recipient.
- No fixture ever supplied a value, so this is not "prototype showed it".
- The only non-null `address` ever assigned is `firm.vendorAddress` — the
  SELLER's address, on PREPARED **BY**.

**The renderer has been ready since RI.6.** `customer-pdf-parties.tsx` already
composes `[contact, role]` and renders `address`, both null-guarded, so the
block silently collapses to the company name. Presentation has been waiting for
a source, not the other way round.

## 1 · Freeze customer identity

**A correctness repair, independent of the new integration, and the prerequisite
for everything after it.**

`quote_snapshots` freezes `prepared_by_name` / `_email` / `_phone` — the
SELLER. It captures **no customer identity at all**, not even the company name.
So a sent quote's PREPARED FOR reads `project.client_name` LIVE: rename the
company in HubSpot, re-import, and a previously-sent quote re-renders with a
different customer on it.

The stored PDF is safe — an immutable file in Storage. The read model is not.
This is the Pattern 52 shape, and it is already true today with one field;
adding two more widens it.

Add the customer block to the snapshot and make sent quotes read it from there.

## 2 · Add the customer source

Extend the HubSpot integration to retrieve:

- associated company business / mailing address
- associated customer contact name
- contact role / title
- contact email **only if** it is appropriate for the quote block

`hubspot_deals_cache.associated_company_id` is already populated (e.g.
`17493436983` for deal `58222880425`), so the company lookup has its key. The
Contacts read is the genuinely new surface — the current sync touches neither
Companies nor Contacts.

### OPEN QUESTION — contact selection

**A deal may have several associated contacts. The rule for choosing one is not
decided, and must not be resolved by picking the first row.**

An arbitrary pick would put a named individual on a customer-facing quotation on
the strength of an arbitrary sort order. Candidate rules to disposition — none
adopted:

- the deal's primary contact, if HubSpot marks one
- a role-based rule (billing contact, decision maker)
- most recently modified association
- explicit operator selection on the quote, defaulting to the above

Whichever is chosen, **the absence of a determinable contact must render as
absent** — the block is already null-safe — never as a guess.

## 3 · Freeze the resolved fields at Finalize

A draft may reflect current HubSpot facts. Once finalized, PREPARED FOR must be
exactly what was frozen. Same discipline as `prepared_by_*`, and the reason step
1 comes first.

## 4 · Render

**No work expected.** Both renderers already handle these fields null-safely. A
new customer-document design is required only if real data exposes a layout
problem — a long company address wrapping badly is the likely candidate, and is
a Pattern 1 question (design was illustrative; real data needs different
proportions), not a redesign.

## Boundaries

- **PREPARED FOR address is not Bill-to.** A quote recipient address and an
  accounting billing address are different business facts and must not be
  conflated without a separately governed rule. Card 3's Bill-to has its own
  authority; nothing here may assume they share one.
- **None of these fields may feed NetSuite projection.** `verify:netsuite-isolation`
  (#429) enforces it structurally, and must continue to pass — a customer
  identity field reaching the Sales Order payload is an architectural
  regression regardless of whether the numbers move.
