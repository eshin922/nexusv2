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
  // BV-011 states the split explicitly: "5 Inventory Item, 11 Non-inventory".
  // Was 6/10 until 2026-08-20, when Accounting governed Pack-out / Assembly as
  // a non-inventory SERVICE item. The count is mirrored here on purpose: it is
  // how a silent drift between the document and the catalogue gets caught.
  assert.equal(inventory.length, 5, "five Inventory destinations");
  assert.equal(BV011_DESTINATIONS.length - inventory.length, 11);
  assert.equal(new Set(BV011_DESTINATIONS.map((d) => d.key)).size, 16, "keys unique");
});

test("Tooling and Artwork are separate destinations with DIFFERENT item types", () => {
  // This is the entire reason the input had to be split. If these ever agree,
  // the split's justification is gone and someone should be told.
  assert.equal(bv011ItemType("otc_tooling"), "inventory");
  assert.equal(bv011ItemType("otc_artwork"), "non_inventory");
  assert.notEqual(bv011ItemType("otc_tooling"), bv011ItemType("otc_artwork"));
});

test("Pack-out / Assembly is a NON-INVENTORY service item, and routes to otc_packout", () => {
  // AMENDED 2026-08-20. Pack-out is billed as a service, so its NetSuite item
  // is non-inventory. Pinned as an assertion because the previous value —
  // "inventory" — was recorded before any item existed to check it against and
  // no real OTC fee item could have satisfied it: a sandbox census found 67
  // OTC-coded items, all NonInvtPart.
  assert.equal(bv011ItemType("otc_packout"), "non_inventory");

  // The destination key did NOT change. Accounting named the ITEM "OTC -
  // Assembly"; that is the NetSuite item's name, not a new Nexus destination.
  // An `otc_assembly` key would split one governed destination into two.
  assert.equal(SERVICE_IDENTITY_DESTINATION.packout_assembly, "otc_packout");
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

test("per-line is a closed, governed allowlist — currently Other Service and Testing", () => {
  const perLine = BV011_DESTINATIONS.filter((d) => isPerLineDestination(d.key));
  // Exact, not a superset check. A destination becoming per-line is an
  // Accounting disposition, so it must never happen as a side effect.
  assert.deepEqual(perLine.map((d) => d.key), ["otc_testing", "otc_other_service"]);
});

test("a per-line destination reachable as an OTC FEE COLUMN would break the keying", () => {
  // `quote_other_service_items` is keyed by owner — (quote, assembly XOR leaf)
  // — with no destination discriminator, so one owner can hold ONE selection.
  //
  // A Direct Service leaf carries exactly one identity and therefore exactly
  // one destination, so a per-line destination reached that way is safe. A
  // per-line destination reached as an OTC fee column is NOT: one assembly
  // could carry two per-line fees and need two rows.
  //
  // This asserts the currently-safe state rather than the intention. If it
  // fails, the migration described in `bv011-destinations.ts` is due BEFORE
  // the destination is added to the set.
  const perLineOtcColumns = (
    Object.keys(OTC_COLUMN_DESTINATION) as Array<keyof typeof OTC_COLUMN_DESTINATION>
  ).filter((c) => isPerLineDestination(OTC_COLUMN_DESTINATION[c]));
  assert.deepEqual(
    perLineOtcColumns,
    ["otherServiceTotal"],
    "more than one per-line OTC fee column means one assembly can need two " +
      "selections; quote_other_service_items needs a destination column first",
  );
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
  // Declarations live in `projection-readiness`; the two product kinds are
  // CONSTRUCTED in `frozen-sales-order`, where SKU resolution happens. The
  // union is deliberately shared, so scanning one file would report a real
  // construction as a dead state.
  const readiness = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  const builder = await readFile("src/lib/netsuite/frozen-sales-order.ts", "utf8");
  const src = readiness + "\n" + builder;

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
  // The dangerous alternative is falling through and emitting the line
  // anyway: the order would be short AND reconcile to its own short sum. So
  // the branch must both RECORD a blocker and STOP.
  assert.match(
    src,
    /if \(!mapping\) \{[\s\S]{0,400}blockers\.push\(\{[\s\S]{0,400}continue;/,
  );
});

test("the admin surface cannot store a firm-wide record for a per-line destination", async () => {
  const src = await readFile("src/app/actions/netsuite-destination-map.ts", "utf8");
  assert.match(src, /isPerLineDestination\(known\.key\)[\s\S]{0,300}ActionGuardError/);
  // Refused, not accepted-and-ignored: a stored default would silently win over
  // the per-line selection.
  assert.match(src, /no firm-wide NetSuite item by design/);
});

// ── a null destination means two different things ────────────────────────

test("only the legacy combined line is marked legacyUnresolved", () => {
  const p = projectCommercial(
    bundle([
      prod(TIER_A, { toolingArtworkTotal: 100, toolingTotal: 200, setupFeeTotal: 50 }),
    ]),
  );
  const flagged = p.lines.filter((l) => l.legacyUnresolved);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].displayName, "Tooling & artwork");
  // Every other OTC line has a destination AND is not legacy.
  for (const l of p.lines.filter((x) => x.kind === "otc" && !x.legacyUnresolved)) {
    assert.notEqual(l.bv011Destination, null, `${l.displayName} must carry a destination`);
  }
});

test("readiness distinguishes legacy-combined from destination-not-recorded", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");

  // The defect this guards: every frozen line predating the destination column
  // has a null destination, so keying "legacy" off null told an operator to
  // resolve a Direct Service into Tooling and Artwork inputs.
  assert.match(
    src,
    /if \(line\.legacyUnresolved\) \{/,
    "legacy is read from the row's own statement, not inferred from a null",
  );
  assert.match(src, /kind: "destination_not_recorded"/);

  // And the legacy branch must be tested BEFORE the null branch, or a legacy
  // line with a null destination falls into the wrong one.
  assert.ok(
    src.indexOf("if (line.legacyUnresolved)") <
      src.indexOf("if (destination === null)"),
    "the explicit statement is checked before the ambiguous null",
  );
});

test("a Direct Service frozen without a destination derives one from its identity", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  // Its identity is governed and frozen on the row, and BV-011 fixes the
  // identity's destination — so deriving is reading the same governed map,
  // not guessing. Blocking it instead would strand a resolvable line.
  assert.match(src, /line\.destination \?\?[\s\S]{0,120}SERVICE_IDENTITY_DESTINATION\[line\.serviceIdentity\]/);
});

// ── per-line Other Service selection ─────────────────────────────────────

test("an Other Service line carries its per-line selection; nothing else does", () => {
  const withSelection = {
    ...bundle([prod(TIER_A, { otherServiceTotal: 500, setupFeeTotal: 100 })]),
    otherServiceItems: [
      {
        assemblyId: "asm",
        quoteLeafId: null,
        netsuiteItemCode: "SVC-MISC",
        netsuiteInternalId: "9911",
      },
    ],
  } as unknown as HydrateSnapshot;
  const p = projectCommercial(withSelection);

  const other = p.lines.find((l) => l.bv011Destination === "otc_other_service")!;
  assert.deepEqual(other.selectedNetsuiteItem, {
    code: "SVC-MISC",
    internalId: "9911",
  });

  // Every other destination resolves from the FIRM mapping at push, so a
  // per-line selection on one would be a second, competing source.
  const setup = p.lines.find((l) => l.bv011Destination === "otc_setup")!;
  assert.equal(setup.selectedNetsuiteItem, null);
});

test("with no selection the Other Service line is present but unresolved", () => {
  const p = projectCommercial(bundle([prod(TIER_A, { otherServiceTotal: 500 })]));
  const other = p.lines.find((l) => l.bv011Destination === "otc_other_service")!;
  // Present and priced — the customer is charged either way. Only the
  // ACCOUNTING destination is unresolved, which is what blocks the push.
  assert.equal(other.cells[0].state, "priced");
  assert.equal(other.selectedNetsuiteItem, null);
});

test("readiness accepts a frozen selection and refuses its absence", async () => {
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  // Blocks only when the FROZEN selection is missing — an earlier version
  // blocked every per-line destination unconditionally, which would have kept
  // the push refused even after an operator chose an item.
  assert.match(
    src,
    /const selected = [\s\S]{0,120}if \(selected === ""\) \{[\s\S]{0,500}per_line_destination_unresolved/,
  );
  // …and RESOLVES when one is present, rather than blocking unconditionally.
  // An earlier version refused every per-line destination outright, which kept
  // the push blocked even after an operator had chosen an item.
  assert.match(src, /netsuiteItemId: selected,/);
});

test("the selection is draft-only, because it is frozen at send", async () => {
  const src = await readFile("src/app/actions/other-service-item.ts", "utf8");
  assert.match(src, /status !== "draft"/);
  assert.match(src, /frozen at send/);
  // And it resolves through the SAME resolver the admin surface uses. A second
  // resolver would be a second answer to "which item is this" (Pattern 58).
  assert.match(src, /netsuite\.resolveItem\(itemCode\)/);
  assert.match(src, /status === "ambiguous"/);
});

// ── the Costs picker gate (Case 0, Decision 5) ───────────────────────────

test("the Direct Service picker is gated on the PREDICATE, not an identity literal", async () => {
  const src = await readFile(
    "src/components/costs/direct-service-production.tsx",
    "utf8",
  );
  // The control must be offered exactly where the push will REQUIRE a
  // selection. Keying it on anything but the governed predicate lets the two
  // drift — offering a selection the push ignores, or withholding one it needs.
  assert.match(
    src,
    /isPerLineDestination\(\s*SERVICE_IDENTITY_DESTINATION\[svc\.serviceIdentity\],?\s*\)/,
  );
  assert.doesNotMatch(src, /serviceIdentity === "other_service"/);
  assert.doesNotMatch(src, /serviceIdentity === "testing_micros"/);
  // Draft-only: the picker is disabled the moment the quote leaves draft.
  assert.match(src, /disabled=\{!editable\}/);
});

test("the picker is NOT generalized to destinations that cannot originate a line", async () => {
  // Dies, Samples, Cartons and Print Plates have no fee column and no service
  // identity, so no quote line can carry them. A selector for them would be a
  // control over nothing, and this fails if one appears before the economics do.
  const unreachable = ["otc_dies", "otc_samples", "otc_cartons", "otc_print_plates"] as const;
  for (const d of unreachable) {
    assert.equal(isPerLineDestination(d), false, `${d} became per-line without quote-line economics`);
  }
});
