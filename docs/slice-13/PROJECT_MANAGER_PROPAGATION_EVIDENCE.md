# Project Manager propagation ownership packet

## Executive conclusion

The NetSuite Sales Order Project Manager field is **not authorized for a Nexus
production mapping**.

Project Manager governance now separates two responsibilities:

| Responsibility | Status | Owner / classification |
| --- | --- | --- |
| Identity Resolution | **CLOSED** | HubSpot Integration / `HUBSPOT_SYNC_OWNED` |
| Transaction Population | **CLOSED for Nexus implementation** | HubSpot Integration / `HUBSPOT_SYNC_OWNED` |
| Operational Provenance | **OPEN — informational only** | Exact create-time component not captured |

Employee `194766` contains the custom field labeled
`HubSpot Project Manager ID` with value `702872744`. That value exactly matches
the HubSpot Deal `project_manager` owner established for the correlated
transaction. The NetSuite Employee record is therefore the governed identity
dictionary used to resolve HubSpot Project Manager owners to NetSuite
Employees. Nexus must not create a competing mapping dictionary.

The remaining question—exactly which integration component places
`custbody_project_manager` on the Sales Order—is operational provenance. It
does not change the closed Nexus decision to omit the field.

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

The evidence establishes the existing HubSpot integration as the transaction
population owner for Nexus implementation purposes. Whether it supplies the
field directly in the create payload or invokes a tightly coupled NetSuite
component remains informational provenance under the
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

A controlled sandbox REST probe created one disposable Sales Order while
omitting `custbody_project_manager` and all Nexus custom body fields. The
immediate GET returned the Project Manager field absent, with equal creation
and last-modified timestamps. Exact memo verification preceded deletion;
DELETE returned `204` and the final GET returned `404`.

## Known field identities

| Concept | Technical identity | Record/system | Evidence status |
|---|---|---|---|
| HubSpot Deal Owner | `hubspot_owner_id` | HubSpot deal property | Repository-confirmed |
| HubSpot Project Manager | `project_manager` | HubSpot deal property; active OWNER-referenced enumeration/select | Externally confirmed, read-only on 2026-07-30 |
| Configurable Nexus PM source | `HUBSPOT_PM_PROPERTY` | Nexus runtime configuration naming a HubSpot deal property | Repository-confirmed; currently unset |
| Cached HubSpot PM identity | `hubspot_deals_cache.pm_id`, `pm_name`, `pm_email` | Nexus cache | Repository-confirmed; population is configuration-gated |
| Nexus project PM | `projects.pm_user_id` / `projects.pmUserId` | Nullable FK to `users.id` | Repository-confirmed |
| Nexus user HubSpot identity | `users.hubspot_owner_id` / `users.hubspotOwnerId` | Nexus user record | Repository-confirmed |
| NetSuite Employee HubSpot PM identity | Label `HubSpot Project Manager ID`; technical field ID not yet captured | NetSuite Employee `194766` | Administrator-confirmed value `702872744`, exactly matching the correlated HubSpot Project Manager owner |
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

### 2. Identity resolution through HubSpot integration

The NetSuite Employee custom field labeled `HubSpot Project Manager ID`
contains the HubSpot owner identifier. Employee `194766` stores `702872744`,
which exactly matches the correlated HubSpot Deal `project_manager` owner.

This closes identity resolution:

HubSpot Deal `project_manager` owner ID
→ search NetSuite Employee `HubSpot Project Manager ID`
→ resolved NetSuite Employee internal ID.

The HubSpot Integration owns and maintains this dictionary. The custom
Employee field's technical script ID and lifecycle behavior remain useful
operational metadata, but they do not block the identity-ownership decision.
Nexus must not introduce an independent user-to-Employee dictionary.

### 3. Transaction population

The Sales Order field is stored, has blank Source List and Source From
configuration, and is described as synchronized from HubSpot by searching the
HubSpot Project Manager ID on Employee records. The correlated existing Sales
Order contains Employee `194766`, but its Project Manager System Notes contain
no matching rows.

The controlled direct REST creation probe omitted
`custbody_project_manager`; the immediate result also omitted the field. This
rules out unconditional native field sourcing for that direct-create context.
It does not identify the writer used by the established HubSpot-originated
transaction path.

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
| No Nexus-to-NetSuite employee dictionary/resolver exists | Repository-confirmed search | Schema, actions, NetSuite modules, fixtures, tests | Strong; Nexus must not create one because the Employee custom field is the governed dictionary |
| Employee `194766` stores HubSpot PM owner `702872744` | Administrator-confirmed runtime evidence | NetSuite Employee custom field `HubSpot Project Manager ID` | Closes identity resolution as HubSpot Integration-owned |
| Correlated Sales Order references Employee `194766` | Administrator-confirmed runtime evidence | Existing Sales Order Project Manager | Strong correlation; does not identify the transaction writer |
| Direct REST creation with Project Manager omitted leaves it absent | Controlled sandbox evidence | Immediate Sales Order GET; guarded cleanup | Rules out unconditional direct-create sourcing in the probed context; does not exclude a HubSpot integration writer |
| Project Manager System Notes contain no matching rows | Administrator-confirmed runtime evidence | Correlated Sales Order System Notes | No recorded post-create mutation; does not reveal a create-time writer |
| Builder supports `custbody_project_manager` with an ID reference | Repository-confirmed | `src/lib/netsuite/sales-orders.ts`; `tests/unit/sales-order-accounting-contract.test.ts` | Proves serialization only, not NetSuite acceptance or ownership |
| Completion omits Project Manager | Repository-confirmed | `src/lib/netsuite/mark-complete.ts`; accounting contract test | Strong |
| Transaction population ownership is known for Nexus implementation | Correlated runtime and architecture evidence | HubSpot source identity, governed Employee dictionary, integration-created Sales Order, direct REST omission behavior | Closed as `HUBSPOT_SYNC_OWNED`; exact create-time component remains provenance-only |
| Exact create-time payload or component is known | Operational provenance | Original execution payload is unavailable | Open informational item; does not block Nexus omission |
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

### Identity Resolution: CLOSED

**Owner: HubSpot Integration**
**Classification: `HUBSPOT_SYNC_OWNED`**

The NetSuite Employee custom field is the governed identity dictionary. Nexus
may validate or reference this synchronized relationship only after a
transaction ownership decision requires it; Nexus must not duplicate it.

### Transaction Population: CLOSED for Nexus implementation

**Owner: HubSpot Integration**
**Classification: `HUBSPOT_SYNC_OWNED`**

Nexus must continue omitting `custbody_project_manager`. The established
integration resolves the HubSpot Project Manager through the governed Employee
dictionary and the correlated integration-created Sales Order contains that
Employee. The field has no configured sourcing, direct REST omission leaves it
absent, and Nexus never writes it.

### Operational Provenance: OPEN, informational only

The original outbound payload or execution log has not been captured, so the
exact create-time component is unknown. That detail cannot change the current
Nexus decision: both direct integration population and a tightly coupled
integration-owned handoff remain external to Nexus and prohibit a duplicate
Nexus writer. Provenance becomes decision-critical only if the integration is
changed, retired, replaced, or transfers ownership to Nexus.

## Remaining operational provenance

The exact create-time writer for `custbody_project_manager` on the correlated
HubSpot-originated Sales Order remains uncaptured. This is not an
implementation blocker. Null, inactive, unmapped, reassignment, and environment
behavior remain future operational-contract evidence if Nexus begins
validating the synchronized result.

## Optional provenance capture

Inspect only the HubSpot automation execution that created the correlated
Sales Order:

1. Open the correlated HubSpot Deal.
2. Open its workflow or integration history for the execution that created the
   Sales Order.
3. Open only the Sales Order creation action or its sanitized outbound payload.
4. Search that action for `project_manager`, `custbody_project_manager`, or the
   resolved Employee internal ID.
5. Record the action/workflow name and the exact source → lookup → destination
   mapping. Stop; do not inventory unrelated workflows or actions.

This capture is optional and non-blocking. It is useful for support and future
migration, but it does not reopen the Nexus implementation decision.

## Decision gate

The Nexus implementation decision is closed:

- the HubSpot Integration owns identity resolution and transaction
  population;
- Nexus omits `custbody_project_manager`;
- Nexus does not create a second identity dictionary; and
- optional provenance capture does not block release.

Any future proposal for Nexus to write the field requires an explicit
ownership-transfer decision, null/inactive/unmapped/reassignment contracts,
sandbox/production evidence, and regression and validation updates.

**No production Project Manager mapping is authorized by this packet.**
