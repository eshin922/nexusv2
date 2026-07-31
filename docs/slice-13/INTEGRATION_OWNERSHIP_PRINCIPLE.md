# Integration Ownership Principle

## Principle

HubSpot native synchronization is an intentional architectural dependency,
not a legacy system that Nexus is expected to replace.

- **HubSpot** remains the system of record for CRM objects: companies and
  customers, contacts and clients, deals, and products.
- **NetSuite** remains the system of record for ERP behavior: accounting
  defaults, sourcing, tax, workflows, numbering, and other ERP-derived
  values.
- **Nexus** augments both systems by composing commercial transactions,
  applying manufacturing and packaging intelligence, and orchestrating
  business processes.

Nexus must not duplicate, overwrite, or compete with behavior already owned by
HubSpot or NetSuite unless an architecture decision explicitly transfers that
ownership.

## Governed customer reference

The native HubSpot-to-NetSuite synchronization does not expose a deterministic
runtime mapping that Nexus can consume between a HubSpot Company ID and a
NetSuite Customer internal ID. Nexus therefore maintains a governed:

`HubSpot Company ID -> NetSuite Customer internal ID`

lookup solely to resolve the customer deterministically when composing a Sales
Order. This lookup is a reference mechanism. It does not replace native
synchronization, make Nexus the customer system of record, or authorize Nexus
to create or synchronize customers.

## Mandatory field ownership

Before Nexus writes any NetSuite field, that field must have documented
ownership. Every mapped field must have exactly one ownership classification:

| Ownership classification | Meaning |
|---|---|
| `HUBSPOT_SYNC_OWNED` | The native HubSpot-to-NetSuite synchronization owns the destination value. |
| `NEXUS_OWNED` | An approved architecture decision assigns Nexus responsibility for writing the value. |
| `NETSUITE_DERIVED` | NetSuite derives or defaults the value from ERP configuration or record context. |
| `NETSUITE_WORKFLOW_OR_SCRIPT_OWNED` | A NetSuite workflow, SuiteScript, or other automation owns the value. |
| `SHARED_READ_ONLY_DEPENDENCY` | Nexus may resolve or validate the value but must not become its writer. |
| `HISTORICAL_INACTIVE` | The field is historical and is not active in the current operating contract. |
| `UNKNOWN` | Evidence is insufficient to assign ownership; Nexus must not write the field. |

For every proposed mapping, reviewers must answer:

1. Who owns this field?
2. Why should Nexus write it instead of relying on the owning system?

If evidence cannot answer both questions, Nexus must not write the field.
Repository support for a payload property is not evidence that Nexus owns the
destination field.

## Relationship to parity

Ownership classification and parity classification answer different
questions:

- ownership identifies which system is responsible for a field;
- parity classifies the observed relationship between the approved source and
  production or sandbox result.

Every parity-matrix row therefore records both. A field cannot move from
`UNKNOWN` ownership to a Nexus payload merely because its sandbox value is
missing or differs from production.
