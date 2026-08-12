# Case B — Group A creation + unsaved SO probe findings

**2026-08-12 · sandbox `7924416_SB2` · SO2701 pristine throughout**

Banked before the rate-editability probe. Nothing here was saved to SO2701.

## Group A — created

| | |
|---|---|
| internal id / name | **75153** · `OD004-CASEB-A-G` |
| subsidiary | **`Parent Company : The DPS, Inc.` / 2** |
| external id | **null** — accepted manual-V1 limitation (option 1) |
| members | `10064-GNX-Box` ×1 · `DPS-BOTTLE-0001` ×1 |
| Display Components on Transactions | **unchecked** |
| **Group B** | **does not yet exist** |

Naming follows `pickAvailableDisplayName`'s `<baseSku>-G` convention, so the
manual record matches what automation would later generate.

### Subsidiary constraint — first save was refused

> *"You may not add members to a group/kit/assembly unless the subsidiaries for
> those members completely contain the subsidiaries of the group/kit/assembly."*

The form defaults to **Parent Company**; the members live in **Parent Company :
The DPS, Inc.** The group must be set to the child subsidiary. No group was
created by the refused save.

## Unsaved SO2701 probe — structural result

Group A appended to the three untouched flat lines expanded as:

```
OD004-CASEB-A-G      qty 1                      <- Group header
  10064-GNX-Box      qty 1   rate 0.00   Class Secondary
  DPS-BOTTLE-0001    qty 1   rate 0.00   Class Primary
End of Group
```

- **Membership expanded correctly** — Box + Bottle, matching the frozen plan.
- **Member Classes remained NetSuite Item-derived** — Box → **Secondary**,
  Bottle → **Primary**. The V1 Class contract holds inside groups, not only on
  flat lines.
- **Initial member rates were `$0.00`.** Both items are `Base Price` with no
  price on the item record.
- **Initial group quantity was `1`**, not the commercial 1,000.

### No evidence about editability

Attempts to change rate and quantity **landed in the wrong cells** in the
horizontally-scrolled sublist — the `6.00` went into the line's *Item* field and
NetSuite answered `No match for: 6.00`. The staged `rate` never moved off
`0.00`.

**These attempts therefore provide NO evidence either way about whether member
Rate is editable.** Recorded as a failed instrument, not a finding — the same
discipline applied to the earlier synthetic-blur harness problem.

### Probe cancelled; SO2701 byte-identical

Read-back after cancel matches the pre-probe read-back exactly:

| line | SKU | qty | rate | amount | class |
|---|---|---|---|---|---|
| 1 | `DPS-BOTTLE-0001` | 1,000 | 4 | 4,000 | Primary |
| 2 | `10064-GNX-Box` | 1,000 | 6 | 6,000 | Secondary |
| 3 | `DPS-BOTTLE-0001` | 1,000 | 2 | 2,000 | Primary |
| 4 | *(TaxGroup, system)* | -1 | 0 | 0 | — |

Mainline total `12000`. No group, no `EndGroup`, nothing added.

## Inventory warnings — informational, not blockers

Adding the group raised NetSuite availability warnings:

- `10064-GNX-Box`: *"only 0 available for commitment at this location (1500 back
  ordered, 0 on order)"*
- `DPS-BOTTLE-0001`: *"only 0 available for commitment at this location (2500
  back ordered, 0 on order)"*

Expected for zero-stock sandbox `InvtPart` items. They do not block line entry
and say nothing about rates. **They will appear again during the real grouping**
— recorded so they are not mistaken for a failure at that point.

## Business Segment — semantic confirmation obtained

**The NetSuite UI displays `DPS Packaging` for `cseg_dps_bus_seg = 3`.**

This is the confirmation that was previously permission-blocked — SuiteQL cannot
read `CUSTOMRECORD_CSEG_DPS_BUS_SEG` and the REST record API returns *"higher
permission for value management of custom segments"*. The label matches the
HubSpot `business_segment` enum-3 label exactly.

The alignment previously established statistically (80/91 legacy orders) is now
**semantically confirmed**. The V1 disposition — preserve the projection —
stands on both grounds.

## Project Manager — reclassified as NetSuite-derived

**The SO displays Project Manager = `Lexa Yerges`**, which is exactly who
HubSpot `pm_id = 673896208` is — and Nexus transmitted **no**
`custbody_project_manager` (absent from the frozen body,
`sha256 a82e11ba…`; `markComplete` never passes `projectManagerNsId`).

So NetSuite derived the field itself **and derived it correctly**. This upgrades
the earlier classification from "NetSuite-derived, source unconfirmed, value
unverified" to **NetSuite-derived and verified correct for this workflow**.

**Do not build a Nexus owner→employee mapping.** The open question is closed
unless contrary evidence appears on some future order.

## Future Item Group automation — prerequisite recorded

`findOrCreateItemGroup` builds its `itemGroup` payload with `itemid`,
`externalId`, `description` and `member.items[]` — **it does not send
`subsidiary`.** The refused save above proves the constraint is real and
enforced.

**Subsidiary coverage is a prerequisite before that primitive is wired into
production.** Not repaired during this walk; the working code is untouched.

Joins the existing post-V1 list alongside deterministic-identity reconciliation
for manually created groups.
