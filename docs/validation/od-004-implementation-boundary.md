# OD-004 — Item Group implementation boundary

**2026-08-12 · traced from code, not from the runbook · no NetSuite action taken**

SO2701 is untouched. This exists because the runbook's step B4 reads as though
Nexus produces something Ops then executes against, and the actual code boundary
needed confirming before anyone creates a group by hand.

---

## The four states

### 1 · IMPLEMENTED BY NEXUS TODAY

| capability | where |
|---|---|
| Deterministic composition identity — `composition_hash` → `nxs-grp-<hash>` | `composition-hash.ts` |
| **Grouping plan** — per assembly: `externalId`, `members[]`, member rates, `expectedAmount`, `turnkeyUnitPrice` | `grouping-plan.ts`, called at `mark-complete.ts:620` |
| Plan frozen into the immutable payload snapshot, stripped before transmission | `attachGroupingPlan` / `stripGroupingPlan` (`mark-complete.ts:626, 742`) |
| Flat Sales Order CREATE whose line amounts sum to the accepted total | proven live — SO2701, $12,000 |

**That is the whole of it.** Everything Nexus does today ends at *emitting a plan
and a correctly-totalled flat order*.

### 2 · BUILT AS A PRIMITIVE, BUT NOT WIRED — "technically possible, not implemented"

`item-groups.ts` `findOrCreateItemGroup` is real, working code that **creates a
NetSuite Item Group *item record*** via `createRecord({ recordType: "itemGroup" })`
with a `member.items[]` collection, and reuses an existing one through three
layers:

1. local cache `netsuite_item_groups` by `composition_hash`;
2. SuiteQL by `externalId` (self-healing after a partial write);
3. REST POST create.

**It is NOT invoked anywhere in `markComplete`.** The import exists at
`mark-complete.ts:27`; there is no call site. `itemGroupOutcomes` is a hardcoded
`[]` beside the comment `/* const itemGroupOutcomes … */ // ← intentionally not
built`. Its only live exercise is `scripts/smoke/netsuite-item-groups.ts`, which
creates and then deletes real sandbox groups to keep the primitive from rotting.

**It also does not consume the grouping plan.** It takes its own
`FindOrCreateInput`; nothing adapts plan → input. Two deterministic identity
systems exist that were designed to meet and currently do not.

**So Nexus could create the Item Group *records* for SO2701 today.** REST
permits it — the smoke proves it end-to-end. What Nexus cannot do is put them on
the Sales Order.

### 3 · PROVIDER / API PROHIBITED

**Exactly one operation is proven unavailable: inserting an Item Group line
during Sales Order CREATE.**

> *"The SO validator refuses Item Group lines at CREATE via **both** REST and
> SOAP — identical `USER_ERROR "Please enter a value for Amount"`"*
> — `od-004-decision-set.md` §A1, exhaustive probe + CA disposition 2026-07-28

The NetSuite **UI** succeeds because SuiteScript `N/record` has different
interactive-save semantics. Assemblies were proven to work at REST (Probe 4).

**NOT prohibited, and frequently conflated with the above:**

- creating the Item Group **item record** — works at REST (§2);
- reusing one by external id — works (§2).

**UNTESTED — neither proven possible nor prohibited:**

> **Updating an existing Sales Order post-CREATE to replace flat lines with an
> Item Group line.**

No probe covers it in any OD-004 document, and no such code path exists — the
NetSuite client exposes only `suiteQL`, `getRecord` and `createRecord`; there is
**no Sales Order update primitive at all**. The one `PATCH` in the codebase is
HubSpot amount drift.

This gap matters. The prohibition evidence is specifically *at CREATE*. If a
post-CREATE update were permitted, the V1 manual step could shrink substantially.
It is recorded as an open question, **not** claimed either way.

### 4 · EXPLICITLY MANUAL V1 RESPONSIBILITY

Wrapping the pushed flat lines into Item Groups in the NetSuite UI, executing the
frozen plan. This is the **designed** V1 boundary under decision **A2 — "Nexus
emits, Accounting wraps"** — not a workaround for a missing feature.

---

## REG-4 as reworded — what V1 actually owes

> **REG-4 (revised).** Applicable completion pushes Sales Order lines whose
> amounts **sum exactly to the accepted commercial total**, and emits a
> **deterministic grouping plan** — group `externalId` derived from
> `composition_hash`, its member lines, member rates, and the turnkey unit price
> — sufficient for NetSuite Ops to perform the grouping without re-deriving any
> commercial figure. The walk records the plan emitted, the grouping performed,
> and a read-back proving the invoiced total equals the accepted total.
>
> **Item Group creation by Nexus is out of V1 scope** — an external-platform
> capability limitation, carried as v1.1+ via RESTlet or Assembly migration.

Against SO2701:

| REG-4 clause | status |
|---|---|
| lines sum exactly to accepted total | **met** — 6,000 + 4,000 + 2,000 = $12,000 |
| deterministic plan emitted | **met** — both groups, `externalId`, members, rates, `expectedAmount`, `turnkeyUnitPrice`, frozen in the payload snapshot |
| sufficient to group without re-deriving a figure | **met** — every number Ops needs is in the plan |
| plan recorded | **met** |
| grouping performed | outstanding — the manual step |
| read-back: invoiced total = accepted total | outstanding — follows grouping |

**REG-4 does not require Nexus to create or reuse a group.** That requirement was
removed precisely because it demanded evidence Nexus cannot produce. The manual
wrap is the contract, not a shortfall against it.

---

## Consequence for the manual step

Nothing in the boundary blocks it, but one thing is worth settling first.

The runbook says *"group identity = `externalId` (`nxs-grp-<compositionHash>`)"*.
Since Nexus is not creating the group record, **whoever creates it by hand
determines its external id.** For the read-back to prove membership against the
frozen plan by identity rather than by inspection, the manual step has to set
`externalId` to the planned `nxs-grp-…` value.

If setting external id is impractical in the UI, that is fine — the read-back can
still assert membership structurally via `Group → members → EndGroup` (B3, proven
against control SO2454). **But then the `nxs-grp-*` identity plays no part in this
walk**, and REG-4's "deterministic plan" is being satisfied by its member/rate
content rather than by its identity. Worth deciding deliberately rather than
discovering afterwards.

Also worth naming: if Ops creates the group by hand, Nexus's
`netsuite_item_groups` cache will not know about it. A later `findOrCreateItemGroup`
for the same composition would miss the local cache, then **hit layer 2 (SuiteQL
by externalId)** and self-heal — but only if the external id matches. With a
different external id it would create a duplicate group.

---

## Summary

| question | answer |
|---|---|
| 1 · Nexus creates the Item Group record from the plan? | **No.** The capability exists and works, but is unwired and does not consume the plan. |
| 2 · Deterministic lookup/reuse by `nxs-grp-*`? | **Implemented as a primitive** (3-layer), **not invoked** in `markComplete`. |
| 3 · Post-CREATE SO update wrapping flat lines? | **No** — and no SO update primitive exists in the client at all. |
| 4 · What is proven unavailable? | **Only** Item Group lines *at Sales Order CREATE* (REST **and** SOAP). Creating the item record is permitted. Post-CREATE SO update is **untested**. |
| 5 · What does find-or-create operate on; is it called? | The **Item Group catalog item record** plus Nexus's `netsuite_item_groups` cache — never a Sales Order. **Not called** in `markComplete`; only by the sandbox smoke. |
| 6 · What does REG-4 require in V1? | Correct-summing flat lines **+** a deterministic plan **+** recorded manual grouping **+** a read-back proving total preservation. **Not** group creation by Nexus. |
