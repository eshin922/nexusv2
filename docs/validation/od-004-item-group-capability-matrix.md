# OD-004 — Item Group capability matrix

**2026-08-12 · investigation only · nothing implemented · SO2701 untouched**

Item Groups are **mandatory for V1** (business disposition). A2 manual wrapping
has failed. This establishes the capability boundary before anything is built.

---

## The headline — the premise A2 rested on was already known to be wrong

`od-004-decision-set.md` §A1 states:

> *"The SO validator refuses Item Group lines at CREATE via **both** REST and
> SOAP … an external-platform capability limitation."*

**That is superseded**, and was superseded *before* A2 was adopted. The
correction is recorded in `docs/UX_BACKLOG.md` under
*"Grouped-SO representation — reopened"*, Probes 6-7 (2026-07-29):

> *"`Please enter a value for Amount` meant exactly what it said … NetSuite's
> REST SO validator runs a 'compute per-line amount from group members' step at
> parse time, BEFORE reading inline `rate`. When members have populated
> `/price`, that step succeeds; when they don't, it fails."*
>
> *"**A thorough elimination is not a diagnosis.** Seven payload shapes across
> two API surfaces looked definitive. The conclusion drawn from them — 'the API
> refuses Item Groups' — was wrong."*

**REST accepts Item Group lines.** The refusal was a **data condition on the
member items**, not an architectural prohibition. Two governance documents
disagreed, and the stale one is the one that drove the A2 disposition and this
entire manual-wrap walk.

## Proven mechanism (Probes 6-7, already executed)

| probe | result |
|---|---|
| **6b v4** | Bare-group SO POST where the member has populated `/price` → **204 CREATED** (SO 359847) |
| **6c** | Unpriced members have EMPTY `/price`; the UI populates rates tx-line-side, the API validator reads item-side `/price` at parse time |
| **6d** | Inline member rates on the request do **not** substitute for item-level `/price` |
| **7a** | Adding an explicit member line beside the group **DUPLICATES**; the group line's own rate is ignored |
| **7b** | **`/price = $0.00` is a legal, validator-satisfying placeholder** |
| **7d** | **`PATCH /salesOrder/{id}/item/{lineIdx}` with `{rate: X}` updates the auto-expanded member line IN PLACE** — 204, rate changes, amount recomputes, no duplication |

The working sequence is therefore:

```
POST bare-group SO  →  GET expandSubResources  →  N × single-line PATCH member rates
```

**This preserves negotiated economics.** 7d is precisely the capability the
manual UI lacks — the API can set an expanded member's rate; the UI cannot.

## Our items already satisfy the precondition

| item | `/price` level 1 |
|---|---|
| `1024` `10064-GNX-Box` | **0** — present |
| `66476` `DPS-BOTTLE-0001` | **0** — present |

Both carry a populated `$0.00` price row, which per 7b **satisfies the
validator**. The Case B fixture needs no catalogue change to exercise the
grouped path.

*(This also explains the manual-UI failure cleanly: the UI expands members from
item price — `$0.00` — and won't let you override. Same data, different
capability.)*

## Probe 7 forensics — the eight questions

**Evidence status first: the primary artefact is gone.** SO **359847** returns
**0 rows** in the sandbox today — it was a throwaway and has been cleaned up.
The Probe 6-7 findings are therefore **documentary, not re-verifiable**. The
record is detailed, internally consistent (7a/7b/7d are distinct results, and
the two banked hazards are derived from them), and was written by the same pass
that produced the *"a thorough elimination is not a diagnosis"* correction — but
it cannot be re-read from the provider. Weight it accordingly.

| # | question | answer |
|---|---|---|
| 1 | Which sandbox SO proved bare Item Group CREATE? | **SO 359847** (Probe 6b v4), 204 CREATED, member item **2769** carrying `/price` priceLevel=1/currency=1 = $6.884. **Deleted — not re-verifiable.** |
| 2 | Which REST operation patched expanded member rates? | **`PATCH /salesOrder/{id}/item/{lineIdx}`**, body `{rate: X}` → 204, rate changes, amount recomputed, no duplication (Probe 7d). |
| 3 | How were expanded lines identified safely? | `GET /salesOrder/{id}?expandSubResources=true`, then **single-line** PATCH by line index. ⚠ **Caveat from our own code** (`scripts/smoke/mark-complete.ts:476`): *"REST GET `?expandSubResources=true` hides SO lines under the item sub-resource"* — **SuiteQL on `transactionLine` is the dependable projection**, and is also what B3 already proves works. |
| 4 | Was the final total verified after patch? | **NOT RECORDED.** 7d asserts per-line rate change and amount recompute. **No end-to-end total assertion exists.** Gap. |
| 5 | Was Group/member/EndGroup structure preserved after patch? | **PARTIAL.** "No duplication" is recorded; explicit post-patch structural assertion is not. Gap. |
| 6 | Idempotency / recovery between CREATE and PATCH? | **NONE EXISTED.** Hazard 2 flags partial failure as unsolved: crash mid-sequence leaves the SO created, group expanded, some members priced and others at `$0.00` — *"Order looks valid; nothing flags the drift."* Two recovery designs proposed (Nexus-level transaction with SO delete, or SuiteQL read-back assertion before `status='succeeded'`); **neither built.** |
| 7 | Which catalog items got `$0.00` Base Price as prerequisite? | Probe 7b used a **throwaway InvtPart** created with `/price = $0.00`. Probe 6b v4 used real item 2769 at $6.884. Probe 8c counted **~937 unpriced InvtPart items** estate-wide. **No production backfill was performed.** |
| 8 | Is the prerequisite satisfied for the Case B items? | **YES — verified live today.** `1024` `10064-GNX-Box` → pricing level 1, unitprice **0**. `66476` `DPS-BOTTLE-0001` → pricing level 1, unitprice **0**. Both satisfy the parser per 7b; **no catalogue change needed for Case B.** |

**Two real gaps** (#4, #5) and **one unbuilt safety requirement** (#6). None
contradicts the mechanism; all three are verification/robustness work that this
walk has already built the tools for — the frozen grouping plan supplies the
expected figures, and B3 supplies the structural read-back.

## Reconciliation with current code

| current state | implication |
|---|---|
| `findOrCreateItemGroup` exists, **not wired**; import present at `mark-complete.ts:27`, no call site, `itemGroupOutcomes` hardcoded `[]` | Needed for step 2. Prerequisites: **set subsidiary** (proven mandatory by the refused manual save) and **consume the frozen plan** rather than its own parallel `FindOrCreateInput`. |
| `markComplete` sends **flat lines**; `stripGroupingPlan(payload)` removes the plan envelope before POST | The group line replaces the flat lines for `turnkey_only`; `stripGroupingPlan` stays (the plan must not be transmitted). |
| `grouping-plan.ts` **already holds the commercial authority** — `externalId`, `members[]`, member rates, `expectedAmount`, `turnkeyUnitPrice`, built at `mark-complete.ts:620` | No new commercial derivation. The plan is already the exact input the PATCH step needs. |
| NetSuite client exposes `suiteQL`, `getRecord`, `createRecord` — **no update primitive** | One new narrow primitive required: single-line PATCH. |
| Manual-group External ID limitation | **Irrelevant** once Nexus creates groups over REST — confirmed by the surviving `nxs-probe-1785269500395` Group, which carries a REST-set external id. Deterministic identity is restored automatically. |

## Minimum code path

1. **`patchSalesOrderLine(soId, lineIdx, { rate })`** in `client.ts` — a
   single-line PATCH primitive. **Must be the only update shape available**;
   full-sublist PATCH silently duplicates at 204 (hazard 1), so this is
   structural, not conventional.
2. **Plan → `FindOrCreateInput` adapter** + **subsidiary** on the `itemGroup`
   payload in `item-groups.ts`.
3. **Call `findOrCreateItemGroup` in `markComplete`** for `turnkey_only`, once
   per planned group, replacing the hardcoded `itemGroupOutcomes = []`.
4. **Emit group lines instead of flat lines** when `groupingRequired` — group
   line only, **never** group + explicit members (Probe 7a: duplicates).
5. **Read back expanded lines via SuiteQL `transactionLine`** — not
   `expandSubResources`, per the caveat in #3.
6. **PATCH each expanded member to its planned rate.**
7. **Assert before success**: every expanded member carries its planned rate,
   group totals equal `expectedAmount`, Σ = accepted total, no `$0.00` in any
   governed field — *then* persist `netsuite_so_pushes.status='succeeded'`.
   This closes gaps #4, #5 and #6 together.

Step 7 is not optional polish. It is the recovery model hazard 2 requires, and
it is the same assertion set `.artifacts/postgroup.ts` already implements.

## Capability matrix

| surface | create SO with group | add group to EXISTING SO | set negotiated member rate | verdict |
|---|---|---|---|---|
| **REST POST** | **YES** — 204 when members priced (6b v4) | n/a | via 7d PATCH | **proven** |
| **REST PATCH — single line** `/item/{idx}` | n/a | **untested** | **YES** — in place, no duplication (7d) | **proven for rate** |
| **REST PATCH — full sublist** | n/a | refused when unpriced (Probe 5 ×4) | — | **PROHIBITED — silently duplicates at 204** (hazard 1) |
| **SOAP** | same data condition as REST; behaves identically | untested | untested | no advantage over REST |
| **SuiteScript / RESTlet** | would work (`N/record`, as the UI does) | would work | would work | **unnecessary** — REST suffices |
| **`findOrCreateItemGroup`** | creates/reuses the group **item record** only | — | — | **orthogonal**; does not touch SO pricing |
| **Assembly Items** | REST-clean (Probe 4) | — | tx-line pricing | **not needed**; changes ERP semantics |

### Path 1 — the one genuine gap

**Whether PATCH can add a group to an already-created SO is untested with
*priced* members.** Probe 5's four PATCH variants failed — but every one ran
against **unpriced** members, and Probe 6 showed that was the cause. So Probe 5
does not answer the question; it answers a different one.

**This gap does not block V1.** The proven sequence creates the group at POST
time, which is what every future quote does. Post-CREATE conversion is only
needed to retrofit SO2701 — and SO2701 should stay as flat-CREATE evidence
anyway.

### Path 2 — not required

A RESTlet was the fallback for "the API cannot do this." The API can. Building
NetSuite-side script for a capability REST already provides adds a deployment
surface, an ownership boundary and a second thing to certify, for no capability
gain.

## Recommendation — smallest path

**Wire the proven three-step REST sequence into `markComplete` for
`turnkey_only` pushes. Do not build a RESTlet. Do not migrate to Assemblies. Do
not wire `findOrCreateItemGroup` for pricing reasons** — it creates the group
record, which is a genuine prerequisite, but solves nothing about rates.

Two hazards already banked, both of which must be structural rather than
conventional:

1. **Full-sublist PATCH silently duplicates at 204** — 12 tx-lines, doubled
   rollup, no error. Single-line PATCH must be the only reachable shape.
2. **Partial failure mid-sequence yields a valid-looking wrong SO** — group
   expanded, some members priced, others left at `$0.00`. Recovery: read back
   `transactionLine` via SuiteQL and assert every expanded member carries its
   intended rate **before** persisting `status='succeeded'`.

Both map directly onto assertions this walk has already built and proven — B3
structural read-back plus the frozen grouping plan.

## What still needs deciding — not by me

1. **Does the group record get created by Nexus (`findOrCreateItemGroup`, with
   the subsidiary prerequisite fixed) or stay manual?** Independent of pricing.
2. **Does SO2701 stay flat**, with the grouped path proven on a fresh disposable
   SO? Recommended — it preserves the flat-CREATE certification artefact.
3. **Item price backfill** — routes (a) HubSpot `hs_price = 0` backfill,
   (b) NetSuite batch update (~937 unpriced items), (c) per-SO PATCH. Our two
   items are already priced; the estate is not.

## Evidence preserved

- **SO2701** — untouched, `$12,000`, 0 Group/EndGroup lines. Flat-CREATE
  certification artefact.
- **B3 pre-group read-back** — captured.
- **Group A `75153 / OD004-CASEB-A-G`** — unused sandbox validation Item Group.
  Not attached to any transaction, `externalid` null, subsidiary 2.
- **Manual-rate failure** — Edward, supported UI: expanded member Rate fields
  are not editable.

**Track B remains open.** REG-4 is not weakened and flat orders are not accepted
as the final V1 structure.
