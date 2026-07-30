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
The ownership vocabulary and write gate are in
[INTEGRATION_OWNERSHIP_PRINCIPLE.md](INTEGRATION_OWNERSHIP_PRINCIPLE.md).

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

The field matrix and the ownership register below form one audit record. Every
matrix ID must appear exactly once in each table.

| Matrix ID | Ownership classification | Why Nexus writes |
|---|---|---|
| SO-000 | `UNKNOWN` | Not approved |
| SO-TERMS | `NETSUITE_DERIVED` | Nexus does not write it; NetSuite populated Customer default Terms when omitted in the controlled sandbox REST probe. |

| Matrix ID | Level | Business name | Technical source field | Source system | Nexus persisted/DTO field | Nexus mapping location | Transformation/default | Destination field | Required by Nexus | Required by NetSuite | Current implementation | Production observed | Sandbox observed | Expected parity behavior | Tolerance | Classification | Root cause | Evidence references | Owner | Remediation / due date | Regression test | Accounting approval |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SO-000 | Header/Line/Group/Derived | TBD | TBD | HubSpot/Nexus/NetSuite | TBD | Repository path and symbol | Copy/derive/resolve/default/omit | TBD | Yes/No | Requires sandbox discovery | Populated/Omitted/Derived/Unsupported | TBD | TBD | Explicit business outcome | Exact or approved tolerance | `UNKNOWN` | TBD | Immutable evidence IDs | Requires manual discovery | TBD | TBD | Pending |
| SO-TERMS | Header | Standard Terms | NetSuite Customer Terms / ERP context | NetSuite | None | `src/lib/netsuite/sales-orders.ts` | Nexus omits; NetSuite derives | `terms` | No | NetSuite-derived | Omitted by Nexus; populated by NetSuite | Requires production parity observation | Terms ID `7` sourced in sandbox probe | NetSuite supplies the approved Customer default without a Nexus write | Exact Term identity or approved environment mapping | `UNKNOWN` | Production/sandbox parity has not yet been established | [Standard Terms Ownership Evidence](STANDARD_TERMS_OWNERSHIP_EVIDENCE.md) | NetSuite | Preserve omission; validate during parity audit | `tests/unit/sales-order-accounting-contract.test.ts` | Ownership approved; parity pending |

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

## Automated baseline status

`tests/unit/sales-order-accounting-contract.test.ts` makes current Nexus
projection behavior release-blocking. It does not classify cross-environment
parity.

| Matrix area | Automated contract status | Parity classification |
|---|---|---|
| Required headers and active optional custom fields | Unit-protected exact mapping | Remains `UNKNOWN` until transaction evidence |
| `custbody_dps_payment_terms_text` | Unit-protected trim/populate/omit behavior | Remains `UNKNOWN` for business parity |
| Standard `terms` | Unit-protected omission; ownership closed as `NETSUITE_DERIVED` | Parity remains `UNKNOWN` until production/sandbox equivalence is observed |
| Project Manager | Omission unit-protected; ownership closed as `HUBSPOT_SYNC_OWNED` | Parity remains `UNKNOWN`; exact create-time component is informational provenance |
| Flat leaf item, quantity, rate, and cost | Unit-protected payload plus completion invariants | Remains `UNKNOWN` until transaction evidence |
| Line `amount` | Unit-protected omission and quantity × rate reconciliation | Remains `UNKNOWN` until NetSuite result evidence |
| Historical, SuiteTax, bundle, opportunity, workflow, and unknown fields | Enumerated non-activation is unit-protected | Evidence classification remains field-specific |
| Idempotency/retry | Deterministic-key tests plus completion ordering and DB uniqueness invariants | Environment behavior still requires evidence |

## Completion rules

- Every field has exactly one ownership classification.
- Nexus writes a field only when evidence answers who owns it and why Nexus
  should write it instead of relying on that owner.
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
