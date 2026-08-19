import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BV011_DESTINATIONS,
  LEGACY_COMBINED_OTC_COLUMN,
  OTC_COLUMN_DESTINATION,
  SERVICE_IDENTITY_DESTINATION,
  bv011ItemType,
  isPerLineDestination,
} from "../../src/lib/netsuite/bv011-destinations.ts";
import { projectCommercial } from "../../src/lib/commercial-projection.ts";
import type { QuoteCostingResult } from "../../src/lib/costing.ts";
import type { HydrateSnapshot } from "../../src/lib/costing-store.ts";

// ═══════════════════════════════════════════════════════════════════════
// The Tooling / Artwork split and the BV-011 destination model.
//
// The load-bearing claim is NEGATIVE: a legacy combined charge must not be
// assigned a destination, must not be silently dropped, and must not have its
// customer-facing amount changed. All three failure modes are quiet, so each
// gets an assertion that fails when the property is absent.
// ═══════════════════════════════════════════════════════════════════════

const TIER_A = "11111111-1111-1111-1111-111111111111";
const TIER_B = "22222222-2222-2222-2222-222222222222";

function bundle(production: Array<Record<string, unknown>>): HydrateSnapshot {
  const tiers: QuoteCostingResult["tiers"] = [
    { tierId: TIER_A, label: "Tier 1", qty: 1000 },
    { tierId: TIER_B, label: "Tier 2", qty: 5000 },
  ];
  return {
    markupDefaults: { Production: 0.4 },
    skus: [
      { id: "asm", parentSkuId: null, skuRole: "assembly", skuLabel: "IG", productName: "Group", canonicalQuoteLeafId: "asm", qtyPerParent: null, sortOrder: 0, retailBenchmark: null },
      { id: "leaf", parentSkuId: "asm", skuRole: "leaf", skuLabel: "L", productName: "Leaf", canonicalQuoteLeafId: "leaf", qtyPerParent: "1", sortOrder: 0, retailBenchmark: null },
    ],
    production,
    costing: {
      tiers,
      skuRollups: [
        {
          skuId: "leaf",
          canonicalQuoteLeafId: "leaf",
          skuRole: "leaf",
          parentSkuId: "asm",
          skuLabel: "L",
          productName: "Leaf",
          qtyPerParent: "1",
          perTier: [
            { tierId: TIER_A, requiredSellPerUnit: 1, contributionCostPerUnit: 0.5 },
            { tierId: TIER_B, requiredSellPerUnit: 1, contributionCostPerUnit: 0.5 },
          ],
        },
      ],
    },
  } as unknown as HydrateSnapshot;
}

const prod = (tierId: string, extra: Record<string, unknown>) => ({
  quoteSkuId: "leaf",
  tierId,
  allocateServiceFeesToCost: false,
  ...extra,
});

// ── the catalogue ────────────────────────────────────────────────────────

test("BV-011 catalogue is complete and matches the document's own count", () => {
  assert.equal(BV011_DESTINATIONS.length, 16);
  const inventory = BV011_DESTINATIONS.filter((d) => d.itemType === "inventory");
  // BV-011 states the split explicitly: "6 Inventory Item, 10 Non-inventory".
  assert.equal(inventory.length, 6, "six Inventory destinations");
  assert.equal(BV011_DESTINATIONS.length - inventory.length, 10);
  assert.equal(new Set(BV011_DESTINATIONS.map((d) => d.key)).size, 16, "keys unique");
});

test("Tooling and Artwork are separate destinations with DIFFERENT item types", () => {
  // This is the entire reason the input had to be split. If these ever agree,
  // the split's justification is gone and someone should be told.
  assert.equal(bv011ItemType("otc_tooling"), "inventory");
  assert.equal(bv011ItemType("otc_artwork"), "non_inventory");
  assert.notEqual(bv011ItemType("otc_tooling"), bv011ItemType("otc_artwork"));
});

test("the legacy combined column has NO destination, and that absence is deliberate", () => {
  assert.ok(
    !(LEGACY_COMBINED_OTC_COLUMN in OTC_COLUMN_DESTINATION),
    "no entry can be correct for a column spanning two destinations of different item types",
  );
  // …while both of its governed successors do have one.
  assert.equal(OTC_COLUMN_DESTINATION.toolingTotal, "otc_tooling");
  assert.equal(OTC_COLUMN_DESTINATION.artworkTotal, "otc_artwork");
});

test("rd_total and the formulation service resolve to the SAME destination", () => {
  // The measurement that made destination-keying the right shape: two economic
  // sources, one NetSuite item. Under source-keying this was two mapping rows
  // free to drift apart.
  assert.equal(OTC_COLUMN_DESTINATION.rdTotal, "otc_formulation");
  assert.equal(SERVICE_IDENTITY_DESTINATION.formulation, "otc_formulation");
});

test("Other Service is per-line and no other destination is", () => {
  const perLine = BV011_DESTINATIONS.filter((d) => isPerLineDestination(d.key));
  assert.deepEqual(perLine.map((d) => d.key), ["otc_other_service"]);
});

// ── the projection ───────────────────────────────────────────────────────

test("Tooling and Artwork project as SEPARATE lines carrying their own destinations", () => {
  const p = projectCommercial(
    bundle([
      prod(TIER_A, { toolingTotal: 1000, artworkTotal: 500 }),
      prod(TIER_B, { toolingTotal: 1000, artworkTotal: 500 }),
    ]),
  );
  const tooling = p.lines.find((l) => l.displayName === "Tooling");
  const artwork = p.lines.find((l) => l.displayName === "Artwork");
  assert.ok(tooling && artwork, "two distinct lines, not one combined");
  assert.equal(tooling.bv011Destination, "otc_tooling");
  assert.equal(artwork.bv011Destination, "otc_artwork");
  // Marked up at the governed Production rate, like every other OTC line.
  assert.equal(p.tiers[0].otcSubtotal, 1000 * 1.4 + 500 * 1.4);
});

test("a legacy combined charge still bills the customer, and carries NO destination", () => {
  const p = projectCommercial(
    bundle([
      prod(TIER_A, { toolingArtworkTotal: 1000 }),
      prod(TIER_B, { toolingArtworkTotal: 1000 }),
    ]),
  );
  const legacy = p.lines.find((l) => l.displayName === "Tooling & artwork");
  assert.ok(legacy, "the line the customer was quoted is still produced");

  // Both halves matter. Dropping the line would silently change what a draft
  // quote prices; assigning it a destination would guess an accounting class.
  assert.equal(p.tiers[0].otcSubtotal, 1400, "the customer amount is unchanged");
  assert.equal(
    legacy.bv011Destination,
    null,
    "no rule can say whether this is Tooling, Artwork, or both",
  );
});

test("the legacy line's customer-facing copy is untouched by the split", () => {
  const p = projectCommercial(bundle([prod(TIER_A, { toolingArtworkTotal: 1000 })]));
  const legacy = p.lines.find((l) => l.bv011Destination === null && l.kind === "otc");
  assert.ok(legacy);
  // Re-wording it would move customer-facing text for an accounting change.
  assert.equal(legacy.displayName, "Tooling & artwork");
  assert.equal(legacy.displaySub, "One-time tooling + artwork.");
});

test("a quote can carry the legacy charge AND the split ones at once", () => {
  // The migration does not force resolution, so a quote mid-resolution is a
  // real state and must price correctly rather than double-count or drop.
  const p = projectCommercial(
    bundle([prod(TIER_A, { toolingArtworkTotal: 100, toolingTotal: 200, artworkTotal: 300 })]),
  );
  const otc = p.lines.filter((l) => l.kind === "otc");
  assert.equal(otc.length, 3);
  assert.equal(p.tiers[0].otcSubtotal, (100 + 200 + 300) * 1.4);
  assert.equal(
    otc.filter((l) => l.bv011Destination === null).length,
    1,
    "exactly the legacy one blocks",
  );
});

// ── economics are untouched by the split ─────────────────────────────────

test("splitting the input changes no economics — the same money, three columns", () => {
  const combined = projectCommercial(bundle([prod(TIER_A, { toolingArtworkTotal: 900 })]));
  const split = projectCommercial(
    bundle([prod(TIER_A, { toolingTotal: 600, artworkTotal: 300 })]),
  );
  assert.equal(
    split.tiers[0].tierCommercialTotal,
    combined.tiers[0].tierCommercialTotal,
    "where a fee is split, the customer pays exactly what they paid before",
  );
});

// ── structural: the freeze and the blocker ───────────────────────────────

test("the freeze persists the destination rather than re-deriving it later", async () => {
  const freeze = await readFile("src/lib/commercial-freeze.ts", "utf8");
  assert.match(freeze, /bv011Destination: line\.bv011Destination/);
  const readiness = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  // Re-deriving would mean matching display copy, and a copy change would then
  // repoint an accounting destination.
  assert.doesNotMatch(
    readiness,
    /displayName === "|displayName\.includes/,
    "readiness must key on the persisted destination, never on display copy",
  );
});

test("readiness names a remediation for every blocker kind it can return", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");

  // Declared kinds and constructed kinds are counted SEPARATELY. A single
  // regex over both conflates the type union with the object literals — and
  // `no_frozen_matrix` is legitimately constructed twice — so comparing raw
  // counts measures nothing.
  // Declaration vs construction is decided by the PUNCTUATION, not by
  // indentation — two union members are written inline and an anchored
  // whitespace pattern silently missed them.
  const declared = new Set(
    [...src.matchAll(/kind: "([a-z_]+)";/g)].map((m) => m[1]),
  );
  const constructed = [...src.matchAll(/kind: "([a-z_]+)",/g)].map((m) => m[1]);

  assert.ok(declared.size >= 6, `expected the full union, saw ${declared.size}`);
  for (const kind of declared) {
    assert.ok(
      constructed.includes(kind),
      `blocker kind "${kind}" is declared but never constructed — dead state`,
    );
  }

  // A blocker without a remediation is an operator dead end.
  const withRemediation = [
    ...src.matchAll(/kind: "[a-z_]+",[\s\S]{0,900}?remediation:/g),
  ];
  assert.equal(
    withRemediation.length,
    constructed.length,
    "every constructed blocker carries a remediation",
  );
});

test("an unmapped destination BLOCKS rather than being skipped", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  // The dangerous alternative is a `continue` that omits the line: the order
  // would then be short AND reconcile to its own short sum.
  assert.match(src, /if \(!mapped\.has\(line\.destination\)\) \{[\s\S]{0,200}blockers\.push/);
});

test("the admin surface cannot store a firm-wide record for a per-line destination", async () => {
  const src = await readFile("src/app/actions/netsuite-destination-map.ts", "utf8");
  assert.match(src, /isPerLineDestination\(known\.key\)[\s\S]{0,300}ActionGuardError/);
  // Refused, not accepted-and-ignored: a stored default would silently win over
  // the per-line selection.
  assert.match(src, /no firm-wide NetSuite item by design/);
});
