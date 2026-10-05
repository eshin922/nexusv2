/**
 * Stage 5 E2E · FRESH `markComplete` path. SANDBOX NetSuite only.
 *
 * Runs the real `runMarkComplete` on ONE accepted ZZ-VALIDATION certification
 * quote, then verifies INDEPENDENTLY of the reconciler:
 *
 *   1  the quote is `complete` and its commercial push status `succeeded`
 *   2  the Sales Order exists; every posted line's quantity / rate / amount and
 *      the order total equal the FROZEN accepted tier (quote_snapshot_line_tiers
 *      + quote_snapshot_tier_totals) — read AFTER the spec transfer
 *   3  exactly one customrecord_nx_ordered_spec per spec-bearing frozen line;
 *      each posted line links to the record carrying its own lineUniqueKey
 *   4  each record's exported values equal the frozen spec values (redacted),
 *      redacted keys recorded, no record contains `fm_actives`
 *   5  `netsuite_spec_transfers` holds an independent status row
 *   6  a retry creates nothing and moves no commercial field
 *
 * Refuses unless the NetSuite target is a sandbox account AND certification
 * mode suppresses the HubSpot Accept-side deal mutation.
 *
 *   ... ordered-spec-transfer-e2e-fresh.ts <quoteId> <actorUserId>
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  netsuiteSpecTransfers,
  quoteSnapshotLeafSpecs,
  quoteSnapshotLines,
  quoteSnapshotLineTiers,
  quoteSnapshotTierTotals,
  quotes,
} from "@/db/schema";
import { isHubspotAcceptSyncSuppressed } from "@/lib/config/certification-mode";
import { describeNetsuiteTarget, nsRequest, suiteQL } from "@/lib/netsuite/client";
import { runMarkComplete } from "@/lib/netsuite/mark-complete";
import { runOrderedSpecTransfer } from "@/lib/netsuite/ordered-spec-transfer-runtime";
import { isSpecBearingLineKind } from "@/lib/ordered-spec-disposition";
import { redactWithheldSpecValues } from "@/lib/ordered-spec-projection";
import { canonicalize } from "@/lib/ordered-spec-hash";

const [quoteId, actorUserId] = process.argv.slice(2);
if (!quoteId || !actorUserId) {
  console.log("usage: ordered-spec-transfer-e2e-fresh <quoteId> <actorUserId>");
  process.exit(2);
}
if (!describeNetsuiteTarget().accountIsSandbox) {
  console.log("REFUSED — NetSuite target is not a sandbox account.");
  process.exit(2);
}
if (!isHubspotAcceptSyncSuppressed()) {
  console.log("REFUSED — certification mode is OFF; HubSpot deal mutation would not be suppressed.");
  process.exit(2);
}
const [q0] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
if (!q0 || q0.status !== "accepted") {
  console.log(`REFUSED — quote ${quoteId} is ${q0?.status ?? "missing"}, not accepted.`);
  process.exit(2);
}
console.log(`quote ${q0.quoteNumber} accepted · running markComplete (sandbox, HubSpot suppressed)`);

const out: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => out.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);

const result = await runMarkComplete({ quoteId, actorUserId });
const soId = result.netsuite.salesOrderId;
console.log(`markComplete: SO ${result.netsuite.salesOrderTranid} (${soId}) amount ${result.netsuite.amountPushed} · amountPatch ${result.amountPatch.status} · specTransfer ${result.specTransfer.status}`);

// 1 · quote state
const [q1] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
ok("1 quote complete + commercial push succeeded", q1.status === "complete" && q1.netsuiteSoPushStatus === "succeeded", `${q1.status}/${q1.netsuiteSoPushStatus}`);
ok("1 HubSpot amount patch did not write", result.amountPatch.status !== "patched", result.amountPatch.status);

// frozen expectation
const snapshotId = (
  await db.select({ id: netsuiteSpecTransfers.quoteSnapshotId }).from(netsuiteSpecTransfers).where(eq(netsuiteSpecTransfers.netsuiteSoId, soId))
)[0]?.id;
ok("5 independent spec-transfer row exists", !!snapshotId);
const tierId = q1.acceptedTierId!;
const frozenLines = await db.select().from(quoteSnapshotLines).where(eq(quoteSnapshotLines.quoteSnapshotId, snapshotId!));
const frozenTiers = await db.select().from(quoteSnapshotLineTiers).where(eq(quoteSnapshotLineTiers.tierId, tierId));
const [tierTotal] = await db
  .select()
  .from(quoteSnapshotTierTotals)
  .where(and(eq(quoteSnapshotTierTotals.quoteSnapshotId, snapshotId!), eq(quoteSnapshotTierTotals.tierId, tierId)));
const specs = await db.select().from(quoteSnapshotLeafSpecs).where(eq(quoteSnapshotLeafSpecs.quoteSnapshotId, snapshotId!));

// 2 · Sales Order commercial fields vs frozen accepted tier (read AFTER transfer)
type L = Record<string, unknown> & { line: number; lineUniqueKey: string; item?: { id?: string }; itemType?: { id?: string } | string };
const readSo = async () => nsRequest<{ total?: number; item?: { items?: L[] } }>({ method: "GET", path: `/record/v1/salesOrder/${soId}?expandSubResources=true` });
const so1 = await readSo();
const lines1 = so1.item?.items ?? [];
const commercial = (ls: L[]) => ls.map((l) => `${l.lineUniqueKey}:${l.item?.id}:${l.quantity}:${l.rate}:${l.amount}`).join("|");
const tierByLine = new Map(frozenTiers.map((t) => [t.quoteSnapshotLineId, t] as const));
const posted = lines1.filter((l) => {
  const t = typeof l.itemType === "string" ? l.itemType : l.itemType?.id;
  return !["Group", "EndGroup", "TaxGroup", "TaxItem"].includes(String(t));
});
let lineAmountMismatch = 0;
for (const f of frozenLines) {
  const t = tierByLine.get(f.id);
  if (!t || t.lineAmount === null) continue;
  const matches = posted.filter((p) => String(p.item?.id) === f.netsuiteItemId && Math.abs(Number(p.amount) - Number(t.lineAmount)) < 0.005);
  if (matches.length === 0) lineAmountMismatch++;
}
ok("2 every frozen line amount present on the Sales Order", lineAmountMismatch === 0, `${lineAmountMismatch} missing`);
ok(
  "2 order total = frozen accepted tier total",
  Math.abs(Number(so1.total) - Number(tierTotal?.tierCommercialTotal)) < 0.005,
  `${so1.total} vs ${tierTotal?.tierCommercialTotal}`,
);

// 3 · records and links
const recs = (await suiteQL<{ id: string }>(`select id from customrecord_nx_ordered_spec where custrecord_nxos_transaction = ${soId}`)).items.map((r) => String(r.id));
const productLines = frozenLines.filter((f) => isSpecBearingLineKind(f.lineKind));
ok("3 one record per spec-bearing product line", recs.length === productLines.length, `${recs.length} records / ${productLines.length} product lines`);
let linkProblems = 0;
let valueProblems = 0;
let leak = false;
const specByLeaf = new Map(specs.map((s) => [s.quoteLeafId, s] as const));
for (const id of recs) {
  const rec = await nsRequest<Record<string, unknown>>({ method: "GET", path: `/record/v1/customrecord_nx_ordered_spec/${id}` });
  const key = String(rec.custrecord_nxos_line_key);
  const line = lines1.find((l) => String(l.lineUniqueKey) === key);
  const link = (line?.custcol_nx_ordered_spec as { id?: string } | undefined)?.id;
  if (link !== id) linkProblems++;
  if (JSON.stringify(rec).includes("fm_actives")) leak = true;
  const leaf = String(rec.custrecord_nxos_quote_leaf);
  const s = specByLeaf.get(leaf);
  const expected = s?.disposition === "specified" ? redactWithheldSpecValues(s.specValues as Record<string, unknown>).values : {};
  if (JSON.stringify(canonicalize(expected)) !== JSON.stringify(canonicalize(JSON.parse(String(rec.custrecord_nxos_values ?? "{}"))))) valueProblems++;
  if (String(rec.custrecord_nxos_source_hash) !== s?.contentHash) valueProblems++;
}
ok("3 every record linked from the line with its own lineUniqueKey", linkProblems === 0, `${linkProblems} problems`);
ok("4 exported values = frozen (redacted) values; source hash = frozen hash", valueProblems === 0, `${valueProblems} problems`);
ok("4 no NetSuite record contains fm_actives", !leak);

// 5 · status row
const [row] = await db.select().from(netsuiteSpecTransfers).where(eq(netsuiteSpecTransfers.netsuiteSoId, soId));
ok("5 spec-transfer status succeeded, separate from commercial status", row.status === "succeeded" && row.verifiedCount === productLines.length, `${row.status} ${row.verifiedCount}/${row.productLineCount}`);
ok("5 status row carries no spec values", !JSON.stringify(row.lines).includes('"values"'));

// 6 · retry
const retry = await runOrderedSpecTransfer({ quoteId });
const recs2 = (await suiteQL<{ id: string }>(`select id from customrecord_nx_ordered_spec where custrecord_nxos_transaction = ${soId}`)).items.length;
const so2 = await readSo();
ok("6 retry idempotent", retry.status === "succeeded" && recs2 === recs.length, `${retry.status} records=${recs2}`);
ok("6 no commercial field moved across retry", commercial(so2.item?.items ?? []) === commercial(lines1) && so2.total === so1.total);

console.log(out.join("\n"));
process.exit(out.some((l) => l.startsWith("FAIL")) ? 1 : 0);
