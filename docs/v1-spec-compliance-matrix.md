# V1 · SPEC compliance matrix

**Complete.** Every row below has been examined or explicitly classified. No row
is blank and no row carries a hedge.

**Baseline:** `main` @ `024d2316f5881601a7a408ed8f2e79c9a3d1cf82`, and the
document revisions frozen in
[`v1-spec-compliance-audit.md`](v1-spec-compliance-audit.md). Method, verdict
convention, two-axis model and ID scheme are frozen there and are not restated.

**Nature:** release-risk discovery. **No row proposes an implementation.**

**Status: accepted 2026-08-10. This matrix is the governing release artifact.**
Release work runs from the **seven distinct blockers** on the
[V1 Release Blocker Board](v1-release-blocker-board.md), not from the finding
count. **Completed rows are not reopened.** Closing a blocker amends only the
affected rows — the matrix is never re-run, and an amended row keeps its ID.

---

## Result

**139 rows.** 136 from the audit, plus **P3-016**, **AM-005** and **P3-017** added 2026-08-10 after it
closed — a new row under append-only numbering, not a reopened one.

| verdict | rows |
|---|---|
| **Satisfied** | 81 |
| **Unsatisfied** | 10 |
| **Insufficient evidence** | 18 |
| **Specification drift** | 8 |
| **Out of scope** | 20 |

**Findings: 36** — every row whose verdict is not *Satisfied* or *Out of scope*.
Per the frozen convention, only findings carry a disposition:

| disposition | findings |
|---|---|
| **Release blocker** | **10 rows — 7 distinct blockers.** P3-016 repaired 2026-08-10, pending merge |
| Release recommendation | 16 |
| Post-V1 | 10 |

Nine rows carry a blocker disposition, but three of them
(**BV003-002**, **BV005-001**, **SPEC-018**) are the same gap recorded in
different governing documents and roll up to **REG-2**. Counting them
separately would triple one risk. **Six distinct blockers remained at audit
close; P3-016 makes seven.**

### The seven release blockers, by ID

| ID | |
|---|---|
| **REG-2** | Below-floor margin approval is a V1 gate with no implementation. Nothing prevents an accepted below-floor quote today |
| **REG-4** | Item Group applicability has no canonical datum; member-rate pricing is unproven against a live NetSuite |
| **OD-002** | BV-005 must be amended before Phase 4 — five business questions unanswered, so REG-2 cannot even begin |
| **OD-004** | The Item Group applicability datum — REG-4's missing input |
| **OD-005** | HubSpot Product `price` → NetSuite Base Price propagation is untested, and a `$0.00` catalogue placeholder must never become a commercial price |
| **P1-014** | An unresolved cost cannot reach NetSuite — asserted in unit tests, **never walked against a real NetSuite** |
| **P3-016** | Recommendation CTAs bypass the R12 staging contract. **A contract conflict, not a wiring defect** — the bypass is commented and unit-tested as load-bearing |
| **P3-017** | The R11/R12 Cost Stack — trace level 1 **transposed**, reconciling sections + adjustment + lifts + overrides to `Quoted sell` | **Unsatisfied** | **Implementation item** | **Added 2026-08-10; verified the same day as an incomplete implementation, not an intentional simplification.** Production renders the **R6** stack (tiers as rows; `PKG · PROD · RAW · FRT · D+T`), carried forward as a black-box dependency by the pricing-surface redesign brief — a decision that predates R11 and was never revisited when R11 superseded it. Missing: `Price adjustment`, `Surgical lifts`, `PM overrides`, `Unit cost` as its own row, and the reconciliation strip. Three of the four reconciliation terms have no row, so the assertion is **unstateable**. Conclusive evidence: `.r11-recon` is defined in `src/styles/r11-pricing-workspace.css` with **zero JSX callers**, and that stylesheet's own header states the contract the implementation contradicts. **Presentation/IA drift, not arithmetic** — the numbers shown are correct. Restore the Design Authority; do not invent a layout. **Pre-implementation gate STOPPED 2026-08-10:** the blend publishes only `sellBefore` and `sell`, so `adjDelta` / `liftDelta` / `overrideDelta` are not governed values and are not recoverable — one gap cannot be split into three addends. The per-cell graph is correct (`adjustmentNode`, `liftedNode`, override all exist); the **blend does not carry R11 §13.2 forward to tier scope**. Classified as a **reconciliation-authority defect** upstream of the layout work, which it gates. See [P3-017](validation/P3-017-cost-stack-drift.md) |

**Five of the six are the same shape:** the accounting handoff at the end of the
quote lifecycle has been specified thoroughly, implemented partially, and
verified only against an isolated provider. They are not independent risks; they
are one risk with five identifiers.

### The single most important structural finding

**AM-001 · `docs/SPEC.md` is classified Informational by the governing authority
map** — *"Product intent, not implementation authority."* This audit is named
"SPEC compliance," and the document it is named for does not govern
implementation. Every SPEC row below is therefore evaluated against intent, and
**no SPEC row can be a release blocker on its own authority.** That is a
scoping fact, established before any SPEC row was read, and it is the reason
the SPEC block is classified as it is rather than generating sixteen findings.

---

## Block REG — Production Readiness Register gates

The register's four gates are the spine. The audit verifies the claims; it does
not restate them.

| ID | Requirement | Verdict | Disposition | Evidence / basis |
|---|---|---|---|---|
| **REG-1** | Pricing Vendor identity — stable optional HubSpot Company identity + immutable name snapshot persist; legacy read-only; no NetSuite/procurement projection. Claimed **V1 COMPLETE** | **Insufficient evidence** | — | `tests/unit/pricing-vendor-contract.test.ts`; `assembly_leaf_inputs` carries the Company ID + name snapshot; BV-001 §Implementation evidence and §Closeout evidence enumerate the boundary review; VAL-104 recorded. **The one gate claiming completion, and the claim holds.** **AMENDED 2026-08-10 — the browser evidence has never reached a verdict.** VAL-104 is REG-1's browser-level evidence. It was unmeasured (VAL-101 fixture contamination), then failed on a hardcoded runId literal, and now — with that fixed — proves the identity portion (leaf name, derived SKU code, PB-006/PB-007) and stops at a disclosure that **does not exist in the DOM**. A V1 COMPLETE claim is not preserved on evidence that has never produced a verdict. See [CB Suite Health](validation/CB_SUITE_HEALTH.md) |
| **REG-2** | Below-floor margin approval — exact tier/version/economic state requires valid authorized approval; material economics invalidate; Slack failure never approves | **Unsatisfied** | **Release blocker** | No approval subsystem exists. No approver table, no request record, no Slack inbound boundary, no invalidation path. `grep` for an approval entity returns nothing in `src/db/schema.ts`. The register itself says *implementation open*, and implementation is open. **Today a below-floor quote can be accepted with no approval at all** — the gate names a control that does not exist |
| **REG-3** | Idempotent Sales Order send — one quote revision creates at most one Sales Order; response-loss and concurrency converge safely | **Insufficient evidence** | Release recommendation | Substantially implemented, contrary to the register's *implementation open*: `netsuite_so_pushes` carries `idempotencyKey NOT NULL`, `quoteSnapshotId` restrict-referenced, frozen `payloadSnapshot`, status enum; `computeIdempotencyKey` is stable per accepted sent snapshot (`sales-order-accounting-contract.test.ts:162`); completion checks prior success before create (`:171`). **What is missing is not code but proof:** convergence under real response-loss and real concurrency has never been walked against a live NetSuite. See P1-011 |
| **REG-4** | Item Group applicability and pricing — applicable completion creates/reuses one deterministic group, uses it once, preserves accepted commercial total | **Unsatisfied** | **Release blocker** | Blocked on its own inputs. OD-004 (what datum determines Item Group) is open, so applicability cannot be computed; OD-005 (member-rate pricing) is unproven live. The register records that Nexus-authored components default the HubSpot Product `price` to `0.00`, proven **only in isolated validation** — and the standing business constraint is that a `$0.00` catalogue price must never become the commercial transaction price |

---

## Block XP — cross-phase contracts and rules

| ID | Requirement | Verdict | Disposition | Evidence / basis |
|---|---|---|---|---|
| **XP-001** | **I1** · A sent Quote version resolves markups, target and floor from its pin, not `firm_settings` | **Satisfied** | — | `resolveCommercialSettingsForLifecycle`; `commercial-settings-contract.test.ts` asserts draft→live and sent/accepted/complete→pinned |
| **XP-002** | **I1** · **One canonical resolver.** Costing, compliance, trace `resolution`, banner verdict, `liftTo`, Phase 4 reproduction — all one call site | **Satisfied** | — | `commercial-settings-reachability.test.ts` walks every production costing route and asserts the lifecycle-aware resolver; `one-evaluation-authority.test.ts` records that a second predicate chain was absorbed into `classify()` rather than duplicated |
| **XP-003** | **I1** · Pin and `quote_snapshots` row **durably linked**, not merely coincident | **Satisfied** | — | `phase-1-commercial-pin-schema.test.ts` asserts `quoteSnapshotId` is `.notNull().unique()` on the pin table |
| **XP-004** | **I2** · Lifts persist against `quote_leaf_id`; every read/preview/apply/removal resolves canonical→legacy and proves Quote, Product, LEAF, quantity and position parity; failures fail closed | **Satisfied** | — | `quote_leaf_lifts` PK is `(quote_leaf_id, tier_id)`; `quoteForQuoteLeaves` fails closed on absent **and** duplicate; R2 rehearsal 137/137 both directions |
| **XP-005** | **I2** · No fallback to `assembly_leaf_id` for convenience | **Satisfied** | — | `product-structure-slice1-cutover.test.ts` requires an explicit classification comment on every file touching leaf identity; the one canonical→legacy crossing in `pricing-lifts.ts` is scoped through `quote_leaves` |
| **XP-006** | **I3** · `liftTo(threshold)` — the threshold is an argument, not `liftToFloor()` | **Satisfied** | — | `surgical-lift-node.test.ts`; `pricing-lift.test.ts`. The parameter is what makes Phase 4's corrective path a swap rather than a second control |
| **XP-007** | **I3** · X applies **per cell**, not blended | **Satisfied** | — | `pricing-lift.test.ts`; clearing every cell to X guarantees blended ≥ X |
| **XP-008** | §5 · Phase 3 reversibility — rollback after first Apply requires `DELETE FROM quote_leaf_lifts` first | **Satisfied** | — | R1 rehearsal, measured not argued: pre-Phase-3 runtime run from a worktree at `bcd6469`; outcome `ignores`; $15.93→$15.13, 25.0%→21.0%, $797.61 off the tier's NetSuite amount; 23 of 24 cells identical. The operational requirement is recorded in the map, the rehearsal and CLAUDE.md |
| **XP-009** | §8 · **The fixture rule** — fixtures derive from production contracts, never invent values | **Satisfied** | — | Pattern 53, promoted to standing after five instances; `phase-2-operator-fixtures.test.ts`; the r12Visual freight-rate re-derivation from spec flags recorded in `r12-visual-acceptance.md` |
| **XP-010** | §9 · Phase 3 prohibitions — do not reinterpret the design; do not let the trace reach Customer View; do not fall back to `assembly_leaf_id`; no fifth lifecycle guard vocabulary | **Satisfied** | — | Customer-view boundary verifier in `prebuild` (P3-012); XP-005 for identity; R10/R11/R12 adopted byte-identical to the bundle |
| **XP-011** | §5 · Phase 4 ships with a **rollback runbook**, not an assumption of reversibility | **Insufficient evidence** | Post-V1 | No runbook exists. Correctly so — Phase 4 is unimplemented. Recorded because the requirement is real and attaches to REG-2 whenever it begins |
| **XP-012** | §2 · Phase 4 requires Phase 3 as a **hard release dependency** | **Satisfied** | — | Phase 3 shipped and closed 2026-08-10; the grid, banner and staging bar Phase 4 extends all exist |

---

## Block P1 — Phase 1, Quote Commercial Integrity

Authority map: **Frozen and shipped. Binding as the record of what exists.**

| ID | Invariant | Verdict | Disposition | Evidence / basis |
|---|---|---|---|---|
| **P1-001** | H1 · A sent Quote reads pinned settings | **Satisfied** | — | `commercial-settings-contract.test.ts` |
| **P1-002** | H2 · A draft reads live settings — *the rule, not a bug* | **Satisfied** | — | same |
| **P1-003** | H3 · Sent states resolve independently across v1/v2 | **Satisfied** | — | `phase-1-commercial-pin-writer.test.ts` asserts the pin write inside both `sendQuote` and `reviseQuote` |
| **P1-004** | H4 · Null quote-scoped cost valid in draft, blocked at send before artifact/snapshot/pin/status writes | **Satisfied** | — | `quote-cost-completeness.test.ts`; `assertQuoteCostsResolved` / `UnresolvedQuoteCostsError` name attachment and tier |
| **P1-005** | H5 · A catalogue-cost edit reaches no Quote, draft included | **Satisfied** | — | `product-library-contract.test.ts`; BV-006 §Commercial Cost Model |
| **P1-006** | H6 · A HubSpot product pull reaches no attached LEAF's price | **Satisfied** | — | `product-library-contract.test.ts` exercises `pullProductsBatch` via the fake provider |
| **P1-007** | H7 · The pin round-trips rung, actor and date — not only the percentage | **Satisfied** | — | `phase-1-commercial-pin-schema.test.ts`; consumed by Phase 3's `resolution` trace node |
| **P1-008** | H8 · One resolver, one answer. No second path | **Satisfied** | — | `commercial-settings-reachability.test.ts` (see XP-002) |
| **P1-009** | H9 · Every newly sent revision has a pin | **Satisfied** | — | `phase-1-commercial-pin-writer.test.ts` |
| **P1-010** | H10 · One accepted Quote Revision produces one Sales Order | **Satisfied** | — | `sales-order-accounting-contract.test.ts:162,171`; `netsuite_so_pushes.quoteSnapshotId` |
| **P1-011** | H11 · Retry converges — repeated **or concurrent** attempts reach the same Sales Order | **Insufficient evidence** | Release recommendation | The key is stable and prior-success is checked before create. **Concurrency convergence is unproven:** no test drives two simultaneous completions, and the validation environment runs an isolated provider by construction. This is REG-3's missing proof |
| **P1-012** | H12 · Clone and revision identities do not collide | **Satisfied** | — | `quote-revision-workflow.test.ts` — revision updates in place, clone starts at Rev. 1 and cannot reuse pin, snapshot or send identity |
| **P1-013** | H13 · NetSuite-derived values never flow back as commercial authority | **Satisfied** | — | `complete-status-writer.ts` verifier; Pattern 52 freeze-list + `assertNotFrozen` |
| **P1-014** | H14 · An unresolved cost cannot reach NetSuite | **Insufficient evidence** | **Release blocker** | The unit-level half is proven (`quote-cost-completeness.test.ts`, and completion independently rejects). The half that matters commercially — that no unresolved cost reaches a **real** NetSuite — has never been walked against a live provider. Distinguished from P1-004 deliberately: send-blocking is proven, the ERP boundary is not |

---

## Block P2 — Phase 2, Costs Workspace

Authority map and README: **In progress — freight persistence accepted, design
fidelity open.**

| ID | Invariant | Verdict | Disposition | Evidence / basis |
|---|---|---|---|---|
| **P2-001** | H1 · Packaging control parity, enumerated not sampled | **Satisfied** | — | `packaging-materialization.test.ts` |
| **P2-002** | H2 · No SKU switching introduced | **Satisfied** | — | `packaging-materialization.test.ts`; `composition-boundary.test.ts` |
| **P2-003** | H3 · Packaging ownership and targeting persist across reload | **Satisfied** | — | `packaging-materialization.test.ts` |
| **P2-004** | H4 · Freight identity and cardinality; canonical `quote_leaves.id`; duplicate/missing/cross-Quote/drifting fail closed; one component in multiple legs | **Satisfied** | — | `freight-shipment-membership.test.ts`; `phase-2-freight-schema.test.ts`; `phase-2-worksheet-freight-schema.test.ts` |
| **P2-005** | H5 · Section totals unchanged in meaning | **Satisfied** | — | S-7 preservation digest `541a75a0…` over 24 production quotes, unmoved |
| **P2-006** | H6 · Costing output byte-identical — *this phase renders, it does not compute* | **Satisfied** | — | S-7, same digest across the whole of Phases 2 and 3 |
| **P2-007** | H7 · A single-SKU Quote acquires no multi-SKU chrome | **Satisfied** | — | `phase-2-operator-fixtures.test.ts` (`oneSku` fixture) |
| **P2-008** | H8 · Bulk Raw's operator surface is unreachable | **Satisfied** | — | Pattern 57 reference moment; no route renders it |
| **P2-009** | H9 · Exactly one authoritative freight markup per Quote; no leg-level markup read or write survives migration | **Satisfied** | — | `phase-2-freight-costing.test.ts`; `phase-2-worksheet-freight-costing.test.ts` |
| **P2-010** | H10 · Null component cost valid in draft, rejected at send and completion; billable freight derived never persisted; legacy and component rows cannot both contribute | **Satisfied** | — | `phase-2-worksheet-freight-completeness.test.ts`; `customer-freight-presentation.test.ts` |
| **P2-011** | H11 · Historical reproducibility — snapshots preserve entered component costs and Quote markup; clone/revision remap without sharing identities | **Satisfied** | — | `phase-2-worksheet-freight-snapshot.test.ts` |
| **P2-012** | H12 · Quote-markup movement updates every derived billable value while preserving every entered actual cost byte-for-byte | **Satisfied** | — | `phase-2-worksheet-freight-costing.test.ts` |
| **P2-013** | Design fidelity — the live gap list at `phase-2-freight-dom-parity-audit.md` (tier 2, outranks the bundle) | **Insufficient evidence** | Release recommendation | The parity audit's 13-row pass is recorded, but Phase 2 is self-reported *design fidelity open* and operator acceptance has not been recorded. Phase 2's own gate is **operator validation**, and no operator-validation record exists for it |

---

## Block P3 — Phase 3, Pricing Workspace

**Closed for implementation 2026-08-10.** Cited, not recreated.

| ID | Invariant | Verdict | Disposition | Evidence / basis |
|---|---|---|---|---|
| **P3-001** | H1 · Every sum level reconciles, unrounded; a level that does not reconcile fails loudly | **Satisfied** | — | `costing-node-reconciliation.test.ts`; `costing-node-graph.test.ts` |
| **P3-002** | H2 · Banner and grid cannot disagree | **Satisfied** | — | `one-evaluation-authority.test.ts` — requirement met by absorption into `classify()`; the test records why writing `evaluateCells()` alongside it would have created the second authority the requirement exists to prevent |
| **P3-003** | H3 · `isStaged` is a difference, not a property | **Satisfied** | — | `pricing-staging-model.test.ts:44` — *"after Apply, nothing is staged"* |
| **P3-004** | H4 · Deltas appear while staged and vanish on Apply | **Satisfied** | — | `pricing-delta.test.ts`; R3 rehearsal 8/8 |
| **P3-005** | H5 · Levers independently removable | **Satisfied** | — | `pricing-apply-plan.test.ts` |
| **P3-006** | H6 · Return to baseline is exact | **Satisfied** | — | `pricing-apply-plan.test.ts`; persistence checklist 11/11 |
| **P3-007** | H7 · An override blocks the lift, naming person and date from the audit record | **Satisfied** | — | `staged-override-resolution.test.ts`; A-2 provenance supplies actor and date |
| **P3-008** | H8 · Removing an override differs from removing a lift — returns the currently computed price | **Satisfied** | — | `staged-override-resolution.test.ts` |
| **P3-009** | H9 · Apply rejects a moved cost base — it does not commit silently | **Satisfied** | — | `pricing-cost-base.test.ts`; `costBaseFingerprint` excludes the four levers by construction, so the guard fires on cost movement and not on the operator's own staging |
| **P3-010** | H10 · The lift resolves against pinned thresholds on a sent-then-revised Quote | **Satisfied** | — | XP-001/XP-002 resolver; `pricing-lift.test.ts` |
| **P3-011** | H11 · Client target never colours a cell and never reaches the verdict | **Satisfied** | — | `compliance-grid-projection.test.ts`; r12Visual renders 8 markers in their own channel with the verdict naming it as context |
| **P3-012** | H12 · The trace is unreachable from Customer View — build-time assertion, not a prop | **Satisfied** | — | `scripts/verify/customer-view-boundary.ts` in `prebuild`; Pattern 51 records why the composition seam is excluded by design |
| **P3-013** | H13 · Identity resolution fails closed | **Satisfied** | — | XP-004; R2 137/137 |
| **P3-014** | H14 · The lift is rejected at sent and accepted via the existing draft-only guard | **Satisfied** | — | `assertDraft` in `applyPricingAdjustments`; no fifth guard vocabulary added |
| **P3-016** | The R12 interaction contract — a recommendation **stages first**; page-level Apply persists the working set | **Satisfied** | **Release blocker — REPAIRED 2026-08-10, pending merge** | **Added 2026-08-10, after the audit closed — a new row, not a reopened one.** Both recommendation CTAs wrote `quote_tiers.tier_price_adj_pct` at click time. Runtime observation confirmed it: one click moved the database, wrote an audit row, and produced no chip, no preview and no Discard. **A contract conflict, not a wiring defect** — three comments and a unit test called the bypass load-bearing. Repaired by making the per-tier adjustment a member of the staging set; `applySurgicalAdj` removed; bulk lift keeps its own governed committed-write contract. Six of eight browser proofs observed, two pinned by a new source-level guard. **Two open consequences recorded, not absorbed:** recommendation telemetry has no writer, and no test presses a recommendation CTA. See [P3-016](validation/P3-016-surgical-staging-bypass.md) |
| **AM-005** | S-7 preservation — the governing proof that no commercial number moved. **A direct instance of AM-004:** `docs/gate-1b-assumption-findings.md`, which defines S-7, is outside the audit baseline | **Unsatisfied** | **Release recommendation** | **Added 2026-08-10; investigated the same day.** `gate1b:verify-preserved` fails identically on `main`, on this branch, and with the P3-016 repair applied — **no branch work causes it**. Isolation confirmed the delta originates **solely** from one quote: covered set unchanged at 24, exactly one digest differs, and the global digest **excluding** that quote is byte-identical on both sides (`e9943ad8…`). The quote is `ZZ-VALIDATION-tier-propagation`, and its audit trail names the cause — two `pricing_suggestion_surgical` writes **727ms apart**, `null` → `0.1884` → `0.4123`, which is `1.1884² − 1`. **That is P3-016 in production:** a silent write invited a second click. So S-7 measures software and mutable production data together and cannot distinguish them. Disposition (exclude `ZZ-VALIDATION-*`, re-baseline, or freeze the basket) is Edward's. See [AM-005](validation/AM-005-s7-scope.md) |
| **P3-015** | Operator validation — *can a real user understand and complete the workflow?* Per §6, explicitly **not** folded into rehearsals | **Satisfied** | — | `phase-3-release-readiness.md` §3 walks the journey on r12Visual; `v1-customer-view-content-check.md` PASS |

---

## Block P4 — Phase 4, Margin Approval

**Not started.** Every invariant below is unimplemented. They are **not**
individually classified as blockers: the gate is REG-2, and fifteen copies of
one blocker would inflate the count without adding information. Each row is
`Out of scope` **of current implementation** and rolls up to REG-2.

| ID | Invariant | Verdict | Rolls up to |
|---|---|---|---|
| **P4-001** | H1 · A Quote awaiting approval is not sendable | **Out of scope** | → REG-2 |
| **P4-002** | H2 · Invalidation fires on any input change, naming the operand | **Out of scope** | → REG-2 |
| **P4-003** | H3 · Invalidation fires downward too — 23% reworked to 25% is not approved | **Out of scope** | → REG-2 |
| **P4-004** | H4 · Self-invalidation warns at staging, before Apply | **Out of scope** | → REG-2 |
| **P4-005** | H5 · Withdraw returns to below-floor with visible history | **Out of scope** | → REG-2 |
| **P4-006** | H6 · Rejection with a target retargets the lift | **Out of scope** | → REG-2. **The mechanism exists** — `liftTo(threshold)` per XP-006 |
| **P4-007** | H7 · X applies per cell | **Out of scope** | → REG-2. Mechanism exists per XP-007 |
| **P4-008** | H8 · An unauthorised Slack response cannot approve — *the critical invariant* | **Out of scope** | → REG-2 |
| **P4-009** | H9 · A replayed Slack response cannot approve twice | **Out of scope** | → REG-2 |
| **P4-010** | H10 · A response to a withdrawn/superseded/invalidated request cannot approve | **Out of scope** | → REG-2 |
| **P4-011** | H11 · The approval record reproduces its price from the record + pin | **Out of scope** | → REG-2. Phase 1's pin (XP-003) is the input it will need |
| **P4-012** | H12 · The approved commercial **state** invalidates, not a singular price | **Out of scope** | → REG-2 |
| **P4-013** | H12a/b/c · Revision voids; rejection never auto-becomes approval; **no request expires** | **Out of scope** | → REG-2. H12c is notable: *its absence is the specification* |
| **P4-014** | H13 · Return to baseline withdraws outstanding requests | **Out of scope** | → REG-2 |
| **P4-015** | H14/H15 · Approval never colours a cell (three channels); the trace includes approval as a terminal act | **Out of scope** | → REG-2 |

---

## Block BV — business validation contracts

| ID | Requirement | Verdict | Disposition | Evidence / basis |
|---|---|---|---|---|
| **BV001-001** | Pricing Vendor identity contract | **Satisfied** | — | See REG-1 |
| **BV003-001** | Master data ownership — governing model and lifecycle invariants | **Satisfied** | — | Field Ownership Register; `DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md` |
| **BV003-002** | The four **confirmed V1 ownership gaps**: Pricing Vendor · Item Group · durable SO send · below-floor approval | **Unsatisfied** | **Release blocker** *(rolls up)* | One of four closed (REG-1). The other three are REG-2, REG-3, REG-4. BV-003 independently corroborates the register's open gates — two documents, same three gaps, no disagreement |
| **BV003-003** | Customer Contact association *"remains unclear but is not proven to block V1"* | **Insufficient evidence** | Post-V1 | Unchanged since 2026-07-30. The document's own disposition is that it does not block |
| **BV004-001** | Business decision matrix — who decides what, when | **Satisfied** | — | Recorded decisions section; corroborated in practice by this session's disposition trail |
| **BV004-002** | *"Decisions not yet fully recorded"* | **Specification drift** | Release recommendation | BV-004 names quantities Nexus derives but left blended margin undefined — which is exactly what BV-010 was written on 2026-08-10 to repair. The section is a live acknowledgement that the matrix is incomplete |
| **BV005-001** | Below-floor approval contract — approval authority, minimum authoritative record, invalidation, Slack boundary, gate behaviour, failure/retry | **Unsatisfied** | **Release blocker** *(rolls up to REG-2)* | Approved as a contract; unimplemented. And per OD-002 the contract itself must be amended before it can be built |
| **BV006-001** | Product Structure Contract — **Frozen**. Structural invariants and implementation gate | **Satisfied** | — | `product-structure-slice1-contract.test.ts`, `-invariants`, `-compatibility`, `-cutover` |
| **BV006-002** | §Commercial Cost Model — quote-specific values belong to the quote-scoped attachment, not the reusable LEAF | **Satisfied** | — | P1-005, P1-006; `canonical-attachment-operator-boundary.test.ts` |
| **BV006-003** | §Open business questions | **Insufficient evidence** | Post-V1 | Present in a document marked **Frozen**. A frozen contract carrying open questions is a tension worth naming, not a defect |
| **BV007-001** | Product Setup workflow — governing rules, six page states, transitions | **Satisfied** | — | `product-library-contract.test.ts`; `project-v1-action-surface.test.ts` |
| **BV008-001** | Commercial product transition — business invariants, structural transitions, required operator authorization, transition integrity | **Satisfied** | — | `product-structure-slice1-*` suite; `assembly_leaf_attach` / `_detach` audit namespace |
| **BV008-002** | §Commercial selling-price requirements and §Preservation requirements | **Satisfied** | — | S-7 preservation digest is the standing proof |
| **BV009-001** | Freight treatment — **the reconstruction is explicitly NOT RATIFIED** | **Specification drift** | Release recommendation | Production code ships on this authority. Phase 1 and Phase 3 both cite BV-009 to place costing arithmetic **out of scope** — so if the reconstruction is wrong, two phase scopes rest on a rule that may not exist. Tracked as OD-001. The freight code itself is well covered (P2-004…P2-012); what is missing is the ratified rule it implements |
| **BV010-001** | Blended margin — *(Σ revenue − Σ cost) / Σ revenue*; one quantity may be called blended margin on Pricing | **Satisfied** | — | `blended-margin-authority.test.ts`; engine `blendedMarginPct` and graph `quote/{tier}/margin` agree exactly; the compliance grid's footer row reads the governed node |
| **BV-002** | Does not exist | **Out of scope** | — | Intentionally unassigned. *"Identifiers are stable and are not renumbered to close gaps."* Confirmed deliberate, not a gap |

---

## Block OD — open decisions

The audit's job here is not to re-decide them but to say **whether each blocks
V1**.

| ID | Decision | Verdict | Disposition | Basis |
|---|---|---|---|---|
| **OD-001** | BV-009 does not exist as an approved document | **Specification drift** | Release recommendation | See BV009-001 and B-2 |
| **OD-002** | BV-005 must be amended before Phase 4 — five unanswered questions (approver list, membership, self-approval, one-approval sufficiency, Slack-availability-at-launch) | **Unsatisfied** | **Release blocker** | REG-2 is a V1 gate and cannot begin until these are answered. **These are business answers, not engineering work** — which is precisely why they are on the critical path and cannot be worked around |
| **OD-003** | Phase 3 rollback after first Apply | **Satisfied** | — | **SETTLED 2026-08-10** by R1 measurement. Outcome `ignores`; operational DELETE requirement recorded in three places |
| **OD-004** | Item Group applicability datum | **Insufficient evidence** | **Release blocker** | REG-4's missing input. No datum, no applicability computation |
| **OD-005** | HubSpot Product price → NetSuite Base Price propagation | **Insufficient evidence** | **Release blocker** | Untested across the node boundary. The standing constraint — a `$0.00` catalogue price must never become the commercial transaction price — is asserted at both nodes but proven at neither, live |
| **OD-006** | NetSuite assembly structure | **Insufficient evidence** | Post-V1 | Discovery item; shapes v1.1+ architecture, not V1 correctness |
| **OD-007** | Pricing click-to-edit as accepted extension | **Satisfied** | — | Pattern 39; documented at the extension site |
| **OD-008** | Costs-page shell scope | **Insufficient evidence** | Post-V1 | Referenced by the freight parity audit as undecided; presentation scope, not commercial correctness |
| **OD-009** | Freight markup resolution when a break carries no markup | **Insufficient evidence** | Release recommendation | Needed before the relevant work starts; the Quote-level markup (P2-009) is the current single authority, so there is a defined answer today even if the edge is unresolved |
| **OD-010** | Stale publication entries awaiting F3 Stage 5 removal | **Insufficient evidence** | Post-V1 | Realtime publication hygiene. Note the 10-binding channel cap already banked in CLAUDE.md |
| **OD-011** | Order-dependent browser fixture state | **Insufficient evidence** | Post-V1 | Test-harness hygiene. Does not affect production behaviour |
| **OD-012** | Drizzle migration generation unsafe until its baseline is repaired | **Unsatisfied** | Release recommendation | Live constraint, worked around by hand-writing every migration (0063 included). **The guard exists by convention only** — nothing prevents a future `db:generate`. Not a blocker because the convention has held for every migration to date, and the failure is loud rather than silent |
| **OD-013** | S-7 depends on a mutable shared production database | **Unsatisfied** | Release recommendation | The single most-cited piece of evidence in this audit rests on a database anyone can change. It has held (digest unmoved across all of Phases 2 and 3), but its stability is circumstantial rather than structural |
| **OD-014** | What entity constitutes a commercial SKU for Pricing aggregation | **Satisfied** | — | **Closed 2026-08-07** — `quote_leaves.id` |
| **OD-015** | S-7 does not validate the semantics of graph-only nodes | **Insufficient evidence** | Release recommendation | S-7 digests six named keys of `QuoteCostingResult`. Nodes that exist only in the graph are outside it — so a graph-only node could change meaning without moving the digest. Bounded: every value a surface displays is a node, but the six digested keys are the commercially load-bearing ones |
| **OD-016** | Setup authors commercial values that nothing consumes | **Unsatisfied** | Release recommendation | An operator can enter a value that has no effect. Misleading rather than incorrect — no wrong number is produced — but it is an operator-facing trust cost on a surface a PM uses first |
| **OD-017** | Cost inputs key on `assembly_leaf_id`, blocking ASY-optional authoring | **Insufficient evidence** | Post-V1 | The compatibility window is explicit and governed (XP-004/XP-005 make every crossing fail closed). It constrains future authoring, not V1 correctness |
| **OD-018** | Packaging TOTAL is the simple sum across governed SKUs | **Satisfied** | — | **Closed 2026-08-07**; `quote/{tier}/cost-stack/pkg-total` |
| **OD-019** | How a margin is represented in the canonical graph — filed **Blocking**, and *"Phase 3 does not close without it"* | **Specification drift** | Release recommendation | **Phase 3 closed on 2026-08-10 and OD-019 is still filed under Blocking.** It is in substance resolved: the `ratio` kind exists (`costing-nodes.ts:74` — *"A margin is the instance that motivated it (OD-019)"*), BV-010 defines the quantity, and `quote/{tier}/margin` carries it. **The decision was made; the register was not updated.** Drift in placement, not in substance |
| **OD-020** | The client rebuilds a costing input the server already built | **Insufficient evidence** | Post-V1 | Efficiency and single-authority concern; no divergence has been observed, and P3-001 reconciliation would surface one |

---

## Block AM — authority-map currency

The map's own maintenance rule: *"The map is wrong the moment a document is
superseded without being recorded here, and a wrong map is worse than none,
because it is trusted."* These rows apply that rule to the map itself.

| ID | Requirement | Verdict | Disposition | Basis |
|---|---|---|---|---|
| **AM-001** | `docs/SPEC.md` is **Informational** — *"Product intent, not implementation authority"* | **Satisfied** | — | Correctly classified. **Consequence: this audit's title names a document that does not govern implementation.** Recorded as the structural finding above; the SPEC block is scoped accordingly |
| **AM-002** | Phase status rows are current | **Specification drift** | Release recommendation | The map records Phase 3 as *"Not started. Blocked on Phase 2 operator acceptance."* **Phase 3 shipped and closed on 2026-08-10.** A governing map that answers *"which document governs this, right now"* is wrong about the current phase — by its own standard, worse than none |
| **AM-003** | `README.md` phase table is current | **Specification drift** | Release recommendation | Same error in the repository's entry point: Phase 3 *"Not started."* Two documents, one stale fact — a reader's answer does not depend on which they open, but both are wrong |
| **AM-004** | The frozen baseline covers the governing set | **Specification drift** | Release recommendation | **The audit baseline is narrower than the governing set.** `NEXUS_IMPLEMENTATION_STANDARD.md` (tier 1, outranking every per-phase authority row), `validation/merge-gate.md`, `GO_LIVE_READINESS_CHECKLIST.md`, `PRODUCTION_BUG_REGISTER.md`, `DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md`, `pattern-52-freeze-list.md` and ADRs 004–012 all govern and none were frozen. **The baseline was not expanded to close this** — a frozen baseline that moves mid-audit is not a baseline. Recorded as a finding against this audit's own scope |

---

## Block SPEC — `docs/SPEC.md` functional requirements

**Read under AM-001.** SPEC is v3, April 2026, and predates every phase
decision. Rows are evaluated against **intent**, and no row here is a release
blocker on SPEC's authority alone.

| ID | Requirement | Verdict | Disposition | Basis |
|---|---|---|---|---|
| **SPEC-001** | FR-1 Deal Import (lazy project creation) | **Satisfied** | — | `src/app/import`; `hubspot-cache.ts` |
| **SPEC-002** | FR-2 Project Detail Page | **Satisfied** | — | `src/app/projects/[id]` |
| **SPEC-003** | FR-3 SKU Setup | **Satisfied** | — | Setup surface; BV-007 supersedes the FR's model |
| **SPEC-004** | FR-4 Tier Setup | **Satisfied** | — | `quote_tiers`; four-tier fixtures |
| **SPEC-005** | FR-5 Packaging / Freight / Production inputs | **Satisfied** | — | Phase 2 block |
| **SPEC-006** | FR-6 Costing Sheet | **Satisfied** | — | Superseded in form by the Pricing workspace; intent met |
| **SPEC-007** | FR-7 Markup model — stacking with firm-level benchmarks | **Satisfied** | — | `markup_defaults`; Phase 1 pinning |
| **SPEC-008** | FR-8 Quote View | **Satisfied** | — | Quote umbrella |
| **SPEC-009** | FR-9 Mark Accepted | **Satisfied** | — | Quote umbrella sub-tab; `quote_accepted` audit action |
| **SPEC-010** | FR-10 PDF Generation | **Satisfied** | — | `customer-pdf` route; `v1-customer-view-content-check.md` PASS |
| **SPEC-011** | FR-11 Quote Versioning | **Satisfied** | — | `quote-revision-workflow.test.ts` |
| **SPEC-012** | FR-12 Copy Operations — field categorization | **Satisfied** | — | `scenario_copied` audit namespace with field buckets |
| **SPEC-013** | FR-13 Deal Organizer | **Satisfied** | — | Project list |
| **SPEC-014** | **FR-14 Management Dashboard** — read-only exec view + portfolio rollup | **Out of scope** | — | **Not implemented.** No dashboard route exists under `src/app/`. Under AM-001 this is unbuilt product intent, not a compliance failure — and it maps to the deferred Operations wrapper, explicitly not V1 |
| **SPEC-015** | FR-15 Firm Settings & Markup Admin, audit-logged; markup changes apply to new items only | **Satisfied** | — | `src/app/admin/firm-settings`, `/markup-defaults`; `firm-settings-invariant.ts`; versioned carry-forward |
| **SPEC-016** | FR-16 Audit Log — read-only admin view | **Satisfied** | — | `src/app/admin/audit-log`; `audit-log.ts` + `audit-single-writer.ts` verifiers |
| **SPEC-017** | §13.2 · *100% of accepted quotes produce a HubSpot Quote object with `hs_cost_of_goods_sold` on every line item* | **Out of scope** | — | Superseded. The accounting handoff is NetSuite Sales Order, not a HubSpot Quote object. A v3 success criterion overtaken by the four-phase model |
| **SPEC-018** | §13.5 · *Zero quotes shipped accepted with un-overridden UNDERPRICED or BELOW FLOOR gates* | **Unsatisfied** | **Release blocker** *(rolls up to REG-2)* | **The one SPEC criterion that names a live commercial control.** It is the same requirement as REG-2 and BV-005, stated in the oldest document in the set. Three independent documents, one gap — which is the strongest signal in this matrix |
| **SPEC-019** | §13.1/3 · Adoption and build-time reduction targets | **Out of scope** | — | Post-launch measurements. Cannot be evidenced before release by construction |
| **SPEC-020** | §13.4 · Existing HubSpot → NetSuite sync continues without regression | **Insufficient evidence** | Release recommendation | Never walked against the live sync. Same evidence limit as REG-3/REG-4 |
| **SPEC-021** | §12 · Eight open questions *"must resolve before specific slices"* | **Specification drift** | Post-V1 | The slices they gate no longer exist as a sequencing model. Several are self-evidently resolved by the product running in production (repo, accounts, subdomain). The section is stale rather than open |

---

## Block B — baseline observations, carried unresolved into enumeration

| ID | Observation | Verdict | Disposition | Classification |
|---|---|---|---|---|
| **B-1** | `docs/spec.md` and `docs/SPEC.md` resolve to one tracked file | **Out of scope** | — | **Repository governance.** Git tracks exactly one path. The risk is hypothetical: on a case-sensitive checkout a second file *could* be created at the other path and neither would shadow the other. Nothing in the working tree or history shows this has happened. Under AM-001 the blast radius is further bounded — the file is Informational |
| **B-2** | OD-001 is titled *"BV-009 does not exist"* while `BV-009-freight-treatment.md` is present | **Satisfied** | — | **Not drift, and my freezing observation was the incomplete one.** The cross-phase map is precise: BV-009 as an *approved* document *"has never existed in any branch at any point in history."* The present file is a reconstruction from citations, explicitly **NOT RATIFIED**, and both AUTHORITY_MAP and the file's own status say so. OD-001's title is accurate; file presence is not document existence. The real finding is BV009-001 — that production code ships on an unratified rule |

---

## Independence check

**The question:** may Microsoft OAuth, pre-launch cleanup and the comprehensive
CB suite begin, or does a release blocker reach them?

The test applied: *an item that touches no governed commercial capability is
independent; one that could change a governed value is not.*

| workstream | independent? | reasoning |
|---|---|---|
| **Microsoft OAuth** | **Yes** | An authentication-boundary change. It alters who may enter, not what any number means. No governed commercial value is in its reach, and none of the six blockers touch authentication. The initial read is confirmed rather than merely trusted |
| **Pre-launch cleanup** | **Yes, conditionally** | Independent **provided it does not touch** the six blocker surfaces or the S-7 digest inputs. Cleanup that changes a governed scalar is not cleanup. The condition is stated because "cleanup" is unbounded by name, and the constraint is the same one Phase 2 operated under: preserve, do not improve |
| **Comprehensive CB suite** | **No — partially blocked** | It cannot be *comprehensive* while REG-2's surfaces do not exist and REG-3/REG-4 cannot be walked against a real provider. **It may begin** on everything else; it cannot **complete** or be treated as a release gate until the blockers resolve. Beginning it early is in fact the useful move — it is what would convert P1-011, P1-014 and SPEC-020 from *insufficient evidence* to a verdict |

---

## Standing evidence limits

Carried into this matrix and **not** treated as covered by any row above.

1. **NetSuite real-provider push not walked.** The validation environment runs
   an isolated provider by construction. REG-3, REG-4, P1-011, P1-014 and
   SPEC-020 all terminate here. **This single limit produces five of the audit's
   fourteen *insufficient evidence* verdicts** — it is not a footnote, it is the
   dominant evidence gap in the release.
2. **Production performance not inferred.** Every timing on record is a
   dev-server cold compile or an isolated-harness measurement. No row above
   claims a production performance property.
3. **Customer View read, not proof-read.** Figures were compared digit by digit
   against the Pricing surface; prose was read, not spell-checked.

---

## What this audit did not do

Named rather than implied.

- **It proposed no implementation.** Every finding names a gap and a
  disposition. What to build, and whether to build it, is a separate decision.
- **It did not re-run Phase 3's evidence.** R1, R2, R3, the persistence
  checklist, A-2, r12Visual, the Customer View check and S-7 are cited at their
  recorded outcomes.
- **It did not expand the frozen baseline**, even after discovering the baseline
  is narrower than the governing set. That discovery is recorded as **AM-004**
  and evaluated as a finding, which is the honest handling — a baseline that
  moves during the audit is not a baseline, and silently widening it would have
  made every row's reference set unverifiable.
- **It did not resolve B-1 or B-2 in advance.** Both entered enumeration
  unresolved and were classified by the completed audit, which is what changed
  B-2's answer from the one freezing suggested.
