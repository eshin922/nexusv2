# Slice 13 production-readiness execution plan

## Objectives

Slice 13 will prove that Nexus can enter production without changing the
commercial or operational meaning of Sales Orders. The first gate is
field-level lineage and behavioral parity across HubSpot → Nexus → NetSuite
sandbox. Completed Item Groups are the only currently approved
Accounting-visible change.

## Scope

- Discover the current system and external operating environment.
- Establish Sales Order field lineage, evidence, and difference disposition.
- Inventory integrations and their owners, triggers, and retirement effects.
- Complete the V1 business-validation requirement for governed pricing-vendor
  identity while preserving existing supplier records.
- Run Nexus in sandbox-only shadow mode while legacy production processing
  remains authoritative.
- Prepare operations, training, UAT, cutover, go-live, hypercare, and legacy
  retirement.

## Non-goals

- Literal byte identity between production and sandbox.
- Production writes during discovery, parity audit, or shadow mode.
- New Slice 13 features before the Sales Order parity gate closes.
- Vendor-quote parsing, sourcing recommendations, or procurement automation.
- Treating a `$0.00` upstream catalog price as a commercial transaction price.
- Assuming undocumented external configuration from repository client code.

## Success criteria

- Every field Nexus writes has exactly one approved ownership classification
  under the
  [Integration Ownership Principle](INTEGRATION_OWNERSHIP_PRINCIPLE.md).
- Every accounting-relevant Sales Order field has source-to-destination
  evidence and one approved classification from the
  [parity plan](SALES_ORDER_PARITY_PLAN.md).
- Every active integration has a named business and technical owner.
- Shadow-mode transactions are reproducible, classified, and non-mutating to
  production.
- Department sign-offs and the
  [Go/No-Go checklist](GO_LIVE_READINESS_CHECKLIST.md) are complete.
- Rollback, monitoring, communication, and legacy-retirement decisions are
  approved before production credentials are activated.

## Risks, assumptions, and dependencies

| Type | Item | Treatment |
|---|---|---|
| Architecture | Native HubSpot-to-NetSuite synchronization remains authoritative for its established CRM mappings. | Preserve it unless ownership is explicitly transferred by architecture; see the [Integration Ownership Principle](INTEGRATION_OWNERSHIP_PRINCIPLE.md). |
| Risk | External HubSpot and NetSuite automation is not represented in this repository. | Manual administrator discovery and exported evidence are required. |
| Risk | Sandbox configuration can legitimately differ from production. | Trace and classify the root cause; do not call every difference a defect. |
| Risk | Existing parity tooling uses a fixed historical reference and live external credentials. | Treat it as discovery evidence until safety, repeatability, and fixture ownership are reviewed. |
| Risk | Item Groups can pass NetSuite validation with a zero catalog price. | Assert that Nexus transaction rates remain the commercial source. |
| Assumption | The legacy HubSpot → production NetSuite flow stays authoritative during Beta. | Confirm with Accounting and integration owners before shadow mode. |
| Assumption | Completed Item Groups are the sole intended Accounting-visible change. | Escalate any additional intentional change through Go/No-Go governance. |
| Dependency | Production and sandbox field dictionaries, scripts, workflows, roles, forms, tax, terms, and item configuration. | Requires manual discovery. |
| Dependency | Representative production transaction set and approved handling of sensitive evidence. | Requires Accounting and IT approval. |

## Business-validation requirements

### BV-001 — Pricing Vendor Identity

- **Release:** V1.
- **Business capability:** replace free-text supplier entry with an optional,
  governed HubSpot Vendor lookup.
- **Identity contract:** persist a stable vendor identity and the pricing
  provenance used by the quote.
- **Compatibility:** preserve existing records that contain free-text supplier
  values; absence of a governed vendor remains valid because vendor selection
  is optional.
- **Optional Pricing Date:** may be included in V1 only after its exact business
  meaning and scope are confirmed.
- **NetSuite boundary:** do not project Pricing Vendor to NetSuite in V1.
- **V1 boundary:** do not implement vendor-quote parsing, sourcing
  recommendations, or procurement automation.
- **V1.5:** automated vendor-quote ingestion.
- **V2:** broader sourcing and procurement intelligence.

### Remaining V1 production-readiness gates

The authoritative business-gate status is maintained in the
[Production Readiness Register](../business-validation/PRODUCTION_READINESS_REGISTER.md):

1. Pricing Vendor identity.
2. Below-floor margin approval.
3. Idempotent Sales Order send.
4. Item Group applicability and commercial pricing.

Below-floor authority is a governed Commercial Approver permission or list,
not the `admin` role. Admin may administer that authority. A later firm-floor
policy change does not by itself invalidate an approval already granted for
the recorded policy and commercial facts; material quote-economic change,
tier change, or revision does invalidate it.

## Exit criteria

Slice 13 exits only when the authoritative readiness checklist is approved,
production monitoring and rollback have been exercised, hypercare criteria are
met, and legacy automation is retired or has an approved dated exception.

## Phases

### 13.0 System Discovery

- **Goals:** establish the evidence-backed current state.
- **Deliverables:** this package, repository topology, owners/unknowns register.
- **Entry criteria:** Slice 12 validation and documentation complete.
- **Exit criteria:** repository facts are verified; every external unknown has
  an owner and discovery action.
- **Risks:** confusing historical comments or probes with current operations.
- **Open questions:** Who owns each external system and current workflow?

### 13.1 Sales Order Parity Audit

- **Goals:** trace and classify every accounting-relevant field.
- **Deliverables:** populated parity matrix, evidence bundle, blocker register,
  permanent tests for confirmed contracts.
- **Entry criteria:** representative transactions and field dictionaries
  approved.
- **Exit criteria:** no `UNKNOWN` or `BLOCKER`; all differences approved;
  completed Item Groups and item-level pricing are verified.
- **Risks:** source-data gaps masquerading as mapping defects.
- **Open questions:** What is the complete Accounting field set and tolerance
  policy?

### 13.2 Integration Inventory

- **Goals:** identify every automation and cutover dependency.
- **Deliverables:** verified inventory, owner map, trigger graph, retirement
  dependencies.
- **Entry criteria:** administrator access and owner participation available.
- **Exit criteria:** no unidentified production writer or scheduled process.
- **Risks:** configuration existing only in SaaS consoles.
- **Open questions:** Which HubSpot and NetSuite automations are active?

### 13.3 Operational Shadow Mode (Beta)

- **Goals:** recreate production transactions safely in NetSuite sandbox.
- **Deliverables:** transaction pairing ledger, classified differences, trend
  dashboard, incident log.
- **Entry criteria:** parity matrix baseline, sandbox isolation, transaction
  correlation, and cleanup controls approved.
- **Exit criteria:** measurable criteria in
  [SHADOW_MODE_PLAN.md](SHADOW_MODE_PLAN.md) pass.
- **Risks:** missed production transactions or accidental production writes.
- **Open questions:** What transaction sampling/capture mechanism is approved?

### 13.4 Documentation

- **Goals:** keep architecture, contracts, runbooks, and decisions durable.
- **Deliverables:** updated project, validation, integration, and operating docs.
- **Entry criteria:** decisions have evidence and owners.
- **Exit criteria:** links and commands verify; no institutional-knowledge gap.
- **Risks:** duplicating authoritative procedures.
- **Open questions:** Which operational system hosts controlled runbooks?

### 13.5 Training & Organizational Readiness

- **Goals:** prepare each department for its production role.
- **Deliverables:** materials, exercises, attendance, competency evidence,
  sign-offs.
- **Entry criteria:** stable workflows and role model.
- **Exit criteria:** all sign-offs in [TRAINING_PLAN.md](TRAINING_PLAN.md).
- **Risks:** training against behavior that changes before cutover.
- **Open questions:** Named trainers and approvers require manual discovery.

### 13.6 User Acceptance Testing

- **Goals:** prove real business workflows with accountable users.
- **Deliverables:** approved UAT scenarios, evidence, defects, sign-offs.
- **Entry criteria:** parity blockers closed and training environment ready.
- **Exit criteria:** no critical defect; accepted exceptions are documented.
- **Risks:** happy-path-only coverage or nonrepresentative data.
- **Open questions:** Required transaction mix and sign-off authority.

### 13.7 Production Cutover Planning

- **Goals:** define a reversible, owned transition.
- **Deliverables:** timed runbook, credential plan, rollback drill, monitoring
  and communication plan.
- **Entry criteria:** UAT approval and complete integration inventory.
- **Exit criteria:** Go/No-Go packet approved and rollback rehearsed.
- **Risks:** overlapping legacy and Nexus writers.
- **Open questions:** Maintenance window and final authority.

### 13.8 Production Go-Live

- **Goals:** activate Nexus production processing under controlled observation.
- **Deliverables:** execution record, smoke evidence, transaction reconciliation.
- **Entry criteria:** all merge and Go/No-Go blockers closed.
- **Exit criteria:** first production transactions reconcile and monitoring is
  healthy.
- **Risks:** credential, permissions, mapping, or duplicate-write failure.
- **Open questions:** First transaction cohort and staffed support window.

### 13.9 Hypercare

- **Goals:** stabilize operations and close early production defects.
- **Deliverables:** daily metrics, incident dispositions, regression tests,
  support handoff.
- **Entry criteria:** successful go-live.
- **Exit criteria:** agreed observation period and error thresholds pass.
- **Risks:** premature normalization of recurring manual workarounds.
- **Open questions:** Duration and severity/service-level targets.

### 13.10 Legacy Retirement

- **Goals:** remove obsolete writers and support paths without losing evidence.
- **Deliverables:** retirement approvals, disabled automation inventory,
  archival/restore evidence, updated ownership.
- **Entry criteria:** hypercare exit and rollback window approval.
- **Exit criteria:** legacy processes are disabled, verified, and documented;
  no duplicate writer remains.
- **Risks:** hidden scheduled automation or irreversible deletion.
- **Open questions:** Retention, audit, and restore requirements.
