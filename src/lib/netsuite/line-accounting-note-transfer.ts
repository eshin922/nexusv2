import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { netsuiteSoPushes, quoteSnapshotLines, quotes } from "@/db/schema";
import { isLineAccountingNoteExportEnabled } from "@/lib/config/line-accounting-note-export";
import { loadNetsuiteConfig, nsRequest, patchSalesOrderLineAccountingNote } from "./client";
import { transferFrozenLineAccountingNotes, type FrozenNote, type OrderRead, type LineAccountingNoteOutcome } from "./line-accounting-note-reconcile";
export type { LineAccountingNoteOutcome } from "./line-accounting-note-reconcile";

export const ACCOUNTING_NOTE_LINE_FIELD = "custcol_nx_accounting_note";

const ref = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return id == null ? null : String(id);
  }
  return String(value);
};
const number = (value: unknown): number | null =>
  value == null || value === "" ? null : Number(value);

async function readOrder(soId: string): Promise<OrderRead> {
  const rec = await nsRequest<{ total?: unknown; item?: { items?: Record<string, unknown>[] } }>({
    method: "GET",
    path: `/record/v1/salesOrder/${encodeURIComponent(soId)}?expandSubResources=true`,
  });
  return {
    total: number(rec.total),
    lines: (rec.item?.items ?? []).map((line) => ({
      line: Number(line.line),
      lineUniqueKey: String(line.lineUniqueKey),
      itemId: ref(line.item),
      itemType: ref(line.itemType),
      accountingNote: line[ACCOUNTING_NOTE_LINE_FIELD] == null
        ? null : String(line[ACCOUNTING_NOTE_LINE_FIELD]),
      quantity: number(line.quantity),
      rate: number(line.rate),
      amount: number(line.amount),
    })),
  };
}

/** Never blocks an otherwise correct commercial Sales Order. */
export async function runLineAccountingNoteTransfer(args: { quoteId: string }): Promise<LineAccountingNoteOutcome> {
  try {
    if (!isLineAccountingNoteExportEnabled()) {
      return { status: "disabled", reason: "NetSuite line accounting-note field is not enabled" };
    }
    const cfg = loadNetsuiteConfig();
    const [quote] = await db.select({ soId: quotes.netsuiteSoId }).from(quotes)
      .where(eq(quotes.id, args.quoteId)).limit(1);
    if (!quote?.soId) return { status: "not_applicable", reason: "No Sales Order" };
    const [push] = await db.select({ snapshotId: netsuiteSoPushes.quoteSnapshotId })
      .from(netsuiteSoPushes)
      .where(and(eq(netsuiteSoPushes.quoteId, args.quoteId),
        eq(netsuiteSoPushes.netsuiteSoId, quote.soId), eq(netsuiteSoPushes.status, "succeeded")))
      .orderBy(desc(netsuiteSoPushes.createdAt)).limit(1);
    if (!push?.snapshotId) return { status: "not_applicable", reason: "No succeeded frozen push" };
    const rows = await db.select().from(quoteSnapshotLines)
      .where(eq(quoteSnapshotLines.quoteSnapshotId, push.snapshotId));
    const frozen: FrozenNote[] = rows.map((line) => ({
      position: line.position,
      lineKind: line.lineKind,
      owningAssemblyId: line.owningAssemblyId,
      quoteLeafId: line.quoteLeafId,
      netsuiteItemId: line.netsuiteItemId,
      displaySku: line.displaySku,
      accountingNote: line.accountingNote,
    }));
    if (!/_SB\d+$/i.test(cfg.accountId) && cfg.env !== "production") {
      return { status: "failed", expected: 0, verified: 0, errors: ["NetSuite account environment is inconsistent"] };
    }
    return await transferFrozenLineAccountingNotes(quote.soId, frozen, readOrder, patchSalesOrderLineAccountingNote);
  } catch (error) {
    return { status: "failed", expected: 0, verified: 0,
      errors: [error instanceof Error ? error.message : String(error)] };
  }
}
