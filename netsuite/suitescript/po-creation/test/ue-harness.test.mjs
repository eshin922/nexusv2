// Local harness for dps_new_po_creation_ue.js — fake N/query, N/record, N/runtime.
// Run: node --test netsuite/suitescript/po-creation/test/ue-harness.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../dps_new_po_creation_ue.js", import.meta.url)), "utf8");

function world() {
  let nextId = 900000, nextKey = 5000000;
  const txns = new Map(); // id -> {type, body, lines}
  // spec id -> the SO line it was written for (SO 100) + its readable text
  const specs = new Map([
    [11, { transaction: 100, lineKey: 1, text: "Fill size: 30 ml\nFinish: Matte" }],
    [12, { transaction: 100, lineKey: 2, text: "Fill size: 50 ml\nFinish: Gloss" }],
    [13, { transaction: 100, lineKey: 3, text: "Formula: Greens\nFormula reference withheld — held in Nexus" }],
  ]);
  const logs = [];
  const allLines = () => [...txns.entries()].flatMap(([id, t]) => t.lines.map((l) => ({ ...l, transaction: id })));

  function mkRecord(type, id) {
    const src = id ? txns.get(Number(id)) : { type, body: {}, lines: [] };
    const body = { ...src.body };
    const lines = src.lines.map((l) => ({ ...l }));
    let cur = null;
    return {
      type, id: id ? Number(id) : null,
      getValue: (f) => (typeof f === "string" ? body[f] : body[f.fieldId]) ?? "",
      setValue: (f, v) => { if (typeof f === "string") body[f] = v; else body[f.fieldId] = f.value; },
      getLineCount: () => lines.length,
      getSublistValue: ({ fieldId, line }) => lines[line]?.[fieldId] ?? "",
      setSublistValue: ({ fieldId, line, value }) => { lines[line][fieldId] = value; },
      findSublistLineWithValue: ({ fieldId, value }) => lines.findIndex((l) => Number(l[fieldId]) === Number(value)),
      selectNewLine: () => { cur = {}; },
      setCurrentSublistValue: ({ fieldId, value }) => { cur[fieldId] = value; },
      commitLine: () => { lines.push(cur); cur = null; },
      removeLine: ({ line }) => lines.splice(line, 1),
      save() {
        const rid = this.id ?? nextId++;
        for (const l of lines) if (!l.lineuniquekey) l.lineuniquekey = nextKey++;
        txns.set(rid, { type, body, lines });
        this.id = rid;
        return rid;
      },
      _lines: lines, _body: body,
    };
  }

  const record = {
    Type: { PURCHASE_ORDER: "purchaseorder", SALES_ORDER: "salesorder", WORK_ORDER: "workorder" },
    create: ({ type }) => mkRecord(type, null),
    load: ({ type, id }) => {
      if (type === "customrecord_nx_ordered_spec") {
        if (!specs.has(Number(id))) throw new Error("RCRD_DSNT_EXIST");
        const s = specs.get(Number(id));
        return { getValue: (f) => ({ custrecord_nxos_readable: s.text, custrecord_nxos_transaction: s.transaction, custrecord_nxos_line_key: s.lineKey })[f] ?? "" };
      }
      return mkRecord(type, id);
    },
    delete: ({ id }) => txns.delete(Number(id)),
  };

  const res = (rows) => ({ asMappedResults: () => rows });
  const query = {
    runSuiteQL(sql) {
      const s = sql.replace(/\s+/g, " ");
      let m;
      if ((m = s.match(/FROM transactionLine WHERE uniqueKey IN \(([^)]*)\)/i))) {
        const keys = m[1].split(",").map(Number);
        return res(allLines().filter((l) => keys.includes(Number(l.lineuniquekey)))
          .map((l) => ({ unique_key: l.lineuniquekey, transaction: l.transaction, order_line_key: l.custcol_dps_order_line_key || null })));
      }
      if ((m = s.match(/WHERE transaction = (\d+) AND custcol_dps_order_line_key IN \(([^)]*)\)/i))) {
        const tx = Number(m[1]); const keys = m[2].split(",").map(Number);
        return res(allLines().filter((l) => l.transaction === tx && keys.includes(Number(l.custcol_dps_order_line_key)))
          .map((l) => ({ sales_order_line_key: l.custcol_dps_order_line_key, po_line_key: l.lineuniquekey })));
      }
      return res([]); // header message + afterSubmit queries are not exercised here
    },
  };
  const runtime = { getCurrentScript: () => ({ getParameter: () => "custbody_size, custbody_color" }) };

  globalThis.log = { audit: (t, d) => logs.push([t, d]), error: (t, d) => logs.push(["ERROR " + t, d]), debug: () => {} };
  let mod;
  globalThis.define = (deps, factory) => { mod = factory(query, record, runtime); };
  new Function(SRC)();
  return { mod, txns, record, logs, put: (id, t) => txns.set(id, t) };
}

const SO = 100;
const soLine = (k, item, qty, vendor, spec, extra = {}) => ({
  lineuniquekey: k, item, quantity: qty, custcol_dps_unit_cost: 2, custcol_dps_po_vendor: vendor,
  description: `${item} variant ${spec ?? "none"}`, custcol_nx_ordered_spec: spec ?? "", ...extra,
});

function runBefore(w, soBody, lines) {
  w.put(SO, { type: "salesorder", body: soBody, lines });
  const rec = w.record.load({ type: "salesorder", id: SO });
  w.mod.beforeSubmit({ type: "edit", newRecord: rec });
  return rec;
}

test("pure: invalidLinks keeps only reciprocal links", () => {
  const { mod } = world();
  const so = [
    { line: 0, uniqueKey: 1, linkedOrder: 7, orderLineKey: 70 }, // ok
    { line: 1, uniqueKey: 2, linkedOrder: 7, orderLineKey: 70 }, // saved copy of line 0
    { line: 2, uniqueKey: "", linkedOrder: 7, orderLineKey: 70 }, // unsaved copy
    { line: 3, uniqueKey: 4, linkedOrder: 7, orderLineKey: 99 }, // PO line gone
    { line: 4, uniqueKey: 5, linkedOrder: 8, orderLineKey: 71 }, // PO line on another PO
    { line: 5, uniqueKey: 6, linkedOrder: "", orderLineKey: "" }, // unlinked
  ];
  const po = [{ uniqueKey: 70, transaction: 7, orderLineKey: "1" }, { uniqueKey: 71, transaction: 7, orderLineKey: 5 }];
  assert.deepEqual(mod._test.invalidLinks(so, po).map((x) => [x.line, x.reason]), [
    [1, "po_line_points_elsewhere"], [2, "new_or_copied_line"], [3, "po_line_not_found"], [4, "po_line_on_other_order"],
  ]);
});

test("pure: manualPairs never pairs by item/qty; unkeyed lines stay unpaired", () => {
  const { mod } = world();
  const so = [{ line: 0, uniqueKey: 1, orderLineKey: "" }, { line: 1, uniqueKey: 2, orderLineKey: 80 }, { line: 2, uniqueKey: 3, orderLineKey: "" }];
  const po = [
    { index: 0, uniqueKey: 80, orderLineKey: "", linkedOrder: "" }, // named by SO line key 2
    { index: 1, uniqueKey: 81, orderLineKey: 1, linkedOrder: "" },  // names SO key 1
    { index: 2, uniqueKey: 82, orderLineKey: "", linkedOrder: "" }, // no key → never guessed
    { index: 3, uniqueKey: 83, orderLineKey: 1, linkedOrder: 555 }, // linked to another SO → ignored
  ];
  assert.deepEqual(mod._test.manualPairs(so, po, SO).map((p) => [p.soLine, p.poIndex]), [[0, 1], [1, 0]]);
});

test("create: repeated SKU with different specs, split by vendor, each PO line gets its own spec", () => {
  const w = world();
  const rec = runBefore(w, { custbody_dps_create_pos: true, job: 42, shipdate: "2026-11-01", custbody_size: "L" }, [
    soLine(1, 76155, 1000, 183039, 11),
    soLine(2, 76155, 1000, 183039, 12), // same SKU + qty, different spec
    soLine(3, 76156, 500, 230615, 13),
    soLine(4, 76157, 10, 230615, null), // no spec
  ]);
  const pos = [...w.txns.entries()].filter(([, t]) => t.type === "purchaseorder");
  assert.equal(pos.length, 2, "one PO per vendor");
  const byVendor = Object.fromEntries(pos.map(([id, t]) => [t.body.entity, { id, ...t }]));
  const a = byVendor[183039], b = byVendor[230615];
  assert.equal(a.body.customform, 218);
  assert.equal(a.body.custbody_size, "L");
  assert.deepEqual(a.lines.map((l) => [l.custcol_dps_order_line_key, l.custcol_nx_ordered_spec, l.custcol_nx_spec_text]), [
    [1, 11, "Fill size: 30 ml\nFinish: Matte"], [2, 12, "Fill size: 50 ml\nFinish: Gloss"],
  ]);
  assert.deepEqual(b.lines.map((l) => [l.custcol_dps_order_line_key, l.custcol_nx_ordered_spec ?? "", l.custcol_nx_spec_text ?? ""]), [
    [3, 13, "Formula: Greens\nFormula reference withheld — held in Nexus"], [4, "", ""],
  ]);
  const so = rec._lines;
  assert.equal(so[0].custcol_dps_linked_order, a.id);
  assert.equal(so[0].custcol_dps_order_line_key, a.lines[0].lineuniquekey);
  assert.equal(so[1].custcol_dps_order_line_key, a.lines[1].lineuniquekey);
  assert.equal(so[2].custcol_dps_linked_order, b.id);
  assert.equal(so[3].custcol_dps_order_line_key, b.lines[1].lineuniquekey);
  assert.equal(rec._body.custbody_dps_create_pos, false);
});

test("copied SO line loses the PO link, then gets its own PO line on the next Create", () => {
  const w = world();
  w.put(7, { type: "purchaseorder", body: { entity: 183039 }, lines: [
    { lineuniquekey: 70, item: 76155, quantity: 1000, custcol_dps_linked_order: SO, custcol_dps_order_line_key: 1, custcol_nx_ordered_spec: 11 },
  ] });
  const rec = runBefore(w, { custbody_dps_create_pos: true }, [
    soLine(1, 76155, 1000, 183039, 11, { custcol_dps_linked_order: 7, custcol_dps_order_line_key: 70 }),
    soLine(2, 76155, 1000, 183039, 12, { custcol_dps_linked_order: 7, custcol_dps_order_line_key: 70 }), // copy
  ]);
  assert.ok(w.logs.some(([t, d]) => t === "clearNonReciprocalLink" && d.line === 1 && d.reason === "po_line_points_elsewhere"));
  const po = w.txns.get(7);
  assert.equal(po.lines.length, 2, "copy appended to the vendor's existing PO");
  assert.equal(po.lines[0].custcol_dps_order_line_key, 1, "original PO line untouched");
  assert.equal(po.lines[1].custcol_dps_order_line_key, 2);
  assert.equal(po.lines[1].custcol_nx_ordered_spec, 12, "copy carries its own spec");
  assert.equal(rec._lines[0].custcol_dps_order_line_key, 70);
  assert.equal(rec._lines[1].custcol_dps_order_line_key, po.lines[1].lineuniquekey);
});

test("manual link: pairs by keys, leaves an unkeyed repeated SKU unlinked, copies spec", () => {
  const w = world();
  w.put(8, { type: "purchaseorder", body: { entity: 183039 }, lines: [
    { lineuniquekey: 80, item: 76155, quantity: 1000, custcol_dps_order_line_key: 2 },
    { lineuniquekey: 81, item: 76155, quantity: 1000 }, // same SKU + qty, no key
  ] });
  const rec = runBefore(w, { custbody_ali_manual_linked_po: 8 }, [
    soLine(1, 76155, 1000, "", 11),
    soLine(2, 76155, 1000, "", 12),
  ]);
  const po = w.txns.get(8);
  assert.equal(rec._lines[1].custcol_dps_linked_order, 8);
  assert.equal(rec._lines[1].custcol_dps_order_line_key, 80);
  assert.equal(po.lines[0].custcol_dps_linked_order, SO);
  assert.equal(po.lines[0].custcol_nx_ordered_spec, 12);
  assert.equal(po.lines[0].custcol_nx_spec_text, "Fill size: 50 ml\nFinish: Gloss");
  assert.equal(rec._lines[0].custcol_dps_linked_order ?? "", "", "SO line 1 not guessed onto PO line 81");
  assert.equal(po.lines[1].custcol_dps_linked_order ?? "", "");
  assert.equal(rec._body.custbody_ali_manual_linked_po, "");
});

test("unreadable spec record never blocks PO creation and is not carried", () => {
  const w = world();
  runBefore(w, { custbody_dps_create_pos: true }, [soLine(1, 76155, 5, 183039, 999)]);
  const po = [...w.txns.values()].find((t) => t.type === "purchaseorder");
  assert.equal(po.lines.length, 1);
  assert.equal(po.lines[0].custcol_nx_ordered_spec ?? "", "");
  assert.equal(po.lines[0].custcol_nx_spec_text ?? "", "");
  assert.ok(w.logs.some(([t]) => t === "ERROR specFor.unreadable"));
});

test("a copied line's inherited spec link is not carried to its PO line", () => {
  const w = world();
  // line 2 is a copy of line 1: NetSuite copied custcol_nx_ordered_spec = 11,
  // but record 11 was written for SO line 1.
  runBefore(w, { custbody_dps_create_pos: true }, [
    soLine(1, 76155, 1000, 183039, 11),
    soLine(2, 76155, 1000, 183039, 11),
  ]);
  const po = [...w.txns.values()].find((t) => t.type === "purchaseorder");
  assert.deepEqual(po.lines.map((l) => [l.custcol_dps_order_line_key, l.custcol_nx_ordered_spec ?? "", l.custcol_nx_spec_text ?? ""]), [
    [1, 11, "Fill size: 30 ml\nFinish: Matte"], [2, "", ""],
  ]);
  assert.ok(w.logs.some(([t, d]) => t === "specFor.notThisLine" && d.soLineKey === 2));
});
