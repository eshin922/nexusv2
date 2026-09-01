/**
 * The rule that decides whether an elected component charge's recovery is
 * resolved — and, since 2026-08-31, the falsification that it can be resolved
 * AT ALL through the current architecture.
 *
 * ── THE REGRESSION THESE TESTS EXIST FOR ────────────────────────────────
 *
 * #496 (2026-08-28) made the send gate require `quote_charge_instance_tiers.
 * recovery_ask` to be non-null. #501 (2026-08-29) made the charge TYPE the
 * pricing authority and deleted the only input that wrote that column. One day
 * apart. The gate was not moved with the authority, so it demanded a value no
 * surface could supply and no engine consumed: every quote carrying a costed,
 * elected component charge was unsendable.
 *
 * It went unseen for three days because it needed a charge both COSTED and
 * ELECTED to fire, and no quote in the database had ever had one — the cost
 * gate refused first, every time. O3 was the first, and found it immediately.
 * Pattern 56: a property that held only because nothing reached it.
 *
 * The old suite could not have caught it. It tested the predicate and then
 * asserted the reader's source text — including, verbatim, the very expression
 * that was the defect (`r.recoveryAsk !== null`). A test that pins the broken
 * line is not a control; it is a lock. So the decision moved into the pure rule
 * module and these run against it directly, with fixtures, exercising every
 * branch a quote can reach.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  treatmentRequiresRecovery,
  describeRecoveryGap,
  computeChargeRecoveryGaps,
  type ChargeRecoveryInstanceInput,
} from "../../src/lib/component-charges/recovery-pricing-rule.ts";

const read = (p: string) => readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");

/**
 * The file with its COMMENTS REMOVED.
 *
 * Every assertion below of the form "this symbol does not appear" is about
 * CODE. These modules explain, at length and on purpose, the history of the
 * column they no longer read — and a plain text match cannot tell an
 * explanation from a use.
 *
 * The suite already carried this scar: an earlier assertion matched a module's
 * own comment about why it must not import `@/db` and reported a defect that
 * did not exist. The first draft of THIS file reproduced it four times over,
 * failing on its own prose. An instrument that cannot distinguish the thing it
 * forbids from a description of it is measuring the wrong text.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ══════════════════════════════════════════════════════════════════════
// Fixtures
// ══════════════════════════════════════════════════════════════════════

const TIERS = [
  { id: "t1", label: "Tier 1" },
  { id: "t2", label: "Tier 2" },
  { id: "t3", label: "Tier 3" },
];

/**
 * The real governed rates, so a passing test is passing against the authority
 * the engine uses rather than a convenient number. `Tooling` prices
 * `print_plates` and `tooling`; `Manufacturing` prices `artwork_plate` and
 * `samples`. Verified against `markup_defaults` 2026-08-31.
 */
const MARKUPS = { Tooling: 0.2, Manufacturing: 0.3, Primary: 0.45, Secondary: 0.5 };

/** O3's two print-plate instances: same type, different owners. */
function labelPlates(
  over: Partial<ChargeRecoveryInstanceInput> = {},
): ChargeRecoveryInstanceInput {
  return {
    chargeInstanceId: "ci-label",
    chargeKey: "print_plates",
    ownLabel: null,
    label: "Print plates",
    quoteLeafId: "leaf-label",
    mode: "separate",
    costByTier: new Map([
      ["t1", 1240],
      ["t2", 1240],
      ["t3", 1860],
    ]),
    ...over,
  };
}

function sleevePlates(
  over: Partial<ChargeRecoveryInstanceInput> = {},
): ChargeRecoveryInstanceInput {
  return {
    chargeInstanceId: "ci-sleeve",
    chargeKey: "print_plates",
    ownLabel: null,
    label: "Print plates",
    quoteLeafId: "leaf-sleeve",
    mode: "included",
    costByTier: new Map([
      ["t1", 1685],
      ["t2", 1685],
      ["t3", 2530],
    ]),
    ...over,
  };
}

const gapsFor = (instances: ChargeRecoveryInstanceInput[]) =>
  computeChargeRecoveryGaps({ tiers: TIERS, instances, markupDefaults: MARKUPS });

// ══════════════════════════════════════════════════════════════════════
// 1 · THE HISTORICAL DEFECT
// ══════════════════════════════════════════════════════════════════════

test("costed and elected with no recovery_ask anywhere now PASSES", () => {
  // Exactly O3's state, and exactly what the gate refused for three days. There
  // is no `recovery_ask` in the input at all — not null, ABSENT — because the
  // column is no longer part of the decision in any form.
  assert.deepEqual(gapsFor([labelPlates(), sleevePlates()]), []);
});

test("the SAME fixture is refused by the pre-repair rule", () => {
  // The falsification, stated rather than asserted in prose.
  //
  // #496's condition was: for every quoted tier of a charge whose treatment
  // requires recovery, `recovery_ask` must be non-null. Reproduced here EXACTLY
  // — it is four lines — and applied to the fixture the repaired rule passes.
  //
  // This is what makes the test above mean something. Without it "no gaps" is
  // equally consistent with a rule that has stopped checking anything, and the
  // control has to be able to fail on the same input for the pass to be
  // evidence. O3's twelve rows are all null, so the old gate returned a gap for
  // every elected charge and the quote could not be sent at any tier.
  const preRepairGaps = [labelPlates(), sleevePlates()].filter((e) => {
    if (!treatmentRequiresRecovery(e.mode)) return false;
    const askedAt = new Set<string>(); // recovery_ask is null on every row
    return TIERS.some((t) => !askedAt.has(t.id));
  });
  assert.equal(preRepairGaps.length, 2, "pre-repair: both charges refused");
  assert.deepEqual(gapsFor([labelPlates(), sleevePlates()]), [], "repaired: neither");
});

test("...and the input type has no way to express a recovery_ask", () => {
  // The stronger statement: the repair is not "we stopped reading it", it is
  // "there is nowhere to put it". A caller trying to resurrect the manual value
  // fails to compile rather than being quietly ignored.
  assert.doesNotMatch(
    code("src/lib/component-charges/recovery-pricing-rule.ts"),
    /recoveryAsk|recovery_ask/,
  );
});

// ══════════════════════════════════════════════════════════════════════
// 2 · MISSING COST STILL REFUSES
// ══════════════════════════════════════════════════════════════════════

test("elected but one quoted tier has no cost — still refused", () => {
  const partial = labelPlates({
    costByTier: new Map([
      ["t1", 1240],
      ["t3", 1860],
    ]),
  });
  const gaps = gapsFor([partial, sleevePlates()]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].chargeInstanceId, "ci-label");
  assert.equal(gaps[0].reason, "missing_cost");
  assert.deepEqual(gaps[0].missingTierLabels, ["Tier 2"]);
  // Named tier, not a count: the operator has to know WHICH one.
  assert.match(describeRecoveryGap(gaps[0]), /Tier 2/);
  assert.match(describeRecoveryGap(gaps[0]), /on Costs/);
});

test("a charge with no cost at all is refused, not skipped", () => {
  // The worst case of this gap, and the one an inner join would have dropped —
  // reporting nothing wrong about the charge with nothing entered.
  const gaps = gapsFor([labelPlates({ costByTier: new Map() })]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, "missing_cost");
  assert.deepEqual(gaps[0].missingTierLabels, ["Tier 1", "Tier 2", "Tier 3"]);
});

// ══════════════════════════════════════════════════════════════════════
// 3 · MISSING ELECTION STILL REFUSES
// ══════════════════════════════════════════════════════════════════════

test("fully costed but undecided — still refused", () => {
  const gaps = gapsFor([labelPlates({ mode: null }), sleevePlates()]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].chargeInstanceId, "ci-label");
  assert.equal(gaps[0].reason, "undecided");
  // And it names the surface where a treatment is actually chosen.
  assert.match(describeRecoveryGap(gaps[0]), /Commercial Recovery/);
  assert.doesNotMatch(describeRecoveryGap(gaps[0]), /on Costs/);
});

test("absorbed is a decision to recover nothing, not a gap", () => {
  // BV-013's other half. `absorbed` is how "recover nothing" is SAID; refusing
  // it would make a stated decision unsendable.
  assert.deepEqual(gapsFor([labelPlates({ mode: "absorbed" })]), []);
  assert.equal(treatmentRequiresRecovery("absorbed"), false);
  assert.equal(treatmentRequiresRecovery("separate"), true);
  assert.equal(treatmentRequiresRecovery("included"), true);
  assert.equal(treatmentRequiresRecovery(null), false);
  // An unknown future mode must not silently acquire an obligation.
  assert.equal(treatmentRequiresRecovery("some_future_mode"), false);
});

// ══════════════════════════════════════════════════════════════════════
// 4 · TWO SAME-TYPE INSTANCES ARE INDEPENDENT
// ══════════════════════════════════════════════════════════════════════

test("two print_plates on different owners, different treatments, both pass", () => {
  // O3's control. A gate keyed by `charge_key` would have to give these one
  // answer; they have different owners, different tier costs and different
  // elections, and both are independently valid.
  const gaps = gapsFor([labelPlates(), sleevePlates()]);
  assert.deepEqual(gaps, []);
});

test("breaking ONE instance fails only that instance", () => {
  for (const broken of ["ci-label", "ci-sleeve"] as const) {
    const instances = [labelPlates(), sleevePlates()].map((e) =>
      e.chargeInstanceId === broken ? { ...e, costByTier: new Map([["t1", 100]]) } : e,
    );
    const gaps = gapsFor(instances);
    assert.equal(gaps.length, 1, `${broken}: exactly one instance should fail`);
    assert.equal(gaps[0].chargeInstanceId, broken);
    // The sibling is untouched — a valid recovery on one neither satisfies nor
    // implicates the other.
  }
});

test("removing ONE instance's election fails only that instance", () => {
  for (const broken of ["ci-label", "ci-sleeve"] as const) {
    const instances = [labelPlates(), sleevePlates()].map((e) =>
      e.chargeInstanceId === broken ? { ...e, mode: null } : e,
    );
    const gaps = gapsFor(instances);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].chargeInstanceId, broken);
    assert.equal(gaps[0].reason, "undecided");
  }
});

test("one instance's recovery does not satisfy the other's", () => {
  // The collapse test stated as an identity rather than a count: if the gate
  // keyed by charge_key, resolving `print_plates` once would clear both, and
  // this fixture — one resolved, one not — would report zero gaps.
  const gaps = gapsFor([labelPlates(), sleevePlates({ costByTier: new Map() })]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].chargeInstanceId, "ci-sleeve");
  assert.equal(gaps[0].chargeKey, "print_plates");
});

// ══════════════════════════════════════════════════════════════════════
// 5 · UNRESOLVED GOVERNED AUTHORITY
// ══════════════════════════════════════════════════════════════════════

test("a charge type with no governed category cannot be sent", () => {
  // `other_service` is deliberately unclassified (BV-013): it recovers nothing
  // and must not acquire 0.30 because a category named `Other` exists. Elected
  // for recovery, it is unsendable — which is #496's invariant, reached through
  // the current authority instead of a manual field.
  const gaps = gapsFor([labelPlates({ chargeKey: "other_service", label: "Other" })]);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, "no_authority");
  const copy = describeRecoveryGap(gaps[0]);
  assert.match(copy, /pricing-configuration blocker/);
  // It must NOT send the operator to a surface, because no surface fixes this.
  assert.doesNotMatch(copy, /on Costs/);
  assert.doesNotMatch(copy, /Commercial Recovery/);
});

test("a governed category with no markup_defaults row cannot be sent", () => {
  // The second way to reach an unpriced charge: the type maps to a category and
  // the category has no governed rate. `resolveMarkupStrict` yields null rather
  // than a fallback, and null must refuse rather than become zero.
  const gaps = computeChargeRecoveryGaps({
    tiers: TIERS,
    instances: [labelPlates()],
    markupDefaults: { Manufacturing: 0.3 }, // no `Tooling`
  });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, "no_authority");
  assert.deepEqual(gaps[0].missingTierLabels, ["Tier 1", "Tier 2", "Tier 3"]);
});

test("derivability is validated, never a positive amount", () => {
  // A governed rate of ZERO is a governed answer, not an absent one. The gap is
  // the absence of an answer — so a real 0.00 category must PASS.
  const gaps = computeChargeRecoveryGaps({
    tiers: TIERS,
    instances: [labelPlates()],
    markupDefaults: { ...MARKUPS, Tooling: 0 },
  });
  assert.deepEqual(gaps, [], "a governed zero rate resolves and must not refuse");
});

// ══════════════════════════════════════════════════════════════════════
// The arithmetic has ONE home
// ══════════════════════════════════════════════════════════════════════

test("the gate derives no recovery of its own", () => {
  // A second copy of `cost * (1 + rate)` would be a second authority on what a
  // charge recovers, free to disagree with the engine about whether the quote
  // may go out. The rule CALLS `componentChargeEconomics`; it does not repeat
  // it, and it resolves no markup itself.
  const rule = code("src/lib/component-charges/recovery-pricing-rule.ts");
  assert.match(rule, /import \{ componentChargeEconomics \} from "@\/lib\/costing"/);
  assert.doesNotMatch(rule, /1 \+ (rate|ratePct|markup)/);
  assert.doesNotMatch(rule, /resolveMarkupStrict/);

  const reader = code("src/lib/component-charges/recovery-pricing.ts");
  assert.doesNotMatch(reader, /1 \+ (rate|ratePct|markup)/);
  // And the reader measures against the quote's PINNED rates, not today's.
  assert.match(reader, /resolveQuoteCommercialSettings\(quoteId\)/);
});

test("representability is asked of the one exported predicate", () => {
  const rule = read("src/lib/component-charges/recovery-pricing-rule.ts");
  assert.match(rule, /import \{ isUnbillablePlacement \}/);
  // Two copies of that condition would be two authorities on whether a quote
  // may go out.
  assert.doesNotMatch(rule, /ownerKind === "direct_service"/);
});

// ══════════════════════════════════════════════════════════════════════
// 6 · NO RESURRECTION
// ══════════════════════════════════════════════════════════════════════

test("no operator action or component writes recovery_ask", () => {
  // #501 removed the input and the writer by design. This asserts the property
  // rather than trusting the removal to stay removed: restoring either would
  // create a second recovery authority competing with the charge type.
  // Comments stripped: `update.ts` and the drilldown both explain at length
  // why the field is gone, and an explanation is not a writer.
  assert.doesNotMatch(code("src/app/actions/component-charges.ts"), /recoveryAsk|recovery_ask/);

  const drilldown = code("src/components/costs/packaging-drilldown.tsx");
  assert.doesNotMatch(drilldown, /field="recovery"/);
  assert.doesNotMatch(drilldown, /recoveryAsk/);
});

test("the gate no longer reads recovery_ask as commercial authority", () => {
  const reader = code("src/lib/component-charges/recovery-pricing.ts");
  const rule = code("src/lib/component-charges/recovery-pricing-rule.ts");
  for (const [name, src] of [
    ["reader", reader],
    ["rule", rule],
  ] as const) {
    // Not as authority, not as a fallback, not as a tiebreak: the column is
    // absent from the decision, which is stronger than being ignored.
    assert.doesNotMatch(src, /recoveryAsk|recovery_ask/, `${name} still reads the dead column`);
  }
  // It IS still explained in prose, deliberately — the history is why the gate
  // looks the way it does.
  assert.match(read("src/lib/component-charges/recovery-pricing.ts"), /recovery_ask/);
});

test("the dead remediation is gone from every refusal", () => {
  // The sentence that sent operators to a deleted field. Any refusal naming
  // Costs must be about COST, which is a fact Costs still owns.
  const rule = read("src/lib/component-charges/recovery-pricing-rule.ts");
  assert.doesNotMatch(rule, /what the customer is charged .{0,40}on Costs/);
  const send = read("src/app/actions/quotes.ts");
  assert.doesNotMatch(send, /Enter what the customer is charged/);
});

// ══════════════════════════════════════════════════════════════════════
// One rule, both boundaries
// ══════════════════════════════════════════════════════════════════════

test("the send gate and the rail read the SAME diagnostic", () => {
  const send = read("src/app/actions/quotes.ts");
  const resolver = read("src/lib/customer-view-resolver.ts");

  assert.match(send, /readChargeRecoveryPricingGaps\(quoteId\)/);
  assert.match(send, /unresolved recovery/);

  // The surface's prediction of it, from the same function — not a second
  // implementation free to disagree about whether the quote may go out.
  assert.match(resolver, /readChargeRecoveryPricingGaps\(quote\.id\)/);

  const rail = read("src/components/quote/customer-view-rail.tsx");
  assert.match(rail, /chargeRecoveryPricingGaps\.map\(describeRecoveryGap\)/);
  assert.match(rail, /hasUnpricedRecovery/);
  // And it must actually gate the button, not merely render a line.
  assert.match(rail, /disabled=\{[\s\S]{0,200}hasUnpricedRecovery/);
});

test("the existing cost readiness states are untouched", () => {
  // Do not redefine none/partial/complete. They answer "what does DPS pay", are
  // rendered as a chip on Costs, and are refused on by a gate whose words are
  // "no cost entered".
  const readiness = read("src/lib/component-charges/readiness.ts");
  assert.match(readiness, /e\.costed\.size === 0 \? "none"/);
  assert.doesNotMatch(readiness, /recoveryAsk/);
  assert.doesNotMatch(readiness, /recovery_ask/);
});

test("no client component reaches the database module for a pure symbol", () => {
  // THE BUILD IS THE ONLY THING THAT CAUGHT THIS. An earlier revision
  // re-exported the pure rule from the reader "so callers have one import
  // site"; the rail then imported the describe helper from there, the reader
  // imports `@/db`, and postgres went into the browser bundle —
  // `Can't resolve 'fs'`. tsc was clean and verify:ci was clean.
  const reader = read("src/lib/component-charges/recovery-pricing.ts");
  assert.doesNotMatch(
    reader,
    /export \{[^}]*(describeRecoveryGap|treatmentRequiresRecovery|computeChargeRecoveryGaps)/,
    "the db-importing module must not re-export the pure rule",
  );

  for (const client of [
    "src/components/quote/customer-view-rail.tsx",
    "src/components/quote/quote-host.tsx",
    "src/components/quote-umbrella/tab-preview-quote.tsx",
    "src/components/quote-umbrella/quote-umbrella.tsx",
  ]) {
    const src = read(client);
    assert.doesNotMatch(
      src,
      /from "@\/lib\/component-charges\/recovery-pricing"/,
      `${client} must take the rule from recovery-pricing-rule, not the reader`,
    );
  }

  // And the rule module must stay free of the thing that made this possible.
  // Matched on IMPORT STATEMENTS, not on the text anywhere: the first version
  // of this assertion matched the module's own comment explaining why it must
  // not import `@/db`, and reported a defect that did not exist.
  const rule = read("src/lib/component-charges/recovery-pricing-rule.ts");
  const imports = [...rule.matchAll(/^\s*import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(
    imports.filter((i) => /@\/db|drizzle-orm|postgres/.test(i)),
    [],
    `the pure rule imports a database module: ${imports.join(", ")}`,
  );
});
