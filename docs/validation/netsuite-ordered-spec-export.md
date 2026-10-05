# NetSuite ordered-spec export — contract, evidence, rollout

Status 2026-10-05: **built and certified against sandbox `7924416_SB2`. Not
enabled in production.** Production NetSuite does not yet have the custom record
or line field below.

## What it does

After a Sales Order push, Nexus writes the **frozen** specification of every
posted product line to NetSuite, links the line to it, and reads both back.

| | |
|---|---|
| Source | `quote_snapshot_leaf_specs` for the accepted snapshot — never live `leaf_specs` |
| Spec-bearing lines | frozen line kind `item_group_member` or `direct_product` (`isSpecBearingLineKind`). Services and OTC lines carry a `quote_leaf_id` but are never spec owners |
| NetSuite record | `customrecord_nx_ordered_spec`, one per posted product line |
| Line link | `custcol_nx_ordered_spec` on that line |
| Identity | `externalId = nxos:<SO internal id>:<lineUniqueKey>` — NetSuite enforces uniqueness (measured); never `line` or a SuiteQL id |
| Withheld | `fm_actives` never leaves Nexus: not in the record, its readable text, the status row, or the Order Packet |
| Hashes | `source_hash` = frozen `content_hash` (re-verified); `export_hash` = same canonical hash over the values actually sent |
| Status | `netsuite_spec_transfers` (migration 0144) — separate from commercial push status |
| Switch | `NETSUITE_ORDERED_SPEC_EXPORT` — default ON for sandbox, OFF for production |

## Reconciliation (one function for new orders and retries)

`reconcileOrderedSpecs` (`src/lib/netsuite/ordered-spec-transfer.ts`):

1. read the frozen order and the posted Sales Order;
2. match each spec-bearing frozen line to its posted line
   (`ordered-spec-matching.ts`): inside a group occurrence by item id; an
   assembly posted FLAT (no Group line) among ungrouped lines; identical
   compositions by occurrence order, labelled `by_order`; anything ambiguous is
   a named failure, never a guess;
3. per line, find the record by `externalId`, or inspect the record already
   linked from the line before creating anything; create only if neither
   exists. Read back the external ID, line, item, quote leaf, snapshot, schema,
   hashes, values and readable text. A disagreeing record or a line linked to
   another record is a `conflict` and is **never overwritten**. A linked record
   that returns 404 is a conflict; a temporary read failure is `failed` so it
   can be retried without creating another record;
4. link the line if unlinked;
5. re-read the order: every link persisted, every `lineUniqueKey` unchanged,
   and **no quantity, rate, amount or total moved** — otherwise the transfer
   fails.

Called from `markComplete` STEP 11 (after the commercial transaction; never
throws, never blocks completion) and from `retryOrderedSpecTransfer`.

Statuses: `succeeded` · `succeeded_with_exceptions` (lines whose frozen
disposition is `schema_pending`, `unmapped` or `no_type` get a status record,
never values) · `failed` (retryable) · `conflict` (needs a person) · `pending`.

## Also in this change

- **DEFECT-2026-09-15 fixed.** `schema_pending` no longer freezes as
  `specified`: exhaustive `frozenSpecDispositionOf` with a `never` binding;
  migration 0143 widens `qsls_disposition_known`. 0 historical rows affected.
- **Order Packet.** Withheld values are redacted in the reader; frozen
  `schema_pending` / `unmapped` / `no_type` read `not_governed` instead of "no
  specification applies"; services and OTC lines are no longer listed as
  specifiable items.
- **Copy defect fixed.** `cloneQuoteGraph` now carries a charge instance's
  `tooling_classification` (found by this certification: a copied tooling
  charge could not complete).

## Evidence (sandbox)

| run | result |
|---|---|
| W-1, W-2, W-2b, W-4 capability probes | member-line link persists and keys survive; record create/read/delete; externalId uniqueness enforced (name is not); same Item Group twice → distinct keys. All disposable orders deleted, confirmed by 404 |
| Existing orders DPS-1075/76/78/79/80/81/82, each run twice | all `succeeded`; records = product lines; totals unchanged |
| Disposable order (injected frozen data) | same group twice (`by_order`), populated `fm_actives` absent everywhere, exception status, idempotent rerun, tampered record → `conflict`, not overwritten |
| **Fresh push: DPS-1084 → SO2747 (364841)** | quote `complete`, push `succeeded`; every line's quantity/rate/amount and the $36,491.00 total equal the frozen accepted tier; 4 records for 4 product lines, each linked from its own line; status `succeeded` 4/4; retry idempotent. HubSpot suppressed (certification mode); deal 65764633271 unchanged |

SO2747, DPS-1084, project `1cc12e3b…` and deal 65764633271 are kept as
certification evidence.

**Coverage gap:** no formulated product exists in the Library, so redaction of
a populated `fm_actives` is proven by unit tests and the injected-data run, not
on a fresh push.

Scripts: `scripts/gate-1b/netsuite-spec-probe-*.ts`,
`ordered-spec-transfer-e2e-{existing,disposable,fresh}.ts`,
`netsuite-item-spec-audit.ts`, `netsuite-field-consumer-scan.ts`.

## Before enabling in production

1. Create `customrecord_nx_ordered_spec` (13 `custrecord_nxos_*` fields,
   permission list: Nexus Integration = Create/View) and `custcol_nx_ordered_spec`
   (List/Record → the record, Sale Item) in production NetSuite, exactly as in
   sandbox. Sandbox internal ID 1612 is evidence, not a required production
   ID; the integration uses the record's script ID.
2. Re-run `netsuite-spec-probe-w1-w2.ts`'s precondition gate against production
   metadata (read-only part) to prove the objects are visible.
3. Set `NETSUITE_ORDERED_SPEC_EXPORT=enabled` in production.
4. Optionally backfill existing orders with `retryOrderedSpecTransfer`.

Open, outside this change: whether `fm_actives` may appear on the customer PDF
(the addendum renders every pinned-schema field today), and the legacy
PP/SP/SGA/COP header fields' consumers.
