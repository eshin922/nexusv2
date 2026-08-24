import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import { buildRecoveryWorkspace } from "../../src/lib/commercial-recovery/workspace-view.ts";
import { chargeEconomicsFor } from "../../src/lib/costing.ts";
import { constructCommercial } from "../../src/lib/commercial-recovery/construct.ts";
import type { ChargeElection } from "../../src/lib/commercial-recovery/resolve.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const VIEW = "src/lib/commercial-recovery/workspace-view.ts";

const prod = (allocate: boolean, over: Record<string, unknown> = {}) =>
  ({
    quoteSkuId: "leaf", tierId: "t1",
    allocateServiceFeesToCost: allocate,
    setupFeeTotal: 1000, toolingTotal: 500,
    toolingArtworkTotal: null, artworkTotal: null, rdTotal: null,
    testingMicrosTotal: null, otherServiceTotal: null,
    fillingBlendingCost: null, cmAssemblyTotal: null, bulkRawCost: null,
    actualUnitsProduced: null,
    ...over,
  }) as never;

/** A costing shape carrying the construction, built by production code. */
/**
 * A rollup tree with real sku ids AND the parent rollup a real bundle carries.
 *
 * The parent matters. An assembly's rollup holds the MERGE of its children's
 * charges, and this model used to sum every rollup — so it reported double the
 * governed recovery and double the cost on the operator's surface. The old
 * fixture could not catch it: its rollups had no ids and no parent, so there
 * was nothing to double.
 */
function costingWith(
  rows: { allocate: boolean; tierId: string }[],
  rate: number | null,
  elections: ChargeElection[] = [],
) {
  const leaf = (r: { allocate: boolean; tierId: string }, id: string) => ({
    skuId: id,
    perTier: [
      {
        tierId: r.tierId,
        constructed: constructCommercial(
          chargeEconomicsFor(prod(r.allocate) as never, rate),
          elections,
          r.allocate,
        ),
      },
    ],
  });
  return {
    skuRollups: [
      ...rows.map((r, i) => leaf(r, `leaf-${i}`)),
      // The parent, carrying the same charges merged upward.
      ...rows.map((r, i) => ({ ...leaf(r, `asm-${i}`) })),
    ],
  };
}
const ownsCharges = (skuId: string) => skuId.startsWith("leaf-");

// ═══════════════════════════════════════════════════════════════════════
// THE WORKSPACE READS THE CONSTRUCTION. IT DERIVES NOTHING.
// ═══════════════════════════════════════════════════════════════════════

test("the read model performs no rate arithmetic", async () => {
  for (const f of [VIEW]) {
    const src = codeOnly(await read(f));
    for (const forbidden of [/resolveMarkupStrict/, /MARKUP_CATEGORY/, /1 \+ /, /\* \(1/]) {
      assert.doesNotMatch(
        src,
        forbidden,
        `${f} recomputes a priced amount (${forbidden}) instead of reading it`,
      );
    }
  }
});

test("amounts are summed straight off the constructed charges", () => {
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: false, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [false],
  });
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  assert.equal(setup.present, true);
  assert.equal(setup.totalCost, 1000);
  assert.equal(setup.totalRecovery, 1400);
  assert.deepEqual(setup.placements, ["separate_line"]);
});

test("a charge the quote does not carry is not a decision to make", () => {
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true],
  });
  // Only the two columns the fixture populates are present; the rest are
  // rendered by nothing.
  assert.deepEqual(
    rows.filter((r) => r.present).map((r) => r.chargeKey).sort(),
    ["project_setup", "tooling"],
  );
});

// ═══════════════════════════════════════════════════════════════════════
// MIXED PLACEMENT IS A FACT ABOUT THE QUOTE, NOT AN EDGE CASE TO FLATTEN.
// ═══════════════════════════════════════════════════════════════════════

test("a quote placing one charge two ways reports it as mixed", () => {
  // Three real quotes carry allocate ON and OFF simultaneously, one already
  // sent. Picking one placement and calling it the answer would tell the
  // operator something false before they elect.
  const rows = buildRecoveryWorkspace({
    costing: costingWith(
      [
        { allocate: true, tierId: "t1" },
        { allocate: false, tierId: "t1" },
      ],
      0.4,
    ),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true, false],
  });
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  assert.equal(setup.mixed, true);
  assert.deepEqual([...setup.placements].sort(), ["separate_line", "unit_price"]);
});

// ═══════════════════════════════════════════════════════════════════════
// AVAILABILITY IS THE CONSERVATIVE INTERSECTION — THE ACTION LAYER'S RULE.
// ═══════════════════════════════════════════════════════════════════════

test("a mode refused for ANY owner state is not offered", () => {
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: false, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true, false],
  });
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  const byMode = new Map(setup.options.map((o) => [o.mode, o]));

  // Both placements are electable at either allocation state — the governed
  // precedence makes relocation neutral, so the conservative intersection no
  // longer excludes them.
  assert.equal(byMode.get("included")!.available, true);
  assert.equal(byMode.get("separate")!.available, true);
  // `absorbed` is refused, and the surface is told WHY.
  assert.equal(byMode.get("absorbed")!.available, false);
  assert.match(byMode.get("absorbed")!.reason ?? "", /cost as well as/);
});

test("every mode is returned with a verdict — none omitted", () => {
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true],
  });
  for (const r of rows) {
    assert.equal(r.options.length, 3, `${r.chargeKey} dropped a mode`);
    for (const o of r.options) {
      // Exhaustive complements at the rendering boundary: a denied mode with
      // no reason would reach an operator as a silently missing option.
      assert.equal(o.available, o.reason === null, `${r.chargeKey}/${o.mode}`);
    }
  }
});

test("the four BV-011 charges offer nothing, and say why", () => {
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true],
  });
  for (const key of ["rd_formulation", "testing_micros", "other_service", "tooling_artwork_legacy"]) {
    const r = rows.find((x) => x.chargeKey === key)!;
    assert.equal(r.options.every((o) => !o.available), true, `${key} is electable`);
    for (const o of r.options) assert.match(o.reason ?? "", /BV-011|Legacy combined/);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// PROVENANCE: "nobody elected" and "elected the same value" stay apart.
// ═══════════════════════════════════════════════════════════════════════

test("an election is distinguishable from the legacy fall-through", () => {
  const legacy = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true],
  }).find((r) => r.chargeKey === "project_setup")!;

  const elected = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4, [
      { chargeKey: "project_setup", mode: "included" },
    ]),
    isLeaf: ownsCharges,
    elections: [{ chargeKey: "project_setup", mode: "included" }],
    allocationStates: [true],
  }).find((r) => r.chargeKey === "project_setup")!;

  // Same placement, different provenance — which is why absence of a row is
  // the load-bearing state rather than a fourth mode.
  assert.deepEqual(legacy.placements, elected.placements);
  assert.equal(legacy.source, "legacy");
  assert.equal(legacy.electedMode, null);
  assert.equal(elected.source, "election");
  assert.equal(elected.electedMode, "included");
});

// ═══════════════════════════════════════════════════════════════════════
// UNKNOWN RECOVERY IS NOT ZERO.
// ═══════════════════════════════════════════════════════════════════════

test("an unpriced charge reports null recovery, never $0", () => {
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: false, tierId: "t1" }], null),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [false],
  });
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  assert.equal(setup.totalRecovery, null);
  assert.equal(setup.totalCost, 1000, "cost is known even when the rate is not");
});

// ═══════════════════════════════════════════════════════════════════════
// THE SURFACE IS NOT THE BOUNDARY, AND SAYS SO WHEN REFUSED.
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// A CHARGE IS COUNTED ONCE.
//
// This shipped wrong. The read model summed EVERY rollup, and an assembly's
// rollup carries the merge of its children's charges — so the operator's card
// reported $390 recovered on a quote whose single $150 setup fee at a pinned
// 0.30 recovers $195. Double the recovery and double the cost.
//
// It surfaced only because a second reader of the same construction disagreed
// with it. Each figure was individually plausible; nothing in either said
// which was right, and the raw fee in the database settled it.
// ═══════════════════════════════════════════════════════════════════════

test("the parent rollup's merged charges are not counted a second time", () => {
  const costing = costingWith([{ allocate: false, tierId: "t1" }], 0.4);
  // The fixture carries both, as a real bundle does.
  assert.equal(costing.skuRollups.length, 2, "the fixture has no parent to double");
  assert.deepEqual(
    costing.skuRollups.map((r) => r.skuId),
    ["leaf-0", "asm-0"],
  );

  const row = buildRecoveryWorkspace({
    costing,
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [false],
  }).find((r) => r.chargeKey === "project_setup")!;

  assert.equal(row.totalCost, 1000);
  assert.equal(row.totalRecovery, 1400);

  // Non-vacuous, and it names the number the bug produced: counting the parent
  // too doubles both figures.
  const doubled = buildRecoveryWorkspace({
    costing,
    isLeaf: () => true,
    elections: [],
    allocationStates: [false],
  }).find((r) => r.chargeKey === "project_setup")!;
  assert.equal(doubled.totalCost, 2000);
  assert.equal(doubled.totalRecovery, 2800);
});

test("every reader of the construction goes through the one traversal", async () => {
  // Three readers walked the rollup tree by hand and one of them omitted the
  // leaf filter. The traversal is now shared, and `isLeaf` is a required
  // argument, so a reader that forgets it does not compile.
  for (const f of [
    "src/lib/commercial-recovery/workspace-view.ts",
    "src/lib/commercial-recovery/frozen-instruction.ts",
    "src/lib/commercial-recovery/impact.ts",
  ]) {
    const src = codeOnly(await read(f));
    assert.match(src, /ownedPlacedCharges\(/, `${f} does not use the shared traversal`);
    assert.doesNotMatch(
      src,
      /for \(const \w+ of [\w.]*costing\.skuRollups/,
      `${f} walks the rollup tree itself again`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════
// QUOTE PRESENTATION CARRIES NO ECONOMIC INPUT.
//
// Edward's R5 disposition, 2026-08-24, preserving the Design Authority's
// boundary rather than superseding it to fit what had been built:
//
//   "fee_presentation remains a Layer-2, revenue-neutral presentation
//    decision. If a control can change customer economics, it is not a Quote
//    Presentation control."
//
// The recovery election is economically substantive — converting a charge
// from legacy to a governed contract moves the customer's total — so it was
// REMOVED from this surface, not restyled onto it. Its registered home is the
// Pricing workspace, where the authority already shows the equivalent
// `allocate_service_fees_to_cost` toggle.
//
// Asserted here because "we took it off" is a state that quietly reverses.
// ═══════════════════════════════════════════════════════════════════════

test("the recovery card is gone, not relocated", async () => {
  await assert.rejects(
    read("src/components/quote-umbrella/recovery-card.tsx"),
    "the recovery card still exists — the disposition was to remove it, not move it",
  );

  const tab = codeOnly(await read("src/components/quote-umbrella/tab-preview-quote.tsx"));
  assert.doesNotMatch(tab, /RecoveryCard/);
  assert.doesNotMatch(tab, /recoveryRows/);
  // Non-vacuous: the file is real and still renders the surface.
  assert.match(tab, /QuoteHost/);
});

test("the Presentation panel takes no handler that could write economics", async () => {
  const panel = codeOnly(await read("src/components/quote/presentation-panel.tsx"));

  // The authority: "Nothing in this panel is an input to economics."
  for (const forbidden of [
    /setChargeRecovery/,
    /previewChargeRecovery/,
    /RecoveryChargeRow/,
    /electedMode/,
    /recoverableSell/,
  ]) {
    assert.doesNotMatch(
      panel,
      forbidden,
      `the Presentation panel reaches for ${forbidden} — it is an economic input again`,
    );
  }

  // What it IS allowed to change: arrangement, aggregation, inclusion.
  assert.match(panel, /onPdfLayoutChange/);
  assert.match(panel, /onDetailLevelChange/);
});

test("the Accounting zone presents the frozen instruction and decides nothing", async () => {
  const zone = codeOnly(await read("src/components/quote/accounting-zone.tsx"));

  // It reads the sentence the freeze writes, from the same projection.
  assert.match(zone, /instructionSentence\(/);

  // And resolves nothing itself.
  for (const forbidden of [/resolveMarkupStrict/, /MARKUP_CATEGORY/, /1 \+ /, /setChargeRecovery/]) {
    assert.doesNotMatch(zone, forbidden, `the Accounting zone derives ${forbidden}`);
  }

  // The authority: "in a register that reads *not shown to the customer* —
  // the surface already has this vocabulary and it should be reused, not
  // reinvented."
  assert.match(zone, /not shown to the customer/i);
});

test("F4 — the PURE / PASS-THROUGH / PARTIAL switcher is gone from Quote", async () => {
  const toolbar = codeOnly(await read("src/components/quote/preview-toolbar.tsx"));
  for (const gone of [/Pass-through/i, /subState/, /showStateSwitcher/]) {
    assert.doesNotMatch(toolbar, gone, `F4 scaffolding survives: ${gone}`);
  }

  // Scoped to Quote. Mark Accepted shares the prop NAME but its subState
  // drives four real render branches, so removing it there would change
  // behaviour — which is why it is deliberately still present.
  const macc = codeOnly(await read("src/components/mark-accepted/mark-accepted-host.tsx"));
  assert.match(
    macc,
    /subState/,
    "Mark Accepted lost its state switcher — that one is load-bearing, not scaffolding",
  );
});

test("the document is dominant, at the authority's clamp", async () => {
  const css = await read("src/styles/r3-quote-presentation.css");
  // "Recommend clamp(816px, 100%, 1200px) — 816px is Letter at 96dpi and the
  // floor below which the document re-compresses."
  assert.match(css, /clamp\(816px, 100%, 1200px\)/);

  const host = codeOnly(await read("src/components/quote/quote-host.tsx"));
  assert.match(host, /qp-workspace/);
  assert.match(host, /qp-doc/);

  // The 880px cap the authority calls "the binding constraint" may survive
  // ONLY on the legacy path, and only under the flag.
  //
  // The first version of this forbade a literal
  // `maxWidth: 880, margin: "0 auto", border` sequence. Gating the layout put
  // that cap back inside a conditional spread, which the regex could not see,
  // so it kept passing while the thing it forbade was back. A check that
  // survives the change it exists to catch is measuring syntax, not property.
  if (/maxWidth: 880/.test(host)) {
    assert.match(
      host,
      /presentationRestored[\s\S]{0,40}maxWidth: 880/,
      "an 880px document cap survives outside the legacy branch",
    );
  }
});

test("the restored layout is gated, and the gate says it is temporary", async () => {
  const PAGE = "src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx";
  const page = codeOnly(await read(PAGE));

  // Derived from the authenticated viewer, never a constant.
  assert.match(page, /presentationRestored = viewer\.role === "admin"/);
  assert.doesNotMatch(page, /presentationRestored = true/);

  // And it says what it is. The authority's Q6 makes the panel any-PM, so a
  // gate that quietly hardened into a role boundary would be a new divergence
  // introduced by the fix for a divergence.
  const raw = await read(PAGE);
  assert.match(raw, /TEMPORARY/);
  assert.match(raw, /Q6/);
});
