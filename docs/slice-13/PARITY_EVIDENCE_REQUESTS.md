# Slice 13.1 parity evidence requests

## Purpose

These packets request the minimum structured evidence needed before Nexus may
implement the two mappings that remain `UNKNOWN` in
[ACCOUNTING_FIELD_UNIVERSE.md](ACCOUNTING_FIELD_UNIVERSE.md). A single example,
identifier guess, screenshot, or undocumented verbal rule is insufficient.

Evidence must follow [PARITY_EVIDENCE_GUIDE.md](PARITY_EVIDENCE_GUIDE.md) and
be referenced from [SALES_ORDER_PARITY_MATRIX.md](SALES_ORDER_PARITY_MATRIX.md).

## Evidence Packet 1 — Project Manager

### Decision required

Identify the authoritative business source for the Sales Order project manager
and the governed mapping from that source identity to
`custbody_project_manager.id`.

### Candidate-source comparison

| Candidate | Repository evidence | Evidence required before selection |
|---|---|---|
| HubSpot deal owner | Cached as `hubspot_owner_id`; projects can link that owner to a Nexus sales-rep user | Confirm the deal owner is the business project manager, not merely Sales; map it to NetSuite employees |
| Configured HubSpot PM property | `HUBSPOT_PM_PROPERTY` can populate cached `pm_id`, but the property internal name is explicitly TBD | Identify property, type, option/owner semantics, population rules, and mappings |
| Nexus `projects.pmUserId` | Nullable Nexus user FK; fixture and UI reads exist | Establish assignment authority/timing and mapping to NetSuite employee |
| Another approved source | None established by repository evidence | Name its owner, lifecycle, identifier contract, and lineage |

Do not select a candidate until business and technical evidence agree.

### Required evidence

- authoritative source field and source system;
- source-system identifier type and sample source value;
- target NetSuite employee internal ID and display identity;
- at least two independently confirmed source-to-target mappings;
- behavior when the source is null or no mapping exists;
- behavior when the mapped NetSuite employee is inactive;
- production and sandbox parity or a root-caused environment distinction;
- business and technical owner of the mapping dictionary;
- governed dictionary storage and access;
- refresh cadence and trigger;
- change management for reassignment, activation/inactivation, identifier
  changes, and rollback;
- successful sandbox payload/response using
  `custbody_project_manager: { id: <employee-internal-id> }`;
- blocking, omission, or fallback behavior for every failure class.

### Acceptance record

| Decision | Value |
|---|---|
| Selected source | `UNKNOWN` |
| Mapping owner | Requires manual discovery |
| Null behavior | Requires manual discovery |
| Unmapped behavior | Requires manual discovery |
| Inactive behavior | Requires manual discovery |
| Production/sandbox classification | `UNKNOWN` |
| Accounting/Operations approval | Pending |

## Evidence Packet 2 — Standard Terms — CLOSED

### Decision

Standard NetSuite Sales Order `terms` is `NETSUITE_DERIVED`. Nexus must omit
the field. A controlled sandbox REST creation probe omitted `terms` and all
custom body fields; the immediate GET returned Customer default Terms ID `7`.
The probe record was memo-verified, deleted with HTTP `204`, and confirmed
unavailable with a final HTTP `404`.

The full evidence and decision are recorded in
[Standard Terms Ownership Evidence](STANDARD_TERMS_OWNERSHIP_EVIDENCE.md).

### Historical evidence request

- NetSuite field script ID, business identity, and record/field type;
- whether REST create accepts an internal ID, string, reference object, or
  another representation;
- a sanitized successful Sales Order create payload and resulting structured
  response;
- defaulting when `terms` is omitted, including customer, form, workflow, and
  script influences;
- whether `custbody_dps_payment_terms_text` supplements, mirrors, or replaces
  standard `terms`;
- whether both fields are required and which is authoritative for invoicing,
  reporting, approvals, and customer communication;
- production and sandbox configuration parity or a root-caused difference;
- at least two payment-term examples with source value, accepted payload,
  returned value, and displayed business meaning;
- null/blank and invalid/inactive/unknown-term behavior;
- source and owner of the terms dictionary;
- behavior when an immutable quote terms snapshot has no dictionary match.

### Historical sandbox probe plan

1. Omit standard `terms` while sending the current custom text field.
2. Send each supported standard-field representation identified by metadata.
3. Verify the immediate response and post-automation final record.
4. Repeat for two distinct payment terms and one invalid term.
5. Compare metadata/defaulting with production without writing production data.

### Acceptance record

| Decision | Value |
|---|---|
| Standard field type | NetSuite reference field |
| Accepted REST representation | Not required because Nexus is not authorized to write it |
| Authoritative source | NetSuite Customer/ERP context |
| Relationship to custom text field | `UNKNOWN` |
| Omitted/default behavior | NetSuite populated Customer default Terms ID `7` in the controlled sandbox probe |
| Invalid-term behavior | Not required for the approved omission contract |
| Ownership classification | `NETSUITE_DERIVED` |
| Decision gate | **CLOSED** |
| Production/sandbox parity classification | `UNKNOWN`; requires parity observation, not another ownership probe |
