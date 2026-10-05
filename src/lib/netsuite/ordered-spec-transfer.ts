/**
 * Ordered-spec transfer: the redacted frozen specification of every posted
 * Sales Order product line, written to NetSuite and READ BACK. Stage 5.
 *
 * ONE reconciliation for both a newly created order and a retry of an existing
 * one. It never assumes what NetSuite holds; it reads, then converges:
 *
 *   1. read the frozen order and the posted Sales Order
 *   2. match each spec-bearing frozen line to its posted line
 *      (`ordered-spec-matching.ts`) — identity is the `lineUniqueKey`
 *   3. per line: build the redacted projection; find the record by
 *      `externalId = nxos:<SO>:<lineUniqueKey>` (NetSuite enforces it unique);
 *      create it if absent; if present, VERIFY it — a disagreeing record is a
 *      `conflict` and is never overwritten
 *   4. link the line (`custcol_nx_ordered_spec`) if unlinked; a line linked to
 *      a different record is a `conflict`
 *   5. re-read the Sales Order: every link persisted, every lineUniqueKey
 *      unchanged, and NO commercial field (quantity, rate, amount, total)
 *      moved
 *
 * Only then is a line `verified`. The transfer status lives in its own table
 * and never touches commercial Sales Order status.
 *
 * Provider and database access are INJECTED (same pattern as
 * `rate-convergence.ts`) so the whole sequence, including retries and
 * conflicts, is provable without NetSuite.
 *
 * Diagnostics carry keys, ids and hashes — never spec values.
 */
import type { FrozenSpecDisposition } from "@/lib/ordered-spec-disposition";
import {
  ORDERED_SPEC_PROJECTION_VERSION,
  compareReadBack,
  projectOrderedSpecForExport,
  type OrderedSpecProjection,
  type SpecFieldDef,
} from "@/lib/ordered-spec-projection";
import {
  isSpecBearingKind,
  matchPostedSpecLines,
  type FrozenLine,
  type PostedLine,
} from "./ordered-spec-matching";

export const ORDERED_SPEC_RECORD_TYPE = "customrecord_nx_ordered_spec";
export const ORDERED_SPEC_LINE_FIELD = "custcol_nx_ordered_spec";

export function orderedSpecExternalId(soId: string, lineUniqueKey: string): string {
  return `nxos:${soId}:${lineUniqueKey}`;
}

export type FrozenSpecRow = {
  quoteLeafId: string;
  disposition: FrozenSpecDisposition;
  specValues: Record<string, unknown> | null;
  productTypeId: string | null;
  specSchema: string | null;
  contentHash: string;
};

export type PostedSoLine = PostedLine & {
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  /** Current value of the line link field: a record id, or null. */
  specLinkId: string | null;
};

export type ObservedSpecRecord = {
  id: string;
  externalId: string | null;
  transactionId: string | null;
  lineKey: string | null;
  itemId: string | null;
  disposition: string | null;
  projectionVersion: string | null;
  sourceHash: string | null;
  exportHash: string | null;
  redactedKeys: string[] | null;
  valuesJson: string | null;
};

export type SpecTransferStatus =
  | "pending"
  | "succeeded"
  | "succeeded_with_exceptions"
  | "failed"
  | "conflict";

export type LineStatus = "verified" | "exception" | "failed" | "conflict";

export type SpecTransferLine = {
  quoteLeafId: string | null;
  displaySku: string | null;
  lineUniqueKey: string | null;
  netsuiteItemId: string | null;
  matchMethod: "unique" | "by_order" | null;
  recordId: string | null;
  disposition: FrozenSpecDisposition | null;
  sourceHash: string | null;
  exportHash: string | null;
  redactedKeys: string[];
  status: LineStatus;
  /** Machine-readable reason for failed/conflict; keys and ids only. */
  reason: string | null;
};

export type SpecTransferResult = {
  status: SpecTransferStatus;
  productLineCount: number;
  verifiedCount: number;
  exceptionCount: number;
  failedCount: number;
  lines: SpecTransferLine[];
  problems: string[];
};

export interface SpecTransferDeps {
  loadFrozen(snapshotId: string): Promise<{
    lines: FrozenLine[];
    specs: FrozenSpecRow[];
    /** Pinned-schema field lists keyed by schema id. */
    fieldsBySchema: Record<string, SpecFieldDef[]>;
  }>;
  readSalesOrder(soId: string): Promise<{ lines: PostedSoLine[]; total: number | null }>;
  findRecordIdByExternalId(externalId: string): Promise<string | null>;
  createRecord(body: Record<string, unknown>): Promise<string>;
  readRecord(id: string): Promise<ObservedSpecRecord>;
  patchLineLink(soId: string, line: number, recordId: string): Promise<void>;
}

/** The record body. Fields named literally; nothing spread from input. */
export function buildSpecRecordBody(args: {
  soId: string;
  soLabel: string;
  posted: PostedLine;
  frozen: FrozenLine;
  snapshotId: string;
  projection: OrderedSpecProjection;
}): Record<string, unknown> {
  const p = args.projection;
  return {
    externalId: orderedSpecExternalId(args.soId, args.posted.lineUniqueKey),
    name: `${args.soLabel} · ${args.frozen.displaySku ?? args.posted.itemId ?? "item"} · ${args.posted.lineUniqueKey}`.slice(0, 250),
    custrecord_nxos_transaction: { id: args.soId },
    custrecord_nxos_line_key: Number(args.posted.lineUniqueKey),
    custrecord_nxos_item: { id: args.posted.itemId },
    custrecord_nxos_quote_leaf: args.frozen.quoteLeafId,
    custrecord_nxos_snapshot: args.snapshotId,
    custrecord_nxos_source_hash: p.sourceHash,
    custrecord_nxos_export_hash: p.exportHash,
    custrecord_nxos_projection_version: p.projectionVersion,
    custrecord_nxos_redacted_keys: JSON.stringify(p.redactedKeys),
    custrecord_nxos_disposition: p.disposition,
    custrecord_nxos_schema: p.specSchema,
    custrecord_nxos_values: JSON.stringify(p.values),
    custrecord_nxos_readable: p.readable,
  };
}

function verifyRecord(
  observed: ObservedSpecRecord,
  expected: { soId: string; lineKey: string; itemId: string; projection: OrderedSpecProjection },
): string[] {
  const cmp = compareReadBack(
    { ...expected.projection, lineKey: expected.lineKey, itemId: expected.itemId },
    {
      lineKey: observed.lineKey,
      itemId: observed.itemId,
      disposition: observed.disposition,
      projectionVersion: observed.projectionVersion,
      sourceHash: observed.sourceHash,
      exportHash: observed.exportHash,
      redactedKeys: observed.redactedKeys,
      valuesJson: observed.valuesJson,
    },
  );
  const out = cmp.matches ? [] : [...cmp.mismatched];
  if (observed.transactionId !== expected.soId) out.push("transaction");
  return out;
}

const EXCEPTIONS: ReadonlySet<FrozenSpecDisposition> = new Set(["schema_pending", "unmapped", "no_type"]);

export async function reconcileOrderedSpecs(
  deps: SpecTransferDeps,
  args: { soId: string; soLabel: string; snapshotId: string },
): Promise<SpecTransferResult> {
  const frozen = await deps.loadFrozen(args.snapshotId);
  const before = await deps.readSalesOrder(args.soId);

  const match = matchPostedSpecLines(before.lines, frozen.lines);
  const specByLeaf = new Map(frozen.specs.map((s) => [s.quoteLeafId, s] as const));
  const postedByKey = new Map(before.lines.map((l) => [l.lineUniqueKey, l] as const));

  const lines: SpecTransferLine[] = [];
  const base = (f: FrozenLine): SpecTransferLine => ({
    quoteLeafId: f.quoteLeafId,
    displaySku: f.displaySku,
    lineUniqueKey: null,
    netsuiteItemId: f.netsuiteItemId,
    matchMethod: null,
    recordId: null,
    disposition: null,
    sourceHash: null,
    exportHash: null,
    redactedKeys: [],
    status: "failed",
    reason: null,
  });

  for (const u of match.unmatched) {
    lines.push({ ...base(u.frozen), reason: `unmatched: ${u.reason}` });
  }

  const linkedRecords = new Map<string, string>(); // lineUniqueKey -> recordId

  for (const m of match.matches) {
    const row: SpecTransferLine = {
      ...base(m.frozen),
      lineUniqueKey: m.posted.lineUniqueKey,
      matchMethod: m.method,
    };
    lines.push(row);

    const spec = m.frozen.quoteLeafId ? specByLeaf.get(m.frozen.quoteLeafId) : undefined;
    if (!spec) {
      row.reason = "no_frozen_spec_row";
      continue;
    }
    row.disposition = spec.disposition;
    const proj = projectOrderedSpecForExport({
      disposition: spec.disposition,
      specValues: spec.specValues,
      productTypeId: spec.productTypeId,
      specSchema: spec.specSchema,
      contentHash: spec.contentHash,
      fields: spec.specSchema ? frozen.fieldsBySchema[spec.specSchema] ?? null : null,
    });
    if (!proj.ok) {
      const r = proj.refusal;
      row.reason = `projection_refused:${r.reason}${"keys" in r ? `:${r.keys.join("|")}` : ""}`;
      continue;
    }
    const p = proj.projection;
    row.sourceHash = p.sourceHash;
    row.exportHash = p.exportHash;
    row.redactedKeys = p.redactedKeys;

    const posted = m.posted;
    const itemId = posted.itemId ?? "";
    const expected = { soId: args.soId, lineKey: posted.lineUniqueKey, itemId, projection: p };
    const externalId = orderedSpecExternalId(args.soId, posted.lineUniqueKey);

    try {
      let recordId = await deps.findRecordIdByExternalId(externalId);
      if (recordId === null) {
        const body = buildSpecRecordBody({
          soId: args.soId,
          soLabel: args.soLabel,
          posted,
          frozen: m.frozen,
          snapshotId: args.snapshotId,
          projection: p,
        });
        try {
          recordId = await deps.createRecord(body);
        } catch (e) {
          // A concurrent run may have created it; NetSuite enforces externalId
          // uniqueness (and words the refusal as a NAME clash). Re-find before
          // treating this as a failure.
          recordId = await deps.findRecordIdByExternalId(externalId);
          if (recordId === null) throw e;
        }
      }
      row.recordId = recordId;

      const mismatched = verifyRecord(await deps.readRecord(recordId), expected);
      if (mismatched.length > 0) {
        row.status = "conflict";
        row.reason = `record_disagrees:${mismatched.join("|")}`;
        continue;
      }

      if (posted.specLinkId !== null && posted.specLinkId !== recordId) {
        row.status = "conflict";
        row.reason = `line_linked_to_other_record:${posted.specLinkId}`;
        continue;
      }
      if (posted.specLinkId === null) {
        await deps.patchLineLink(args.soId, posted.line, recordId);
      }
      linkedRecords.set(posted.lineUniqueKey, recordId);
    } catch (e) {
      row.reason = `provider_error:${e instanceof Error ? e.message.slice(0, 160) : "unknown"}`;
    }
  }

  // ── read back the order: links persisted, nothing commercial moved ────────
  const problems = [...match.problems];
  const after = await deps.readSalesOrder(args.soId);
  const beforeKeys = before.lines.map((l) => l.lineUniqueKey).join(",");
  const afterKeys = after.lines.map((l) => l.lineUniqueKey).join(",");
  if (beforeKeys !== afterKeys) problems.push("lineUniqueKeys changed during transfer");
  if (before.total !== after.total) problems.push(`order total changed: ${before.total} → ${after.total}`);
  for (const a of after.lines) {
    const b = postedByKey.get(a.lineUniqueKey);
    if (!b) continue;
    if (b.quantity !== a.quantity || b.rate !== a.rate || b.amount !== a.amount || b.itemId !== a.itemId) {
      problems.push(`commercial fields changed on line ${a.lineUniqueKey}`);
    }
  }
  const afterByKey = new Map(after.lines.map((l) => [l.lineUniqueKey, l] as const));
  for (const row of lines) {
    if (row.lineUniqueKey === null || !linkedRecords.has(row.lineUniqueKey)) continue;
    const linked = afterByKey.get(row.lineUniqueKey)?.specLinkId ?? null;
    if (linked !== linkedRecords.get(row.lineUniqueKey)) {
      row.status = "failed";
      row.reason = "line_link_not_persisted";
      continue;
    }
    row.status = row.disposition !== null && EXCEPTIONS.has(row.disposition) ? "exception" : "verified";
    row.reason = row.status === "exception" ? `unresolved_disposition:${row.disposition}` : null;
  }

  const productLineCount = frozen.lines.filter((f) => isSpecBearingKind(f.lineKind)).length;
  const count = (s: LineStatus) => lines.filter((l) => l.status === s).length;
  const verified = count("verified");
  const exceptions = count("exception");
  const failed = count("failed");
  const conflicts = count("conflict");

  let status: SpecTransferStatus;
  if (conflicts > 0) status = "conflict";
  else if (failed > 0 || problems.length > 0 || verified + exceptions !== productLineCount) status = "failed";
  else if (exceptions > 0) status = "succeeded_with_exceptions";
  else status = "succeeded";

  return {
    status,
    productLineCount,
    verifiedCount: verified,
    exceptionCount: exceptions,
    failedCount: failed + conflicts,
    lines,
    problems,
  };
}
