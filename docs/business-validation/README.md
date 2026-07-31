# Business Validation Library

## Purpose

This library records approved business requirements, decisions, invariants,
and production-readiness gates before implementation begins. It complements
technical architecture and validation documentation; it does not replace
either.

Implementation work must preserve the conclusions and unresolved questions in
the applicable Business Validation document. A technical capability is not
authorization to change a business rule.

## Method

Business Validation follows this order:

1. Business requirement
2. Business invariant
3. Data integrity
4. Architecture
5. Implementation

Each document distinguishes confirmed behavior from unresolved business
questions. Open questions remain implementation gates when the answer changes
the business contract.

## Current library

- [BV-001 — Pricing Vendor Identity](BV-001-pricing-vendor-identity.md)
- [BV-003 — Master Data Ownership](BV-003-master-data-ownership.md)
- [BV-004 — Business Decision Matrix](BV-004-business-decision-matrix.md)
- [BV-005 — Below-Floor Margin Approval](BV-005-below-floor-margin-approval.md)
- [Production Readiness Register](PRODUCTION_READINESS_REGISTER.md)

BV-002 is not assigned in the completed Business Validation work. Identifiers
are stable and are not renumbered to close gaps.

## Relationship to other authoritative documents

- Field ownership across system boundaries follows the
  [Data Traceability and Field Governance standard](../architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md).
- Sales Order field behavior follows the
  [Accounting Field Universe](../slice-13/ACCOUNTING_FIELD_UNIVERSE.md) and
  [Sales Order Parity Matrix](../slice-13/SALES_ORDER_PARITY_MATRIX.md).
- Slice sequencing and release preparation follow the
  [Slice 13 Execution Plan](../slice-13/SLICE_13_EXECUTION_PLAN.md).
- Validation acceptance follows the
  [authoritative validation merge gate](../validation/merge-gate.md).
