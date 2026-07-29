# Nexus Feature Validation Registry

## Purpose

This registry defines reusable validation coverage across Nexus. Slice 12 is
the first complete lifecycle suite, not the conceptual owner of the platform.

## Coverage Tiers

| Tier | Meaning |
|---|---|
| Tier 1 | Fast unit/contract checks without a browser |
| Tier 2 | Local PostgreSQL integration checks |
| Tier 3 | Isolated browser workflow with fake external boundaries |
| Parity | Separately authorized external sandbox verification |

## Registry

| Feature | Tier 1 | Tier 2 | Tier 3 | Parity | Current status |
|---|---:|---:|---:|---:|---|
| Startup isolation | Implemented | N/A | Pending | N/A | Unit verified |
| Authentication and roles | Partial | Pending | Pending | Not run | Interface implemented |
| HubSpot import/cache | Missing | Missing | Missing | Not run | Direct paths remain |
| Project workspace | Missing | Missing | Missing | N/A | Not registered |
| Quote draft/preview | Missing | Missing | Missing | N/A | Fixture required |
| Quote send/PDF archive | Partial | Missing | Missing | Not run | Storage boundary implemented |
| Client review | Missing | Missing | Missing | N/A | Fixture required |
| Acceptance/rollback | Partial | Missing | Missing | Not run | HubSpot boundary implemented |
| Revision/version chain | Missing | Missing | Missing | N/A | Fixture required |
| Sales Order creation | Partial | Missing | Missing | Not run | NetSuite boundary implemented |
| Quote freeze/completion | Partial | Missing | Missing | N/A | Existing production logic retained |
| Audit trail | Missing | Missing | Missing | N/A | Invariant helpers required |
| Realtime costing updates | Missing | Missing | Missing | Not run | Boundary required |
| Admin configuration | Missing | Missing | Missing | N/A | Not registered |

## Release Reporting Rule

A capability is not “verified” because an interface or fake exists. Registry
status advances only when the corresponding automated layer has executed and
its evidence is attached. External contract simulation never establishes live
HubSpot, NetSuite, Clerk, or Supabase parity.
