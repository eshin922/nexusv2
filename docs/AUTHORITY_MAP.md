# Authority Map

**Status:** Governing. The answer to *"which document governs this, right
now?"*
**Last reconciled:** 2026-08-04

Every document in this repository is one of four things. This map says which,
so that authority can be determined **from the repository alone**.

| Class | Meaning |
|---|---|
| **Governing** | Binding on current or future work |
| **Superseded** | Replaced. Marked in place, retained so old citations land somewhere that explains what replaced it |
| **Historical** | Accurate for its moment. Not binding. Never retro-edited |
| **Informational** | Context, intent, reference. Does not govern implementation |

Precedence between governing documents is
[`NEXUS_IMPLEMENTATION_STANDARD.md` §2](NEXUS_IMPLEMENTATION_STANDARD.md).

---

## Start here

| Question | Document |
|---|---|
| How do I work? What gates must pass? What on conflict? | [`NEXUS_IMPLEMENTATION_STANDARD.md`](NEXUS_IMPLEMENTATION_STANDARD.md) |
| Why is it this way? What would justify changing it? | [`AUTHORITY_TIMELINE.md`](AUTHORITY_TIMELINE.md) |
| What is not decided? Who decides it? | [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) |
| What am I building next? | Phase specifications + [`../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) |
| What may merge? | [`validation/merge-gate.md`](validation/merge-gate.md) |
| What does "CA" / "LEAF" / "pin" / "Slice 13" mean? | [`GLOSSARY.md`](GLOSSARY.md) |

---

## Governing — by subsystem

### Method and process

| Document | Governs |
|---|---|
| [`NEXUS_IMPLEMENTATION_STANDARD.md`](NEXUS_IMPLEMENTATION_STANDARD.md) | Working method; eight gates; five-tier precedence. **Outranks every per-phase authority row** |
| [`validation/merge-gate.md`](validation/merge-gate.md) | Sole acceptance checklist. Merge blockers |
| [`validation/operational-runbook.md`](validation/operational-runbook.md) | Execution procedure for the harness |
| [`validation/VALIDATION_PRINCIPLES.md`](validation/VALIDATION_PRINCIPLES.md) + ADRs [008](adr/008-validation-environment-isolation.md)–[012](adr/012-disposable-validation-evidence.md) | Isolation, networking, fixtures, browser policy, evidence |
| [`validation/regression-policy.md`](validation/regression-policy.md), [`validation/scenario-registry.md`](validation/scenario-registry.md) | What must be protected by permanent regression |

### Business rules

| Document | Governs | Status |
|---|---|---|
| [`business-validation/BV-006`](business-validation/BV-006-product-structure-contract.md) | Product Structure Contract | **Frozen** |
| [`business-validation/BV-005`](business-validation/BV-005-below-floor-margin-approval.md) | Below-floor approval | Approved; **must be amended before Phase 4** — [OD-002](OPEN_DECISIONS.md) |
| [`business-validation/BV-001`](business-validation/BV-001-pricing-vendor-identity.md) | Pricing Vendor identity | Approved; V1 complete |
| [`business-validation/BV-003`](business-validation/BV-003-master-data-ownership.md) | Master data ownership | Approved |
| [`business-validation/BV-004`](business-validation/BV-004-business-decision-matrix.md) | Who decides what, when | Approved |
| [`business-validation/BV-007`](business-validation/BV-007-product-setup-workflow.md) | Product Setup workflow | Approved |
| [`business-validation/BV-008`](business-validation/BV-008-commercial-product-transition.md) | Commercial product transition | Approved |
| [`business-validation/BV-009`](business-validation/BV-009-freight-treatment.md) | Freight treatment | ⚠️ **RECONSTRUCTION — NOT RATIFIED** — [OD-001](OPEN_DECISIONS.md) |
| [`business-validation/PRODUCTION_READINESS_REGISTER.md`](business-validation/PRODUCTION_READINESS_REGISTER.md) | V1 business gates | Live |

BV-002 is intentionally unassigned. Identifiers are stable and are not
renumbered to close gaps.

### Architecture and data

| Document | Governs |
|---|---|
| [`architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md`](architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md) | Field ownership across system boundaries |
| [`pattern-52-freeze-list.md`](pattern-52-freeze-list.md) | Which columns freeze at which lifecycle checkpoint |
| ADRs [004](adr/004-production-cost-units.md)–[007](adr/007-cogs-customer-fee-separation.md) | Cost units, fee allocation, sent-quote immutability, COGS/fee separation |
| [`costing/`](costing/) | Production cost contract, numeric input contracts, customer pricing projection |
| [`../CLAUDE.md`](../CLAUDE.md) | Platform patterns and conventions — **tier 4** |

### Phases

| Document | Status |
|---|---|
| [`../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) | **Governing.** Authority per phase, dependency graph, reversibility |
| [`../PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md`](../PHASE-1-QUOTE-COMMERCIAL-INTEGRITY.md) | **Frozen and shipped.** Binding as the record of what exists |
| [`../PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md`](../PHASE-2-COSTS-WORKSPACE-MULTI-SKU.md) | **In progress.** Freight sections superseded by the worksheet model — see the document's own amendment notice |
| [`../PHASE-3-PRICING-WORKSPACE.md`](../PHASE-3-PRICING-WORKSPACE.md) | **Not started.** Blocked on Phase 2 operator acceptance |
| [`../PHASE-4-MARGIN-APPROVAL.md`](../PHASE-4-MARGIN-APPROVAL.md) | **Not started.** Blocked on Phase 3 and [OD-002](OPEN_DECISIONS.md) |

### Design

| Document | Governs |
|---|---|
| [`design-authority/MANIFEST.md`](design-authority/MANIFEST.md) | Registry of executable design specifications |
| [`design-authority/freight-1a/`](design-authority/freight-1a/BUNDLE.md) | Phase 2 Freight — Option A |
| [`design-authority/r12-pricing-workspace/`](design-authority/r12-pricing-workspace/BUNDLE.md) | Phase 3 Pricing; Phase 4 approval state model |
| [`phase-2-freight-dom-parity-audit.md`](phase-2-freight-dom-parity-audit.md) | **The current Freight gap list.** Tier 2 — outranks the bundle |

### Go-live

| Document | Governs |
|---|---|
| [`slice-13/GO_LIVE_READINESS_CHECKLIST.md`](slice-13/GO_LIVE_READINESS_CHECKLIST.md) | Production Go/No-Go |
| [`slice-13/`](slice-13/) *(remaining 17)* | Parity, cutover, training, shadow mode, field ownership |
| [`production-bugs/PRODUCTION_BUG_REGISTER.md`](production-bugs/PRODUCTION_BUG_REGISTER.md) | Verified production defects. A PB closes only with permanent regression evidence |

**These govern launch, not implementation method.**

---

## Freight authority register

Freight is the subsystem with the most authorities in play, so it is
enumerated in full. Ordered by
[precedence](NEXUS_IMPLEMENTATION_STANDARD.md).

| # | Tier | Authority | Where |
|---|---|---|---|
| 1 | 1 | Worksheet model — Subcategory → Destination Candidates → Quantity Breaks | [Timeline Era 6](AUTHORITY_TIMELINE.md) |
| 2 | 1 | Shipment authority — freight belongs to a commercial product; Setup owns structure | [Standard §4](NEXUS_IMPLEMENTATION_STANDARD.md) |
| 3 | 1 | Membership is evidence, not allocation; contribution enters the owning product once | [Standard §5](NEXUS_IMPLEMENTATION_STANDARD.md) |
| 4 | 1 | Customs V1 — invoice-entered Duty and Tariff only | [BUNDLE.md D3](design-authority/freight-1a/BUNDLE.md) |
| 5 | 1 | Tracking is operational; never commercial; never mutates a snapshot | [Standard §3 gate 5](NEXUS_IMPLEMENTATION_STANDARD.md) |
| 6 | 1 | Manual / imported convergence — one persistence model | [Standard §6](NEXUS_IMPLEMENTATION_STANDARD.md) |
| 7 | 1 | BV-009 — freight treatment | [BV-009](business-validation/BV-009-freight-treatment.md) ⚠️ unratified |
| 8 | 2 | **DOM/class parity audit — the live gap list** | [parity audit](phase-2-freight-dom-parity-audit.md) |
| 9 | 3 | `freight-1a` Option A bundle + four approved deviations | [BUNDLE.md](design-authority/freight-1a/BUNDLE.md) |
| 10 | 4 | Nexus conventions — action-result, Pattern 47, Pattern 52, audit namespace | [`../CLAUDE.md`](../CLAUDE.md) |
| 11 | 5 | Stop rather than invent | [Standard §10](NEXUS_IMPLEMENTATION_STANDARD.md) |

**Not authority for freight:** the voided Design Authority Matrix; PHASE-2's
superseded freight sections; the archived `CUSTOMS_AND_FREIGHT.md`.

---

## Superseded

Marked in place. Retained so an old citation lands somewhere that explains what
replaced it.

| Document | Superseded by | Note |
|---|---|---|
| [`phase-2-freight-design-authority.md`](phase-2-freight-design-authority.md) | [parity audit](phase-2-freight-dom-parity-audit.md) + operator review | Matrix marked all rows PASS. **Void** — engineering completion, not operator acceptance. Retained: it is the origin record for the four approved deviations |
| PHASE-2 freight sections | Worksheet model | Multi-SKU Packaging/Production scope **unchanged** |
| [`_archive/CUSTOMS_AND_FREIGHT.md`](_archive/CUSTOMS_AND_FREIGHT.md) | Worksheet model + [Standard §1](NEXUS_IMPLEMENTATION_STANDARD.md) | **Archived.** Describes CBM-proportional allocation — the model explicitly rejected |
| CLAUDE.md v1 release-path sequencing | Four-phase model | Excised 2026-08-04. Pattern library retained |
| "Before new Slice 13 feature work…" preambles | Four-phase model | Amended in CLAUDE.md and README. **Left intact** in `validation/slice-12-handover.md` — a historical record |
| [`IA-spec.md`](IA-spec.md) | CD design rounds | Self-marked "v1 partial"; pending rounds never landed |

---

## Historical

Execution records. Accurate for their moment. **Never retro-edited** — a
handover that was true on its date stays true on its date.

| Group | Count | Contents |
|---|---|---|
| Slice communications | ~60 | `cc-comm-*`, `cc-*-kickoff`, `cc-*-smoke-guide`, `cc-*-verification` |
| Audit findings | 23 | [`audit-findings/`](audit-findings/) — §6.b, May 2026 |
| Product Structure Slice 1 | 6 | `architecture/PRODUCT_STRUCTURE_SLICE_1_*` checkpoints |
| Autosave sweep | 5 | Inventory, passes 1–2, diagnosis, brief. Outcome is Pattern 47 |
| RI-era briefs | ~15 | `ri7-*`, `ri8-*`, `ri9-*`, `section-6b-*`, `rest-of-app-*` |
| Design prototypes | 109 | [`design-prototypes/`](design-prototypes/) — CD rounds 1–9 |
| Handovers | 2 | [`validation/slice-12-handover.md`](validation/slice-12-handover.md), [`session-handoffs/`](session-handoffs/) |

**Why retained:** they record what was tried and why it was abandoned. A future
proposal to revisit a settled question is answered faster by an existing record
than by re-deriving the argument.

---

## Informational

| Document | Role |
|---|---|
| [`SPEC.md`](SPEC.md) | v3, April 2026. Predates every phase decision. **Product intent, not implementation authority** |
| [`STRATEGIC_VISION.md`](STRATEGIC_VISION.md) | Long-arc direction |
| [`V1_BETA_READINESS.md`](V1_BETA_READINESS.md) | Enhancements required before beta begins. Not phase scope |
| [`UX_BACKLOG.md`](UX_BACKLOG.md) | Deferred UX capture. Non-binding |
| [`BOM_NOTES.md`](BOM_NOTES.md), [`HUBSPOT_CACHE.md`](HUBSPOT_CACHE.md), [`HUBSPOT_PRODUCT_CREATION_CONTRACT.md`](HUBSPOT_PRODUCT_CREATION_CONTRACT.md) | Subsystem reference |
| [`designer-agent-prompt.md`](designer-agent-prompt.md) | Audit rubric. **Predates source-first** — read with [Standard §9](NEXUS_IMPLEMENTATION_STANDARD.md) |
| [`../README.md`](../README.md) | Entry point |

---

## Maintaining this map

Reconcile it when a document changes class — not on a schedule. The map is
wrong the moment a document is superseded without being recorded here, and a
wrong map is worse than none, because it is trusted.

**When superseding a document:** mark the document itself *and* update this map.
Marking only one leaves a reader's answer dependent on which they happen to open.
