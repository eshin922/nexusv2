// HubSpot product-type source fidelity.
//
// THE DEFECT THIS GUARDS. `hs_product_type` was fetched, mapped into the
// in-memory shape, and then dropped at the write boundary — deliberately, on the
// correct observation that HubSpot's vocabulary is not Nexus's. The consequence
// was a Library filter predicating on a column 97.6% of leaves have no value
// for: "Primary packaging (PP)" matched 14 leaves against HubSpot's 171.
//
// THE TRAP THESE PIN. Three options have an internal value that differs from the
// label shown in the HubSpot UI, and they are among the largest categories:
//
//     "Primary Packaging"   -> `Primary`               (171 products)
//     "Secondary Packaging" -> `Secondary`             (346 products)
//     "Logistics"           -> `Third Party Logistics` (4 products)
//
// Anything that sends or filters on a label misses roughly half the catalogue
// and fails SILENTLY — no error, just an empty result indistinguishable from an
// empty catalogue. That silence is why every assertion below is about values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  mapHubspotToLeaf,
  mapLeafToHubspotCreate,
} from "../../src/lib/hubspot-mapper.ts";
import { isKnownHubspotProductTypeValue } from "../../src/lib/hubspot-product-type-vocabulary.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

/**
 * Source with comments removed. A commented-out line, or prose naming a symbol,
 * must never satisfy an assertion about what the code does.
 */
async function code(p: string): Promise<string> {
  return (await read(p))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The PRODUCTION vocabulary, as read from the property definition 2026-08-13.
 *
 * A fixture for the pure predicate only — never a source of truth. The sandbox
 * portal's option set is genuinely different (it has `Corrugated` and
 * `Preliminary`, lacks `Finished Goods` and `Turnkey`, and does not diverge on
 * Logistics), which is exactly why the vocabulary is fetched at runtime and why
 * it must be fetched through the products client.
 */
const LIVE_OPTIONS = [
  { label: "Cards, Booklets", value: "Cards, Booklets", displayOrder: 0 },
  { label: "Design", value: "Design", displayOrder: 1 },
  {
    label: "Filling and Packout Services",
    value: "Filling and Packout Services",
    displayOrder: 2,
  },
  { label: "Formulation", value: "Formulation", displayOrder: 3 },
  { label: "Freight", value: "Freight", displayOrder: 4 },
  { label: "Labels", value: "Labels", displayOrder: 5 },
  { label: "Logistics", value: "Third Party Logistics", displayOrder: 6 },
  { label: "One Time Charges", value: "One Time Charges", displayOrder: 7 },
  { label: "Primary Packaging", value: "Primary", displayOrder: 8 },
  { label: "R&D / Testing", value: "R&D / Testing", displayOrder: 9 },
  { label: "Raw ingredients", value: "Raw ingredients", displayOrder: 10 },
  { label: "Secondary Packaging", value: "Secondary", displayOrder: 11 },
  {
    label: "Soft Goods and Accessories",
    value: "Soft Goods and Accessories",
    displayOrder: 12,
  },
  { label: "Finished Goods", value: "Finished Goods", displayOrder: 13 },
  { label: "Turnkey", value: "Turnkey", displayOrder: 14 },
];

const DIVERGENT: Array<[label: string, value: string]> = [
  ["Primary Packaging", "Primary"],
  ["Secondary Packaging", "Secondary"],
  ["Logistics", "Third Party Logistics"],
];

const product = (hs_product_type?: string) =>
  ({
    id: "1",
    archived: false,
    properties: { name: "P", ...(hs_product_type ? { hs_product_type } : {}) },
  }) as never;

// ───────────────────────────── pull direction ─────────────────────────────

test("pull carries the RAW internal value onto the leaf", () => {
  for (const [, value] of DIVERGENT) {
    assert.equal(mapHubspotToLeaf(product(value), {}).hubspotProductType, value);
  }
});

test("pull never substitutes a label for the value", () => {
  const mapped = mapHubspotToLeaf(product("Primary"), {});
  assert.equal(mapped.hubspotProductType, "Primary");
  assert.notEqual(mapped.hubspotProductType, "Primary Packaging");
});

test("an unclassified product stays null — no fabricated type", () => {
  assert.equal(mapHubspotToLeaf(product(), {}).hubspotProductType, null);
  assert.equal(mapHubspotToLeaf(product(""), {}).hubspotProductType, null);
});

test("BOTH pull write branches persist the source type", async () => {
  const src = await code("src/lib/hubspot-pull.ts");
  const writes = src.match(/hubspotProductType: mapped\.hubspotProductType/g);
  // Insert (new leaf) and update (existing leaf). One branch alone would leave
  // the pre-existing 1,061 leaves permanently unclassified.
  assert.equal(writes?.length, 2);
});

test("the pull never writes the Nexus taxonomy", async () => {
  const src = await code("src/lib/hubspot-pull.ts");
  // productTypeId stays operator-authored via the TypePicker. This repair adds a
  // parallel column; it does not reverse the documented non-mapping decision.
  assert.doesNotMatch(src, /productTypeId:/);
});

// ───────────────────────────── push direction ─────────────────────────────

test("create sends the internal value as hs_product_type", () => {
  for (const [, value] of DIVERGENT) {
    const out = mapLeafToHubspotCreate({ name: "P", hubspotProductType: value });
    assert.equal(out.hs_product_type, value);
  }
});

test("create omits the field entirely when unclassified", () => {
  for (const v of [null, undefined, ""]) {
    const out = mapLeafToHubspotCreate({ name: "P", hubspotProductType: v });
    assert.equal("hs_product_type" in out, false);
  }
});

// ──────────────────────── vocabulary is the authority ────────────────────────

test("a display label is NOT a legal value", () => {
  // The whole trap in one assertion: the label an operator reads must never be
  // accepted where the value belongs.
  for (const [label, value] of DIVERGENT) {
    assert.equal(isKnownHubspotProductTypeValue(value, LIVE_OPTIONS), true, value);
    assert.equal(isKnownHubspotProductTypeValue(label, LIVE_OPTIONS), false, label);
  }
});

test("every non-divergent option round-trips on its own value", () => {
  for (const o of LIVE_OPTIONS) {
    assert.equal(isKnownHubspotProductTypeValue(o.value, LIVE_OPTIONS), true);
  }
});

test("the vocabulary is fetched, never hard-coded", async () => {
  const src = await code("src/lib/hubspot-product-type-vocabulary.ts");
  assert.match(src, /crm\.properties\.coreApi\.getByName\(/);
  assert.match(src, /HS_PRODUCT_TYPE_PROPERTY/);
  // Withdrawn options must not be offered — classifying under a retired value
  // would be legal at the API and wrong for the firm.
  assert.match(src, /\.filter\(\(o\) => !o\.hidden\)/);
});

test("the vocabulary is read from the SAME portal that holds the products", async () => {
  const vocab = await code("src/lib/hubspot-product-type-vocabulary.ts");
  const pull = await code("src/lib/hubspot-pull.ts");
  // The Products domain is dev/prod-aware and the two portals' option sets
  // differ. Reading the vocabulary through getReadClient() would validate a
  // create against production's options while createProduct writes to the
  // sandbox — `Turnkey` is legal in one and absent from the other. The
  // vocabulary, the listing, and the create must all be one client.
  assert.match(vocab, /getProductsClient\(\)/);
  assert.doesNotMatch(vocab, /getReadClient/);
  // And the values being filtered come from that same client's listing.
  assert.match(pull, /hubspot\.listProducts\(/);
});

test("create validates membership BEFORE writing to HubSpot", async () => {
  const src = await code("src/app/actions/leaves.ts");
  assert.match(src, /isKnownHubspotProductTypeValue\(hubspotProductType, options\)/);
  // Ordering is the assertion. A label reaching HubSpot would be stored as a
  // free string that matches no filter and no report, and the leaf would then
  // persist it — a fabricated type in two systems at once.
  const guardAt = src.indexOf("isKnownHubspotProductTypeValue(hubspotProductType");
  const pushAt = src.indexOf("hubspot.createProduct(");
  assert.ok(guardAt > 0 && pushAt > 0, "both call sites must be present");
  assert.ok(guardAt < pushAt, "validation must precede the provider call");
});

// ────────────────────────── library filter + storage ──────────────────────────

test("the Library filters the source classification, not the Nexus taxonomy", async () => {
  const src = await code("src/lib/library-browse-loader.ts");
  assert.match(src, /eq\(leaves\.hubspotProductType, filters\.sourceTypeFilter\)/);
  // Unclassified is a selectable branch, not an omission — the 5 HubSpot nulls
  // and any Nexus-authored leaf remain reachable.
  assert.match(src, /isNull\(leaves\.hubspotProductType\)/);
  assert.match(src, /UNCLASSIFIED_SOURCE_TYPE/);
});

test("chips render labels and filter on values", async () => {
  const src = await code("src/components/library/library-browse-modal.tsx");
  assert.match(src, /setSourceTypeFilter\(t\.value\)/);
  assert.match(src, /\{t\.label\}/);
  assert.match(src, /setSourceTypeFilter\(UNCLASSIFIED_SOURCE_TYPE\)/);
});

test("the Library modal takes no RUNTIME value from the server-only loader", async () => {
  // The modal is a client component. A type import from the loader is erased
  // and harmless; a value import pulls the whole server-only module — and
  // therefore the db client — into the client graph, which fails the build.
  // The sentinel lives in a boundary-neutral module for exactly that reason.
  const src = await code("src/components/library/library-browse-modal.tsx");
  // `[^;]` bounds the match at the statement terminator. A `[\s\S]*?` here
  // silently swallows preceding import statements and reports the wrong one.
  const loaderImports = src.match(
    /import[^;]*?from "@\/lib\/library-browse-loader"/g,
  );
  for (const imp of loaderImports ?? []) {
    assert.match(imp, /^import type\b/, `value import from the loader: ${imp}`);
  }
  assert.match(src, /from "@\/lib\/library-source-type"/);
  // And the neutral module must stay neutral.
  assert.doesNotMatch(await code("src/lib/library-source-type.ts"), /server-only/);
});

test("the Nexus taxonomy survives untouched in both directions", async () => {
  // Independence: this repair neither reads productTypeId to derive a source
  // type nor writes it from one. Both filters coexist.
  assert.match(
    await code("src/lib/library-browse-loader.ts"),
    /eq\(leaves\.productTypeId, filters\.typeFilter\)/,
  );
  assert.match(await code("src/app/actions/leaves.ts"), /productTypeId,/);
});

test("the create dropdown is fed by the fetched vocabulary, and submits the value", async () => {
  const src = await code("src/components/add-product/add-product-modal.tsx");
  assert.match(src, /fetchHubspotProductTypes/);
  assert.match(src, /props\.hsTypeOptions\.map/);
  assert.match(src, /fd\.set\("hubspotProductType", hsTypeValue\)/);
});
