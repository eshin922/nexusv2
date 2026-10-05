import assert from "node:assert/strict";
import test from "node:test";

import { isOrderedSpecExportEnabled } from "../../src/lib/config/ordered-spec-export.ts";
import { orderedSpecContentHash } from "../../src/lib/ordered-spec-hash.ts";
import {
  matchPostedSpecLines,
  type FrozenLine,
  type PostedLine,
} from "../../src/lib/netsuite/ordered-spec-matching.ts";
import {
  orderedSpecExternalId,
  reconcileOrderedSpecs,
  type FrozenSpecRow,
  type ObservedSpecRecord,
  type PostedSoLine,
  type SpecTransferDeps,
} from "../../src/lib/netsuite/ordered-spec-transfer.ts";

// ═══════════════════════════════════════════════════════════════════════
// MATCHING — posted line ↔ frozen line, identity = lineUniqueKey
// ═══════════════════════════════════════════════════════════════════════

const P = (line: number, key: string, itemId: string | null, itemType: string): PostedLine => ({
  line,
  lineUniqueKey: key,
  itemId,
  itemType,
});
const F = (
  position: number,
  lineKind: FrozenLine["lineKind"],
  netsuiteItemId: string | null,
  quoteLeafId: string | null,
  owningAssemblyId: string | null = null,
): FrozenLine => ({ position, lineKind, owningAssemblyId, quoteLeafId, netsuiteItemId, displaySku: null });

test("SO2735 shape: group members + direct product match; services, OTC and system lines do not", () => {
  const posted = [
    P(1, "11", "76361", "Group"),
    P(2, "12", "76155", "InvtPart"),
    P(3, "13", "76156", "InvtPart"),
    P(4, "14", "76157", "InvtPart"),
    P(5, "15", "0", "EndGroup"),
    P(6, "16", "76158", "InvtPart"),
    P(7, "17", "59157", "NonInvtPart"),
    P(8, "18", "4081", "NonInvtPart"),
    P(9, "19", "-8", "TaxGroup"),
  ];
  const frozen = [
    F(0, "item_group_member", "76155", "L-bottle", "A1"),
    F(1, "item_group_member", "76156", "L-pump", "A1"),
    F(2, "item_group_member", "76157", "L-label", "A1"),
    F(3, "direct_product", "76158", "L-carton"),
    F(4, "direct_service", "59157", "L-svc"),
    F(5, "otc", "4081", "L-carton"), // an OTC charge carrying its product's leaf
  ];
  const r = matchPostedSpecLines(posted, frozen);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(
    r.matches.map((m) => [m.frozen.quoteLeafId, m.posted.lineUniqueKey, m.method]).sort(),
    [
      ["L-bottle", "12", "unique"],
      ["L-carton", "16", "unique"],
      ["L-label", "14", "unique"],
      ["L-pump", "13", "unique"],
    ],
  );
});

test("W-4 shape: the same Item Group twice is matched by occurrence ORDER, and says so", () => {
  const posted = [
    P(1, "21", "G", "Group"),
    P(2, "22", "76155", "InvtPart"),
    P(3, "23", "76156", "InvtPart"),
    P(4, "24", "0", "EndGroup"),
    P(5, "25", "G", "Group"),
    P(6, "26", "76155", "InvtPart"),
    P(7, "27", "76156", "InvtPart"),
    P(8, "28", "0", "EndGroup"),
  ];
  const frozen = [
    F(0, "item_group_member", "76155", "A-bottle", "A"),
    F(1, "item_group_member", "76156", "A-pump", "A"),
    F(2, "item_group_member", "76155", "B-bottle", "B"),
    F(3, "item_group_member", "76156", "B-pump", "B"),
  ];
  const r = matchPostedSpecLines(posted, frozen);
  const got = Object.fromEntries(r.matches.map((m) => [m.frozen.quoteLeafId, m.posted.lineUniqueKey]));
  assert.deepEqual(got, { "A-bottle": "22", "A-pump": "23", "B-bottle": "26", "B-pump": "27" });
  assert.ok(r.matches.every((m) => m.method === "by_order"));
});

test("the same SKU in two DIFFERENT groups is matched by group, uniquely", () => {
  const posted = [
    P(1, "1", "GA", "Group"),
    P(2, "2", "76155", "InvtPart"),
    P(3, "3", "76156", "InvtPart"),
    P(4, "4", "0", "EndGroup"),
    P(5, "5", "GB", "Group"),
    P(6, "6", "76155", "InvtPart"),
    P(7, "7", "76157", "InvtPart"),
    P(8, "8", "0", "EndGroup"),
  ];
  const frozen = [
    F(0, "item_group_member", "76155", "B-bottle", "B"),
    F(1, "item_group_member", "76157", "B-label", "B"),
    F(2, "item_group_member", "76155", "A-bottle", "A"),
    F(3, "item_group_member", "76156", "A-pump", "A"),
  ];
  const r = matchPostedSpecLines(posted, frozen);
  const got = Object.fromEntries(r.matches.map((m) => [m.frozen.quoteLeafId, m.posted.lineUniqueKey]));
  assert.deepEqual(got, { "A-bottle": "2", "A-pump": "3", "B-bottle": "6", "B-label": "7" });
  assert.ok(r.matches.every((m) => m.method === "unique"));
});

test("an assembly POSTED FLAT (no Item Group) matches among ungrouped lines — SO2738 shape", () => {
  const posted = [P(1, "1799611", "76155", "InvtPart"), P(2, "1799612", "76156", "InvtPart")];
  const frozen = [
    F(0, "item_group_member", "76155", "bottle", "A"),
    F(1, "item_group_member", "76156", "pump", "A"),
  ];
  const r = matchPostedSpecLines(posted, frozen);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    Object.fromEntries(r.matches.map((m) => [m.frozen.quoteLeafId, m.posted.lineUniqueKey])),
    { bottle: "1799611", pump: "1799612" },
  );
});

test("a group posted with the WRONG members is not rescued by the flat fallback", () => {
  const posted = [
    P(1, "1", "G", "Group"),
    P(2, "2", "76155", "InvtPart"),
    P(3, "3", "99999", "InvtPart"),
    P(4, "4", "0", "EndGroup"),
  ];
  const frozen = [
    F(0, "item_group_member", "76155", "bottle", "A"),
    F(1, "item_group_member", "76156", "pump", "A"),
  ];
  const r = matchPostedSpecLines(posted, frozen);
  assert.equal(r.matches.length, 0);
  assert.equal(r.unmatched.length, 2);
  assert.match(r.problems.join(), /matches no frozen assembly/);
});

test("a duplicate item inside one group occurrence is refused, not guessed", () => {
  const posted = [
    P(1, "1", "G", "Group"),
    P(2, "2", "76155", "InvtPart"),
    P(3, "3", "76155", "InvtPart"),
    P(4, "4", "0", "EndGroup"),
  ];
  const frozen = [
    F(0, "item_group_member", "76155", "x", "A"),
    F(1, "item_group_member", "76155", "y", "A"),
  ];
  const r = matchPostedSpecLines(posted, frozen);
  assert.equal(r.matches.length, 0);
  assert.equal(r.unmatched.length, 2);
});

test("a frozen line with no recorded NetSuite item cannot be matched", () => {
  const r = matchPostedSpecLines([P(1, "1", "76155", "InvtPart")], [F(0, "direct_product", null, "x")]);
  assert.equal(r.matches.length, 0);
  assert.match(r.unmatched[0].reason, /no recorded NetSuite item/);
});

test("a posted group nobody ordered is a named problem", () => {
  const r = matchPostedSpecLines(
    [P(1, "1", "G", "Group"), P(2, "2", "9", "InvtPart"), P(3, "3", "0", "EndGroup")],
    [],
  );
  assert.match(r.problems.join(), /matches no frozen assembly/);
});

test("a direct product sharing an item id with a charge is matched by order and labelled", () => {
  const posted = [P(1, "1", "500", "InvtPart"), P(2, "2", "500", "InvtPart")];
  const frozen = [F(0, "direct_product", "500", "prod"), F(1, "otc", "500", "prod")];
  const r = matchPostedSpecLines(posted, frozen);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].posted.lineUniqueKey, "1");
  assert.equal(r.matches[0].method, "by_order");
});

test("posted/frozen count mismatch for an item refuses that item", () => {
  const r = matchPostedSpecLines([P(1, "1", "500", "InvtPart")], [
    F(0, "direct_product", "500", "a"),
    F(1, "direct_product", "500", "b"),
  ]);
  assert.equal(r.matches.length, 0);
  assert.equal(r.unmatched.length, 2);
});

// ═══════════════════════════════════════════════════════════════════════
// RECONCILIATION — fake NetSuite
// ═══════════════════════════════════════════════════════════════════════

const SECRET = "Zinc 12% ref F-0042";
const SO = "900";

function spec(leaf: string, values: Record<string, unknown>, schema = "formulated", disposition: FrozenSpecRow["disposition"] = "specified"): FrozenSpecRow {
  const productTypeId = schema === "formulated" ? "leaf_formulated" : "leaf_x";
  return {
    quoteLeafId: leaf,
    disposition,
    specValues: values,
    productTypeId,
    specSchema: schema,
    contentHash: orderedSpecContentHash({ specValues: values, productTypeId, specSchema: schema }),
  };
}

class FakeNetSuite {
  records = new Map<string, Record<string, unknown>>();
  nextId = 100;
  lines: PostedSoLine[];
  total = 1000;
  creates = 0;
  patches = 0;
  sent: string[] = [];
  /** Test switches */
  dropLinks = false;
  driftOnPatch = false;
  raceOnCreate = false;

  constructor(lines: PostedSoLine[]) {
    this.lines = lines;
  }

  deps(frozen: { lines: FrozenLine[]; specs: FrozenSpecRow[] }): SpecTransferDeps {
    return {
      loadFrozen: async () => ({
        ...frozen,
        fieldsBySchema: {
          formulated: [
            { key: "fm_form", label: "Form" },
            { key: "fm_actives", label: "Actives / reference formula" },
          ],
          primary: [{ key: "pp_size", label: "Size" }],
        },
      }),
      readSalesOrder: async () => ({ lines: this.lines.map((l) => ({ ...l })), total: this.total }),
      findRecordIdByExternalId: async (eid) => {
        for (const [id, r] of this.records) if (r.externalId === eid) return id;
        return null;
      },
      createRecord: async (body) => {
        this.sent.push(JSON.stringify(body));
        this.creates++;
        const id = String(this.nextId++);
        this.records.set(id, { ...body });
        if (this.raceOnCreate) {
          this.raceOnCreate = false;
          throw new Error("There is already a Custom Record Entry with that name.");
        }
        return id;
      },
      readRecord: async (id): Promise<ObservedSpecRecord> => {
        const r = this.records.get(id)!;
        return {
          id,
          externalId: String(r.externalId),
          transactionId: String((r.custrecord_nxos_transaction as { id: string }).id),
          lineKey: String(r.custrecord_nxos_line_key),
          itemId: String((r.custrecord_nxos_item as { id: string }).id),
          quoteLeafId: String(r.custrecord_nxos_quote_leaf),
          snapshotId: String(r.custrecord_nxos_snapshot),
          specSchema: r.custrecord_nxos_schema == null ? null : String(r.custrecord_nxos_schema),
          disposition: String(r.custrecord_nxos_disposition),
          projectionVersion: String(r.custrecord_nxos_projection_version),
          sourceHash: String(r.custrecord_nxos_source_hash),
          exportHash: String(r.custrecord_nxos_export_hash),
          redactedKeys: JSON.parse(String(r.custrecord_nxos_redacted_keys)),
          valuesJson: String(r.custrecord_nxos_values),
          readable: r.custrecord_nxos_readable == null ? "" : String(r.custrecord_nxos_readable),
        };
      },
      patchLineLink: async (_so, line, recordId) => {
        this.patches++;
        const l = this.lines.find((x) => x.line === line)!;
        if (!this.dropLinks) l.specLinkId = recordId;
        if (this.driftOnPatch) l.rate = (l.rate ?? 0) + 1;
      },
    };
  }
}

const L = (line: number, key: string, itemId: string, itemType = "InvtPart"): PostedSoLine => ({
  line,
  lineUniqueKey: key,
  itemId,
  itemType,
  quantity: 10,
  rate: 1,
  amount: 10,
  specLinkId: null,
});

function scenario() {
  const ns = new FakeNetSuite([
    L(1, "11", "G", "Group"),
    L(2, "12", "76155"),
    L(3, "13", "0", "EndGroup"),
    L(4, "14", "76158"),
    L(5, "15", "59157", "NonInvtPart"),
  ]);
  const frozen = {
    lines: [
      F(0, "item_group_member", "76155", "L-serum", "A"),
      F(1, "direct_product", "76158", "L-box"),
      F(2, "direct_service", "59157", "L-svc"),
    ],
    specs: [
      spec("L-serum", { fm_form: "Serum", fm_actives: SECRET }),
      spec("L-box", { pp_size: "60x60" }, "primary"),
      spec("L-svc", {}, "no_type", "no_type"),
    ],
  };
  return { ns, frozen };
}
const ARGS = { soId: SO, soLabel: "SO9", snapshotId: "snap-1" };

test("fresh order: one record per product line, linked, read back, fm_actives never sent", async () => {
  const { ns, frozen } = scenario();
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "succeeded");
  assert.equal(r.productLineCount, 2);
  assert.equal(r.verifiedCount, 2);
  assert.equal(ns.creates, 2);
  assert.equal(ns.patches, 2);
  assert.equal(ns.sent.join("").includes(SECRET), false, "withheld value reached NetSuite");
  assert.equal(JSON.stringify(r).includes(SECRET), false, "withheld value reached the status row");
  const serum = r.lines.find((l) => l.quoteLeafId === "L-serum")!;
  assert.deepEqual(serum.redactedKeys, ["fm_actives"]);
  assert.notEqual(serum.sourceHash, serum.exportHash);
  assert.ok([...ns.records.values()].some((rec) => rec.externalId === orderedSpecExternalId(SO, "12")));
});

test("retry of an existing order is idempotent: no new record, no new PATCH", async () => {
  const { ns, frozen } = scenario();
  await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  const creates = ns.creates;
  const patches = ns.patches;
  const r2 = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r2.status, "succeeded");
  assert.equal(ns.creates, creates);
  assert.equal(ns.patches, patches);
});

test("a record that disagrees is a CONFLICT and is never overwritten", async () => {
  const { ns, frozen } = scenario();
  await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  const [id, rec] = [...ns.records.entries()].find(([, r]) => r.externalId === orderedSpecExternalId(SO, "14"))!;
  rec.custrecord_nxos_values = JSON.stringify({ pp_size: "99x99" });
  const before = JSON.stringify(rec);
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "conflict");
  assert.equal(JSON.stringify(ns.records.get(id)), before);
  assert.match(r.lines.find((l) => l.quoteLeafId === "L-box")!.reason!, /^record_disagrees:/);
});

test("a record with wrong provenance or readable text is a conflict, even when its hashes agree", async () => {
  const corruptions: Array<[string, unknown, string]> = [
    ["externalId", "nxos:other:14", "external_id"],
    ["custrecord_nxos_quote_leaf", "L-other", "quote_leaf"],
    ["custrecord_nxos_snapshot", "snap-other", "snapshot"],
    ["custrecord_nxos_schema", "secondary", "schema"],
    ["custrecord_nxos_readable", "Size: wrong", "readable"],
  ];
  for (const [field, value, reason] of corruptions) {
    const { ns, frozen } = scenario();
    await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
    const rec = [...ns.records.values()].find((r) => r.custrecord_nxos_quote_leaf === "L-box")!;
    rec[field] = value;
    const before = JSON.stringify(rec);
    const result = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
    assert.equal(result.status, "conflict", field);
    assert.match(result.lines.find((l) => l.quoteLeafId === "L-box")!.reason!, new RegExp(reason), field);
    assert.equal(JSON.stringify(rec), before, `${field} was overwritten`);
  }
});

test("a changed frozen hash for the same line key is refused, not a second record", async () => {
  const { ns, frozen } = scenario();
  await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  const changed = { ...frozen, specs: [spec("L-serum", { fm_form: "Cream" }), frozen.specs[1], frozen.specs[2]] };
  const creates = ns.creates;
  const r = await reconcileOrderedSpecs(ns.deps(changed), ARGS);
  assert.equal(r.status, "conflict");
  assert.equal(ns.creates, creates);
});

test("a line already linked to a different record is a conflict", async () => {
  const { ns, frozen } = scenario();
  ns.lines[1].specLinkId = "777";
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "conflict");
  assert.match(r.lines.find((l) => l.quoteLeafId === "L-serum")!.reason!, /line_linked_to_other_record:777/);
});

test("a link that does not persist fails the line", async () => {
  const { ns, frozen } = scenario();
  ns.dropLinks = true;
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "failed");
  assert.ok(r.lines.every((l) => l.reason === "line_link_not_persisted"));
});

test("ANY commercial field moving during transfer fails it loudly", async () => {
  const { ns, frozen } = scenario();
  ns.driftOnPatch = true;
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "failed");
  assert.match(r.problems.join(), /commercial fields changed/);
});

test("a create that loses a race re-finds the record instead of failing", async () => {
  const { ns, frozen } = scenario();
  ns.raceOnCreate = true;
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "succeeded");
});

test("an unresolved disposition is transferred as an exception status", async () => {
  const { ns, frozen } = scenario();
  frozen.specs[1] = spec("L-box", {}, "no_type", "no_type");
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "succeeded_with_exceptions");
  assert.equal(r.exceptionCount, 1);
});

test("a product line with no frozen spec row fails rather than being skipped", async () => {
  const { ns, frozen } = scenario();
  frozen.specs = frozen.specs.filter((s) => s.quoteLeafId !== "L-box");
  const r = await reconcileOrderedSpecs(ns.deps(frozen), ARGS);
  assert.equal(r.status, "failed");
  assert.equal(r.lines.find((l) => l.quoteLeafId === "L-box")!.reason, "no_frozen_spec_row");
});

// ═══════════════════════════════════════════════════════════════════════
// SWITCH
// ═══════════════════════════════════════════════════════════════════════

test("the export defaults ON only for sandbox; production must be enabled explicitly", () => {
  assert.equal(isOrderedSpecExportEnabled("sandbox", undefined), true);
  assert.equal(isOrderedSpecExportEnabled("production", undefined), false);
  assert.equal(isOrderedSpecExportEnabled("production", "enabled"), true);
  assert.equal(isOrderedSpecExportEnabled("sandbox", "disabled"), false);
  assert.equal(isOrderedSpecExportEnabled("production", "yes"), false);
});
