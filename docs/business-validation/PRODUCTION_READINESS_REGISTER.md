# Slice 13 Production Readiness Register

## Purpose

This is the business-gate register for the remaining Slice 13 V1 production
work. It records scope, accountable ownership, dependencies, exit criteria,
status, and unresolved business questions. Technical Go/No-Go execution
remains governed by the
[Slice 13 readiness checklist](../slice-13/GO_LIVE_READINESS_CHECKLIST.md).

V1 operator scope excludes manual project refresh and Project Archive/
Unarchive until synchronization overwrite boundaries and archive lifecycle,
authorization, reporting, and recovery have approved contracts. Their retained
server/schema compatibility does not make them production-ready workflows; see
PB-011 in the [Production Bug Register](../production-bugs/PRODUCTION_BUG_REGISTER.md).

## V1 gates

| Order | Gate | Business owner | Technical owner | Dependencies | Exit criteria | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Pricing Vendor identity | Purchasing/PM | Nexus engineering | Closed: HubSpot `type=VENDOR`; direct provider read boundary; completed legacy census; Pricing Date removed from V1 by product review | Stable optional HubSpot Company identity and immutable name snapshot persist; legacy values remain read-only; dormant Pricing Date values remain untouched; no NetSuite/procurement projection; VAL-104 and PB-008 visual review pass | **V1 COMPLETE** |
| 2 | Below-floor margin approval | Finance/Commercial Leadership | Nexus engineering; Slack administrator for routing | Governed Commercial Approver permission/list; initial membership; self-approval and notification policy | Exact tier/version/economic state requires valid authorized approval; material economics invalidate; Slack failure never approves | **BUSINESS CONTRACT APPROVED — implementation open** |
| 3 | Idempotent Sales Order send | Accounting | Nexus engineering; NetSuite administrator | Durable send identity; frozen payload; correlation/recovery evidence; concurrency contract | One quote revision creates at most one Sales Order; response-loss and concurrency converge safely | **INTEGRITY CONTRACT CONFIRMED — implementation open** |
| 4 | Item Group applicability and pricing | Accounting/Finance | Nexus engineering; NetSuite administrator | Canonical applicability datum; controlled member-rate pricing evidence; required permissions; durable send orchestration | Applicable completion creates/reuses one deterministic group, uses it once, and preserves accepted commercial total; non-applicable flows remain correct | **OWNERSHIP SETTLED — applicability/pricing closure open** |

## Dependency order

1. Pricing Vendor is independent and establishes the first bounded V1 data
   contract.
2. Below-floor approval closes commercial authorization before ERP completion.
3. Durable send identity and recovery land before Item Group side effects are
   wired into completion.
4. Item Group implementation uses the durable operation model and closes the
   intended Accounting-visible change.
5. Cross-gate lifecycle validation proves the combined production workflow.

## Unresolved business questions

### Pricing Vendor

No unresolved business question remains. Final readiness depends on focused
validation and review of the additive migration and compatibility behavior.
Those checks passed; the gate is closed.

### Below-floor approval

- What governed list or permission identifies Commercial Approvers?
- Who owns membership and who are the initial approvers?
- Is self-approval allowed?
- Is one approval sufficient?
- Is Slack availability required for launch?

### Idempotent Sales Order send

No remaining business-policy question is confirmed. External correlation and
recovery capabilities remain technical evidence gates.

### Item Group

- What existing business datum determines detailed items, Item Group, or
  finished-good Assembly?
- What controlled sandbox result approves the member-rate pricing procedure?
- Nexus-authored reusable components currently create HubSpot Products without
  setting `price`. HubSpot → NetSuite native synchronization may default or
  source an item price, but the repository does not prove it. Before Item Group
  go-live, verify that newly synchronized items satisfy the item-level pricing
  prerequisite without allowing a `$0.00` catalog placeholder to become the
  commercial Sales Order price.

## Scope boundaries

The following do not close or expand these V1 gates:

- vendor quote parsing;
- vendor recommendations or awarded-vendor selection;
- procurement or Purchase Order automation;
- generalized approval orchestration;
- new Program or Product Family entities;
- SuiteTax redesign;
- broad commercial transaction redesign.
