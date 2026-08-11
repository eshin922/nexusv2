# OD-004 · real-provider walk runbook

**PREPARED, NOT EXECUTED. Administrator not booked.**

Two cases, one session. Case A needs no engineering; Case B depends on the §4
grouping plan, which is now landed and gate-green.

**Read first:** step B3 is an **open evidence question**, not a step with a known
answer. It must be resolved before B4, and if it resolves the wrong way the walk
stops there rather than improvising. Do not build a workaround in advance.

---

## Before the session

| | |
|---|---|
| **Environment** | Name the NetSuite account in the record — sandbox or production. Every figure below is meaningless without it |
| **Case A quote** | Accepted, un-completed, send-time `detail_level` = `itemized` |
| **Case B quote** | Accepted, un-completed, send-time `detail_level` = `turnkey_only`, **with at least two assemblies** — a single-assembly quote cannot exercise mis-attribution. This is a *fixture property for the ASY-backed proof*, not a requirement on quotes generally (see "What each case proves") |
| **Read the datum from the snapshot** | `SELECT s.detail_level FROM quote_snapshots s WHERE s.quote_id = :q AND s.superseded_at IS NULL;` — **not** `quotes.detail_level`. The live column can drift from what the customer agreed |
| **People** | NetSuite administrator (performs the wrap), operator (drives Nexus), recorder |
| **⚠ MANDATORY PREFLIGHT** | **Before Sales Order CREATE, verify in the target NetSuite account that no existing Sales Order carries the HubSpot deal ID.** `SELECT id, tranid, trandate, status FROM transaction WHERE type='SalesOrd' AND custbody_dps_deal_id='<dealId>';` — non-empty ⇒ CREATE is refused by `_dps_ue_prevent_dupplicated_so.js` (`DUPLICATED DEAL`). **Status is not a filter**: SO2624 is `Closed` and still blocks. A deal is consumed permanently by its first successful CREATE |

**Two live `turnkey_only` quotes and one sent snapshot exist.** If none is
suitable, a Case B quote must be prepared and **sent** — the applicability datum
is only frozen at send.

---

## What each case proves — read before recording anything

**Case B proves only the ASY-backed turnkey/grouped projection.** Its
two-assembly requirement exists so the walk can detect composition/membership
errors **that preserve the commercial total** — a single assembly cannot exercise
mis-attribution. **It is not evidence that all Nexus quotes require ASYs.**

That every currently reachable quote is ASY-backed is a property of the present
runtime, not a validated business rule. Under BV-006 §5, Direct Components
project as **flat NetSuite Item lines with no grouping**; that path is approved
business but unimplemented, and its absence from this session is **scope, not
evidence**. See OD-004 "Scoping correction" and the deferred silent-drop defect.

**Case A's claim stays narrow: it proves the currently implemented itemized
handoff.** It does **not** prove the future Direct Component projection merely
because both ultimately emit flat NetSuite Item lines. Case A's lines originate
from ASY-member LEAFs; a Direct Component line would originate from a canonical
attachment that no code path can yet produce. Same wire shape, different source
— and the source is the untested part.

---

## Case A — `itemized`

*The common case: 8 of 9 snapshots customers actually received.*

| step | action | expected |
|---|---|---|
| **A1** | Confirm send-time `detail_level` = `itemized` | — |
| **A2** | Complete the quote through the governed path | SO created |
| **A3** | Record `netsuite_so_id`, `netsuite_so_tranid`, `amount_pushed` from `netsuite_so_pushes` | one `succeeded` row |
| **A4** | **Administrator performs NO grouping.** This is the assertion, not a formality | — |
| **A5** | Read the SO lines back | see below |

**A5 assertions**

1. **Σ line amounts = `amount_pushed`** = accepted tier `totalRevenue`.
2. Line count and per-line rates match the frozen `payload_snapshot`.
3. **No Item Group is present** — the itemized presentation survived.
4. The customer-facing document shows itemized lines, matching the quote.

**Engineering required: none.**

---

## Case B — `turnkey_only`

### B1 · Complete and record

Same as A2–A3. Additionally extract the frozen plan:

```sql
SELECT payload_snapshot -> '__nexusGroupingPlan'
  FROM netsuite_so_pushes
 WHERE quote_id = :q AND status = 'succeeded';
```

Expect `applicability: "turnkey_only"`, `groupingRequired: true`, and one entry
in `groups[]` per assembly, each carrying `externalId`, `members[]`,
`expectedAmount` and `turnkeyUnitPrice`.

**Print this. It is what the administrator executes.**

### B2 · Verify the plan reconciles *before* touching NetSuite

Σ `groups[].expectedAmount` **must equal** `amount_pushed`. If it does not, stop
— the plan is wrong and grouping to it would push the error into NetSuite.

### B3 · ⚠ OPEN EVIDENCE QUESTION — establish read-back visibility FIRST

**Do this before the administrator groups anything.**

NetSuite represents a transaction Item Group as a header line plus member lines,
but **whether SuiteQL exposes that structure in this account is unverified** — 1
Sales Order has ever been pushed from Nexus and 0 Item Groups exist, so there has
never been anything to read.

Probe, in order, against the Case B SO before grouping:

1. `SELECT * FROM transactionLine WHERE transaction = :soId` — inspect the
   available columns; look for a line-level item-type discriminator.
2. If absent, join `item` on `transactionLine.item = item.id` and read
   `item.itemtype` (group items report as `Group`).
3. If neither exposes it, try `getRecord("salesOrder", soId)` and inspect the
   item sublist for group markers.

**Record which projection works.** Establishing it on the *ungrouped* SO first
means a null result after grouping reads as "wrong query", not "no group" — the
distinction the whole assertion rests on.

> **If none of the three exposes group structure:** stop and record it. REG-4's
> membership assertion is then unprovable by read-back, and the evidence
> question reopens for disposition. **Do not improvise a workaround during the
> session.**

### B4 · Administrator performs the wrap, executing the frozen plan

One group per `groups[]` entry:

- group identity = `externalId` (`nxs-grp-<compositionHash>`);
- members = exactly `members[]`, at the stated `quantity` and `rate`;
- the wrapped line displays `turnkeyUnitPrice`.

> **Reconcile against `expectedAmount`, not `turnkeyUnitPrice × quantity`.** At
> 4dp those can differ by rounding dust. `expectedAmount` is the target.

### B5 · Read back and assert

1. **Σ line amounts = `amount_pushed`** — the accepted total survived the wrap.
2. A group exists **per planned assembly**.
3. **Membership matches the frozen plan, member for member** — the assertion
   §4 exists to make possible. A wrong-member grouping reconciles perfectly on
   total; only this catches it.
4. Displayed turnkey price matches the plan.
5. **No `$0.00` in any governed commercial field** *(standing constraint; also
   OD-005)*.
6. The customer-facing document shows one turnkey line per assembly, with
   freight, customs and setup not exposed.

---

## What the session closes, and what it does not

| | |
|---|---|
| **Closes** | REG-4 (revised) · P1-014 · OD-005 · and — if concurrency and response-loss are exercised — REG-3, P1-011, SPEC-020 |
| **Does not close** | Item Group **creation by Nexus**. Out of V1 scope: an external-platform limitation, carried v1.1+ via RESTlet or Assembly migration |
| **Does not close** | **Direct Component / Detailed projection** (BV-006 §5). Approved business, unimplemented runtime, unreachable today. Neither case exercises it |

## Recording

### Evidence scope — read before writing the record

> This two-assembly fixture proves the ASY-backed turnkey projection only. It is
> not evidence that Nexus generally requires ASYs. Two assemblies are required
> here so the validation can detect composition/membership errors that preserve
> the accepted commercial total. Direct Components remain governed by BV-006 §5
> and project as flat NetSuite Item lines when that capability becomes reachable.

*Evidence-scope documentation. Not an OD-004 architecture change.*

Name the environment, both quotes, the datum read from each snapshot, the SO ids,
`amount_pushed`, **the SuiteQL projection that worked (B3)**, the groups created,
the read-back figures, and any divergence. One artifact, in the shape of R1: run,
not argued.
