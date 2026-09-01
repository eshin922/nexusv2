# Run 1 adjudication — the three correctness items

**2026-08-26.** Evidence and recommendation. **No implementation.**
Instrument: `scripts/gate-1b/run01-adjudication-evidence.ts` (read-only).

Two of the three change shape once traced. Item 1 was already decided a week
ago, and Run 1 rediscovered the decision rather than a defect. Item 2 inverts
completely: the operation IS supported, it DOES preserve costs, and I reached
it by the one route that destroys them.

---

## 1 · W9 — sibling-scenario Sales Order identity

### The question was already answered, on 2026-08-19

`docs/validation/cert-303-push-blocker-duplicate-deal.md`, under
**RESOLVED — the V1 operational rule, now explicit**, per your disposition:

> **One HubSpot deal may produce at most one Nexus-created NetSuite Sales
> Order.** A deal may contain multiple quote scenarios. Once one scenario
> completes to NetSuite, a sibling scenario must not create or adopt another
> Sales Order on that same deal.

**The two halves of the Run 1 framing are not the same question.** Multiple
*scenarios* per deal is supported and ordinary. Multiple *Sales Orders* per
deal is governed as not permitted. Run 1 conflated them, and the finding as
written inherits that conflation. Under the standing rule, W9's refusal is the
rule enforcing itself — **not a blocked ordinary workflow**.

### The guards, and who owns them

Neither is Nexus-side alone, which is why weakening one would not help:

| Layer | Owner | Behaviour |
|---|---|---|
| `_dps_ue_prevent_dupplicated_so.js` | **NetSuite account** | refuses any second SO for a `custbody_dps_deal_id` that already has one. Status is not a filter — a Closed SO still blocks |
| `decideReconciliation` ownership veto | Nexus | refuses to ADOPT that order when it belongs to a sibling quote |

The provider refuses first; Nexus never gets the chance to create. Removing the
Nexus veto would unblock nothing — it would only restore the SO2707 incident,
where adoption ran rate convergence over a completed order and rewrote
`1.25 → 0.5365` and `2.25 → 1.8705`.

### Population evidence

```
deals carrying a pushed Sales Order      14
  ... carrying more than one              0     <- the rule holds estate-wide
accepted quotes standing on an
already-consumed deal                     3
```

All three are our own fixtures — `CERT-MIXED…` (DPS-1051),
`ZZ-VALIDATION-tier-propagation` (DPS-1061), `CERT-303` (DPS-1055). **No real
customer quote has ever been in this state.** But three certification walks
reached it independently, which is the signal worth keeping: anyone who builds
a second scenario on a working deal lands here, and learns about it at Send.

### The real defect, and it is not the guard

**The operator discovers a known, pre-computable refusal by pressing the one
button labelled irreversible** — after Preview, Finalize, PDF and Acceptance
have all told them the quote was progressing normally.

This is the third member of a family we have already repaired twice.
`identity-readiness.ts` exists because `product_sku_missing` and
`product_item_unresolved` were both discovered exactly this way during #428
Part B; its own header says so. `deal_already_ordered` belongs beside them.

### Recommendation — do this now, under the standing rule

**Add `deal_already_ordered` as a readiness blocker. Change no guard.**

- The Nexus half is a pure DB read: another quote on this deal already holds
  `netsuite_so_id`. Catches all three live cases with no network call.
- The provider half is one SuiteQL by deal id — `findSalesOrdersByDealId`
  already exists — which also catches an order Nexus did not create (the
  HubSpot `Auto create NetSuite sales order from won deal` workflow makes
  those).
- Advisory, exactly like `identity-readiness`: `unknown` never blocks, so a
  NetSuite outage degrades to silence rather than to a false refusal.
- Copy names the sibling quote and its order, and states the governed remedy —
  a second order belongs on a second deal — instead of
  `manual reconciliation required`, which names no action an operator can take.

Surfaced at the Sales Order step at minimum. **Better at Acceptance**, since
that is the last point before an operator has told a customer yes.

### If you re-open the rule instead

You asked for the smallest design that lets independent scenarios create
independent Sales Orders. It exists and is already scoped, as the acknowledged
residual in `docs/validation/so2707-adoption-incident.md`:

> The durable closure is a **provider-side deterministic identity** written at
> CREATE and read back at reconciliation … `computeIdempotencyKey(quoteId,
> quoteSnapshotId)` already exists and is already deterministic per accepted
> snapshot; what is missing is a provider field to carry it.

Four steps, and the first two are **not Nexus's to make**:

1. **NetSuite admin** — create the custom body field
   (`custbody_nxs_idempotency_key`).
2. **NetSuite admin** — amend `_dps_ue_prevent_dupplicated_so.js` to refuse on
   a repeated *attempt key*, not on a repeated *deal*. This is the whole
   unblock; everything else follows it.
3. **Nexus** — write the key on CREATE. One body field.
4. **Nexus** — match candidates on the key rather than correlating on deal id.
   Reconciliation stops asking "does an order exist for this deal" and starts
   asking "does mine exist", which is what it has always needed.

Step 4 also closes the residual the ownership veto only vetoes: today an
*unowned* candidate matched by deal id is still correlation, not identity.

**This is an accounting-model change, not a Nexus repair.** One deal → many
Sales Orders changes what a deal means downstream for reporting and
reconciliation. That is Accounting's call.

**My recommendation: keep the rule, ship the readiness blocker.** It is correct
under either outcome, it is small, and it is the half that stops the operator
being surprised.

---

## 2 · Regrouping cost loss — the finding inverts

### Regrouping is supported, and the supported path preserves costs

`moveProductMembership` (`src/app/actions/assemblies.ts:700`) moves an
attachment between Item Groups, and between a group and quote level. It
delegates to `moveStructuralMembership`, whose header states the hazard in
advance:

> the ONLY safe way to do this: composing it from detach + attach would mint a
> new `quote_leaves.id` (orphaning the rollup) and cascade the product's cost
> inputs away through the dual-keyed `assembly_leaf_id`. **Both failures leave
> the tree looking correct.**

It preserves `quote_leaves.id` and repoints every dependent economic row —
`assembly_leaf_inputs` included — returning `dependentsRepointed` as evidence.

**It works, and it is the ordinary operation:**

```
product_membership_moved   46      <- the governed move
quote_product_attach       25
quote_product_detach        8
```

**So Run 1 observation 5 is not silent loss on a supported operation.** I
performed the destructive composition the code names — detach, then re-add —
because I never found the move. That part is my instrument failure and belongs
with the other seven.

### What IS a real defect, and it is two things

**(a) The destructive route is available, and its confirmation does not say
what it destroys.**

`Remove` → `Confirm — remove from quote` on a Direct Product. On a group member
the menu is worse, because it actively reassures:

```
Remove from item group          library leaf stays
```

`library leaf stays` is true about the library and silent about the quote. The
one caption in the interaction is the one that makes a destructive act read as
safe. Nothing anywhere names the cascade.

**Exposure, measured on live drafts:**

```
draft attachments carrying cost a Remove would cascade away   113
across quotes                                                  19
of which Direct Products                                        3
```

**(b) The safe move is reachable only by dragging.**
`moveProductMembership` has exactly one caller — `commitDrop`. No keyboard
route, no menu route, no accessible equivalent. And the leaf context menu
**used to** offer `Move to another item group`; it was removed in B-4B on the
grounds that it *"had no writer anywhere in the action layer"*. That was true
when written and is false now — the writer exists and has run 46 times. The
removal rationale outlived its facts, and its effect today is to funnel a
menu-first operator into Remove.

The two compound: the only discoverable route is the destructive one, and it
does not say what it destroys. That is the **misleading actionability** class.

### Recommendation

1. **Name the cascade in the confirmation.** Count the dependent rows and say
   so — *"Removes 6 packaging lines, 2 overrides and this product's freight
   membership. This cannot be undone."* Replace `library leaf stays`: it
   answers a question nobody asked while the load-bearing one goes unsaid.
2. **Restore `Move to another item group`, wired to the existing writer.** Not
   a new capability — a second door onto the certified one. It also removes the
   drag-only dependency, which is an accessibility gap independent of this
   finding.

(1) is the correctness repair. (2) is what stops the operator needing it.

---

## 3 · Copy recovery semantics — elections should carry

### The copy contract is explicit and already decides this

`cloneQuoteGraph` (`src/app/actions/quotes.ts:3419`):

> **THE CONTRACT: a copy is an editable ALTERNATIVE whose initial working
> commercial state is EQUIVALENT to the source.** Immediately after the copy
> and before any operator edit, cost / sell / revenue / margin must match at
> every tier. **Anything that does not carry must be justified as workflow or
> history, never as an oversight.**

`quote_charge_recovery` is keyed on `quote_id`, and the clone does not touch
it. It is not in the Cloneable list, not in Reset, not in Inherited — it is in
none of the three, which is what an oversight looks like rather than a
decision.

### The dates settle intent

| | |
|---|---|
| FR-12 copy operations | earlier slice; the contract was written then |
| `0100_quote_charge_recovery.sql` | later — `f49fdcf` |

The clone could not have decided about a table that did not exist. Nothing was
weighed and reset; the table arrived after the list was written.

### Elections are economics, not lifecycle

Three independent reasons, and the third removes all doubt:

1. **Placement changes the customer document.** Run 1 W6: electing
   `project_setup` to a separate line moved **$1,680** out of the unit price
   onto its own line. Same turnkey total, different document, different unit
   price — `14,755 + 1,680` against `16,435` all-in.
2. **Placement is frozen as an instruction Accounting acts on.**
   `quote_snapshot_recovery_instructions` exists precisely because placement is
   what Accounting bills from. Lifecycle state does not get frozen into a
   billing instruction.
3. **Placement can change the margin verdict.** #439: a quote carrying
   unbillable recovery reports `marginVerdict = UNRESOLVED`. An election can
   therefore move a governance verdict, and nothing that moves a governance
   verdict is lifecycle state.

Revise is the control. It operates in place on the same `quote_id`, so
elections carry there today and always have. Only copy — which mints a new id —
loses them. The inconsistency tracks the id change, not any decision.

### Population

```
election rows in the estate                    11
quotes carrying any election                    3
copies made from an elected source              1   (Run 1 W11)
  source elections -> copy elections          1 -> 0
```

Tiny exposure, one clean observation. `4781e4bb` shows `4 -> 6` and proves
nothing — those elections were made on the copy afterwards, not carried.

### Recommendation

**Clone `quote_charge_recovery` in `cloneQuoteGraph`, and add it to the
Cloneable list in the contract comment so the next reader sees it weighed.**

Carry `charge_key` and `mode`. **Re-stamp provenance** — `elected_at = now`,
`elected_by_user_id = the copying user` — because the alternative records that
someone elected on a quote that did not exist at the time, which is false. The
election carries; the claim about who made it on this quote does not.

---

## What is NOT in scope here

Queued separately, unchanged: the Send-order modal width, and the three
presentation/provenance observations (`synced 4mo ago`, the two empty-cost
registers, `Sync status pending · Slice 11`).

**Run 1 observation 6 resolves to documentation drift, not a defect.** The copy
carried tier qty; the CLAUDE.md FR-12 note says qty resets. The contract comment
in the code says `quote_tiers INCLUDING qty` is cloneable, and the code does
that. The CLAUDE.md note is stale and should be corrected when item 3 lands.
