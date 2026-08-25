import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
const DOC = "src/components/quote/customer-view-live.tsx";

/**
 * The customer document states a commercial result, not how we built it.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The reconciliation shipped as three rows BENEATH the turnkey total, set in
 * uppercase mono micro-caps, one of them reading "↳ includes recovery".
 *
 * Three things were wrong with that on a customer's paper:
 *
 *   ORDER      A total printed above its own components reads as the headline
 *              and the parts as a footnote explaining it. The turnkey total is
 *              the final commercial result and closes the table.
 *
 *   REGISTER   Uppercase mono micro-caps is an engineering register. Every
 *              other row of that table is Newsreader and JetBrains Mono in the
 *              document's own scale.
 *
 *   VOCABULARY "Recovery" is how DPS builds a price. A client is not party to
 *              it, and printing it volunteers our mechanics.
 *
 * The facts are NOT removed — `money.embeddedRecovery` stays on the projection
 * for the operator-facing reconciliation. Only the customer document stops
 * rendering it.
 */

test("the components sit ABOVE the turnkey total", async () => {
  const src = codeOnly(await read(DOC));
  const components = src.indexOf('data-testid="cvl-components"');
  const grand = src.indexOf('className="pp-grand"');
  assert.ok(components > 0, "the component rows must render");
  assert.ok(grand > 0, "the turnkey total must render");
  assert.ok(
    components < grand,
    "unit-price subtotal and separate charges precede the turnkey total; " +
      "the total closes the table as the final commercial result",
  );
});

test("both components are present, and in commercial order", async () => {
  const src = codeOnly(await read(DOC));
  const subtotal = src.indexOf("Unit-price subtotal");
  const separate = src.indexOf("Separate charges");
  const grand = src.indexOf("Turnkey total");
  assert.ok(subtotal > 0 && separate > 0, "both component rows render");
  assert.ok(subtotal < separate, "the subtotal precedes the separate charges");
  assert.ok(separate < grand, "and both precede the total");
});

test("the customer document says nothing about recovery", async () => {
  // Asserted over CODE, not the file: the source comment explaining why the
  // line was removed legitimately contains the word, and a check that flagged
  // its own rationale would be forbidding the wrong thing.
  const src = codeOnly(await read(DOC));
  assert.doesNotMatch(
    src,
    /recovery/i,
    "recovery is internal pricing vocabulary and must not reach the client",
  );
  // The internal vocabulary that travels with it.
  for (const term of [/\belection\b/i, /\bplacement\b/i, /\bgoverned\b/i]) {
    assert.doesNotMatch(src, term, "Nexus mechanics must not surface on the document");
  }
});

test("the rows are native to the table, not an annotation on it", async () => {
  const src = codeOnly(await read(DOC));
  // Same column classes as every product row, so each figure sits under its
  // own tier and the recommended column's band continues unbroken.
  const block = src.slice(
    src.indexOf('data-testid="cvl-components"'),
    src.indexOf('className="pp-grand"'),
  );
  assert.match(block, /className="pp-c-prod"/);
  assert.match(block, /"pp-c-num" \+ \(rec \? " pp-c-rec" : ""\)/);

  // And the diagnostic register is gone.
  assert.doesNotMatch(src, /pp-recon/, "the old micro-caps treatment must not remain");
});

test("the component rows carry the document's own two families", async () => {
  const css = await read("src/styles/pp-customer-document-fit.css");
  const rule = css.slice(css.indexOf(".pp-component-k {"));
  assert.match(rule.slice(0, 200), /font-family:\s*var\(--display\)/);
  const num = css.slice(css.indexOf(".pp-component-num {"));
  assert.match(num.slice(0, 220), /font-family:\s*var\(--mono\)/);
  assert.match(num.slice(0, 220), /tabular-nums/);
  // Subordinate to the total, not competing with it.
  assert.match(num.slice(0, 220), /--pp-ink-2/);
  // No uppercase micro-caps anywhere in the new treatment.
  const whole = css.slice(css.indexOf(".pp-components {"), css.indexOf(".pp-c-rec .pp-component-num"));
  assert.doesNotMatch(whole, /text-transform:\s*uppercase/);
});

test("the projection still carries the embedded-recovery fact", async () => {
  // Presentation change only. An operator reconciliation reads this; removing
  // it from the type would turn a display decision into data loss.
  const types = await read("src/types/quote.ts");
  assert.match(types, /embeddedRecovery/);
});
