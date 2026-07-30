# Project Manager propagation ownership packet

## Executive conclusion

The NetSuite Sales Order Project Manager field is **not authorized for a Nexus
production mapping**.

Repository evidence proves that:

- HubSpot has separate Deal Owner and Project Manager concepts.
- Nexus always caches the Deal Owner.
- Nexus can optionally cache a HubSpot PM owner reference, but only when
  `HUBSPOT_PM_PROPERTY` is configured; it is currently unset.
- `projects.pmUserId` is a nullable foreign key to a Nexus user. Import sets it
  to `null`, refresh does not update it, and no assignment action was found.
- the pure Sales Order builder can serialize an explicitly supplied NetSuite
  employee reference to `custbody_project_manager`;
- the real completion path never supplies that reference, so Nexus currently
  omits the field.

Read-only HubSpot production metadata identifies the active deal property
`project_manager` as an OWNER-referenced select and confirms that it is
populated independently of `hubspot_owner_id`. This establishes the CRM-side
candidate identity, but not the authoritative Sales Order source or the
HubSpot-to-NetSuite propagation mechanism.

No repository or accessible NetSuite evidence proves whether native
synchronization, transaction sourcing, a workflow, SuiteScript, or another
mechanism owns the resulting Sales Order value. The provisional ownership
classification therefore remains `UNKNOWN` under the
[Integration Ownership Principle](INTEGRATION_OWNERSHIP_PRINCIPLE.md).

## Scope and evidence boundary

This packet covers only the Project Manager value on a NetSuite Sales Order.
It follows the evidence rules in
[PARITY_EVIDENCE_GUIDE.md](PARITY_EVIDENCE_GUIDE.md) and leaves the
[permanent parity matrix](SALES_ORDER_PARITY_MATRIX.md) unchanged.

Evidence labels used below:

- **Repository-confirmed:** executable code, schema, test, or committed
  contract.
- **Repository-recorded external evidence:** a committed comment or document
  describing an earlier external observation; useful as a lead, not current
  administrator proof.
- **Externally confirmed, read-only:** metadata or records observed through a
  read-only API call during this checkpoint.
- **Inference:** consistent with the evidence, but not authoritative.
- **Administrator evidence required:** active SaaS configuration or business
  ownership absent from the repository.
- **Controlled sandbox probe required:** behavior that must be observed on an
  owned sandbox transaction after administrator evidence and access gates pass.

No production write was performed. No sandbox write was performed.

## Known field identities

| Concept | Technical identity | Record/system | Evidence status |
|---|---|---|---|
| HubSpot Deal Owner | `hubspot_owner_id` | HubSpot deal property | Repository-confirmed |
| HubSpot Project Manager | `project_manager` | HubSpot deal property; active OWNER-referenced enumeration/select | Externally confirmed, read-only on 2026-07-30 |
| Configurable Nexus PM source | `HUBSPOT_PM_PROPERTY` | Nexus runtime configuration naming a HubSpot deal property | Repository-confirmed; currently unset |
| Cached HubSpot PM identity | `hubspot_deals_cache.pm_id`, `pm_name`, `pm_email` | Nexus cache | Repository-confirmed; population is configuration-gated |
| Nexus project PM | `projects.pm_user_id` / `projects.pmUserId` | Nullable FK to `users.id` | Repository-confirmed |
| Nexus user HubSpot identity | `users.hubspot_owner_id` / `users.hubspotOwnerId` | Nexus user record | Repository-confirmed |
| Builder input | `projectManagerNsId` | `SalesOrderPayloadInput` | Repository-confirmed |
| NetSuite destination script ID | `custbody_project_manager` | Sales Order body field | Repository-confirmed as the intended builder destination; active NetSuite field metadata remains unverified |
| Intended destination value shape | `{ id: projectManagerNsId }` | NetSuite REST Sales Order payload | Repository-confirmed builder behavior; NetSuite acceptance/type remains unverified |

The repository contains no NetSuite employee ID column on `users` or
`projects`, no HubSpot-user-to-NetSuite-employee mapping table, and no resolver
for that relationship.

## End-to-end propagation trace

### 1. HubSpot source

`src/lib/hubspot-cache.ts` always requests `hubspot_owner_id`. It requests a PM
property only when `HUBSPOT_PM_PROPERTY` is set. The configured property's raw
value becomes `pmId`; the existing HubSpot owner dictionary supplies
`pmName`/`pmEmail` when it can resolve that owner.

Current local configuration has `HUBSPOT_PM_PROPERTY` unset. Consequently the
current Nexus cache path does not request `project_manager` and writes cached
PM fields as `null`.

Read-only production HubSpot metadata observed during this checkpoint:

- portal: `21497798`;
- property internal name: `project_manager`;
- label: `Project Manager`;
- type/field type: `enumeration` / `select`;
- referenced object type: `OWNER`;
- archived: `false`.

A read-only sample of populated deals found nine distinct Project Manager owner
IDs. At least three resolved to active DPS owner records. The sampled Project
Manager frequently differed from Deal Owner, disproving any safe assumption
that `hubspot_owner_id` and `project_manager` are interchangeable. Raw customer
deal details and personal data were not persisted in this document.

### 2. Native HubSpot-to-NetSuite synchronization

The governing architecture establishes that native HubSpot-to-NetSuite
synchronization remains authoritative for established CRM mappings. However,
the repository contains no export of that integration's field map, matching
rules, overwrite behavior, null-clearing behavior, or timing for
`project_manager`.

It is therefore unknown whether the native integration:

- maps `project_manager`, `hubspot_owner_id`, or another property;
- resolves a HubSpot owner to a NetSuite employee;
- writes Project Manager to a synchronized customer, opportunity, job, or
  transaction-related record;
- leaves the value for NetSuite sourcing or automation;
- ignores Project Manager entirely.

### 3. NetSuite source records and employee identity

No deterministic HubSpot-owner-to-NetSuite-employee dictionary exists in the
repository. `users.hubspot_owner_id` maps a Nexus user to a HubSpot owner only;
it carries no NetSuite employee internal ID.

The configured NetSuite account was verified as a sandbox. During this
checkpoint:

- the metadata-catalog root for `salesOrder` returned only record name/links,
  not custom-field metadata;
- read-only Sales Order GET and SuiteQL employee/Sales Order queries failed
  with NetSuite `Invalid login attempt`.

Those failures are an access/setup issue. They provide no evidence about field
presence, employee mappings, sourcing, or automation.

### 4. Sales Order sourcing and automation

No active NetSuite workflow, SuiteScript, form-sourcing export, execution log,
or before/after Sales Order evidence is versioned in the repository for
`custbody_project_manager`. The field's immediate value at create time and its
post-automation value are both unknown.

### 5. Nexus project identity

On project import, Nexus:

- stores HubSpot Deal Owner in `projects.hubspot_owner_id`;
- attempts to resolve a Nexus Sales Rep by the cached owner email;
- explicitly initializes `projects.pm_user_id` to `null`.

Project refresh updates Deal Owner and Sales Rep, but does not update
`projects.pm_user_id` from cached PM data. No repository action that assigns
`projects.pm_user_id` was found. UI reads join it to `users`, which proves it is
a Nexus user FK, not a HubSpot or NetSuite employee ID.

### 6. Nexus Sales Order creation

`src/lib/netsuite/sales-orders.ts` conditionally emits:

```text
custbody_project_manager: { id: projectManagerNsId }
```

only for a truthy explicit input. Null or missing input is omitted.

`src/lib/netsuite/mark-complete.ts` does not pass `projectManagerNsId` when it
builds the real completion payload. The release-blocking accounting contract
test asserts this omission. Nexus therefore does not currently read, resolve,
or write a NetSuite Project Manager during completion.

## Evidence table

| Conclusion | Evidence category | Source | Strength / limitation |
|---|---|---|---|
| HubSpot Deal Owner and Project Manager are distinct properties | Externally confirmed, read-only | HubSpot deal metadata and populated-deal sample, 2026-07-30 | Strong for CRM identity; does not prove NetSuite propagation |
| Exact HubSpot PM property is `project_manager` | Externally confirmed, read-only | HubSpot production metadata, portal `21497798` | Strong; repository documentation still describes the name as TBD |
| PM property values reference HubSpot owners | Externally confirmed, read-only | `referencedObjectType=OWNER` | Strong; not a NetSuite employee identity |
| Nexus PM caching is environment-gated | Repository-confirmed | `src/lib/hubspot-cache.ts` | Strong |
| Current environment does not enable PM caching | Repository-confirmed local configuration observation | `.env.local` presence check; value not printed because it is unset | Applies to the inspected environment only |
| `projects.pmUserId` is a Nexus user FK | Repository-confirmed | `src/db/schema.ts` | Strong |
| Import initializes project PM to null and refresh does not maintain it | Repository-confirmed | `src/app/actions/projects.ts` | Strong |
| No Nexus-to-NetSuite employee dictionary/resolver exists | Repository-confirmed search | Schema, actions, NetSuite modules, fixtures, tests | Strong for current repository |
| Builder supports `custbody_project_manager` with an ID reference | Repository-confirmed | `src/lib/netsuite/sales-orders.ts`; `tests/unit/sales-order-accounting-contract.test.ts` | Proves serialization only, not NetSuite acceptance or ownership |
| Completion omits Project Manager | Repository-confirmed | `src/lib/netsuite/mark-complete.ts`; accounting contract test | Strong |
| Native sync ownership/propagation is known | Administrator evidence required | No active sync export in repository | Unknown |
| Sales Order sourcing/workflow timing is known | Administrator evidence and controlled observation required | No form/workflow/script export or before/after record | Unknown |
| Sandbox and production behavior are equivalent | Administrator evidence and controlled observation required | No comparable records/configuration | Unknown |

Repository history shows `projectManagerNsId` and
`custbody_project_manager` were introduced in `1d2c93a` as optional builder
capability. The introducing diff included only the conditional serializer and
the comment “if HubSpot owner id maps to NS employee”; it did not add a source,
dictionary, resolver, or completion wiring. That comment is not an ownership
decision.

## Current Nexus behavior

| Condition | Current behavior |
|---|---|
| HubSpot `project_manager` missing | Current completion is unchanged and omits the NetSuite field |
| HubSpot PM owner missing from owner lookup | If PM caching were enabled, `pmId` could remain while cached PM name/email are null; completion still omits the NetSuite field |
| HubSpot PM inactive or archived | Not defined by repository behavior; current completion omits the NetSuite field |
| HubSpot PM has no NetSuite employee match | No lookup is attempted; current completion omits the field |
| HubSpot PM changes | If PM caching were enabled, deal-cache sync can refresh PM fields; `projects.pmUserId` is not updated by that path; completion still omits the field |
| `projects.pmUserId` set by external/manual data mutation | UI can display the joined Nexus user, but completion does not read it for NetSuite |
| `projectManagerNsId` supplied directly to pure builder | Builder emits `{ id: value }`; the production completion path never supplies it |

No current behavior establishes whether omission causes NetSuite to leave the
field blank, source it immediately, or populate it later through automation.

## Ownership analysis

### Provisional classification: `UNKNOWN`

`UNKNOWN` is required because:

- the native sync's Project Manager mapping is unavailable;
- the authoritative business source has not been approved;
- the NetSuite field metadata and employee reference contract are unavailable;
- customer/opportunity/job/form sourcing is unverified;
- workflow/SuiteScript ownership and timing are unverified;
- no governed cross-system employee mapping exists;
- sandbox/production parity is unverified.

Possible final classifications remain:

- `HUBSPOT_SYNC_OWNED` if native synchronization directly maintains the value;
- `NETSUITE_DERIVED` if Sales Order sourcing inherits it from an authoritative
  synchronized record;
- `NETSUITE_WORKFLOW_OR_SCRIPT_OWNED` if automation maintains it;
- `SHARED_READ_ONLY_DEPENDENCY` if Nexus should only validate or reference an
  already synchronized identity;
- `NEXUS_OWNED` only if architecture explicitly transfers Sales Order field
  responsibility to Nexus and provides a governed employee-resolution
  contract.

Repository evidence does not justify selecting among them.

## Missing evidence

Minimum evidence needed for a final ownership decision:

1. HubSpot native-sync export covering Deal Owner, `project_manager`, employee
   references, and every target record/field it affects.
2. NetSuite production and sandbox metadata for `custbody_project_manager`,
   including record applicability, field type, source/list, mandatory status,
   display behavior, and sourcing configuration.
3. Active Sales Order form configuration relevant to Project Manager.
4. Active workflow and SuiteScript deployments that read or write this field,
   including timing and conditions.
5. At least two correlated production examples tracing HubSpot
   `project_manager` through synchronized records to the final Sales Order.
6. Immediate and post-automation values for comparable sandbox Sales Orders
   created without an explicit Nexus Project Manager.
7. Production/sandbox employee identity comparison for those examples.
8. Approved null, inactive, unmapped, and reassignment behavior.
9. Named business and technical owners for the source, employee relationship,
   and destination field.

## Proposed administrator questions

### HubSpot integration owner

1. Does native synchronization include `project_manager`,
   `hubspot_owner_id`, or another user property?
2. Which NetSuite record and field receives each property?
3. How is a HubSpot owner resolved to a NetSuite employee?
4. Does the integration create/update, overwrite, or clear the target on null?
5. What is the synchronization timing and retry behavior?
6. Are production and sandbox mappings identical? If not, provide the
   root-caused difference.

### NetSuite administrator

1. Confirm that `custbody_project_manager` is an active Sales Order body field
   and provide its metadata and source list/record type.
2. Is it sourced from customer, opportunity, job/project, transaction form, or
   another record?
3. Which workflows or SuiteScripts read or write it, and when?
4. What happens when the employee is inactive, absent, or invalid?
5. Does omission leave it blank, source it immediately, or populate it after
   automation?
6. Are employee internal IDs and automation behavior aligned between
   production and sandbox?

### Operations owner

1. Is HubSpot `project_manager` the authoritative business assignment for a
   Sales Order, or is another source authoritative?
2. When a PM changes after quote acceptance, should an existing Sales Order
   change?
3. Should missing/unmapped/inactive PM block completion, warn, or remain blank?
4. Which system owns assignment correction and audit history?

## Optional controlled sandbox probe plan

A controlled sandbox probe is justified **after** administrator exports answer
the field/source/automation questions and sandbox authentication is repaired.
It is not currently executable or safe as an ownership substitute.

Use two synchronized sandbox records with approved, active PMs and one owned
probe Sales Order per case:

1. Record sandbox account, role, form, customer, linked synchronized record,
   source HubSpot property, employee identity, workflow/script versions, and a
   unique run ID.
2. Capture the authoritative synchronized source records before Sales Order
   creation.
3. Create an owned Sales Order while omitting `custbody_project_manager`.
4. Capture the create response and immediate structured GET.
5. Wait on observable workflow/system-note completion, not an arbitrary sleep.
6. Capture the post-automation Sales Order and system notes.
7. Repeat with the second approved PM.
8. If metadata and ownership approval require testing explicit assignment,
   create a separate owned Sales Order with the documented employee reference;
   never combine omission and explicit-write observations in one record.
9. Exercise an approved null/unmapped/inactive case only with administrator
   supervision and no production data.
10. Delete or void only run-owned probe transactions using the approved
    sandbox cleanup policy, and retain sanitized evidence externally.

Expected observations:

- source property and synchronized record value;
- immediate Sales Order Project Manager value;
- post-automation value and mutation actor;
- whether omission sources/defaults the field;
- whether explicit assignment is accepted, preserved, or overwritten;
- failure response for the approved invalid case;
- environment-specific employee IDs and equivalent business identity.

Do not run this probe against production.

## Decision gate

Production implementation remains blocked until:

- field ownership is assigned exactly once;
- the authoritative source and employee-resolution contract are approved;
- immediate and post-automation behavior are evidenced;
- null, inactive, unmapped, and reassignment behavior are approved;
- sandbox/production differences are root-caused;
- the permanent parity row can be completed without `UNKNOWN`;
- regression and validation impact is defined.

If evidence shows HubSpot sync or NetSuite automation owns the field, the
correct Nexus checkpoint is validation/reconciliation or fail-safe handling,
not a duplicate mapping. If ownership is explicitly assigned to Nexus, the
implementation must include the governed source/resolver, production mapping,
regression tests, validation updates, and contract documentation in one
bounded checkpoint.

**No production Project Manager mapping is authorized by this packet.**
