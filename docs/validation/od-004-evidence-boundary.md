# OD-004 · minimum evidence for the real-provider walk

**Nothing built. Administrator not booked.** Establishes the evidence boundary
under the 2026-08-11 disposition (grouping follows the quote's agreed
presentation; A2 integration boundary).

**Headline: no new workflow, no new status model, and no confirmation step.**
One small durable addition is required, and only for the `turnkey_only` case.

---

## 1 · What Nexus already records at push

Substantially more than I implied when I called this a gap.

**`netsuite_so_pushes`** — one row per attempt, with a partial unique index
permitting at most one `succeeded` row per quote:

| column | carries |
|---|---|
| `payload_snapshot` (jsonb) | **the full Sales Order payload, frozen at attempt time and never mutated** — every line's `netsuiteItemId`, `sku`, `description`, `quantity`, `rate`, `unitCost` |
| `amount_pushed` | `numeric(15,4)` — the amount as pushed |
| `netsuite_so_id` / `netsuite_so_tranid` | the SO's internal id and display id |
| `quote_snapshot_id` | FK RESTRICT to the accepted **sent snapshot** — which carries `detail_level_snapshot`, i.e. the applicability datum itself |
| `idempotency_key`, `status`, `error_class`, `error_detail` | attempt identity and outcome |
| `started_by_user_id`, `created_at`, `completed_at` | actor and timing |

**`audit_log`, action `quote_completed`** — `diff_json.netsuite` carries
`sales_order_internal_id`, `tranid`, `customer_netsuite_id`, `item_groups`.

**Invariant already guaranteed by construction:** Σ (line `rate` × `quantity`)
= the accepted tier's `totalRevenue`, because every line is a leaf's
`requiredSellPerUnit` × effective qty and the leaves partition the tier.

### The one thing it does not carry

`SalesOrderLine` is `{netsuiteItemId, sku, description, quantity, rate,
unitCost}`. **There is no assembly attribution.** The assembly is known at
line-build time (`treeLeaf.assembly`) and discarded before the payload is frozen.

So the grouping boundary — which the disposition makes load-bearing — is
**derivable at build time but not durable**. Reconstructing it later means
re-deriving the tree from the quote, which is exactly the "re-derive a commercial
figure downstream" that REG-4 forbids.

---

## 2 · What NetSuite can be read back after the manual grouping

`suiteQL()` accepts **arbitrary `SELECT`** against the account (guarded only to
reject non-SELECT), and `getRecord()` fetches by type and id. Both authenticate
with the same OAuth credentials the push uses. **No new client capability is
needed to read anything.**

Reading a Sales Order's lines back is therefore available today. Practically:
query `transactionLine` for the SO's internal id, joined to `item`, and read each
line's item, item type, quantity, rate and amount.

> **Stated as a dependency, not a fact.** NetSuite represents a transaction Item
> Group as a header line plus member lines, and the exact column exposing that
> structure through SuiteQL (`itemtype` on the line versus a join to `item`)
> varies by account configuration. **I have not verified it against this
> account** — 1 Sales Order has ever been pushed and 0 Item Groups exist in
> production, so there is nothing yet to read.
>
> This is the Class A shape CLAUDE.md records: an external-platform behaviour
> that is not discoverable from documentation and fails silently if assumed.
> **It is the first thing the walk should establish**, in its opening minutes,
> before anything depends on it.

---

## 3 · Can the read-back alone prove the required grouping occurred?

**Almost entirely — and this retires the "sixth gap" I previously raised.**

I framed that gap as *Nexus must record that the wrap happened*. That was the
wrong instrument. Nexus does not need to **record** it; it can **verify** it, on
demand, from the system of record. A confirmation workflow would create a second
account of the truth that could disagree with NetSuite — worse than none.

What the read-back proves, per case:

| claim | `itemized` | `turnkey_only` |
|---|---|---|
| the SO exists and is the one Nexus pushed | ✅ by internal id | ✅ |
| **invoiced total = accepted total** | ✅ Σ line amounts vs `amount_pushed` | ✅ |
| presentation is correct | ✅ **no group present** | ⚠️ group present — subject to §2 |
| the group's **members are the right ones** | n/a | ⚠️ requires §4 |
| the group was **not applied to the wrong assembly** | n/a | ⚠️ requires §4 |

The `itemized` case is **fully provable today**: the assertion is that no
grouping occurred and the total matches — both readable, neither needing anything
Nexus does not already have.

The `turnkey_only` case can prove *a* group exists carrying the right total, but
not that its membership matches what Nexus intended — because Nexus never
recorded what it intended. Absent that, an administrator who groups the wrong
leaves produces a correct total with wrong composition, and the read-back cannot
tell.

---

## 4 · Smallest additional durable evidence

**One addition. No new table, no new status, no new workflow.**

> **Persist the grouping plan inside the existing `payload_snapshot`.**

Concretely: carry assembly attribution on each line, plus a per-assembly plan
entry when the send-time `detail_level` is `turnkey_only`:

- per line — `assemblyId`, `assemblyName`;
- per assembly — `compositionHash`, its derived group `externalId`, member SKUs
  and rates, and the turnkey unit price.

Why this is the smallest thing that works:

- `payload_snapshot` is **already frozen at attempt time and never mutated**, so
  the plan inherits immutability for free — no Pattern 52 question to answer;
- it is **already one row per succeeded push**, so there is nothing to reconcile;
- the data is **already computed** at line-build time and merely discarded;
- `composition_hash` and `externalIdForHash` **already exist** and are
  deterministic and sort-agnostic;
- it changes **no status model and no workflow** — the administrator's job is
  unchanged; the plan simply becomes durable evidence of what was asked for.

It makes the `turnkey_only` read-back conclusive: compare NetSuite's group
membership against the frozen plan, per member.

**Explicitly not proposed:** a "wrap confirmed" flag, a new push status, an
Accounting write-back surface, or any new table. All were on my earlier list;
all are unnecessary once the read-back is the instrument.

---

## 5 · The exact walk, both cases

Shared preconditions: a real NetSuite environment named in the record; a quote
accepted and completed through the governed path; the NetSuite administrator
present.

### Case A — `detail_level = 'itemized'` (the common case: 8 of 9 snapshots)

1. Confirm the accepted quote's **send-time** `detail_level_snapshot` is
   `itemized`. *Applicability read from the snapshot, not the live column.*
2. Complete the quote. Record `netsuite_so_id`, `tranid`, `amount_pushed`.
3. **The administrator performs no grouping.** This is the assertion.
4. Read back the SO's lines via SuiteQL. Assert:
   - Σ line amounts **= `amount_pushed`** = accepted tier `totalRevenue`;
   - line count and per-line rates match `payload_snapshot`;
   - **no Item Group line is present** — the itemized presentation survived.
5. Read back the customer-facing document and confirm it shows itemized lines,
   matching what the customer was quoted.

**Engineering required: none.** Provable today.

### Case B — `detail_level = 'turnkey_only'` (2 live, 1 sent snapshot)

1. Confirm the send-time snapshot is `turnkey_only`.
2. Complete the quote. Record the SO ids and `amount_pushed`.
3. **Establish the read-back shape first** (§2) — the SuiteQL projection that
   reveals group structure in *this* account. Do it before step 4, so a null
   result is read as "wrong query" rather than "no group".
4. The administrator performs the wrap in the NetSuite UI, **executing the
   grouping plan** — one group per assembly, `externalId` from
   `composition_hash`, member rates as emitted.
5. Read back. Assert:
   - Σ line amounts **= `amount_pushed`** — the accepted total survived the wrap;
   - a group is present per planned assembly;
   - **its membership matches the frozen plan**, member for member;
   - the turnkey unit price displayed matches the plan;
   - no `$0.00` reached any commercial field *(standing constraint; also OD-005)*.
6. Read back the customer-facing document: one turnkey line per assembly, with
   freight/customs/setup not exposed.

**Engineering required: the §4 payload addition** — otherwise step 5's
membership assertion has nothing to compare against.

---

## Does engineering remain before booking?

**Yes — one change, and it is small.**

| | |
|---|---|
| **Case A (`itemized`)** | **No engineering.** Bookable today |
| **Case B (`turnkey_only`)** | **The §4 payload addition.** Assembly attribution plus the per-assembly plan, inside the existing frozen `payload_snapshot`. No new table, status, or workflow |

**Recommendation: land §4 first, then book once for both cases.** Case A is
bookable now, but the administrator's time is the scarce input, and booking twice
to save a contained payload change is the wrong trade. Landing §4 first also
means Case B's step 5 has a comparison target the first time it runs, rather than
producing a walk that proves the total and shrugs at the composition.

**One unknown that no amount of Nexus work removes:** the SuiteQL projection in
§2. It is the walk's first task, not a prerequisite to it — but if it turns out
group structure is *not* readable through SuiteQL in this account, Case B's
grouping assertions become unprovable by read-back, and the evidence question
reopens. Worth naming before the booking, so nobody discovers it with an
administrator in the room.

**Nothing is built and nobody is booked pending your call on §4.**
