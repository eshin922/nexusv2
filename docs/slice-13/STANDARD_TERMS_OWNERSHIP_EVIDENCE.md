# Standard Terms Ownership Evidence

## Executive conclusion

The standard NetSuite Sales Order `terms` field is classified
`NETSUITE_DERIVED`. The ownership decision gate is **CLOSED**.

Nexus is not authorized to write standard Terms. It must continue omitting the
field and rely on NetSuite to derive it from ERP record context. A controlled
REST creation probe proved that NetSuite populated Customer default Terms ID
`7` when Nexus omitted `terms` entirely.

This decision does not change the existing, separate Nexus write to
`custbody_dps_payment_terms_text`. That field carries the immutable quote
payment-terms text and retains its current behavior pending a separate
business-meaning decision.

## Scope and evidence standard

This report covers standard NetSuite Sales Order `terms`, directly relevant
Customer-default sourcing, and the existing custom payment-terms text behavior.
It follows the
[Data Traceability and Field Governance standard](../architecture/DATA_TRACEABILITY_AND_FIELD_GOVERNANCE.md)
and the
[Integration Ownership Principle](INTEGRATION_OWNERSHIP_PRINCIPLE.md).

## Known field identities

| Business field | Technical identity | Record | Current behavior | Ownership |
| --- | --- | --- | --- | --- |
| Standard Terms | `terms` | NetSuite Sales Order standard reference field | Omitted by Nexus; populated by NetSuite from ERP context | `NETSUITE_DERIVED` |
| Customer default Terms | `terms` | NetSuite Customer reference field | Read by NetSuite during Sales Order creation; Nexus neither reads nor writes it | `SHARED_READ_ONLY_DEPENDENCY` |
| Payment terms text | `custbody_dps_payment_terms_text` | NetSuite Sales Order custom body field | Nexus writes the trimmed immutable quote snapshot when nonblank | Current Nexus writer; business ownership remains separately governed |
| Quote payment-terms snapshot | `paymentTermsSnapshot` / `payment_terms_snapshot` | Nexus Quote | Frozen at send and supplied to completion | `NEXUS_OWNED` |

## End-to-end propagation trace

### Standard Terms

Owned sandbox Customer with default Terms ID `7`
→ Nexus REST Sales Order request omits `terms`
→ NetSuite creates one disposable Sales Order
→ immediate REST GET returns Sales Order Terms ID `7`.

This proves NetSuite-side derivation. Nexus performs no Term lookup, identifier
mapping, DTO assignment, or payload write.

### Custom payment-terms text

Nexus firm payment-terms default
→ immutable quote `paymentTermsSnapshot`
→ completion input `paymentTermsText`
→ trimmed `custbody_dps_payment_terms_text` when nonblank.

The probe deliberately omitted both fields and therefore does not redefine the
custom field's business purpose.

## Evidence table

| Evidence | Observation | Conclusion |
| --- | --- | --- |
| `src/lib/netsuite/sales-orders.ts` | Builder omits standard `terms`. | Nexus does not currently write the field. |
| `tests/unit/sales-order-accounting-contract.test.ts` | Omission is release-blocking. | A future accidental Nexus write will fail regression coverage. |
| NetSuite REST metadata | Standard Sales Order `terms` is a reference field. | It is not the free-text field written by Nexus. |
| Read-only sandbox observations | Two Sales Orders matched their respective Customer default Terms, including one matching Terms ID `7`. | Customer sourcing was strongly indicated but was not causal proof. |
| System Notes filtered to Terms on a representative existing order | No records were shown. | No recorded post-create Terms change was found; absence alone was neutral. |
| Controlled sandbox REST probe on 2026-07-30 | POST omitted standard `terms`, custom payment terms, and all Nexus/HubSpot custom body fields. Immediate GET returned Terms ID `7`, matching the owned Customer's confirmed default. | NetSuite populated standard Terms without a Nexus write. |
| Probe timestamps | `createdDate` and `lastModifiedDate` were both `2026-07-30T17:11:00Z`. | No later modification was visible between creation and the immediate read. |
| Probe REST record | Source was `REST Web Services`; no relevant workflow or System Notes link was exposed. | No evidence of a post-create Terms mutation was available through the returned record. |
| Probe cleanup | Memo was verified exactly; DELETE returned `204`; final GET returned `404`. | The disposable record was removed and no probe transaction remains. |

## Controlled probe record

The authorized sandbox probe used an owned Customer whose confirmed default
was Terms ID `7`, one valid item line, a unique idempotency key, and a
probe-specific cleanup memo. Operational account, Customer, item, transaction,
and idempotency identifiers are intentionally excluded from this permanent
governance record.

The request explicitly omitted `terms`, `custbody_dps_payment_terms_text`, and
all Nexus-specific and HubSpot custom body fields.

Results:

- POST: `204`;
- exactly one disposable Sales Order created;
- immediate GET: `200`;
- returned Terms: ID `7`;
- verified memo before cleanup: exact match;
- DELETE: `204`; and
- final GET: `404`.

No Customer or existing transaction was modified.

## Ownership analysis

The experiment conclusively answers the architectural question: NetSuite
produces standard Terms when Nexus omits it. It does not need a Nexus mapping.

The REST evidence does not distinguish native Customer sourcing from
synchronous NetSuite automation that completes before the POST response.
That narrower implementation detail does not change field ownership: both
mechanisms are NetSuite-owned ERP behavior.

## Decision gate

**Status: CLOSED**

| Question | Decision |
| --- | --- |
| Who owns standard Sales Order Terms? | NetSuite |
| Ownership classification | `NETSUITE_DERIVED` |
| Should Nexus write it? | No |
| Why? | NetSuite populated the Customer default Terms when the field was omitted. A Nexus write would duplicate or override ERP-owned sourcing. |
| Required Nexus behavior | Continue omitting standard `terms`. |
| Required regression behavior | Preserve the release-blocking omission assertion. |

## Remaining boundaries

- Sandbox-to-production configuration parity remains a parity-audit concern,
  not an ownership blocker.
- The precise native-sourcing versus synchronous-automation mechanism is not
  required to authorize omission.
- The relationship between standard `terms` and
  `custbody_dps_payment_terms_text` remains a separate Accounting semantics
  decision. It does not authorize Nexus to write standard Terms.

## Final recommendation

Preserve the current standard-field omission. Treat standard Sales Order Terms
as `NETSUITE_DERIVED`, validate the resulting value during parity and shadow
mode, and do not add a Nexus Term resolver or payload mapping.
