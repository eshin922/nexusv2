# Administrator Evidence Request

## Overview

Repository-first investigation of unresolved NetSuite Sales Order ownership is
complete. Nexus code, schemas, tests, history, fixtures, scripts, and committed
documentation have been traced as far as repository evidence permits.

The remaining questions depend on authoritative evidence from NetSuite
administrators, solution architects, ERP owners, integration owners, and the
business owners who rely on the resulting fields. This document is the single
authoritative request package for that evidence.

The purpose is evidence collection, not implementation. A completed response:

- does not authorize a Nexus production write by itself;
- does not change a parity classification;
- does not transfer ownership from HubSpot, NetSuite, a workflow, a script, or
  a bundle;
- does not replace Accounting or Operations approval; and
- must still pass the decision gates in
  [Data Traceability and Field Governance](DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md).

> A field being technically writable does not establish Nexus ownership.

> No production mapping may be implemented until ownership has been
> established through documented evidence.

Use this package for the current Sales Order investigation and as the template
for future NetSuite record and field investigations. Return structured exports
where available. Screenshots may supplement but must not replace exportable
metadata or configuration.

## Investigation summary

The completed repository-first investigations are:

- [Project Manager propagation](../slice-13/PROJECT_MANAGER_PROPAGATION_EVIDENCE.md):
  identity resolution and transaction population are closed as
  `HUBSPOT_SYNC_OWNED` for Nexus implementation. Nexus omits the field. The
  exact create-time component remains informational provenance only.
- [Standard Terms ownership](../slice-13/STANDARD_TERMS_OWNERSHIP_EVIDENCE.md):
  ownership is closed as `NETSUITE_DERIVED`. A controlled sandbox REST probe
  proved NetSuite populated Customer default Terms when Nexus omitted the
  field. The custom-text field's business meaning remains a separate decision.
- [Workflow-derived fields](../slice-13/WORKFLOW_DERIVED_FIELDS_EVIDENCE.md):
  generated, sourced, workflow, SuiteScript, SuiteTax, lifecycle, and bundle
  candidates have been inventoried. Native NetSuite results are provisionally
  NetSuite-owned; unverified custom automation remains `UNKNOWN`.

These reports remain the authoritative records of current conclusions and
limitations. This request consolidates their external evidence needs; it does
not revise them.

## Response instructions

For every export or answer:

1. Identify the NetSuite account and environment.
2. Record the capture date and timezone.
3. Identify the role used to capture it.
4. Identify the administrator or owner who supplied it.
5. Include the field, form, workflow, script, bundle, or preference internal
   ID and active version where available.
6. State whether production and sandbox are equivalent. If not, identify the
   root-source difference.
7. Redact credentials, tokens, secrets, personal data, and unrelated customer
   data.
8. Preserve the unmodified export externally and provide Nexus with a
   sanitized evidence reference.
9. Label unavailable evidence explicitly; do not substitute an assumption.

## Requested administrator evidence

### Project Manager

The Nexus implementation decision is closed. The historical request below is
retained for audit context; only exact create-time component provenance remains
open, and it is non-blocking unless the owning integration changes or retires.

| Requested evidence | Why it is required | Expected return |
| --- | --- | --- |
| Sales Order field metadata | Establishes whether the field is active, stored, sourced, scriptable, mandatory, and reference-valued. | Production and sandbox field export |
| Field ID and display name | Confirms that repository references to `custbody_project_manager` identify the intended business field. | Internal ID, label, field type, source list |
| Record type and applicability | Determines whether the value belongs to Sales Order, Customer, Opportunity, Job/Project, Employee, or another record. | Record-type and applies-to metadata |
| Active form configuration | Reveals form defaults, display rules, sourcing, mandatory behavior, and role-specific differences. | Form export and active form IDs |
| Sourcing rules | Determines whether Customer, Opportunity, Job/Project, Employee, or another record supplies the value before Nexus could write it. | Source-list/source-from configuration and timing |
| Workflow usage | Identifies workflow writers, conditions, overwrite behavior, and execution order. | Active workflow definitions and deployment status |
| SuiteScript usage | Identifies User Event, scheduled, Map/Reduce, bundle, or other script reads and writes that may not appear in field metadata. | Script and deployment exports with relevant code or field-access summary |
| Native synchronization behavior | Establishes whether HubSpot Deal Owner, `project_manager`, or another identity already propagates into NetSuite. | HubSpot-to-NetSuite mapping export, direction, target, timing, overwrite, and null-clearing behavior |
| Employee lookup behavior | Establishes how a source user becomes a NetSuite Employee internal ID without creating an unauthorized second mapping dictionary. | Resolution rule and at least two confirmed source-to-employee examples |
| Inactive employee behavior | Defines whether sourcing rejects, clears, retains, substitutes, warns, or blocks when an Employee is inactive. | Configuration evidence and approved observed behavior |
| Missing, unmapped, and reassigned behavior | Defines safe omission, warning, blocking, audit, and update behavior. | Owner-approved behavior for each case |
| Sandbox versus production differences | Prevents environment-specific employee IDs, forms, or automation from being mistaken for mapping defects. | Root-caused configuration comparison |

Required business confirmation:

- Operations identifies the authoritative Project Manager assignment.
- The HubSpot integration owner confirms whether native synchronization owns
  or provides the identity.
- The NetSuite owner confirms whether Sales Order sourcing or automation owns
  the destination.
- Owners decide whether reassignment changes an existing Sales Order and who
  owns correction and audit history.

### Standard Terms

Standard Sales Order `terms` ownership is closed as `NETSUITE_DERIVED`; no
additional administrator evidence is required to decide whether Nexus writes
it. Preserve Nexus omission. The table below is retained as the historical
request that led to closure; production/sandbox parity and the custom text
field's business meaning remain separate concerns.

| Requested evidence | Why it is required | Expected return |
| --- | --- | --- |
| Standard Terms metadata | Establishes the exact standard Sales Order `terms` field, reference type, mandatory status, sourcing, and scriptability. | Production and sandbox metadata export |
| Customer default sourcing | Determines whether the synchronized NetSuite Customer is already the authoritative source. | Customer terms metadata, source ownership, and representative configuration |
| Sales Order sourcing | Establishes whether the transaction form copies Customer terms immediately or at another event. | Active form sourcing/default export |
| Custom payment-terms relationship | Determines whether `custbody_dps_payment_terms_text` supplements, mirrors, replaces, or is independent of standard `terms`. | Custom-field metadata and Accounting-approved business definition |
| Workflow changes | Identifies terms values populated, cleared, normalized, or overwritten by Workflow. | Active workflow exports with execution order |
| SuiteScript changes | Identifies hidden User Event, scheduled, Map/Reduce, or bundle mutations. | Script/deployment exports and field-access summary |
| REST behavior | Confirms whether the standard field accepts an internal ID, text, or reference object and how omission, null, invalid, and inactive values behave. | Metadata plus sanitized successful and rejected request/response examples |
| SOAP behavior, if applicable | Determines whether legacy automation uses a different representation or sourcing path that affects parity. | Relevant WSDL/record-browser reference and sanitized legacy request/response; otherwise explicit “not applicable” |
| Sandbox observations | Proves immediate and post-automation behavior for representative Customer defaults without production mutation. | At least two correlated Sales Orders with different approved terms |
| Production/sandbox comparison | Prevents form, Term record, workflow, or Customer-default differences from being mistaken for Nexus behavior. | Root-caused configuration and read-only observation comparison |

Required Accounting confirmation:

- which field governs invoicing, reporting, collections, customer
  communication, and operational decisions;
- whether immutable quote text is contractual text, an operational note, or a
  source for selecting a NetSuite Term;
- which value governs when a quote snapshot and Customer default differ; and
- who approves Customer defaults and transaction exceptions.

### Workflow-derived fields

| Requested evidence | Why it is required | Expected return |
| --- | --- | --- |
| Active workflows | Identifies every automated Sales Order writer and reader. | Complete production and sandbox workflow list |
| Workflow exports | Establishes triggers, conditions, actions, execution order, release state, and field mutations. | Native exports or complete structured definitions |
| SuiteScripts | Finds automation not represented in workflows or form sourcing. | Script records, versions, owners, and relevant source or field-access summaries |
| Installed bundles | Identifies third-party ownership of custom body and line fields. | Bundle inventory, version, vendor/owner, documentation, and deployed components |
| User Event scripts | Captures before-load, before-submit, and after-submit mutations around creation. | Script/deployment exports and execution context |
| Scheduled and Map/Reduce scripts | Captures delayed mutations that an immediate read cannot observe. | Schedule/deployment details, queues, search inputs, and affected fields |
| Generated fields | Distinguishes native identity, numbering, dates, totals, line keys, and lifecycle results from custom automation. | Field metadata and relevant account preferences |
| Opportunity sourcing | Establishes whether `opportunity`, `previousOpportunity`, or `custbody_dps_related_opportunity` is sourced by conversion, Workflow, or script. | Field metadata, conversion path, workflow/script evidence, and representative records |
| Job/Project sourcing | Establishes what populates `job`, whether project generation remains active, and whether Nexus should remain outside that process. | Field/default/workflow/script evidence and current operational ownership |
| Report timestamp behavior | Identifies the actual writer and consumer of `custbody_report_timestamp`. | Field metadata, automation deployment, timing, and business-use evidence |
| Third-party line-field behavior | Prevents Nexus from duplicating bundle-owned calculations or flags. | Metadata and writer/consumer evidence for each custom line field |

For each workflow or script that touches a candidate field, provide:

- internal ID, name, owner, status, version, and deployment;
- trigger event and execution context;
- conditions and saved-search dependencies;
- fields read, written, cleared, or overwritten;
- synchronous or asynchronous timing;
- error and retry behavior;
- system-note or execution-log evidence; and
- production/sandbox differences.

### SuiteTax

| Requested evidence | Why it is required | Expected return |
| --- | --- | --- |
| SuiteTax configuration | Establishes whether SuiteTax is enabled and which account features and nexus settings govern Sales Orders. | Production and sandbox feature/configuration export |
| Tax engine | Identifies the native or partner engine responsible for calculation and field writes. | Engine name, version, owner, deployment, and scope |
| Tax schedules | Establishes item/category tax treatment and environment-specific references. | Active schedule export and item assignment rules |
| Tax codes | Establishes Customer, address, item, subsidiary, and transaction dependencies. | Active code dictionary, internal IDs, and environment mapping |
| `custbody_stc_*` definitions | Identifies field labels, types, formulas, writer, timing, and downstream consumers. | Metadata and script/workflow/bundle references for all three fields |
| Override behavior | Defines when the configured Nexus line `taxCode` override is permitted and how it affects native derivation. | Administrator-approved override contract and examples |
| Calculation timing | Distinguishes create-time values from asynchronous recalculation and later transaction changes. | Execution timeline and system-note/calculation evidence |
| Address, Customer, item, and subsidiary dependencies | Establishes the complete tax input set and missing-input behavior. | Sourcing/configuration map |
| Sandbox parity | Determines which internal IDs and configurations may differ while preserving equivalent tax behavior. | Root-caused production/sandbox comparison |

Accounting or the tax owner must define the required reconciliation tolerance,
authoritative tax result, exception process, and whether each custom tax field
is used for invoices, reporting, compliance, or display only.

### Item Groups

| Requested evidence | Why it is required | Expected return |
| --- | --- | --- |
| Item Group definitions | Establishes the active NetSuite record contract and required fields. | Metadata/record-browser export and representative group records |
| Group/member behavior | Defines ordering, quantities, member types, hidden/display behavior, reuse, and update semantics. | Group and member configuration plus examples |
| Pricing | Prevents a `$0.00` catalog price used for validation from becoming the commercial transaction price. | Item/group price configuration and successful transaction examples |
| Tax handling | Establishes whether tax is calculated at group, member, or displayed-line level. | SuiteTax/tax-code behavior and reconciled examples |
| Invoice presentation | Confirms the intended Accounting-visible change and customer-facing grouping. | Sanitized Sales Order, fulfillment, and invoice examples approved by Accounting |
| REST representation | Establishes the supported Item Group Sales Order line shape, reference form, quantity, rate, and amount behavior. | Metadata plus successful sanitized request/response |
| SOAP behavior, if applicable | Identifies any legacy-only representation or process that must remain behaviorally equivalent. | Sanitized legacy request/response or explicit “not applicable” |
| Failure behavior | Defines missing member, stale item, duplicate group, invalid price, tax, and partial-create behavior. | Error examples and administrator-approved recovery rules |
| Bundle dependencies | Identifies scripts, workflows, forms, or third-party components required for group creation, order entry, invoicing, or display. | Bundle/deployment inventory and ownership |
| Product/item synchronization dependency | Confirms that Nexus references items created and maintained by HubSpot native synchronization rather than creating a competing item source. | Sync mapping, matching key, timing, and stale/missing-item behavior |
| Sandbox cleanup constraints | Ensures controlled probes do not delete or mutate unowned records. | Approved owned-record and cleanup procedure |

Operations and Accounting must approve group composition, commercial pricing,
invoice presentation, failure handling, and the boundary between synchronized
items and Nexus-composed transactions before implementation.

## Requested metadata checklist

Return production and sandbox exports for each applicable category.

### Fields

- [ ] Sales Order standard body fields
- [ ] Sales Order standard line fields
- [ ] Sales Order custom body fields
- [ ] Sales Order custom line fields
- [ ] Referenced Customer, Employee, Opportunity, Job/Project, Term, Item,
      address, tax, class, segment, and Item Group fields
- [ ] Display label, internal ID, type, list/record source, mandatory,
      store-value, default, sourcing, display, role, and scriptability metadata

### Forms and sourcing

- [ ] Active Sales Order forms and preferred-form rules
- [ ] Role, subsidiary, and environment form assignments
- [ ] Field display, default, sourcing, and mandatory overrides
- [ ] Before-load or client behavior that changes displayed or submitted values

### Workflows and scripts

- [ ] Active and scheduled Workflows
- [ ] Workflow exports, versions, release states, and execution order
- [ ] User Event scripts
- [ ] Client scripts that affect submission
- [ ] Scheduled scripts
- [ ] Map/Reduce scripts
- [ ] Mass-update, CSV, integration, or other scripts affecting Sales Orders
- [ ] Deployments, roles, audiences, contexts, logs, and owners

### Searches and bundles

- [ ] Saved Searches used by workflows or scripts
- [ ] Search internal IDs, filters, columns, owners, and consumers
- [ ] Installed bundles and versions
- [ ] Bundle-provided fields, scripts, workflows, forms, searches, and
      dependencies
- [ ] Vendor documentation and support owner

### Numbering, preferences, and features

- [ ] Sales Order and transaction numbering preferences
- [ ] Date, timezone, currency, precision, and accounting preferences
- [ ] Customer, item, pricing, inventory, commitment, fulfillment, and project
      defaults
- [ ] Tax and SuiteTax preferences
- [ ] Company features relevant to Sales Orders
- [ ] Subsidiary, location, form, role, and environment-specific preferences
- [ ] Production/sandbox refresh date and known configuration drift

## Sandbox validation plan

Sandbox validation begins only after metadata review identifies owned test
records, relevant automation, expected timing, and safe cleanup. Every probe
uses a unique correlation ID and records the exact account, role, form,
Customer, source records, field configuration, workflows, scripts, and bundle
versions.

Use at least two representative cases where Customer, Employee, Term, item,
tax, address, subsidiary, location, or form configuration can change the
result. Add null, omitted, invalid, inactive, stale, or reassigned cases only
when approved by the responsible administrator.

### Before creation

Capture:

- authoritative source records and synchronized identifiers;
- Customer, Employee, Term, item, address, tax, Opportunity, and Job/Project
  values relevant to the probe;
- active form, preferences, workflows, scripts, bundles, and deployment
  versions;
- exact outbound Nexus payload or administrator-approved equivalent; and
- expected source, default, or omission behavior for each field.

### Immediate values

Immediately after creation, capture:

- request, response status, headers, `Location`, internal ID, and `tranId` when
  available;
- the expanded Sales Order body and item sublist;
- standard and custom terms;
- Project Manager, Opportunity, Job/Project, origin, and address references;
- generated identity, numbering, date, line-key, and result metadata;
- line quantity, rate, amount, pricing, costing, inventory, and tax fields;
- financial and SuiteTax rollups;
- custom workflow and bundle fields;
- system notes already present; and
- workflow/script status or execution evidence available at that moment.

“Immediate” means the first observable structured read after a successful
create response. It must not be simulated with an arbitrary sleep.

### Post-workflow values

Wait for an observable completion condition: workflow history, system note,
script execution record, status transition, scheduled-run completion, or
another administrator-approved signal. Then capture the same field set again,
plus:

- every changed value;
- the actor, workflow, script, bundle, or native process responsible;
- execution order and timestamp;
- overwrite, clear, and default behavior;
- errors, retries, or partial processing; and
- downstream Sales Order, fulfillment, invoice, tax, or project effects that
  are material to the investigation.

If multiple asynchronous stages exist, capture one state per observable stage.
Do not collapse immediate and final values into a single observation.

### Environment comparison and cleanup

- Compare the sandbox result with read-only production observations and
  configuration.
- Classify every difference by root source; internal IDs may differ without
  changing business meaning.
- Delete, void, or reset only records proven to be owned by the probe and only
  under the administrator-approved cleanup procedure.
- Preserve sanitized evidence externally. Never commit credentials or
  sensitive payloads.

## Evidence acceptance criteria

`UNKNOWN` is an ownership classification. `OWNERSHIP APPROVED` is a governance
gate state, not a replacement classification. A field moves from:

`UNKNOWN` → `OWNERSHIP APPROVED`

without implementation only when all of the following are satisfied:

- [ ] Exact field identity, display name, record type, data type, and
      representation are confirmed.
- [ ] Business purpose and downstream consumers are confirmed.
- [ ] Authoritative source and source-system owner are named.
- [ ] Current destination writer is identified, including native sourcing,
      Workflow, SuiteScript, bundle, synchronization, or manual ownership.
- [ ] Trigger, timing, execution order, overwrite, and null-clearing behavior
      are documented.
- [ ] Immediate and post-automation observations corroborate configuration.
- [ ] Omitted, null, empty, invalid, inactive, stale, reassigned, and missing-
      dependency behavior is defined where applicable.
- [ ] Production and sandbox differences are root-caused.
- [ ] Duplicate-write and competing-source risks are resolved.
- [ ] Exactly one approved ownership classification is assigned:
      `HUBSPOT_SYNC_OWNED`, `NEXUS_OWNED`, `NETSUITE_DERIVED`,
      `NETSUITE_WORKFLOW_OR_SCRIPT_OWNED`,
      `SHARED_READ_ONLY_DEPENDENCY`, or `HISTORICAL_INACTIVE`.
- [ ] The business owner and technical owner approve the classification.
- [ ] Reviewers can answer:
      1. Who owns this field?
      2. Why should Nexus write it instead of relying on the owning system?
- [ ] If Nexus ownership is proposed, the architecture decision, validation,
      audit, failure, compatibility, regression, monitoring, and rollback
      requirements are defined before code changes.

If evidence shows another system owns the field, ownership can be approved
without authorizing Nexus to write it. The appropriate implementation may be
omission, read-only validation, reconciliation, or safe failure when a required
dependency is missing.

## Deliverables

Return one indexed evidence package containing:

1. Production and sandbox Sales Order standard-field metadata exports.
2. Production and sandbox custom body- and line-field metadata exports.
3. Active Sales Order form exports and assignment rules.
4. Workflow inventory and complete exports.
5. SuiteScript inventory, source or approved field-access summaries, and
   deployment exports.
6. Scheduled and Map/Reduce execution schedules and dependencies.
7. Installed-bundle inventory, versions, components, owners, and documentation.
8. Saved Search inventory and definitions used by relevant automation.
9. Numbering, accounting, date, currency, item, pricing, inventory, project,
   tax, and company-feature preferences.
10. Project Manager field, synchronization, Employee-resolution, and exception
    evidence.
11. Standard/custom payment-terms business relationship and production/sandbox
    parity evidence. Standard `terms` write ownership is already closed.
12. Opportunity, Job/Project, generated-field, and report-timestamp ownership
    evidence.
13. SuiteTax configuration, field definitions, calculation evidence, and
    production/sandbox comparison.
14. Item Group metadata, member, pricing, tax, REST/SOAP, invoice, bundle, and
    failure evidence.
15. Correlated immediate and post-automation sandbox observations.
16. Read-only production observations sufficient to compare business behavior.
17. Named business owner, technical owner, and approver for each unresolved
    field or automation.
18. An evidence index mapping each file or observation to field IDs,
    environment, capture date, source owner, and the applicable decision-gate
    criterion.
19. An explicit list of unavailable evidence, its owner, and the action needed
    to obtain it.

The evidence package is complete only when another reviewer can independently
trace each field from source through final destination state and determine
ownership without relying on conversation or institutional memory.
