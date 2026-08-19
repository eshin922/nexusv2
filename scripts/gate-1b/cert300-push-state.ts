/**
 * What the push actually left behind — READ ONLY.
 *
 * "Nothing was posted" is a claim, and a refusal message asserting it is not
 * evidence for it. This reads the rows that would exist if anything HAD been
 * posted: the attempt ledger, the quote's own NetSuite columns, and the
 * lifecycle audit trail.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLog, netsuiteSoPushes, quotes } from "@/db/schema";

const QUOTE_ID = process.argv[2] ?? "97d25286-2c42-4a72-8979-89f1a5c2cf26";

const [q] = await db
  .select({
    status: quotes.status,
    versionNumber: quotes.versionNumber,
    acceptedTierId: quotes.acceptedTierId,
    customerAcceptedTierId: quotes.customerAcceptedTierId,
    netsuiteSoId: quotes.netsuiteSoId,
    netsuiteSoTranid: quotes.netsuiteSoTranid,
    netsuitePushStatus: quotes.netsuiteSoPushStatus,
    netsuitePushError: quotes.netsuiteSoPushError,
    netsuitePushedAt: quotes.netsuitePushedAt,
  })
  .from(quotes)
  .where(eq(quotes.id, QUOTE_ID));

console.log("── quote NetSuite columns ────────────────────────────");
console.log(q);

const pushes = await db
  .select({
    id: netsuiteSoPushes.id,
    status: netsuiteSoPushes.status,
    soId: netsuiteSoPushes.netsuiteSoId,
    tranid: netsuiteSoPushes.netsuiteSoTranid,
    amount: netsuiteSoPushes.amountPushed,
    errorClass: netsuiteSoPushes.errorClass,
    errorDetail: netsuiteSoPushes.errorDetail,
    createdAt: netsuiteSoPushes.createdAt,
  })
  .from(netsuiteSoPushes)
  .where(eq(netsuiteSoPushes.quoteId, QUOTE_ID))
  .orderBy(desc(netsuiteSoPushes.createdAt));

console.log("\n── netsuite_so_pushes attempt ledger ─────────────────");
if (pushes.length === 0) console.log("no attempt rows at all");
else
  console.table(
    pushes.map((p) => ({
      status: p.status,
      soId: p.soId,
      tranid: p.tranid,
      amount: p.amount,
      errClass: p.errorClass,
      err: (p.errorDetail ?? "").slice(0, 60),
      at: p.createdAt?.toISOString?.() ?? String(p.createdAt),
    })),
  );

const audits = await db
  .select({
    action: auditLog.action,
    createdAt: auditLog.createdAt,
  })
  .from(auditLog)
  .where(and(eq(auditLog.entityType, "quote"), eq(auditLog.entityId, QUOTE_ID)))
  .orderBy(desc(auditLog.createdAt))
  .limit(12);

console.log("\n── recent quote audit actions ────────────────────────");
console.table(
  audits.map((a) => ({
    action: a.action,
    at: a.createdAt?.toISOString?.() ?? String(a.createdAt),
  })),
);

const posted =
  q?.netsuiteSoId !== null || pushes.some((p) => p.soId !== null);
console.log("\n── verdict ───────────────────────────────────────────");
console.log(
  posted
    ? "A NetSuite Sales Order id EXISTS — something was posted."
    : "No NetSuite Sales Order id anywhere — nothing was posted.",
);

process.exit(0);
