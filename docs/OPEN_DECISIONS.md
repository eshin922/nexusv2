# Open Decisions

**Status:** Live register. Updated whenever a decision opens or closes.
**Purpose:** every question the repository cannot answer for itself, with who
decides it and what evidence would settle it.

---

## How to use this document

This register exists because of a specific failure mode. When an engineer meets
an unanswered question mid-implementation, the pull toward a reasonable
invention is strong and feels like progress. Six months later that invention is
indistinguishable from a decision, and it will be defended as one.

Per [`NEXUS_IMPLEMENTATION_STANDARD.md` §10](NEXUS_IMPLEMENTATION_STANDARD.md),
**stopping is a deliverable.** This is where a stop gets recorded so it is not
lost.

**If you are implementing and hit something this register covers: stop.** The
question is open because it is genuinely undecided, not because nobody got
around to it.

**If you close one:** record the decision in the appropriate Business
Validation document or phase specification — *not here* — then mark the entry
closed with a pointer. This register holds open questions and a closed-item
trail. It is not itself business authority.

Each entry states what would change if the answer went one way rather than the
other. An open question whose answers are indistinguishable in consequence is
not a decision; it is a preference, and should be settled by whoever is
nearest.

---

## Blocking — work cannot proceed

### OD-001 · BV-009 does not exist

**Owner:** Edward · **Blocks:** Phase 2 close, Phase 3 start, PDF freight presentation

BV-009 is cited as governing business authority in eleven places across five
files, including production code at
[`src/lib/customer-view-resolver.ts:368`](../src/lib/customer-view-resolver.ts#L368),
where it justifies suppressing the customer-facing freight line. **The document
has never existed** in any branch at any point in history.

Full provenance:
[`business-validation/BV-009-freight-treatment.md`](business-validation/BV-009-freight-treatment.md)
— a reconstruction from citations, explicitly **not ratified**.

**The decision:** is the reconstruction an accurate statement of what was
approved?

| Answer | Consequence |
|---|---|
| Yes | Ratify. The reconstruction becomes BV-009. Citations resolve. Nothing else changes |
| Yes, but incomplete | Amend before ratifying. Anything the citations do not capture is currently unenforced |
| No | Every citation is suspect, including the PDF suppression already shipped on its authority |

**What settles it:** Edward's recollection of the original approval, or an
external record of it.

**Cost of leaving it open:** a business rule that is enforced in production and
cannot be verified. Anyone auditing why the customer sees no freight line
reaches a citation that resolves to nothing.

---

### OD-002 · BV-005 must be amended before Phase 4

**Owner:** Finance / Commercial Leadership · **Blocks:** Phase 4 entirely

[`BV-005`](business-validation/BV-005-below-floor-margin-approval.md) is
approved as a business contract, but
[`CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) §5
records that it **must be amended first**. Five questions are unanswered:

| Question | Why it blocks |
|---|---|
| What governed list or permission identifies Commercial Approvers? | Determines whether a permission model or a settings-managed list ships |
| Who owns membership, and who are the initial approvers? | Without initial membership the feature cannot be used on day one |
| Is self-approval allowed? | A rule enforced in code; changing it later invalidates prior approvals |
| Is one approval sufficient? | Single vs quorum changes the schema, not just the UI |
| Is Slack availability required for launch? | Determines whether Slack is a hard dependency or an enhancement path |

**What settles it:** a BV-005 amendment carrying all five answers.

Phase 4 is also the first phase that is **not cleanly reversible** — its point
of no return is the first request sent to Slack. It needs a rollback runbook
before it starts, independent of these five answers.

---

### OD-003 · Phase 3 rollback after first Apply — **SETTLED 2026-08-10**

**Outcome: `ignores`.** Measured, not argued, by
[R1](rehearsals/R1-rollback-after-first-apply.md): the pre-Phase-3 runtime
(`bcd6469`, run in a worktree) and the Phase 3 runtime were pointed at the same
database, one carrying a single applied lift.

The old runtime does not error and does not consume the rows. It computes a
different price from the one displayed before rollback — $15.93 → $15.13 on the
lifted cell, 25.0% → 21.0%, and $797.61 off that tier's NetSuite amount. The
other 23 of 24 cells were identical, so the effect is bounded to cells carrying
a lift row.

**Consequence for the runbook:** a runtime rollback is structurally safe — the
table is additive, nothing crashes, and re-deploying restores every price
exactly — but it must be preceded by `DELETE FROM quote_leaf_lifts;`, because
the failure is otherwise silent: quoted prices drop below what the operator
approved and nothing says so.

Phase 3 reversibility can now be stated in full: **clean before first Apply;
after it, reversible with a known, bounded and documented consequence.**

The original framing is preserved below.

---

**Owner:** Nexus engineering · **Blocks:** Phase 3 release, not Phase 3 start

Phase 3 introduces persisted surgical lifts. The question is **not** whether
the current runtime renders them — it does not, they do not exist. It is what a
runtime *without* lift support does when it meets a database *containing* them.

| Outcome | Consequence |
|---|---|
| **Absorbs** | Consumes rows it cannot explain. Silent wrong price |
| **Ignores** | Computes a different price from the one displayed before rollback |
| **Rejects** | Fails visibly on the state |

Phase 3 is cleanly reversible **before** first Apply. After first Apply it is
unresolved.

**What settles it:** a rollback rehearsal against a database containing lift
rows. The rehearsal is cheap; the ambiguity is not.

---

### OD-012 · Drizzle migration generation is unsafe until its baseline is repaired — **CLOSED 2026-08-12**

> **Repaired.** Baseline snapshot installed at `meta/0065_snapshot.json` and verified
> against live `information_schema`; `db:generate` demoted to drift detection
> (zero statements); `db:push` blocked; duplicate-index guard in `prebuild`.
> Migration history was already healthy (64 journal entries = 64 applied rows) —
> this was an authoring-tool safety defect. Next governed migration index: **0066**.
> Record: [`validation/od-012-migration-baseline-repair.md`](validation/od-012-migration-baseline-repair.md).

**Owner:** Nexus engineering · **Blocks:** authoring any new schema migration.
Does **not** block Gate 1B analysis, and did not block Gate 1A close.

`npm run db:generate` must not be used.

Drizzle's meta snapshots stop at `0048_snapshot.json`; migrations run to `0062`.
Roughly fourteen migrations in between were hand-written and applied without
regenerating a snapshot, so the generator diffs `schema.ts` against a picture of
the database from long ago. Run during Gate 1A close, it emitted a migration
that would `CREATE TABLE` the entire freight subsystem, re-add existing columns,
`DROP` a live index, and `ALTER TABLE freight_legs DROP COLUMN
freight_markup_pct` — against the database that also serves production. It was
read and discarded unapplied.

Nothing is currently wrong with the database. `db:migrate` reads the journal and
the `.sql` files, not the snapshots, so every hand-written migration applied
correctly and the schema is in its intended state. The snapshots are a
code-generation input only.

**Why this is a blocker rather than debt.** The failure is silent and
confident. It does not warn that its baseline is stale — it emits clean-looking
SQL that would destroy data, and the only thing standing between that output and
production is whether the person running it reads it closely. Migration
governance on this project is otherwise disciplined: pre-flight gates,
resolvability checks, additive-versus-restrictive ordering. A tool that
manufactures a plausible destructive migration undoes all of it in one command,
and does so at exactly the moment someone is moving fast.

| Option | Consequence |
|---|---|
| **Repair via `drizzle-kit pull`** | Introspect production into a fresh snapshot. Generation becomes usable again. The drift spans too many migrations to reconstruct by hand |
| **Guard** | Keep hand-writing migrations; make `db:generate` fail loudly, or remove the script, so it cannot be reached by habit |
| **Leave as-is** | Depends on every future engineer reading generated SQL in full, forever. This is the state that produced the near-miss |

**What settles it:** a `drizzle-kit pull` against production producing a
snapshot that yields an EMPTY diff against current `schema.ts`. Empty is the
only acceptable result — any non-empty diff means the snapshot still disagrees
with reality and generation is still unsafe.

Until then: migrations here are hand-written, as `0056`–`0062` were, and any
generated SQL is read in full before it is journalled.

---

### OD-013 · S-7 depends on a mutable shared production database

**Owner:** Nexus engineering · **Blocks:** S-7 entering CI. Does not block
Gate 1B.

The S-7 preservation baseline is captured from 24 live production quotes, so
**any legitimate operator edit invalidates it.** It cannot, on its own,
distinguish "the engine changed" from "the inputs changed".

This is not hypothetical. During Gate 1B increment 6 the check failed on one
quote with a large, non-float-shaped movement
(`blendedMarginPct 0.1847 -> 0.2275`). The cause was twelve
`assembly_leaf_input_cell_updated` audit rows — an operator entering costs on
the Costs surface while the increment was in flight.

**The classification sequence is mandatory before any re-baseline.** A
preservation check that gets re-baselined whenever it fails is not a
preservation check:

1. revert the candidate code
2. re-run against identical `HEAD`
3. distinguish input drift from engine drift
4. only then re-baseline, and only if the evidence shows legitimate data change

Two signals made the call quick and should be looked for again: a code
regression moves MANY quotes while an operator edit moves ONE, and the audit
trail names the actor and timestamp for every input change — which is Gate 1A's
actor snapshots being used as forensics rather than as provenance.

| Option | Consequence |
|---|---|
| **Deterministic isolated fixtures** | S-7 becomes reproducible and CI-eligible. The validation database already exists for e2e |
| **Leave on production data** | Every operator action is a potential false positive, and each one costs a manual bisect |

**What settles it:** an S-7 baseline captured against the isolated validation
database, reproducing byte-identically across two runs with the application in
use. Until then S-7 stays manual, per the standing decision that a transient
database failure must not masquerade as a code regression.

---

### OD-014 · What entity constitutes a commercial SKU for Pricing aggregation

**SETTLED 2026-08-07 by Edward.** Recorded in
[`gate-1b-od-014-sku-identity.md`](gate-1b-od-014-sku-identity.md).

> A commercial SKU for Pricing aggregation is the quote-scoped leaf attachment,
> **`quote_leaves.id`**. Aggregations over SKUs use that population regardless
> of assembly-tree shape.

Four of the five recorded sources agreed — Phase 3 authority, canonical
attachment semantics, existing per-SKU Pricing behaviour, and customer-facing
quote behaviour. Production data closed `leaf_id` independently: the same
library leaf attaches up to three times within one quote, so it does not
distinguish commercial lines. The fifth source is dispositioned as **OD-016**.

The population boundary this exposed (**C-2**) is corrected; the two findings it
left open are **OD-016** and **OD-017**.

---

### OD-015 · S-7 does not validate the semantics of graph-only nodes

**Owner:** Nexus engineering · **Blocks:** reattempting Gate 1B increment 7.

S-7 hashes `QuoteCostingResult` — the commercial scalars that existed before
Gate 1B. It proves those are byte-identical. **It says nothing about nodes that
exist only in the graph**, because a node consumed by nothing changes no scalar.

Increment 7 passed S-7 byte-identically while emitting a node whose value was
wrong for the quantity it named. That is S-7 behaving correctly and being
misread as broader assurance than it offers. The gap is structural: a
preservation baseline over old outputs cannot validate new ones, and the graph
is now accumulating nodes faster than any consumer reads them.

The unit fixture did not close the gap either. It asserted the resulting
**number**, on a quote whose structure made the right and wrong populations
identical, so the assertion held for a reason unrelated to correctness.

**Before increment 7 is reattempted:**

1. Add a fixture whose structure matches real nested production data — at
   minimum one assembly with multiple leaves, and unequal per-entity
   quantities so an unweighted mean cannot pass as a weighted one.
2. Assert **contributor identity and population** explicitly — which entities
   participated, and how many — not only the resulting value. A test that
   checks only the number cannot distinguish the right answer from a
   coincidence.
3. Keep both assertions. The population assertion is what fails when the
   business identity in OD-014 is later revised.

**What settles it:** an increment-7 test suite in which deliberately corrupting
the contributor population fails a test, per the standing rule that a
reconciliation rule is not complete until a valid case passes and a corrupted
case fails.

---

### OD-016 · Setup authors commercial values that nothing consumes

**Owner:** Edward · **Blocks:** nothing today. Will block ASY-optional quote
authoring if unanswered.

`assemblies` carries `unit_price`, `unit_cost`, `margin_pct` and `markup_pct`.
The Add Product modal presents ASY mode as *"commercial fields"* and LEAF mode
as *"identity fields"*. Those four columns are written by `createAssembly` and
**read by nothing** — zero readers anywhere in `src/`.

Operators can therefore author commercial values that no downstream authority
consumes, in a surface that presents them as commercial. Nothing warns them.

Dispositioned during OD-014 as a **Setup-authoring defect**, explicitly *not*
evidence that assemblies are priced SKUs — Pricing identity does not move around
these fields. The long-term direction sharpens it: once ASY is optional at quote
level, a quote may contain no assembly at all.

| Option | Consequence |
|---|---|
| **Remove the fields from ASY authoring** | Setup stops teaching a commercial model the system does not implement |
| **Wire them to something** | Requires stating what an assembly-level price *means* when the customer is quoted per leaf |
| **Relabel as non-commercial** | Cheapest, if the values are wanted as internal reference only |

**What settles it:** a statement of what an assembly-level price is for, or a
decision to drop it.

---

### OD-017 · Cost inputs key on `assembly_leaf_id`, blocking ASY-optional authoring

**Owner:** Nexus engineering + Edward · **Blocks:** ASY-optional quote authoring.
Does not block Increment 7.

Every cost-input table — `assembly_leaf_inputs`, `assembly_leaf_overrides`,
`assembly_leaf_targets` — keys on `assembly_leaf_id`. A direct canonical
attachment (`quote_leaves.assembly_id IS NULL`) has no such row, so **no cost can
be authored against it.**

Since the OD-014 / C-2 correction such an attachment *is* a governed SKU and
appears in Pricing and the customer quote — with unpriced cells, via the existing
missing-cell semantics. Nothing invents a price. But it cannot be costed.

Zero direct attachments exist today, so this is latent. **Under ASY-optional
authoring it becomes the main path**, at which point the tables must key on
`quote_leaf_id`.

That is a schema change → **OD-012** governs how it is authored. It is recorded
now, while it is cheap, rather than discovered when the first ASY-less quote
cannot be priced.

**What settles it:** a migration re-keying the cost-input tables to
`quote_leaf_id`, sequenced after OD-012 is resolved — or an explicit decision
that ASY remains mandatory.


### OD-019 · How a margin is represented in the canonical graph — **SETTLED 2026-08-07**

> **Settled.** A `ratio` node kind was added — `operand ÷ basis`, deliberately
> generic, with `costing-nodes.ts:74` recording *"a margin is the instance that
> motivated it (OD-019)"*. A `margin` kind was rejected because it would name
> one business quantity in a vocabulary of eleven structural kinds.
> [BV-010](business-validation/BV-010-blended-margin-definition.md) then defined
> the quantity itself, and `quote/{tier}/margin` carries it.
>
> **Retained in place** rather than deleted: the reasoning below is why the
> graph has a `ratio` kind and not a `margin` one, which is the kind of question
> that gets re-asked.
>
> *Kept under Blocking until 2026-08-10, after Phase 3 had already closed. The
> decision was made; the register was not updated. Corrected as
> **AM/OD specification maintenance** following the V1 compliance audit
> (row OD-019).*

**Owner:** Edward + CA · **Blocked:** the margin-in-points transient delta,
which Phase 3 §3 requires. **Was in Phase 3 scope.** Blocked nothing else; the
staging bar and page mounting proceeded in parallel.

**Classification:** design decision, not an implementation one. §2 of the node
specification is explicit that adding a node kind is the former, so this stops
here rather than choosing.

---

#### Why there is a question at all

Phase 3 §3 requires that while anything is staged, the cost stack shows the
movement against last-applied **on every component row, on quoted sell, and on
margin in points.** The first two are joins on canonical node keys and work
today (PR #238). The third has nothing to join: **no node in the graph carries
a margin.** Every `pct` node in the graph is a rate or a resolution — a markup,
an adjustment, the effective target. None is a computed ratio.

`marginPointsDelta` is written, unit-tested, and needs only a key to read.

**Do not fold margin into an existing kind to avoid new vocabulary.** Each of
the eleven advertises an operation, and reconciliation checks the node against
the operation it advertises. A margin filed as `allocation` or `rate` would be
checked against arithmetic it does not perform, and the check would have to be
weakened to accommodate it — which quietly weakens it for the nodes that
legitimately use those kinds.

---

#### Recommendation: a `ratio` kind, with the denominator as `basis`

Stated as a recommendation rather than a decision. Engineering analysis is
complete; the choice is Edward + CA's.

```
{sku}/{tier}/margin      kind: "ratio"    unit: "pct"
  op:       "(revenue − cost) ÷ revenue"
  operands: [ {sku}/{tier}/margin/gross   kind: "difference" ]
  basis:    { label: "Revenue", value: <revenue> }
```

**Generic, not domain-named.** `ratio` means `operand ÷ basis` and nothing more.
A `margin` kind would name one business quantity in a vocabulary whose other ten
members name operations, and the next ratio the graph needs would have to either
reuse a misleading name or add a twelfth.

**It composes with `difference`, which already exists** — added for the Costs
header's departure node. `revenue − cost` is a difference; a margin is that
difference over revenue. Reusing it is the argument that `ratio` is the right
granularity: if margin needed a bespoke kind, the composition would not fall out
this cleanly.

---

#### 1 · Operands and reconciliation

**The denominator is `basis`, not a second operand**, and the existing field's
own documentation gives the reason:

> *Carried as data rather than as an operand because the basis is computed
> elsewhere in the chain — embedding its subtree here would duplicate arithmetic
> nodes, and duplicated arithmetic nodes double-count under reconciliation.*

That is exactly the situation. Revenue already appears inside the `difference`;
making it also a direct operand of the ratio would put one arithmetic node under
two parents, which §4 rule 5 forbids. `rate` solved the same problem the same way
— duty carries its percentage as an operand and factory cost as a basis.

Reconciliation is then a single line, and true for every `ratio` rather than for
margins specifically:

```ts
case "ratio": {
  const [numerator] = operands;
  const denominator = n.basis?.value;
  return closeEnough(numerator.value / denominator, n.value) ? null : …;
}
```

**A ratio must reconcile like everything else.** No exemption: `resolution` is
the only kind that asserts nothing, because its children are alternatives.

---

#### 2 · Zero-revenue semantics — the crux

`CostingNode.value` is `number`, not `number | null`. **An undefined margin
therefore cannot be a `ratio` node**, and must not be one valued zero — that is
precisely the fabrication three corrections have just removed from the scalars
(quote-wide, per-tier, per-cell).

The graph already has the right shape for it: **`flagged-out`**, valued zero,
carrying `reason`. It exists for an input that is excluded with a stated cause,
and it is already used for a rejected surgical lift.

```
revenue > 0   →  ratio node
revenue = 0   →  flagged-out, reason = "no revenue — margin is undefined"
                 or "cost with no revenue against it — margin is undefined"
```

Two consequences worth naming, both good:

- `readNodeValue` **fails closed on `flagged-out`**, so a margin delta on a
  zero-revenue cell reports nothing rather than a movement. Correct: there is no
  margin, so nothing moved.
- The two reasons preserve the `UNAVAILABLE` / `COST_WITHOUT_REVENUE`
  distinction inside the graph, which currently lives only on the scalars.

**The alternative — making `value` nullable — is rejected.** It would touch every
consumer of every node to serve one kind, and it would make "no value" expressible
in places where it is meaningless. A sum has no undefined case.

---

#### 3 · Reuse across the three scopes

One contract, three scopes, no special-casing — which is the test of whether the
kind is drawn at the right level:

| Key | Basis |
|---|---|
| `{sku}/{tier}/margin` | cell revenue |
| `quote/{tier}/margin` | tier revenue |
| `quote-wide/margin` | blended revenue |

The key grammar already supports all three (`cell`, `quote`, `quote-wide`), and
the zero-revenue rule is the same at each. **All three scalars are already
nullable with a governed status**, so emitting the nodes changes no number — it
exposes structure the engine already computes, exactly as Amendment A-1 permits.

Expected S-7 movement: **none.** The graph is not in the S-7 payload.

---

#### 4 · Graph-version compatibility

**No bump.** The rule banked with the `evaluation` field is that a version moves
when an existing consumer stops being CORRECT, not when it stops compiling.

A new kind does not make any consumer wrong about a node it already understood.
In-repo consumers that switch exhaustively — the trace's `KIND_LABEL`, the
compliance grid's `STATUS_CLASS` — fail to COMPILE, which is the outcome those
Records exist to produce. A serialized v2 graph read by a v2 consumer is
unaffected, because it contains no ratio nodes.

Contrast with `evaluation`, which did bump: there, a v1 consumer handed a preview
graph stayed perfectly type-correct and silently became semantically wrong.

**Precedent:** `blend` and `difference` were both added without a bump. This is
the third instance of the same shape, and consistency is itself the argument.

---

#### Refinement raised at implementation time (2026-08-09)

**Accepted 2026-08-09**, and one detail the analysis above did not reach.
Surfaced by starting the emission, not by re-reading the spec.

**The numerator's operands would be shared nodes.** At tier scope the two
values a margin needs already exist as ROOTS of the graph:

```
quote/{tier}/revenue        sum, root
quote/{tier}/cost-total     sum, root
```

Building `difference(revenue, cost-total)` beneath the margin means those two
node objects are reachable from two roots — their own, and the margin's. The
recommendation above rejected making revenue a direct operand of the ratio on
exactly this ground, citing §4 rule 5: *"arithmetic nodes may not be shared, or
reconciliation double-counts."* Using `basis` avoided one sharing. It did not
avoid the other, and the analysis did not notice.

**What the rule actually protects against, and whether it bites here.**

Rule 5's stated rationale is double-counting under reconciliation. That happens
when one node is an operand of a summing parent twice — the sum counts it
twice and the assertion still passes, because both the sum and the operands
agree. Here nothing sums across the two positions: revenue is a root in its own
right and a numerator input in the other, and no node has both as operands.

`findGraphViolations` would also not flag it. It is called per root with a
fresh `seenKeys`, so cross-root sharing is invisible to it. **That is not
evidence the sharing is fine** — it means the existing check was written for
within-chain duplication and has nothing to say about this case.

**Three ways to resolve it, and the choice is not obvious:**

| | Consequence |
|---|---|
| **(a) Permit cross-root sharing**, and narrow rule 5 to within-chain | Honest if the rationale really is double-counting. Requires amending a stated rule on the strength of its rationale, which is exactly the kind of reasoning that should be explicit rather than assumed |
| **(b) Emit margin-local copies** of revenue and cost under the margin subtree | No sharing, no rule change — but two nodes carrying the same value under different keys, which is duplicated arithmetic wearing a different name. Trades a rule violation for the thing the rule exists to prevent |
| **(c) Ratio takes the numerator as `basis` too** — margin as a terminal-ish node with both inputs as data | Simplest, and consistent with `rate`. Cost: the numerator stops being traversable, so the trace cannot expand "why is the gross margin what it is" — which is a real loss on the one surface built to answer that |

#### Boundary check (2026-08-09) — (a) is not a rule amendment, it is a break

Requested before rule 5 changes. The answer is unambiguous and it withdraws
the recommendation above.

**`resolveNode` walks every root and returns null unless EXACTLY ONE node
matches.**

```ts
for (const root of nodes) walkGraph(root, (n) => { if (n.key === key) matches.push(n); });
return matches.length === 1 ? matches[0] : null;
```

A node reachable from two roots is therefore seen twice and resolves to
**nothing**. Its own doc already states the architecture in terms that settle
the question: *"a node cannot be both a root and an operand without
double-counting under reconciliation."*

| Surface | Effect of cross-root sharing |
|---|---|
| `resolveNode` | Two matches → **null** |
| `readNodeValue` | Delegates → **null**. Every existing read of `quote/{tier}/revenue` and `cost-total` **blanks** |
| `findGraphViolations` | Runs per root with a fresh `seenKeys` → **reports nothing** |
| Trace traversal | `resolveNode` → null → renders *"This number cannot be traced"* |
| Entry-at-node | Pressing a cell whose key is shared opens the fail-closed panel |

**The two mechanisms would disagree**, which is worse than either being wrong:
the validator would pronounce the graph healthy while every reader treated
those keys as unresolvable. Nothing would throw. Values would simply stop
appearing.

So the question the boundary check was meant to answer is answered: **multi-parent
graph nodes are not an intended architectural property.** The reader already
treats a second sighting as a graph-integrity failure — deliberately, and that
fail-closed behaviour is load-bearing for duplicate keys generally. Relaxing it
to accommodate one kind would remove the protection everywhere to buy a margin
node.

**(a) is withdrawn.** Not because rule 5 is sacred, but because the rule is not
the binding constraint — the readers are, and they are right.

---

#### Option (d) — the container already exists, and is currently meaningless

Raised by the second half of the check: can `quote/{tier}` own revenue, cost and
margin in one subtree?

It can, and inspecting it turns up something separate and worth fixing anyway.
**`quote/{tier}` today is a `sum` of sell and cost:**

```
quote/{tier}   sum   value 25.4   operands = [ quote/{tier}/sell (15.4),
                                               quote/{tier}/cost (10.0) ]
```

Per-unit sell plus per-unit cost is **not a commercial quantity.** Nobody
governs 25.4; it is the sum of two numbers that answer different questions. It
reconciles, so no check objects, and **no consumer reads it** — `quoteScopeKey`
requires a name argument, so a bare container key cannot even be constructed
through the helper.

This is Pattern 57 one layer down from where that rule was written: *a financial
stack contains only independently governed commercial quantities*. The rule was
banked about ROWS; the same test applies to a node that asserts a value.

> **SUPERSEDED by the structural sweep below.** Two claims in this section are
> wrong: the bare key IS read (by `verify-blend-population` and a unit test,
> both via raw-string lookup), and it roots the entire blend subtree. The
> corrected proposal is (d′).

**The proposal (as first written): `quote/{tier}` becomes the margin.**

```
quote/{tier}/margin              ratio        basis { "Revenue per unit", 15.4 }
  └─ quote/{tier}/margin/gross   difference
       ├─ quote/{tier}/sell      (moves here — sole parent)
       └─ quote/{tier}/cost      (moves here — sole parent)
```

- **No sharing.** `sell` and `cost` have exactly one parent chain. They move
  from the meaningless sum into the difference that actually uses them.
- **No rule change.** Rule 5 stands as written.
- **Fully traversable.** The numerator expands, so the trace answers *"why is
  the gross margin what it is"* — the loss that ruled out carrying it as
  `basis`.
- **It removes a node asserting a quantity nobody governs**, rather than adding
  one beside it.

The denominator stays `basis` — data, not a node — so revenue appears once as a
value and never twice as a node. That is the same resolution `rate` uses, and
the reason is unchanged.

**Cell and quote-wide scope follow the same shape**, each with its own basis.
Whether a comparable meaningless container exists at those scopes has not been
inspected; if not, the margin is simply a new root there and nothing is
displaced.

**What (d) costs.** Removing `quote/{tier}`'s current sum is a graph-shape
change. No consumer reads the key, but tests may assert the node exists, and
that has not been swept. The graph is not in the S-7 payload, so **no commercial
scalar moves.**

---

#### Structural sweep (2026-08-09) — the bare key IS used, and my claim was wrong

Required before changing graph shape. It found two readers, and both invalidate
the sentence *"no consumer reads it"* in the section above.

**I searched for reads through `quoteScopeKey`, which cannot express a bare key,
and concluded there were none.** Both real readers use a raw-string lookup:

| Reader | What it reads |
|---|---|
| `scripts/gate-1b/verify-blend-population.ts:55` | `graph.nodes.find(n => n.key === \`quote/${tier.tierId}\`)`, then `.kind === "flagged-out"` |
| `tests/unit/costing-node-graph.test.ts:1076` | the same key, asserting kind, value and reason on a zero-quantity tier |

The helper-shaped grep proved only that nothing reads it THROUGH THE HELPER.
That is a narrower statement than the one I made, and the difference is exactly
the kind of gap a sweep exists to catch.

**The key carries two shapes, and only one is meaningless.**

```
tier quantity > 0   →  sum, value 25.4        sell + cost. Not a commercial quantity.
tier quantity = 0   →  flagged-out, value 0   "a units-weighted blend is undefined"
```

The second is load-bearing and correct — it is how the graph states that twelve
production tiers have no blend, and `verify-blend-population` uses it to assert
that no readable blend is exposed on an undefined tier.

**It is also the root of the whole blend subtree**, which the earlier inspection
missed:

```
quote/{tier}                      sum   (sell + cost)   ← the meaningless value
├─ quote/{tier}/sell              sum
│    └─ quote/{tier}/sell/{leaf}  …and the per-component blends beneath
└─ quote/{tier}/cost              sum
```

`quote/{tier}/sell` is read by the Cost Stack (`read("sell")` in
`pricing-surface-shell`). Removing the container outright would orphan that
subtree and break the undefined-tier contract. **"Remove it" was the wrong
proposal**, and the sweep is what turned it up rather than a smoke test after
the fact.

---

#### Revised (d) — retire the VALUE, keep the container, add the explicit key

The container stays, because two things depend on it. What is retired is the
`sell + cost` sum — the number nobody governs.

```
quote/{tier}                        container, one operand
└─ quote/{tier}/margin              ratio        basis { "Revenue per unit", 15.4 }
   └─ quote/{tier}/margin/gross     difference
      ├─ quote/{tier}/sell          sole parent — moved, subtree intact
      └─ quote/{tier}/cost          sole parent — moved
```

- **`quote/{tier}/margin` is an explicit canonical key**, as directed — not the
  bare key repurposed.
- **No sharing.** `sell` and `cost` each have exactly one parent chain. They
  move from the meaningless sum into the difference that uses them.
- **Nothing is orphaned.** The blend subtree hangs beneath `sell` as it does
  today, one level deeper. `resolveNode` still finds each key exactly once, so
  the Cost Stack's reads are unaffected.
- **No key becomes ambiguous.** Every key in the subtree is unchanged; only its
  depth moves.
- **The zero-weight contract is untouched.** On a zero-quantity tier the
  container is still `flagged-out` with its reason, so `verify-blend-population`
  and the unit test keep passing unchanged.
- **The container's value becomes the margin's** rather than sell + cost.
  Nothing reads that value: both readers inspect `kind`, and the unit test
  asserts a value only on the flagged-out branch.

**What still needs checking at implementation time**, listed rather than
assumed: whether any verifier walks the container expecting exactly two
operands, and whether `graphIsComplete` or the required-section list treats the
quote scope in a way this depth change disturbs. Both are cheap to check and
neither is known to be a problem.

---

#### Viable representations, restated

| | Verdict |
|---|---|
| (a) Permit cross-root sharing | **Rejected.** Breaks `resolveNode`, `readNodeValue`, trace and entry-at-node; blanks two live keys; would require removing a fail-closed protection that exists for good reason |
| (b) Margin-local copies | Available, poor — duplicated arithmetic under a synonym |
| (c) Numerator as `basis` | Available — costs traversability on the surface built for traversal |
| ~~(d) `quote/{tier}` becomes the margin~~ | **Superseded by the sweep.** The bare key has two readers and roots the blend subtree |
| **(d′) Container retained, its VALUE retired, `quote/{tier}/margin` added beneath it** | **Recommended.** No sharing, no rule change, fully traversable, nothing orphaned, zero-weight contract intact — and the meaningless sum still goes |

---

#### What settles it

Edward + CA confirm or reject the `ratio` contract above. If confirmed,
implementation is bounded and additive: one kind, one reconciliation branch, one
emission site per scope, and the delta call site that is already written.

If rejected, the alternative must still answer §2 — margin cannot be filed under
a kind whose advertised operation it does not perform.

---

## Open — needed before the relevant work starts

### OD-009 · Freight markup resolution when a break carries no markup

**Owner:** Edward + operators (Logistics) · **Blocks:** nothing today —
implementation deferred pending business disposition
**Classification:** **business disposition required**, not an engineering
decision. Engineering analysis complete; the choice is a workflow judgement.

`freight_destination_breaks.freight_markup_pct` is nullable and the action
layer can write NULL. The costing read path resolves NULL to **zero**
(`costing.ts:420` — `num(row.freightMarkupPct, 0)`), so a draft break with a
freight amount and no markup contributes freight **at cost**.

**Severity is bounded.** Send is blocked — `quote-cost-completeness.ts:45`
rejects a null `freightMarkupPct`. No customer can receive a quote in this
state. The effect is confined to **drafts**, where a PM mid-build sees margin
that will not survive completion, with no signal that the number is
provisional.

**Why this is not an engineering decision.** All three options are
implementable at similar cost. They differ in what an operator should *see*
while building, which is a workflow question, not a correctness one.

| Option | Behaviour | Argument for | Argument against |
|---|---|---|---|
| **A · Inherit silently** | NULL resolves to `quotes.freight_markup_pct` | Consistent with PHASE-2's "one Quote-owned freight markup authority". Draft margin is realistic immediately | A blank field looks answered. The operator sees a number sourced from a default they never confirmed, then hits a send block they did not expect |
| **B · Withhold commercial values** | Draft shows no freight contribution until markup is entered | Honest — nothing is displayed that the operator did not supply | Hostile during exploratory building. Entering an amount produces nothing until a second field is filled |
| **C · Inherit and mark provisional** | Resolves to `quotes.freight_markup_pct`, surfaced as inherited via existing `field_provenance` | The number is useful and its status is visible. Send gating unchanged | Adds a visual state to a surface currently under fidelity review; the design bundle does not specify an "inherited" treatment |

**Engineering recommendation: Option C.** It applies the governing principle
to its own edge — show what was inherited and say that it was inherited, rather
than inventing zero or refusing to speak. **Not implemented.** Recorded as a
recommendation only.

**What settles it:** Edward's disposition, ideally informed by how Logistics
actually works — whether a blank markup means *"use the standard"* or *"I have
not decided yet."* Those two intents want different options.

**Note on Option C and Design Authority:** the `freight-1a` bundle specifies no
"inherited value" treatment. If C is chosen, the visual state is either an
approved deviation recorded in
[`design-authority/freight-1a/BUNDLE.md`](design-authority/freight-1a/BUNDLE.md)
or a question referred to CD. Do not invent the treatment.

---

### OD-010 · Stale publication entries awaiting F3 Stage 5 removal

**Owner:** Nexus engineering · **Blocks:** nothing · **Tracked retirement obligation**

`scripts/verify/realtime-readiness.ts` still lists three tables dropped by
Slice 11.5.1 — `quote_skus`, `packaging_inputs`, `production_inputs`. They are
annotated in place rather than pruned, because that verifier is the executable
record of what should be published and removing them in an unrelated commit
would erase the evidence that the OLD-model publication cleanup happened.

**A code comment is not a retirement obligation, which is why this entry
exists.** Without it the annotation is a note nobody is accountable for.

**Removal is scoped to F3 Stage 5** (legacy freight model drop, post-V1),
alongside removing the four legacy freight tables from both the publication
and the `structure` channel bindings. Same commit, same cross-consumer audit:
reads, writes, realtime subscriptions, publication membership, raw SQL under
`src/lib/`.

**What settles it:** F3 Stage 5 shipping. Nothing else needs to happen first.

---

### OD-011 · Order-dependent browser fixture state in `basic-quote-persistence.spec.ts`

**Owner:** Nexus engineering · **Blocks:** nothing today
**Class:** validation infrastructure · **Pre-existing, unrelated to F9**

VAL-101 mutates fixture state that VAL-103 consumes. Running the spec file
sequentially without an intervening reseed fails; VAL-103 reports
`Protocol error (Network.getResponseBody): No data found for resource`, and a
whole-file run additionally surfaces `net::ERR_ABORTED` on a server-action POST.

**Both mandatory merge-gate items pass.** [`merge-gate.md`](validation/merge-gate.md)
invokes VAL-101 and VAL-103 as separate `-g` executions, so the coupling is
never exercised by the gate. Verified against clean fixture state at
`8fd2a18`: VAL-101 passes, VAL-103 passes.

**The gate is insulated by invocation shape, not by test isolation.** That is
the finding. [`operational-runbook.md`](validation/operational-runbook.md)
seeds once at §5 and resets at cleanup; nothing reseeds between browser gates.
Anyone who runs the file whole, reorders the checklist, or adds a third VAL
case to the same file hits it.

**Reproduces at `131af0a`** — established by the same bisect that cleared the
Stage 1b visual delta. Not caused by the Freight work and **not to be fixed
during Freight closeout** unless it becomes a demonstrated merge-gate failure.

**What settles it:** either per-test fixture isolation, or an explicit reseed
step between browser gates in the runbook. The second is cheaper; the first is
correct. Deciding which is the disposition.

**A caution for whoever takes it:** the current green state depends on an
accident of invocation. Treating the gate passing as evidence the tests are
isolated would be the wrong reading.

---

### OD-004 · Item Group applicability datum — **DISPOSITIONED 2026-08-11 · CERTIFIED 2026-08-12**

**Owner:** Accounting / Operations · **Blocks:** nothing — REG-4 / Track B is
**CLOSED** on real NetSuite sandbox provider evidence (SO2704 / `361441`;
Item Groups `75354` / `75454`). Closure record:
[`validation/reg-4-track-b-certification.md`](validation/reg-4-track-b-certification.md).
Do not reopen Item Group architecture absent new contradictory provider evidence.

> **Disposition (Edward, 2026-08-11): NetSuite grouping follows the quote's
> agreed customer presentation.**
>
> | `quotes.detail_level` | grouping |
> |---|---|
> | `itemized` | **not required** — preserve the itemized presentation |
> | `turnkey_only` | **required** |
>
> - **Which lines group — scoped by Product Structure** (correction 1, Edward,
>   2026-08-11; see "Scoping correction" below):
>
>   | Product Structure | grouping boundary |
>   |---|---|
>   | **ASY-backed** | the **assembly** supplies the boundary; deterministic identity remains `composition_hash` |
>   | **Direct Components / no ASY** | **no implicit boundary.** Each Direct LEAF remains an independent commercial line and projects as a flat NetSuite Item line under BV-006 §5. **Nexus must not synthesize an ASY merely to create a grouping boundary** |
>   | **Mixed** | downstream contract **remains unapproved** under BV-006 §5 and is **outside this V1 projection proof** |
>
> - **Group identity:** `composition_hash`, unchanged.
> - **Integration boundary: A2.** Nexus does not create the Item Group via an
>   API operation REST/SOAP cannot perform. It produces the deterministic
>   grouping plan when grouping is required, preserves the accepted commercial
>   content, and supports evidence that the NetSuite result matches it.
>
> **Explicitly NOT required for V1:** `cost_category` · leaf classification ·
> the 1,000-row backfill · any new fulfilment taxonomy.
>
> Analysis: [`validation/od-004-decision-set.md`](validation/od-004-decision-set.md).
> Evidence boundary: [`validation/od-004-evidence-boundary.md`](validation/od-004-evidence-boundary.md).

**Scoping correction (Edward, 2026-08-11).** The original disposition said only
*"the assembly is the deterministic boundary."* Reconciled against
[BV-006 §5](business-validation/BV-006-product-structure-contract.md), that
describes the **ASY-backed case alone**. It must not become a V1 architectural
requirement that every commercially valid quote possess an ASY — BV-006 states
that Direct Components *"must not cause implicit ASY creation"* and that an ASY
*"must never be created silently as a convenience wrapper."* The table above is
the scoped form. **This correction changes no runtime behaviour.**

**V1 applicability limitation — `detail_level` is a temporary proxy.**
OD-004 keys grouping applicability off `quotes.detail_level` **only because the
currently reachable quote runtime is uniformly ASY-backed**, which leaves Product
Structure with no discriminating signal: it is constant, so it cannot separate
Detailed from Turnkey.

It is **not permanent Commercial Representation authority.** BV-006 §4 remains
governing and names customer-PDF detail level as **not an approved derivation
input**, and separately records that *"Turnkey is distinct from the existing
`turnkey_only` PDF presentation value."* When Direct Components become reachable,
downstream representation must derive from the approved Product Structure /
Commercial Representation contract, and `detail_level` returns to
**presentation-only** semantics.

**Deferred implementation defect — Direct Component silent drop.**

> Once Direct Components become reachable, a Direct LEAF can enter costing but be
> omitted from the NetSuite SO projection, because line construction searches
> only `tree.assemblies[].children`.

`src/lib/netsuite/mark-complete.ts:548-551` resolves each leaf rollup through
`tree.assemblies.flatMap(a => a.children)`; an attachment with
`quote_leaves.assembly_id IS NULL` has no entry there, so `treeLeaf` is undefined
and the line hits `continue`. The costing adapter already admits such an
attachment (`src/lib/costing-adapter.ts:120`, `:296`, `:342`), so the leaf would
carry cost and revenue while contributing **no SO line** — the push would balance
below the accepted total **without raising an error**.

| | |
|---|---|
| **Reachability** | **Unreachable in current V1 runtime.** The only writer to `quote_leaves` is `attachGroupedMembership` (`src/lib/product-structure/grouped-membership-compatibility.ts:96`), whose args require a non-null `assemblyId`. No path creates a Direct Component |
| **Classification** | **Not a V1 release blocker.** Required to be repaired **with the Direct Components feature slice** |
| **Deferred alongside** | nullable / directless `PlanLineInput` support · Send-guard message correction (`quotes.ts:1435` says *SKU*, the query counts **assemblies**) · Direct Component runtime implementation |

**Superseded authority.** `src/lib/netsuite/mark-complete.ts` STEP 5 previously
asserted the wrap was *"MANDATORY for anything invoiced."* That is **overbroad
and no longer governing** — it is annotated as superseded at the source. Two live
rules is the failure this supersession prevents.

**Still open (second original question):** what controlled sandbox result
approves the **member-rate pricing procedure**. Unchanged by this disposition.

**Standing constraint, independent of the answer:** a `$0.00` upstream catalog
price can satisfy NetSuite validation but **must never become the commercial
transaction price.**

---

### OD-005 · HubSpot Product price → NetSuite Base Price propagation

**Owner:** HubSpot / NetSuite integration owner · **Blocks:** Slice 13 go-live

Nexus-authored components default the HubSpot Product `price` payload to
`0.00` when no valid price is supplied. Proven in isolated validation only.
HubSpot → NetSuite Item price propagation is **untested**.

**What settles it:** a controlled live sync experiment proving the corresponding
NetSuite Item Base Price row is created or updated — or an approved
direct-to-NetSuite alternative path.

This is external to Nexus. No amount of Nexus-side work closes it.

---

### OD-006 · NetSuite assembly structure

**Owner:** Edward + Accounting · **Blocks:** Sales Order push design

Three discovery questions, answerable in parallel with other work:

1. Does the active HubSpot → NetSuite sync carry assembly metadata, or only
   leaves?
2. What does the firm's NetSuite administrator manually enter into Sales Orders
   today — assemblies or leaves?
3. Is the NetSuite assembly pricing model a separate price, or the sum of
   leaves?

Together these decide whether the Sales Order push sends assemblies, leaves, or
both.

---

### OD-007 · Pricing click-to-edit as accepted extension

**Owner:** Edward · **Blocks:** Phase 3 kickoff, not Phase 3 planning

Nexus's Pricing surface uses click-to-edit cells where the R12 canonical source
may render display-only. Under
[`NEXUS_IMPLEMENTATION_STANDARD.md` §9](NEXUS_IMPLEMENTATION_STANDARD.md) a
departure from the bundle is either an approved deviation or drift.

| Answer | Consequence |
|---|---|
| Accepted extension | Record in [`design-authority/r12-pricing-workspace/BUNDLE.md`](design-authority/r12-pricing-workspace/BUNDLE.md). Fidelity audits stop re-raising it |
| Not accepted | Phase 3 removes the affordance. **Check first whether it is the sole authoring surface for any field** |

**Decide at Phase 3 kickoff, not during implementation.** Deciding mid-build
means deciding under schedule pressure.

---

### OD-023 · Send does not freeze the governed Product Structure — **V1 BLOCKER**

**Owner:** Nexus engineering + Edward · **Blocks:** OD-022, and historical
integrity of every sent quote today

`quote_snapshots` carries commercial settings and PDF axes. It does **not**
carry the governed leaf set or its structure, so Complete re-derives structure
from **live** assemblies. A Setup edit between Send and Complete silently
changes the structure of an already-sent quote.

This is **pre-existing and affects Finished Products today** — it is not
introduced by Direct Components. Uniform structure has masked it; Mixed quotes
would make it reachable.

The snapshot must freeze enough that a later live edit cannot change: which
commercial leaves were accepted; whether each was Direct or a Finished Product
member; the Finished Product grouping/composition boundary; and the identity
required for downstream projection.

Dependency chain: `OD-012 → OD-017 → OD-023 → OD-022`.

Lifted out of OD-017 by disposition 2 (2026-08-12) so a cross-cutting repair is
not buried inside a costing slice. Trace:
[`validation/od-017-persistence-model.md`](validation/od-017-persistence-model.md) §7 T2.

---

### OD-022 · Operators cannot tell when an ASY structure is required

**Owner:** Edward · **Blocks:** Product Library / V1 operator workflow · **Not**
a Track B condition

> Operators must understand when a Finished Product / ASY structure is required,
> and that this structure governs downstream NetSuite Item Group composition.

REG-4 / Track B certifies that the machinery is correct **given a correct
structure**: the ASY composition becomes the Item Group's master definition, and
its identity hash keys on that composition. What Track B does not certify — and
cannot — is that an operator authoring a quote can tell when an ASY is needed at
all, or that they understand the downstream consequence of getting it wrong.

The consequence is not local. An ASY that should have been two groups, or two
that should have been one, produces a Sales Order that reconciles to the correct
total while shipping the wrong commercial structure — the exact
attribution-without-reconciliation failure the certification gate exists to
catch at the provider, and which is far cheaper to prevent at authoring time.

**What settles it:** a Product Library / Setup workflow decision about when
structure is prompted, required, or inferred, and how the NetSuite consequence
is surfaced to the operator authoring it.

Raised at Track B closure (2026-08-12) and deliberately carried out of it.

---

### OD-021 · `Send` finalizes the quote but does not deliver it

**Owner:** Edward · **Blocks:** V1 release — operator-facing copy currently
states something false to the operator

`sendQuote` freezes the snapshot, assigns the quote number, stamps `sent_at`,
flips `status` to `sent`, and persists the PDF. It dispatches **no email** —
there is no mail transport in the repository. Customer delivery is a separate
manual `Download + open mail draft` action (`mailto:` with no recipient and no
attachment). The Send sub-tab nevertheless tells the operator the customer
"will receive the customer PDF by email."

Two concepts are fused that need not be: **commercial finalization** (frozen,
numbered, immutable — Nexus owns this and it works) and **customer delivery**
(Nexus cannot perform it and holds no evidence of it).

Not cosmetic: `valid_until = sent_at + days_valid`, so the customer's
acceptance window starts at finalization, and the PDF prints that date as
"Issued". A quote finalized Monday and emailed Thursday reaches the customer
with three days already gone.

**What settles it:** choosing **A** (Nexus owns email dispatch and delivery
evidence — largest scope, makes the wording true) or **B** (operator sends;
Nexus stops claiming delivery — smallest scope). If B, also settle **B1**
(add an explicit `Mark as sent` confirmation, giving a real delivery datum and
a correct `valid_until`) vs **B2** (Nexus tracks finalization only and never
claims delivery).

**Do not** repair by wiring email into `sendQuote` before this is dispositioned,
and do not redefine `sent_at` / `status='sent'` / snapshot semantics — consumers
are traced in the finding and all of them are correct about *finalization*.

Full trace, surface inventory, and consumer list:
[`validation/v1-finding-send-does-not-deliver.md`](validation/v1-finding-send-does-not-deliver.md).

**Certification language correction (adopted now):** `status = sent` proves the
quote was frozen and finalized by Nexus. It does not prove customer delivery.
Prior walk evidence remains valid — it proved finalization, which is what it
was demonstrating.

---

### OD-008 · Costs-page shell scope

**Owner:** Edward · **Blocks:** nothing today; will block Phase 2 close if unanswered

The `freight-1a` bundle ships `app/costs/styles.css` — 23 `cw-*` classes
defining a Costs-page shell (topbar, rail, ledger, crumb, legend, scope).
Production implements two of them.

**The decision:** is that shell in scope for Phase 2, or is it a separate
Costs-workspace pass?

The bundle is tier-3 authority for the Freight *section*. Whether it is also
authority for the *page around* the section has never been stated. The
[parity audit](phase-2-freight-dom-parity-audit.md) is scoped to the freight
worksheet and does not answer this.

**What settles it:** an explicit scope statement. "The bundle governs the
Freight section only" is a complete answer and closes this.

---

### The aggregation-identity pattern

**Not a decision — a recurring shape, recorded so it is recognised on sight.**

Three surfaces have now each turned out to aggregate over a different
population, and in every case the population was a **business contract**, not an
implementation detail:

| Surface | Aggregates | Settled by |
|---|---|---|
| Pricing Cost Stack | weighted mean across the governed SKU population | OD-014 |
| Costs header subtotal | quote tier total allocated over tier quantity | header increment |
| Packaging drilldown TOTAL | simple sum across every governed SKU at the tier | OD-018, settled |

All three are labelled in ways that invite the reader to expect agreement. Two of
them differ by a factor equal to the leaf count. None of them is wrong.

**The rule this yields:** when a surface aggregates, *which population* is a
question for Edward before it is a question for the engine. Emitting a node
first and asking afterwards inverts the dependency and produces an authority
that is confidently wrong — increment 7's failure mode exactly.

**Recognition heuristic:** any `reduce`, `Σ`, mean, or total over a collection
of commercial values. If you cannot name the population in one sentence that an
operator would recognise, it is an open business question, not a computation.

---

### OD-020 · The client rebuilds a costing input the server already built

**Owner:** Edward + CA · **Blocks:** nothing today. Recorded while the reasoning
is fresh, not because work is waiting on it.

**Classification:** architectural. The question is whether parity between two
constructions should keep being *guaranteed*, or stop being *needed*.

---

#### What happens now

`getCostingBundle` assembles a complete `QuoteCostingInput`, computes with it,
and returns a snapshot. The client then assembles a **second** input from that
snapshot — `buildCostingInput` — for every optimistic recompute and every
preview. Two constructions of the same object, from the same data, that must
agree.

#### Why it is recorded

They did not agree. `buildCostingInput` omitted `freightComponentTierCosts` and
`freightShipmentBreaks`; both were optional on the external type and had no home
in the store, so the omission compiled cleanly. Because
`freightShipmentBreaks.length > 0` is what makes the worksheet freight model
authoritative, every client computation on a worksheet quote dropped **all**
freight and duty/tariff and reported an improved margin — in previews for their
full displayed lifetime, and in committed optimistic recompute until the next
server reconcile. Fixed in PR #249.

**The fix guards the class; it does not remove it.** `Required<QuoteCostingInput>`
makes an omission a compile error, and two invariants pin parity at runtime. A
third construction path, or a field added somewhere the builder cannot see,
would still be a new opportunity for the same shape of divergence.

#### The alternative

Carry the server-originated `QuoteCostingInput` on the snapshot and have the
client spread it, changing only what is staged. One construction, used twice.
Drift becomes structurally impossible rather than caught.

#### What has to be weighed

- **Payload.** The input is larger than the snapshot's projections and overlaps
  them substantially. Whether the snapshot carries both, or the projections are
  derived from the input client-side, is the real design question.
- **Mutability.** The store mutates its projections on optimistic edit
  (`updatePackagingCell` and thirteen siblings). A carried input would need the
  same edits applied to it, which is a mapping — and a mapping is the thing this
  is trying to remove. It may only pay off if the store's authoring rows and the
  engine's input rows converge on one shape.
- **`Stored*` vs `Costing*` row types.** They differ by authoring-side fields
  the engine ignores (`rowId`, vendor snapshot fields). That difference is real
  and may be the reason two shapes exist at all.

#### What settles it

A design pass that answers whether the store can hold the engine's input shape
directly, or whether the authoring and computation shapes are legitimately
different — in which case parity-by-invariant is the correct permanent answer
and this entry closes as "considered, rejected, here is why."

**Not urgent.** The invariants hold, the compiler enforces completeness, and the
defect that motivated it is closed. This exists so the question is asked
deliberately rather than rediscovered by the next omission.

---

## Closed

*(Entries move here with the disposition and a pointer to where the decision
now lives.)*

| ID | Decision | Closed | Recorded in |
|---|---|---|---|
| OD-014 | A commercial SKU for Pricing aggregation is the quote-scoped leaf attachment, `quote_leaves.id` | 2026-08-07 | [`gate-1b-od-014-sku-identity.md`](gate-1b-od-014-sku-identity.md) |
| OD-018 | The Packaging TOTAL is the simple sum of every governed SKU's packaging contribution at the tier — it shows Packaging's contribution to the Cost Stack, so it sums rather than averaging or weighting | 2026-08-07 | `quote/{tier}/cost-stack/pkg-total`; [`gate-1b-derivation-inventory.md`](gate-1b-derivation-inventory.md) §3.2.2 |
| OD-019 | A margin is a `ratio` node — `operand ÷ basis`, generic by design. No `margin` kind: it would name one business quantity in a vocabulary of structural kinds | 2026-08-07 | `costing-nodes.ts:74`; `quote/{tier}/margin`; [BV-010](business-validation/BV-010-blended-margin-definition.md) |
| OD-003 | Phase 3 rollback after first Apply — the pre-Phase-3 runtime **ignores** applied lifts. Rollback requires `DELETE FROM quote_leaf_lifts` first, or quoted prices sit below the operator-approved amount | 2026-08-10 | [R1 rehearsal](rehearsals/R1-rollback-after-first-apply.md); [cross-phase map §5](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) |
