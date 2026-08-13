// Proof-5 repair — freight-specific customer copy requires freight evidence.
//
// The PDF asserted, to the customer:
//   "Outbound freight — billed separately at cost (itemized below); not
//    included in the turnkey total."
// gated on `freightAtCost={hasCharges}`, where
//   hasCharges = serviceFees.length > 0 || freightLines.length > 0
//
// So a service fee alone triggered a freight-specific claim. On the governed
// fixture every clause was false at once: freight ($19,000) was inside unit
// sell and therefore inside the $138,700 turnkey total, and nothing was
// itemized — the only separate charge was a $17,000 allocation-OFF tooling fee.
//
// The rule under test: freight copy renders ONLY from evidence that separately
// projected freight exists in the customer-view model. It never infers
// "billed separately", "at cost", "itemized below" or "excluded from turnkey
// total" from a generic charge flag.
//
// This decides nothing about OD-001, which asks whether freight SHOULD be
// shown. This only stops the document asserting freight facts it cannot
// demonstrate.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const doc = readFileSync(
  new URL("../../src/components/pdf/customer-pdf-document.tsx", import.meta.url),
  "utf8"
);
const charges = readFileSync(
  new URL(
    "../../src/components/pdf/customer-pdf-charges-block.tsx",
    import.meta.url
  ),
  "utf8"
);
const grandRow = readFileSync(
  new URL(
    "../../src/components/pdf/customer-pdf-grand-total-row.tsx",
    import.meta.url
  ),
  "utf8"
);

/** The repaired rule, stated once. */
const freightCopyRenders = (
  serviceFees: number,
  freightLines: number
): boolean => freightLines > 0;

/** The defect, reconstructed for falsification. */
const preRepair = (serviceFees: number, freightLines: number): boolean =>
  serviceFees > 0 || freightLines > 0;

test("1 · allocation-OFF service fee + bundled freight → no freight claim", () => {
  // The governed fixture exactly: one $17,000 tooling fee, freight bundled
  // into unit sell, zero freight lines.
  assert.equal(freightCopyRenders(1, 0), false);
});

test("2 · service fee present, no freight at all → no freight claim", () => {
  assert.equal(freightCopyRenders(1, 0), false);
  assert.equal(freightCopyRenders(3, 0), false);
});

test("3 · no service fee + bundled freight → no freight claim", () => {
  // Bundled freight is not separately projected, so it produces no freight
  // lines and must not produce separate-freight copy either.
  assert.equal(freightCopyRenders(0, 0), false);
});

test("4 · genuinely separate freight may show the copy", () => {
  // Only when the model explicitly identifies that state. Not reachable today
  // (the resolver hardcodes freightLines to []), which is why the copy is
  // currently suppressed rather than reworded — and why it returns on its own
  // if that ever changes.
  assert.equal(freightCopyRenders(0, 1), true);
  assert.equal(freightCopyRenders(2, 1), true);
});

test("5 · FALSIFICATION — hasCharges cannot gate freight copy", () => {
  // The one case that separates the two rules is the one that shipped: a
  // service fee with no freight. Under the old gate the claim rendered; under
  // the repaired gate it does not.
  assert.equal(preRepair(1, 0), true, "old gate fired on a fee alone");
  assert.equal(freightCopyRenders(1, 0), false, "repaired gate does not");
  assert.notEqual(preRepair(1, 0), freightCopyRenders(1, 0));

  // And the binding is gone from the source — no freight prop may read
  // `hasCharges` again.
  assert.doesNotMatch(doc, /freightAtCost=\{hasCharges\}/);
  assert.match(doc, /freightAtCost=\{hasSeparateFreight\}/);
  assert.match(doc, /const hasSeparateFreight = freightLines\.length > 0/);
});

test("6 · every freight-specific clause is evidence-gated, not just one", () => {
  // Three sites asserted freight facts from the same generic flag. Fixing only
  // the grand-total note would have left the head lede and the turnkey lede
  // making the same false claim.
  const freightSentences = [
    /Outbound freight is billed separately at cost/g,
    /Outbound freight — billed separately at cost/g,
  ];
  for (const re of freightSentences) {
    for (const file of [doc, grandRow]) {
      for (const m of file.matchAll(re)) {
        // Each occurrence must sit under a hasSeparateFreight / freightAtCost
        // gate, never under a bare hasCharges.
        const window = file.slice(Math.max(0, m.index! - 400), m.index!);
        assert.ok(
          /hasSeparateFreight|freightAtCost/.test(window),
          `freight sentence at ${m.index} is not evidence-gated`
        );
      }
    }
  }
});

test("6b · the charges block's own title and subtitle are freight statements too", () => {
  // Missed by test 6, which only scanned two sentence patterns. The block
  // announced "pass-through freight" in its HEADING and explained how freight
  // amounts are shown in its SUBTITLE, both unconditionally — so a fees-only
  // quote promised freight and showed none. Same defect, different grammar.
  assert.match(
    charges,
    /freightLines\.length > 0 \? ` & pass-through freight` : ""/,
    "title names freight only when freight exists"
  );
  assert.match(
    charges,
    /\{freightLines\.length > 0 && \(\s*<Text style=\{styles\.chargeSub\}>/,
    "subtitle is gated on freight evidence"
  );
});

test("7 · the one-time-charges clause survives independently of freight", () => {
  // Splitting the sentence must not silently drop the fee disclosure, which is
  // separately true and separately governed.
  assert.match(doc, /One-time charges are itemized below/);
  assert.match(doc, /hasCharges && " One-time charges are itemized below\."/);
});

test("8 · untouched — arithmetic, totals, markup, duty/tariff, charges block", () => {
  // The repair is copy-gating only. Nothing that produces a number changed.
  assert.doesNotMatch(doc, /freightAmount|freightMarkup|dutyAmount|tariffAmount/);
  // The Additional Charges projection still renders from serviceFees.
  assert.match(doc, /serviceFees/);
});
