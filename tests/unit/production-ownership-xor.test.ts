/**
 * Stage 3 A · Production ownership XOR.
 *
 * The database enforces the ownership boundary itself — those seven
 * falsifications were run against the real schema inside a rolled-back
 * transaction and are recorded in the PR. What is asserted HERE is the half a
 * constraint cannot express: that the application cannot even ASK for a
 * forbidden write, and that the Direct Service surface is gated on identity
 * rather than on data.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  DIRECT_SERVICE_IDENTITIES,
  DIRECT_SERVICE_PRODUCTION_INPUT,
  DIRECT_SERVICE_PRODUCTION_LABEL,
  DIRECT_SERVICE_FORBIDDEN_PRODUCTION_COLUMNS,
} from "../../src/lib/product-structure/direct-service.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
async function code(rel: string): Promise<string> {
  const src = await readFile(ROOT + rel, "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const raw = (rel: string) => readFile(ROOT + rel, "utf8");

// ── A.7 · exactly one input per identity ──────────────────────────────────

test("every identity maps to exactly one input, and they are all distinct", () => {
  for (const id of DIRECT_SERVICE_IDENTITIES) {
    assert.ok(DIRECT_SERVICE_PRODUCTION_INPUT[id], `${id} has no production input`);
    assert.ok(DIRECT_SERVICE_PRODUCTION_LABEL[id], `${id} has no label`);
  }
  const columns = DIRECT_SERVICE_IDENTITIES.map(
    (id) => DIRECT_SERVICE_PRODUCTION_INPUT[id],
  );
  // Distinctness is the load-bearing part. Two identities sharing a column
  // would be indistinguishable in the data, and BV-011 maps them to DIFFERENT
  // accounting destinations — the totals would reconcile and the attribution
  // would be wrong.
  assert.equal(new Set(columns).size, columns.length, "two identities share a column");
});

test("the mapping is exactly the dispositioned one", () => {
  assert.deepEqual({ ...DIRECT_SERVICE_PRODUCTION_INPUT }, {
    formulation: "rdTotal",
    filling_blending: "fillingBlendingCost",
    packout_assembly: "cmAssemblyTotal",
    testing_micros: "testingMicrosTotal",
    other_service: "otherServiceTotal",
  });
});

test("no service can reach Bulk Raw, Setup, Tooling or Artwork", () => {
  const reachable = new Set<string>(
    DIRECT_SERVICE_IDENTITIES.map((id) => DIRECT_SERVICE_PRODUCTION_INPUT[id]),
  );
  for (const forbidden of DIRECT_SERVICE_FORBIDDEN_PRODUCTION_COLUMNS) {
    assert.ok(!reachable.has(forbidden), `${forbidden} is reachable from a service`);
  }
});

test("Testing / Micros has its OWN column, not a reuse of Other Service", async () => {
  // The §0.5 catch. Reusing other_service_total would have reconciled exactly
  // and attributed wrongly: BV-011 maps Testing and Other to different
  // accounting destinations, so one column carrying both discards the
  // distinction a Sales Order line needs.
  assert.notEqual(
    DIRECT_SERVICE_PRODUCTION_INPUT.testing_micros,
    DIRECT_SERVICE_PRODUCTION_INPUT.other_service,
  );
  const schema = await code("src/db/schema.ts");
  assert.match(schema, /testingMicrosTotal: numeric\("testing_micros_total"/);
  const mig = await raw("drizzle/0083_testing_micros_production_input.sql");
  assert.match(mig, /ADD COLUMN "testing_micros_total"/);
});

// ── the client cannot name the column ─────────────────────────────────────

test("the writer derives the column from identity — it is never supplied", async () => {
  const action = await code("src/app/actions/direct-service-production.ts");
  assert.match(action, /DIRECT_SERVICE_PRODUCTION_INPUT\[ctx\.serviceIdentity\]/);
  // No `changedField`-style parameter. "A service cannot author Bulk Raw" is
  // not a rule this action enforces; it is a sentence it cannot express.
  assert.doesNotMatch(action, /formData\.get\("changedField"\)/);
  assert.doesNotMatch(action, /formData\.get\("column"\)/);
  assert.doesNotMatch(action, /bulkRawCost/);
});

test("the surface sends a value and no column", async () => {
  const ui = await code("src/components/costs/direct-service-production.tsx");
  assert.match(ui, /fd\.set\("amount", next\)/);
  assert.doesNotMatch(ui, /fd\.set\("column"/);
  assert.doesNotMatch(ui, /fd\.set\("changedField"/);
});

// ── gated on identity, not on data ────────────────────────────────────────

test("the service list is built from classification, not from production rows", async () => {
  // A surface that appeared because a row existed would be #282 undone by the
  // first stray write.
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.match(page, /eq\(quoteLeaves\.commercialKind, "service"\)/);
  // The leaves come first; amounts are looked up afterwards, so an unpriced
  // service still renders its input.
  const listIdx = page.indexOf("serviceLeafRows");
  const amountIdx = page.indexOf("serviceAmounts");
  assert.ok(listIdx > -1 && listIdx < amountIdx);
});

test("the writer refuses a product leaf with an operator sentence", async () => {
  const action = await code("src/app/actions/direct-service-production.ts");
  assert.match(action, /leaf\.commercialKind !== "service"/);
  assert.match(action, /is a product, not a service/);
  // And refuses a member, even though two other defences already prevent it.
  assert.match(action, /quoteLeaf\.assemblyId !== null/);
});

// ── the surface has no capacity for a second input ────────────────────────

test("the Direct Service surface renders ONE input, structurally", async () => {
  const ui = await code("src/components/costs/direct-service-production.tsx");
  // One label from the map, one row. No iteration over a column set — a
  // filtered table is a table that currently shows one thing.
  assert.match(ui, /DIRECT_SERVICE_PRODUCTION_LABEL\[svc\.serviceIdentity\]/);
  assert.doesNotMatch(ui, /setupFeeTotal|toolingArtworkTotal|bulkRawCost|rdTotal/);
  assert.doesNotMatch(ui, /PRODUCTION_COLUMNS\.map|columns\.map/);
});

test("it uses the Production TABLE grammar, not a bespoke card", async () => {
  // A second form language for economics that read identically everywhere else
  // is a cost an operator pays on every visit. Same container classes, same
  // column set, same cell shape as the Item Group table.
  const ui = await code("src/components/costs/direct-service-production.tsx");
  for (const cls of ["r6-dt prod", "r6-dt-head", "r6-dt-row", "r6-dt-foot"]) {
    assert.ok(ui.includes(cls), `missing ${cls} — not the shared table grammar`);
  }
  for (const col of ["Service", "Category", "Source", "Kind", "Markup"]) {
    assert.ok(ui.includes(`<span>${col}</span>`) || ui.includes(`>${col}<`), `no ${col} column`);
  }
});

test("the Source column is honest, not a copied vendor picker", async () => {
  // Packaging's control exists because packaging lines carry a pricing vendor.
  // `assembly_production_inputs` carries none, so a vendor picker here would
  // look like it sources a price and source nothing.
  const ui = await code("src/components/costs/direct-service-production.tsx");
  assert.doesNotMatch(ui, /Search HubSpot Vendors/);
  assert.doesNotMatch(ui, /pricingVendor/);
  assert.match(ui, /firm rate/);
});

test("markup and category are READ, never restated", async () => {
  // What makes BV-013 automatic: neither surface carries its own copy of the
  // rate or the category name.
  const ui = await code("src/components/costs/direct-service-production.tsx");
  assert.doesNotMatch(ui, /0\.4|40%|"Manufacturing"|"Production"/);
  const drill = await code("src/components/costs/production-drilldown.tsx");
  assert.match(drill, /categoryLabel=\{PRODUCTION_MARKUP_CATEGORY\}/);
  assert.match(drill, /useProductionMarkup\(service\.quoteLeafId, tiers\)/);
  // And formatted by the SAME function. The node value is a decimal fraction;
  // the first cut rendered `pct.toFixed(1) + "%"` and showed 0.3% against a
  // 30% rate — a 100x error, and a plausible-looking one.
  assert.match(ui, /fmtPct1\(markupPct\)/);
  assert.doesNotMatch(ui, /markupPct\.toFixed/);
});

test("a Direct Service is excluded from the Packaging list", async () => {
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.match(page, /if \(leaf\.commercialKind === "service"\) continue;/);
});

test("no packaging line is MATERIALIZED for a service", async () => {
  // The root cause. Attaching a service created one empty packaging row per
  // tier, because materialization enumerates every quote_leaf. Excluding the
  // service from the SKU list alone was not enough — the rows still rendered,
  // now as "Unknown component", which is a nameless authoring surface and
  // worse than the named one.
  const mat = await code("src/lib/packaging-materialization.ts");
  assert.match(mat, /ne\(quoteLeaves\.commercialKind, "service"\)/);
});

test("and the packaging READ excludes them too, for rows that predate the fix", async () => {
  // Two defences because the write fix cannot reach rows already committed.
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.match(
    page,
    /assemblyLeafInputs[\s\S]{0,700}?ne\(quoteLeaves\.commercialKind, "service"\)/,
  );
});

test("the production read covers both owners — no inner join on assemblies", async () => {
  // An inner join drops a service-owned row exactly as an IN list does: NULL
  // matches nothing. The value round-trips to the database and vanishes on
  // read, which is worse than being refused.
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.doesNotMatch(
    page,
    /from\(assemblyProductionInputs\)\s*\.innerJoin/,
    "the production query still inner-joins assemblies",
  );
  assert.match(page, /eq\(quoteLeaves\.quoteId, quote\.id\)/);
});

test("Item Group markup resolves on the ANCHOR LEAF, not the assembly id", async () => {
  // #282 re-keyed the display to the assembly, correctly. The markup read kept
  // resolving the old key, matched no node, and failed closed to an em-dash on
  // every row — including rows the engine was actively marking up and carrying
  // into quoted price.
  const drill = await code("src/components/costs/production-drilldown.tsx");
  assert.match(drill, /anchorLeafByAssembly/);
  // The CANONICAL id, not the assembly_leaf id. `mathSkuId` returns
  // `row.quoteLeafId`, so keying on `children[0].id` misses every node and
  // fails closed to the same em-dash it shows when there is no rate at all.
  assert.match(drill, /children\[0\]\.quoteLeafId/);
  assert.match(drill, /useProductionMarkup\(markupNodeId, tiers\)/);
  assert.doesNotMatch(drill, /useProductionMarkup\(sku\.id, tiers\)/);
});

test("the Item Group table never renders a service-owned row", async () => {
  const page = await code("src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx");
  assert.match(page, /if \(api\.assemblyId === null\) continue;/);
});

// ── readers survive the relaxation ────────────────────────────────────────

test("the adapter routes each owner branch to its own OWNER, not to a leaf", async () => {
  // WAS: "...to the right math leaf", pinning
  // `anchorLeafByAssembly.get(api.assemblyId)` — the coercion that put an
  // Item Group's production into one of its members. OD-028 deleted it.
  //
  // The XOR this file exists to protect is UNCHANGED and still asserted: a
  // service-owned row and an assembly-owned row take different branches. What
  // changed is where the assembly branch lands — on the assembly itself.
  const adapter = await code("src/lib/costing-adapter.ts");
  // A service maps DIRECTLY to its own leaf. Unchanged: it never needed an
  // anchor, because it has no per-assembly/per-leaf mismatch to bridge.
  assert.match(adapter, /api[.]quoteLeafId/);
  assert.match(adapter, /quoteSkuId: api[.]quoteLeafId,/);
  // An Item Group maps to ITSELF.
  assert.match(adapter, /assemblyId: api[.]assemblyId,/);
  assert.doesNotMatch(adapter, /anchorLeafByAssembly/, "the member anchor is back");
  assert.match(adapter, /assemblyId: string [|] null;/);
});

test("the scenario clone covers BOTH owner branches", async () => {
  // `WHERE assembly_id IN (...)` would silently drop every service-owned row,
  // because NULL is never IN a list — the exact defect already documented in
  // that file for the per-leaf cost tables, which committed an incomplete
  // clone with no error to notice.
  const clone = await code("src/app/actions/quotes.ts");
  assert.match(clone, /inArray\(assemblyProductionInputs\.quoteLeafId, sourceDirectLeafIds\)/);
  assert.match(clone, /quoteLeafId: newLeafId/);
});

// ── the database, not only the code ───────────────────────────────────────

test("the migration ships the relaxation and every guard together", async () => {
  // Shipping the relaxation alone would leave a window in which the database
  // accepts Production economics on a folding carton.
  const mig = await raw("drizzle/0082_production_ownership_xor.sql");
  const required: Array<[string, RegExp]> = [
    ["the XOR", /assembly_production_inputs_owner_xor/],
    ["the service-owner FK", /assembly_production_inputs_service_owner_fk/],
    ["the member-is-product FK", /assembly_leaves_member_is_product_fk/],
    ["kind immutability", /leaves_commercial_kind_immutable/],
    ["the kind sync", /quote_leaves_commercial_kind_sync/],
    ["the relaxation", /ALTER COLUMN "assembly_id" DROP NOT NULL/],
  ];
  for (const [what, pattern] of required) {
    assert.match(mig, pattern, `${what} is not in the same migration`);
  }
});

test("owner_commercial_kind is generated, so no writer can set it", async () => {
  const mig = await raw("drizzle/0082_production_ownership_xor.sql");
  assert.match(mig, /"owner_commercial_kind"[\s\S]{0,60}GENERATED ALWAYS AS/);
  const schema = await code("src/db/schema.ts");
  assert.match(schema, /ownerCommercialKind: leafCommercialKind\(/);
  assert.match(schema, /generatedAlwaysAs/);
  // Never appears in an insert anywhere.
  for (const f of [
    "src/app/actions/direct-service-production.ts",
    "src/app/actions/quotes.ts",
    "src/app/actions/assembly-production-inputs.ts",
  ]) {
    assert.doesNotMatch(await code(f), /ownerCommercialKind:/, `${f} writes a generated column`);
  }
});

// ── BV-013 · the admin surface must not misreport Production usage ────────

test("Production usage counts production rows, not packaging lines", async () => {
  // The walk found the admin surface telling an operator that changing
  // Production would recompute "0 line items across 0 draft quotes — no draft
  // quotes affected, this change is forward-only", and then repricing six
  // drafts.
  //
  // Same root cause as the UNUSED badge: usage was measured by counting
  // `assembly_leaf_inputs.category`, packaging's PER-LINE authority.
  // `assembly_production_inputs` has no category column — the engine marks the
  // whole section at one rate — so Production could never appear used.
  //
  // Not cosmetic. An admin reading "unused" may reasonably delete the row, and
  // since BV-013 made the ladder fail-visible that prices every draft's
  // production at cost and makes those quotes unsendable. The surface would
  // have invited precisely the action it is least safe to take.
  const src = await code("src/app/actions/markup-defaults.ts");
  assert.match(src, /PRODUCTION_MARKUP_CATEGORY/);
  assert.match(src, /assemblyProductionInputs/);
  // Both the badge count and the impact preview, not just one of them.
  assert.match(src, /map\.set\(PRODUCTION_MARKUP_CATEGORY/);
  assert.match(src, /const isProduction = category === PRODUCTION_MARKUP_CATEGORY/);
  // And the draft count covers BOTH owner branches, because one rate prices
  // an Item Group's section and a Direct Service's alike.
  assert.match(src, /COALESCE\(a\.quote_id, ql\.quote_id\)/);
});

test("only rows carrying money count as used", async () => {
  // An all-null production row is structure, not an economic the rate touches.
  // Counting it would replace one wrong number with a different wrong number.
  const src = await code("src/app/actions/markup-defaults.ts");
  assert.match(src, /PRODUCTION_VALUE_PRESENT/);
  assert.match(src, /testingMicrosTotal/);
});

// ── the Direct Service must reach the ENGINE, not only the Costs surface ──

test("the costing bundle loads BOTH production owner branches", async () => {
  // Operator-found V1 blocker. `getCostingBundle`'s loader inner-joined
  // `assemblies`, so a service-owned production row — which carries a
  // quote_leaf_id and no assembly — never reached the math.
  //
  // The symptom was not a missing line. The service still appeared in
  // skuRollups as a leaf priced at 0, so the customer PDF rendered a
  // `Formulation` row reading "quote on request" and EXCLUDED it from the
  // turnkey total, for a cost the operator had entered and could see on Costs.
  //
  // Fourth instance of NULL-matches-nothing in this slice, and the only one
  // where a write succeeded, displayed, and then failed to reach the
  // arithmetic — which is worse than being refused, because nothing looked
  // wrong at the point of entry.
  const src = await code("src/app/actions/costing.ts");
  assert.doesNotMatch(
    src,
    /from\(assemblyProductionInputs\)\s*\.innerJoin/,
    "the engine's production loader still inner-joins assemblies",
  );
  assert.match(src, /eq\(quoteLeaves\.quoteId, quoteId\)/);
});

test("a top-level service prices at cost x the governed Production markup", async () => {
  // The commercial semantics, asserted rather than assumed from a screenshot:
  // sell = (fee / tier qty) x (1 + Production), with no packaging cost
  // involved and no Item Group anywhere.
  const { computeQuoteCosting } = await import("../../src/lib/costing.ts");
  const LEAF = "svc-leaf";
  const TIER = "tier-1";
  const QTY = 1000;
  const FEE = 123454;
  const RATE = 0.4;

  const r = computeQuoteCosting({
    quote: { id: "q", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: RATE, Other: 0.99 },
    skus: [
      {
        id: LEAF,
        parentSkuId: null,
        qtyPerParent: null,
        skuRole: "leaf",
        skuLabel: "SVC-FORMULATION",
        productName: "Formulation",
        unitsPerPack: 1,
    multiplicityPerUnit: null,
        cbmPerUnit: null,
        dutyPct: null,
        tariffPct: null,
      },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: QTY, tierPriceAdjPct: null }],
    packaging: [],
    production: [
      {
        quoteSkuId: LEAF,
        tierId: TIER,
        allocateServiceFeesToCost: true,
        fillingBlendingCost: null,
        cmAssemblyTotal: null,
        setupFeeTotal: null,
        toolingArtworkTotal: null,
        rdTotal: FEE,
        otherServiceTotal: null,
        bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    freight: [],
    freightLegs: [],
    freightLegTiers: [],
    freightLegGroups: [],
    cellOverrides: [],
    cellTargets: [],
  } as never);

  const rollup = r.skuRollups.find((x) => x.skuLabel === "SVC-FORMULATION");
  assert.ok(rollup, "the service produced no rollup");
  const cell = rollup!.perTier.find((p) => p.tierId === TIER);
  const expected = (FEE / QTY) * (1 + RATE);
  assert.ok(
    Math.abs((cell?.requiredSellPerUnit ?? 0) - expected) < 1e-9,
    `expected ${expected}, got ${cell?.requiredSellPerUnit}`,
  );
  // And nowhere near the trap rate sitting in `Other`.
  assert.ok(Math.abs((cell?.requiredSellPerUnit ?? 0) - (FEE / QTY) * 1.99) > 1);
});
