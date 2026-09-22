/**
 * The M2 Costs read model.
 *
 * WHAT THESE ESTABLISH, and why each is here rather than assumed:
 *
 *   * OWNER IDENTITY — standalone products, services, group members, groups.
 *     Cost rows key on `quote_leaf_id` while the assembly tree keys on
 *     `assembly_leaves.id`. Both are strings, so a model that joined on the
 *     wrong one compiles and renders every row under the wrong name. Only an
 *     assertion on identity can catch it; totals cannot.
 *   * ALL TIERS — a row's cells cover every quoted tier, unsummed.
 *   * UNPRICED AND UNEQUAL — a charge with no amounts, and a charge whose tier
 *     amounts differ, both survive intact. Ten of twelve product-owned charges
 *     measured on the configured database carry unequal amounts.
 *   * REPEATED LABELS — two charges of one type on one component stay two.
 *   * NO ARITHMETIC — the model publishes no total, no extension, no markup
 *     application. This is asserted structurally rather than trusted.
 *   * NOTHING DROPPED — a charge whose owner the structure read did not return
 *     is REPORTED, not swallowed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCostsOverview,
  flattenOwners,
  focusableOwners,
  type CostsOverviewFacts,
  type OverviewPackagingRowFact,
} from "../../src/lib/costs/costs-overview-model.ts";
import type { ComponentChargeForCosts } from "../../src/lib/component-charges/read.ts";
import type { ComponentChargeReadiness } from "../../src/lib/component-charges/readiness.ts";

const T1 = "tier-1";
const T2 = "tier-2";

const TIERS = [
  { id: T1, label: "Tier 1", qty: 10_000 },
  { id: T2, label: "Tier 2", qty: 25_000 },
];

function pkg(
  over: Partial<OverviewPackagingRowFact> & {
    quoteLeafId: string;
    tierId: string;
    lineGroupId: string;
  },
): OverviewPackagingRowFact {
  return {
    id: `${over.lineGroupId}:${over.tierId}`,
    sortOrder: 0,
    pricingVendorNameSnapshot: null,
    supplier: null,
    qtyPerSellableUnit: "1",
    category: "Primary",
    markupPct: null,
    markupPctSource: null,
    inventoryEligible: false,
    notes: null,
    unitCost: null,
    ...over,
  };
}

function readiness(
  over: Partial<ComponentChargeReadiness> & { chargeInstanceId: string },
): ComponentChargeReadiness {
  return {
    chargeKey: "print_plates",
    label: "Print plates",
    ownLabel: null,
    quoteLeafId: "leaf-a",
    state: "complete",
    missingTierIds: [],
    missingTierLabels: [],
    ...over,
  };
}

function emptyFacts(): CostsOverviewFacts {
  return {
    tiers: TIERS,
    assemblies: [],
    members: [],
    directProducts: [],
    directServices: [],
    packagingRows: [],
    groupProductionRows: [],
    componentCharges: [],
    chargeReadiness: [],
  };
}

// ── Owner identity ─────────────────────────────────────────────────────────

test("every supported owner kind crosses with its canonical identity", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    assemblies: [{ id: "asy-1", sku: "ASY-1", name: "Multi gummies", position: 0 }],
    members: [
      {
        assemblyLeafId: "al-1",
        assemblyId: "asy-1",
        quoteLeafId: "ql-member",
        name: "Gummy jar",
        sku: "DPS-1007",
        quantity: "2",
        position: 0,
        productType: "Turnkey",
      },
    ],
    directProducts: [
      {
        quoteLeafId: "ql-direct",
        name: "Silicone lubricant",
        sku: "DPS-1003",
        quantity: "1",
        position: 0,
        productType: "Raw ingredients",
      },
    ],
    directServices: [
      {
        quoteLeafId: "ql-service",
        name: "Micro testing",
        serviceIdentity: "testing_micros",
        position: 1,
        amountsByTier: { [T1]: "250.00", [T2]: null },
      },
    ],
  });

  const flat = flattenOwners(overview.owners);
  assert.deepEqual(
    flat.map((e) => [e.owner.kind, e.owner.quoteLeafId, e.depth]),
    [
      // An Item Group owns NO cost row, so it carries no cost-input identity.
      // Coercing a member's id in here is what put a group's economics on one
      // of its components.
      ["item_group", null, 0],
      ["group_member", "ql-member", 1],
      ["direct_product", "ql-direct", 0],
      ["direct_service", "ql-service", 0],
    ],
  );
  const group = overview.owners[0];
  assert.equal(group.assemblyId, "asy-1");
  assert.equal(group.members[0].quantity, "2", "membership quantity is preserved");
  assert.equal(group.members[0].productType, "Turnkey", "recorded type is source data");
});

test("a packaging line binds to the owner that carries its quote_leaf_id", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    assemblies: [{ id: "asy-1", sku: "ASY-1", name: "Group", position: 0 }],
    members: [
      {
        assemblyLeafId: "al-1",
        assemblyId: "asy-1",
        // The junction id and the cost identity are DIFFERENT values. A model
        // keyed on the junction would find no line and render an empty owner.
        quoteLeafId: "ql-member",
        name: "Bottle",
        sku: "B-1",
        quantity: "1",
        position: 0,
        productType: null,
      },
    ],
    packagingRows: [
      pkg({ quoteLeafId: "ql-member", tierId: T1, lineGroupId: "lg-1", unitCost: "1.1100" }),
      pkg({ quoteLeafId: "ql-member", tierId: T2, lineGroupId: "lg-1", unitCost: "2.2200" }),
    ],
  });
  const member = overview.owners[0].members[0];
  assert.equal(member.recurringLines.length, 1);
  assert.equal(member.recurringLines[0].cells.get(T1)?.unitCost, "1.1100");
  assert.equal(overview.gaps.length, 0);
});

test("packaging markup category follows Setup Product Type over a stale line category", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      {
        quoteLeafId: "ql-product",
        name: "Printed carton",
        sku: "C-1",
        quantity: "1",
        position: 0,
        productType: "Labels",
      },
    ],
    packagingRows: [
      pkg({
        quoteLeafId: "ql-product",
        tierId: T1,
        lineGroupId: "lg-product",
        category: "primary_packaging",
      }),
    ],
  });
  assert.equal(
    overview.owners[0].recurringLines[0].category,
    "Labels",
    "the raw HubSpot Product Type is the Settings category authority",
  );
});

// ── All tiers, blanks vs zero ──────────────────────────────────────────────

test("a line carries every quoted tier, and a blank is not a zero", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    packagingRows: [
      pkg({ quoteLeafId: "ql-1", tierId: T1, lineGroupId: "lg-1", unitCost: "0" }),
      pkg({ quoteLeafId: "ql-1", tierId: T2, lineGroupId: "lg-1", unitCost: null }),
    ],
  });
  const cells = overview.owners[0].recurringLines[0].cells;
  assert.equal(cells.size, 2);
  // A STATED zero and NO STATED COST are different facts and stay different.
  assert.equal(cells.get(T1)?.unitCost, "0");
  assert.equal(cells.get(T2)?.unitCost, null);
});

test("one logical line spans its tier rows rather than becoming two lines", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    packagingRows: [
      pkg({
        quoteLeafId: "ql-1",
        tierId: T1,
        lineGroupId: "lg-1",
        sortOrder: 1,
        supplier: "Acme",
        category: "Secondary",
      }),
      pkg({
        quoteLeafId: "ql-1",
        tierId: T2,
        lineGroupId: "lg-1",
        sortOrder: 1,
        supplier: "Acme",
        category: "Secondary",
      }),
      pkg({ quoteLeafId: "ql-1", tierId: T1, lineGroupId: "lg-0", sortOrder: 0 }),
    ],
  });
  const lines = overview.owners[0].recurringLines;
  assert.equal(lines.length, 2, "two line groups, not three tier rows");
  assert.deepEqual(lines.map((l) => l.lineGroupId), ["lg-0", "lg-1"], "sorted by sortOrder");
  assert.equal(lines[1].vendor, "Acme");
  assert.equal(lines[1].category, "Secondary");
});

// ── Charges: unpriced, unequal, repeated ───────────────────────────────────

test("an unpriced charge is present, with no tier amounts and its state named", () => {
  const charge: ComponentChargeForCosts = {
    chargeInstanceId: "ci-1",
    quoteLeafId: "ql-1",
    chargeKey: "print_plates",
    label: null,
    toolingClassification: null,
    // The LEFT JOIN in the reader preserves the instance with no economics.
    amounts: [],
  };
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    componentCharges: [charge],
    chargeReadiness: [
      readiness({
        chargeInstanceId: "ci-1",
        quoteLeafId: "ql-1",
        state: "none",
        missingTierIds: [T1, T2],
        missingTierLabels: ["Tier 1", "Tier 2"],
      }),
    ],
  });
  const c = overview.owners[0].charges[0];
  assert.equal(c.amounts.size, 0, "no tier row means no amount, not a zero");
  assert.equal(c.state, "none");
  assert.deepEqual(c.missingTierLabels, ["Tier 1", "Tier 2"]);
});

test("unequal historical tier amounts survive, and equal ones are not collapsed", () => {
  const unequal: ComponentChargeForCosts = {
    chargeInstanceId: "ci-unequal",
    quoteLeafId: "ql-1",
    chargeKey: "tooling",
    label: null,
    toolingClassification: "cutting_die",
    amounts: [
      { tierId: T1, cost: "1200.00", recoveryAsk: null },
      { tierId: T2, cost: "900.00", recoveryAsk: "950.00" },
    ],
  };
  const equal: ComponentChargeForCosts = {
    chargeInstanceId: "ci-equal",
    quoteLeafId: "ql-1",
    chargeKey: "print_plates",
    label: null,
    toolingClassification: null,
    amounts: [
      { tierId: T1, cost: "1000.00", recoveryAsk: null },
      { tierId: T2, cost: "1000.00", recoveryAsk: null },
    ],
  };
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    componentCharges: [unequal, equal],
    chargeReadiness: [
      readiness({ chargeInstanceId: "ci-unequal", quoteLeafId: "ql-1" }),
      readiness({ chargeInstanceId: "ci-equal", quoteLeafId: "ql-1" }),
    ],
  });
  const charges = overview.owners[0].charges;
  assert.equal(charges[0].amounts.get(T1)?.cost, "1200.00");
  assert.equal(charges[0].amounts.get(T2)?.cost, "900.00");
  assert.equal(charges[0].amounts.get(T2)?.recoveryAsk, "950.00");
  assert.equal(charges[0].toolingClassification, "cutting_die");

  // THE EQUAL ONE IS STILL TWO PER-TIER AMOUNTS. There is no stored shared-mode
  // intent to read, so equality is a coincidence of history and must not become
  // a single "all tiers" amount — that is M4/M5 behaviour with its own state.
  assert.equal(charges[1].amounts.size, 2);
  assert.equal(charges[1].amounts.get(T1)?.cost, "1000.00");
  assert.equal(charges[1].amounts.get(T2)?.cost, "1000.00");
  assert.ok(
    !Object.keys(charges[1]).some((k) => /shared|mode/i.test(k)),
    "the model publishes no shared-mode field to infer one into",
  );
});

test("two charges of one type on one component stay two", () => {
  const mk = (id: string, label: string | null): ComponentChargeForCosts => ({
    chargeInstanceId: id,
    quoteLeafId: "ql-1",
    chargeKey: "tooling",
    label,
    toolingClassification: null,
    amounts: [{ tierId: T1, cost: "500.00", recoveryAsk: null }],
  });
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    // Deliberately: same type, same owner, one labelled and one not. Identity
    // is the INSTANCE; a model keyed by type would make the second unreachable.
    componentCharges: [mk("ci-1", "Cavity A"), mk("ci-2", null)],
    chargeReadiness: [
      readiness({ chargeInstanceId: "ci-1", quoteLeafId: "ql-1" }),
      readiness({ chargeInstanceId: "ci-2", quoteLeafId: "ql-1" }),
    ],
  });
  const charges = overview.owners[0].charges;
  assert.equal(charges.length, 2);
  assert.deepEqual(charges.map((c) => c.chargeInstanceId), ["ci-1", "ci-2"]);
  assert.deepEqual(charges.map((c) => c.ownLabel), ["Cavity A", null]);
  // The PRODUCTION registry's label, not the design bundle's operator copy
  // ("Tooling requirement"). The data contract is explicit that no enum key was
  // introduced and that a fee "uses its production label"; a preview that
  // relabelled a charge would make the two surfaces look like different records.
  assert.deepEqual(
    charges.map((c) => c.typeLabel),
    ["Tooling & dies", "Tooling & dies"],
    "both keep the type label; neither is renamed to disambiguate",
  );
});

// ── Nothing is dropped ─────────────────────────────────────────────────────

test("a charge whose owner is not in the structure is reported, not dropped", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    componentCharges: [
      {
        chargeInstanceId: "ci-orphan",
        quoteLeafId: "ql-missing",
        chargeKey: "tooling",
        label: null,
        toolingClassification: null,
        amounts: [{ tierId: T1, cost: "10.00", recoveryAsk: null }],
      },
    ],
    chargeReadiness: [
      readiness({ chargeInstanceId: "ci-orphan", quoteLeafId: "ql-missing" }),
    ],
  });
  assert.equal(overview.owners[0].charges.length, 0);
  assert.equal(overview.unplacedCharges.length, 1);
  assert.equal(overview.unplacedCharges[0].chargeInstanceId, "ci-orphan");
  assert.equal(overview.gaps[0].code, "charge_owner_not_in_quote_structure");
  assert.match(overview.gaps[0].detail, /ql-missing/);
});

test("a charge with no readiness entry reports unknown rather than complete", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    componentCharges: [
      {
        chargeInstanceId: "ci-1",
        quoteLeafId: "ql-1",
        chargeKey: "tooling",
        label: null,
        toolingClassification: null,
        amounts: [],
      },
    ],
    chargeReadiness: [],
  });
  assert.equal(overview.owners[0].charges[0].state, "unknown");
  assert.equal(overview.gaps[0].code, "charge_readiness_missing");
});

test("packaging rows whose owner is missing are reported", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    packagingRows: [pkg({ quoteLeafId: "ql-gone", tierId: T1, lineGroupId: "lg-1" })],
  });
  assert.equal(overview.gaps.length, 1);
  assert.equal(overview.gaps[0].code, "packaging_row_owner_not_in_quote_structure");
});

// ── Production and services ────────────────────────────────────────────────

test("Item Group production shows only fields that hold a value, under the module's own names", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    assemblies: [{ id: "asy-1", sku: "A", name: "Group", position: 0 }],
    groupProductionRows: [
      {
        id: "p1",
        assemblyId: "asy-1",
        tierId: T1,
        allocateServiceFeesToCost: true,
        fillingBlendingCost: "3000.00",
        cmAssemblyTotal: null,
        bulkRawCost: null,
        setupFeeTotal: null,
        toolingArtworkTotal: null,
        toolingTotal: null,
        artworkTotal: null,
        rdTotal: null,
        testingMicrosTotal: null,
        otherServiceTotal: null,
        actualUnitsProduced: null,
      },
      {
        id: "p2",
        assemblyId: "asy-1",
        tierId: T2,
        allocateServiceFeesToCost: true,
        fillingBlendingCost: "7000.00",
        cmAssemblyTotal: null,
        bulkRawCost: null,
        setupFeeTotal: null,
        toolingArtworkTotal: null,
        toolingTotal: null,
        artworkTotal: null,
        rdTotal: null,
        testingMicrosTotal: null,
        otherServiceTotal: null,
        actualUnitsProduced: null,
      },
    ],
  });
  const lines = overview.owners[0].productionLines;
  assert.equal(lines.length, 1, "an untouched field is not a row");
  // The module's exact name, so a parity reviewer is comparing the same row.
  assert.equal(lines[0].label, "Filling / blending tier total");
  assert.equal(lines[0].amounts.get(T1), "3000.00");
  assert.equal(lines[0].amounts.get(T2), "7000.00");
});

test("a direct service reports the column its own identity governs", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directServices: [
      {
        quoteLeafId: "ql-s",
        name: "Formulation work",
        serviceIdentity: "formulation",
        position: 0,
        amountsByTier: { [T1]: "5000.00", [T2]: null },
      },
    ],
  });
  const line = overview.owners[0].productionLines[0];
  // `formulation` writes `rdTotal`. Resolved from identity, never from
  // whichever column happens to be populated.
  assert.equal(line.field, "rdTotal");
  assert.match(line.label, /^Formulation/);
  assert.equal(line.amounts.get(T1), "5000.00");
  assert.equal(line.amounts.get(T2), null);
});

// REMOVED: "a service with no stated amount carries no production line".
// It asserted the behaviour the interim review rejected -- an unpriced governed
// service is still an input row. Replaced by "an unpriced governed service keeps
// its row, with blank per-tier cells" below, which asserts the corrected rule.

// ── No arithmetic ──────────────────────────────────────────────────────────

test("the model publishes no computed monetary quantity", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    packagingRows: [
      pkg({
        quoteLeafId: "ql-1",
        tierId: T1,
        lineGroupId: "lg-1",
        unitCost: "1.1100",
        qtyPerSellableUnit: "2",
        markupPct: "0.4500",
      }),
    ],
    componentCharges: [
      {
        chargeInstanceId: "ci-1",
        quoteLeafId: "ql-1",
        chargeKey: "print_plates",
        label: null,
        toolingClassification: null,
        amounts: [{ tierId: T1, cost: "1000.00", recoveryAsk: null }],
      },
    ],
    chargeReadiness: [readiness({ chargeInstanceId: "ci-1", quoteLeafId: "ql-1" })],
  });

  const owner = overview.owners[0];
  const line = owner.recurringLines[0];

  // Everything monetary is a STRING, exactly as stored. A computed figure would
  // be a number; the absence of numbers is the assertion.
  assert.equal(typeof line.cells.get(T1)!.unitCost, "string");
  assert.equal(line.cells.get(T1)!.unitCost, "1.1100");
  assert.equal(typeof owner.charges[0].amounts.get(T1)!.cost, "string");

  // The stored LINE OVERRIDE is carried through unresolved. The resolved rate
  // is the engine's, read from its node graph by the surface — this model never
  // walks the ladder.
  assert.equal(line.storedMarkupPct, "0.4500");
  assert.ok(!("resolvedMarkupPct" in line));
  assert.ok(!("extended" in line) && !("total" in line));

  const monetaryKeys = Object.keys(owner).filter((k) =>
    /total|subtotal|sum|extended|landed|sell|margin/i.test(k),
  );
  assert.deepEqual(monetaryKeys, [], "an owner publishes no aggregate");
  assert.deepEqual(
    Object.keys(overview).sort(),
    ["gaps", "owners", "tiers", "unplacedCharges"],
    "the overview publishes no quote-level figure",
  );
});

// ── Projection helpers ─────────────────────────────────────────────────────

test("focusable owners exclude a group with no economics of its own", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    assemblies: [{ id: "asy-1", sku: "A", name: "Group", position: 0 }],
    members: [
      {
        assemblyLeafId: "al-1",
        assemblyId: "asy-1",
        quoteLeafId: "ql-m",
        name: "Bottle",
        sku: "B",
        quantity: "1",
        position: 0,
        productType: null,
      },
    ],
  });
  assert.deepEqual(
    focusableOwners(overview.owners).map((o) => o.kind),
    ["group_member"],
    "the group itself has no production rows, so there is nothing to focus on it",
  );
});

// ── Interim-review corrections ─────────────────────────────────────────────

test("an unpriced governed service keeps its row, with blank per-tier cells", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directServices: [
      {
        quoteLeafId: "ql-s",
        name: "Micro testing",
        serviceIdentity: "testing_micros",
        position: 0,
        amountsByTier: { [T1]: null, [T2]: null },
      },
    ],
  });
  const lines = overview.owners[0].productionLines;
  // A governed service owns one input row whether or not anyone costed it.
  // No row at all would be indistinguishable from a quote with no service.
  assert.equal(lines.length, 1);
  assert.equal(lines[0].field, "testingMicrosTotal");
  assert.equal(lines[0].amounts.get(T1), null);
  assert.equal(lines[0].amounts.get(T2), null);
});

test("testing / micros is carried, not dropped", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    assemblies: [{ id: "asy-1", sku: "A", name: "Group", position: 0 }],
    groupProductionRows: [
      {
        id: "p1",
        assemblyId: "asy-1",
        tierId: T1,
        allocateServiceFeesToCost: true,
        fillingBlendingCost: null,
        cmAssemblyTotal: null,
        bulkRawCost: null,
        setupFeeTotal: null,
        toolingArtworkTotal: "500.00",
        toolingTotal: null,
        artworkTotal: null,
        rdTotal: null,
        testingMicrosTotal: "125.00",
        otherServiceTotal: null,
        actualUnitsProduced: null,
      },
    ],
  });
  const labels = overview.owners[0].productionLines.map((l) => l.label);
  // Both are real stored costs. A cost on neither surface has vanished.
  assert.ok(labels.includes("Testing / micros total"), labels.join(", "));
  assert.ok(labels.includes("Tooling / artwork total"), "the legacy column is retained");
});

test("a line group is scoped by owner, so two owners never merge into one line", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-a", name: "A", sku: "A", quantity: "1", position: 0, productType: null },
      { quoteLeafId: "ql-b", name: "B", sku: "B", quantity: "1", position: 1, productType: null },
    ],
    // The same line-group id under two owners. Keying on the group alone would
    // merge them and move one component's cost onto the other -- the
    // misattribution totals are structurally incapable of detecting.
    packagingRows: [
      pkg({ quoteLeafId: "ql-a", tierId: T1, lineGroupId: "shared", unitCost: "1.00" }),
      pkg({ quoteLeafId: "ql-b", tierId: T1, lineGroupId: "shared", unitCost: "9.00" }),
    ],
  });
  assert.equal(overview.owners[0].recurringLines.length, 1);
  assert.equal(overview.owners[1].recurringLines.length, 1);
  assert.equal(overview.owners[0].recurringLines[0].cells.get(T1)?.unitCost, "1.00");
  assert.equal(overview.owners[1].recurringLines[0].cells.get(T1)?.unitCost, "9.00");
  assert.equal(overview.gaps.length, 0);
});

test("denormalised metadata that disagrees across tier rows is named, not flattened", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    packagingRows: [
      pkg({ quoteLeafId: "ql-1", tierId: T1, lineGroupId: "lg-1", category: "Primary", supplier: "Acme" }),
      pkg({ quoteLeafId: "ql-1", tierId: T2, lineGroupId: "lg-1", category: "Secondary", supplier: "Acme" }),
    ],
  });
  const line = overview.owners[0].recurringLines[0];
  // The first row in sort order supplies the displayed value...
  assert.equal(line.category, "Primary");
  // ...and the divergence is reported, because a flattened conflict is
  // indistinguishable from agreement.
  assert.deepEqual(line.conflictingFields, ["markup category"]);
});

test("agreeing tier rows report no conflict", () => {
  const overview = buildCostsOverview({
    ...emptyFacts(),
    directProducts: [
      { quoteLeafId: "ql-1", name: "P", sku: "S", quantity: "1", position: 0, productType: null },
    ],
    packagingRows: [
      pkg({ quoteLeafId: "ql-1", tierId: T1, lineGroupId: "lg-1" }),
      pkg({ quoteLeafId: "ql-1", tierId: T2, lineGroupId: "lg-1" }),
    ],
  });
  assert.deepEqual(overview.owners[0].recurringLines[0].conflictingFields, []);
});
