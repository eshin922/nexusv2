/**
 * Migration 0136 · product-associated Direct Services.
 *
 * Two products on one quote may each own their own Filling / Blending,
 * Pack-out / Assembly or Testing / Micros service. The service library leaves
 * stay unique, so each product's instance is a separate `quote_leaves` row of
 * the same service leaf, told apart by `associated_product_quote_leaf_id`.
 *
 * The database boundary (same quote, product owner, top-level owner, service
 * row) is declarative and is falsified against a real schema, not here. What is
 * asserted HERE is the pure verdict an operator reads, and that every writer and
 * copier of the structure honours the association rather than dropping it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DIRECT_SERVICE_IDENTITIES,
  DIRECT_SERVICE_PRODUCTION_INPUT,
} from "../../src/lib/product-structure/direct-service.ts";
import {
  PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES,
  evaluateServiceAssociation,
  isProductAssociableServiceIdentity,
} from "../../src/lib/product-structure/service-association.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const raw = (rel: string) => readFile(ROOT + rel, "utf8");
async function code(rel: string): Promise<string> {
  const src = await raw(rel);
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
/** SQL with `--` comments removed, so assertions read statements, not prose. */
async function sql(rel: string): Promise<string> {
  return (await raw(rel)).replace(/--.*$/gm, "");
}

const MIGRATION = "drizzle/0136_product_associated_direct_service.sql";

const QUOTE = "q-1";
const filling = { commercialKind: "service", serviceIdentity: "filling_blending" };
const directProduct = { quoteId: QUOTE, assemblyId: null, commercialKind: "product" };

// ── identities ────────────────────────────────────────────────────────────

test("exactly the three product-specific production services are associable", () => {
  assert.deepEqual([...PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES].sort(), [
    "filling_blending",
    "packout_assembly",
    "testing_micros",
  ]);
  for (const id of PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES) {
    assert.ok((DIRECT_SERVICE_IDENTITIES as readonly string[]).includes(id));
  }
  // Formulation is one-time development work with its own component-owned
  // charge route; Other Service carries a per-line NetSuite item selection.
  assert.equal(isProductAssociableServiceIdentity("formulation"), false);
  assert.equal(isProductAssociableServiceIdentity("other_service"), false);
  assert.equal(isProductAssociableServiceIdentity(null), false);
});

test("each associable service keeps its governed production input — not a component charge", async () => {
  // Priced through the service's OWN Production row, per tier. None of these
  // columns is a one-time setup/tooling/artwork column.
  for (const id of PRODUCT_ASSOCIABLE_SERVICE_IDENTITIES) {
    assert.ok(
      ["fillingBlendingCost", "cmAssemblyTotal", "testingMicrosTotal"].includes(
        DIRECT_SERVICE_PRODUCTION_INPUT[id],
      ),
      `${id} maps to ${DIRECT_SERVICE_PRODUCTION_INPUT[id]}`,
    );
  }
  // And the association path never reaches the component-charge machinery.
  for (const file of [
    "src/lib/product-structure/service-association.ts",
    "src/lib/product-structure/direct-attachment.ts",
    "src/app/actions/quote-products.ts",
  ]) {
    const src = await code(file);
    assert.doesNotMatch(src, /quoteChargeInstances|component-charges|createComponentCharge/, file);
  }
});

// ── the pure verdict ──────────────────────────────────────────────────────

test("a Filling service for a top-level product on the same quote is associable", () => {
  assert.deepEqual(
    evaluateServiceAssociation({ quoteId: QUOTE, service: filling, product: directProduct }),
    { associable: true },
  );
});

test("each refusal reports its actual cause", () => {
  const cases: Array<[Parameters<typeof evaluateServiceAssociation>[0], string]> = [
    [{ quoteId: QUOTE, service: { commercialKind: "product", serviceIdentity: null }, product: directProduct }, "not_a_service"],
    [{ quoteId: QUOTE, service: { commercialKind: "service", serviceIdentity: "formulation" }, product: directProduct }, "identity_not_associable"],
    [{ quoteId: QUOTE, service: { commercialKind: "service", serviceIdentity: "other_service" }, product: directProduct }, "identity_not_associable"],
    [{ quoteId: QUOTE, service: filling, product: null }, "product_not_found"],
    [{ quoteId: QUOTE, service: filling, product: { ...directProduct, quoteId: "q-other" } }, "product_on_other_quote"],
    [{ quoteId: QUOTE, service: filling, product: { ...directProduct, commercialKind: "service" } }, "product_not_a_product"],
    [{ quoteId: QUOTE, service: filling, product: { ...directProduct, assemblyId: "asy-1" } }, "product_not_direct"],
  ];
  for (const [input, reason] of cases) {
    const verdict = evaluateServiceAssociation(input);
    assert.equal(verdict.associable, false, reason);
    if (!verdict.associable) {
      assert.equal(verdict.reason, reason);
      assert.ok(verdict.message.length > 0);
    }
  }
});

test("a cross-quote product is refused even when everything else is valid", () => {
  const verdict = evaluateServiceAssociation({
    quoteId: QUOTE,
    service: { commercialKind: "service", serviceIdentity: "testing_micros" },
    product: { quoteId: "q-2", assemblyId: null, commercialKind: "product" },
  });
  assert.equal(verdict.associable, false);
});

// ── the database boundary, as authored ────────────────────────────────────

test("0136 is journaled after 0135 and before the quote-presentation migration", async () => {
  const journal = JSON.parse(await raw("drizzle/meta/_journal.json")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const e135 = journal.entries.find((e) => e.tag === "0135_formulated_product_owned_fees");
  const e136 = journal.entries.find((e) => e.tag === "0136_product_associated_direct_service");
  const e137 = journal.entries.find((e) => e.tag === "0137_associated_service_quote_presentation");
  assert.ok(e135 && e136 && e137);
  assert.equal(e136.idx, e135.idx + 1);
  assert.equal(e137.idx, e136.idx + 1);
  assert.ok(e136.when > e135.when, "the migrator only runs entries above the high-water mark");
});

test("the owner must be a top-level PRODUCT on the SAME quote — composite FK", async () => {
  const s = await sql(MIGRATION);
  assert.match(
    s,
    /FOREIGN KEY \(\s*"associated_product_quote_leaf_id",\s*"quote_id",\s*"associated_product_kind",\s*"associated_product_is_direct"\s*\)\s*REFERENCES "quote_leaves" \("id", "quote_id", "commercial_kind", "is_direct"\)\s*ON DELETE NO ACTION/,
  );
  // The referencing kind/directness are GENERATED constants — unwritable.
  assert.match(s, /"associated_product_kind" "leaf_commercial_kind"\s*GENERATED ALWAYS AS[\s\S]*?'product'::"leaf_commercial_kind"/);
  assert.match(s, /"associated_product_is_direct" boolean\s*GENERATED ALWAYS AS/);
  assert.match(s, /"is_direct" boolean\s*GENERATED ALWAYS AS \("assembly_id" IS NULL\) STORED/);
  assert.match(s, /UNIQUE \("id", "quote_id", "commercial_kind", "is_direct"\)/);
  // Not CASCADE: removing a product must not silently destroy priced services.
  assert.doesNotMatch(s, /associated_product[\s\S]*ON DELETE CASCADE/);
});

test("only a top-level SERVICE row may carry an association — CHECK", async () => {
  const s = await sql(MIGRATION);
  assert.match(
    s,
    /CHECK \(\s*"associated_product_quote_leaf_id" IS NULL\s*OR \("commercial_kind" = 'service' AND "assembly_id" IS NULL\)\s*\)/,
  );
});

test("standalone stays one-per-quote; associated is one per (product, service)", async () => {
  const s = await sql(MIGRATION);
  assert.match(
    s,
    /CREATE UNIQUE INDEX "quote_leaves_standalone_service_unique_idx"\s*ON "quote_leaves" \("quote_id", "leaf_id"\)\s*WHERE "assembly_id" IS NULL\s*AND "commercial_kind" = 'service'\s*AND "associated_product_quote_leaf_id" IS NULL/,
  );
  assert.match(
    s,
    /CREATE UNIQUE INDEX "quote_leaves_product_service_unique_idx"\s*ON "quote_leaves" \("associated_product_quote_leaf_id", "leaf_id"\)\s*WHERE "associated_product_quote_leaf_id" IS NOT NULL/,
  );
  // The census guard runs BEFORE the tightening it protects.
  assert.ok(s.indexOf("RAISE EXCEPTION") < s.indexOf("quote_leaves_standalone_service_unique_idx"));
  // The canonical service library record is still one per identity.
  const schema = await code("src/db/schema.ts");
  assert.match(schema, /uniqueIndex\("leaves_service_identity_unique_idx"\)/);
});

test("the schema model declares the column and keeps the derived ones unwritable", async () => {
  const schema = await code("src/db/schema.ts");
  assert.match(schema, /associatedProductQuoteLeafId: uuid\("associated_product_quote_leaf_id"\)/);
  assert.match(schema, /isDirect: boolean\("is_direct"\)\.generatedAlwaysAs/);
  assert.match(schema, /"associated_product_kind",\s*\)\.generatedAlwaysAs/);
  assert.match(schema, /"associated_product_is_direct",\s*\)\.generatedAlwaysAs/);
  assert.match(schema, /name: "quote_leaves_associated_product_fk"/);
});

// ── writers ───────────────────────────────────────────────────────────────

test("the duplicate check is scoped by association", async () => {
  const src = await code("src/lib/product-structure/direct-attachment.ts");
  assert.match(
    src,
    /associatedProductQuoteLeafId\s*\?\s*eq\(quoteLeaves\.associatedProductQuoteLeafId, associatedProductQuoteLeafId\)\s*:\s*isNull\(quoteLeaves\.associatedProductQuoteLeafId\)/,
  );
  // The association is written, not dropped on the floor.
  assert.match(src, /position: args\.position,\s*associatedProductQuoteLeafId,\s*\}\)/);
});

test("detaching a product with services attached for it is refused, not cascaded", async () => {
  const src = await code("src/lib/product-structure/direct-attachment.ts");
  const guardAt = src.indexOf("eq(quoteLeaves.associatedProductQuoteLeafId, row.id)");
  const deleteAt = src.indexOf("tx.delete(quoteLeaves)");
  assert.ok(guardAt > 0 && deleteAt > 0 && guardAt < deleteAt);
});

test("a product with services attached for it does not move into an Item Group", async () => {
  const src = await code("src/lib/product-structure/structural-move.ts");
  const guardAt = src.indexOf("eq(quoteLeaves.associatedProductQuoteLeafId, canonical.id)");
  const firstWriteAt = src.indexOf(".update(assemblyLeaves)");
  assert.ok(guardAt > 0 && guardAt < firstWriteAt, "the refusal precedes any structural write");
});

test("the attach action validates the pair before writing anything", async () => {
  const src = await code("src/app/actions/quote-products.ts");
  const body = src.slice(src.indexOf("export async function attachQuoteProduct"));
  const gateAt = body.indexOf("evaluateServiceAssociation(");
  const writeAt = body.indexOf("attachDirectProductRow(");
  assert.ok(gateAt > 0 && writeAt > 0 && gateAt < writeAt);
  assert.match(body, /associatedProductQuoteLeafId,\s*\}\);/);
  // Audit records the operator's choice explicitly.
  assert.match(body, /"direct_service_for_product"/);
  assert.match(body, /associated_product_quote_leaf_id: row\.associatedProductQuoteLeafId/);
});

// ── copy ──────────────────────────────────────────────────────────────────

test("Copy Quote attaches products before the services that name them, and remaps", async () => {
  const quotes = await code("src/app/actions/quotes.ts");
  const clone = quotes.slice(quotes.indexOf("async function cloneQuoteGraph"));
  assert.match(
    clone,
    /\.\.\.sourceDirectLeaves\.filter\(\(d\) => d\.associatedProductQuoteLeafId === null\),\s*\.\.\.sourceDirectLeaves\.filter\(\(d\) => d\.associatedProductQuoteLeafId !== null\),/,
  );
  assert.match(clone, /quoteLeafIdMap\.get\(direct\.associatedProductQuoteLeafId\)/);
  // An unmapped product fails loudly; it never degrades to a standalone service.
  assert.match(clone, /is associated with unmapped product/);
  assert.match(clone, /associatedProductQuoteLeafId: associatedProductQuoteLeafId \?\? null/);
});

test("Copy Quote carries the Testing / Micros amount", async () => {
  const quotes = await code("src/app/actions/quotes.ts");
  const clone = quotes.slice(quotes.indexOf("async function cloneQuoteGraph"));
  assert.match(clone, /testingMicrosTotal: r\.testingMicrosTotal/);
});
