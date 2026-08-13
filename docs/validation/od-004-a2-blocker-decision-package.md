# OD-004 — A2 manual Item Group wrapping is a V1 blocker

**2026-08-12 · sandbox `7924416_SB2` · SO2701 pristine · nothing implemented**

Edward established directly through the supported NetSuite UI that **expanded
Item Group member Rate fields are not editable.** That is the provider behaviour
this document is built on; no automated probe contributed to it.

## SO2701 — verified unchanged

| line | SKU | qty | rate | amount | class |
|---|---|---|---|---|---|
| 1 | `DPS-BOTTLE-0001` | 1,000 | **$4** | **$4,000** | Primary |
| 2 | `10064-GNX-Box` | 1,000 | **$6** | **$6,000** | Secondary |
| 3 | `DPS-BOTTLE-0001` | 1,000 | **$2** | **$2,000** | Primary |

Mainline **$12,000**. `Group`/`EndGroup` lines on SO2701: **0**. Not saved.
Group B not created. Group A unmodified.

## Observed provider behaviour

1. Item Group insertion **expands the correct member structure** —
   `Group → members → EndGroup`.
2. Member **Classes remain correctly Item-derived** (Box → Secondary,
   Bottle → Primary).
3. Members **initialise at `$0.00`**, because the Items are `Base Price` with no
   Item-record price.
4. **The supported NetSuite UI does not permit expanded member Rates to be
   overridden.**
5. Therefore the manual wrap **cannot reproduce Nexus's negotiated transaction
   rates.**

## Why this blocks

Converting SO2701 by the approved A2 mechanism would replace three governed
rates with `$0.00`:

```
Box     $6 × 1,000 = $6,000   ->  $0.00
Bottle  $4 × 1,000 = $4,000   ->  $0.00
Bottle  $2 × 1,000 = $2,000   ->  $0.00
total             $12,000     ->  $0.00
```

That violates the accepted commercial transaction **and** OD-005's prohibition
on `$0.00` in governed commercial fields. The mechanism cannot be made to work
by any means inside this walk's scope, and no workaround was attempted —
no Item-record pricing, no alternate price levels, no DOM manipulation, no
scripts, no hidden fields, no destructive SO edits.

## Evidence disposition — what Track B has proven

### PASS

| | |
|---|---|
| Nexus flat Sales Order CREATE | SO2701 / 361141 |
| Exact accepted-total preservation | $12,000 = $12,000 |
| Customer / item / rate / quantity projection | 72173, 3 lines, exact |
| NetSuite Item-derived Class | Primary / Secondary / Primary, flat **and** inside groups |
| Business Segment | `cseg_dps_bus_seg = 3`, UI-confirmed as *DPS Packaging* |
| Project Services / Source | `Primary Packaging` · `International → 2` |
| NetSuite-owned Terms | `SO.terms = 2`, from the customer record |
| Deterministic grouping plan | both groups, identity + members + rates + expected amounts |
| Item Group **record** creation via NetSuite UI | `75153 / OD004-CASEB-A-G` |
| Correct structural Group expansion | Box + Bottle, matching the plan |
| B3 Group/member/EndGroup observability | established, with legacy SO2454 as positive control |

### FAIL

| | |
|---|---|
| A2 manual Item Group wrapping | **cannot preserve negotiated Nexus member rates** |

**REG-4 cannot close on the currently approved manual-wrap mechanism.**

Note what did *not* fail: every Nexus-side obligation in REG-4 as reworded —
correct-summing flat lines, and a deterministic plan sufficient to group without
re-deriving a commercial figure — is met. The failure is in the **execution
mechanism** the plan was to be executed by.

## The decision — smallest possible

> **Are NetSuite Item Groups mandatory for V1 downstream operations and
> invoicing?**

This is a business question about what Accounting and Operations actually
require of the Sales Order. It cannot be answered from Nexus.

### If NO

- **Retain the proven flat Sales Order representation for V1.** It is already
  certified: SO2701 preserves the accepted total exactly, with correct items,
  rates, quantities, Class, Business Segment and Terms.
- **Preserve the Nexus grouping plan** as future migration/automation evidence —
  it costs nothing to keep and is the input any later mechanism will consume.
- **Remove manual Item Group wrapping from the V1 operational requirement**, and
  with it the manual step from the operational handoff checklist.
- REG-4 closes against the flat representation.

### If YES

- **A2 is no longer viable.** No amount of Nexus work changes that; the
  limitation is provider-side and was established in the supported UI.
- Previously evidenced alternatives, recorded here **without recommendation**:
  - **NetSuite Assembly Items** — proven to work at REST via Probe 4; DPS
    already has 9 in the catalogue, so this is expansion rather than greenfield.
    Whether an Assembly line can carry negotiated per-member economics is **not
    established** and would need its own evidence.
  - **A NetSuite-side RESTlet wrapping `N/record`** — the UI succeeds at
    operations REST/SOAP refuse because `N/record` has different interactive-save
    semantics. Whether that extends to member-rate override is **not
    established**.
  - Both are NetSuite-side capabilities, both are v1.1+ today, and both need
    their own proof that negotiated economics survive.
- **Do not choose or implement one without a separate architecture
  disposition.**

## Artefact status

- **SO2701 — keep unchanged.** It is the successful flat-order certification
  artefact and the reference for everything above.
- **Group A `75153 / OD004-CASEB-A-G`** — retained as an **unused sandbox
  validation Item Group**. Not attached to any transaction, `externalid` null,
  subsidiary 2, members Box ×1 + Bottle ×1. Recorded as such so a future audit
  does not read it as production data or as a failed partial wrap.
- **Group B** — never created.

**Track B is NOT closed.** It stays open until the Item Group business
requirement is dispositioned.
