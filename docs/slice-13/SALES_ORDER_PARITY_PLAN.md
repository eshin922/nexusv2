# Sales Order parity audit plan

## Promise and flow

The audit proves field-level traceability across:

`HubSpot → Nexus → NetSuite Sandbox`

Literal production/sandbox identity is not required. Completed Item Groups are
the only pre-approved Accounting-visible change. Every other relevant field
must be commercially and operationally equivalent or have an approved,
root-caused environment distinction.

## Audit method

1. Agree the accounting-relevant field universe with Accounting and NetSuite
   administrators.
2. Export source evidence from the authoritative production transaction and
   configuration evidence from both NetSuite environments.
3. Trace HubSpot source property, Nexus cache/persisted value, transformation,
   payload field, sandbox observed value, and downstream behavior.
4. Compare meaning, units, precision, null/default behavior, references, line
   cardinality, totals, tax, dates, classifications, and identifiers.
5. Assign exactly one classification and evidence owner.
6. Resolve `UNKNOWN` and `BLOCKER` before shadow mode exit.
7. Add regression coverage at the lowest appropriate layer for every confirmed
   mapping or defect.

## Classification vocabulary

| Classification | Meaning |
|---|---|
| `PARITY` | Same commercial/operational meaning and acceptable value behavior. |
| `INTENTIONAL_CHANGE` | Approved difference with owner, rationale, and acceptance evidence. |
| `ENVIRONMENT_DIFFERENCE` | Root-caused configuration/reference difference with equivalent behavior. |
| `SOURCE_DATA_GAP` | Required source value is absent or unusable before Nexus mapping. |
| `MAPPING_GAP` | Source exists but Nexus omits, transforms, or routes it incorrectly. |
| `NETSUITE_CONFIGURATION` | Destination behavior differs due to NetSuite setup. |
| `UNKNOWN` | Evidence is incomplete; an owner/action/date is mandatory. |
| `BLOCKER` | Difference prevents safe commercial or operational equivalence. |

## Permanent parity matrix template

One row represents one accounting-relevant body or line field.

| Field ID | Business meaning | Level | HubSpot source/evidence | Nexus persisted source | Nexus DTO/property | Transformation/default | NetSuite target | Production observed | Sandbox observed | Tolerance | Classification | Root cause | Required evidence link | Owner | Action/due date | Regression test | Approval |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TBD | TBD | Header/line | Requires manual discovery | TBD | TBD | TBD | TBD | Requires manual discovery | TBD | TBD | `UNKNOWN` | TBD | TBD | Requires manual discovery | TBD | TBD | TBD |

The maintained matrix must cover at least customer/entity, subsidiary, status,
terms, memo/provenance, dates, ship-to behavior, tax behavior, classifications,
custom segments, project manager, custom body fields, line item identity,
description, quantity, rate, amount/total behavior, unit cost, SKU breadcrumb,
Item Group composition, and idempotency/audit identifiers.

## Required evidence

- Immutable source transaction identifier and capture timestamp.
- HubSpot property internal name, raw value, label, and association evidence.
- Nexus database record IDs and canonical persisted values.
- Versioned code reference for each transformation.
- Sanitized outbound payload and NetSuite response.
- NetSuite field metadata and production/sandbox configuration evidence.
- Screenshots or exports only when structured API/config evidence is
  unavailable.
- Independent Accounting/Operations acceptance for commercial behavior.
- Regression-test name/result for confirmed contracts.

Evidence must be access-controlled, sanitized, immutable for the audit period,
and referenced rather than embedded when it contains sensitive customer data.

## Item Group and pricing gate

Completed Item Groups are `INTENTIONAL_CHANGE` only after Accounting verifies
their line presentation and downstream behavior. NetSuite may accept an
upstream `$0.00` catalog price, but Nexus must submit the approved transaction
rate; zero catalog price must never become the commercial rate.

## Existing evidence and limitations

`scripts/parity/so-field-parity.ts` compares a generated sandbox SO with fixed
reference SO2646 and contains hand-maintained difference reasons. It is a
starting probe, not the permanent matrix: reference representativeness,
credential safety, fixture lifecycle, field completeness, and classifications
require review.

## Audit exit criteria

- Field universe approved by Accounting.
- Every row has complete evidence and no `UNKNOWN`/`BLOCKER`.
- Every `INTENTIONAL_CHANGE` has explicit approval.
- Environment distinctions are root-caused, not merely observed.
- Totals, rates, quantities, classifications, and downstream behavior reconcile.
- Permanent regression coverage protects confirmed mappings.
