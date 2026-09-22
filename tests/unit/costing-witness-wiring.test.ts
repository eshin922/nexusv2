/**
 * Steps 4-6 wiring — the three ends of one contract.
 *
 * The witness mechanism is correct only if the reader, the writers and the
 * client agree about things no type system checks across a server/client
 * boundary: WHICH STATEMENT a marker is taken from, and WHICH STRING names a
 * domain. Both are invisible to `tsc` and both fail silently.
 *
 *   a marker from the wrong statement   -> describes a different snapshot, so
 *       inclusion is answered about a read nobody performed
 *   a domain string that does not match -> the client arms a requirement no
 *       reader can ever settle, and the read is held until the surface
 *       unmounts
 *
 * So these are source-shape assertions, deliberately. They are the only place
 * "same statement" can be established without a database, and the behaviour
 * they protect is proved separately: the primitives in
 * `cc-reconciliation-p1.md`, the algebra in `costing-witness.test.ts`, the
 * store in `costing-store-write-floor.test.ts`, and the arming path in
 * `packaging-arming-mounted.test.tsx`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PACKAGING_DOMAIN } from "../../src/lib/costs/packaging-domain.ts";
import { PAYLOAD_ORDERING_DOMAIN } from "../../src/lib/costing-store.ts";

/**
 * Source with carriage returns stripped.
 *
 * The working tree is CRLF and every multi-line anchor below is written with
 * bare newlines. Without this the anchors miss and the tests fail for a reason
 * that has nothing to do with the contract they assert — a control that fails
 * for the wrong reason is no better than one that passes for the wrong one.
 */
const CARRIAGE_RETURN = String.fromCharCode(13);
const read = (p: string) =>
  readFileSync(new URL(`../../${p}`, import.meta.url), "utf8")
    .split(CARRIAGE_RETURN)
    .join("");

const reader = read("src/app/actions/costing.ts");
const writers = read("src/app/actions/assembly-leaf-inputs.ts");
const client = read("src/components/costs/packaging-drilldown.tsx");
const freight = read("src/app/actions/freight-worksheet.ts");

/** The text between an anchor and the next occurrence of `stop`. */
function statement(source: string, anchor: string, stop: string): string {
  const start = source.indexOf(anchor);
  assert.ok(start >= 0, `anchor not found: ${anchor}`);
  const end = source.indexOf(stop, start);
  assert.ok(end > start, `stop not found after anchor: ${stop}`);
  return source.slice(start, end);
}

// ── Step 4 · reader ───────────────────────────────────────────────────────

test("the payload witness comes from the SAME statement as the legacy revision", () => {
  // Not "also somewhere in the file". The two must be columns of one SELECT,
  // because `revision` is that snapshot's `xmax` and the witness is the
  // snapshot it is the xmax OF. Taken apart they describe different instants
  // and the relationship silently stops holding.
  const select = statement(reader, ".select({\n        quotes,", ".from(quotes)");
  assert.match(
    select,
    /revision: sql<string>`pg_snapshot_xmax\(pg_current_snapshot\(\)\)::text`/,
  );
  assert.match(select, /witness: sql<string>`pg_current_snapshot\(\)::text`/);
});

test("the packaging witness comes from the SAME statement that reads packaging", () => {
  const select = statement(
    reader,
    'timed("nm.assembly_leaf_inputs"',
    ".from(assemblyLeafInputs)",
  );
  assert.match(select, /assembly_leaf_inputs: assemblyLeafInputs/);
  assert.match(select, /witness: sql<string>`pg_current_snapshot\(\)::text`/);
});

test("the bundle carries both witnesses and declares its guarded domains", () => {
  assert.match(reader, /witnesses: \{/);
  assert.match(reader, /\[PAYLOAD_ORDERING_DOMAIN\]: payloadWitness/);
  assert.match(
    reader,
    /\[PACKAGING_DOMAIN\]:\s+newModelData\.assemblyLeafInputWitness \?\? payloadWitness/,
  );
  assert.match(
    reader,
    /guardedDomains: \[PAYLOAD_ORDERING_DOMAIN, PACKAGING_DOMAIN\]/,
  );
});

test("the domain names are shared constants, not repeated literals", () => {
  // A literal on each side would typecheck and never match at runtime.
  assert.equal(PACKAGING_DOMAIN, "packaging");
  assert.equal(PAYLOAD_ORDERING_DOMAIN, "bundle");
  assert.match(
    reader,
    /import \{ PACKAGING_DOMAIN \} from "@\/lib\/costs\/packaging-domain"/,
  );
  assert.match(
    client,
    /import \{ PACKAGING_DOMAIN \} from "@\/lib\/costs\/packaging-domain"/,
  );
});

test("the empty-packaging fallback is the payload witness, which is EARLIER", () => {
  // Soundness depends on direction. Phase 1 completes before the parallel
  // phase is issued, so its snapshot cannot be NEWER than the packaging read's
  // — a lower bound under-reports freshness, costing a held read and a
  // re-read, never a wrong accept. A fallback taken later would be unsafe.
  const bundle = statement(reader, "const bundleRevision = Number(", "return {");
  assert.ok(
    bundle.indexOf("const payloadWitness") <
      bundle.indexOf("loadNewModelCostDataForQuote"),
    "the payload witness must be taken before the packaging read is issued",
  );
});

// ── Step 5 · writers ──────────────────────────────────────────────────────

for (const [label, anchor] of [
  ["cell", ".update(assemblyLeafInputs)\n      .set({\n        unitCost:"],
  [
    "line meta",
    ".update(assemblyLeafInputs)\n      .set({\n        pricingVendorHubspotCompanyId:",
  ],
] as const) {
  test(`the ${label} writer returns its own transaction id from the write statement`, () => {
    const update = statement(writers, anchor, "await logAudit");
    // `RETURNING` on the UPDATE itself. A following SELECT would be a
    // different transaction with a different id — these actions autocommit
    // each statement separately, which is the mistake Freight still makes.
    assert.match(
      update,
      /\.returning\(\{\s*writeId: sql<string>`pg_current_xact_id_if_assigned\(\)::text`,?\s*\}\)/,
      "the id must come from the write statement's own RETURNING",
    );
    // `_if_assigned`, never the forcing variant: `pg_current_xact_id()` would
    // ASSIGN an xid, burning one on every read-only path that touched it.
    assert.doesNotMatch(update, /[^_]pg_current_xact_id\(\)/);
  });
}

test("both no-op paths return a null write id", () => {
  // The values already match, no UPDATE is issued, so there is no transaction
  // to await. Arming on this would hold every later read against a write that
  // never happened — the one shape that genuinely wedges reconciliation.
  assert.match(
    writers,
    /if \(Object\.keys\(diff\)\.length === 0\) \{[\s\S]{0,400}?writeId: null,/,
    "the cell no-op must return writeId: null",
  );
  assert.match(
    writers,
    /writeId: string \| null = null,\s*\n\s*\): PackagingLineSnapshot/,
    "the line-meta no-op reaches the factory's null default",
  );
});

test("a zero-row UPDATE yields no id rather than a wrong one", () => {
  // `RETURNING` produces no row when nothing matched, so `written[0]?.writeId`
  // is undefined and the coalesce makes it null. Measured in P1: a zero-row
  // UPDATE does not even assign an xid.
  const uses = writers.match(/written\[0\]\?\.writeId \?\? null/g) ?? [];
  assert.equal(uses.length, 2, "both writers coalesce a missing row to null");
});

// ── Step 6 · client ───────────────────────────────────────────────────────

test("the client arms only on the accepted branch", () => {
  const arms = client.match(/armWrite\(\{/g) ?? [];
  assert.equal(arms.length, 2, "exactly two write paths arm: cell and line meta");
  for (const site of client.matchAll(/armWrite\(\{[\s\S]{0,200}?\}\);/g)) {
    assert.match(site[0], /outcome: "acknowledged"/);
    assert.match(site[0], /domains: \[PACKAGING_DOMAIN\]/);
  }
  // No path arms with a non-acknowledged outcome, and none arms at dispatch.
  assert.doesNotMatch(client, /outcome: "unknown"/);
  assert.doesNotMatch(client, /outcome: "failed"/);
});

test("arming happens after the failure branches have returned", () => {
  const fire = statement(client, "function fireSave()", "function handleChange");
  assert.ok(
    fire.indexOf("if (threw || (result !== null && !result.ok))") <
      fire.indexOf("armWrite({"),
    "the failure branch must return before arming is reachable",
  );
});

test("Pattern 47(e) survives — no input is disabled by a pending save", () => {
  assert.doesNotMatch(client, /disabled=\{[^}]*pending[^}]*\}/);
});

// ── payload compatibility ─────────────────────────────────────────────────

test("Freight's revision contract is untouched", () => {
  // Shipped, green, and explicitly out of scope. Its marker is unsound and its
  // correction is its own change with its own proof.
  //
  // Asserted against the EXECUTABLE body, not the whole file: the Step 0
  // comment above it names `pg_current_xact_id_if_assigned` while explaining
  // what this helper does NOT do, and a file-wide check would fail on the
  // explanation rather than on any behaviour.
  const body = statement(
    freight,
    "async function committedRevision(",
    "\nconst str =",
  );
  assert.match(body, /pg_snapshot_xmax\(pg_current_snapshot\(\)\)::text as revision/);
  assert.doesNotMatch(body, /pg_current_xact_id/);
  assert.doesNotMatch(body, /pg_current_snapshot\(\)::text as witness/);
  // And no Freight path returns a write id or arms anything.
  assert.doesNotMatch(freight, /writeId/);
  assert.doesNotMatch(freight, /armWrite/);
});

test("the legacy revision field is still emitted for every existing consumer", () => {
  assert.match(reader, /revision: bundleRevision/);
  assert.match(reader, /const bundleRevision = Number\(quoteRows\[0\]\.revision\)/);
});

test("no other surface arms — Production and Freight stay unguarded", () => {
  for (const path of [
    "src/components/costs/production-drilldown.tsx",
    "src/components/costs/freight-drilldown.tsx",
  ]) {
    assert.doesNotMatch(read(path), /armWrite/, `${path} must not arm`);
  }
});
