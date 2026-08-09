/**
 * The compliance grid is a projection, and this is what holds it to that.
 *
 * The requirement is not "the grid renders correctly" — a grid that computed
 * its own margins would also render correctly, right up until it disagreed
 * with the banner. The requirement is that it CANNOT compute one. So most of
 * these assertions are against the source text, because that is where the
 * property lives: a predicate that is absent cannot be tested by calling it.
 *
 * Every forbidden shape below has actually appeared in this codebase, in a
 * component, and was correct at the time:
 *
 *   - a floor comparison in a display layer (the pricing head, pre-provider)
 *   - a `sell === 0 && cost === 0` missingness test (the classifier adapter,
 *     deleted in the cell-margin correction)
 *   - an inference that a lift is blocked because an override exists
 *
 * None of them announced themselves. Each was found by someone going looking.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(
  new URL("../../src/components/pricing-surface/compliance-grid.tsx", import.meta.url),
  "utf8",
);

/** Comment and JSDoc text describes the rules; only code is under test. */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

// ------------------------------------------------------ no local predicates

test("the grid never compares a margin against the floor or the target", () => {
  // The props carry both, for the header caption. Used in any comparison they
  // would be a second compliance basis — and it would agree with the first
  // one for as long as nobody changed either.
  for (const token of ["floorPct", "targetPct"]) {
    const uses = CODE.match(new RegExp(token, "g")) ?? [];
    // Destructure, prop type, and the two caption calls. Anything more is a
    // use this test has not seen.
    assert.ok(
      uses.length <= 4,
      `${token} appears ${uses.length} times — more than the caption needs`,
    );
  }
  assert.ok(
    !/[<>]=?\s*(floorPct|targetPct)|(floorPct|targetPct)\s*[<>]=?/.test(CODE),
    "a threshold comparison has appeared in the component",
  );
});

test("the grid does not re-derive a margin", () => {
  assert.ok(!/1\s*-\s*\w*[Cc]ost\s*\//.test(CODE), "margin formula in the grid");
  assert.ok(
    !/\/\s*(sell_unit|revenue)\b/.test(CODE),
    "dividing by sell or revenue is computing a margin",
  );
});

test("the grid does not decide missingness from values", () => {
  // The heuristic that lived in the adapter for two months and was right the
  // whole time.
  assert.ok(
    !/(sell_unit|cost_unit)\s*===\s*0/.test(CODE),
    "a zero-value missingness test is back",
  );
  assert.ok(
    !/margin_pct\s*===\s*0/.test(CODE),
    "zero margin is a real margin; testing for it as absence is the defect",
  );
});

test("the grid does not infer lift state", () => {
  // `lift_blocked` is stated by the classifier. Deriving it here — from an
  // override plus an offer — would reproduce the classifier's reasoning in a
  // place that cannot see why it is the rule.
  assert.ok(
    !/override_applied\s*&&\s*lift/.test(CODE),
    "lift-blocked is being inferred from the override",
  );
  assert.ok(
    !/lift_offer_pct\s*===\s*null\s*&&/.test(CODE),
    "lift state is being inferred from the absence of an offer",
  );
});

// ----------------------------------------------------- it reads the authority

test("the grid reads the shared classifier and nothing else", () => {
  assert.ok(
    /usePricingClassifier\(\)/.test(CODE),
    "the grid must consume the shared evaluation",
  );
  assert.ok(
    !/useCostingStore/.test(CODE),
    "reading the store directly bypasses the single evaluation — the grid " +
      "would then be one of two surfaces answering the same question",
  );
  assert.ok(
    !/computeQuoteCosting|rankPricingSuggestions|liftToClear/.test(CODE),
    "the grid must not call the engine or the solver",
  );
});

test("every cell status is mapped explicitly, with no else", () => {
  // A `Record<CellStatus, string>` fails to compile when a member is added.
  // A ternary chain does not — it silently gives the new member whatever the
  // last branch was, which is how UNAVAILABLE took the `bad` register on four
  // surfaces at once.
  assert.ok(
    /const STATUS_CLASS: Record<Cell\["status"\], string> = \{/.test(SRC),
    "status → class must be an exhaustive Record, not a ternary chain",
  );
});

// ------------------------------------------- the two no-margin states, apart

test("the grid distinguishes unpriced from cost-without-revenue", () => {
  assert.ok(
    /no_margin_reason === "cost_without_revenue"/.test(CODE),
    "the loss state must be recognised distinctly",
  );
  assert.ok(/cost, no revenue/.test(SRC), "and named distinctly");
  assert.ok(/not priced/.test(SRC));
  // Neither may be rendered as a percentage.
  assert.ok(
    !/fmtPct\(0\)/.test(CODE),
    "a no-margin cell must not be formatted as 0%",
  );
});

test("the loss state does not share the muted register with absence", () => {
  // Muted says "nothing here". A certain loss is not nothing.
  assert.ok(
    /noteClass: "cgnote bad"/.test(SRC),
    "cost-without-revenue must carry its own register",
  );
});

// ------------------------------------------------- client target stays apart

test("client target is per SKU row and never touches the verdict", () => {
  // It does not vary by tier, so a column would assert something untrue; and
  // a price above what the customer asked for is a commercial risk, not a
  // policy breach. Its own channel, never a cell colour.
  assert.ok(
    /client_target_unit/.test(CODE),
    "the benchmark must be rendered",
  );
  assert.ok(
    !/client_target[\s\S]{0,200}STATUS_CLASS|STATUS_CLASS[\s\S]{0,200}client_target/.test(CODE),
    "the client target must not reach the status colour",
  );
  assert.ok(
    !/over_client_target/.test(CODE),
    "the over-target flag belongs to its own indicator, not the compliance grid",
  );
});

// ----------------------------------------------------------- canonical CSS

test("the canonical stylesheets are verbatim and load in the specified order", () => {
  const globals = readFileSync(
    new URL("../../src/app/globals.css", import.meta.url),
    "utf8",
  );
  const order = ["r10", "r11", "r12"].map((r) =>
    globals.indexOf(`../styles/${r}-pricing-workspace.css`),
  );
  for (const i of order) assert.ok(i > 0, "all three canonical sheets must load");
  assert.ok(
    order[0] < order[1] && order[1] < order[2],
    "load order r10 → r11 → r12 is load-bearing and specified by the bundle",
  );
  assert.ok(
    globals.indexOf("r12-pricing-workspace-overrides.css") > order[2],
    "Nexus overrides load last, and are never edited into the canonical files",
  );

  for (const r of ["r10", "r11", "r12"]) {
    const copied = readFileSync(
      new URL(`../../src/styles/${r}-pricing-workspace.css`, import.meta.url),
      "utf8",
    );
    const source = readFileSync(
      new URL(
        `../../docs/design-authority/r12-pricing-workspace/app/${r}/styles.css`,
        import.meta.url,
      ),
      "utf8",
    );
    // Everything after the provenance header must match the bundle byte for
    // byte. Pattern 30's whole value is that this diff stays empty.
    //
    // Normalise line endings BEFORE slicing, not after. Git's autocrlf gives
    // the working copy CRLF, so the header terminator carries a carriage
    // return and a search for the LF form misses it entirely. The first
    // version of this test found that out by reporting drift where there was
    // none — and a check that cries wolf gets disbelieved at exactly the
    // moment it is right.
    const lf = (t: string) => t.split("\r\n").join("\n");
    const normalised = lf(copied);
    const body = normalised.slice(normalised.indexOf(" */\n") + 4);
    assert.equal(
      body,
      lf(source),
      `${r} has drifted from the registered bundle`,
    );
  }
});
