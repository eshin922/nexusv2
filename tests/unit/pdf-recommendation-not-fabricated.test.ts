/**
 * The customer document never invents a recommendation.
 *
 * WHAT IT DID. `customer-view-resolver` fell back to
 * `Math.floor(tiers.length / 2)` when no tier carried
 * `quote_tiers.recommended`. On the live four-tier fixture — every flag false,
 * verified — the PDF highlighted Tier 3 and told the customer "Tier 3 is
 * recommended for first-PO production runs." The firm had made no such
 * recommendation. Pricing said "None chosen" throughout; the two surfaces were
 * not disagreeing about data, one of them was manufacturing it.
 *
 * A SECOND FABRICATION SAT UNDER THE FIRST. `customer-view-to-cpdf` coerced
 * `?? 0`, so even a null-returning resolver would have produced Tier 1 — and
 * the charges block reads that index to choose which tier's freight to quote
 * per unit AND names that tier to the customer.
 *
 * A recommendation is a commercial claim. It comes from the flag or it does not
 * exist, and it is never inferred from tier order.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const resolver = stripComments(readFileSync("src/lib/customer-view-resolver.ts", "utf8"));
const adapter = stripComments(readFileSync("src/lib/customer-view-to-cpdf.ts", "utf8"));
const doc = stripComments(readFileSync("src/components/pdf/customer-pdf-document.tsx", "utf8"));
const charges = stripComments(
  readFileSync("src/components/pdf/customer-pdf-charges-block.tsx", "utf8"),
);

test("the resolver never derives a recommendation from tier position", () => {
  // Comments stripped first — the rationale describes the fallback it removed,
  // and a check that reads its own explanation as the defect never passes.
  assert.doesNotMatch(
    resolver,
    /Math\.floor\(tiers\.length \/ 2\)/,
    "the middle-tier fallback must be gone, not merely unreachable",
  );
  // And the only source is the flag.
  assert.match(resolver, /tierRecommendedRows\.find\(\(t\) => t\.recommended\)\?\.id \?\? null/);
  assert.match(resolver, /const recommendedTierIdx = idx === -1 \? null : idx;/);
});

test("the adapter passes null through instead of coercing to Tier 1", () => {
  assert.match(adapter, /recommendedTierIdx: view\.recommendedTierIdx,/);
  assert.doesNotMatch(adapter, /recommendedTierIdx: view\.recommendedTierIdx \?\? 0/);
});

test("THE CUSTOMER SENTENCE IS GATED ON A REAL RECOMMENDATION", () => {
  // The claim itself: "{Tier N} is recommended for first-PO production runs."
  // It renders only when `recommendedTierFullLabel` is non-null, and that label
  // now comes from a tier that exists only when the flag set one.
  assert.match(doc, /is recommended for first-PO production runs/);
  assert.match(doc, /recommendedTierFullLabel !== null/);
  assert.match(
    doc,
    /recommendedTierIdx === null \? null : \(tiers\[recommendedTierIdx\] \?\? null\)/,
    "no recommendation must resolve to no tier, hence no label, hence no sentence",
  );
  assert.match(doc, /recommendedTierFullLabel=\{\s*recommendedTier \? recommendedTier\.full : null\s*\}/);
});

test("a single-tier heading does not depend on a recommendation", () => {
  // `fullLabelIfSingle` read the recommended tier, so a single-tier quote with
  // no recommendation lost its heading. The two facts are unrelated.
  assert.match(doc, /isSingle \? \(tiers\[0\]\?\.full \?\? null\) : null/);
});

test("the freight basis is stated, and is not a recommendation", () => {
  // The charges block quotes freight per unit for ONE tier and names it in a
  // sentence. With no recommendation it shows the first tier and says so —
  // a display basis, with no claim about which tier to buy.
  assert.match(charges, /const basisIdx = recommendedTierIdx \?\? 0;/);
  assert.match(charges, /Freight amounts shown landed per unit for \{basisTier\.full\}/);
  // Matched on the CLAIM, not on the word. The first version forbade
  // /recommend/i and tripped on the prop name `recommendedTierIdx` — a test
  // that cannot tell an identifier from customer copy is asserting the wrong
  // thing, and would have pushed the next author to rename the prop to satisfy
  // it.
  assert.doesNotMatch(
    charges,
    /is recommended|recommended for|we recommend/i,
    "this block must make no recommendation to the customer",
  );
});

test("every consumer can represent 'no recommendation'", () => {
  // A non-null type is what forced the fabrication in the first place: the
  // document could not say "none", so it always said something.
  for (const [file, src] of [
    ["types", readFileSync("src/components/pdf/customer-pdf-types.ts", "utf8")],
    ["pricing-table", readFileSync("src/components/pdf/customer-pdf-pricing-table.tsx", "utf8")],
    ["grand-total", readFileSync("src/components/pdf/customer-pdf-grand-total-row.tsx", "utf8")],
    ["turnkey", readFileSync("src/components/pdf/customer-pdf-turnkey-summary.tsx", "utf8")],
    ["charges", readFileSync("src/components/pdf/customer-pdf-charges-block.tsx", "utf8")],
  ] as const) {
    assert.match(
      src,
      /recommendedTierIdx: number \| null;/,
      `${file} must be able to represent no recommendation`,
    );
  }
});

test("the ★ treatment is driven by the per-tier flag, not by the index", () => {
  // `recommended` per tier is computed as `view.recommendedTierIdx === idx`,
  // which is false for every tier when the index is null — so the star and the
  // highlighted column disappear together with the sentence.
  assert.match(adapter, /recommended: view\.recommendedTierIdx === idx,/);
});
