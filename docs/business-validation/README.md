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
- [BV-009 — Freight Treatment](BV-009-freight-treatment.md) — ⚠️ **RECONSTRUCTION, NOT RATIFIED**
- [Production Readiness Register](PRODUCTION_READINESS_REGISTER.md)

BV-006 is the [Product Structure Contract](BV-006-product-structure-contract.md).

BV-007 is the [Product Setup Workflow](BV-007-product-setup-workflow.md).

BV-008 is the
[Commercial Product Transition](BV-008-commercial-product-transition.md).

BV-002 is not assigned in the completed Business Validation work. Identifiers
are stable and are not renumbered to close gaps.

## ⚠️ BV-009 was cited before it was written, and was never written

BV-009 is cited as governing authority in eleven places across five files,
including production code. **No such document has ever existed** in any branch
at any point in history — verified 2026-08-04.

[BV-009 — Freight Treatment](BV-009-freight-treatment.md) is a **reconstruction
assembled from those citations**. It quotes only text that already exists in
documents citing BV-009; nothing is inferred or filled in. **It is not
ratified** and is not business authority until Edward ratifies, amends, or
rejects it. Tracked as [OD-001](../OPEN_DECISIONS.md).

**The generalisable lesson: an identifier is not a document.** Citing one
creates the appearance of authority without the substance, and the gap is
invisible until someone follows the reference. When a Business Validation
document is cited by a phase specification or by code, the document must exist
before the citation ships.

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
