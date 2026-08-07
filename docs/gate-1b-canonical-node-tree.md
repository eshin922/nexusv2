# Gate 1B — the canonical computation node tree

**Status:** specification. **No implementation.**
**Authority:** tier 3 design bundle (R10 · R11 · R12) and `PHASE-3-PRICING-WORKSPACE.md`.
Where this document and the design bundle disagree, the bundle governs and the
disagreement is recorded in §0.5 rather than silently resolved.

**Prerequisite satisfied:** Gate 1A. Every audit row now carries event-time actor
identity (`actor_user_id`, `actor_display_name`, `actor_kind`), which is what
lets a chain terminate in a person that a later user deletion cannot erase.

**Standing constraint:** if this specification concludes a schema change is
required, it stops and cites `docs/OPEN_DECISIONS.md` **OD-012**. It does not
author a migration. §13 and §14 are where that lands.

---

## §0 · The position this specification takes

> **The engine produces one node graph. Every commercial value any surface
> displays is a node in that graph, read — never recomputed.**

This is not a trace feature with an engine behind it. It is the computation
artifact, of which the trace is one projection.

The distinction is load-bearing because the alternative has already failed here
twice, in the same shape both times. CLAUDE.md's *"Two computations for
similar-labeled displays will diverge"* records the first: cost-stack PKG and the
packaging drilldown TOTAL both said "packaging" and disagreed by ~9%, because one
proportionally re-allocated a weighted-average markup and the other summed
per-line markups. Neither was wrong. They answered different questions with
different formulas under the same label. R10 §3 records the second, from R6:
totals hard-coded beside lines that did not sum to them.

R11 load-bearing item 10 states the fix as a property rather than a practice:
the cost stack reads R10's own node objects and *"does not recompute. This is
what makes 'they cannot disagree' true rather than aspirational."*

**That property is currently false in production.** See §0.5 F3.

---

## §0.5 · Verification findings

Run before specifying, per the standing Pattern 22 / Pattern 25 protocol. Each
item is a place where the brief, the design bundle, or the phase specification
asserts something the repository does not currently support.

### F1 · `evaluateCells()` does not exist

Referenced by `PHASE-3-PRICING-WORKSPACE.md` §9 (*"the banner and grid read one
evaluation … Both read `evaluateCells()`"*), `r12-designer-notes.md`, and
`approval-states-design-position.md`. **Zero occurrences under `src/`.**

It is a specified-but-unbuilt function, not an existing seam. §12 specifies it as
a consumer of the graph rather than treating it as a fixed point to integrate
with. Anyone reading Phase 3 §9 as *"wire the graph into the existing
`evaluateCells`"* would be looking for something that was never written.

### F2 · The node-kind count is wrong in every document, in two directions

| Source | Claims | Actually emits |
|---|---|---|
| `r10-designer-notes.md` §1 | eight | nine (`flagged-out` used but uncounted) |
| `r11-designer-notes.md` §1, §3 | nine (eight + `blend`) | ten with `blend` |
| `PHASE-3-PRICING-WORKSPACE.md` §6 | *"Nine node kinds"* | ten |

`app/r10/data.js:386` emits `kind: "flagged-out"` and
`app/r10/pricing-trace.jsx:146` branches on `node.kind === "flagged-out"`. It is
a kind in the canonical source and is excluded from every prose count.

Under Pattern 30 the canonical source is the contract, so **the vocabulary is
ten** (§2). An implementer following the prose would build a renderer that meets
a node kind it has no branch for — on the `customer_ships_raws` path, which is a
live flag.

**Checked and cleared:** `app/r11/data.js:122` emits `kind: "tier"`, but that is
a `reason.kind` on the Preview-Changes hold object, a *different vocabulary in an
adjacent field of the same name*. It is not a tenth node kind. Recorded because
the collision is exactly the kind of thing that becomes a defect (§5.4).

### F3 · Independent derivation of commercial values already exists

The rule *"no downstream consumer may independently derive commercial values"* is
not a new constraint to honour going forward. It is **violated today**, in at
least four places:

| Site | Re-derives |
|---|---|
| `src/components/costs/freight-drilldown.tsx` (5 sites) | `amount × (1 + markup)`, `÷ tier.qty`, customs sums |
| `src/components/costs/packaging-drilldown.tsx:108,918` | `unit × (1 + markup) × qty` |
| `src/components/pricing-surface/pricing-classifier-context.tsx:469,482` | margin from `totalCost / (totalRevenue × (1 + delta))` |
| `src/lib/pricing-suggestions.ts:167` | `revenue × (1 + delta)` |

Some of these are legitimate *previews* of a value the engine has not computed
yet (the staged-adjustment case). Others are display-layer duplicates of
arithmetic the engine already performed. **The two are not currently
distinguishable by inspection**, which is itself the problem: a preview and a
duplicate look identical in code and diverge differently.

This must be inventoried and classified before it can be enforced. §8.3 proposes
how; it is not a Gate 1B decision to make unilaterally.

### F4 · `computeQuoteCosting` returns scalars, and discards the structure

`QuoteCostingResult` → `SkuRollup` → `SkuPerTierRollup` is ~40 flat numeric
fields (`packagingMarkupSumPerUnit`, `totalDutyTariffBeforeMarkup`,
`computedSellPerUnit`, …). The operations and operands that produced them exist
only as intermediate locals inside `computeLeafPerTier` and
`rollUpAssemblyPerTier`.

**The graph is not a wrapper over the current result.** It is the engine emitting
what it already computes and currently throws away. That is a materially
different piece of work from decorating the existing output, and it is the single
biggest sizing fact in this gate.

### F5 · `origin` provenance remains the pre-build question — now partially answered

R10 §7.2 and §9, R11 §10, and both data-source maps all carry this as *the*
open item: which existing record supplies actor / timestamp / document per input
type. R10's map marks Actor, Timestamp and Document as **NEW *(name TBC)***.

Gate 1A answered the actor and timestamp half for **mutations**: every
`audit_log` row now carries a durable actor snapshot. R11 §11.1 asked for exactly
that (*"denormalise the actor's display name onto the audit row at write time"*)
and flagged the `ON DELETE SET NULL` hazard that Gate 1A removed.

**What is still open:** the mapping from *input type* → *audit row*. An `origin`
node needs the record that last set **this specific input**, and that is a query
nobody has written or proven. See §6.3.

R11 §11.1 also confirms the **document** half is largely absent — only packaging
carries a vendor and free-text note — and settles that this is a two-grade
terminal, not a deficiency to design around (§6.2).

### F6 · The surgical lift table does not exist

Phase 3 lists *"New lift table `(quote_leaf_id, tier_id)`"* as a schema addition.
Confirmed absent from `schema.ts`. **This is a schema change → OD-012 → stop.**
See §13.

**Name collision:** `src/lib/pricing-lift.ts` already exists and is
`buildGlobalPricingPreview` — the *global adjustment* preview, not the surgical
lift. A future file named for the surgical lift must not reuse this name.

### F7 · "Publication" has no authority document

The Gate 1B brief lists Publication as a consumer and requires this document to
specify the graph's interaction with it. **`Publication` appears in neither
`PHASE-3-PRICING-WORKSPACE.md` nor `PHASE-4-MARGIN-APPROVAL.md`.** Gate 4.5 was
introduced in conversation and never specified.

`quote_snapshots` is the only mechanism in the repository that does what
publication implies — a versioned, superseded-chained freeze bound to a sent
quote. §14 specifies against that reading and marks the interpretation as
requiring ratification.

### F8 · Bulk Raw remains provisional

Two unconnected representations: `assembly_production_inputs.bulk_raw_cost`
(pricing-active) and the R6.1 `bulk_raw_section_meta` workspace tree (quote-level,
never passed to `computeQuoteCosting`). With Business Validation. The graph uses
the pricing-active value and carries a `note` on that node; it must **not**
portray quote-level ingredient rows as the arithmetic source of a sell price.

### F9 · Phase 3 says `computeQuoteCosting` is read-only; the graph requires it to emit more

Phase 3 Repository Dependencies: *"`computeQuoteCosting` — **read-only** —
compute twice, change nothing."*

The graph cannot be produced without the engine emitting it (F4), and it must not
be produced by a second traversal (§0). These are only compatible under a
specific reading:

> **"Read-only" governs the arithmetic, not the output surface.** Adding a graph
> output that reproduces the existing scalars is additive; changing how any
> existing number is computed is not.

CLAUDE.md's *"Math layer is the load-bearing surface"* supports this — its
banked extension states that math **output** is load-bearing and that downstream
consumers must project from it rather than parallel-derive. But the reading is an
interpretation of a phase specification, and it is the interpretation the whole
gate rests on. **It requires ratification before implementation** (§15 A-1).

---

## §1 · Scope of the graph

One graph per `(quote, evaluation)`. An evaluation is a complete run of the
engine over one input set. Phase 3 computes twice — committed and staged — so two
graphs coexist and are diffed (§3.3).

The graph spans **every commercial value on the quote**, not only Pricing. R10
§7.1 and §10.1 are explicit: the cost stack is level 1 of the same chain,
transposed, and Costs is *"the other half of this chain."* A graph scoped to
Pricing alone would reproduce the divergence in §0 at the Costs boundary.

---

## §2 · Node vocabulary

**Ten kinds.** Per F2, this is the canonical-source vocabulary, not the prose
count.

| Kind | Operation | Terminal? | Reconciles? |
|---|---|---|---|
| `sum` | operands add | no | Σ operands = value |
| `markup` | `cost × (1 + m)` | no | yes |
| `allocation` | `total ÷ Q` | no | yes |
| `rate` | `base × pct` | no | yes |
| `adjustment` | `base × (1 + A)` | no | yes |
| `blend` | `Σ(value × units) ÷ Σ units` | no | yes — **averages to**, not sums to |
| `resolution` | a **choice**, not arithmetic | no | n/a — asserts the winner |
| `origin` | none | **yes** | n/a |
| `override` | none — **replaces the chain** | **yes** | n/a |
| `flagged-out` | none — **excluded from the chain** | **yes** | n/a — asserts zero contribution |

Three of these are not arithmetic, and that is the point of the vocabulary rather
than an inconvenience in it:

- **`resolution`** renders the whole ladder — winner marked, unavailable rungs
  struck through with their reason. R10 §1: collapsing it to the resolved value
  *"re-creates exactly the opacity the principle exists to remove."* Load-bearing.
- **`override`** is a human act. It is deliberately **not** an arithmetic node.
  The superseded computation is retained and demoted, never presented as the
  reason the number is what it is.
- **`flagged-out`** states that an input is *excluded*, with the reason — the
  `customer_ships_raws` case. It is not a zero. A zero-valued `markup` node and a
  `flagged-out` node carry different facts and must not be collapsed.

**Adding a kind is a design decision, not an implementation one.** R11 §11.2
records the surgical lift declining to add one because the `adjustment` shape
already fit. That restraint is the norm to preserve.

---

## §3 · Node identity

### 3.1 · Keys are deterministic, not generated

A node key MUST be a pure function of the node's position in the computation:
scope, tier, commercial attachment, section, line, and kind. It MUST NOT be a
UUID, a counter, or anything else that varies between runs.

**This is a hard requirement derived from Phase 3, not a preference.** Phase 3
computes twice — committed and staged — and renders the delta per component row.
A delta is a join between two graphs on node identity. Non-deterministic keys
make that join impossible and the transient-delta feature unbuildable.

It is also what `findPath(root, key)` (R11 §9) needs to survive a recompute: a
trace open at a node must stay open at *that* node after the graph is rebuilt.

### 3.2 · Keys are stable across irrelevant change

Adding a packaging line must not change the key of a freight node. Keys should
therefore be built from durable identifiers (`quote_leaf_id`, `tier_id`,
`line_group_id`) rather than from array positions.

**Open:** whether keys must survive a *cost-structure* change — e.g. does a node
keep its key when its line is deleted and re-added? Consequence: it determines
whether a staged delta can outlive a structural edit, or whether structural edits
invalidate staging. §15 A-4.

### 3.3 · Two graphs, one key space

Committed and staged graphs share the key space by construction. The Phase 3
`isStaged` hazard (*"derived from the working set alone stays true forever after
Apply"*, listed High severity) is answered structurally here: staged-ness is
`committed[key] !== staged[key]`, a comparison between graphs, not a flag.

---

## §4 · Parent / child rules

1. **A node's operands are its children.** Ordering is significant and MUST be
   deterministic — it drives render order and any digest computed over the graph.
2. **Non-terminal nodes have ≥ 1 operand.** A non-terminal with none is a
   defect, not an empty state.
3. **Terminals have none.** `origin`, `override`, `flagged-out`.
4. **Every root-to-leaf path terminates in a terminal.** No path may end in a
   derived number. R10 load-bearing item 2.
5. **The graph is acyclic.** Shared operands (a firm markup setting used by many
   nodes) are permitted, so it is formally a DAG. Terminals may be shared;
   **arithmetic nodes may not**, or reconciliation double-counts.
6. **`resolution` children are candidates, not operands.** They are alternatives,
   exactly one of which is `chosen`. They do not sum, and reconciliation does not
   apply.
7. **`override` retains the superseded chain** under a distinct field
   (`superseded`), not as an operand. It is shown and demoted; it is not part of
   the arithmetic.

**Naming.** "Tree" is the brief's word and is right for how the trace *reads* —
one chain, one path, unbounded depth. The artifact is a DAG. Where the two
diverge (rule 5), the DAG governs.

---

## §5 · Required metadata

### 5.1 · Every node

| Field | Requirement |
|---|---|
| `key` | §3. Deterministic, stable, unique within an evaluation |
| `kind` | one of the ten |
| `label` | what this node *is*, self-describing (R10 §4.3) |
| `value` | unrounded. §5.3 |
| `unit` | currency, percent, count — never inferred from magnitude |
| `op` | the operation, as displayed. **Absent only on terminals** |
| `operands` | ordered; empty on terminals |

**`op` is not optional on non-terminals.** R10 load-bearing item 1: *"Operation,
never operands alone. Deleting the operation line turns this back into a
breakdown."*

### 5.2 · Kind-specific

| Kind | Additional |
|---|---|
| `resolution` | `candidates[]` with per-candidate availability + reason; `chosen` |
| `origin` | `actor`, `when`, and `grade` (§6.2); `doc` and `note` where they exist |
| `override` | `actor`, `when`, `superseded` |
| `flagged-out` | `reason` — why this input is excluded |
| `blend` | the weights used, so the weighted mean is checkable |
| any | `note` — optional; `warn` variant for provisional nodes (Bulk Raw, F8) |

### 5.3 · Values are unrounded

R10 §3 and load-bearing item 6. Rounding occurs at the NetSuite boundary only.
A rounded graph fails its own reconciliation assertions, and an assertion that
can fail silently is worse than none — it teaches operators the explanation is
decorative.

Presentation rounds. **The graph does not.**

### 5.4 · Namespace discipline

Per F2's cleared item: `node.kind` and `reason.kind` are different vocabularies.
Any implementation MUST NOT type them as one union. A shared type here would
typecheck a `reason.kind` into a node and produce a node kind that renders as
nothing.

---

## §6 · Provenance requirements

### 6.1 · The stopping rule

> **You stop when you reach a person.**

Every chain terminates in `origin` (a person entered this), `override` (a person
set this price), or `flagged-out` (a person's configuration excluded this). Never
in another derived number, and never in an absence.

### 6.2 · Two grades, neither deficient

Per R11 §11.1, confirmed against the data:

| Grade | Closing line |
|---|---|
| **Sourced** — packaging | *end of chain · entered from a supplier source* |
| **Thin** — everything else | *end of chain · a person set this figure; no source document is recorded* |

The thin grade is **not** styled as broken: no empty document slot, no "missing
source" placeholder. It states the absence once, factually.

**This is the same two-grade discipline Gate 1A implemented for actor identity**
(`isFallbackActorIdentity` distinguishes a sourced display name from
`Unnamed user (…)`). The rule is identical and should be shared, not
re-implemented: a thin terminal must never be rendered as a full one, because
that silently upgrades provenance.

### 6.3 · The unresolved half — input-type → audit-row mapping

Gate 1A guarantees that *if* you can identify the audit row for an input, it
carries a durable actor. It does **not** provide the mapping from an input to its
row.

An `origin` node for a packaging unit cost needs the row that last set *that
cell*. Today that means locating an `assembly_leaf_input_cell_updated` row by
`entity_id` and interpreting `diff_json` — a query nobody has written, whose cost
at graph scale is unmeasured, and which has no index designed for it.

**Consequences if unresolved.** R10 §7.2 is unambiguous: *"If no such record
exists for a given input, that input cannot terminate a chain — and that's a
finding, not a design problem to route around."*

Three inputs to check specifically, because they are set outside the per-cell
edit path and may have no per-input record at all:

- firm markup settings — versioned via `firm_settings`, actor on the version row
- markup category defaults — `markup_defaults`, text PK, audited per §"audit_log.entity_id is text"
- values written by fixtures or migrations rather than by a person

§15 A-2. This is the largest genuinely-unknown item in the gate.

### 6.4 · Provenance is read, never computed

Origin metadata is a projection of the audit trail. The graph MUST NOT synthesise
an actor, infer a timestamp, or default a document. Gate 1A's fail-closed rule
applies: an unattributable terminal is a finding, not a value to fill in.

---

## §7 · Traversal guarantees

An implementation MUST be able to assert all of the following over any emitted
graph, and a violation MUST fail loudly rather than render:

1. **Acyclic.**
2. **Well-formed** — §4 rules 2, 3, 4.
3. **Reconciling.** Every arithmetic node's operands reproduce its value within
   epsilon. R11 load-bearing item 13 extends this beyond `sum`: *"A node that
   shows an operation and asserts nothing is the R6 failure in miniature."*
   `blend` asserts **averaging**, not summing (R11 §7c) — a `Recon` that only
   handles `sum` leaves blend nodes silently unasserted, which was a real R10
   defect.
4. **Terminating** — every path reaches a terminal.
5. **Keys unique** within an evaluation, and **deterministic** across runs of the
   same input (§3.1). Testable directly: compute twice, compare key sets.
6. **Projections agree with the graph.** Every scalar in `QuoteCostingResult`
   equals the value of its corresponding node. This is the assertion that makes
   §0's guarantee mechanical rather than aspirational (§11.2).

**Epsilon.** Phase 3 already records a floor-comparison defect where
`m >= floor` reported `0.2499999…` as breaching. Reconciliation needs a stated
tolerance, and it must be the *same* tolerance the compliance comparison uses, or
a cell can reconcile and breach on the same numbers. §15 A-3.

---

## §8 · Consumer contracts

### 8.1 · The rule

> **Consumers read nodes. Consumers do not compute commercial values.**

A consumer may: traverse, filter, transpose, aggregate for display *presentation*
(rounding, formatting, ordering), and read metadata.

A consumer may not: apply a markup, divide by a quantity, blend across SKUs,
apply an adjustment, or derive a margin. If a consumer needs a value that is not
a node, **the answer is a new node, not a local calculation.** That is the same
discipline as CLAUDE.md's *"identify the primitive; don't re-derive it in the
display"*, which was banked after this exact failure.

### 8.2 · The projections

| Consumer | Projection |
|---|---|
| **Cost stack** | level 1, transposed — sections as rows, tiers as columns (R10 §10.1) |
| **Pricing trace** | levels 1..n, nested — one cell, unbounded depth |
| **Compliance grid + banner** | `evaluateCells()` over the graph (§12) |
| **Diagnostics** | traversal assertions from §7, surfaced |
| **Publication** | §14 |
| **Future explanation surfaces** | same graph; no new derivation |

The stack and the trace are **one contract with two projections** — *"horizontal
breadth at fixed depth; vertical depth at fixed breadth"* (R10 §10.1). Entry-at-node
composes them: *"the horizontal view chooses the node. The vertical view explains
it."*

### 8.3 · Enforcing 8.1 against F3

The rule cannot be enforced until existing violations are classified. Proposed
sequence, **not** to be executed in Gate 1B:

1. **Inventory** every site that applies commercial arithmetic outside
   `costing.ts` (F3 is the start, not the whole list).
2. **Classify** each as *duplicate* (the engine already computes this — must
   become a node read) or *preview* (a value the engine has not computed for a
   state that does not exist yet).
3. **Previews are the interesting case.** Phase 3 answers it: staged values come
   from a *second full engine run*, not from local arithmetic. A preview computed
   locally is a duplicate wearing a disguise.
4. Only then a verifier, in the shape of `audit-single-writer.ts` — which is
   worth stating precisely: that guard works because it bans an *unambiguous
   syntactic form* (`insert(auditLog)`). "Commercial arithmetic" has no such form.
   A grep for `* (1 +` would flag legitimate presentation code and miss a helper
   called `applyMarkup`. **A verifier here is harder than Gate 1A's and should
   not be assumed to be a like-for-like.**

---

## §9 · Node ownership

**The engine owns construction. Nothing else constructs nodes.**

- Nodes are built where the arithmetic happens — inside the engine, at the point
  the value is produced. A node built anywhere else is a re-derivation with extra
  steps.
- **The scalar rollups become projections of the graph, not siblings of it.**
  If the engine emits both independently, they can disagree, which is the failure
  this gate exists to remove. §7 guarantee 6 is the assertion; making rollups
  *derive from* nodes is the structure that makes the assertion hold by
  construction rather than by test.
- Consumers hold references, never copies with edits. A mutated node is a
  divergent value with the original's identity.

**Not yet decided:** whether the graph builder lives inside `costing.ts` or in a
sibling module the engine calls. `costing.ts` is 1,974 lines before any of this.
Both are compatible with §9; it is a code-organisation decision for
implementation, and it is not load-bearing provided construction stays inside the
engine's own traversal.

---

## §10 · Serialization

### 10.1 · Not required for the live path

The graph is computed per evaluation. Pricing, Costs, compliance and the trace
all read a graph that was just built. **No persistence is required for any Phase
3 surface**, and none should be added speculatively.

### 10.2 · Required if publication freezes it

§14. This is where serialization becomes a real question, and where it collides
with OD-012.

### 10.3 · If it is serialized

- **The format is versioned.** A graph read back by a newer engine must be
  identifiable as having been produced by an older one.
- **Deterministic ordering** (§4.1) so a digest over the graph is stable — the
  same discipline that made the Gate 1A digests meaningful.
- **Terminals serialize their provenance by value**, not as a reference to an
  audit row. A frozen graph whose terminals resolve through a live join is
  exactly the Gate 1A failure mode reintroduced one layer up: the trace would
  change when someone edits history. This is Pattern 52 applied to provenance.

---

## §11 · Interaction with `computeQuoteCosting`

### 11.1 · The engine emits the graph

Per F4, the values exist and the structure is discarded. The change is to retain
and emit it.

Per F9, this is additive to the output surface and changes no arithmetic — an
interpretation of Phase 3's "read-only" that **requires ratification** (§15 A-1).

### 11.2 · Rollups derive from nodes

`QuoteCostingResult` keeps its current shape. Every consumer of it keeps working.
But each scalar becomes a read of a node value rather than a separately-accumulated
total, and §7 guarantee 6 asserts the correspondence.

**This is the part that carries regression risk**, and it is worth being blunt
about: it touches every number the application displays. The mitigation is the one
Gate 1A used — a full-output digest over a representative quote set, captured
before the change and required identical after. The engine has a verifier
precedent (`scripts/verify/costing-adapter.ts`) and a margin-curve check from
Slice 11.5 Step 6 to build on.

### 11.3 · What must not change

The adapter contract. CLAUDE.md: *"the math layer consumes `QuoteCostingInput` as
data, not table references"*, and future cost-data migrations change the adapter,
never the math. The graph is emitted from the same input; it introduces no new
table coupling.

---

## §12 · Interaction with `evaluateCells()`

`evaluateCells()` does not exist (F1). It is specified here rather than
integrated with.

**Contract:** given a graph, return the per-cell compliance evaluation for every
`(commercial attachment, tier)` — margin, status against target and floor, and
the cell's identity. The banner's verdict is `verdictFrom(ev)` over that same
result. Phase 3 §9: *"Structural, not a convention two surfaces are asked to
honour."*

Three requirements follow:

1. **Margin comes from nodes.** `(sell − cost) ÷ sell` where all three are node
   values. Not recomputed from rollup scalars — that is §8.1.
2. **One evaluation, two readers.** The banner and the grid read one call. Two
   calls with the same arguments would be correct today and drift the first time
   one caller passes a different threshold.
3. **Classification never alters price.** Both data-source maps state this twice.
   `evaluateCells` reads the graph; it does not write to it.

**Pattern 50 applies directly.** *"Compliance-basis intersection state"* was
banked from this exact surface: the classifier evaluated per-cell while the
suggestion engine evaluated per-tier-blend, and cases where the two bases
disagreed were a real state that neither modelled. A single graph removes the
*value* disagreement. It does **not** remove the *basis* disagreement — per-cell
and per-tier-blend remain different questions with different answers, and
`evaluateCells` must not be assumed to have dissolved Pattern 50 just because
both readers now share a source.

---

## §13 · Interaction with the Surgical Lift

### 13.1 · The lift is an `adjustment` node

R11 §11.2: it composes rather than replaces, and *"no tenth node kind was needed
— the operation shape already existed."*

```
computed_sell = sell_before_adjustment × (1 + A) × (1 + lift)
                                          A = tier ?? global   ← replaces
                                                                 lift ← composes
```

It is **not** a rung in the `tier ?? global` resolution ladder. Rendering it as
one would present a composing lever as an alternative — the opposite of what it
does.

### 13.2 · Every lever owes the stack a row

R11 §11.2, stated as general law and marked load-bearing:

> **Every lever that can change a quoted price owes the cost stack a row.** If it
> cannot be shown as a row, the stack cannot assert reconciliation, and the
> assertion is what makes the stack trustworthy.

This is a **constraint on the graph, not on the UI.** A lever that changes price
without producing a node cannot produce a row, so the requirement lands here: the
lift is a node, and so is every future lever.

### 13.3 · Override conflict rejects

A lift over an override would silently overturn a deliberate human decision. The
lift is **rejected with a route** naming the person and date — which is a read of
the `override` node's provenance, now durable per Gate 1A.

### 13.4 · Identity resolution — fails closed

Phase 3 §1a: lifts persist against `quote_leaf_id`; costing inputs may still be
keyed through legacy grouped-membership identity. Every read, preview, apply and
removal must resolve the mapping and prove Quote / Product / LEAF / quantity /
position parity. **Missing, duplicate, cross-quote or drifting mappings fail
closed.** No resolution through reusable `leaf_id` or inferred tuple matching.

The graph inherits this: a lift node whose attachment cannot be resolved is a
failed evaluation, not a node with a missing operand.

### 13.5 · **STOP — schema**

The lift table does not exist (F6). It is a schema addition.

Per the standing instruction: **this specification stops here and cites
`docs/OPEN_DECISIONS.md` OD-012.** No migration is authored. `db:generate` is
unsafe until the snapshot lineage is repaired, and the settling condition is a
`drizzle-kit pull` producing an empty diff against `schema.ts`.

Specification of the lift's *behaviour* (13.1–13.4) is unblocked and complete.
Only its persistence is blocked.

---

## §14 · Interaction with Publication

**Specified against an interpretation, because no authority document exists (F7).**

Reading `quote_snapshots` as the publication mechanism — versioned, superseded-chained,
bound to a sent quote — three questions follow, and each has a real consequence:

1. **Is the graph frozen at publication, or recomputed on read?**
   Frozen means a sent quote can always explain itself exactly as sent, and means
   serialization (§10.3). Recomputed means a sent quote's explanation drifts with
   the engine, which for an artifact a customer holds is a defect rather than a
   trade-off.

2. **If frozen, at what granularity?** The full graph is large. The alternative —
   freezing terminals and re-deriving arithmetic — is *not* equivalent: it
   reintroduces the divergence in §0 across a version boundary, where it is
   hardest to detect.

3. **What is the relationship to Pattern 52?** Reproducibility for the existing
   freeze-list columns is held by the draft-lock convention plus `assertNotFrozen`,
   with `pdf_url` as a partial mitigation. A frozen graph would be a *stronger*
   guarantee than any current column has — worth having, and worth not assuming.

**Constraint that holds regardless:** the customer-facing surface is
**structurally excluded** from the trace (R10 §6.9, both data-source maps, Phase 3
Out of Scope). Enforcement is a build-time assertion on the customer subtree,
identical in mechanism to the existing boundary guard — *"not a runtime prop. If
the trace component can be mounted in a customer surface with internal operands
reachable, that is a defect regardless of the props passed."*

Pattern 51 governs the shape: the forward sweep covers the render tree; the
composition seam that projects customer-safe data is legitimately excluded, and
the guarantee is on the seam's **output type**.

**If publication requires persisting the graph, that is a schema change → OD-012
→ stop.** §14 therefore cannot be closed in Gate 1B. It requires an authority
document first (§15 A-5).

---

## §15 · What must be settled before implementation

Ordered by what blocks the most.

| # | Item | Owner | What settles it |
|---|---|---|---|
| ~~**A-1**~~ | **ACCEPTED 2026-08-06.** Read-only governs business arithmetic; returning computation structure does not violate it | — | Recorded as `PHASE-3-PRICING-WORKSPACE.md` Amendment A-1. See §18 |
| **A-2** | `origin` provenance: input type → audit row mapping | Nexus engineering, then Edward | A written query per input type, proven against production, with the cost measured. Inputs with no record are a finding (F5, §6.3) |
| **A-3** | Reconciliation epsilon, and whether it equals the compliance epsilon | Nexus engineering | One stated tolerance used by both, or an explicit reason they differ (§7) |
| **A-4** | Do node keys survive structural edits? | Nexus engineering | Determines whether staged deltas outlive a cost-structure change (§3.2) |
| **A-5** | Publication: authority document | Edward + CA | Gate 4.5 needs a specification before §14 can be closed (F7) |
| ~~**A-6**~~ | **COMPLETE 2026-08-06.** See [`gate-1b-derivation-inventory.md`](gate-1b-derivation-inventory.md) — 1 design error, 6 duplicates, 2 previews, 1 solver, 1 boundary case, 0 compatibility paths | — | Dispositions proposed; each needs confirming before code changes |
| **A-7** | Bulk Raw representation | Business Validation | Carried from R10 §7.3 / R11 §10 (F8) |
| **A-8** | Node vocabulary is **ten**, not nine | Edward + CA | Confirm F2 and correct the phase specification, or state why `flagged-out` is excluded |
| ~~**A-9**~~ | **RECORDED 2026-08-06.** Removed from the preserved list; promoted to the single workflow authority | — | `PHASE-3-PRICING-WORKSPACE.md` Amendment A-9. See §19 |
| **A-10** | Specialise the shared nav banner for Pricing, or promote it for all surfaces? | Edward + CA | Other surfaces depend on its current three-state contract (§17.1.3) |
| ~~**A-11**~~ | **SETTLED 2026-08-07.** The commercial SKU for Pricing aggregation is the quote-scoped leaf attachment, `quote_leaves.id`. Population boundary corrected; two findings opened as OD-016 / OD-017 | — | [`gate-1b-od-014-sku-identity.md`](gate-1b-od-014-sku-identity.md) |
| **A-12** | Increment 7 needs a fixture matching real nested structure, asserting contributor **population**, not only the resulting number | Nexus engineering | A corrupted-population case that fails. See [OD-015](OPEN_DECISIONS.md) |

### Blocked on OD-012, not on analysis

- The surgical lift table (§13.5)
- Any graph persistence for publication (§14)

Both are specified behaviourally and blocked only at persistence. Per the
standing instruction, migration tooling is resolved first.

---

## §16 · What this gate deliberately does not decide

- **Where the graph builder lives in the file tree** (§9) — implementation
  organisation, not contract.
- **Render treatment** — R10/R11/R12 govern; this document does not restate them.
- **Whether Costs adopts the graph before or after Pricing.** R10 §9 leans Costs
  first, since it shares operands. It is a sequencing call, and it does not change
  the contract either way.
- **Performance.** The graph is larger than the scalars it replaces. No claim is
  made here about whether that matters; A-2's provenance queries are the more
  likely cost and should be measured first.

---

# §17 · Pricing page element classification

**Added on Edward's instruction (2026-08-06):** the existing page is not a thing
to reproduce. Every element is classified against recovered Phase 3 authority,
not carried forward because it exists.

Classification is **Keep** · **Keep but redesign** · **Remove** · **Replace**.
Concepts are preserved where still valid; layout and interaction patterns are
preserved only where they still support the governed workflow.

## 17.0 · A conflict to settle first

Phase 3 §8 "The page boundary" lists five elements as **"Preserved from
production, untouched"** — scenario context · *"Tune price & review"* and its
state line · **Your next move CTA** · SENDABLE badge and verdict · *"What you're
sending"*.

Edward's instruction requires Your Next Move to **change** — from banner to
engine-driven decision surface. That is a direct amendment to a line Phase 3
marks untouched.

**Recorded as an amendment, not applied silently** (§15 A-9). The classification
below follows the instruction; the phase specification needs the corresponding
edit, or the two documents will disagree the first time someone builds from
Phase 3 alone.

## 17.1 · Your Next Move — Keep but redesign

**The concept survives and is promoted.** It is the primary workflow concept: the
engine-driven statement of what the PM must do next.

**One correction to the premise, from the code.** It is not a static banner
today. `pricing-page-head.tsx:180` already drives `label`, `href` and `helpText`
from `recommendedOrPrimary` — the classifier's recommended or primary action —
including specific recovery copy for `suggestion_infeasible` and
`suggestion_manual_only`. The gap is narrower than "static to dynamic", and it is
a different gap in three ways.

### 1 · Three surfaces currently compete to state the next action

The evidence is that the shell deduplicates between them **by hand**:

- `preview_pdf` is filtered out of the action list *everywhere*, because the
  banner already shows it — *"Duplicating it as a middle-page action card was
  confusing PMs"*
- in `suggestion_led` mode the recommended action is filtered out of the action
  list, because `SuggestionCard` is the recommended-action surface — so PMs see
  *"ONE ★ marker per render"*

That filtering is the design finding. It is not a bug being worked around; it is
three next-action surfaces held apart manually. **The redesign is to collapse
them into one**, not to make an already-dynamic banner more dynamic.

### 2 · It is driven by the classifier, which is not the graph

Per Pattern 50, the classifier evaluates per-cell while the suggestion engine
evaluates per-tier-blend, and their disagreement was a real state that required
a named `suggestion_manual_only` mode to model. Under §12 both read one
evaluation over one graph — so the redesigned surface states a decision derived
from the same artifact the grid and stack display, and **cannot recommend an
action that contradicts what the page shows**.

Worth stating plainly, because it is the whole reason this element belongs in a
node-tree gate: a decision surface is only as trustworthy as the agreement
between what it recommends and what the operator can see.

### 3 · It is a shared nav primitive

`src/components/nav/your-next-move-banner.tsx` serves every surface with three
states (`default` · `gated` · `terminal`). Promoting it to Pricing's decision
surface means either specialising it for Pricing or promoting the generic one —
a decision, not a detail, because other surfaces depend on its current contract.
§15 A-10.

## 17.2 · Element by element

| Element | Classification | Reasoning |
|---|---|---|
| **Nav shell** — outer rail, inner rail, breadcrumb | **Keep** | Surface-render rules; not Pricing's to change |
| **Eyebrow + scenario context** | **Keep** | Phase 3 §8 preserved. Identifies *which* quote — orthogonal to the pricing workflow |
| **"Tune price & review" + page sub** | **Keep** | Phase 3 §8 preserved |
| **Your Next Move banner** | **Keep but redesign** | §17.1 |
| **State line** (always visible) | **Keep** | Phase 3 §8 preserves it explicitly. Should read the single evaluation (§12) |
| **StateCallout** (suggestion_led) | **Replace** | Folds into the redesigned decision surface. A second callout beside it is the duplication being removed |
| **StateCard** (blocked) | **Replace** | Same. Blocked *is* a next-move statement — it belongs in the surface that states next moves |
| **SendableSummary** ("What you're sending") | **Keep** | Phase 3 §8 preserved, named verbatim |
| **ActionCard list** (`psr-actions`) | **Replace** | The hand-filtering in §17.1 is evidence it cannot coexist with a promoted decision surface. Ranked actions remain a concept; a parallel card list does not |
| **SuggestionCard** | **Keep but redesign** | The *suggestion* is load-bearing and stays. Its status as a second recommended-action surface does not — the ★-dedup filter exists only because of it |
| **AcceptRiskBanner** | **Keep** | Conditional risk acknowledgement; a distinct concept from "next move" |
| **`Show pricing detail` toggle** | **Remove** | Phase 3 §8, unambiguous: *"removed as a control. Not re-ordered — removed. The detail is the page."* |
| **Global price adjustment** panel | **Keep but redesign** | Concept survives. Phase 3 §2 stages it, §3 shows transient deltas, R11 §6 requires Preview to state which tiers it will **not** reach and why. Today it previews without stating holds |
| **Per-tier compliance** table | **Replace** | Phase 3 §5 is per-**cell**: margin by cell, every SKU × tier; colour to state, badge to history, marker channel reserved for Phase 4. R11 §12 merges the tier-level and per-SKU reads into one grid |
| **Cost stack** | **Keep but redesign** | Load-bearing, and gains status: trace level 1 transposed (R10 §10.1), the trace's navigator via entry-at-node, plus new rows for **PM overrides** (R11 §4) and **surgical lifts** (R11 §11.2). Must read nodes, not recompute (§8.1) |
| **Per-SKU breakdown** | **Replace** | Merges into the per-cell grid per R11 §12.2 — *"one grid, two jobs."* Per-SKU stacks survive *inside* the merged grid, not as a separate section |
| **Reference** tiles (client benchmark) | **Keep but redesign** | Phase 3 §7: benchmark stated **once per SKU row**, headroom **per cell**; own channel, never colours a cell, never reaches the verdict. Tiles become row and cell annotation |
| *(absent)* **Pricing trace** | **New** | Phase 3 §6. Ten node kinds, entry-at-node, reconciliation asserted at every level |
| *(absent)* **Surgical lift control** | **New** | Phase 3 §1 / R11 §11.2 — at the breach, inside the compliance cell that reports it; **absent from the page entirely when every tier clears the floor** |
| *(absent)* **Staging + Apply / Reset** | **New** | Phase 3 §2 |
| *(absent)* **Transient deltas** | **New** | Phase 3 §3 |
| *(absent)* **Undo at both scopes** | **New** | Phase 3 §4 |

## 17.3 · What the classification implies

**Five Replace, one Remove, five New.** That is a rebuild below the banner —
which is what Phase 3 already says in its Repository Dependencies: *"Pricing page
route and components: replaced below the banner"*, *"Banner components: preserved
untouched"*.

So the classification and the phase specification agree on scope and disagree on
exactly one element: the banner (§17.0).

**The concepts that survive** are the ones the graph makes coherent — next move,
state, cost stack, adjustment, benchmark, sendability.

**The patterns that do not survive** are the ones that exist to hold duplicated
surfaces apart: the action card list, the mode-specific callouts, the detail
toggle, the tier-versus-SKU split.

That is not a coincidence, and it is the strongest argument for doing the graph
first. Each of those patterns is a workaround for two surfaces stating the same
thing from different sources — the same failure §0 describes at the value level,
surfacing again at the interaction level.

---

# §18 · Preserve, don't rebuild — promoted

**Disposition, Edward 2026-08-06:** *"The review establishes that
`computeQuoteCosting` already computes the required structure and discards it.
This materially changes implementation scope. Gate 1B should preserve and expose
the existing computation graph rather than constructing a parallel
representation."*

This is now the scope position, not a finding. It changes three things.

**1 · The work is retention, not construction.** F4 established that the
operations and operands already exist as intermediate locals inside
`computeLeafPerTier` and `rollUpAssemblyPerTier`. The engine stops discarding
them. It does not learn to produce them.

**2 · A parallel builder is prohibited, not merely discouraged.** A second
traversal that reproduces the engine's values is the divergence in §0 with extra
steps: correct on the day it is written, silently wrong after the first refactor
of either side. There is no version of "build the graph separately and assert
they match" that is safer than emitting once — the assertion catches drift after
it has shipped, and only where a test looks.

**3 · The scalars become projections** (§9, §11.2). This is what makes §7
guarantee 6 hold by construction rather than by test. A test that says two
independently-produced numbers agree is weaker than a structure in which there is
only one number.

**What this does not license.** Retention is not licence to reshape. No existing
value changes; the assertion that every `QuoteCostingResult` scalar equals its
node's value is the boundary between exposing structure and altering the engine
(Amendment A-1).

---

# §19 · Workflow authority

**Disposition, Edward 2026-08-06:** *"The problem is not the 'Your Next Move'
component itself. The problem is multiple independent workflow surfaces. Gate 1B
should establish one workflow authority that all presentation surfaces consume."*

## 19.1 · The contract

> **One workflow authority computes what the operator must do next. Every
> presentation surface consumes it. No surface derives a next action
> independently.**

This is the same contract as §0, one layer up. §0 removes disagreement about
*what a number is*; §19 removes disagreement about *what to do about it*. The
failures rhyme because they are the same failure: two producers under one label.

## 19.2 · What it replaces

Three surfaces currently state the next action, held apart by hand:

| Surface | States |
|---|---|
| `YourNextMoveBanner` via `pricing-page-head.tsx:180` | classifier's recommended-or-primary action |
| `ActionCard` list (`psr-actions`) | ranked actions, **minus** `preview_pdf`, **minus** the recommended action in `suggestion_led` |
| `SuggestionCard` | the recommended action, in `suggestion_led` only |

The exclusions are the evidence. `preview_pdf` is filtered *everywhere* because
the banner shows it; the recommended action is filtered in `suggestion_led`
because `SuggestionCard` shows it — *"ONE ★ marker per render"*. Neither filter
is a bug being worked around. Both are load-bearing corrections for a structure
that produces the same statement three times.

**Manual deduplication is the tell.** When code exists whose only job is to stop
two surfaces saying the same thing, the surfaces are the defect.

## 19.3 · Required properties

1. **One producer.** The authority is computed once per evaluation and consumed.
   A surface may filter or format; it may not decide.
2. **It reads the same evaluation the page displays** (§12). An authority that
   recommends an action contradicting what the operator can see is worse than
   none — the operator now has to decide which of the two to believe, which is
   the judgement the surface exists to remove.
3. **It states its reason, and the reason is data.** R11 load-bearing 14: *"a
   warning must carry a reason"*, `null` when there isn't one. R11 17: copy is
   generated from the data, including closing agreement and n-item list joining —
   `joinClauses()` is correct at every n, so the next lever cannot break it.
4. **It states what it will not reach.** R11 §6 / load-bearing 12: an action whose
   effect is partly invisible at the moment of taking it is the failure this
   exists to remove. *"T3 is on its own 4% adjustment, set by Maya Okafor on Jul 2,
   and is unaffected."*
5. **It carries its own route** (Phase 3 §9). Not sendable names the tiers, and
   the CTA scrolls to them. State on screen without the means to act on it is the
   half-fix the house rule prohibits.
6. **Ranking survives; the parallel list does not.** More than one action can be
   available. One authority ranks them; one surface presents them.

## 19.4 · Relationship to the node graph

The authority is a **consumer** (§8.2), not a peer. It reads the graph through
`evaluateCells()` and adds no arithmetic. Where it needs a value the graph does
not carry, the answer is a node (§8.1) — the same rule that governs the stack and
the trace.

**Pattern 50 still applies and is not dissolved by this.** Per-cell and
per-tier-blend remain different questions with different answers; a single graph
removes the *value* disagreement, not the *basis* disagreement. The authority
must name which basis it is speaking from, exactly as `suggestion_manual_only`
had to be named rather than collapsed.

## 19.5 · Open

**A-10** — `your-next-move-banner.tsx` is a shared primitive serving every surface
with three states (`default` · `gated` · `terminal`). Specialising it for Pricing
or promoting the generic one is a decision, because the other surfaces depend on
its current contract. Not a Gate 1B call to make alone.

---

# §20 · Implementation assumption register

Per Edward's instruction that remaining assumptions be **explicitly classified**
rather than discovered during implementation. Each is stated as a claim, with
what it would cost to be wrong.

| # | Assumption | Class | If wrong |
|---|---|---|---|
| **S-1** | The engine's intermediate locals are complete enough to emit every node without new arithmetic | **Verifiable now** — read `computeLeafPerTier` and `rollUpAssemblyPerTier` against §2's ten kinds | Some kinds need values the engine does not currently form. Changes A-1's boundary: forming a new value *is* changing the arithmetic |
| **S-2** | Deterministic keys can be built from durable identifiers alone (§3.1) | **Verifiable now** — check every node site has `quote_leaf_id` / `tier_id` / `line_group_id` in scope | Keys fall back to positional data, which breaks staged-vs-committed diffing (§3.3) |
| **S-3** | Emitting the graph does not materially change engine cost | **Requires measurement** | Pricing and Costs page loads regress. The engine already runs inside an 8-wide `Promise.all` with a pool of 3 (CLAUDE.md pooler discipline) |
| **S-4** | Provenance can be resolved per input without a query per node | **Unknown — A-2** | An N-node graph becomes N queries. This is the most likely performance failure and is untested |
| **S-5** | Per-`(shipment, tier)` and per-`(line, tier)` nodes are derivable from current engine inputs | **Verifiable now** — required by the inventory §3.2 | The drilldown duplicates cannot be eliminated without an adapter change |
| **S-6** | One evaluation serves banner, grid, stack and trace without per-consumer thresholds | **Verifiable now** — check every current threshold read | `evaluateCells` grows parameters, and two callers with different parameters is Pattern 50 again |
| **S-7** | Rollups can derive from nodes with no output change | **Requires a digest** — capture before, require identical after | Silent commercial drift across every surface. Highest blast radius in the gate |
| **S-8** | The customer tree needs no graph access, only projected values | **Verifiable now** — inventory §3.4 | The boundary guard and the graph are in direct tension, and the guard wins |
| **S-9** | Staged evaluation is a second full engine run, not an incremental update | **Stated by Phase 3 §3**, unverified at cost | If a full second run is too slow, the pressure is to compute deltas locally — which is the duplicate-wearing-a-disguise the inventory names |
| **S-10** | Ten node kinds are sufficient for Phase 4 approval | **Unknown** — Phase 4 not yet specified against the graph | A kind is added later. Acceptable if it is a decision; a defect if it is discovered mid-build |

**S-1, S-2, S-5, S-6, S-8 are answerable by reading code and should be settled
before any implementation begins.** S-3, S-4, S-7, S-9 need measurement or a
digest. S-10 is genuinely open and depends on Phase 4.
