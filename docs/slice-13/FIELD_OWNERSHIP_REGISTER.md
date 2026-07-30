# Sales Order Field Ownership Register

## Purpose

This is the permanent ownership register for Sales Order fields investigated
under the
[Data Traceability and Field Governance standard](../architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md).
It records architectural write authority. It does not replace the
[Sales Order Parity Matrix](SALES_ORDER_PARITY_MATRIX.md), which records
cross-system and cross-environment behavioral comparison.

Every field must have exactly one ownership classification. `UNKNOWN` blocks a
new Nexus write.

## Register

| Field | Record | Ownership classification | Nexus behavior | Decision status | Evidence |
| --- | --- | --- | --- | --- | --- |
| Standard Terms (`terms`) | NetSuite Sales Order | `NETSUITE_DERIVED` | Omit; validate the NetSuite-derived result | **CLOSED** | [Standard Terms Ownership Evidence](STANDARD_TERMS_OWNERSHIP_EVIDENCE.md) |
| Customer default Terms (`terms`) | NetSuite Customer | `SHARED_READ_ONLY_DEPENDENCY` | Do not write; rely on NetSuite ERP context | **CLOSED for Sales Order sourcing** | [Standard Terms Ownership Evidence](STANDARD_TERMS_OWNERSHIP_EVIDENCE.md) |
| Project Manager (`custbody_project_manager`) | NetSuite Sales Order | `UNKNOWN` | Omit | Open | [Project Manager Propagation Evidence](PROJECT_MANAGER_PROPAGATION_EVIDENCE.md) |

Additional fields must be added only when their evidence report reaches a
governance decision. Probable ownership is not an approved classification.
