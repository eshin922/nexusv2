import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  netsuiteSoPushes,
  netsuiteSpecTransfers,
  productTypes,
  quoteSnapshotLeafSpecs,
  quoteSnapshotLines,
  quotes,
} from "@/db/schema";
import { isOrderedSpecExportEnabled } from "@/lib/config/ordered-spec-export";
import type { FrozenSpecDisposition } from "@/lib/ordered-spec-disposition";
import {
  ORDERED_SPEC_PROJECTION_VERSION,
  type SpecFieldDef,
} from "@/lib/ordered-spec-projection";
import {
  SPEC_SCHEMA_PRODUCT_TYPE_ID,
  type SpecSchemaId,
} from "@/lib/product-structure/spec-schema-mapping";

import {
  createRecord,
  loadNetsuiteConfig,
  nsRequest,
  patchSalesOrderLineSpecLink,
  suiteQL,
} from "./client";
import type { FrozenLine } from "./ordered-spec-matching";
import {
  ORDERED_SPEC_LINE_FIELD,
  ORDERED_SPEC_RECORD_TYPE,
  reconcileOrderedSpecs,
  type ObservedSpecRecord,
  type PostedSoLine,
  type SpecTransferDeps,
  type SpecTransferResult,
  type SpecTransferStatus,
} from "./ordered-spec-transfer";

/**
 * Runtime wiring for the ordered-spec transfer: the real database and NetSuite
 * providers, the enable switch, and the status row. ONE entry point,
 * `runOrderedSpecTransfer`, used both after a fresh `markComplete` and for a
 * retry of an existing order.
 *
 * NEVER THROWS. A specification transfer failure must not turn a commercially
 * correct Sales Order into a failed one; it is recorded in
 * `netsuite_spec_transfers` and returned.
 */

export type OrderedSpecTransferOutcome =
  | { status: "disabled" | "not_applicable"; reason: string }
  | {
      status: SpecTransferStatus;
      netsuiteSoId: string;
      errorDetail: string | null;
      productLineCount?: number;
      verifiedCount?: number;
      exceptionCount?: number;
      failedCount?: number;
      lines?: SpecTransferResult["lines"];
      problems?: string[];
    };

const ref = (v: unknown): string | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") {
    const id = (v as { id?: unknown }).id;
    return id === null || id === undefined ? null : String(id);
  }
  return String(v);
};
const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const typeOf = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { id?: unknown; refName?: unknown };
    return o.id != null ? String(o.id) : o.refName != null ? String(o.refName) : null;
  }
  return null;
};

export const realSpecTransferDeps: SpecTransferDeps = {
  async loadFrozen(snapshotId) {
    const lines = await db
      .select()
      .from(quoteSnapshotLines)
      .where(eq(quoteSnapshotLines.quoteSnapshotId, snapshotId));
    const specs = await db
      .select()
      .from(quoteSnapshotLeafSpecs)
      .where(eq(quoteSnapshotLeafSpecs.quoteSnapshotId, snapshotId));

    const schemaIds = [...new Set(specs.map((s) => s.specSchema).filter((s): s is string => !!s))].filter(
      (s): s is SpecSchemaId => s in SPEC_SCHEMA_PRODUCT_TYPE_ID,
    );
    const fieldsBySchema: Record<string, SpecFieldDef[]> = {};
    if (schemaIds.length > 0) {
      const typeIds = schemaIds.map((s) => SPEC_SCHEMA_PRODUCT_TYPE_ID[s]);
      const types = await db
        .select({ id: productTypes.id, fieldSchema: productTypes.fieldSchema })
        .from(productTypes)
        .where(inArray(productTypes.id, typeIds));
      for (const s of schemaIds) {
        const t = types.find((x) => x.id === SPEC_SCHEMA_PRODUCT_TYPE_ID[s]);
        const fields = (t?.fieldSchema as { fields?: Array<{ key: string; label: string }> } | null)?.fields;
        if (Array.isArray(fields)) fieldsBySchema[s] = fields.map((f) => ({ key: f.key, label: f.label }));
      }
    }

    return {
      lines: lines.map(
        (l): FrozenLine => ({
          position: l.position,
          lineKind: l.lineKind as FrozenLine["lineKind"],
          owningAssemblyId: l.owningAssemblyId,
          quoteLeafId: l.quoteLeafId,
          netsuiteItemId: l.netsuiteItemId,
          displaySku: l.displaySku,
        }),
      ),
      specs: specs.map((s) => ({
        quoteLeafId: s.quoteLeafId,
        disposition: s.disposition as FrozenSpecDisposition,
        specValues: s.specValues as Record<string, unknown> | null,
        productTypeId: s.productTypeId,
        specSchema: s.specSchema,
        contentHash: s.contentHash,
      })),
      fieldsBySchema,
    };
  },

  async readSalesOrder(soId) {
    const rec = await nsRequest<{ total?: unknown; item?: { items?: Record<string, unknown>[] } }>({
      method: "GET",
      path: `/record/v1/salesOrder/${encodeURIComponent(soId)}?expandSubResources=true`,
    });
    const lines: PostedSoLine[] = (rec.item?.items ?? []).map((l) => ({
      line: Number(l.line),
      lineUniqueKey: String(l.lineUniqueKey),
      itemId: ref(l.item),
      itemType: typeOf(l.itemType),
      quantity: num(l.quantity),
      rate: num(l.rate),
      amount: num(l.amount),
      specLinkId: ref(l[ORDERED_SPEC_LINE_FIELD]),
    }));
    return { lines, total: num(rec.total) };
  },

  async findRecordIdByExternalId(externalId) {
    const r = await suiteQL<{ id: string }>(
      `select id from ${ORDERED_SPEC_RECORD_TYPE} where externalid = '${externalId.replace(/'/g, "''")}'`,
    );
    if (r.items.length > 1) {
      throw new Error(`more than one ${ORDERED_SPEC_RECORD_TYPE} carries externalId ${externalId}`);
    }
    return r.items[0] ? String(r.items[0].id) : null;
  },

  async createRecord(body) {
    const { internalId } = await createRecord({ recordType: ORDERED_SPEC_RECORD_TYPE, body });
    return String(internalId);
  },

  async readRecord(id): Promise<ObservedSpecRecord> {
    const r = await nsRequest<Record<string, unknown>>({
      method: "GET",
      path: `/record/v1/${ORDERED_SPEC_RECORD_TYPE}/${encodeURIComponent(id)}`,
    });
    let redacted: string[] | null = null;
    try {
      const parsed = JSON.parse(String(r.custrecord_nxos_redacted_keys ?? "null"));
      redacted = Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      redacted = null;
    }
    return {
      id: String(r.id ?? id),
      externalId: ref(r.externalId),
      transactionId: ref(r.custrecord_nxos_transaction),
      lineKey: ref(r.custrecord_nxos_line_key),
      itemId: ref(r.custrecord_nxos_item),
      disposition: ref(r.custrecord_nxos_disposition),
      projectionVersion: ref(r.custrecord_nxos_projection_version),
      sourceHash: ref(r.custrecord_nxos_source_hash),
      exportHash: ref(r.custrecord_nxos_export_hash),
      redactedKeys: redacted,
      valuesJson: r.custrecord_nxos_values == null ? null : String(r.custrecord_nxos_values),
    };
  },

  async patchLineLink(soId, line, recordId) {
    await patchSalesOrderLineSpecLink(soId, line, recordId);
  },
};

/**
 * Transfer (or re-verify) the ordered specifications of a quote's posted Sales
 * Order. Idempotent; safe to call repeatedly.
 */
export async function runOrderedSpecTransfer(
  args: { quoteId: string },
  deps: SpecTransferDeps = realSpecTransferDeps,
): Promise<OrderedSpecTransferOutcome> {
  try {
    const cfg = loadNetsuiteConfig();
    if (!isOrderedSpecExportEnabled(cfg.env)) {
      return { status: "disabled", reason: `ordered-spec export is not enabled for ${cfg.env}` };
    }

    const [q] = await db
      .select({ id: quotes.id, soId: quotes.netsuiteSoId, tranid: quotes.netsuiteSoTranid })
      .from(quotes)
      .where(eq(quotes.id, args.quoteId))
      .limit(1);
    if (!q?.soId) return { status: "not_applicable", reason: "quote has no NetSuite Sales Order" };

    const [push] = await db
      .select({ snapshotId: netsuiteSoPushes.quoteSnapshotId })
      .from(netsuiteSoPushes)
      .where(
        and(
          eq(netsuiteSoPushes.quoteId, args.quoteId),
          eq(netsuiteSoPushes.netsuiteSoId, q.soId),
          eq(netsuiteSoPushes.status, "succeeded"),
        ),
      )
      .orderBy(desc(netsuiteSoPushes.createdAt))
      .limit(1);
    if (!push?.snapshotId) {
      return { status: "not_applicable", reason: "no succeeded push with a snapshot for this Sales Order" };
    }

    const now = new Date();
    await db
      .insert(netsuiteSpecTransfers)
      .values({
        quoteId: args.quoteId,
        quoteSnapshotId: push.snapshotId,
        netsuiteSoId: q.soId,
        status: "pending",
        projectionVersion: ORDERED_SPEC_PROJECTION_VERSION,
        attemptCount: 1,
        lastAttemptAt: now,
      })
      .onConflictDoUpdate({
        target: netsuiteSpecTransfers.netsuiteSoId,
        set: {
          status: "pending",
          attemptCount: sql`${netsuiteSpecTransfers.attemptCount} + 1`,
          lastAttemptAt: now,
          updatedAt: now,
        },
      });

    let result: SpecTransferResult | null = null;
    let errorDetail: string | null = null;
    try {
      result = await reconcileOrderedSpecs(deps, {
        soId: q.soId,
        soLabel: q.tranid ?? `SO ${q.soId}`,
        snapshotId: push.snapshotId,
      });
      if (result.problems.length > 0) errorDetail = result.problems.join("; ").slice(0, 2000);
    } catch (e) {
      errorDetail = `transfer aborted: ${e instanceof Error ? e.message.slice(0, 500) : "unknown"}`;
    }

    const status: SpecTransferStatus = result?.status ?? "failed";
    const done = status === "succeeded" || status === "succeeded_with_exceptions";
    await db
      .update(netsuiteSpecTransfers)
      .set({
        status,
        projectionVersion: ORDERED_SPEC_PROJECTION_VERSION,
        productLineCount: result?.productLineCount ?? 0,
        verifiedCount: result?.verifiedCount ?? 0,
        exceptionCount: result?.exceptionCount ?? 0,
        failedCount: result?.failedCount ?? 0,
        lines: result?.lines ?? [],
        errorDetail,
        completedAt: done ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(netsuiteSpecTransfers.netsuiteSoId, q.soId));

    return {
      status,
      netsuiteSoId: q.soId,
      errorDetail,
      productLineCount: result?.productLineCount,
      verifiedCount: result?.verifiedCount,
      exceptionCount: result?.exceptionCount,
      failedCount: result?.failedCount,
      lines: result?.lines,
      problems: result?.problems,
    };
  } catch (e) {
    // Even the status row could not be written. Report, never throw.
    return {
      status: "failed",
      netsuiteSoId: "",
      errorDetail: `transfer bookkeeping failed: ${e instanceof Error ? e.message.slice(0, 500) : "unknown"}`,
    };
  }
}
