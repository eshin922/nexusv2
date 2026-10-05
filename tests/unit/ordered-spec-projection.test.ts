import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FROZEN_SPEC_DISPOSITIONS,
  frozenSpecDispositionOf,
} from "../../src/lib/ordered-spec-disposition.ts";
import { orderedSpecContentHash } from "../../src/lib/ordered-spec-hash.ts";
import {
  ORDERED_SPEC_PROJECTION_VERSION,
  WITHHELD_NOTICE,
  WITHHELD_SPEC_KEYS,
  compareReadBack,
  projectOrderedSpecForExport,
  redactWithheldSpecValues,
  type OrderedSpecProjectionInput,
} from "../../src/lib/ordered-spec-projection.ts";
import { packetDispositionOf } from "../../src/lib/order-packet/disposition.ts";

// ═══════════════════════════════════════════════════════════════════════
// FROZEN DISPOSITION — DEFECT-2026-09-15
// ═══════════════════════════════════════════════════════════════════════

test("schema_pending freezes as schema_pending, never as specified", () => {
  assert.equal(frozenSpecDispositionOf("schema_pending", "leaf_raw"), "schema_pending");
});

test("every governed schema id freezes as specified", () => {
  for (const id of ["primary", "secondary", "tertiary", "formulated"]) {
    assert.equal(frozenSpecDispositionOf(id, "pt"), "specified", id);
  }
});

test("the remaining pins keep their own disposition", () => {
  assert.equal(frozenSpecDispositionOf("no_schema", "pt"), "no_schema");
  assert.equal(frozenSpecDispositionOf("unmapped", "pt"), "unmapped");
  assert.equal(frozenSpecDispositionOf("no_type", null), "no_type");
  assert.equal(frozenSpecDispositionOf(null, "pt"), "unmapped");
  assert.equal(frozenSpecDispositionOf(null, null), "no_type");
});

test("an unknown pin THROWS rather than freezing as specified", () => {
  assert.throws(() => frozenSpecDispositionOf("not_a_pin", "pt"), /unknown pinned spec schema/);
});

test("the database CHECK permits exactly the classifier's dispositions", async () => {
  const sql = await readFile(
    new URL("../../drizzle/0143_frozen_spec_schema_pending.sql", import.meta.url),
    "utf8",
  );
  const m = /qsls_disposition_known[\s\S]*?IN \(([^)]*)\)/.exec(sql);
  assert.ok(m, "migration 0143 must restate the CHECK");
  const allowed = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual([...allowed].sort(), [...FROZEN_SPEC_DISPOSITIONS].sort());
});

test("the packet never reports an unresolved state as a governed 'no spec'", () => {
  assert.equal(packetDispositionOf("specified"), "specified");
  assert.equal(packetDispositionOf("no_schema"), "governed_no_spec");
  for (const d of ["schema_pending", "unmapped", "no_type"] as const) {
    assert.equal(packetDispositionOf(d), "not_governed", d);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// REDACTED PROJECTION — fm_actives stays in Nexus
// ═══════════════════════════════════════════════════════════════════════

const SECRET = "Niacinamide 4% / ref formula F-7781";

const FORMULATED_FIELDS = [
  { key: "fm_description", label: "Description" },
  { key: "fm_form", label: "Form" },
  { key: "fm_net_content", label: "Net content / fill" },
  { key: "fm_actives", label: "Actives / reference formula" },
  { key: "fm_additional_details", label: "Additional details" },
  { key: "fm_factory_1", label: "Factory 1" },
  { key: "fm_factory_2", label: "Factory 2" },
  { key: "fm_packout_details", label: "Packout details" },
];

function frozen(values: Record<string, unknown>, over: Partial<OrderedSpecProjectionInput> = {}): OrderedSpecProjectionInput {
  const productTypeId = over.productTypeId ?? "leaf_formulated";
  const specSchema = over.specSchema ?? "formulated";
  return {
    disposition: "specified",
    specValues: values,
    productTypeId,
    specSchema,
    contentHash: orderedSpecContentHash({ specValues: values, productTypeId, specSchema }),
    fields: FORMULATED_FIELDS,
    ...over,
  };
}

test("the withheld list is exactly fm_actives", () => {
  assert.deepEqual([...WITHHELD_SPEC_KEYS], ["fm_actives"]);
});

test("a populated fm_actives is removed from EVERY part of the export", () => {
  const r = projectOrderedSpecForExport(
    frozen({ fm_form: "Serum", fm_net_content: "30 ml", fm_actives: SECRET }),
  );
  assert.ok(r.ok);
  const p = r.projection;
  assert.equal("fm_actives" in p.values, false);
  assert.deepEqual(p.redactedKeys, ["fm_actives"]);
  assert.match(p.readable, new RegExp(WITHHELD_NOTICE));
  assert.equal(
    JSON.stringify(r).includes(SECRET),
    false,
    "the withheld value must not appear anywhere in the projection",
  );
  assert.equal(JSON.stringify(r).includes("Niacinamide"), false);
});

test("source hash identifies the full frozen row; export hash covers only what was sent", () => {
  const values = { fm_form: "Serum", fm_actives: SECRET };
  const input = frozen(values);
  const r = projectOrderedSpecForExport(input);
  assert.ok(r.ok);
  assert.equal(r.projection.sourceHash, input.contentHash);
  assert.notEqual(r.projection.exportHash, r.projection.sourceHash);
  assert.equal(
    r.projection.exportHash,
    orderedSpecContentHash({ specValues: { fm_form: "Serum" }, productTypeId: "leaf_formulated", specSchema: "formulated" }),
  );
  assert.equal(r.projection.projectionVersion, ORDERED_SPEC_PROJECTION_VERSION);
});

test("with nothing withheld, export hash equals source hash", () => {
  const r = projectOrderedSpecForExport(
    frozen({ pp_size: "30 ml" }, {
      productTypeId: "leaf_primary_packaging",
      specSchema: "primary",
      fields: [{ key: "pp_size", label: "Size" }],
    }),
  );
  assert.ok(r.ok);
  assert.equal(r.projection.exportHash, r.projection.sourceHash);
  assert.deepEqual(r.projection.redactedKeys, []);
  assert.equal(r.projection.readable, "Size: 30 ml");
});

test("an EMPTY fm_actives is not reported as a redaction", () => {
  for (const empty of ["", "   ", null]) {
    const r = projectOrderedSpecForExport(frozen({ fm_form: "Gummy", fm_actives: empty }));
    assert.ok(r.ok);
    assert.deepEqual(r.projection.redactedKeys, [], `value ${JSON.stringify(empty)}`);
    assert.equal("fm_actives" in r.projection.values, false);
    assert.doesNotMatch(r.projection.readable, new RegExp(WITHHELD_NOTICE));
  }
});

test("a source hash that does not reproduce is refused", () => {
  const input = frozen({ fm_form: "Serum" });
  const r = projectOrderedSpecForExport({ ...input, contentHash: "0".repeat(64) });
  assert.deepEqual(r, { ok: false, refusal: { reason: "source_hash_mismatch" } });
});

test("a key outside the pinned schema is refused BY NAME, never silently dropped", () => {
  const r = projectOrderedSpecForExport(frozen({ fm_form: "Serum", legacy_note: "keep me" }));
  assert.deepEqual(r, { ok: false, refusal: { reason: "keys_outside_schema", keys: ["legacy_note"] } });
  assert.equal(JSON.stringify(r).includes("keep me"), false, "refusals name keys, not values");
});

test("a refusal never carries the withheld value", () => {
  const r = projectOrderedSpecForExport(frozen({ fm_actives: SECRET, stray: "x" }));
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(r).includes(SECRET), false);
});

test("a specified row with no schema fields is refused", () => {
  const r = projectOrderedSpecForExport(frozen({ fm_form: "Serum" }, { fields: null }));
  assert.deepEqual(r, { ok: false, refusal: { reason: "schema_fields_missing" } });
});

test("no_schema exports an explicit empty status, not an exception", () => {
  const values = {};
  const r = projectOrderedSpecForExport({
    disposition: "no_schema",
    specValues: values,
    productTypeId: "leaf_service",
    specSchema: "no_schema",
    contentHash: orderedSpecContentHash({ specValues: values, productTypeId: "leaf_service", specSchema: "no_schema" }),
    fields: null,
  });
  assert.ok(r.ok);
  assert.deepEqual(r.projection.values, {});
  assert.equal(r.projection.exception, false);
});

test("unresolved dispositions export NO values and are flagged as exceptions", () => {
  for (const disposition of ["schema_pending", "unmapped", "no_type"] as const) {
    const values = { raw_note: "authored anyway", fm_actives: SECRET };
    const r = projectOrderedSpecForExport({
      disposition,
      specValues: values,
      productTypeId: "leaf_raw",
      specSchema: disposition === "no_type" ? "no_type" : disposition,
      contentHash: orderedSpecContentHash({
        specValues: values,
        productTypeId: "leaf_raw",
        specSchema: disposition === "no_type" ? "no_type" : disposition,
      }),
      fields: null,
    });
    assert.ok(r.ok, disposition);
    assert.deepEqual(r.projection.values, {});
    assert.equal(r.projection.exception, true);
    assert.deepEqual(r.projection.unexportedKeys, ["fm_actives", "raw_note"]);
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  }
});

test("redaction is the same rule the Order Packet uses", () => {
  const r = redactWithheldSpecValues({ fm_form: "Serum", fm_actives: SECRET });
  assert.deepEqual(r, { values: { fm_form: "Serum" }, redactedKeys: ["fm_actives"] });
});

// ═══════════════════════════════════════════════════════════════════════
// READ-BACK
// ═══════════════════════════════════════════════════════════════════════

function expected() {
  const r = projectOrderedSpecForExport(frozen({ fm_form: "Serum", fm_actives: SECRET }));
  assert.ok(r.ok);
  return { ...r.projection, lineKey: "1799824", itemId: "76155" };
}

function observedFrom(p: ReturnType<typeof expected>) {
  return {
    lineKey: p.lineKey,
    itemId: p.itemId,
    disposition: p.disposition,
    projectionVersion: p.projectionVersion,
    sourceHash: p.sourceHash,
    exportHash: p.exportHash,
    redactedKeys: p.redactedKeys,
    valuesJson: JSON.stringify(p.values),
  };
}

test("an exact read-back matches", () => {
  const p = expected();
  assert.deepEqual(compareReadBack(p, observedFrom(p)), { matches: true });
});

test("altered values with a copied hash are caught by RECOMPUTING the hash", () => {
  const p = expected();
  const obs = { ...observedFrom(p), valuesJson: JSON.stringify({ fm_form: "Cream" }) };
  const r = compareReadBack(p, obs);
  assert.equal(r.matches, false);
  assert.ok(!r.matches && r.mismatched.includes("export_hash_recomputed"));
});

test("a withheld key appearing in NetSuite is a named failure", () => {
  const p = expected();
  const obs = { ...observedFrom(p), valuesJson: JSON.stringify({ fm_form: "Serum", fm_actives: "x" }) };
  const r = compareReadBack(p, obs);
  assert.ok(!r.matches && r.mismatched.includes("values_contain_withheld_key"));
});

test("a different line key or item is a mismatch", () => {
  const p = expected();
  const r = compareReadBack(p, { ...observedFrom(p), lineKey: "1799825", itemId: "76156" });
  assert.ok(!r.matches && r.mismatched.includes("line_key") && r.mismatched.includes("item"));
});
