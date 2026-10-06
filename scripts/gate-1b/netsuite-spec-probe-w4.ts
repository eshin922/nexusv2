/**
 * W-4 · Same Item Group twice on one Sales Order. SANDBOX ONLY. DISPOSABLE.
 *
 * Question: when one Item Group appears twice on an order, are the expanded
 * member lines individually addressable (distinct `lineUniqueKey`), and can the
 * two occurrences be told apart by position between Group/EndGroup?
 *
 * Creates ONE Sales Order against the ZZ-VALIDATION certification customer,
 * reads it back through REST and SuiteQL, then deletes it and confirms the
 * delete by read-back. Writes no business field: no deal id, no PO / project
 * flags, no DPS custom columns. The memo names the probe so a human can find it
 * if cleanup ever fails.
 */
import {
  createRecord,
  describeNetsuiteTarget,
  getRecord,
  nsRequest,
  suiteQL,
} from "@/lib/netsuite/client";

const CUSTOMER = "388800"; // ZZ-VALIDATION certification customer
const GROUP = "76361"; // TRN-FILL-UNIT-G, owned by the certification customer
const TAG = "nexus-spec-probe W-4";

const target = describeNetsuiteTarget();
if (!target.accountIsSandbox) {
  console.log("REFUSED — not a sandbox account.");
  process.exit(1);
}

const created = await createRecord({
  recordType: "salesOrder",
  body: {
    entity: { id: CUSTOMER },
    memo: `DISPOSABLE — ${TAG}. Safe to delete.`,
    item: {
      items: [
        { item: { id: GROUP }, quantity: 100 },
        { item: { id: GROUP }, quantity: 200 },
      ],
    },
  },
});
const soId = String(created.internalId);
console.log(`created SO internalId=${soId}`);

type Line = Record<string, unknown> & { item?: { id?: string }; itemType?: { id?: string } | string };
let restLines: Line[] = [];
let sqlLines: Record<string, unknown>[] = [];
try {
  const rec = await nsRequest<{ tranId?: string; item?: { items?: Line[] } }>({
    method: "GET",
    path: `/record/v1/salesOrder/${soId}?expandSubResources=true`,
  });
  restLines = rec.item?.items ?? [];
  console.log(`tranId=${rec.tranId}`);
  sqlLines = (
    await suiteQL<Record<string, unknown>>(
      `select linesequencenumber, uniquekey, item, itemtype, quantity
         from transactionline where transaction = ${soId} and mainline = 'F'
        order by linesequencenumber`,
    )
  ).items;
} finally {
  // Cleanup runs even if a read failed. The SO is ours: created above, in this run.
  await nsRequest({ method: "DELETE", path: `/record/v1/salesOrder/${soId}`, maxRetries: 1 });
  let gone = false;
  try {
    await getRecord("salesOrder", soId);
  } catch (e) {
    gone = String(e).includes("404") || String((e as { context?: { status?: number } }).context?.status) === "404";
  }
  console.log(`cleanup: delete issued; read-back ${gone ? "404 — CONFIRMED GONE" : "DID NOT CONFIRM — investigate SO " + soId}`);
}

console.log("\nREST lines (line · lineUniqueKey · item · type · qty):");
let occurrence = 0;
for (const l of restLines) {
  const t = typeof l.itemType === "string" ? l.itemType : l.itemType?.id;
  if (t === "Group") occurrence++;
  console.log(`  ${l.line} · ${l.lineUniqueKey} · ${l.item?.id ?? "-"} · ${t} · ${l.quantity} · group#${occurrence}`);
}
console.log("\nSuiteQL lines (seq · uniquekey · item · type · qty):");
for (const r of sqlLines) {
  console.log(`  ${r.linesequencenumber} · ${r.uniquekey} · ${r.item ?? "-"} · ${r.itemtype} · ${r.quantity}`);
}

const keys = restLines.map((l) => String(l.lineUniqueKey));
const groups = restLines.filter((l) => (typeof l.itemType === "string" ? l.itemType : l.itemType?.id) === "Group").length;
const ends = restLines.filter((l) => (typeof l.itemType === "string" ? l.itemType : l.itemType?.id) === "EndGroup").length;
console.log(`\nVERDICT: lines=${keys.length} distinctKeys=${new Set(keys).size} groupHeaders=${groups} endGroups=${ends}`);
const restKeys = new Set(keys);
const sqlKeys = sqlLines.map((r) => String(r.uniquekey)).filter((k) => restKeys.has(k)).length;
console.log(`REST/SuiteQL key agreement: ${sqlKeys} of ${keys.length}`);
