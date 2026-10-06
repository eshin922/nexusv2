/**
 * Stage 5 E2E · cases no real order exercises yet. SANDBOX ONLY. DISPOSABLE.
 *
 * Real NetSuite provider (`realSpecTransferDeps`), real field schemas from
 * `product_types`, and an INJECTED frozen order, because no frozen order yet
 * carries a populated `fm_actives`:
 *
 *   E1  same Item Group twice + a Direct Product; populated fm_actives on one
 *       member; one `no_type` exception  →  succeeded_with_exceptions, every
 *       record read back, the withheld marker in NO record
 *   E2  rerun  →  same status, no new record
 *   E3  tamper one record in NetSuite  →  rerun reports `conflict` and the
 *       record is NOT overwritten
 *
 * Cleanup: clear line links, delete records, delete the SO; each delete
 * confirmed by a 404 read-back. ZZ-VALIDATION customer; no business field.
 */
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { productTypes } from "@/db/schema";
import { createRecord, describeNetsuiteTarget, nsRequest, suiteQL } from "@/lib/netsuite/client";
import type { FrozenLine } from "@/lib/netsuite/ordered-spec-matching";
import {
  ORDERED_SPEC_RECORD_TYPE,
  reconcileOrderedSpecs,
  type FrozenSpecRow,
} from "@/lib/netsuite/ordered-spec-transfer";
import { realSpecTransferDeps } from "@/lib/netsuite/ordered-spec-transfer-runtime";
import { orderedSpecContentHash } from "@/lib/ordered-spec-hash";

if (!describeNetsuiteTarget().accountIsSandbox) {
  console.log("REFUSED — not a sandbox account.");
  process.exit(1);
}

const MARKER = "NEXUS-E2E-WITHHELD-7781";
const CUSTOMER = "388800";
const GROUP = "76361"; // members 76155, 76156, 76157

// ── real field schemas ──────────────────────────────────────────────────
const types = await db
  .select({ id: productTypes.id, fieldSchema: productTypes.fieldSchema })
  .from(productTypes)
  .where(inArray(productTypes.id, ["leaf_formulated", "leaf_primary_packaging", "leaf_secondary_packaging"]));
const fields = (id: string) =>
  ((types.find((t) => t.id === id)?.fieldSchema as { fields?: Array<{ key: string; label: string }> })?.fields ?? []).map(
    (f) => ({ key: f.key, label: f.label }),
  );
const fieldsBySchema = {
  formulated: fields("leaf_formulated"),
  primary: fields("leaf_primary_packaging"),
  secondary: fields("leaf_secondary_packaging"),
};
if (!fieldsBySchema.formulated.some((f) => f.key === "fm_actives")) throw new Error("formulated schema lacks fm_actives");

const spec = (leaf: string, schema: string | null, productTypeId: string | null, disposition: FrozenSpecRow["disposition"], values: Record<string, unknown>): FrozenSpecRow => ({
  quoteLeafId: leaf,
  disposition,
  specValues: values,
  productTypeId,
  specSchema: schema,
  contentHash: orderedSpecContentHash({ specValues: values, productTypeId, specSchema: schema }),
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const F = (position: number, lineKind: FrozenLine["lineKind"], item: string, leaf: number, asm: string | null, sku: string): FrozenLine => ({
  position,
  lineKind,
  owningAssemblyId: asm,
  quoteLeafId: uuid(leaf),
  netsuiteItemId: item,
  displaySku: sku,
});
const A = uuid(900);
const B = uuid(901);
const frozen = {
  lines: [
    F(0, "item_group_member", "76155", 1, A, "A-serum-bottle"),
    F(1, "item_group_member", "76156", 2, A, "A-pump"),
    F(2, "item_group_member", "76157", 3, A, "A-label"),
    F(3, "item_group_member", "76155", 4, B, "B-cream-bottle"),
    F(4, "item_group_member", "76156", 5, B, "B-pump"),
    F(5, "item_group_member", "76157", 6, B, "B-label"),
    F(6, "direct_product", "76158", 7, null, "carton"),
  ],
  specs: [
    spec(uuid(1), "formulated", "leaf_formulated", "specified", { fm_form: "Serum", fm_net_content: "30 ml", fm_actives: MARKER }),
    spec(uuid(2), "primary", "leaf_primary_packaging", "specified", { pp_size: "20/410", pp_material: "PP" }),
    spec(uuid(3), "secondary", "leaf_secondary_packaging", "specified", { sp_color: "Pantone 7621" }),
    spec(uuid(4), "formulated", "leaf_formulated", "specified", { fm_form: "Cream", fm_net_content: "50 ml" }),
    spec(uuid(5), "primary", "leaf_primary_packaging", "specified", { pp_size: "20/410" }),
    spec(uuid(6), null, null, "no_type", {}),
    spec(uuid(7), "secondary", "leaf_secondary_packaging", "specified", { sp_material: "SBS 18pt" }),
  ],
  fieldsBySchema,
};
const deps = { ...realSpecTransferDeps, loadFrozen: async () => frozen };

// ── disposable SO ───────────────────────────────────────────────────────
const { internalId } = await createRecord({
  recordType: "salesOrder",
  body: {
    entity: { id: CUSTOMER },
    memo: "DISPOSABLE — nexus ordered-spec E2E. Safe to delete.",
    item: {
      items: [
        { item: { id: GROUP }, quantity: 100 },
        { item: { id: GROUP }, quantity: 200 },
        { item: { id: "76158" }, quantity: 300, rate: 0.5 },
      ],
    },
  },
});
const soId = String(internalId);
console.log(`created SO ${soId}`);
const args = { soId, soLabel: `E2E ${soId}`, snapshotId: uuid(999) };
const results: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const recordIds = async () =>
  (await suiteQL<{ id: string }>(`select id from ${ORDERED_SPEC_RECORD_TYPE} where custrecord_nxos_transaction = ${soId}`)).items.map((r) => String(r.id));

try {
  // E1
  const r1 = await reconcileOrderedSpecs(deps, args);
  ok("E1 status", r1.status === "succeeded_with_exceptions", `${r1.status} ${r1.problems.join("; ")}`);
  ok("E1 counts", r1.productLineCount === 7 && r1.verifiedCount === 6 && r1.exceptionCount === 1, `${r1.verifiedCount}/${r1.exceptionCount}/${r1.productLineCount}`);
  ok("E1 group members matched by order", r1.lines.filter((l) => l.displaySku?.startsWith("A-") || l.displaySku?.startsWith("B-")).every((l) => l.matchMethod === "by_order"));
  const ids1 = await recordIds();
  ok("E1 one record per product line", ids1.length === 7, `${ids1.length}`);
  let leak = false;
  for (const id of ids1) {
    const rec = await nsRequest<Record<string, unknown>>({ method: "GET", path: `/record/v1/${ORDERED_SPEC_RECORD_TYPE}/${id}` });
    if (JSON.stringify(rec).includes(MARKER) || String(rec.custrecord_nxos_values ?? "").includes("fm_actives")) leak = true;
  }
  ok("E1 withheld value absent from every NetSuite record", !leak);
  const serum = r1.lines.find((l) => l.displaySku === "A-serum-bottle")!;
  ok("E1 redaction recorded + hashes differ", JSON.stringify(serum.redactedKeys) === '["fm_actives"]' && serum.sourceHash !== serum.exportHash);
  const cream = r1.lines.find((l) => l.displaySku === "B-cream-bottle")!;
  ok("E1 same SKU, two groups, two different specs", cream.lineUniqueKey !== serum.lineUniqueKey && cream.exportHash !== serum.exportHash);
  ok("E1 status row carries no withheld value", !JSON.stringify(r1).includes(MARKER));

  // E2
  const r2 = await reconcileOrderedSpecs(deps, args);
  const ids2 = await recordIds();
  ok("E2 rerun idempotent", r2.status === r1.status && ids2.length === ids1.length, `${r2.status} records=${ids2.length}`);

  // E3
  const target = r1.lines.find((l) => l.displaySku === "carton")!.recordId!;
  await nsRequest({
    method: "PATCH",
    path: `/record/v1/${ORDERED_SPEC_RECORD_TYPE}/${target}`,
    body: { custrecord_nxos_values: JSON.stringify({ sp_material: "TAMPERED" }) },
  });
  const r3 = await reconcileOrderedSpecs(deps, args);
  const after = await nsRequest<Record<string, unknown>>({ method: "GET", path: `/record/v1/${ORDERED_SPEC_RECORD_TYPE}/${target}` });
  ok("E3 tampered record → conflict", r3.status === "conflict", r3.lines.find((l) => l.recordId === target)?.reason ?? "");
  ok("E3 conflicting record NOT overwritten", String(after.custrecord_nxos_values).includes("TAMPERED"));
} finally {
  // ── cleanup ────────────────────────────────────────────────────────────
  const so = await nsRequest<{ item?: { items?: Array<Record<string, unknown>> } }>({
    method: "GET",
    path: `/record/v1/salesOrder/${soId}?expandSubResources=true`,
  });
  for (const l of so.item?.items ?? []) {
    if (l.custcol_nx_ordered_spec) {
      await nsRequest({ method: "PATCH", path: `/record/v1/salesOrder/${soId}/item/${l.line}`, body: { custcol_nx_ordered_spec: null } });
    }
  }
  const gone = async (path: string) => {
    try {
      await nsRequest({ method: "GET", path, maxRetries: 1 });
      return false;
    } catch (e) {
      return (e as { context?: { status?: number } }).context?.status === 404;
    }
  };
  let allGone = true;
  for (const id of await recordIds()) {
    await nsRequest({ method: "DELETE", path: `/record/v1/${ORDERED_SPEC_RECORD_TYPE}/${id}` });
    if (!(await gone(`/record/v1/${ORDERED_SPEC_RECORD_TYPE}/${id}`))) allGone = false;
  }
  await nsRequest({ method: "DELETE", path: `/record/v1/salesOrder/${soId}` });
  const soGone = await gone(`/record/v1/salesOrder/${soId}`);
  results.push(`cleanup: records ${allGone ? "CONFIRMED GONE" : "NOT CONFIRMED"}; SO ${soId} ${soGone ? "CONFIRMED GONE" : "NOT CONFIRMED"}`);
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FAIL") || r.includes("NOT CONFIRMED")) ? 1 : 0);
}
