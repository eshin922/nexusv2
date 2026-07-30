# Permanent Sales Order parity matrix

## Use

This is the reusable audit record for the field universe in
[ACCOUNTING_FIELD_UNIVERSE.md](ACCOUNTING_FIELD_UNIVERSE.md). Duplicate the
template row for every header, line, Item Group, derived, workflow-populated,
and Accounting-relevant field. Do not collapse multiple destination fields
into one row merely because Nexus currently mirrors their source.

Allowed classifications:

- `PARITY`
- `INTENTIONAL_CHANGE`
- `ENVIRONMENT_DIFFERENCE`
- `SOURCE_DATA_GAP`
- `MAPPING_GAP`
- `NETSUITE_CONFIGURATION`
- `UNKNOWN`
- `BLOCKER`

The evidence standard and approval rules are in
[PARITY_EVIDENCE_GUIDE.md](PARITY_EVIDENCE_GUIDE.md).

## Audit metadata

| Attribute | Value |
|---|---|
| Audit ID | TBD |
| Nexus commit | TBD |
| Reference transaction(s) | Requires manual discovery |
| HubSpot portal/account | Requires manual discovery |
| Production NetSuite account | Requires manual discovery |
| Sandbox NetSuite account | Requires manual discovery |
| Evidence root | Requires manual discovery |
| Accounting approver | Requires manual discovery |
| Technical approver | Requires manual discovery |
| Audit date | TBD |

## Field matrix template

| Matrix ID | Level | Business name | Technical source field | Source system | Nexus persisted/DTO field | Nexus mapping location | Transformation/default | Destination field | Required by Nexus | Required by NetSuite | Current implementation | Production observed | Sandbox observed | Expected parity behavior | Tolerance | Classification | Root cause | Evidence references | Owner | Remediation / due date | Regression test | Accounting approval |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SO-000 | Header/Line/Group/Derived | TBD | TBD | HubSpot/Nexus/NetSuite | TBD | Repository path and symbol | Copy/derive/resolve/default/omit | TBD | Yes/No | Requires sandbox discovery | Populated/Omitted/Derived/Unsupported | TBD | TBD | Explicit business outcome | Exact or approved tolerance | `UNKNOWN` | TBD | Immutable evidence IDs | Requires manual discovery | TBD | TBD | Pending |

## Required seed rows

The audit must instantiate, at minimum:

- every outbound header and line row in
  [the accounting field universe](ACCOUNTING_FIELD_UNIVERSE.md);
- every custom body and custom line field;
- every mirrored destination as a separate row;
- every Item Group record/member field and the future Sales Order group-line
  behavior;
- every NetSuite-generated, workflow-populated, SuiteTax, bundle, shipping,
  financial-rollup, and lifecycle field used by Accounting or referenced by
  the parity probe;
- any additional fields discovered from full production/sandbox responses or
  administrator exports.

## Completion rules

- One field has one final classification.
- `UNKNOWN` and `BLOCKER` prevent audit exit.
- `INTENTIONAL_CHANGE` requires explicit Accounting approval; completed Item
  Groups are the only pre-approved category, but their exact behavior still
  requires evidence.
- `ENVIRONMENT_DIFFERENCE` requires root-source configuration evidence and
  commercially/operationally equivalent behavior.
- A `$0.00` item catalog price cannot justify a `$0.00` transaction rate.
- Derived fields require input, rule, precision, output, and downstream
  evidence.
- A legacy probe comment is not approval evidence.
