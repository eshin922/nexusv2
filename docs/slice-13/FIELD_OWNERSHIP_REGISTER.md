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

| Field | Identity Resolution Owner | Transaction Population Owner | Nexus Writes? | Decision Status | Provenance Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Standard Terms (`terms`) | NetSuite Customer/ERP context | `NETSUITE_DERIVED` | No; omit and validate the derived result | **CLOSED** | Native sourcing versus synchronous NetSuite automation remains informational | [Standard Terms Ownership Evidence](STANDARD_TERMS_OWNERSHIP_EVIDENCE.md) |
| Project Manager (`custbody_project_manager`) | HubSpot Integration via NetSuite Employee `HubSpot Project Manager ID` | `HUBSPOT_SYNC_OWNED` | No; omit and do not create a competing dictionary | **CLOSED for Nexus implementation** | **OPEN — informational only:** exact create-time integration component | [Project Manager Propagation Evidence](PROJECT_MANAGER_PROPAGATION_EVIDENCE.md) |

Additional fields must be added only when their evidence report reaches a
governance decision. Probable ownership is not an approved classification.
