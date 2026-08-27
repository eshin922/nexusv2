# Three dispositions after soak run 5

Written after `#459` merged and Production came up clean on `8baf7bc`. No soak
has been started. Nothing here is implemented.

---

# 1 · Closing the beta gate without wasting lineages

**The criterion stands as written: two consecutive clean full runs on the same
release.** Nothing below narrows it. What follows is about *when* to spend the
attempt, because the expensive part is not the criterion — it is that every
product change resets the counter.

## What run 5 actually cost, and why

```
run 4    frozen 2f02912   CLEAN       deal 64200019819 → SO2726
run 5    frozen 2f02912   NOT CLEAN   deal 64362942065 → SO2727
```

Two lineages spent, and the pair does not count — not only because run 5 found
something, but because **the repair that followed created a new release**. Even
had run 5 been clean, repairing anything afterwards would have retired the
evidence. The pair has to sit on a release nothing changes after it.

That is the real lesson of the last three runs, and it is a scheduling lesson,
not a correctness one.

## What survives the repair, and what does not

`#459` touched six client components, one hook, one new pure module, and tests.
It changed **no math, no action, no schema, no projection**. So the two bodies
of evidence separate cleanly:

**Survives — the economic evidence.** Recovery placement invariance, Price Build
reconciliation, freeze precision, copy fidelity, and the NetSuite line shape were
measured identically in runs 3, 4 and 5, on two releases, against three Sales
Orders. `test:unit` is 2502/2502 with every economic assertion untouched. A
repair to failure-path rendering cannot move a number, and none moved.

**Does not survive — the operator-path evidence** for the six repaired surfaces.
Their code changed. W6 (recovery election), W7 (Finalize) and the notes surfaces
must be walked again on the post-repair release, whatever else is decided.

## Which steps genuinely need another irreversible W9

**Only W9 consumes a lineage.** W1–W8, W10 and W11 can be walked any number of
times on fresh scenarios inside an existing project at zero governed cost. The
scarce resource is one specific act: the NetSuite Sales Order push.

W9 is also the **most**-evidenced step in the entire soak:

```
run 3   SO2725   line-for-line consistent with the frozen quote
run 4   SO2726   byte-identical in shape
run 5   SO2727   byte-identical in shape, cost rates carried
```

Three consecutive clean irreversible sends across two releases, each read back
from the provider rather than asserted. Nothing in `#459` is reachable from that
path — `tab-sales-order.tsx` was not modified.

**So the honest position is uncomfortable in both directions.** W9 has the
strongest evidence and the highest cost to re-exercise; and it is precisely the
step where "we already know it works" is the argument that should be trusted
least, because it is irreversible and because run 5 proved a governed act can
fail invisibly. I am not going to recommend dropping it from the pair — that
would be weakening the criterion by another name.

## Recommendation

**Provision the lineages rather than economising on the runs.** The constraint
is not real scarcity. `scripts/gate-1b/cert-lineage-build.ts --name=` already
builds a governed lineage from a new HubSpot deal on the already-mapped
ZZ-VALIDATION company, reusing NetSuite customer `388800`, fabricating no
accounting identity. Two more lineages is a provisioning step, not a compromise.

**But do not start the pair until the change queue is empty.** Currently open:

| queued | resets the counter? |
|---|---|
| 59 unenforced governed-action sites (§3) | **yes** — client code |
| Send-order modal width | yes |
| Presentation/provenance observations (`synced 4mo ago`, two empty-cost registers, `Sync status pending · Slice 11`) | yes |
| Production-attribution redistribution | yes, if dispositioned |

Attempting the pair with four items queued is how runs 4 and 5 were spent. My
recommendation is: **close the queue, freeze once, then run the pair** — and
accept that this means deciding §3 before the gate rather than after.

**One thing worth Edward's explicit decision:** whether a run whose only finding
is *outside* the walk's economic assertions — a presentation defect, say — should
reset the counter. Run 5's finding was operator-facing and I judged it did. A
narrower rule ("clean = no correctness finding in the governed economic path")
would be defensible and would have counted runs 4 and 5 as a pair. **I am not
proposing it**, because it is a change to the gate and the gate is yours. I am
noting that the current rule is strict, that strictness is what caught this, and
that the cost of it is two lineages per attempt.

---

# 2 · Packaging-origin one-time charges — the ownership trace

**Finding: no unambiguous supported path exists.** A packaging-origin plate,
die or tooling fee has no owner it can belong to, no column it can occupy, and
no charge key that names it. Every workaround misattributes it.

Traced from the schema and the registry, not from which UI accepts a number.

## What owns a one-time charge today

Every governed one-time charge sources from **one table**:

```
tooling          assembly_production_inputs.tooling_total
project_setup    assembly_production_inputs.setup_fee_total
artwork_plate    assembly_production_inputs.artwork_total
rd_formulation   assembly_production_inputs.rd_total
testing_micros   assembly_production_inputs.testing_micros_total
other_service    assembly_production_inputs.other_service_total
tooling_artwork  assembly_production_inputs.tooling_artwork_total   (legacy combined)
```

`src/lib/commercial-recovery/registry.ts`. The registry is explicit that this
boundary is deliberate: *"Filling/blending, CM assembly, bulk raw and all
packaging are the unit price. They are absent from this registry deliberately:
that boundary is what stops recovery spreading to every numeric field."*

`assembly_production_inputs` has an **XOR owner** (`assembly_production_inputs_owner_xor`,
migration 0082): `assembly_id` **or** `quote_leaf_id`, never both. And
`owner_commercial_kind` is a *generated* column —

```sql
CASE WHEN "quote_leaf_id" IS NULL THEN NULL ELSE 'service' END
```

— so a leaf-owned production row is **necessarily a Direct Service**. A Direct
Product cannot own one, and that is enforced in the database rather than by
convention.

**So a one-time charge can belong to exactly two things: an Item Group, or a
Direct Service.** Not a packaging component. Not a Direct Product.

## Can packaging inputs represent a fixed cost?

**No.** `assembly_leaf_inputs` carries `unit_cost numeric(10,4)`,
`qty_per_sellable_unit` and `purchase_qty`. There is no fixed-amount column and
no grain flag. A plate fee entered there is multiplied by quantity and becomes
**per-unit COGS inside the unit price** — recoverable by nobody, electable by
nobody, and invisible as a charge on the customer document. It would not be a
one-time charge that happens to be placed in the unit price; it would not be a
charge at all.

## Do Production fields require a turnkey context?

**Yes, and it is enforced in the UI as well as the schema.**
`production-drilldown.tsx:436`:

> *"Member leaves and Direct Products own no Production economics, so they get
> no Production surface."*

One Production authoring surface per **Item Group**. So the worked example —
a packaging-only quote containing a printed carton as a Direct Product — has
**no Production surface at all**, and therefore no path to a one-time charge of
any kind.

## Is Direct Service an honest service, or a container?

**Designed as an honest service; positioned to become the container.** The
vocabulary is closed and every member is a real sold service:

```
formulation · filling_blending · packout_assembly · testing_micros · other_service
```

The schema comment states the intent directly: BV-011's other destinations
*"are deliberately not sellable on their own, and promoting one should require a
migration that says so rather than a new string at a call site."*

The pressure comes from the fee side. `other_service` is the only open-ended
charge key, its NetSuite item is chosen **per line** (migration 0081 forbids it
a firm-level record precisely because it is the catch-all), and it is the only
place a plate fee can currently be typed. So an operator who needs a plate fee
is pushed toward asserting a *service is being sold* in order to record a
*component cost* — and the resulting NetSuite line will post to
`OTC - Other Service` unless the per-line selection is used to redirect it.

That is not Direct Service being misused by operators. It is the model leaving
one door open and no other.

## Does the vocabulary carry an owner independent of recovery placement?

**Live: no. Frozen: yes.** They disagree, and the disagreement is the model gap.

```
quote_charge_recovery                    PK (quote_id, charge_key)     ← no owner
quote_snapshot_recovery_instructions     UNIQUE (snapshot, charge_key,
                                                 owner_ref, tier_id)   ← owner present
```

The frozen instruction carries `owner_ref` — *"assembly or quote-leaf id as
text"* — and its comment explains why: *"a quote can hold one charge at several
owners with different treatments. One row per charge would have to pick, and
picking would write a false instruction."*

The **live election has exactly that defect**, by construction. It is keyed on
`(quote, charge_key)`, so electing a placement for Tooling elects it for every
Tooling charge in the quote regardless of which Item Group authored it. The
freeze layer already knows charges have owners; the election layer does not.

**Against the principle** — *the charge should belong to the commercial object
that caused it; recovery placement is a separate decision* — the model is
inverted in both halves. Ownership is fixed at Production rather than following
causation, and placement is quote-wide rather than per-owner.

## What BV-011 already says, and nobody built

The accounting map has **sixteen** destinations. Three are packaging-origin:

```
otc_dies           OTC - Dies           non_inventory   §1.b
otc_print_plates   OTC - Print Plates   non_inventory   §1.b
otc_cartons        OTC - Cartons        non_inventory   §1.b
```

`OTC_COLUMN_DESTINATION` maps **five** columns. Dies, print plates, cartons,
samples and processing fee have **no source column at all** — they exist in the
accounting vocabulary and are unreachable from the quoting model except through
`other_service`'s per-line item override.

**So Accounting already recognises a print plate as its own destination. The
quote cannot express one.** BV-011 named the destination; nothing was ever built
to fill it.

## The smallest correction

Not implemented, and it needs Edward's disposition. Ordered smallest-first:

**(a) Name the charges — migration only.** Add `dies`, `print_plates` and
`cartons` to `recovery_charge` with `grain: "one_time"`, and add the matching
`assembly_production_inputs` columns. This makes the fee *nameable* and routes it
to its true BV-011 destination instead of `OTC - Other Service`. It does **not**
fix ownership: the charge still belongs to an Item Group. It stops the accounting
misclassification, which is the half that reaches the customer's invoice.

**(b) Give one-time charges a packaging owner — the real correction.** Extend the
production-input owner XOR to admit a third case, or introduce a sibling
`quote_leaf_one_time_charges` keyed on the leaf that caused it, with the same
`(charge_key, owner, tier)` grain the frozen instruction already uses. The freeze
layer needs no change — `owner_ref` is already text and already accepts a
quote-leaf id. This is the change that lets a carton's plate fee belong to the
carton.

**(c) Give the live election the owner the snapshot already has.** Re-key
`quote_charge_recovery` to `(quote_id, charge_key, owner_ref)`. Strictly this is
a separate defect from (b) — it is wrong today, for Item Groups, without any
packaging-origin charge existing — and it should be dispositioned on its own
evidence rather than folded in.

**My recommendation is (a) then (b), with (c) raised separately.** (a) is a
migration and a registry entry with no ownership consequences and stops a real
accounting error. (b) is the principle Edward stated and should follow a
disposition, not precede one. (c) is a live-vs-frozen disagreement that deserves
its own finding rather than arriving as someone else's step 3.

**Filed as OD-032**, per Edward's disposition of 2026-08-26 to keep the finding
separate from gate closure. See [`docs/OPEN_DECISIONS.md`](../OPEN_DECISIONS.md).

*Corrected:* this first said "proposed as OD-029 (highest existing is OD-028)".
Both halves were wrong — OD-029 is taken, and the register runs to OD-031 with
OD-018 absent. The number came from a `head`-truncated grep read as though it
were the whole list, which is the same instrument error as the site count in §3.

---

# 3 · The unenforced governed-action sites

**CORRECTED 2026-08-26.** This section first said "~55 sites across 30 files".
That figure was never measured — it was inferred from a `tail`-truncated run
whose summary line had scrolled off, and then written down as though counted.
The measured figures are:

```
main, before Phase 0     61 sites across 40 files
after Phase 0            59 sites across 38 files
```

Same class of error as the four this soak has already recorded: a reading taken
from an instrument whose output was not actually read. The tier counts below are
now derived from the verifier's per-file listing and reconcile to 59 and 38
exactly.

The verifier reports the remaining sites by name, on every run. They are
pre-existing; `#459` created none of them.

## The finding that changes the priority

Two sites are not "pre-existing technical debt" in any ordinary sense:

```
tab-sales-order.tsx:534     await markComplete(fd)    ← the irreversible NetSuite push
send-quote-flow.tsx:90      await sendQuote(fd)       ← the SAME action the soak caught
```

Both read `{ok: false}` correctly and neither catches a rejection. So:

- **`markComplete`** — an operator clicks the one irreversible act in the
  product, the function 503s, and **nothing appears**. They cannot tell whether a
  Sales Order exists. The one-deal-one-SO guard makes a retry safe, but the
  operator has no way to know that is what they are doing.
- **`sendQuote` has a second call site** that `#459` did not repair. The exact
  defect soak run 5 measured, on a sibling path, still live.

I would treat those two as a **completion of the merged repair rather than a
sweep** — they are the same finding, and leaving them open means the repair is
scoped to where the soak happened to land rather than to where the defect is.

## Risk classes

**Tier 1 — irreversible, lifecycle, or accounting-visible.**

```
DONE in Phase 0 (#461)
  quote-umbrella/tab-sales-order.tsx    1   markComplete       IRREVERSIBLE
  quote-umbrella/send-quote-flow.tsx    1   sendQuote          freeze + snapshot + PDF

REMAINING                                   6 sites, 4 files
  quote-umbrella/tab-mark-accepted.tsx  2   markAccepted / unmarkAccepted
  pricing/customer-accept-toggle.tsx    2   recordCustomerAcceptance / clear
  quote-umbrella/revise-button.tsx      1   reviseQuote — unwinds acceptance, writes HubSpot
  quote-umbrella/add-entry.tsx          1   client-review log
```

**Tier 2 — commercial economics. 22 sites, 18 files.** Moves money on the
document: `global-price-adj-input` (2), `quote-target-margin-popover` (1); the
Costs drilldowns — `packaging` (2), `other-service-item-picker` (2, and it
chooses a NetSuite item), `production` (1), `freight` (1), `bulk-raw` (1),
`mode-selector` (1); tiers — `tier-row` (2), `add-tier-button` (1), both preset
pickers (2); structure — `add-product-modal` (1), `create-item-group-modal` (1),
`direct-product-row` (1), the two context menus (2), `spec-panel` (1).

**Tier 3 — structure and organisation. 20 sites, 7 files.**
`library-browse-modal` (7), `canonical-modal` (6), `attachment-list-modal` (3),
`scenario-actions-menu` + `editable-scenario-label` (2), `notes-editor` +
`asy-notes-drawer` (2). Wrong or lost state is visible and recoverable.

**Tier 4 — administrative and read-only. 11 sites, 9 files.** Six admin forms
(7 sites), `import/refresh-header` (1), `warnings/*` (3). Low volume,
admin-gated, or a re-runnable read.

## Phased recommendation

**Phase 0 — now, as repair completion, not sweep.** Shipped in `#461`, scoped to
the two files Edward named: `markComplete` and the unrepaired `sendQuote` call
site. `ENFORCED` was extended to those two paths specifically rather than to
their directories, so the remaining Tier 1 files stay reported rather than
silently admitted.

**Phase 1 — audit before migrating.** For Tier 2, the question is not only
whether failure is visible but whether **client state mutates on failure** —
which is what `use-recovery-draft` turned out to be doing, and the most
consequential thing `#459` fixed. Grep each Tier-2 site for state written before
the await, or bookkeeping advanced after it without checking the result. Cheap,
and it is the only part of this that could surface a second commercial defect.

**Phase 2 — migrate Tier 2**, drilldowns first (they are the Costs workspace, the
phase in progress). Extend `ENFORCED` per directory as each lands, so the gain is
locked rather than re-litigated.

**Phase 3 — Tier 3, then Tier 4**, then set `ENFORCED = ["src/"]` and delete the
reported-not-vetoed branch. That deletion is the actual end state; until then the
verifier prints its own incompleteness on every run.

**Sequencing against the gate.** Every phase is client-code change and resets the
soak counter. Doing Phase 0 alone before the gate pair is defensible — it is two
files of real risk. Doing Phases 1–3 mid-gate is not. **Recommendation: Phase 0
now, Phases 1–3 after the gate closes**, unless Phase 1's audit surfaces a
commercial-state defect, in which case that specific site gets promoted and the
counter resets anyway.
