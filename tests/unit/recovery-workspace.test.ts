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
const CARD = "src/components/quote-umbrella/recovery-card.tsx";

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
function costingWith(
  rows: { allocate: boolean; tierId: string }[],
  rate: number | null,
  elections: ChargeElection[] = [],
) {
  return {
    skuRollups: rows.map((r, i) => ({
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
      _i: i,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// THE WORKSPACE READS THE CONSTRUCTION. IT DERIVES NOTHING.
// ═══════════════════════════════════════════════════════════════════════

test("neither the read model nor the card performs rate arithmetic", async () => {
  for (const f of [VIEW, CARD]) {
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
    elections: [],
    allocationStates: [true],
  }).find((r) => r.chargeKey === "project_setup")!;

  const elected = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4, [
      { chargeKey: "project_setup", mode: "included" },
    ]),
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
    elections: [],
    allocationStates: [false],
  });
  const setup = rows.find((r) => r.chargeKey === "project_setup")!;
  assert.equal(setup.totalRecovery, null);
  assert.equal(setup.totalCost, 1000, "cost is known even when the rate is not");
});

test("the card renders the unpriced case as words, not a number", async () => {
  const src = await read(CARD);
  // "$0.00" would state that the charge recovers nothing. The truth is that
  // nothing governs what it recovers (BV-013).
  assert.match(src, /not priced/);
  assert.match(src, /row\.totalRecovery === null/);
});

// ═══════════════════════════════════════════════════════════════════════
// THE SURFACE IS NOT THE BOUNDARY, AND SAYS SO WHEN REFUSED.
// ═══════════════════════════════════════════════════════════════════════

test("the card surfaces the action's governed reason verbatim", async () => {
  const src = codeOnly(await read(CARD));
  assert.match(src, /if \(!res\.ok\) setError\(res\.error\.message\)/);
  // It does not re-derive the refusal to display — the boundary said it.
  assert.doesNotMatch(src, /refusalFor\(/);
});

test("denied modes render VISIBLY with their reason, not hidden", async () => {
  const src = codeOnly(await read(CARD));
  // A hidden option reads as an option that does not exist.
  //
  // Asserted as the PROPERTY, not the syntax. This was a grep for one literal
  // conditional (`!opt.available && opt.reason && (`) and it failed on a
  // refactor that preserved the behaviour exactly — a check that reports a
  // problem when nothing is wrong is on its way to being ignored.
  //
  // What must hold: the reason is RENDERED into the reason element, not
  // carried only by a `title` an operator has to hover to find, and no option
  // is filtered away for being unavailable.
  assert.match(
    src,
    /r9-recovery-reason[\s\S]{0,80}\{opt\.reason\}/,
    "the refusal reason is not rendered into the visible reason element",
  );
  assert.doesNotMatch(
    src,
    /options\s*\.filter\([^)]*available/,
    "the card filters denied modes out instead of showing them refused",
  );
  // Non-vacuous: the option list is mapped in full.
  assert.match(src, /row\.options\.map\(/);
});

test("pending is action-scoped per charge (Pattern 47(f))", async () => {
  const src = codeOnly(await read(CARD));
  // One in-flight write must not disable an unrelated row's controls.
  assert.match(src, /pendingKey === row\.chargeKey/);
  // And every disabled control explains itself.
  assert.match(src, /title=\{/);
});

test("a frozen quote renders read-only rather than being turned away", async () => {
  const tab = codeOnly(await read("src/components/quote-umbrella/tab-preview-quote.tsx"));
  assert.match(tab, /editable=\{quoteStatus === "draft"\}/);
});

// ═══════════════════════════════════════════════════════════════════════
// THE LABEL NAMES THE CONTRACT, NOT THE PLACEMENT.
//
// Two states can both look "included" and have different economics: a legacy
// allocated fee is reached by the quote-level adjustment, an elected one is
// not. So electing `included` on a quote that already allocates changes what
// the customer pays while the visible placement does not move — and a control
// reading "In unit price ✓" would present that as confirming what is already
// true.
// ═══════════════════════════════════════════════════════════════════════

test("a legacy placement is never rendered as a selected contract", async () => {
  const src = codeOnly(await read(CARD));
  // `selected` must require an ELECTION, not merely a matching placement.
  assert.match(
    src,
    /selected\s*=\s*\n?\s*row\.source === "election" && row\.electedMode === opt\.mode/,
    "selection is computed without requiring an election — a legacy state would render as in force",
  );
  // And it must not be derived from the placement set, which is the half that
  // is identical across the economic change.
  assert.doesNotMatch(
    src,
    /selected\s*=\s*row\.placements/,
    "selection is derived from the placement, which cannot distinguish legacy from elected",
  );
});

test("the mode labels describe the contract, not where the charge appears", async () => {
  const src = codeOnly(await read(CARD));
  // The placement-naming labels are gone. Each is checked on its own so a
  // failure names which one came back.
  assert.doesNotMatch(src, /"In unit price"/, "label names the placement");
  assert.doesNotMatch(src, /"Billed separately"/, "label names the placement");
  assert.doesNotMatch(src, /"Absorbed by DPS"/, "label names the placement");

  assert.match(src, /Use governed amortization/);
  assert.match(src, /governed rate/);
  // Each available option states what changes, on the surface.
  assert.match(src, /MODE_CONTRACT: Record<RecoveryMode, string>/);
  assert.match(src, /no longer affected by quote-level/);
});

test("clearing is named as restoring the INHERITED treatment", async () => {
  const src = codeOnly(await read(CARD));
  assert.match(src, /Restore inherited pricing treatment/);
  // "Clear" said what the code does, not what the operator gets back.
  assert.doesNotMatch(src, />\s*Clear\s*</);
});

test("the card makes no neutrality claim it cannot support", async () => {
  const src = await read(CARD); // prose included: this is ABOUT the prose
  // The claim that relocation is closed became false when the lift landed.
  assert.doesNotMatch(src, /relocation is closed/);
  // And the unqualified neutrality claim is not restored: it holds between two
  // ELECTED contracts and not between legacy and elected, which is the
  // comparison an operator actually makes on this surface.
  assert.doesNotMatch(
    src,
    /Moving a recovered charge between the unit price and its own line does not change/,
  );
  assert.match(src, /Between two elected\s*\n?\s*contracts/);
});

test("the legacy amortization's ungoverned amount is stated to the operator", async () => {
  const src = codeOnly(await read(CARD));
  // The one fact an operator cannot see anywhere else on the surface.
  assert.match(src, /Currently amortized under legacy pricing/);
  assert.match(src, /not independently governed/);
});
