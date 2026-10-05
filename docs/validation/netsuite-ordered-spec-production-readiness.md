# Ordered-spec export — production NetSuite readiness (read-only comparison)

Prepared 2026-10-05. **Nothing was created, changed or enabled in either account.**
Production export stays OFF (`NETSUITE_ORDERED_SPEC_EXPORT` defaults off for
production).

## Result

| | sandbox `7924416_SB2` | production |
|---|---|---|
| `customrecord_nx_ordered_spec` | **present** (internal id 1612; 22 records) | **NOT MEASURED** |
| 13 `custrecord_nxos_*` fields | **present** (table below) | **NOT MEASURED** |
| `custcol_nx_ordered_spec` on Sales Order lines | **present** (List/Record → the record) | **NOT MEASURED** |
| record readable by the integration role (SuiteQL) | **yes** | **NOT MEASURED** |
| `custbody_nexus_order_packet` (existing header field) | present | NOT MEASURED |
| script-ID collisions (`%_nx%` / `%nexus%` record types) | only ours + bundle `CUSTOMRECORD_STC_NEXUS_CONFIGURATION` | NOT MEASURED |

**Why production is not measured.** No production NetSuite credential is
available on this machine. The only production-account env file
(`nexusv2-financial-parity/.env.production.local`) holds Vercel's redaction
placeholders — Vercel does not export *sensitive* variables in `env pull` — so
the request URL failed to parse and **no request reached production**.

To close it, any one of:

1. Run the comparison with real production credentials (read-only by
   construction — every call is GET or the SuiteQL query endpoint, checked
   before sending):
   ```
   node --env-file=<prod env with real NETSUITE_*> --experimental-strip-types \
     --conditions=react-server --experimental-loader ./scripts/support/src-resolver.mjs \
     scripts/gate-1b/netsuite-spec-customization-compare.ts cmp-production.json
   ```
   and compare to the sandbox output (expected today: every ordered-spec probe
   fails with "does not exist" — i.e. nothing to collide with).
2. Check in the production NetSuite UI: Customization › Record Types (search
   "Nexus Ordered Spec"), Transaction Line Fields (`_nx_ordered_spec`), and
   Setup › Users/Roles › Access Tokens for the role behind the Nexus production
   token.

## Exact definition to create in production

Measured in sandbox via REST metadata + SuiteQL (`customrecordtype`), plus the
field types set when building it (REST reports all text types as `string`, so
the NetSuite type column is from the build, not the API).

### Record type

| setting | sandbox (measured) | production |
|---|---|---|
| Name | Nexus Ordered Spec | same |
| ID | `customrecord_nx_ordered_spec` (enter `_nx_ordered_spec`) | **same script ID — required**; internal id may differ |
| Include Name Field | T | T |
| Allow Inline Editing / Deleting | F / F | F / F |
| Allow Attachments | T (default) | either; not used |
| Access Type | Use Permission List (`usepermissions = T`) | same |
| Permission: Nexus integration role | Full (probes delete their own test records) | **Create** is sufficient: Nexus creates and reads, never edits or deletes |
| Permission: operator roles | — | **View** for roles that need to read specs |

### Fields (all Store Value; none mandatory — Nexus validates before writing)

| field ID | label | NetSuite type | REST (measured) | content |
|---|---|---|---|---|
| `custrecord_nxos_transaction` | Sales Order | List/Record → Transaction | object | the Sales Order |
| `custrecord_nxos_line_key` | Line Unique Key | Integer Number | integer/int64 | `lineUniqueKey` |
| `custrecord_nxos_item` | Item | List/Record → Item | object | line item |
| `custrecord_nxos_quote_leaf` | Nexus Quote Leaf | Free-Form Text | string | Nexus `quote_leaf_id` |
| `custrecord_nxos_snapshot` | Nexus Snapshot | Free-Form Text | string | Nexus `quote_snapshot_id` |
| `custrecord_nxos_source_hash` | Source Hash | Free-Form Text | string | 64 hex |
| `custrecord_nxos_export_hash` | Export Hash | Free-Form Text | string | 64 hex |
| `custrecord_nxos_projection_version` | Projection Version | Free-Form Text | string | e.g. `nx-ordered-spec-projection/1` |
| `custrecord_nxos_redacted_keys` | Withheld Keys | Free-Form Text | string | JSON list of key names |
| `custrecord_nxos_disposition` | Spec Disposition | Free-Form Text | string | `specified` … `no_type` |
| `custrecord_nxos_schema` | Spec Schema | Free-Form Text | string | pinned schema |
| `custrecord_nxos_values` | Spec Values (JSON) | **Long Text** | string | exported values only |
| `custrecord_nxos_readable` | Specification | **Long Text** | string | "Label: value" lines |

Plus the native `name` (Nexus writes ≤ 250 chars) and `externalId`
(`nxos:<SO internal id>:<lineUniqueKey>` — NetSuite enforces uniqueness per
record type; measured in sandbox, W-2b).

The two Long Text fields must not be Free-Form Text (300-char limit): readable
text for a full PP/SP schema exceeds it. The readable field's multi-line text
round-trips byte-for-byte through REST (verified live after `14633285`).

### Transaction line field

| setting | sandbox (measured) | production |
|---|---|---|
| Label / ID | Nexus Ordered Spec / `custcol_nx_ordered_spec` | **same script ID — required** |
| Type | List/Record → Nexus Ordered Spec | same |
| Store Value | T | T |
| Applies To | Sale Item | Sale Item |
| Display | Normal (W-1 measured REST PATCH on group members with Normal) | Normal for the integration role; may be Inline Text on operator forms only after re-running W-1 in sandbox with that setting |
| Access | default (all roles) | integration role must be able to **edit**; operators view |

## Role permissions needed by the Nexus integration role

| need | why | sandbox |
|---|---|---|
| Custom record `customrecord_nx_ordered_spec`: **Create** (includes View) | create + read back records; SuiteQL `externalid` lookup | granted (Full) |
| Edit `custcol_nx_ordered_spec` on Sales Order lines | link PATCH | yes (field default access) |
| Sales Order edit + REST/SuiteQL access | already required by today's push | yes |

The role name cannot be read through the API (`role` is denied to the
integration role). In sandbox the token runs as **Nexus Integration** (read
from Setup › Access Tokens in the UI); production's must be confirmed the same
way.

## Rollout order (unchanged; nothing done yet)

1. Merge PR #621 (export stays OFF in production by default).
2. Create the record type, 13 fields and line field above in production; grant
   the integration role Create and operators View.
3. Run the comparison script against production — every ordered-spec probe
   must now match the sandbox output (present, same REST types, readable).
4. Set `NETSUITE_ORDERED_SPEC_EXPORT=enabled` in production.
5. First production order: verify its `netsuite_spec_transfers` row and
   records; optionally backfill with `retryOrderedSpecTransfer`.

The W-1/W-2/W-4 probes and E2E scripts refuse non-sandbox accounts and must not
be adapted to production — they create and delete Sales Orders.

Separate, not part of this rollout: whether `fm_actives` may appear on the
customer PDF.
