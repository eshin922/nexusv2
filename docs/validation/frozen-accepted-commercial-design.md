# Frozen accepted commercial line set — bounded schema + lifecycle design

**Status:** design. Nothing implemented.
**Requested by:** Edward, 2026-08-18, ahead of F1/F4.
**Governing:** `accepted commercial total = unit-based totalRevenue +
separately billed OTC`. `totalRevenue` keeps its unit-economics meaning.

---

## 1 · Why this is its own slice

Nothing priced is frozen today. `quote_snapshots` holds commercial terms, PDF
axes and `pdf_url`; the Pattern 52 freeze lists hold lifecycle stamps. Every
figure NetSuite receives is **recomputed at push time** from a live
`getCostingBundle`, and reproduces the accepted quote only because draft-lock
prevents cost edits and the commercial pin holds the rate.

That is a convention, and REG-4's claim — *lines sum exactly to the accepted
commercial total* — is currently a claim about a recomputation rather than
about a record. Freezing benefits every REG-4 assertion, not only the OTC ones,
which is why it precedes F1/F4 rather than arriving inside them.

---

## 2 · The checkpoint: SEND freezes the matrix, ACCEPT selects the column

Not one checkpoint. Two, and they answer different questions.

**At SEND** the customer has not chosen a tier, so there is no single accepted
total — but there *is* a finalised customer-facing artifact showing **every**
tier. That is what must be frozen: the full line × tier matrix, exactly as
rendered, alongside the `pdf_url` already persisted at this checkpoint.

**At ACCEPT** the customer names a tier. `customer_accepted_tier_id` already
exists on the accept freeze-list. The accepted commercial total is then not a
new computation but a **selection** from the frozen matrix — the accepted
tier's `tier_commercial_total`, unchanged from the moment it was offered.

This falls out of existing lifecycle semantics rather than adding new ones:
`quote_snapshots` is already per-send and per-`version_number`, so a revision
that re-sends produces a new snapshot and a new matrix, and the superseded one
stays intact — which is exactly the behaviour a v2 revision needs.

It also satisfies the immutability requirement without new machinery: nothing
after send may alter what NetSuite receives, because NetSuite reads the frozen
matrix and the accepted tier, never the live bundle.

---

## 3 · Shape

Two tables, hung off the existing snapshot.

### `quote_snapshot_lines` — one row per (snapshot, line)

| column | purpose |
|---|---|
| `quote_snapshot_id` | the send-time snapshot this belongs to |
| `line_kind` | `item_group` · `item_group_member` · `direct_product` · `direct_service` · `otc` |
| `owning_item_group_id` | the Item Group this line belongs to; NULL for top-level |
| `quote_leaf_id` / `assembly_id` | Nexus identity as it was at send |
| `display_name`, `display_sku` | **as printed**, not re-resolved later |
| `service_identity` | governed Direct Service identity, where applicable |
| `netsuite_item_id` | destination identity **where already governed**; NULL otherwise |
| `position` | the order the customer saw |

Names and SKUs are stored rather than joined at read time. A library rename
after send must not change what a sent quote says it sold — the same reasoning
that made `prepared_by_name_snapshot` a snapshot column.

### `quote_snapshot_line_tiers` — one row per (line, tier)

| column | purpose |
|---|---|
| `quote_snapshot_line_id`, `tier_id`, `tier_label`, `quantity` | the cell |
| **`pricing_state`** | **`priced` · `quote_on_request`** — NOT NULL |
| `unit_rate`, `line_amount` | NULL exactly when `quote_on_request` |
| `allocation_state` | `allocated` · `separately_billed`, as it was at send |

### The unpriced requirement, met structurally

`pricing_state` is **NOT NULL and explicit**. A NULL rate alone would repeat
the OD-027 ambiguity — "no price" and "we failed to compute one" would look
identical, and a later reader could not tell which. A CHECK ties them:

```
(pricing_state = 'priced') = (unit_rate IS NOT NULL AND line_amount IS NOT NULL)
```

So an unpriced line is representable, and a priced line cannot be half-written.
Nothing synthesises a zero.

### Per-tier totals, stored not derived

On the snapshot, per tier: `unit_subtotal`, `otc_subtotal`,
**`tier_commercial_total`**, and **`total_is_provisional`**.

**Not `accepted_commercial_total`.** At SEND nothing has been accepted — the
matrix is what was OFFERED, across every tier. Naming a send-time column
"accepted" would state a fact that is not yet true of any of them, and would
still be untrue of three of the four after acceptance.

The accepted total is not a stored column at all. It is a **selection**:

```
accepted_commercial_total := tier_commercial_total
                             WHERE tier_id = quotes.customer_accepted_tier_id
```

SEND is "what we offered". ACCEPT is "which one the customer took". Keeping
those in different words is what stops a later reader treating an offered
figure as an agreed one.

`total_is_provisional` reproduces the PDF's **"from"** semantics. It is stored
rather than derived from "does any line have `quote_on_request`", because the
rule that decides when a total is provisional is presentation policy and may
change; the artifact must reproduce what the customer was actually shown, not
what today's rule would produce from the same lines.

The three totals are stored so the identity is **checkable** rather than
recomputed:

```
tier_commercial_total = unit_subtotal + otc_subtotal
unit_subtotal         = Σ priced line_amount where line_kind <> 'otc'
otc_subtotal          = Σ priced line_amount where line_kind  = 'otc'
```

and, once a tier is accepted,

```
accepted commercial total = the accepted tier's frozen tier_commercial_total
```

Asserted at write time and re-assertable at push time. REG-4 then compares
emitted SO lines against a **record**, not against a recomputation.

---

## 4 · What the freeze slice must also correct

Freezing today's projection would freeze two known-wrong things. Both were
settled and both land here.

**OTC is marked up.** Today `serviceFees[].amount` is the raw cost column. Per
decision 1 the frozen OTC amount is `fee × (1 + Production)`. This changes what
the customer is shown, which is why step 2 of the sequence re-proves
PDF = frozen total rather than assuming it.

**The accepted tier's fee, not MAX.** `aggByAssembly` currently folds tiers with
`maxNum`. The frozen matrix is per-tier by construction, so the MAX collapses
naturally — but the resolver must stop folding, or the PDF and the snapshot
will disagree at the moment they are first compared.

Note the related `OR` fold on `allocateServiceFeesToCost`: one allocated tier
row currently suppresses fee lines for the whole assembly. Per-tier
`allocation_state` removes that too.

---

## 5 · Open questions this design does not settle

1. **Do Item Group OTC lines get one row per destination, or one per fee
   column?** Four columns exist; BV-011 names sixteen destinations. Decision 6
   scoped implementation to destinations with real inputs, which suggests one
   row per populated fee column with its destination attached — but the mapping
   from column to destination is A1/B2/B3/B4, still open.
2. **Are Direct Product lines OTC-capable?** BV-012 says a Direct Product has
   packaging economics only. So `line_kind = 'otc'` should never carry a
   Direct Product owner — worth a CHECK, but only once decision 4's single
   accounting-line model is written down.
3. **Retention.** Snapshots are per-send and never pruned. Line × tier rows
   multiply that by roughly (lines × tiers). Not a v1 problem at this estate
   size; worth a number before it is one.

---

## 6 · Census — non-draft quotes affected by the allocation-OFF divergence

Requested. **Two quotes, both `sent`, neither accepted, neither pushed.**

| Quote | Status | Sent | Fees | NetSuite pushes |
|---|---|---|---|---|
| **DPS-1012** · smoke-matrix-charges-0727 | sent | 2026-07-28 | **$225.00** — setup $150, tooling $75, Tier 1 | **0** |
| **DPS-1044** · smoke-matrix-pure-cluster1-0727 | sent | 2026-08-11 | mixed allocation across tier rows | **0** |

Both sit on the same real HubSpot deal (`61113554855`, client `heymistr.com`)
and both have a persisted `pdf_url`, so a customer-facing artifact exists in
each case.

**The exposure is bounded by the fact that neither was accepted or pushed.** No
Sales Order was ever created, so the divergence never reached NetSuite; it
exists only as a PDF whose total included fees an SO would not have carried.

DPS-1044 is the second shape rather than a second instance of the first: its
tier rows disagree about allocation, which today's `OR` fold resolves by
suppressing the fee lines entirely. Worth listing because the frozen design
removes that fold, and re-rendering it after the change would produce a
different document from the one that was sent.

Both scenario labels read as smoke fixtures. They are on a real deal with a
real client domain, so **whether either PDF actually went to a customer is a
commercial determination, not one I can make from the data.** No retroactive
rewrite is proposed, per the disposition.

---

## 7 · Sequencing note

The freeze slice depends on **#298** landing first. Otherwise the frozen matrix
captures a Direct Service line reading `quote on request` for tiers that have
an entered cost — freezing the defect into the artifact that becomes the source
of truth, which is the specific trap the sequencing correction was made to
avoid.
