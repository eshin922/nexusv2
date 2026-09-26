# F1 / F4 — separately billed OTC as Sales Order lines: trace before design

**Status:** trace. Nothing implemented, nothing decided.
**Requested by:** Edward, 2026-08-18, on settling F2.
**Governing:** allocation OFF means **separately billed, not unbilled**; and in
both allocation states

```
accepted commercial total = unit-based totalRevenue + separately billed OTC
```

`totalRevenue` keeps its unit-economics meaning and is **not** widened.

---

## 1 · What exists today

### The Sales Order

`mark-complete` builds one line per **leaf** (`skuRollups` filtered to
`skuRole === "leaf"`), each `quantity = tier.qty × qtyPerParent`,
`rate = requiredSellPerUnit`. The comment states the invariant it relies on:

> *Sum of all leaf-line amounts = tier's totalRevenue by construction.*

The pushed amount is `Number(tierRollup.totalRevenue.toFixed(2))`. There is no
service-fee handling anywhere in the file, which is the mechanism behind the
F2 divergence.

### The customer PDF

`customer-view-resolver` emits `serviceFees` **only when allocation is OFF**,
and `PdfPage` folds them into the grand total. So the shortfall is exactly the
allocation-OFF fee set — which is now a defect rather than a divergence.

### The grouping boundary (OD-004, certified)

| Product Structure | boundary |
|---|---|
| ASY-backed | the assembly; identity is `composition_hash` |
| Direct / no ASY | **no implicit boundary** — each Direct leaf is an independent flat line; Nexus must not synthesize an ASY to create one |
| Mixed | outside the V1 projection proof |

Grouping applies when `detail_level = turnkey_only`; `itemized` preserves the
itemized presentation. Nexus **does not create** the Item Group (integration
boundary A2) — it emits a deterministic plan.

---

## 2 · Five findings the design has to absorb

### F-a · There is no frozen accepted commercial total. Not anywhere.

`quote_snapshots` captures T&Cs, payment terms, lead time, incoterms,
prepared-by, the three PDF axes and `pdf_url`. **No prices, no line set, no
amounts.** The Pattern 52 freeze lists are the same: commercial terms and
lifecycle stamps only.

So `currentAmount` is **recomputed at push time** from a live
`getCostingBundle`. It reproduces the accepted figure only because draft-lock
prevents cost edits after send and the commercial pin holds the rate — a
convention, exactly as Pattern 52 records.

The F2 settlement asks for lines that sum to *the frozen accepted commercial
total*. **That object does not exist**, and no amount of care in the OTC design
substitutes for it. This is the largest single piece of work implied.

### F-b · Separately billed OTC is currently billed at COST

`serviceFees[].amount` is `agg[spec.field]` — the raw `setupFeeTotal`,
`toolingArtworkTotal`, `rdTotal`, `otherServiceTotal` column. **No markup is
applied.**

Under allocation ON the identical fee is amortised into unit cost *and marked
up at the Production rate*. So today the allocation switch silently changes the
firm's margin on the same fee: marked up when allocated, at cost when billed
separately.

BV-013 settled that *all Production economics use the Production authority*.
Read strictly, separately billed OTC should be marked up too — but that changes
what customers are charged, so it is a decision, not an inference. **This is
the largest open business question below.**

### F-c · The fee shown is the MAX across tiers, not the accepted tier's

`aggByAssembly` folds every tier's production row with `maxNum`. On a quote
whose setup fee differs by tier, the PDF shows the highest, and the accepted
tier's actual figure may be lower.

Harmless while fees are tier-invariant in practice; **not harmless once the
same number becomes an SO line reconciling to an accepted total**, because the
line would be attributed to a tier that did not produce it. Pattern 56 shape.

`allocateServiceFeesToCost` aggregates with **OR** across the same rows, so one
allocated tier row suppresses the fee lines for the whole assembly.

### F-d · `composition_hash` says the opposite of BV-012

The hash's own header comment reads:

> *members … Every leaf on the assembly participates — physical, **OTC**, and
> freight lines alike.*

BV-012 Amendment 1 §5 says OTC/service lines do **not** participate. The
comment predates the amendment and describes intent that has since been
reversed. Nothing is wrong at runtime — no OTC line exists to be included — but
the implementer will read that comment, and it currently authorises the exact
thing F4 forbids.

### F-e · A Direct Service is already a leaf, and leaves are already lines

`skuRollups` includes every leaf; a Direct Service is a top-level
`quote_leaf`. So a service would *already* flow into the leaf-line loop if the
deliberate block in `mark-complete` were removed — as a flat
Direct-Product-shaped line at `requiredSellPerUnit × qty`.

That is the accident #293 blocked. It also means the accounting-line model for
Direct Services is **not** a new mechanism: it is deciding whether a service
line is the same object as an OTC line, and giving both the same treatment.

---

## 3 · The design space, stated as consequences rather than options

Recording what each unresolved choice forces, so the decisions below are legible.

**If OTC lines carry markup (F-b = yes):** the OTC line rate is
`fee × (1 + Production)`, allocation ON and OFF become margin-neutral, and the
allocation switch becomes purely a presentation/billing choice. The customer
pays more than today for allocation-OFF quotes.

**If OTC lines are billed at cost (F-b = no):** allocation ON and OFF are
*not* margin-neutral, and the switch silently moves margin. That has to be
stated somewhere an operator reads, or it is a trap.

**If OTC attributes to the Item Group (F4 = inside):** the line sits under the
group but must be excluded from `members` when computing `composition_hash`,
per BV-012. The group's identity then describes only its physical composition —
which is coherent, and is what makes the same group reusable across quotes
whose OTC differs.

**If OTC attributes to the quote (F4 = outside):** flat lines beside the group,
no hash question at all, and no need to touch the grouping plan. Simpler, and
loses the association between a fee and the finished good it belongs to.

---

## 4 · Remaining business decisions before F1/F4 implementation

| # | Decision | Why it blocks |
|---|---|---|
| **1** | **Is separately billed OTC marked up at the Production rate, or billed at cost?** (F-b) | Sets the SO line rate and whether the allocation switch is margin-neutral. Everything else is plumbing; this is money. |
| **2** | **Which tier's fee is billed?** (F-c) | The accepted tier's, presumably — but today's MAX-across-tiers is what the customer was *shown*, so on an already-sent quote the two can differ. Needs a rule for existing sent quotes as well as new ones. |
| **3** | **Inside or outside the Item Group?** (F4) | Determines whether the grouping plan gains OTC members and whether `composition_hash` needs an explicit exclusion. |
| **4** | **Is a Direct Service line the same accounting object as an Item Group OTC line?** | If yes, one projection model and one mapping mechanism. If no, two — and the Settings mapping built in #293 covers only the service half. |
| **5** | **What is frozen, and at which checkpoint?** (F-a) | Send or accept; the line SET, the AMOUNTS, or both. A frozen total alone cannot prove REG-4 line-by-line; a frozen line set can. |
| **6** | **Do the eleven non-service BV-011 destinations get NetSuite items and mappings now, or only those with inputs today?** (F3/B1) | Four OTC inputs exist; BV-011 names sixteen destinations. A line cannot project without a mapped item. |

### Not blocking, but should be decided in the same conversation

- **Existing sent quotes.** If OTC becomes an SO line, quotes already sent with
  allocation OFF were shown a total their SO will not carry unless the fix is
  retroactive. Pattern 52's `pdf_url` records what the customer saw; whether to
  reconcile historical pushes is a commercial call, not a technical one.
- **The `composition_hash` comment** (F-d) must be corrected in whichever slice
  touches it, regardless of which way F4 goes.

---

## 5 · What I would do first

**Decisions 1 and 5, together.** They are the only two that cannot be deferred
by scoping: the rate decides what the line says, and the freeze decides whether
REG-4 can be proved at all rather than asserted from a recomputation.

Decision 5 in particular is worth separating from OTC entirely — *nothing* is
frozen today, so a frozen accepted line set benefits every REG-4 claim, not
only the OTC ones. It may deserve its own slice ahead of F1/F4 rather than
arriving inside them.
