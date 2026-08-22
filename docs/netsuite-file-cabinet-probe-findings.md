# NetSuite File Cabinet — measured capability of the current integration role

**Probed 2026-08-21 against the sandbox. Read-only except one refused create.**
Nothing was written; no production customer or order was touched.

Scripts, re-runnable after any permission change:
`scripts/gate-1b/netsuite-file-cabinet-probe.ts`,
`scripts/gate-1b/netsuite-file-catalog-probe.ts`.

## Headline

**The File Cabinet is unavailable to the current integration role — by
PERMISSION, not by API surface.** Granting the role Documents and Files access
is expected to unblock it. Nothing in the Nexus design needs to change to
accommodate an absent capability, because the capability is not absent.

That distinction is the whole point of the probe, and it was not free to get.

## Why the obvious reading was wrong twice

**First trap — the REST error is indistinguishable from a typo.**

```
GET /record/v1/notARealRecordType  ->  404  "Record type 'notARealRecordType' does not exist."
GET /record/v1/file                ->  404  "Record type 'file' does not exist."
POST /record/v1/file               ->  404  "Record type 'file' does not exist."
GET /record/v1/folder              ->  404  "Record type 'folder' does not exist."
```

Identical wording. At the REST layer, a record the role may not see and a record
that does not exist are the same 404. Read alone, this says "File Cabinet is not
in the REST API" — which would have been the wrong conclusion.

**Second trap — the metadata catalog failed its own control.**

`GET /record/v1/metadata-catalog` returned 177 record types. It does **not**
contain `salesOrder`, `itemGroup` or `inventoryItem` — all three of which this
same role demonstrably reads and writes. So the catalog is not an enumeration of
what the role can access, and `file`'s absence from it proves nothing.

Only the control checks exposed that. Without asking "does the catalog contain
something I already know works?", the missing `file` entry would have been
reported as evidence.

## What actually settles it

SuiteQL emits **two distinguishable failures**, and calibrating them against
known cases resolves the ambiguity:

| probe | message | meaning |
|---|---|---|
| `transaction`, `customer`, `item`, `subsidiary` | *(rows returned)* | readable |
| `notarealtable`, `zzzfake`, `usrnote` | `Invalid search type: X` | **not a record type** |
| `mediaitem`, `documentfile`, `filecabinet` | `Invalid search type: X` | **not a record type** |
| `employee`, `vendor`, `payrollitem` | `Record 'X' was not found` | **real record, role denied** |
| **`file`** | **`Record 'file' was not found`** | **real record, role denied** |
| **`mediaitemfolder`** | **`Record 'mediaitemfolder' was not found`** | **real record, role denied** |

`file` lands in the `employee` / `vendor` / `payrollitem` group — records that
unquestionably exist in NetSuite and that this integration role simply does not
hold. Meanwhile the names that genuinely are not record types (`mediaitem`,
`filecabinet`) produce a different message entirely.

## Endpoint results

| call | result |
|---|---|
| `GET /record/v1/salesOrder/{id}` | **200** — positive control; auth, role, connectivity live |
| `GET /record/v1/salesOrder/{id}?expandSubResources=true` | **200** — full header + lines |
| `SuiteQL transaction / customer / item / subsidiary` | **200** |
| `SuiteQL nexttransactionlinelink` | **200** |
| `GET`/`POST /record/v1/file` | 404 — permission (per above) |
| `GET /record/v1/folder` | 404 — permission |
| `SuiteQL file / mediaitemfolder` | 400 — permission |
| `GET salesOrder/{id}/attachedFiles` | 400 `Unknown field name 'attachedFiles'` |
| `GET salesOrder/{id}/file` | 400 `Unknown field name 'file'` |
| `GET salesOrder/{id}/mediaItem` / `mediaItemList` | 400 `Unknown field name` |

**File Cabinet internal id / path returned: none — no file could be created.**

## What the Sales Order can carry

Measured on the disposable SO, not assumed:

- **Header:** 20 `custbody_*` fields. Two already carry document links and
  Nexus already writes them — `sales-orders.ts:184` sets
  `custbody_sharepoint_link`, mirroring `custbody_dps_accounting_files`, from
  the deal folder URL. So a header link-out is not a new pattern in this
  account; it is the pattern already in use for order documents.
  No native file/attachment sublist is exposed at REST.
- **Line:** `custcol_dps_sku` (ours), plus `custcol_2663_isperson`,
  `custcol_p2p_ln_allow_po`, `custcol_statistical_value_base_curr`. **No
  url/file/document field on the line.**
- **Custom records:** the account carries many (`customrecord_*`), so a custom
  record is an available carrier if one is wanted.

## What remains UNMEASURED, and why

**How a file attaches to a Sales Order, and whether that attachment can be
line-level.** This could not be probed: attachment requires a file to attach,
and file creation is blocked. The `attachedFiles` / `mediaItem` sublists are not
exposed on the SO at REST, so the mechanism is likely the generic
attach/detach operation rather than a sublist — but that is an inference and it
is not in this document's findings.

Consequently these questions are **open, not answered**:

- file size and content-type limits (nothing was uploaded)
- provider behaviour on duplicate/idempotent upload (nothing was uploaded)
- whether an operator reaches the file from the SO natively, or via a link field
- whether NetSuite supports a **line-level** file relationship at all

The per-line content-hash custom field remains **one candidate**, correctly not
committed to. The measurement that would decide between candidates is the one
the permission gap blocks.

## The ask

**Grant the Nexus integration role Documents and Files permission in the
NetSuite sandbox**, then re-run both probe scripts. They are written to be
re-run and will answer the remaining questions in one pass.

If that grant is refused or unavailable, the fallback is a **link-out**: a
header custom field carrying a durable Nexus URL to the order packet. Weaker —
it leaves the artifact outside NetSuite and dependent on Nexus being reachable —
but it needs no File Cabinet access. It should not be chosen until the grant has
actually been tried.

## One thing that must not be carried forward

`quotes.pdf_url` is a **30-day signed URL**, and the code comment states it is
*"internal-only; never handed to customer"*. It must never become the link in
either design. The durable identity is the storage path —
`buildQuotePdfStoragePath(quoteId, sendUuid)` plus bucket, recorded in the send
audit's `diff_json.pdf` — and the file behind it "lives forever". Bytes are
re-read from that path and re-signed on demand.
