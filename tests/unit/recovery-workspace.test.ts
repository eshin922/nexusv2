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

test("every one-time fee row is active, with absorbed refused on the invariant", () => {
  // Supersedes "the four BV-011 charges offer nothing, and say why". The
  // one-time fee class rule (Edward, 2026-08-24) grants all three treatments;
  // BV-011's silence was never a refusal.
  const rows = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true],
  });
  const oneTime = [
    "tooling",
    "project_setup",
    "artwork_plate",
    "rd_formulation",
    "testing_micros",
    "other_service",
    "tooling_artwork_legacy",
  ];
  for (const key of oneTime) {
    const r = rows.find((x) => x.chargeKey === key)!;
    const usable = r.options.filter((o) => o.available).map((o) => o.mode);
    assert.deepEqual(
      [...usable].sort(),
      ["included", "separate"],
      `${key} — the row must offer the two treatments the system performs`,
    );
    // Absorbed is permitted by policy and refused by the invariant, and the
    // operator is told which. A row that simply omitted it would read as a
    // charge that cannot be absorbed at all.
    const absorbed = r.options.find((o) => o.mode === "absorbed")!;
    assert.equal(absorbed.available, false);
    assert.match(absorbed.reason ?? "", /cost is retained/);
    assert.doesNotMatch(absorbed.reason ?? "", /BV-011/, `${key} still cites a lifted refusal`);
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
// THE SELECTED SEGMENT IS THE TREATMENT IN FORCE, NOT THE ELECTION.
//
// Operator finding, 2026-08-24: Card 1 rendered every permitted option
// unselected on a quote that unambiguously had a recovery treatment in force.
// The control read `electedMode`, so it was really answering "has someone
// clicked here?" while looking like it answered "what is this quote doing?"
//
// No election row is not no treatment. The legacy contract resolves to a real
// placement, the engine prices it, and the customer document prints it — the
// only thing missing was a row recording who chose it.
// ═══════════════════════════════════════════════════════════════════════

test("an inherited treatment selects its segment, with no election row", () => {
  const inherited = (allocate: boolean) =>
    buildRecoveryWorkspace({
      costing: costingWith([{ allocate, tierId: "t1" }], 0.4),
      isLeaf: ownsCharges,
      elections: [],
      allocationStates: [allocate],
    }).find((r) => r.chargeKey === "project_setup")!;

  const allocated = inherited(true);
  assert.equal(allocated.source, "legacy", "nothing was elected");
  assert.equal(allocated.electedMode, null);
  assert.equal(
    allocated.effectiveMode,
    "included",
    "the quote amortizes this charge — the segment saying so must be selected",
  );

  const separate = inherited(false);
  assert.equal(separate.source, "legacy");
  assert.equal(separate.electedMode, null);
  assert.equal(separate.effectiveMode, "separate");

  // The two disagree, which is the point: a single hard-coded default would
  // have passed one of these and quietly misreported the other.
  assert.notEqual(allocated.effectiveMode, separate.effectiveMode);
});

test("electing moves the selection; clearing returns it to the inherited one", () => {
  const rows = (elections: { chargeKey: "project_setup"; mode: "included" }[]) =>
    buildRecoveryWorkspace({
      // The construction sees the same elections the workspace does — the
      // treatment in force IS the constructed placement.
      costing: costingWith([{ allocate: false, tierId: "t1" }], 0.4, elections),
      isLeaf: ownsCharges,
      elections,
      allocationStates: [false],
    }).find((r) => r.chargeKey === "project_setup")!;

  const before = rows([]);
  assert.equal(before.effectiveMode, "separate", "inherited");
  assert.equal(before.source, "legacy");

  const elected = rows([{ chargeKey: "project_setup", mode: "included" }]);
  assert.equal(elected.effectiveMode, "included", "the election moves it");
  assert.equal(elected.source, "election");

  // Clearing is the absence of the row, not a fourth mode. The selection must
  // fall back to what the inherited contract resolves to — NOT to nothing.
  const cleared = rows([]);
  assert.equal(cleared.effectiveMode, "separate");
  assert.equal(cleared.source, "legacy");
  assert.equal(cleared.electedMode, null);
});

test("no single treatment in force selects nothing — none is invented", () => {
  // Placed two ways across the quote: no segment can honestly claim to be the
  // treatment, so none is selected and the caption says why.
  const mixed = buildRecoveryWorkspace({
    costing: costingWith(
      [{ allocate: true, tierId: "t1" }, { allocate: false, tierId: "t2" }],
      0.4,
    ),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true, false],
  }).find((r) => r.chargeKey === "project_setup")!;
  assert.equal(mixed.mixed, true);
  assert.equal(mixed.effectiveMode, null);

  // A charge the quote does not carry has no treatment either — filling the
  // control here would state a commercial fact nothing governs.
  const absent = buildRecoveryWorkspace({
    costing: costingWith([{ allocate: true, tierId: "t1" }], 0.4),
    isLeaf: ownsCharges,
    elections: [],
    allocationStates: [true],
  }).find((r) => r.chargeKey === "container_freight")!;
  assert.equal(absent.present, false);
  assert.equal(absent.effectiveMode, null);
});

test("an in-flight recovery pick says so", async () => {
  // Operator report: clicking a permitted treatment "produces no visible
  // change". Traced end to end on production -- every click persisted, POST
  // 200, no refusal. The selection simply took 2369ms and 1999ms to move, and
  // for that whole time nothing on screen acknowledged the click while the
  // row's buttons sat disabled.
  //
  // So the repair is acknowledgement, NOT a change to how the selected state
  // is derived. That must keep coming from the engine's effective placement,
  // which the assertions below also pin.
  const card = await readFile(
    new URL("../../src/components/quote/card-commercial-recovery.tsx", import.meta.url),
    "utf8",
  );
  assert.match(card, /busy && <span className="cv-charge-saving">/, "the row must say it is saving");
  assert.match(card, /aria-busy=\{busy \|\| undefined\}/, "assistive tech must hear it too");
  // Pattern 47(f): a disabled control must communicate why.
  assert.ok(
    card.includes('"Saving this change…"'),
    "a busy button must state its reason",
  );
  // And the selected state still derives from the engine, not from the click.
  assert.match(card, /const active = row\.effectiveMode === opt\.mode/);

  const css = await readFile(
    new URL("../../src/styles/r3-customer-view.css", import.meta.url),
    "utf8",
  );
  // In-flight must not read as prohibited -- they are different states.
  assert.match(css, /\.cv-opts button\[data-busy="yes"\]/);
  assert.match(css, /prefers-reduced-motion/);
});

test("the saving state ends when the engine answers, not when the write returns", async () => {
  // Measured on production after the first acknowledgement shipped:
  //
  //   ~1.0s  saving shown, aria-busy set, selection OLD
  //   ~2.0s  saving GONE, aria-busy cleared, selection STILL OLD
  //   ~4.0s  selection moves
  //
  // Clearing on the action's return left a two-second window with no feedback
  // and a stale selection -- the operator's original complaint, moved later in
  // the timeline rather than removed. The write returning is not the answer;
  // the re-rendered rows are.
  const card = await readFile(
    new URL("../../src/components/quote/card-commercial-recovery.tsx", import.meta.url),
    "utf8",
  );
  // The intent carries the mode, so it can be compared against what comes back.
  const flatAll = card.replace(/\s+/g, " ");
  assert.ok(
    flatAll.includes("mode: RecoveryMode | null; } | null>(null)"),
    "the intent must carry the picked mode, and null for a relinquishment",
  );
  // Success must NOT clear it. Compared on whitespace-normalised text, so
  // the assertion does not depend on how the file happens to wrap.
  const flat = card.replace(/\s+/g, " ");
  assert.ok(
    !flat.includes("writeDone.current = true; setPending(null)"),
    "a successful write must not end the wait",
  );
  // A refusal DOES clear it, or the row would sit saving forever.
  assert.ok(
    flat.includes("setError(res.error.message); setPending(null);"),
    "a refusal must end the wait",
  );
  // And any fresh answer clears it, so it cannot hang.
  assert.match(card, /if \(writeDone\.current\) setPending\(null\)/);
  // Still derived from the engine, never optimistic.
  assert.match(card, /const active = row\.effectiveMode === opt\.mode/);
});

test("an elected charge can relinquish its election", async () => {
  // setChargeRecovery(mode=null) already existed and the read model already
  // told elected from inherited -- the operator simply had no way to invoke it,
  // so a charge could not be returned to its inherited treatment once elected.
  const card = await readFile(
    new URL("../../src/components/quote/card-commercial-recovery.tsx", import.meta.url),
    "utf8",
  );
  const flat = card.replace(/\s+/g, " ");

  // Offered only where there is something to give up.
  assert.ok(flat.includes("row.source === \"election\" && editable && ("));
  assert.match(card, /data-testid=\{`recovery-\$\{row\.chargeKey\}-restore`\}/);

  // It calls the SAME writer, with the empty mode the action reads as a clear.
  assert.ok(flat.includes("onClick={() => write(row.chargeKey, null)}"));
  assert.ok(flat.includes('fd.set("mode", mode ?? "")'));

  // Electing and relinquishing stay distinct acts: clicking the selected
  // treatment must not be overloaded to mean clear.
  assert.ok(flat.includes("onClick={() => write(row.chargeKey, opt.mode)}"));
  assert.ok(
    !flat.includes("active ? write(row.chargeKey, null)"),
    "clicking the selected treatment must not mean clear",
  );

  // Same acknowledgement lifecycle, and still nothing optimistic.
  assert.ok(flat.includes('disabled={busy} aria-busy={busy || undefined}'));
  assert.match(card, /const active = row\.effectiveMode === opt\.mode/);
});

test("a relinquishment is answered by provenance, not by the selected mode", async () => {
  // The inherited placement may EQUAL the elected one. Then the dark button
  // does not move and only "elected → inherited" changes -- which is correct,
  // and means waiting on the mode would wait for a change that never comes.
  const card = await readFile(
    new URL("../../src/components/quote/card-commercial-recovery.tsx", import.meta.url),
    "utf8",
  );
  const flat = card.replace(/\s+/g, " ");
  assert.ok(
    flat.includes(
      'pending.mode === null ? row?.source === "legacy" : row?.effectiveMode === pending.mode',
    ),
    "the wait must end on provenance for a clear and on mode for an election",
  );
});

test("Card 1 reads the treatment in force, not the election row", async () => {
  const card = await readFile(
    new URL("../../src/components/quote/card-commercial-recovery.tsx", import.meta.url),
    "utf8",
  ).then((t) =>
    // Strip comments first: a prose mention is not a use, and matching one
    // as though it were has produced four false results in this workstream.
    t
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(new RegExp("//[^" + String.fromCharCode(10) + "]*", "g"), ""),
  );
  assert.match(card, /const active = row\.effectiveMode === opt\.mode/);
  assert.doesNotMatch(
    card,
    /row\.source === "election" && row\.electedMode/,
    "provenance must not decide the selected state",
  );
  // Provenance is still SHOWN — it just is not the selection.
  assert.match(card, /inherited/);
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
// THE RAIL IS THE AUTHORITY'S FOUR CARDS.
//
// docs/design-authority/customer-view/ — registered 2026-08-24 after two days
// untracked at the repository root. The reconciliation that ran before it was
// registered read `quote-presentation-profile-brief.md` as governing the whole
// rail and removed Commercial recovery from the surface. That brief describes
// CARD 2 OF FOUR.
//
// So the assertions below are the inverse of the ones they replace, and the
// reversal is the point: a control may move economics, be governed by Pricing,
// and live on this surface (BUNDLE.md D3).
// ═══════════════════════════════════════════════════════════════════════

const RAIL = "src/components/quote/customer-view-rail.tsx";
const CARD1 = "src/components/quote/card-commercial-recovery.tsx";

test("the rail carries Card 0 → 1 → 2 → 3 and a pinned finalize footer", async () => {
  const rail = codeOnly(await read(RAIL));
  for (const marker of [
    /card-governed/,
    /CardCommercialRecovery/,
    /card-customer-presentation/,
    /card-accounting-handoff/,
    /cv-finalize-footer/,
  ]) {
    assert.match(rail, marker, `the rail is missing ${marker}`);
  }
});

test("Commercial recovery is ON this surface, and it is card 1", async () => {
  const card = codeOnly(await read(CARD1));
  // The election writer lives here now — the inverse of what R5 asserted.
  assert.match(card, /setChargeRecovery/);

  // And picking ELECTS. The reference is immediate:
  //   pick: permitted && !s.frozen ? () => this.setRecovery(c.id, o.id) : ...
  // A measure-then-confirm step put a dialog in front of the answer, on a
  // surface whose entire point is that the answer is visible beside the
  // control.
  assert.doesNotMatch(card, /previewChargeRecovery/);
  assert.doesNotMatch(card, /Confirm/);

  const raw = await read(CARD1);
  // Header sub-line, verbatim from the reference of record.
  assert.match(raw, /Changes sell price and margin\. Runs through pricing governance\./);
});

test("Card 1 speaks the operator's vocabulary, not the engine's", async () => {
  const raw = await read(CARD1);
  // The authority's words.
  assert.match(raw, /"In unit price"/);
  assert.match(raw, /"Separate"/);
  assert.match(raw, /"Absorbed"/);

  // The deleted card's words. Every one was true; none was the operator's
  // question, which is why truth was not a sufficient test.
  //
  // Checked against codeOnly: the component's own header EXPLAINS which words
  // it stopped using, so the raw file contains every one of them as a mention.
  // Third time this trap has fired in this workstream -- a filter that cannot
  // tell a mention from a use measures nothing.
  const code = codeOnly(raw);
  for (const engineWord of [
    /Use governed amortization/,
    /legacy pricing/,
    /BV-011/,
    /BV-013/,
    /governed recovery/,
  ]) {
    assert.doesNotMatch(code, engineWord, `engine vocabulary on the operator surface: ${engineWord}`);
  }
});

test("denied treatments render disabled with their reason, never hidden", async () => {
  const card = codeOnly(await read(CARD1));
  // "Disabled options are still rendered — the constraint must be visible,
  // not hidden."
  assert.match(card, /disabled=\{[^}]*!opt\.available/);
  assert.match(card, /opt\.reason/);
  assert.doesNotMatch(
    card,
    /options\s*\.filter\([^)]*available[^)]*\)\s*\.map/,
    "the card filters denied treatments out instead of showing them refused",
  );
  // Non-vacuous: every option is mapped.
  assert.match(card, /row\.options\.map\(/);
});

test("the gate reads every governed tier, not only the ones shown", async () => {
  const card = codeOnly(await read(CARD1));
  // "Tiers not shown to the customer are still evaluated." A display toggle
  // can never clear a floor breach.
  assert.match(card, /not shown/);
  assert.match(card, /blocked/);
  assert.doesNotMatch(
    card,
    /rollups\s*\.filter\([^)]*shown/,
    "the margin gate filters to shown tiers — a presentation choice would clear a floor breach",
  );
});

test("Card 2 holds no handler that could write economics", async () => {
  const rail = codeOnly(await read(RAIL));
  const card2 = rail.slice(
    rail.indexOf("card-customer-presentation"),
    rail.indexOf("card-accounting-handoff"),
  );
  assert.ok(card2.length > 200, "card 2 not found in the rail");
  for (const forbidden of [/setChargeRecovery/, /previewChargeRecovery/, /recoverableSell/]) {
    assert.doesNotMatch(card2, forbidden, `Card 2 reaches for ${forbidden}`);
  }
});

test("absent controls are stated as absent, not faked", async () => {
  const raw = await read(RAIL);
  // The Layer-2 presentation profile has no record, so tiers-shown, the
  // include toggles, the customer note and "Customer received" cannot persist.
  // Rendering them anyway would be worse than the gap — an operator would
  // trust them.
  assert.match(raw, /cv-presentation-gap/);
  assert.match(raw, /cv-accounting-gap/);
  assert.match(raw, /would not survive a reload/);
});

test("unknown recovery is unavailable, never $0", async () => {
  // BV-013, and D5: Card 0's "Approved recovery" IS the governed
  // recoverableSell — translated, not minted, and null stays null.
  const card = codeOnly(await read(CARD1));
  assert.match(card, /totalRecovery === null \? "not priced"/);
  const rail = codeOnly(await read(RAIL));
  // Now nested under the recommended-tier empty state: with no named tier the
  // row shows "—" (no basis to state), and with one it shows "not priced"
  // when the rate is unresolved. Both are words; neither is $0.
  assert.match(rail, /approvedRecovery === null/);
  assert.match(rail, /"not priced"/);
  assert.doesNotMatch(rail, /approvedRecovery === null \? usd\(0\)/);
});

test("the document keeps the PDF iframe — no second renderer", async () => {
  // D7. A DOM preview would be a second renderer able to disagree with the
  // artifact the customer receives.
  const host = codeOnly(await read("src/components/quote/quote-host.tsx"));
  assert.match(host, /cv-sheet/);
  assert.match(host, /<iframe/);
  const css = await read("src/styles/r3-customer-view.css");
  // 816px is Letter at 96dpi — the authority's document width.
  assert.match(css, /min\(816px, 100%\)/);
  // And the reference's zoom stepper is deliberately not built.
  assert.doesNotMatch(host, /transform: scale/);
});

test("the rail stays beside the document at every width", async () => {
  const css = await read("src/styles/r3-customer-view.css");

  // `flex: none` and a width inside the authority's own railWidth range
  // (380–560, default 452). Narrowing within that range is authorised; going
  // below 380 is not.
  assert.match(css, /\.cv-rail \{[\s\S]{0,260}flex: none/);
  assert.match(css, /clamp\(380px, [^,]+, 452px\)/);

  // And NO stacking breakpoint. The authority's body is `display: flex` with a
  // `flex: none` rail — it never stacks. A media query that moves the rail
  // under the document destroys the relationship the composition is built on,
  // exactly when space is tight and it matters most.
  assert.doesNotMatch(
    css,
    /@media[^{]*\{[\s\S]*?\.cv-body\s*\{[^}]*display:\s*block/,
    "a breakpoint stacks the rail under the document again",
  );
  assert.doesNotMatch(css, /\.cv-rail \{[^}]*width: 100%/);
});

test("the gate stays while visual fidelity is unapproved", async () => {
  const brief = await read("docs/quote-presentation-restoration-brief.md");
  const state = /VISUAL_FIDELITY:\s*(\w+)/.exec(brief)?.[1];
  assert.ok(state, "the restoration brief no longer records a gate state");

  const page = codeOnly(
    await read("src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx"),
  );
  const gated = /presentationRestored = viewer\.role === "admin"/.test(page);

  if (state === "PENDING") {
    assert.ok(
      gated,
      "the rail was opened to operators while the brief still records visual fidelity as PENDING",
    );
  } else {
    assert.ok(!gated, `the brief records VISUAL_FIDELITY: ${state} but the gate is still in place`);
  }
});

test("the preview is keyed on the WHOLE customer view, not part of it", async () => {
  // Three keys have been tried here, and the first two were both too narrow:
  //
  //   `draft-${quoteStatus}`   constant on drafts -- the document never
  //                            refreshed at all
  //   recovery instruction     fixed Card 1, but a packaging or freight edit
  //                            that moves unit prices without touching OTC
  //                            recovery left it unchanged and stale again
  //   the whole view           anything that can change the document changes
  //                            the key, by construction
  //
  // The third is the only one that does not require someone to remember to add
  // a field when the document grows one.
  const host = await readFile(
    new URL("../../src/components/quote/quote-host.tsx", import.meta.url),
    "utf8",
  );
  const flat = host.replace(/\s+/g, " ");

  assert.ok(
    flat.includes("const viewDigest = hashString(JSON.stringify(view))"),
    "the key must fingerprint the whole projected view",
  );
  // It fingerprints; it must not decide. No commercial arithmetic here.
  const digestLine = host.slice(host.indexOf("const viewDigest"), host.indexOf("const iframeVersion"));
  assert.doesNotMatch(digestLine, /[*+\-/]\s*\d|recoverableSell|margin/i,
    "the digest must not derive commercial values");
});

test("the preview follows the answer; it does not gate it", async () => {
  // Rendering the customer PDF costs 1904-2627ms, measured on production.
  // Keying the iframe straight off the live src put that render in front of
  // the operator's authoritative answer.
  const host = await readFile(
    new URL("../../src/components/quote/quote-host.tsx", import.meta.url),
    "utf8",
  );
  const flat = host.replace(/\s+/g, " ");

  // Coalesced: a burst of elections costs one regeneration, not one per click.
  assert.ok(flat.includes("PREVIEW_COALESCE_MS"));
  // Downloads take the LIVE key -- never an artifact older than what is shown.
  assert.ok(flat.includes("pdfHref={targetSrc}"));
  // A caption, not a curtain: nothing about the preview disables a control.
  assert.ok(flat.includes('data-testid="cv-preview-updating"'));
  assert.ok(
    !/disabled=\{[^}]*previewStale/.test(host),
    "the preview state must never disable a commercial control",
  );
});

test("an older document can never replace a newer one", async () => {
  // Fetches are asynchronous and unordered: elect A, elect B, and B can finish
  // first. If A then resolves and promotes, the operator is left looking at a
  // document OLDER than the state beside it -- the same defect this sequence
  // has been chasing, arriving by a new route.
  //
  // The effect's cleanup already prevents it, but that makes the property a
  // consequence of React's scheduling rather than something the code states.
  // A stale promotion must not rest on an implementation detail of somebody
  // else's library, so the digest is compared at the moment of promotion.
  const host = await readFile(
    new URL("../../src/components/quote/quote-host.tsx", import.meta.url),
    "utf8",
  );
  const flat = host.replace(/\s+/g, " ");

  assert.ok(flat.includes("const latestWanted = useRef(targetSrc)"));
  assert.ok(flat.includes("latestWanted.current = targetSrc;"));
  // The request is captured, so the comparison is against what THIS fetch
  // asked for rather than whatever the closure happens to see later.
  assert.ok(flat.includes("const requested = targetSrc;"));
  assert.ok(flat.includes("await fetch(requested)"));
  // Guarded after BOTH awaits -- state can move while the body is being read.
  const guards = flat.split("latestWanted.current !== requested").length - 1;
  assert.ok(guards >= 2, `expected a guard after each await, found ${guards}`);
  assert.ok(flat.includes("setLoadedFor(requested)"), "must record what was actually promoted");
});

test("the preview fetches the document before showing it", async () => {
  // Two attempts failed the same way. Swapping the src via `key` unmounts and
  // remounts, so the pane blanked for a whole render. Loading into a hidden
  // frame and promoting on `onLoad` promoted too early, because `onLoad` fires
  // when the DOCUMENT loads, not when the PDF plugin has PAINTED it — the
  // operator saw the viewer's empty canvas, which Chrome paints dark.
  //
  // There is no "painted" event, so no frame juggling can time the swap. The
  // fix removes what is being waited on: fetch to completion first, then render
  // from a local blob.
  const host = await readFile(
    new URL("../../src/components/quote/quote-host.tsx", import.meta.url),
    "utf8",
  );
  const flat = host.replace(/\s+/g, " ");

  // Bytes first.
  assert.ok(flat.includes("const blob = await res.blob()"));
  assert.ok(flat.includes("URL.createObjectURL(blob)"));
  // One frame, never keyed, so it is never unmounted.
  assert.ok(flat.includes('<iframe src={shownSrc} title="Customer PDF preview" />'));
  assert.ok(!/key=\{(shownSrc|previewSrc|slot|targetSrc)\}/.test(host),
    "keying the preview frame remounts it and reintroduces the blank");
  // The previous document is released; a preview left open must not retain
  // every version it has shown.
  assert.ok(flat.includes("URL.revokeObjectURL(prev)"));
  // A failed fetch leaves the current document in place.
  assert.ok(flat.includes("// Leave the current document in place."));
  // Still coalesced, and downloads still take the live route URL.
  assert.ok(flat.includes("PREVIEW_COALESCE_MS"));
  assert.ok(flat.includes("pdfHref={targetSrc}"));
});




test("the workspace height is derived from the shell, not assumed", async () => {
  // The first attempt guessed `calc(100vh - 50px)`. The real chrome is 261px,
  // so the body overhung the viewport by 211px and the page grew a second
  // scrollbar — the operator had to scroll the page to reach "the act".
  //
  // 261 was evidence that the assumption was wrong, not a better constant.
  const css = await read("src/styles/r3-customer-view.css");
  assert.match(css, /height: var\(--cv-avail/);
  assert.doesNotMatch(
    css,
    /\.cv-body[\s\S]{0,160}calc\(100n?vh - \d+px\)/,
    "the workspace height is a hardcoded chrome offset again",
  );

  const host = codeOnly(await read("src/components/quote/quote-host.tsx"));
  // Derived from where the element actually sits, and re-derived on resize.
  assert.match(host, /getBoundingClientRect\(\)\.top/);
  assert.match(host, /setProperty\("--cv-avail"/);
  assert.match(host, /addEventListener\("resize"/);
});

test("no advance bar means no reservation for one", async () => {
  // `.r8-body` reserves 96px of bottom padding to clear the advance bar --
  // the stylesheet says so in as many words. The restored surface retired that
  // bar to the rail footer, so on that surface the reservation is 96px of dead
  // page below the workspace. An operator reported exactly that.
  //
  // The reservation is CORRECT wherever the bar renders, so this is not a
  // padding tweak: the modifier is keyed to the same condition that decides
  // whether the bar renders at all, and this pins the two together.
  const css = await readFile(
    new URL("../../src/styles/r8-quote-umbrella.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.r8-body\.r8-body-no-advance \{ padding-bottom: 22px; \}/);
  assert.match(css, /\.r8-body \{ flex: 1; padding: 22px 24px 96px; \}/, "base reservation kept");

  const umbrella = await readFile(
    new URL("../../src/components/quote-umbrella/quote-umbrella.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    umbrella,
    /presentationRestored && activeTab === "preview" \? " r8-body-no-advance"/,
    "the modifier must key on the same condition that suppresses the bar",
  );

  // The condition on the other side, so a change to one fails against the other.
  const tab = await readFile(
    new URL("../../src/components/quote-umbrella/tab-preview-quote.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tab, /if \(presentationRestored\) \{/);
});

test("Continue to Send is superseded on the restored surface, not suppressed", async () => {
  // Disposition, Edward 2026-08-24: Freeze & send is the single canonical final
  // action on the restored Customer View, and the legacy bar is obsolete there.
  //
  // The restored branch must RETURN before `AdvanceBar` is referenced. A
  // conditional render would leave the old control one boolean away from
  // coming back — and that boolean is the admin gate, which is going to be
  // removed. Suppression that depends on a flag you intend to delete is not
  // suppression, so this asserts the structure rather than the behaviour.
  const src = await readFile(
    new URL("../../src/components/quote-umbrella/tab-preview-quote.tsx", import.meta.url),
    "utf8",
  );
  const restored = src.slice(
    src.indexOf("if (presentationRestored) {"),
    src.indexOf("const adv = computeUmbrellaAdvance"),
  );
  assert.ok(restored.length > 0, "the restored branch is not a distinct return");
  assert.doesNotMatch(
    restored,
    /AdvanceBar/,
    "the restored branch still reaches the superseded control",
  );
  // And the legacy path keeps it — only while that surface exists.
  assert.match(src, /<AdvanceBar/);
});

test("the umbrella shell is sized by its container, not by the viewport", async () => {
  // The defect this pins is arithmetic, not taste. `.r8-shell` sits beneath the
  // surface chrome, so a `100vh` claim here means the document is 100vh PLUS the
  // chrome — every sub-tab overflows by exactly the chrome's height whatever it
  // contains. Upstream is not wrong; upstream renders this element as the
  // document root, where the claim and the viewport are the same box.
  const css = await readFile(
    new URL("../../src/styles/r8-quote-umbrella.css", import.meta.url),
    "utf8",
  );
  const shell = css.slice(css.indexOf(".r8-shell {"));
  const decl = shell.slice(0, shell.indexOf("}"));
  assert.doesNotMatch(
    decl,
    /min-height:\s*100[sd]?vh/,
    ".r8-shell must not claim a viewport it does not start at",
  );
  assert.match(decl, /flex:\s*1 0 auto/, "grow into what the chrome leaves");

  // And the container that supplies the height actually wraps it. Sizing from a
  // parent that is not a flex column is sizing from nothing.
  assert.match(css, /\.r8-viewport \{[^}]*min-height:\s*100vh/);
  assert.match(css, /\.r8-viewport \{[^}]*flex-direction:\s*column/);
  const page = await readFile(
    new URL(
      "../../src/app/projects/[id]/quotes/[quoteId]/quote/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(page, /className="r8-viewport"/);

  // No constant. A subtraction here would have to be re-derived every time the
  // chrome above changes, and nothing would report that it had gone stale.
  assert.doesNotMatch(css, /calc\(100vh\s*-\s*\d/);
});

test("Card 0 states the absence rather than substituting a tier", async () => {
  // "The last tier" and "the recommended tier" are different facts.
  const rail = codeOnly(await read("src/components/quote/customer-view-rail.tsx"));
  assert.match(rail, /No recommended tier/);

  const resolver = codeOnly(await read("src/lib/customer-view-resolver.ts"));
  assert.doesNotMatch(
    resolver,
    /rollups\[rollups\.length - 1\]/,
    "the resolver substitutes the last rollup for the recommended tier again",
  );
  // And the tier-scoped amounts go with it — each needs a tier basis.
  assert.match(resolver, /chargesAtCost: rec \? cost : null/);
  assert.match(resolver, /approvedRecovery: rec \? recovery : null/);
});

// ═══════════════════════════════════════════════════════════════════════
// EVERY TOKEN THIS SURFACE REFERENCES MUST EXIST.
//
// The first fidelity pass wrote `var(--sans)`, `var(--rule-strong)`,
// `var(--canvas)`, `var(--danger)` and `var(--ok)`. None of those tokens
// exist. A `font:` shorthand containing an undefined custom property is
// INVALID AT COMPUTED-VALUE TIME, so the whole declaration is dropped — every
// size and leading in the stylesheet was silently discarded and the rail
// inherited 14px/21px throughout.
//
// It read as "loose typography" rather than as broken, because the family
// still inherited from `body`. Two rounds of transcribing exact values from
// the reference changed nothing, and could not have.
//
// This is the check that makes the failure loud. It is a real gap in the
// platform: nothing else asserts that a stylesheet's tokens resolve.
// ═══════════════════════════════════════════════════════════════════════

test("every custom property the Customer View references is defined", async () => {
  const css = await read("src/styles/r3-customer-view.css");
  const tokens = await read("src/styles/design-tokens.css");

  // Comments name the tokens that were WRONG, so they must not be scanned.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const defined = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
  const used = new Set([...code.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));

  // Set at runtime by quote-host from the measured shell height.
  used.delete("--cv-avail");

  const missing = [...used].filter((t) => !defined.has(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `undefined tokens — every declaration using one is silently dropped: ${missing.join(", ")}`,
  );

  // Non-vacuous: the scan sees real tokens.
  assert.ok(used.size > 10, `only ${used.size} tokens scanned — the regex is not matching`);
  assert.ok(defined.has("--ui"), "the token file was not read");
});
