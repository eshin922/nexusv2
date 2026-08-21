import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";
import {
  ORDERED_SPEC_HASH_VERSION,
  canonicalize,
  orderedSpecContentHash,
} from "../../src/lib/ordered-spec-hash.ts";

/** Comments stripped AND line endings normalized — see #334 for why. */
const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// ORDERED-ITEM SPEC FREEZE
//
// `leaf_specs` answers "what is this product's spec". A sent order needs "what
// was ORDERED", and nothing in the live model keeps those the same: one mutable
// quote-owned authority per (quote, leaf), no draft-lock, inert version columns
// for quote scope, and an addendum that reads current values at render time.
//
// The live row is deliberately NOT locked. The freeze is what makes leaving it
// revisable safe.
// ═══════════════════════════════════════════════════════════════════════

const FREEZE = () =>
  readFile(new URL("../../src/lib/ordered-spec-freeze.ts", import.meta.url), "utf8");
const SEND = () =>
  readFile(new URL("../../src/app/actions/quotes.ts", import.meta.url), "utf8");
const MIGRATION = () =>
  readFile(new URL("../../drizzle/0094_ordered_spec_freeze.sql", import.meta.url), "utf8");
const SPEC_WRITER = () =>
  readFile(new URL("../../src/app/actions/leaf-specs.ts", import.meta.url), "utf8");

// ── the hash IS the revision identity ─────────────────────────────────────

test("identical values under a DIFFERENT schema hash differently", () => {
  const values = { colour: "black", capacity: "50ml" };
  const a = orderedSpecContentHash({ specValues: values, productTypeId: "pt-1", specSchema: "primary" });
  const b = orderedSpecContentHash({ specValues: values, productTypeId: "pt-1", specSchema: "secondary" });
  assert.notEqual(
    a,
    b,
    "the schema interprets the values; the same values read under a different " +
      "schema are a different specification and must not collide",
  );
});

test("identical values under a DIFFERENT product type hash differently", () => {
  const values = { colour: "black" };
  assert.notEqual(
    orderedSpecContentHash({ specValues: values, productTypeId: "pt-1", specSchema: "primary" }),
    orderedSpecContentHash({ specValues: values, productTypeId: "pt-2", specSchema: "primary" }),
  );
});

test("the hash is stable across key order and object identity", () => {
  const a = orderedSpecContentHash({
    specValues: { b: 2, a: { d: 4, c: 3 } },
    productTypeId: "pt", specSchema: "primary",
  });
  const b = orderedSpecContentHash({
    specValues: { a: { c: 3, d: 4 }, b: 2 },
    productTypeId: "pt", specSchema: "primary",
  });
  assert.equal(a, b, "jsonb round trips do not guarantee key order; the identity must not depend on it");
});

test("array order IS meaningful and changes the hash", () => {
  const x = orderedSpecContentHash({ specValues: { l: [1, 2] }, productTypeId: null, specSchema: null });
  const y = orderedSpecContentHash({ specValues: { l: [2, 1] }, productTypeId: null, specSchema: null });
  assert.notEqual(x, y, "canonicalisation must sort keys, never reorder list values");
});

test("field boundaries cannot be forged by rearrangement", () => {
  // Length-prefixed rather than delimiter-joined: a product type that ends
  // where the next field begins must not be able to impersonate it.
  const a = orderedSpecContentHash({ specValues: {}, productTypeId: "ab", specSchema: "c" });
  const b = orderedSpecContentHash({ specValues: {}, productTypeId: "a", specSchema: "bc" });
  assert.notEqual(a, b);
});

test("null product type and null schema are distinguishable from strings", () => {
  const nulls = orderedSpecContentHash({ specValues: {}, productTypeId: null, specSchema: null });
  const strs = orderedSpecContentHash({ specValues: {}, productTypeId: "null", specSchema: "null" });
  assert.notEqual(nulls, strs);
});

test("canonicalize leaves primitives and arrays alone", () => {
  assert.deepEqual(canonicalize([3, 1, 2]), [3, 1, 2]);
  assert.equal(canonicalize("x"), "x");
  assert.equal(canonicalize(null), null);
});

test("the hash version is part of the digest", async () => {
  assert.equal(ORDERED_SPEC_HASH_VERSION, 1);
  const src = codeOnly(
    await readFile(new URL("../../src/lib/ordered-spec-hash.ts", import.meta.url), "utf8"),
  );
  // Covered by the digest, so a deliberate change in WHAT the hash covers
  // cannot silently produce the old identity for new semantics.
  assert.match(src, /`v\$\{ORDERED_SPEC_HASH_VERSION\}`/);
});

// ── one row per ordered leaf, never an accidental omission ────────────────

test("the freeze LEFT joins, so a leaf without an authority is not dropped", async () => {
  const src = codeOnly(await FREEZE());
  assert.match(src, /\.leftJoin\(/);
  assert.doesNotMatch(
    src,
    /\.innerJoin\(/,
    "an inner join would silently drop a leaf with no authority, and a dropped " +
      "leaf reads as an item that was never ordered",
  );
});

test("every disposition is explicit, and 'no authority' is not 'no schema'", async () => {
  const src = codeOnly(await FREEZE());
  for (const d of ["specified", "no_schema", "unmapped", "no_type"]) {
    assert.match(src, new RegExp(`"${d}"`), `${d} is not handled`);
  }
  // A leaf with no authority row at all resolves to `unmapped` — nobody decided
  // anything — and must NOT be recorded as `no_schema`, which is a decision.
  const branch = src.slice(src.indexOf("const disposition = r.specId"));
  assert.match(branch.slice(0, 400), /"unmapped"/);
});

test("the disposition column is constrained by the database", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /disposition[\s\S]*?text NOT NULL/);
  assert.match(sql, /qsls_disposition_known[\s\S]*?'specified','no_schema','unmapped','no_type'/);
});

// ── keyed to the SEND, not the quote ──────────────────────────────────────

test("one frozen spec per (snapshot, quote_leaf)", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /UNIQUE \("quote_snapshot_id", "quote_leaf_id"\)/);
});

test("keyed to the snapshot so a revision cannot overwrite the prior offer", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /"quote_snapshot_id" uuid NOT NULL/);
  // Keying to the quote would let send N overwrite what send N-1 was ordered
  // under — the exact history this table exists to keep.
  assert.doesNotMatch(sql, /"quote_id" uuid NOT NULL/);
});

test("quote_leaf_id has NO cascading FK, so history survives structure edits", async () => {
  const sql = await MIGRATION();
  const line = sql.split("\n").find((l) => l.includes('"quote_leaf_id" uuid')) ?? "";
  assert.doesNotMatch(line, /REFERENCES/, "a cascading FK would delete what was ordered when a quote is tidied");
});

// ── immutable after creation ──────────────────────────────────────────────

test("UPDATE is refused by the database, not merely by convention", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /CREATE TRIGGER "qsls_no_update"/);
  assert.match(sql, /BEFORE UPDATE ON "quote_snapshot_leaf_specs"/);
  assert.match(sql, /RAISE EXCEPTION/);
  // DELETE stays open so the snapshot FK can cascade.
  assert.doesNotMatch(sql, /BEFORE DELETE ON "quote_snapshot_leaf_specs"/);
});

test("no code path updates a frozen spec", async () => {
  const src = codeOnly(await FREEZE());
  assert.doesNotMatch(src, /\.update\(quoteSnapshotLeafSpecs\)/);
  assert.doesNotMatch(
    src,
    /onConflictDoNothing/,
    "a second freeze against one snapshot means a send ran twice; the unique " +
      "constraint refusing is correct, and swallowing it would let the second " +
      "run believe it froze something",
  );
});

// ── SEND ordering is the governed part ────────────────────────────────────

test("SEND materializes before freezing", async () => {
  const src = codeOnly(await SEND());
  const ensure = src.indexOf("ensureQuoteSpecAuthority(tx as never");
  const freeze = src.indexOf("freezeOrderedSpecs(tx,");
  assert.ok(ensure > 0 && freeze > 0, "both steps must exist");
  assert.ok(
    ensure < freeze,
    "freezing without materializing records an ABSENCE as a fact — 'this item " +
      "had no specification' when nobody had opened it yet",
  );
});

test("specs freeze before the commercial line set, inside one transaction", async () => {
  const src = codeOnly(await SEND());
  const freeze = src.indexOf("freezeOrderedSpecs(tx,");
  const commercial = src.indexOf("freezeCommercialLineSet(tx,");
  assert.ok(freeze < commercial, "governed ordering");
  // Both take `tx`: a failure in either rolls the send back before the offer is
  // finalized.
  assert.match(src, /freezeOrderedSpecs\(tx, \{ quoteId, snapshotId: snapshot\.id \}\)/);
});

test("the freeze does not materialize on its own behalf", async () => {
  const src = codeOnly(await FREEZE());
  assert.doesNotMatch(
    src,
    /ensureQuoteSpecAuthority/,
    "materializing inside the freeze would let it invent an authority the " +
      "customer document never saw",
  );
});

// ── the live row stays revisable — the point of freezing HERE ─────────────

test("the live leaf_specs row is NOT locked after send", async () => {
  const src = codeOnly(await SPEC_WRITER());
  assert.doesNotMatch(
    src,
    /assertNotFrozen|assertDraft/,
    "governed: the snapshot is the historical authority and the working spec " +
      "stays revisable for future orders. Locking the live row would solve the " +
      "wrong half and block legitimate revision.",
  );
});

// ── downstream reads the snapshot, never the live table ───────────────────

test("the NetSuite tree does not read live leaf_specs", async () => {
  const files = [
    "../../src/lib/netsuite/mark-complete.ts",
    "../../src/lib/netsuite/frozen-sales-order.ts",
    "../../src/lib/netsuite/sales-orders.ts",
    "../../src/lib/netsuite/accounting-line-emitter.ts",
  ];
  for (const f of files) {
    const src = codeOnly(await readFile(new URL(f, import.meta.url), "utf8"));
    assert.doesNotMatch(
      src,
      /leafSpecs|leaf_specs/,
      `${f} reads the live spec table; the packet must read the frozen snapshot`,
    );
  }
});

test("the freeze module exposes the read the packet is meant to use", async () => {
  const src = codeOnly(await FREEZE());
  assert.match(src, /export async function readFrozenOrderedSpecs/);
  assert.match(src, /quoteSnapshotLeafSpecs\.quoteSnapshotId/);
});
