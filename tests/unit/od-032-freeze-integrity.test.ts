/**
 * OD-032 P-3 — the frozen record can tell two charges apart.
 *
 * ── THE CASE THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * `quote_snapshot_recovery_instructions` identified a charge by
 * (charge_key, owner_ref, tier_id). Where ONE component owns TWO charges of ONE
 * type — the exact thing OD-032 makes representable — all three are identical,
 * so the two instructions differ only in their amounts and an accountant
 * reading the record Accounting bills from cannot tell which is which.
 *
 * These run the real engine and the real projection. A fixture that asserted
 * against a hand-built instruction would prove the shape and not the path.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  computeQuoteCosting,
  type ComponentChargeInput,
  type QuoteCostingInput,
} from "../../src/lib/costing.ts";
import { projectFrozenInstructions } from "../../src/lib/commercial-recovery/frozen-instruction.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

const TIER = "44444444-4444-4444-4444-444444444444";
const LEAF_QL = "55555555-5555-5555-5555-555555555555";
const INST_A = "aaaaaaaa-0000-4000-8000-000000000001";
const INST_B = "bbbbbbbb-0000-4000-8000-000000000002";

/** DIFFERENT amounts, so a swap or a collapse cannot pass unnoticed. */
const COST_A = 1450;
const COST_B = 325;

function charge(over: Partial<ComponentChargeInput> = {}): ComponentChargeInput {
  return {
    chargeInstanceId: INST_A,
    tierId: TIER,
    chargeKey: "print_plates",
    ownerRef: LEAF_QL,
    cost: COST_A,
    recoverableSell: COST_A,
    ...over,
  };
}

function input(args: {
  componentCharges?: ComponentChargeInput[];
  elections?: ChargeElection[];
  setupFee?: number | null;
}): QuoteCostingInput {
  const { componentCharges = [], elections = [], setupFee = null } = args;
  return {
    quote: { id: "quote", globalPriceAdjPct: 0, targetMarginPct: null },
    firmSettings: { targetMarginPct: 0.35, floorMarginPct: 0.25 },
    markupDefaults: { Production: 0.4 },
    chargeElections: elections,
    componentCharges,
    skus: [
      {
        id: "asm", parentSkuId: null, qtyPerParent: null, skuRole: "assembly" as const,
        skuLabel: "IG", productName: "Finished good", sortOrder: 0, retailBenchmark: null,
      },
      {
        id: "leaf", parentSkuId: "asm", qtyPerParent: 1, skuRole: "leaf" as const,
        skuLabel: "L", productName: "Carton", sortOrder: 0, retailBenchmark: null,
        canonicalQuoteLeafId: LEAF_QL,
      },
    ],
    tiers: [{ id: TIER, label: "Tier 1", qty: 1000, sortOrder: 0, tierPriceAdjPct: null }],
    packaging: [
      {
        quoteSkuId: "leaf", tierId: TIER, lineGroupId: "pkg",
        unitCost: 2, qtyPerSellableUnit: 1, category: "Production", markupPct: 0.4,
      },
    ],
    production: [
      {
        quoteSkuId: "leaf", tierId: TIER,
        allocateServiceFeesToCost: true,
        setupFeeTotal: setupFee,
        toolingArtworkTotal: null, toolingTotal: null, artworkTotal: null,
        rdTotal: null, testingMicrosTotal: null, otherServiceTotal: null,
        fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
        actualUnitsProduced: null,
      },
    ],
    freightLegGroups: [], freightLegs: [], freightLegTiers: [],
    cellOverrides: [], cellTargets: [],
  } as unknown as QuoteCostingInput;
}

/** Frozen instructions, through the real engine and the real projection. */
function freeze(args: Parameters<typeof input>[0]) {
  const costing = computeQuoteCosting(input(args));
  // The projection keeps a charge at the level it was authored against; an
  // assembly's rollup carries its children's merged charges, so the leaf test
  // is what stops each one being recorded twice.
  return projectFrozenInstructions(costing, (skuId) => skuId === "leaf");
}

// Per instance. Both charges are elected, because this suite is about whether
// the FROZEN RECORD can tell them apart — leaving one unplaced would test the
// unplaced refusal instead, which is its own case.
const INCLUDED: ChargeElection[] = [
  { chargeKey: "print_plates", chargeInstanceId: INST_A, mode: "included" },
  { chargeKey: "print_plates", chargeInstanceId: INST_B, mode: "included" },
];
const SETUP_INCLUDED: ChargeElection[] = [{ chargeKey: "project_setup", mode: "included" }];

// ══════════════════════════════════════════════════════════════════════
// The case the column exists for
// ══════════════════════════════════════════════════════════════════════

test("two same-type charges on ONE component stay distinguishable after freeze", () => {
  const rows = freeze({
    componentCharges: [
      charge({ chargeInstanceId: INST_A, cost: COST_A, recoverableSell: COST_A }),
      charge({ chargeInstanceId: INST_B, cost: COST_B, recoverableSell: COST_B }),
    ],
    elections: INCLUDED,
  });

  assert.equal(rows.length, 2, "both charges must freeze");

  // EVERY OTHER COLUMN IS IDENTICAL. That is the whole point: without the
  // instance id these two rows are indistinguishable in the record.
  assert.equal(rows[0].chargeKey, rows[1].chargeKey);
  assert.equal(rows[0].ownerRef, rows[1].ownerRef);
  assert.equal(rows[0].tierId, rows[1].tierId);

  const ids = rows.map((r) => r.chargeInstanceId).sort();
  assert.deepEqual(ids, [INST_A, INST_B].sort(), "the two rows carry distinct identities");

  // And each id is attached to ITS OWN amount, not merely present. A swap
  // would satisfy the assertion above and be wrong.
  const byId = new Map(rows.map((r) => [r.chargeInstanceId, r.cost]));
  assert.equal(byId.get(INST_A), COST_A);
  assert.equal(byId.get(INST_B), COST_B);
  assert.notEqual(COST_A, COST_B, "the fixture cannot detect a swap — are the costs equal?");
});

test("every component-owned instruction carries a non-null instance id", () => {
  const rows = freeze({ componentCharges: [charge()], elections: INCLUDED });
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].chargeInstanceId,
    INST_A,
    "a null here would mean identity was lost between authoring and freeze",
  );
});

// ══════════════════════════════════════════════════════════════════════
// The legacy half — which must not move
// ══════════════════════════════════════════════════════════════════════

test("CONTROL · a legacy placed charge freezes with a NULL instance id", () => {
  // A production fee placed by resolution. It has no election and therefore no
  // instance, so NULL is the honest value rather than a gap.
  const rows = freeze({ setupFee: 1200, elections: SETUP_INCLUDED });
  const legacy = rows.filter((r) => r.chargeKey === "project_setup");

  assert.equal(legacy.length, 1, "the legacy charge must still freeze");
  assert.equal(legacy[0].chargeInstanceId, null);
});

test("CONTROL · adding the field moves nothing else about a legacy instruction", () => {
  const rows = freeze({ setupFee: 1200, elections: SETUP_INCLUDED });
  const legacy = rows.find((r) => r.chargeKey === "project_setup")!;

  // Every other column of the instruction, unchanged. Without this the test
  // above passes against an implementation that broke the legacy projection
  // and merely happened to leave the new column null.
  assert.equal(legacy.treatment, "unit_price");
  assert.equal(legacy.treatmentSource, "election");
  assert.equal(legacy.cost, 1200);
  assert.equal(legacy.governedRecovery, 1200 * 1.4);
});

test("a quote with no charges freezes no instructions", () => {
  assert.equal(freeze({}).length, 0);
});

// ══════════════════════════════════════════════════════════════════════
// Identity is carried, never derived
// ══════════════════════════════════════════════════════════════════════

test("no runtime path recovers identity from sourceColumn", () => {
  // `sourceColumn` spells the id for a component charge, as
  // `quote_charge_instance_tiers:<uuid>`. It is a TRACEABILITY STRING built for
  // a human reading provenance — recovering identity from it would be reading a
  // value through an instrument not built to carry it (Pattern 58).
  //
  // A display string can be reworded. An identity cannot.
  const roots = [
    "src/lib/costing.ts",
    "src/lib/commercial-recovery/construct.ts",
    "src/lib/commercial-recovery/frozen-instruction.ts",
    "src/app/actions/quotes.ts",
    "src/lib/customer-view-resolver.ts",
  ];
  for (const f of roots) {
    const src = readFileSync(f, "utf8");
    for (const derive of [
      /sourceColumn\s*\.\s*split/,
      /sourceColumn\s*\.\s*slice/,
      /sourceColumn\s*\.\s*substring/,
      /sourceColumn\s*\.\s*replace/,
      /sourceColumn\s*\.\s*match/,
      /\.exec\(\s*\w*\.?sourceColumn/,
    ]) {
      assert.ok(
        !derive.test(src),
        `${f} must not recover identity from sourceColumn (${derive})`,
      );
    }
  }
});

test("the projection reads the field, not the string", () => {
  const src = readFileSync(
    "src/lib/commercial-recovery/frozen-instruction.ts",
    "utf8",
  );
  assert.match(src, /chargeInstanceId: c\.chargeInstanceId \?\? null/);
});

test("the emitter sets the field from the same value as the string", () => {
  const src = readFileSync("src/lib/costing.ts", "utf8");
  // Both derived from `c.chargeInstanceId`, so they cannot disagree — and the
  // field is the one anything downstream reads.
  assert.match(src, /sourceColumn: `quote_charge_instance_tiers:\$\{c\.chargeInstanceId\}`/);
  assert.match(src, /chargeInstanceId: c\.chargeInstanceId,/);
});

// ══════════════════════════════════════════════════════════════════════
// The migration
// ══════════════════════════════════════════════════════════════════════

const migrationRaw = () =>
  readFileSync("drizzle/0111_od_032_frozen_instruction_identity.sql", "utf8");

/**
 * The DDL, with `--` comments stripped.
 *
 * The header explains the nullability rule in prose, and that prose contains
 * the words "NOT NULL". A negative assertion run against the whole file matches
 * the explanation rather than the statement — an instrument pointed at the
 * wrong thing, which reports a failure that is not there and would just as
 * happily miss one that is.
 */
const migration = () => migrationRaw().replace(/^[ 	]*--.*$/gm, "");

test("the migration is additive and backfills nothing", () => {
  const sql = migration();
  assert.match(sql, /ADD COLUMN "charge_instance_id" uuid/);
  // Non-vacuous: the stripper must not have eaten the DDL as well.
  assert.ok(sql.includes("ALTER TABLE"), "comment stripping removed the statement");
  // Nullable: no NOT NULL, no default, no backfill, and nothing rewritten.
  assert.doesNotMatch(sql, /NOT NULL/);
  assert.doesNotMatch(sql, /UPDATE /);
  assert.doesNotMatch(sql, /INSERT /);
  assert.doesNotMatch(sql, /DROP /);
});

test("the frozen pointer does not cascade", () => {
  // ON DELETE SET NULL, never CASCADE. A frozen instruction outlives the
  // draft-side charge it was projected from: deleting a charge on a later
  // revision must not delete the record of what a customer was already billed.
  const sql = migration();
  assert.match(sql, /REFERENCES "quote_charge_instances"\("id"\) ON DELETE SET NULL/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

// ══════════════════════════════════════════════════════════════════════
// The write actually persists — a gap TypeScript cannot see
// ══════════════════════════════════════════════════════════════════════

test("the snapshot table declares the column the freeze writer names", () => {
  // ── WHY THIS GUARD EXISTS ──────────────────────────────────────────────
  //
  // Drizzle's `.values()` silently DROPS a key the table does not declare, and
  // `tsc --noEmit` reports nothing. Measured while building this phase: with
  // the column removed from `schema.ts` and the writer still passing
  // `chargeInstanceId`, the whole project typechecks clean.
  //
  // The failure that produces is the worst shape available — every frozen
  // instruction stores NULL, including component-owned ones, the migration is
  // applied so the column exists in the database, and nothing anywhere
  // reports it. The projection tests above would still pass, because they test
  // the projection rather than the write.
  //
  // So the two halves are asserted against each other here.
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const start = schema.lastIndexOf('"quote_snapshot_recovery_instructions"');
  assert.ok(start > 0, "the snapshot instruction table was not found");
  const end = schema.indexOf("pgTable(", start);
  const table = schema.slice(start, end === -1 ? schema.length : end);

  assert.match(
    table,
    /chargeInstanceId: uuid\("charge_instance_id"\)/,
    "the snapshot table must declare charge_instance_id, or Drizzle drops it",
  );
  // Non-vacuous: the slice must actually be the right table, not the whole file.
  assert.match(table, /ownerRef: text\("owner_ref"\)/);
  assert.ok(table.length < schema.length, "the table slice is the entire file");

  // And the writer names it, so the two cannot drift apart in either direction.
  const writer = readFileSync("src/app/actions/quotes.ts", "utf8");
  assert.match(writer, /chargeInstanceId: i\.chargeInstanceId,/);
});

test("the frozen pointer does not cascade in the schema either", () => {
  // The migration says SET NULL. If the Drizzle declaration said CASCADE, the
  // two would disagree and the next generated migration would follow the
  // declaration rather than the applied database.
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const start = schema.lastIndexOf('"quote_snapshot_recovery_instructions"');
  const end = schema.indexOf("pgTable(", start);
  const table = schema.slice(start, end === -1 ? schema.length : end);
  const decl = table.slice(table.indexOf("chargeInstanceId:"));
  assert.match(decl.slice(0, 200), /onDelete: "set null"/);
});

