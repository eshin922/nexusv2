/**
 * The rule that decides whether an elected charge is priced.
 *
 * Behaviour of the predicate here; the end-to-end proof through the real
 * writers is `scripts/gate-1b/od-032-recovery-ask-proof.ts`, because whether a
 * quote can be FINALIZED is a property of the surface, the gate and the
 * database together and no unit test can observe it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { treatmentRequiresAsk } from "../../src/lib/component-charges/recovery-pricing-rule.ts";

const read = (p: string) => readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");

test("the treatments that put a number in front of the customer require one", () => {
  // Both of these state an amount the customer sees — `separate` as its own
  // line, `included` inside the unit price. Neither can be built from an amount
  // nobody has given.
  assert.equal(treatmentRequiresAsk("separate"), true);
  assert.equal(treatmentRequiresAsk("included"), true);
});

test("absorbed does not, because recovering nothing is the decision", () => {
  // Not an omission. Requiring an ask here would make the operator type a zero
  // to say the thing the treatment already says.
  assert.equal(treatmentRequiresAsk("absorbed"), false);
});

test("unplaced is not this gate's business", () => {
  // The placement gate already refuses it. Reporting the same charge twice
  // would send an operator to price something they have not decided to bill.
  assert.equal(treatmentRequiresAsk(null), false);
});

test("an unknown mode does not silently acquire an obligation", () => {
  // Fail CLOSED on the requirement, not on the refusal: a mode this rule has
  // never heard of must not be treated as requiring an ask, because the gate
  // would then block a quote for a reason nobody can act on. A new mode is a
  // deliberate extension of this function.
  assert.equal(treatmentRequiresAsk("some_future_mode"), false);
});

// ══════════════════════════════════════════════════════════════════════
// One rule, both boundaries
// ══════════════════════════════════════════════════════════════════════

test("the send gate and the rail read the SAME diagnostic", () => {
  const send = read("src/app/actions/quotes.ts");
  const resolver = read("src/lib/customer-view-resolver.ts");

  // The server refusal.
  assert.match(send, /readChargeRecoveryPricingGaps\(quoteId\)/);
  assert.match(send, /elected for recovery but not priced/);

  // The surface's prediction of it, from the same function — not a second
  // implementation free to disagree about whether the quote may go out.
  assert.match(resolver, /readChargeRecoveryPricingGaps\(quote\.id\)/);

  const rail = read("src/components/quote/customer-view-rail.tsx");
  assert.match(rail, /chargeRecoveryPricingGaps\.map\(describeMissingAsk\)/);
  assert.match(rail, /hasUnpricedRecovery/);
  // And it must actually gate the button, not merely render a line.
  assert.match(rail, /disabled=\{[\s\S]{0,200}hasUnpricedRecovery/);
});

test("nothing coalesces a missing ask to zero", () => {
  // BV-013 at the place it is most tempting to break: the arithmetic would
  // proceed cleanly if a null became 0, and the customer would be told the
  // charge costs nothing. `absorbed` is how "recover nothing" is said.
  const src = read("src/lib/component-charges/recovery-pricing.ts");
  assert.doesNotMatch(src, /recoveryAsk\s*\?\?\s*0/);
  assert.doesNotMatch(src, /Number\(\s*r\.recoveryAsk\s*\|\|\s*0\s*\)/);
  // A tier row existing is not a tier being priced.
  assert.match(src, /r\.recoveryAsk !== null/);
});

test("the refusal names the charge and the tiers, not a count", () => {
  const src = read("src/lib/component-charges/recovery-pricing.ts");
  const rule = read("src/lib/component-charges/recovery-pricing-rule.ts");
  assert.match(src, /missingTierLabels/);
  assert.match(rule, /export function describeMissingAsk/);
  // Measured against the QUOTED tiers, matching readiness — a charge priced at
  // every tier it happens to have a row for is complete only if those are all
  // the tiers the quote sells.
  assert.match(src, /tiers\.filter\(\(t\) => !e\.asked\.has\(t\.id\)\)/);
});

test("the existing cost readiness states are untouched", () => {
  // The brief is explicit: do not redefine none/partial/complete. They answer
  // "what does DPS pay", are rendered as a chip on Costs, and are refused on by
  // a gate whose words are "no cost entered".
  const readiness = read("src/lib/component-charges/readiness.ts");
  assert.match(readiness, /e\.costed\.size === 0 \? "none"/);
  assert.doesNotMatch(readiness, /recoveryAsk/);
  assert.doesNotMatch(readiness, /recovery_ask/);
});

test("no client component reaches the database module for a pure symbol", () => {
  // THE BUILD IS THE ONLY THING THAT CAUGHT THIS. An earlier revision
  // re-exported the pure rule from the reader "so callers have one import
  // site"; the rail then imported `describeMissingAsk` from there, the reader
  // imports `@/db`, and postgres went into the browser bundle —
  // `Can't resolve 'fs'`. tsc was clean and verify:ci was clean.
  //
  // The re-export is gone, so the wrong import no longer type-checks. This
  // asserts the property directly, because a future re-export would make it
  // compile again and only Vercel would notice.
  const reader = read("src/lib/component-charges/recovery-pricing.ts");
  assert.doesNotMatch(
    reader,
    /export \{[^}]*(describeMissingAsk|treatmentRequiresAsk)/,
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
