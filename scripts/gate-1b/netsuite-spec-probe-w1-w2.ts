/**
 * W-1 + W-2 · Ordered-spec record and line link on an expanded Item Group
 * member. SANDBOX ONLY. DISPOSABLE. Uses ONLY the dedicated Nexus
 * customization — never an existing DPS business field.
 *
 *   W-2  Can the integration role create, read and delete an instance of
 *        `customrecord_nx_ordered_spec`, and does the read-back reproduce the
 *        redacted projection exactly (`compareReadBack`)?
 *   W-1  Does a PATCH of `custcol_nx_ordered_spec` on an expanded group MEMBER
 *        persist, and does every `lineUniqueKey` survive it?
 *
 * PRECONDITION GATE: refuses before writing anything unless the sandbox
 * metadata shows the dedicated record type and line field. See
 * `.artifacts/netsuite-spec-customization-build-sheet.md`.
 *
 * The payload is SYNTHETIC: a formulated spec whose `fm_actives` carries a
 * marker string. The marker must not appear in anything sent or read back.
 *
 * Cleanup order is forced by the two references: clear the line field, delete
 * the record, delete the SO. Each is confirmed by a 404 read-back.
 */
import {
  createRecord,
  describeNetsuiteTarget,
  nsRequest,
  suiteQL,
} from "@/lib/netsuite/client";
import { orderedSpecContentHash } from "@/lib/ordered-spec-hash";
import {
  compareReadBack,
  projectOrderedSpecForExport,
} from "@/lib/ordered-spec-projection";

const CUSTOMER = "388800"; // ZZ-VALIDATION certification customer
const GROUP = "76361"; // TRN-FILL-UNIT-G
const RECORD = "customrecord_nx_ordered_spec";
const LINE_FIELD = "custcol_nx_ordered_spec";
const MARKER = "NEXUS-PROBE-WITHHELD-MARKER-7781";

const target = describeNetsuiteTarget();
if (!target.accountIsSandbox) {
  console.log("REFUSED — not a sandbox account.");
  process.exit(1);
}

// ── precondition gate ───────────────────────────────────────────────────
const schemaHeaders = { Accept: "application/schema+json" };
let recordProps: Record<string, unknown> = {};
try {
  const md = await nsRequest<{ properties?: Record<string, unknown> }>({
    method: "GET",
    path: `/record/v1/metadata-catalog/${RECORD}`,
    extraHeaders: schemaHeaders,
    maxRetries: 1,
  });
  recordProps = md.properties ?? {};
} catch (e) {
  console.log(`REFUSED — ${RECORD} is not visible to the integration role: ${String(e).slice(0, 160)}`);
  process.exit(2);
}
const soMd = await nsRequest<{
  properties?: { item?: { properties?: { items?: { items?: { properties?: Record<string, unknown> } } } } };
}>({ method: "GET", path: "/record/v1/metadata-catalog/salesOrder", extraHeaders: schemaHeaders, maxRetries: 1 });
const lineProps = soMd.properties?.item?.properties?.items?.items?.properties ?? {};
const REQUIRED = [
  "custrecord_nxos_transaction",
  "custrecord_nxos_line_key",
  "custrecord_nxos_item",
  "custrecord_nxos_quote_leaf",
  "custrecord_nxos_snapshot",
  "custrecord_nxos_source_hash",
  "custrecord_nxos_export_hash",
  "custrecord_nxos_projection_version",
  "custrecord_nxos_redacted_keys",
  "custrecord_nxos_disposition",
  "custrecord_nxos_schema",
  "custrecord_nxos_values",
  "custrecord_nxos_readable",
];
const missing = REQUIRED.filter((k) => !(k in recordProps));
const lineFieldPresent = LINE_FIELD in lineProps;
if (missing.length > 0 || !lineFieldPresent) {
  console.log(
    `REFUSED — customization incomplete. missing record fields: ${missing.join(", ") || "none"}; ` +
      `line field ${LINE_FIELD}: ${lineFieldPresent ? "present" : "MISSING"}`,
  );
  process.exit(2);
}
console.log("precondition: dedicated record + line field present");

// ── synthetic frozen spec → redacted projection ─────────────────────────
const fields = [
  { key: "fm_form", label: "Form" },
  { key: "fm_net_content", label: "Net content / fill" },
  { key: "fm_actives", label: "Actives / reference formula" },
];
const sourceValues = { fm_form: "Serum (probe)", fm_net_content: "30 ml", fm_actives: MARKER };
const proj = projectOrderedSpecForExport({
  disposition: "specified",
  specValues: sourceValues,
  productTypeId: "leaf_formulated",
  specSchema: "formulated",
  contentHash: orderedSpecContentHash({
    specValues: sourceValues,
    productTypeId: "leaf_formulated",
    specSchema: "formulated",
  }),
  fields,
});
if (!proj.ok) throw new Error(`projection refused: ${JSON.stringify(proj.refusal)}`);
const p = proj.projection;
if (JSON.stringify(p).includes(MARKER)) throw new Error("projection contains the withheld marker");

// ── disposable SO ───────────────────────────────────────────────────────
const created = await createRecord({
  recordType: "salesOrder",
  body: {
    entity: { id: CUSTOMER },
    memo: "DISPOSABLE — nexus-spec-probe W-1/W-2. Safe to delete.",
    item: { items: [{ item: { id: GROUP }, quantity: 100 }] },
  },
});
const soId = String(created.internalId);
console.log(`created SO ${soId}`);

type Line = { line?: number; lineUniqueKey?: string | number; item?: { id?: string }; itemType?: { id?: string } | string } & Record<string, unknown>;
const readLines = async (): Promise<Line[]> =>
  (
    await nsRequest<{ item?: { items?: Line[] } }>({
      method: "GET",
      path: `/record/v1/salesOrder/${soId}?expandSubResources=true`,
    })
  ).item?.items ?? [];

let recId: string | null = null;
let memberLine: number | null = null;
const results: string[] = [];
try {
  const before = await readLines();
  const member = before.find((l) => {
    const t = typeof l.itemType === "string" ? l.itemType : l.itemType?.id;
    return t === "InvtPart";
  });
  if (!member || member.line === undefined) throw new Error("no expanded member line found");
  memberLine = member.line;
  const lineKey = String(member.lineUniqueKey);
  const itemId = String(member.item?.id);
  console.log(`member line ${memberLine} key ${lineKey} item ${itemId}`);

  // W-2 · create the ordered-spec record
  const externalId = `nxos:${soId}:${lineKey}`;
  const body = {
    externalId,
    name: `nexus-spec-probe ${soId}:${lineKey}`,
    custrecord_nxos_transaction: { id: soId },
    custrecord_nxos_line_key: Number(lineKey),
    custrecord_nxos_item: { id: itemId },
    custrecord_nxos_quote_leaf: "00000000-0000-0000-0000-000000000000",
    custrecord_nxos_snapshot: "00000000-0000-0000-0000-000000000000",
    custrecord_nxos_source_hash: p.sourceHash,
    custrecord_nxos_export_hash: p.exportHash,
    custrecord_nxos_projection_version: p.projectionVersion,
    custrecord_nxos_redacted_keys: JSON.stringify(p.redactedKeys),
    custrecord_nxos_disposition: p.disposition,
    custrecord_nxos_schema: p.specSchema,
    custrecord_nxos_values: JSON.stringify(p.values),
    custrecord_nxos_readable: p.readable,
  };
  if (JSON.stringify(body).includes(MARKER)) throw new Error("payload contains the withheld marker");
  recId = String((await createRecord({ recordType: RECORD, body })).internalId);
  console.log(`W-2 created ${RECORD} ${recId}`);

  const rb = await nsRequest<Record<string, unknown>>({ method: "GET", path: `/record/v1/${RECORD}/${recId}` });
  const ref = (v: unknown) => (v && typeof v === "object" ? String((v as { id?: unknown }).id ?? "") : v == null ? null : String(v));
  const cmp = compareReadBack(
    { ...p, lineKey, itemId },
    {
      lineKey: ref(rb.custrecord_nxos_line_key),
      itemId: ref(rb.custrecord_nxos_item),
      disposition: ref(rb.custrecord_nxos_disposition),
      projectionVersion: ref(rb.custrecord_nxos_projection_version),
      sourceHash: ref(rb.custrecord_nxos_source_hash),
      exportHash: ref(rb.custrecord_nxos_export_hash),
      redactedKeys: JSON.parse(String(rb.custrecord_nxos_redacted_keys ?? "null")) as string[] | null,
      valuesJson: ref(rb.custrecord_nxos_values),
    },
  );
  results.push(`W-2 read-back: ${cmp.matches ? "MATCH" : "MISMATCH " + cmp.mismatched.join(",")}`);
  results.push(`W-2 transaction link: ${ref(rb.custrecord_nxos_transaction) === soId ? "ok" : "WRONG " + ref(rb.custrecord_nxos_transaction)}`);
  results.push(`W-2 marker absent from read-back: ${JSON.stringify(rb).includes(MARKER) ? "NO — LEAK" : "yes"}`);

  // W-2b · the (SO, lineUniqueKey) identity is enforced by NetSuite itself
  try {
    // Different NAME, same externalId: the 2026-10-05 first run was refused on
    // the duplicate name, which says nothing about externalId uniqueness.
    const dup = await createRecord({ recordType: RECORD, body: { ...body, name: `${body.name} dup` } });
    results.push(`W-2b duplicate externalId: ACCEPTED (record ${dup.internalId}) — uniqueness NOT enforced`);
    await nsRequest({ method: "DELETE", path: `/record/v1/${RECORD}/${dup.internalId}`, maxRetries: 1 });
  } catch (e) {
    results.push(`W-2b duplicate externalId refused: ${String(e).slice(0, 140)}`);
  }

  // W-1 · link the member line to the record
  await nsRequest({
    method: "PATCH",
    path: `/record/v1/salesOrder/${soId}/item/${memberLine}`,
    body: { [LINE_FIELD]: { id: recId } },
    maxRetries: 1,
  });
  const after = await readLines();
  const keysBefore = before.map((l) => String(l.lineUniqueKey)).join(",");
  const keysAfter = after.map((l) => String(l.lineUniqueKey)).join(",");
  const linked = after.find((l) => String(l.lineUniqueKey) === lineKey);
  results.push(`W-1 line field persisted: ${ref(linked?.[LINE_FIELD]) === recId ? "yes" : "NO (" + ref(linked?.[LINE_FIELD]) + ")"}`);
  results.push(`W-1 lineUniqueKeys unchanged: ${keysBefore === keysAfter ? "yes" : "NO\n  before " + keysBefore + "\n  after  " + keysAfter}`);
  const others = after.filter((l) => String(l.lineUniqueKey) !== lineKey && l[LINE_FIELD]);
  results.push(`W-1 no other line touched: ${others.length === 0 ? "yes" : "NO — " + others.length}`);
  const sql = await suiteQL<Record<string, unknown>>(
    `select uniquekey from transactionline where transaction = ${soId} and mainline = 'F' and itemtype <> 'TaxItem' and itemtype <> 'TaxGroup' order by linesequencenumber`,
  );
  results.push(`W-1 SuiteQL keys agree: ${sql.items.map((r) => String(r.uniquekey)).join(",") === keysAfter ? "yes" : "NO"}`);
} finally {
  const gone = async (path: string) => {
    try {
      await nsRequest({ method: "GET", path, maxRetries: 1 });
      return false;
    } catch (e) {
      return (e as { context?: { status?: number } }).context?.status === 404;
    }
  };
  if (memberLine !== null && recId !== null) {
    try {
      await nsRequest({
        method: "PATCH",
        path: `/record/v1/salesOrder/${soId}/item/${memberLine}`,
        body: { [LINE_FIELD]: null },
        maxRetries: 1,
      });
    } catch (e) {
      results.push(`cleanup: clearing line field failed: ${String(e).slice(0, 160)}`);
    }
  }
  if (recId !== null) {
    try {
      await nsRequest({ method: "DELETE", path: `/record/v1/${RECORD}/${recId}`, maxRetries: 1 });
    } catch (e) {
      results.push(`cleanup: record delete failed: ${String(e).slice(0, 160)}`);
    }
    results.push(`cleanup: ${RECORD} ${recId} ${(await gone(`/record/v1/${RECORD}/${recId}`)) ? "CONFIRMED GONE" : "NOT CONFIRMED — investigate"}`);
  }
  try {
    await nsRequest({ method: "DELETE", path: `/record/v1/salesOrder/${soId}`, maxRetries: 1 });
  } catch (e) {
    results.push(`cleanup: SO delete failed: ${String(e).slice(0, 160)}`);
  }
  results.push(`cleanup: SO ${soId} ${(await gone(`/record/v1/salesOrder/${soId}`)) ? "CONFIRMED GONE" : "NOT CONFIRMED — investigate"}`);
  console.log(results.join("\n"));
}
