# Parity items — dispositions and open decisions

**Dispositioned 2026-08-11 (Edward).** C.2 **CLOSED** for V1 as accepted manual
NetSuite responsibility. OD-001 **CLOSED** for V1 by removing the unsupported
operator control. **C.3 and C.4 remain HELD for Accounting** — they are external
business inputs and must not be replaced by engineering inference.

## C.2 — DISPOSITION (V1)

> **C.2 — V1 accepted manual/post-CREATE NetSuite responsibility. Structured
> Nexus Ship-to automation deferred post-V1.**

At Sales Order CREATE, Nexus may let NetSuite populate the customer-default
shipping address, and **does not claim that this is the final fulfilment
Ship-to**. Accounting reviews and sets the transaction-specific Ship-to in
NetSuite before downstream fulfilment/invoicing.

**No precedence rule connecting freight destinations to SO Ship-to is
invented.** The measured facts below are the reason it stays manual, not a plan
to automate it: no structured address model, `consignee` unpopulated (0 of 11),
inconsistent `destination` granularity, and divergent destinations already
reachable on one live quote.

**→ The operational handoff checklist must carry manual Ship-to verification.**

## OD-001 — DISPOSITION (V1)

> Remove the unsupported Pass-through/Bundled operator choice. Preserve the
> single governed V1 freight behaviour. Pass-through capability is **post-V1,
> not declined.**

Implemented: the choice is gone from Create Shipment and shipment edit;
`treatment` is still submitted; the edit path echoes each shipment's own
persisted value so no historical row is rewritten. Freight/duty/tariff
arithmetic, markup, quoted sell, Cost Stack attribution and the §2c-certified
customer presentation are unchanged. Evidence:
`tests/unit/od-001-freight-treatment-surface.test.ts`.

---

# Original decision package — C.2, C.3, C.4, OD-001

**Everything here is blocked on a decision, not on engineering.** No further
investigation is proposed. Each item states the established facts, the actual
reachable cases, the smallest decision required, and what unblocks on each
answer.

Gating: **Nemah `DPS-1045` stays sent, unaccepted and unrevised** until these
are dispositioned.

---

## C.2 · Ship-to · **DECISION REQUIRED — Edward**

### Established (not re-investigated)

- Legacy orders can use a **transaction-specific third-party ship-to** — SO2617
  shipped to Concept Labs, not to Nemah's own address.
- The customer-default address is **insufficient** — SO2698 (the Nexus push)
  used `shipAddressList: 57936` with `override = false`, i.e. the customer's
  address book.
- NetSuite supports transaction-specific `shippingAddress` with
  `override = true`, requiring **no** customer address-book insert.
- Legacy achieved this with a **text-only** override while the structured
  fields still held Nemah's Nashville address — internally contradictory.
  **Reproducing that is not acceptable.**
- Nexus **lacks the structured address data** to project it correctly.

### How badly it lacks it — measured

| | |
|---|---|
| `freight_destinations` rows | **11** |
| …carrying a `consignee` | **0** |
| destination granularity | free text, mixed: `"Los Angeles"`, `"Texas"`, `"Edina, MN 55439"` |

There is no street / city / state / postal / country decomposition anywhere.
`destination` is one free-text field used at region *and* address granularity,
and the party being shipped to is never recorded.

**So C.2 is not one gap but two**, and they are independent:

1. **No structured address** — cannot populate a NetSuite `shippingAddress`
   subrecord without inventing fields.
2. **No consignee** — cannot name the third party even when the address exists.

### The selection question, with the actual reachable cases

> If multiple freight subcategories on one quote select different destinations,
> what determines the Sales Order-level ship-to?

Measured against live data — **3 quotes carry freight at all**:

| case | count | |
|---|---|---|
| single subcategory | 2 | no ambiguity; its selected destination is the only candidate |
| **multiple subcategories, divergent destinations** | **1** | quote `2f29af72` — *Los Angeles* and *Texas* |
| multiple subcategories, same destination | 0 | |

**The divergent case is already reachable.** It is not hypothetical and cannot
be deferred as unreachable — one existing quote is in it today.

### The minimum decision

**Q1 — precedence.** When subcategories diverge, the SO ship-to is:

| option | consequence |
|---|---|
| **(a)** the destination of a **designated primary** subcategory | needs a "primary shipment" concept Nexus does not have — new governed field |
| **(b)** **refuse to push** until the operator resolves it to one | fail-closed, consistent with the C.1 precedent; no new model, one new guard |
| **(c)** an explicit **quote-level ship-to**, independent of freight | cleanest commercially; freight destinations stay a costing concern; largest change |
| **(d)** leave `shipAddressList` (customer default) and accept the legacy gap | preserves today's behaviour; keeps the known parity defect open |

**Q2 — structured address.** Is capturing consignee + structured address in
Nexus **in V1 scope**? If no, C.2 cannot close in V1 and (d) is the only
consistent answer — which should then be recorded as an accepted V1 limitation
rather than an open defect.

**I recommend nothing here** because Q1's answer depends on Q2, and Q2 is a
scope call rather than a technical one.

---

## C.3 · Customer PO · **DECISION REQUIRED — Accounting**

### The question, verbatim

> Which NetSuite field must carry the customer PO/reference for downstream
> invoices, packing slips, fulfillment and AR: standard `otherRefNum`,
> `custbody_dps_client_po`, or both?

### Why it cannot be inferred

Both fields exist on the Sales Order. Field presence establishes only that
someone created them — not which one downstream documents read. The consumers
that matter (invoice print, packing slip, fulfilment, AR aging) are **NetSuite
configuration**, not Nexus behaviour, so the answer is not discoverable from
this side. Guessing risks a PO reference that appears on the order screen and
is missing from the customer's invoice — the same class as C.1, where a field
existed, was populated, and was consulted by nobody.

**Nexus currently populates neither.** Nothing is at risk today; the cost is
that a customer PO cannot be carried at all.

### What unblocks on each answer

| answer | Nexus change |
|---|---|
| `otherRefNum` | populate the standard field on push |
| `custbody_dps_client_po` | populate the custom field on push |
| both | populate both; decide which is authoritative on conflict |
| neither / not needed in V1 | record as out of scope and close C.3 |

A prerequisite either way: **Nexus has no customer-PO input field.** Whichever
target is chosen, a governed capture point is needed — and its authority
(operator-entered? from HubSpot?) is part of the same decision.

---

## C.4 · Customer deposit · **DECISION REQUIRED — Accounting**

### The question, verbatim

> Do the DPS customer-deposit percentage/type/required-deposit fields drive
> deposit invoicing/accounting behaviour? If yes, when must they be present and
> what is their source authority?

### Why it matters now, and why it connects to C.1

C.1 established that **4 of 9 customers carry deposit-shaped governed terms**
(`50% Deposit/balance at shipment`) while **5 carry `Net 30`**. If the deposit
fields drive real invoicing behaviour, then a deposit-terms customer whose SO
lacks them produces an order whose terms promise a deposit that Accounting
never invoices.

That is the C.1 defect one system over: a commitment recorded in one place and
not honoured by the mechanism that acts on it.

**Nexus populates none of these fields.** So today either they are inert, or
every deposit-terms order is already incomplete. Which of those is true is
exactly the question.

### What unblocks on each answer

| answer | consequence |
|---|---|
| inert / informational | record and close C.4 |
| **drives invoicing** | required whenever the customer's governed terms are deposit-shaped; source authority must be named — NetSuite Terms record? customer record? per-order? |

If the answer is "drives invoicing", the source authority question is the real
work, and it should be settled in the same conversation rather than deferred —
C.1 shows what happens when a value ships without one.

---

## OD-001 · Freight presentation · **DECISION ALREADY OPEN — Edward**

Surfaced, not reopened. **§2c settled the mechanics; none of that is in
question here.** Freight, duty and tariff reach quoted sell exactly once and
land inside the unit price. What remains is a **presentation authority**
question only.

### State

BV-009 is cited in production code at `customer-view-resolver.ts:368` as the
authority for suppressing the customer-facing freight line. **It has never
existed in any branch at any point in history.** A reconstruction exists and is
explicitly **not ratified**.

### The one fact §2c added

`treatment` is a **required operator control** — `Bundled · amortised across
units` vs `Pass-through` — on both Create Shipment and shipment edit, persisted
to `freight_subcategories.treatment`. **The resolver never reads it.**
`freightLines` is hardcoded `[]`. Selecting *Pass-through* changes nothing the
customer sees.

So the unratified suppression does not merely lack documentation — it
**silently discards a required operator input**.

The banked customs contract states the intent explicitly: *"show only
'Freight: $X' per tier … when `freight_treatment = pass_through`; invisible
when `bundled`."* Measured against that, suppression is **correct for
`bundled`** and **unimplemented for `pass_through`**.

`422cc7e` removed the false freight *statements*; it deliberately decided
nothing about whether freight should be *shown*.

### Available dispositions

| | |
|---|---|
| **(a) Ratify** the reconstruction as BV-009 | citations resolve; then implement `pass_through` projection so the operator control means something. Suppression for `bundled` stands |
| **(b) Amend, then ratify** | anything the citations do not capture is currently unenforced |
| **(c) Reject** | every citation becomes suspect, **including the PDF suppression already shipped on its authority** |
| **(d) Remove the operator control** | if freight is never customer-visible in V1, `Pass-through` should not be offered. Honest, and smaller than (a) |

**(d) is worth explicit consideration.** If the answer to "should freight ever
show?" is *not in V1*, then the correct repair is not to implement
pass-through — it is to stop asking operators a question whose answer is
discarded.

**What settles it:** Edward's recollection of the original approval, or an
external record of it.

---

## Summary

| item | blocked on | reachable-now impact |
|---|---|---|
| **C.2** | Edward — scope (structured address in V1?) then precedence | 1 live quote already divergent; every push uses the customer default |
| **C.3** | Accounting — which field | no customer PO carried at all |
| **C.4** | Accounting — inert or operative | 4 of 9 customers have deposit-shaped terms |
| **OD-001** | Edward — ratify / amend / reject / remove control | operator control exists and is discarded |

None requires further investigation from me. Each requires an answer.
