# Slice 13.1 Handoff

## Current State

| Item | State |
|---|---|
| Current branch | `docs/slice-13-production-readiness` |
| Session-work HEAD before this handoff commit | `c6d3ab6a0a8cfb6e9e2974dd56b72271e456e480` |
| Pull request | [PR #163](https://github.com/eshin922/nexusv2/pull/163) — “Slice 13.1: establish Sales Order accounting contract and regression baseline” |
| PR status | Open draft |
| Merge status | `MERGEABLE`; merge state `CLEAN` |
| CI status | Vercel `SUCCESS`; Vercel Preview Comments `SUCCESS` |
| Remote PR head | `d63e165540aecc9ed9f48b3d8f431f890f6f0737` |
| Local/remote relationship | Local branch is one commit ahead of the PR head before this handoff commit; `c6d3ab6` has not been pushed |
| Working tree status | Clean before creation of this handoff |

PR status was read from GitHub on 2026-07-29 Pacific time. Recheck live
status before review or publication; do not infer that local-only commits are
present in PR #163.

## Completed This Session

- Established the canonical
  [Accounting Field Universe](../slice-13/ACCOUNTING_FIELD_UNIVERSE.md).
- Created the permanent
  [Sales Order parity matrix](../slice-13/SALES_ORDER_PARITY_MATRIX.md) and
  evidence guide.
- Added the release-blocking Sales Order accounting regression baseline,
  registered as VAL-701.
- Created PR #163 as a focused documentation-and-regression baseline.
- Confirmed PR #163 is cleanly mergeable and its Vercel checks pass.
- Left production source code and production behavior unchanged.
- Refined evidence collection so it begins with field ownership and does not
  rediscover approved native-synchronization architecture.
- Finalized and committed the
  [Integration Ownership Principle](../slice-13/INTEGRATION_OWNERSHIP_PRINCIPLE.md)
  locally as `c6d3ab6`.

The published PR baseline verification records:

- Accounting contract tests: 6/6 passed.
- Registered unit suite: 37/37 passed.
- TypeScript `--noEmit`: passed.
- Production build and prebuild verifiers: passed.
- Legacy costing verifier: passed.
- Documentation link and repository-reference checks: passed.
- `git diff --check origin/main...HEAD`: passed.
- No skipped or focused tests, arbitrary waits, browser retries, or broad
  exclusions were added.

## Approved Architectural Decisions

- HubSpot owns CRM synchronization for companies/customers, contacts/clients,
  deals, and products.
- NetSuite owns ERP-derived behavior, including accounting defaults, sourcing,
  tax, workflows, numbering, and other generated ERP values.
- Nexus composes Sales Orders, applies manufacturing and packaging
  intelligence, and orchestrates business processes.
- HubSpot native one-way synchronization into NetSuite remains in place
  intentionally.
- Nexus will not replace, duplicate, overwrite, or compete with native
  synchronization unless ownership is explicitly transferred by architecture.
- Nexus maintains a governed HubSpot Company ID to NetSuite Customer internal
  ID lookup strictly for deterministic runtime Sales Order customer
  resolution.
- The lookup is a reference mechanism, not customer synchronization.
- Customer records remain owned by HubSpot and NetSuite; Nexus does not create
  or synchronize them.
- Before Nexus writes a NetSuite field, it must have exactly one documented
  ownership classification.
- Field evidence must answer “Who owns this field?” and “Why should Nexus
  write it instead of relying on the owning system?”
- If those questions cannot be answered, Nexus does not write the field.

## Decisions We Will Not Revisit

- Keep the HubSpot native synchronization.
- Nexus is not replacing CRM synchronization.
- Use the governed Company-ID-to-Customer-ID lookup for deterministic customer
  resolution.
- Treat PR #163 at remote head `d63e165` as the approved
  documentation-and-regression baseline.
- Keep ownership classification distinct from parity classification.
- Do not reopen resolved architectural decisions without new authoritative
  evidence.
- Do not infer field ownership from an existing DTO or payload-builder
  property.

## Remaining Unknowns

Only these evidence areas remain unresolved:

1. Project Manager propagation.
2. Standard Terms ownership.
3. Workflow-derived fields.
4. SuiteTax behavior.
5. Item Groups.
6. Generated NetSuite fields.

Customer synchronization ownership, the direction of native synchronization,
the governed customer-reference lookup, and the CRM/ERP/Nexus system
boundaries are resolved.

## Open Evidence Work

| Topic | Objective | Evidence required | Expected owner | Sandbox probe required? | Implementation blocked? |
|---|---|---|---|---|---|
| Project Manager propagation | Determine whether HubSpot sync, NetSuite sourcing/automation, or Nexus owns the Sales Order Project Manager value | HubSpot `project_manager` metadata and representative records; native-sync mapping; NetSuite employee/reference lineage; immediate and post-automation SO values; null, inactive, reassigned, and unmapped behavior; sandbox/production comparison | Operations business owner, HubSpot integration owner, NetSuite administrator | Only if metadata and read-only observations cannot prove sourcing and overwrite behavior | Yes |
| Standard Terms ownership | Determine whether standard `terms` is synchronized, customer-sourced, form-defaulted, workflow-owned, or a Nexus responsibility | NetSuite field metadata; customer defaults; native-sync mapping; workflow/script inventory; immediate and post-automation values for at least two terms; omitted, null, invalid, and inactive behavior; relationship to `custbody_dps_payment_terms_text`; environment comparison | Accounting owner and NetSuite administrator, with HubSpot integration owner for any source mapping | Likely, but only after metadata and ownership review define a safe controlled probe | Yes |
| Workflow-derived fields | Identify Sales Order values populated or overwritten by NetSuite automation | Active workflow, User Event, Scheduled, and Map/Reduce deployment exports; conditions; execution timing; field writes; before/after observations; environment comparison | NetSuite administrator and each automation's technical owner | Only where configuration and logs do not establish behavior | Yes for any Nexus write or parity classification affected by automation |
| SuiteTax behavior | Establish which tax values NetSuite derives and which configuration inputs control them | SuiteTax feature/configuration evidence; customer/address/subsidiary/item dependencies; field metadata; immediate and calculated values; sandbox/production distinctions | Accounting tax owner and NetSuite administrator | Required only for representative transaction behavior not provable read-only | Yes for any explicit Nexus tax mapping; expected outcome may be validation-only |
| Item Groups | Prove completed Item Group transaction behavior and pricing prerequisites | Item ownership and pricing configuration; group/member metadata; native-sync effects; group-line rate/amount behavior; invoice presentation; failure behavior; Accounting approval | Accounting, Operations, HubSpot product-sync owner, and NetSuite administrator | Yes, after item ownership and safe cleanup are established | Yes |
| Generated NetSuite fields | Classify numbering, totals, dates, statuses, and other generated/defaulted values | Field metadata; form/customer defaults; workflow/script evidence; immediate and post-automation responses; environment-sensitive tolerances | NetSuite administrator and Accounting for business meaning | Only for fields whose generation cannot be established through metadata and observations | Yes for any Nexus write; many fields should remain NetSuite-owned |

Production writes are not an evidence shortcut. A controlled sandbox probe must
have a known sandbox identity, an explicit evidence question, run-owned
records, and verified cleanup before it is approved.

## Risks

- **Duplicate writes:** Nexus could compete with native synchronization or
  NetSuite sourcing if field ownership is assumed from payload capability.
- **Workflow overwrites:** an immediate successful create response may not
  represent the value after asynchronous NetSuite automation.
- **Sandbox/production differences:** internal IDs, forms, workflows, tax,
  terms, employees, and defaults may differ without representing a business
  defect; every distinction needs a root cause.
- **Missing synchronized records:** customer lookup misses and missing or
  ambiguous SKU-resolved items currently fail closed. Future handling must
  continue to block safely rather than create unsynchronized CRM or ERP
  records implicitly.

## Tomorrow's First Task

Begin the Evidence Readiness Report using the governing
[Integration Ownership Principle](../slice-13/INTEGRATION_OWNERSHIP_PRINCIPLE.md)
and [parity evidence guide](../slice-13/PARITY_EVIDENCE_GUIDE.md).

Collect read-only repository, HubSpot, and NetSuite evidence before deciding
whether a controlled sandbox probe is necessary. Do **not** implement Project
Manager, Standard Terms, or any other mapping until ownership evidence is
complete and approved.

## Future Implementation Order

1. Complete evidence.
2. Approve ownership.
3. Implement one bounded checkpoint whose scope reflects the ownership result.
4. Update regression coverage.
5. Update validation coverage and fixtures/providers where affected.
6. Review the complete production, test, validation, and documentation diff.
7. Merge only after the required gates and stakeholder approvals pass.

Do not assume the next implementation commit must write both Project Manager
and Standard Terms. Evidence may instead support omission, inherited behavior,
validation-only coverage, or integration reconciliation/failure handling.

## Known Good State

- Branch: `docs/slice-13-production-readiness`.
- Approved PR baseline commit: `d63e165540aecc9ed9f48b3d8f431f890f6f0737`.
- Local ownership-principle commit:
  `c6d3ab6a0a8cfb6e9e2974dd56b72271e456e480`.
- PR: [#163](https://github.com/eshin922/nexusv2/pull/163), open draft,
  cleanly mergeable, with passing Vercel checks.
- Working tree: clean immediately before this handoff document was created.
- Verification: the published PR verification listed above is passing.
- Uncommitted changes before this handoff: none.
- Publication state: local ownership and handoff commits are not part of PR
  #163 unless a future explicit publication decision is made.

## Resume Prompt

Resume Slice 13.1 on `docs/slice-13-production-readiness` from this handoff.
Treat PR #163 at `d63e165` as the approved published baseline and the local
Integration Ownership Principle as governing architecture. Start with the
Evidence Readiness Report for Project Manager propagation, Standard Terms,
workflow-derived fields, SuiteTax, Item Groups, and generated NetSuite fields.
Use read-only evidence first, do not rediscover resolved native-sync or
customer-lookup decisions, do not write a NetSuite field without approved
ownership, and do not implement mappings until the evidence package is
complete.
