/**
 * Stage 5 E2E · RETRY / EXISTING-ORDER path. SANDBOX ONLY.
 *
 * For each named quote whose Sales Order already exists in the sandbox, runs
 * the REAL `runOrderedSpecTransfer` (real DB loader, real NetSuite provider)
 * TWICE, then verifies independently of the reconciler:
 *
 *   - SuiteQL: exactly one `customrecord_nx_ordered_spec` per product line,
 *     each carrying the SO id and a distinct line key
 *   - REST: every product line's `custcol_nx_ordered_spec` points at the
 *     record whose line key is that line's own lineUniqueKey
 *   - the second run created nothing and left the order total unchanged
 *   - no record JSON contains the key `fm_actives`
 *
 * Writes ordered-spec records and line links into existing SANDBOX orders and
 * a `netsuite_spec_transfers` row per order. Touches no quote status and no
 * commercial field (the reconciler refuses success if one moves).
 *
 *   ... scripts/gate-1b/ordered-spec-transfer-e2e-existing.ts DPS-1075 DPS-1076 ...
 */
import { db } from "@/db";
import { quotes } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { describeNetsuiteTarget, nsRequest, suiteQL } from "@/lib/netsuite/client";
import { runOrderedSpecTransfer } from "@/lib/netsuite/ordered-spec-transfer-runtime";

if (!describeNetsuiteTarget().accountIsSandbox) {
  console.log("REFUSED — not a sandbox account.");
  process.exit(1);
}
const numbers = process.argv.slice(2);
const rows = await db
  .select({ id: quotes.id, n: quotes.quoteNumber, so: quotes.netsuiteSoId })
  .from(quotes)
  .where(inArray(quotes.quoteNumber, numbers));

let allPass = true;
for (const q of rows) {
  if (!q.so) {
    console.log(`${q.n}: no Sales Order — skipped`);
    continue;
  }
  const totalBefore = Number((await nsRequest<{ total?: number }>({ method: "GET", path: `/record/v1/salesOrder/${q.so}` })).total);
  const r1 = await runOrderedSpecTransfer({ quoteId: q.id });
  const r2 = await runOrderedSpecTransfer({ quoteId: q.id });
  if ("reason" in r1 || "reason" in r2) {
    console.log(`${q.n}: ${"reason" in r1 ? r1.reason : ""} ${"reason" in r2 ? r2.reason : ""}`);
    allPass = false;
    continue;
  }

  const recs = (
    await suiteQL<{ id: string; externalid: string }>(
      `select id, externalid from customrecord_nx_ordered_spec where custrecord_nxos_transaction = ${q.so}`,
    )
  ).items;
  const so = await nsRequest<{ total?: number; item?: { items?: Array<Record<string, unknown>> } }>({
    method: "GET",
    path: `/record/v1/salesOrder/${q.so}?expandSubResources=true`,
  });
  const linkByKey = new Map(
    (so.item?.items ?? []).map((l) => [String(l.lineUniqueKey), (l.custcol_nx_ordered_spec as { id?: string } | undefined)?.id ?? null]),
  );
  const checks: string[] = [];
  const productLines = r2.productLineCount ?? 0;
  if (recs.length !== productLines) checks.push(`records ${recs.length} ≠ product lines ${productLines}`);
  for (const line of r2.lines ?? []) {
    if (!line.lineUniqueKey || !line.recordId) continue;
    if (linkByKey.get(line.lineUniqueKey) !== line.recordId) checks.push(`line ${line.lineUniqueKey} link ≠ record ${line.recordId}`);
    const rec = await nsRequest<Record<string, unknown>>({ method: "GET", path: `/record/v1/customrecord_nx_ordered_spec/${line.recordId}` });
    if (String(rec.custrecord_nxos_line_key) !== line.lineUniqueKey) checks.push(`record ${line.recordId} line key mismatch`);
    if (String(rec.custrecord_nxos_values ?? "").includes("fm_actives")) checks.push(`record ${line.recordId} carries fm_actives`);
  }
  if (Number(so.total) !== totalBefore) checks.push(`order total moved ${totalBefore} → ${so.total}`);
  const created2 = (r2.lines ?? []).length > 0 && r1.status === r2.status;
  const pass = checks.length === 0 && (r2.status === "succeeded" || r2.status === "succeeded_with_exceptions") && created2;
  if (!pass) allPass = false;
  console.log(
    `${q.n} SO ${q.so}: run1=${r1.status} run2=${r2.status} productLines=${productLines} verified=${r2.verifiedCount} exceptions=${r2.exceptionCount} ` +
      `records=${recs.length} methods=${[...new Set((r2.lines ?? []).map((l) => l.matchMethod))].join("/")} ` +
      `${pass ? "PASS" : "FAIL " + checks.join("; ") + (r2.errorDetail ? " · " + r2.errorDetail : "")}`,
  );
  for (const l of r2.lines ?? []) {
    if (l.status !== "verified") console.log(`    ${l.displaySku} key=${l.lineUniqueKey} ${l.status} ${l.reason ?? ""}`);
  }
}
console.log(allPass ? "\nALL PASS" : "\nFAILURES ABOVE");
process.exit(allPass ? 0 : 1);
