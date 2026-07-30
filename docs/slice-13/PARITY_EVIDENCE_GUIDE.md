# Sales Order parity evidence guide

## Purpose

This guide defines the evidence required to classify a row in
[SALES_ORDER_PARITY_MATRIX.md](SALES_ORDER_PARITY_MATRIX.md). It supplements
the field definitions in
[ACCOUNTING_FIELD_UNIVERSE.md](ACCOUNTING_FIELD_UNIVERSE.md).
Open Project Manager requests and the closed Standard Terms decision record are maintained in
[PARITY_EVIDENCE_REQUESTS.md](PARITY_EVIDENCE_REQUESTS.md).
Field-write decisions are governed by the
[Integration Ownership Principle](INTEGRATION_OWNERSHIP_PRINCIPLE.md).

## Evidence principles

- Prefer structured exports/API responses over screenshots.
- Capture the source, Nexus persistence, transformation, outbound payload, and
  destination result as one correlated chain.
- Record account/environment identity, transaction identifiers, timestamps,
  and Nexus commit without recording credentials.
- Preserve raw evidence immutably; publish only sanitized references.
- Do not use production writes to collect discovery evidence.
- A missing value and an omitted field are distinct observations.
- NetSuite defaulting or workflow mutation must be evidenced, not inferred.
- Record exactly one ownership classification for every field before deciding
  whether Nexus may write it.
- A missing sandbox value does not transfer ownership to Nexus.
- Historical comments and `scripts/parity/so-field-parity.ts` classifications
  are leads, not approvals.

## Evidence packet per transaction

1. **Correlation:** audit ID, HubSpot deal ID, Nexus project/quote/tier IDs,
   legacy production SO ID, sandbox SO ID, Nexus commit, capture timestamps.
2. **Environment identity:** HubSpot portal, NetSuite account/environment,
   role, form, subsidiary, and relevant configuration versions.
3. **Source:** HubSpot raw internal property names/values, association IDs, and
   option dictionaries; Nexus-owned settings/snapshots where applicable.
   Record the field's ownership classification and evidence.
4. **Persistence:** sanitized Nexus rows for deal cache, customer map, quote,
   accepted tier, costing output, push record, and Item Group cache.
5. **Transformation:** exact repository symbol/commit plus resolver result,
   rounding, mirror, default, or omission evidence.
6. **Wire:** sanitized outbound Sales Order/Item Group payload and response,
   including idempotency correlation.
7. **Destination:** full structured production and sandbox record responses
   after synchronous and relevant asynchronous automation completes.
8. **Business result:** Accounting/Operations evidence for invoice,
   fulfillment, purchasing, tax, reporting, and customer-visible behavior.
9. **Test:** permanent regression test and result when a contract is confirmed.

## Evidence by mapping type

| Mapping type | Minimum evidence |
|---|---|
| Direct copy | Raw source, persisted value, payload value, destination value |
| Resolved reference | Source ID/label, both environment dictionaries, resolver result, destination ID/label |
| Derived numeric | Inputs, independent business calculation, precision/rounding rule, payload and returned result |
| Derived text/date | Raw value, normalization/timezone rule, payload, displayed/stored result |
| Mirrored field | Shared source plus both destination values and reason both fields exist |
| Conditional omission | Predicate input, payload absence, destination default/null, downstream effect |
| NetSuite default | Payload absence, field metadata, workflow/script/default configuration, final value |
| Workflow mutation | Before/after record, workflow/script/version and execution log |
| Item Group | Composition inputs/hash, member resolution, group record, SO line behavior, rate/amount, invoice presentation |
| Generated identity/time | Correlation and generation semantics; equality is not expected unless business requires it |

## Classification evidence

| Classification | Required proof |
|---|---|
| `PARITY` | Same approved commercial/operational meaning, within documented tolerance, with full lineage |
| `INTENTIONAL_CHANGE` | Root cause, business rationale, risk, tests, and explicit Accounting approval |
| `ENVIRONMENT_DIFFERENCE` | Production/sandbox configuration evidence and proof of equivalent behavior |
| `SOURCE_DATA_GAP` | Required source contract plus evidence the source value is absent/invalid before Nexus |
| `MAPPING_GAP` | Valid source and evidence Nexus omits, mistransforms, or misroutes it |
| `NETSUITE_CONFIGURATION` | Payload is correct and destination metadata/workflow/script causes the difference |
| `UNKNOWN` | Evidence gap, named owner, next action, and due date |
| `BLOCKER` | Material safety/commercial impact, stop condition, owner, and remediation gate |

## Precision and totals

- Record raw and normalized numeric forms.
- Independently reconcile each line's quantity × rate to amount using the
  approved NetSuite rounding behavior.
- Reconcile subtotal, tax, discount, total, gross profit, and cost fields.
- For Nexus line rate and DPS unit cost, verify four-decimal payload rounding.
- Verify the completion amount's two-decimal boundary independently.
- Treat `$0.00` catalog price as configuration evidence only. It must never be
  substituted for the Nexus commercial transaction rate.

## Item Group evidence

Current completion emits flat leaf lines. The standalone group primitive must
not be presented as completed SO behavior. A future completed Item Group
classification requires:

- reproducible group creation/reuse and collision handling;
- canonical composition hash and member quantities;
- valid item-level setup;
- explicit group-line pricing and amount behavior;
- customer invoice and Accounting presentation;
- proof that hidden components remain internal as intended;
- idempotency and retry behavior;
- Accounting approval as `INTENTIONAL_CHANGE`.

## Unknown-field discovery procedure

Compare full structured record responses and administrator field exports; do
not limit discovery to the current payload. For each new field:

1. add it to `ACCOUNTING_FIELD_UNIVERSE.md`;
2. add a matrix row;
3. identify source/default/workflow ownership;
4. collect both-environment evidence;
5. classify it or assign `UNKNOWN` with an owner and due date.

Fields that exist only on a form, workflow, bundle, custom segment, or
asynchronous script still belong in the universe if they affect Accounting or
operations.

## Evidence handling

The evidence repository, retention period, access controls, redaction policy,
and approvers are **Requires manual discovery**. Evidence references in Git
must not contain secrets, credentials, customer-sensitive payloads, or
unapproved production exports.

## Audit acceptance

The parity audit cannot pass while a required row lacks evidence, contains
`UNKNOWN` or `BLOCKER`, relies only on a comment/screenshot when structured
evidence is available, or has an unapproved intentional difference.
