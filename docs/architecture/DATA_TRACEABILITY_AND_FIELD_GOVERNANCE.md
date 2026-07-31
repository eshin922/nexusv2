# Data Traceability and Field Governance

## 1. Purpose

This standard governs every field that crosses a system boundary within Nexus.
It ensures that a technically possible integration write is not mistaken for
an architectural right to own or mutate data.

> A field being technically writable does not establish Nexus ownership.

> No production mapping may be implemented until ownership has been
> established through documented evidence.

The intended result is an auditable chain from the authoritative business
source through Nexus transformations to the destination value, with exactly
one approved owner and permanent regression protection.

## 2. Scope

This standard applies to:

- inbound and outbound API fields;
- synchronized CRM and ERP fields;
- database columns populated from another system;
- message, webhook, scheduled-job, and provider payloads;
- derived, defaulted, workflow-mutated, and generated values;
- customer-visible documents and immutable snapshots;
- identifiers used to resolve records across systems; and
- fields read for validation or orchestration even when Nexus does not write
  them.

It applies to new mappings, changes to existing mappings, migration or
retirement work, and investigations of undocumented behavior. It governs
Sales Orders but is not limited to Sales Orders or Slice 13.

## 3. Guiding principles

1. **Ownership precedes implementation.** Technical support in a DTO, builder,
   client, or destination API is not ownership evidence.
2. **One field, one accountable owner.** Each destination field receives
   exactly one ownership classification for the operating context under
   review.
3. **Systems of record retain authority.** Nexus must not duplicate,
   overwrite, or compete with established HubSpot synchronization, NetSuite
   derivation, or other approved system behavior.
4. **Trace the complete lifecycle.** Source, persistence, transformation,
   payload, destination, and post-automation state must be distinguishable.
5. **Omission is behavior.** An omitted field is different from an explicit
   null, empty value, zero, default, or failed resolution.
6. **Unknown means stop.** Missing evidence does not authorize a reasonable-
   sounding mapping.
7. **Evidence outranks names and comments.** Variable names, stale comments,
   screenshots, and writable API fields are leads, not contracts.
8. **Business meaning governs parity.** Byte identity is not required when
   approved environments differ, but every difference requires a traced and
   classified cause.
9. **Historical results remain immutable.** A new ownership decision does not
   retroactively mutate sent snapshots, accepted transactions, or artifacts.
10. **Tests protect the contract, not a duplicate formula.** Regression
    expectations express independently understandable business outcomes and
    boundary behavior.

## 4. Data traceability

Every governed field must have a trace that identifies:

1. **Business identity:** human-readable name, business purpose, sensitivity,
   required or optional status, and affected process.
2. **Authoritative source:** system, object or record, technical field, value
   type, allowed null behavior, and business owner.
3. **Acquisition:** synchronization, API read, user entry, configured lookup,
   default, or other mechanism, including timing and matching key.
4. **Identity resolution:** when the value is a cross-system reference, the
   governed dictionary or destination record that resolves source identity to
   destination identity, its owner, and missing/inactive behavior.
5. **Nexus persistence:** table and column, DTO or type, precision, snapshot or
   mutability semantics, and retention.
6. **Transformation:** exact production symbol, normalization, resolution,
   derivation, rounding, conditional omission, and error behavior.
7. **Outbound boundary:** provider, endpoint or record type, destination field,
   payload representation, and idempotency or correlation identifier.
8. **Transaction population:** the mechanism and owner that writes, sources,
   defaults, or derives the destination transaction field.
9. **Destination lifecycle:** immediate value, sourced or defaulted value,
   workflow or script mutation, and final observable value.
10. **Downstream effect:** accounting, fulfillment, reporting, permissions,
   customer presentation, audit, and artifact consequences.
11. **Environment evidence:** relevant sandbox and production configuration
   differences and why they do or do not change business meaning.
12. **Regression evidence:** tests that protect approved mapping, omission,
    failure, retry, and immutability behavior.

A trace must distinguish copied, resolved, derived, defaulted, generated,
workflow-mutated, and read-only values. Unavailable links in the chain are
recorded as named evidence gaps with an owner and next action.

## 5. Field governance lifecycle

### Discover

Enumerate the field from code, schemas, metadata, configuration, fixtures,
payloads, destination records, workflows, scripts, and business documents.
Record conflicts and unknowns without resolving them by assumption.

### Trace

Build the end-to-end trace defined above. Capture both immediate and
post-automation destination state when the target system can source, default,
or mutate the value.

### Classify

Assign exactly one ownership classification. Separately classify parity or the
observed difference; ownership and parity answer different questions.

### Decide

Identify the accountable business and technical approvers. Answer:

1. Who owns this field?
2. Why should Nexus write it instead of relying on the owning system?

If either answer lacks evidence, retain `UNKNOWN` and stop the production
mapping.

### Implement

After the decision gate passes, change the centralized production boundary,
contracts, validation, tests, fixtures, scenario registry, and operational
documentation in one coherent checkpoint. Preserve omission for fields Nexus
does not own.

### Verify

Prove source-to-destination behavior, failure behavior, idempotency,
post-automation outcome, environment distinctions, and absence of duplicate
writes. Use the fastest suitable test layer first and the real external
boundary only through controlled validation.

### Operate and review

Monitor ownership assumptions and reconciliation failures. Re-run governance
when a source property, destination field, synchronization, workflow, script,
form, provider, or business owner changes.

### Retire or transfer

Ownership transfer requires an explicit architecture decision, migration and
rollback plan, dual-write avoidance, historical compatibility analysis, and
regression updates. Retirement must document why a field or integration is no
longer active.

## 6. Evidence hierarchy

Use the strongest available evidence and preserve provenance:

1. Approved architecture decisions, business contracts, and accountable owner
   confirmation.
2. Destination metadata, active configuration, forms, workflows, scripts, and
   synchronization mappings.
3. Correlated structured production observations obtained read-only.
4. Controlled sandbox request/response evidence with immediate and
   post-automation results.
5. Executable production code, schemas, mapping tests, and version history.
6. Deterministic fixtures and fake-provider ledgers.
7. Maintained operational documentation.
8. Comments, examples, screenshots, historical scripts, and naming clues.

Higher-ranked evidence does not remove the need for executable regression
coverage. Lower-ranked evidence cannot override an approved business or
architecture contract. Production writes are not a discovery technique.
Credentials, secrets, and unapproved sensitive payloads must not be committed
as evidence.

Each conclusion must be labeled as one of:

- confirmed repository evidence;
- confirmed external or administrator evidence;
- reasonable inference;
- unknown requiring administrator evidence; or
- unknown requiring a controlled sandbox probe.

## 7. Evidence classification

Governance separates evidence by the decision it serves:

### Decision-Critical Evidence

Evidence is decision-critical when its absence could change whether Nexus
writes, omits, reads, validates, blocks, or otherwise depends on a field.
Decision-critical gaps keep the relevant ownership or implementation gate
open. Examples include the authoritative source, identity resolver,
transaction population owner, destination representation, duplicate-write
risk, and required failure behavior.

### Operational Provenance

Operational provenance identifies the exact internal component, execution
path, version, timestamp, or audit trail behind behavior whose Nexus
implementation decision is already fixed. It supports maintenance,
troubleshooting, auditing, migration, and incident response, but does not
block the approved Nexus behavior.

An open provenance item must state why it cannot change the current
implementation decision and what future event would make it decision-critical.
Provenance becomes decision-critical when the owning integration is changed,
retired, replaced, fails its established contract, or transfers ownership.

Do not use the `UNKNOWN` ownership classification for provenance-only gaps.
Record ownership as closed and track provenance separately.

## 8. Ownership classifications

| Classification | Governance meaning | Nexus write policy |
| --- | --- | --- |
| `HUBSPOT_SYNC_OWNED` | Native HubSpot synchronization owns the destination value. | Do not duplicate or overwrite it. Nexus may validate or reference the synchronized result. |
| `NEXUS_OWNED` | An approved architecture decision assigns Nexus responsibility for the value. | Nexus may write it through the governed boundary and must validate and test it. |
| `NETSUITE_DERIVED` | NetSuite owns the value through accounting defaults, sourcing, tax, numbering, or record context. | Omit the write unless an approved exception explicitly requires an input. Verify the derived result. |
| `NETSUITE_WORKFLOW_OR_SCRIPT_OWNED` | A NetSuite workflow, SuiteScript, or equivalent automation owns the value. | Do not compete with the automation. Observe immediate and final state. |
| `SHARED_READ_ONLY_DEPENDENCY` | Nexus may resolve, consume, or validate a value owned elsewhere. | Read or reference only; fail safely when the dependency is missing or stale. |
| `HISTORICAL_INACTIVE` | The field is retained for history but is not active in the current contract. | Do not reactivate it without a new ownership decision. |
| `UNKNOWN` | Evidence is insufficient to establish ownership. | Do not write it. Assign the evidence gap and decision owner. |

Ownership is contextual to a specific field and record boundary. A system may
own the source record while another system derives a transaction field from
it. A governed identifier lookup can support deterministic resolution without
transferring ownership of the referenced record.

For cross-system reference fields, governance records two distinct roles:

- **Identity Resolution Owner:** owns the dictionary or synchronized
  destination record that correlates the source identity to the destination
  identity.
- **Transaction Population Owner:** owns the mechanism that places the
  resolved identity on the transaction.

Closing identity resolution does not close transaction-field ownership and
does not authorize Nexus to write the transaction field. The final ownership
classification applies to transaction population at the destination boundary.

## 9. Decision gates

### Evidence gate

- Field identity, type, source, destination, and business purpose are known.
- The full trace is documented, including null, missing, invalid, stale, and
  changed-source behavior.
- Immediate and post-automation behavior is known where applicable.
- Environment differences are documented.

### Ownership gate

- Exactly one ownership classification is approved.
- Business and technical owners are named.
- The questions “Who owns this field?” and “Why should Nexus write it?” have
  evidence-backed answers.
- Duplicate-write and overwrite risks are resolved.

### Implementation gate

- The source and resolver are deterministic.
- Payload representation and destination metadata are confirmed.
- Validation, omission, failure, audit, idempotency, retry, and compatibility
  behavior are specified.
- Historical records and immutable artifacts are protected.
- The appropriate regression and validation layers are identified.

### Release gate

- Production code and documentation agree.
- Required regression tests pass.
- Controlled integration evidence supports the approved behavior.
- Unknown or blocker classifications relevant to the mapping are resolved.
- Rollback, monitoring, reconciliation, and operational ownership are defined.

Failing a gate is protective behavior. It is not permission to weaken the gate
or infer the missing contract.

Operational provenance does not fail an implementation gate when
decision-critical evidence already proves the required Nexus behavior.

## 10. Implementation rules

- Centralize mapping and omission logic at the production integration
  boundary.
- Do not add a second writer for a field owned by synchronization, destination
  defaults, or automation.
- Do not create a mapping dictionary when an owning integration already
  supplies a governed identity.
- Resolve references deterministically and fail safely when a required
  synchronized record is absent, inactive, stale, or ambiguous.
- Validate before persistence, audit success, provider activity, cache
  invalidation, or artifact mutation.
- Preserve the previous valid state after rejected input.
- Audit canonical persisted or delivered values, not unvalidated raw input.
- Make null, empty, zero, omission, and explicit clearing semantics deliberate
  and testable.
- Preserve destination precision, identifiers, and schema bounds.
- Keep unsupported, historical, and unknown fields absent from payloads.
- Do not use a sandbox discrepancy to transfer ownership to Nexus.
- Update contracts, evidence status, tests, fixtures, validation impact, and
  operational documentation with the implementation.
- Do not mutate historical snapshots or artifacts to conform to a new mapping.

## 11. Regression requirements

Every approved mapping must have permanent coverage appropriate to its risk:

- **Unit tests:** transformation, normalization, resolution, precision,
  conditional omission, and unsupported-field absence.
- **Integration or action tests:** persistence, provider-boundary payload,
  structured rejection, audit behavior, idempotency, and retry.
- **Contract tests:** exact field identity and representation, including proof
  that unverified and historically inactive fields remain omitted.
- **Browser tests:** only user-visible workflows or permissions that lower
  layers cannot prove.
- **Lifecycle and artifact tests:** immutable snapshots, customer documents,
  downstream state, and post-send behavior.
- **Controlled integration validation:** sourcing, defaulting, workflow/script
  mutation, and environment-specific behavior.

Tests must include null, missing, invalid, inactive, stale, reassigned, and
failure behavior where relevant. Expected outcomes must be explicit and
independently understandable; tests must not reproduce the production formula
or mapping merely to agree with it. A discovered defect receives a permanent
regression test.

Assertions may be weakened only with trace-supported evidence. Skips, focused
tests, retries, arbitrary waits, broad network exclusions, and silent snapshot
replacement are not substitutes for diagnosis.

## 12. Relationship to governance artifacts

This document defines the permanent process. Supporting artifacts have
different responsibilities:

- **ADRs** record why an architectural ownership or integration decision was
  made, alternatives considered, and consequences. See the repository's
  [ADR directory](../adr/).
- **Business and accounting contracts** define approved field meaning,
  precision, visibility, immutability, and business rules. For a current
  example, see the
  [Accounting Field Universe](../slice-13/ACCOUNTING_FIELD_UNIVERSE.md).
- **Parity matrices** record field-level source, destination, ownership,
  observed equivalence or difference, evidence, and status. They do not grant
  ownership by themselves. See the
  [Sales Order Parity Matrix](../slice-13/SALES_ORDER_PARITY_MATRIX.md).
- **Evidence guides** define capture quality, correlation, environment
  identity, and acceptance requirements. See the
  [Sales Order Parity Evidence Guide](../slice-13/PARITY_EVIDENCE_GUIDE.md).
- **Evidence reports** investigate one bounded ownership question, distinguish
  facts from inference, identify blockers, and apply the decision gates. The
  [Project Manager propagation report](../slice-13/PROJECT_MANAGER_PROPAGATION_EVIDENCE.md)
  and
  [Standard Terms ownership report](../slice-13/STANDARD_TERMS_OWNERSHIP_EVIDENCE.md)
  are reference examples. Standard Terms also demonstrates closure: a
  controlled sandbox probe established `NETSUITE_DERIVED` ownership, verified
  cleanup, and preserved Nexus omission.
- **Ownership registers** record approved architectural write authority after
  an evidence report closes. See the
  [Sales Order Field Ownership Register](../slice-13/FIELD_OWNERSHIP_REGISTER.md).
  A closed ownership decision does not, by itself, establish cross-environment
  parity.
- **Scenario registries and validation documentation** identify the executable
  business promises and operating procedures that protect approved behavior.

Field-specific evidence reports must not silently change permanent contracts
or parity classifications. Approved conclusions are promoted deliberately
into the relevant contract, matrix, ADR when architectural ownership changes,
and regression suite.

## 13. Future applicability beyond Sales Orders

Apply this standard to every future cross-system capability, including:

- purchase orders, work orders, fulfillments, invoices, and credits;
- customer, contact, project, vendor, product, and item references;
- HubSpot properties, associations, webhooks, and native synchronization;
- NetSuite records, custom fields, SuiteTax, workflows, SuiteScripts, bundles,
  forms, and generated values;
- authentication identities, role and permission claims, and directory
  mappings;
- notifications, email, file storage, PDFs, audit events, and analytics;
- manufacturing, packaging, logistics, inventory, and production
  reconciliation; and
- future providers, data warehouses, background jobs, and replacement
  integrations.

For each new boundary, begin with the field universe and ownership evidence,
not with a payload implementation. The same rule always applies: if ownership
cannot be established and the reason for a Nexus write cannot be proved,
Nexus must not write the field.
