# Track B fixture qualification — read-only

**No mutation of Nexus, HubSpot or NetSuite was performed to produce this
document.** Every figure below was read.

Supersedes the smoke-deal fixtures. Those are **preserved with their evidence**
and abandoned as certification fixtures — no HubSpot company association was
manufactured to make them pass.

---

## Why the previous fixtures failed

`markComplete` STEP 2 (`src/lib/netsuite/mark-complete.ts:296-313`) requires a
`hubspot_deals_cache` row carrying a non-null `associated_company_id`, then
resolves it to a NetSuite customer. Both prior fixtures fail there — **before
item resolution, before payload construction, before any NetSuite write**, and
therefore before B1 and B3.

| deal | cache row | live HubSpot company association |
|---|---|---|
| Case B `63198467934` | none | none |
| Case A `63235924086` | none | none |

The earlier qualification began at the grouping-plan boundary (STEP 3) and
inherited STEP 2 unverified. The prerequisite chain below is ordered as
`markComplete` executes it, not as the evidence was designed.

---

## Prerequisite chain — all valid-lineage companies

Steps 1-5 pass for **every** company holding governed lineage. The smoke deals
were the anomaly, not the norm.

| company | HubSpot company | governed lineage | live association | NetSuite customer (`7924416_SB2`) |
|---|---|---|---|---|
| heymistr.com | `36909687931` | ✅ | ✅ **agree** | **321443** |
| Smart Pressed Juice | `17493436983` | ✅ | ✅ agree | 124560 |
| Nemah | `16724275830` | ✅ | ✅ agree | 72173 |
| Epicuren | `17586902316` | ✅ | ✅ agree | 131860 |
| Kirby Beauty LLC | `18275649161` | ✅ | ✅ agree | 167468 |
| buildwithroot.co | `52961503280` | ✅ | ✅ agree | 360189 |

---

## The ranking criterion is Nexus artifact provenance, not convenience

Acceptance writes to the **deal**, not the quote. Every candidate deal is a real
commercial deal with a real amount and a recent modification date; none is
disposable. So disturbance is decided by **what the Nexus quotes are**.

| deal | company | stage | amount | scenario labels | quotes are |
|---|---|---|---|---|---|
| **`61113554855`** | heymistr.com | Delivered | $4,081.33 | `smoke-gate0-happy-0727`, `smoke-matrix-pure-0727`, `smoke-matrix-charges-0727`, `smoke-matrix-pure-cluster1-0727`, `smoke-addendum-0727`, `smoke-snapshot3-0727` | **entirely synthetic** |
| `58222880425` | Smart Pressed Juice | Development & Quoting | $30,000 | `Primary`, `ZZ-VALIDATION-tier-propagation` | commercial |
| `58332160883` | Nemah | Quote Request | $10,000 | `Primary`, `Alt 1`, `Ed's Test Scenario` | commercial |
| `40473295522` | Epicuren | New (Acquiring Info) | $5,000 | `Primary` ×6, `Alt 1-5`, `CSF-3/4 retest` | commercial |
| `59184980904` | Kirby Beauty | Development & Quoting | $30,000 | `Primary` ×2 | commercial |
| `59153706532` | buildwithroot.co | Quote Request | $10,000 | `Primary` | commercial |

`61113554855` is the **only** valid-lineage project whose quotes are all smoke
scenarios. Its deal is also the least active (last modified 2026-07-15) and is
named "Sachet Rollstock **Test Roll**". Every other project carries `Primary` /
`Alt N` — real commercial scenarios that must not be sent or accepted.

**Co-locating both cases on this one deal halves the CRM disturbance** — one
restoration instead of two.

---

## Recommended fixtures

### Case A — itemized · `071486be-e1a6-4475-8df6-2a2b78a21b58` (DPS-1011)

Scenario `smoke-matrix-pure-0727`. Qualifies **as-is**.

| prerequisite | state |
|---|---|
| governed lineage → NS customer | ✅ 321443 |
| send-time snapshot | ✅ `c19ae701` · `detail_level = itemized` · active |
| leaf resolution | ✅ `DPS-BOTTLE-0001` → `66476` |
| costing | ✅ complete (0.15 / 0.13), no nulls |
| tiers | ✅ 1000 / 5000, both positive |
| not completed | ✅ no succeeded push |

### Case B — ASY-backed turnkey · `a264a755-c375-4674-9342-5dc02a96d20e`

Scenario `smoke-matrix-pure-cluster1-0727`, draft, **same deal**. Currently 1
ASY / 1 leaf / tiers 2000 · 8000 (both positive) / cost complete.

Minimum changes to reach a fully derivable turnkey plan — identical to the
sequence already proven on the retired fixture:

1. `detail_level` → `turnkey_only` (Preview surface)
2. create second ASY (AddProductModal **ASY mode** — Nexus-local, creates no
   HubSpot Product)
3. attach a resolvable leaf — `10064-GNX-Box` → `1024`, already commercially
   associated with this customer via DPS-1012
4. enter cost for the new leaf at both tiers
5. Send → freezes the `turnkey_only` snapshot
6. Mark Accepted

---

## Writes required, by blast radius

| | Case A | Case B |
|---|---|---|
| **Nexus-only** | none | detail level · +1 ASY · +1 leaf attach · 2 cost cells · Send (quote number, PDF to Storage, snapshot) |
| **HubSpot-visible** | 1 accept → stage **Delivered → Won - In production**, `amount` → Case A total | 1 accept → `amount` → Case B total (stage already Won) |
| **NetSuite sandbox** | 1 Sales Order, customer 321443 | 1 Sales Order, customer 321443 |
| **Customer-facing** | none — no email in this environment; the sent PDF already exists | none — PDF is generated and stored, not transmitted |

**Restoration reference for `61113554855`, captured read-only:**

```
dealstage = 195274343   (Delivered)
amount    = 4081.33
closedate = 2026-06-17T16:21:30.297Z
```

One restoring write returns both fields after the session.

**The HubSpot writes land on a real customer deal.** They are restorable and
were captured before the fact, but they are visible in the deal timeline, and
Delivered → Won - In production is a backwards pipeline move. This requires
explicit per-deal authorization; sandbox NetSuite does not imply it.

---

## Recorded separately

### Lineage-retention observation

> Historical smoke deal `63252890041` successfully pushed on 2026-07-29 but now
> has neither governed cached company lineage nor a live HubSpot company
> association.

Classified as a **lineage-retention observation**. Not investigated further for
V1. Re-open only if the same condition appears on a real-lineage candidate or
threatens the production handoff generally. All six real-lineage deals currently
**agree** between governed and live association, which is evidence against a
general retention defect.

### Retired evidence

The dry-run `composition_hash` / `nxs-grp-*` identities computed against the
placeholder customer are **retired from certification evidence**.
`composition_hash` includes `customerNetsuiteId`, so a placeholder yields
non-authoritative identities.

**Membership and arithmetic evidence from that run remains valid** — it is
customer-independent. Deterministic identities are not authoritative until
computed with the actual governed NetSuite customer, which for the recommended
fixtures is **321443**.
