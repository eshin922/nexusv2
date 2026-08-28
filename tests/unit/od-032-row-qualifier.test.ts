/**
 * OD-032 — telling two charges apart by the field that distinguishes them.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * Collision qualification used the OWNER NAME, which was right while the only
 * collision it had to resolve was two CARTONS each causing plates. Two charges
 * on ONE carton share the owner, so both rows rendered identically:
 *
 *   Print plates · Genexa - Box - Kids' Cough (10064-GNX)
 *   Print plates · Genexa - Box - Kids' Cough (10064-GNX)
 *
 * Measured on production 2026-08-28, over charges costing $1,450-$1,300 and
 * $600 flat, both reading "not priced". Two identical controls, and the
 * operator's own label — which the sheet had just REQUIRED them to type — sat
 * unused in the database.
 *
 * The model disambiguates by the charge's own label. The surface now uses the
 * same field, and falls back to the owner name for the case the original rule
 * was written for.
 *
 * ── WHY THE SINGLE-INSTANCE CASE IS ASSERTED TOO ────────────────────────
 *
 * The rule is that a qualifier appears when the type alone is AMBIGUOUS — not
 * when a label happens to exist. A repair that qualified every labelled row
 * would fix the collision and clutter every quote that never had one.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryWorkspace } from "../../src/lib/commercial-recovery/workspace-view.ts";
import type { ConstructedRollups } from "../../src/lib/commercial-recovery/construct.ts";
import type { RecoveryChargeKey } from "../../src/lib/commercial-recovery/registry.ts";

const T1 = "tier-1", T2 = "tier-2";
const CARTON_A = "leaf-a";
const CARTON_B = "leaf-b";
const isLeaf = (id: string) => id === CARTON_A || id === CARTON_B;

function plates(instanceId: string, owner: string) {
  return {
    chargeKey: "print_plates",
    chargeInstanceId: instanceId,
    ownerKind: "component",
    ownerRef: owner,
    placement: "separate_line",
    source: "election",
    cost: 1000,
    recoverableSell: 1400,
    revenueContribution: 1400,
    separateInvoiceAmount: 1400,
    amortization: null,
  };
}

function rollups(per: (leaf: string, tier: string) => unknown[], leaves = [CARTON_A]): ConstructedRollups {
  return {
    skuRollups: leaves.map((skuId) => ({
      skuId,
      perTier: [T1, T2].map((tierId) => ({ tierId, constructed: { charges: per(skuId, tierId) } })),
    })),
  } as unknown as ConstructedRollups;
}

/** The economics map the resolver supplies, carrying each charge's own label. */
type EconomicsMap = ReadonlyMap<
  string,
  {
    state: "none" | "partial" | "complete";
    chargeKey: RecoveryChargeKey;
    ownLabel: string | null;
    quoteLeafId: string;
    missingTierLabels: string[];
  }
>;

function economics(
  entries: { id: string; label: string | null; owner?: string }[],
): EconomicsMap {
  return new Map(
    entries.map((e) => [
      e.id,
      {
        state: "complete" as const,
        chargeKey: "print_plates" as RecoveryChargeKey,
        ownLabel: e.label,
        quoteLeafId: e.owner ?? CARTON_A,
        missingTierLabels: [] as string[],
      },
    ]),
  );
}

const build = (
  costing: ConstructedRollups,
  chargeEconomics?: EconomicsMap,
  ownerNames?: Map<string, string>,
) =>
  buildRecoveryWorkspace({
    costing,
    isLeaf,
    elections: [],
    allocationStates: [false],
    chargeEconomics,
    ownerNames,
  });

const platesRows = (rows: ReturnType<typeof build>) =>
  rows.filter((r) => r.chargeInstanceId && r.chargeKey === "print_plates");

// ══════════════════════════════════════════════════════════════════════
// Case 1 · same type, same owner, MIXED labels
// ══════════════════════════════════════════════════════════════════════

test("SAME OWNER, MIXED LABELS · the charge label distinguishes them", () => {
  // ── THE PRODUCTION CASE, EXACTLY ───────────────────────────────────────
  //
  // The first instance of a type needs no label, so a real pair is routinely
  // one labelled and one not. Both must still be readable.
  const rows = build(
    rollups(() => [plates("inst-a", CARTON_A), plates("inst-b", CARTON_A)]),
    economics([
      { id: "inst-a", label: null },
      { id: "inst-b", label: "Back panel" },
    ]),
    new Map([[CARTON_A, "Genexa - Box - Kids' Cough"]]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 2);

  const a = mine.find((r) => r.chargeInstanceId === "inst-a")!;
  const b = mine.find((r) => r.chargeInstanceId === "inst-b")!;

  // Unlabelled: no qualifier. The owner name would be WORSE than none — it is
  // the same string on both rows, so it distinguishes nothing while looking
  // like it does.
  assert.equal(a.qualifier, null);
  // Labelled: its own label, never the owner's name.
  assert.equal(b.qualifier, "Back panel");

  // Rendered, this is `Print plates` / `Print plates · Back panel`.
  assert.notDeepEqual(
    [a.label, a.qualifier],
    [b.label, b.qualifier],
    "the two rows must not read identically — that was the defect",
  );

  // NON-VACUOUS: the owner name IS available, and was what the old rule used.
  assert.ok(
    !mine.some((r) => r.qualifier === "Genexa - Box - Kids' Cough"),
    "the owner name is present and must not be chosen when it distinguishes nothing",
  );
});

test("controls stay bound to their own INSTANCE, whatever is printed", () => {
  // Presentation only. The qualifier changed; identity did not.
  const rows = build(
    rollups(() => [plates("inst-a", CARTON_A), plates("inst-b", CARTON_A)]),
    economics([
      { id: "inst-a", label: null },
      { id: "inst-b", label: "Back panel" },
    ]),
    new Map([[CARTON_A, "Genexa - Box"]]),
  );
  const mine = platesRows(rows);
  assert.deepEqual(mine.map((r) => r.chargeInstanceId).sort(), ["inst-a", "inst-b"]);
  assert.equal(new Set(mine.map((r) => r.chargeInstanceId)).size, 2);
});

// ══════════════════════════════════════════════════════════════════════
// Case 2 · same type, DIFFERENT owners, no labels
// ══════════════════════════════════════════════════════════════════════

test("DIFFERENT OWNERS, NO LABELS · the owner name distinguishes them", () => {
  // The case the original rule was written for, preserved. Two cartons each
  // causing plates, neither labelled — the owner is the only thing that
  // separates them, and it does.
  const rows = build(
    rollups(
      (leaf) => [plates(leaf === CARTON_A ? "inst-a" : "inst-b", leaf)],
      [CARTON_A, CARTON_B],
    ),
    economics([
      { id: "inst-a", label: null, owner: CARTON_A },
      { id: "inst-b", label: null, owner: CARTON_B },
    ]),
    new Map([
      [CARTON_A, "Kids' Cough carton"],
      [CARTON_B, "Night-time carton"],
    ]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 2);
  assert.deepEqual(
    mine.map((r) => r.qualifier).sort(),
    ["Kids' Cough carton", "Night-time carton"],
  );
});

test("no name and no label leaves NO qualifier, never an id", () => {
  // An operator cannot act on a uuid, and printing one would be worse than the
  // ambiguity it was meant to resolve.
  const rows = build(
    rollups(
      (leaf) => [plates(leaf === CARTON_A ? "inst-a" : "inst-b", leaf)],
      [CARTON_A, CARTON_B],
    ),
    economics([
      { id: "inst-a", label: null, owner: CARTON_A },
      { id: "inst-b", label: null, owner: CARTON_B },
    ]),
    // No owner names supplied.
  );
  const mine = platesRows(rows);
  assert.deepEqual(mine.map((r) => r.qualifier), [null, null]);
});

// ══════════════════════════════════════════════════════════════════════
// Case 4 · different owners, SAME own label
// ══════════════════════════════════════════════════════════════════════

test("DIFFERENT OWNERS, SAME LABEL · the owner distinguishes them", () => {
  // ── WHY PREFERRING THE LABEL IS NOT ENOUGH ─────────────────────────────
  //
  // Two components can each label their plates "Front panel". Both labels are
  // valid on their own, and neither distinguishes anything — so a rule that
  // preferred the label whenever one existed rendered two identical rows while
  // the distinct owner names sat unused. The same defect as the production
  // pair, one field along.
  //
  // The question is not "is there a label" but "does it tell this row apart".
  const rows = build(
    rollups(
      (leaf) => [plates(leaf === CARTON_A ? "inst-a" : "inst-b", leaf)],
      [CARTON_A, CARTON_B],
    ),
    economics([
      { id: "inst-a", label: "Front panel", owner: CARTON_A },
      { id: "inst-b", label: "Front panel", owner: CARTON_B },
    ]),
    new Map([
      [CARTON_A, "Kids' Cough carton"],
      [CARTON_B, "Night-time carton"],
    ]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 2);

  // NEITHER row may carry the shared label as its qualifier.
  assert.ok(
    !mine.some((r) => r.qualifier === "Front panel"),
    "a label both siblings share distinguishes nothing",
  );
  // The owner does, so the owner is used.
  assert.deepEqual(
    mine.map((r) => r.qualifier).sort(),
    ["Kids' Cough carton", "Night-time carton"],
  );
  // And the rows are readable as different things.
  assert.notEqual(mine[0].qualifier, mine[1].qualifier);
});

test("NEITHER alone distinguishes, but the PAIR does → label · owner", () => {
  // Three instances: the label collides across owners, and the owner collides
  // across labels. Only the combination separates every row.
  //
  //   A  Front panel · Carton A
  //   B  Front panel · Carton B
  //   C  Back panel  · Carton A
  //
  // C's LABEL is unique, so C takes the cheaper qualifier. A and B share a
  // label; A's owner is shared with C, so A needs both. B's owner is unique,
  // so B takes the owner alone — the smallest qualifier that works, per row.
  const rows = build(
    rollups(
      (leaf) =>
        leaf === CARTON_A
          ? [plates("inst-a", CARTON_A), plates("inst-c", CARTON_A)]
          : [plates("inst-b", CARTON_B)],
      [CARTON_A, CARTON_B],
    ),
    economics([
      { id: "inst-a", label: "Front panel", owner: CARTON_A },
      { id: "inst-b", label: "Front panel", owner: CARTON_B },
      { id: "inst-c", label: "Back panel", owner: CARTON_A },
    ]),
    new Map([
      [CARTON_A, "Carton A"],
      [CARTON_B, "Carton B"],
    ]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 3);
  const q = (id: string) => mine.find((r) => r.chargeInstanceId === id)!.qualifier;

  assert.equal(q("inst-c"), "Back panel", "a unique label is the cheapest qualifier");
  assert.equal(q("inst-b"), "Carton B", "a unique owner is the next cheapest");
  assert.equal(q("inst-a"), "Front panel · Carton A", "only the pair separates this one");

  // THE PROPERTY, stated directly: every row reads differently from every other.
  const printed = mine.map((r) => `${r.label} · ${r.qualifier ?? ""}`);
  assert.equal(new Set(printed).size, 3, "no two rows may read alike");
});

test("SMALLEST qualifier · a unique label is never widened to label · owner", () => {
  // The rule is the smallest qualifier that WORKS. Adding the owner to a label
  // that already distinguishes is lineage nobody needs to read.
  const rows = build(
    rollups(
      (leaf) => [plates(leaf === CARTON_A ? "inst-a" : "inst-b", leaf)],
      [CARTON_A, CARTON_B],
    ),
    economics([
      { id: "inst-a", label: "Front panel", owner: CARTON_A },
      { id: "inst-b", label: "Back panel", owner: CARTON_B },
    ]),
    new Map([
      [CARTON_A, "Carton A"],
      [CARTON_B, "Carton B"],
    ]),
  );
  const mine = platesRows(rows);
  assert.deepEqual(mine.map((r) => r.qualifier).sort(), ["Back panel", "Front panel"]);
  assert.ok(!mine.some((r) => (r.qualifier ?? "").includes("Carton")));
});

// ══════════════════════════════════════════════════════════════════════
// Case 3 · a single instance stays uncluttered
// ══════════════════════════════════════════════════════════════════════

test("SINGLE INSTANCE · no qualifier, even when both fields exist", () => {
  // ── THE RULE IS AMBIGUITY, NOT AVAILABILITY ────────────────────────────
  //
  // A repair that qualified every labelled row would fix the collision and
  // clutter every quote that never had one.
  const rows = build(
    rollups(() => [plates("inst-a", CARTON_A)]),
    economics([{ id: "inst-a", label: "Front panel" }]),
    new Map([[CARTON_A, "Genexa - Box"]]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].qualifier, null, "one of a type needs no telling apart");
});

// ══════════════════════════════════════════════════════════════════════
// The ambiguity count
// ══════════════════════════════════════════════════════════════════════

test("an UNCOSTED sibling still makes the pair ambiguous", () => {
  // A charge nobody has priced is still a charge. Counting only the placed
  // ones would leave a labelled pair unqualified until both were costed —
  // which is exactly when an operator is most likely to be looking at them.
  const rows = build(
    rollups(() => [plates("inst-a", CARTON_A)]),
    new Map<
      string,
      {
        state: "none" | "partial" | "complete";
        chargeKey: RecoveryChargeKey;
        ownLabel: string | null;
        quoteLeafId: string;
        missingTierLabels: string[];
      }
    >([
      ["inst-a", { state: "complete", chargeKey: "print_plates", ownLabel: "Front panel", quoteLeafId: CARTON_A, missingTierLabels: [] }],
      ["inst-b", { state: "none", chargeKey: "print_plates", ownLabel: "Back panel", quoteLeafId: CARTON_A, missingTierLabels: [] }],
    ]),
    new Map([[CARTON_A, "Genexa - Box"]]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 2, "the uncosted one is synthesized as its own row");
  assert.deepEqual(mine.map((r) => r.qualifier).sort(), ["Back panel", "Front panel"]);
});

test("a LONE uncosted charge is not qualified either", () => {
  // The synthesized rows obey the same collision rule as the placed ones. This
  // set them unconditionally at first, so a single unpriced charge carried a
  // qualifier nothing collided with.
  const rows = build(
    rollups(() => []),
    new Map<
      string,
      {
        state: "none" | "partial" | "complete";
        chargeKey: RecoveryChargeKey;
        ownLabel: string | null;
        quoteLeafId: string;
        missingTierLabels: string[];
      }
    >([
      ["inst-a", { state: "none", chargeKey: "print_plates", ownLabel: "Front panel", quoteLeafId: CARTON_A, missingTierLabels: [] }],
    ]),
  );
  const mine = platesRows(rows);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].qualifier, null);
});

// ══════════════════════════════════════════════════════════════════════
// Unchanged
// ══════════════════════════════════════════════════════════════════════

test("the group control is untouched — still one per DISTINCT INSTANCE", () => {
  const rows = build(
    rollups(() => [plates("inst-a", CARTON_A), plates("inst-b", CARTON_A)]),
    economics([
      { id: "inst-a", label: null },
      { id: "inst-b", label: "Back panel" },
    ]),
  );
  // Two rows of one type is what the card groups on, and it is still two.
  assert.equal(platesRows(rows).length, 2);
  assert.equal(new Set(platesRows(rows).map((r) => r.chargeInstanceId)).size, 2);
});

test("a LEGACY row is never qualified — its owner is the engagement", () => {
  // OD-028: a legacy charge's anchor must never be surfaced as a cause.
  const rows = build(
    rollups(() => [
      {
        chargeKey: "project_setup",
        ownerKind: "assembly",
        placement: "unit_price",
        source: "legacy",
        cost: 500,
        recoverableSell: 700,
        revenueContribution: 700,
        separateInvoiceAmount: 0,
        amortization: null,
      },
    ]),
  );
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  assert.equal(setup.qualifier, undefined);
});
