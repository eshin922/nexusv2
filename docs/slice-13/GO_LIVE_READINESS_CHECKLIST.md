# Slice 13 Go-Live readiness checklist

This is the authoritative production Go / No-Go dashboard for Slice 13.
Detailed procedures live in their linked plans. Status values are `NOT
STARTED`, `IN PROGRESS`, `BLOCKED`, `READY`, or `APPROVED`. An owner shown as
**Requires manual discovery** must be assigned before the workstream can be
`READY`.

| Workstream | Owner | Status | Dependencies | Blocking issues | Completion criteria |
|---|---|---|---|---|---|
| 13.0 system discovery | Requires manual discovery | IN PROGRESS | Repository and administrator access | External configuration/owners unknown | Discovery report verified; every unknown has action/owner |
| 13.1 SO parity audit | Requires manual discovery | NOT STARTED | Field universe, representative evidence | Matrix not populated | No `UNKNOWN`/`BLOCKER`; Accounting approval |
| 13.2 integration inventory | Requires manual discovery | IN PROGRESS | HubSpot, NetSuite, CI/hosting admin exports | External automations unknown | Every writer/trigger/owner/status verified |
| Security and environment isolation | Requires manual discovery | NOT STARTED | Account/role/secret inventory | Production scopes not verified | Least privilege, environment identity, rotation and no-shadow-prod-write proof |
| Data/mapping readiness | Requires manual discovery | NOT STARTED | Customer, item, segment, source dictionaries | Completeness unknown | All cohort values resolve; governance assigned |
| Item Group and pricing readiness | Accounting + Operations owners TBD | NOT STARTED | Item setup and parity evidence | Downstream behavior not approved | Completed groups approved; transaction price never derives from zero placeholder |
| Nexus-authored Product catalog readiness | HubSpot integration owner + NetSuite administrator | BLOCKED | HubSpot → NetSuite native Product synchronization evidence | Nexus Product creation omits HubSpot `price`; synchronized NetSuite item pricing/default behavior is unproven | A newly created reusable component synchronizes to one resolvable NetSuite item with an accepted technical catalog price; Nexus commercial transaction pricing remains authoritative |
| 13.3 shadow mode | Requires manual discovery | NOT STARTED | Parity baseline, safe pairing mechanism | Capture mechanism/window unknown | All measurable exit criteria in shadow plan pass |
| 13.4 documentation | Product/technical owner TBD | IN PROGRESS | Confirmed decisions | External runbooks absent | Architecture/contracts/runbooks current and reviewed |
| 13.5 training | Department leaders TBD | NOT STARTED | Stable release candidate/materials | Trainers and dates unknown | All department competency evidence/sign-offs |
| 13.6 UAT | Business owner TBD | NOT STARTED | Parity and training readiness | Cohort/scenarios unknown | Representative UAT passes; no critical defect |
| Observability/support | IT/operations owners TBD | NOT STARTED | Metrics, alerts, support process | SLAs/escalation unknown | Dashboards/alerts tested; staffed support and incident flow |
| Backup/rollback | IT + Accounting owners TBD | NOT STARTED | Legacy exports and reconciliation plan | Retention/transaction disposition unknown | Rollback rehearsed; restore and reconciliation approved |
| 13.7 cutover plan | Cutover manager TBD | NOT STARTED | Inventory, UAT, training, rollback | Window/authority unknown | Timed plan and Go/No-Go packet approved |
| 13.8 go-live | Decision chair TBD | NOT STARTED | All blockers closed | Not eligible | First cohort reconciled; monitoring healthy |
| 13.9 hypercare | Support owner TBD | NOT STARTED | Successful go-live | Duration/thresholds unknown | Observation thresholds pass; open defects accepted |
| 13.10 legacy retirement | Integration owners TBD | NOT STARTED | Hypercare and rollback-window exit | Hidden automations/retention unknown | Legacy writers disabled and verified; evidence retained |

## Go / No-Go record

| Decision item | Value |
|---|---|
| Decision date/window | Requires manual discovery |
| Decision chair | Requires manual discovery |
| Release commit/version | TBD |
| Open blockers | TBD |
| Accepted exceptions and expiry | TBD |
| Rollback authority | Requires manual discovery |
| Accounting sign-off | Pending |
| Operations sign-off | Pending |
| Sales sign-off | Pending |
| PM sign-off | Pending |
| IT/security sign-off | Pending |
| Executive sponsor sign-off | Pending |
| Final decision | NOT READY |

No-Go is mandatory while any blocking workstream, unknown production writer,
unapproved intentional difference, incomplete rollback, or missing department
sign-off remains.
