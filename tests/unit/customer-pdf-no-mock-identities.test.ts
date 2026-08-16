/**
 * Pattern 45 — no prototype identity may reach a customer.
 *
 * Found in the Item 4 walk, on a quote where all four tiers carried
 * `recommended = false` and the Pricing header read "None chosen": page 1 of
 * the customer PDF said
 *
 *     "★ T2 is our recommended first-PO tier."
 *
 * "T2" was a string literal, carried in by the Pattern-30 verbatim port of
 * CD's mock and never wired to anything. It had been on every customer PDF the
 * firm produced, one line below a correctly-governed sentence that either said
 * nothing or named a different tier.
 *
 * The sweep it prompted found two more of the same shape — "CAP-60 · Tier 1",
 * CD's mock SKU, named to the customer whenever a quote had an unpriced line
 * while the real pending line went unnamed.
 *
 * Pattern 30 says adopt the design source verbatim. It has never said adopt
 * its DATA verbatim. The tell in all three: the mock's own value survived into
 * a system that computes the real one, because nothing consulted the quote.
 *
 * These are structural greps rather than render tests on purpose — the defect
 * is a literal in the source, and a render test only catches the fixtures
 * somebody thought to write.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { unpricedLinePhrase } from "../../src/components/pdf/customer-pdf-unpriced.ts";

const TREE = new URL("../../src/components/pdf/", import.meta.url);

async function sources(): Promise<Array<[string, string]>> {
  const names = (await readdir(TREE)).filter((n) => n.endsWith(".tsx"));
  const out: Array<[string, string]> = [];
  for (const n of names) {
    const raw = await readFile(new URL(n, TREE), "utf8");
    // Comments stripped: these files explain the defect by quoting the literal
    // that caused it, and an instrument that cannot tell prose from code
    // reports the defect present in its own explanation.
    out.push([n, raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")]);
  }
  return out;
}

test("no mock SKU code is hardcoded in the customer render tree", async () => {
  // CAP-60 and GLW-50 are CD's prototype products. Neither belongs in a
  // sentence a real customer reads.
  for (const [name, code] of await sources()) {
    assert.doesNotMatch(code, /CAP-60|GLW-50/, `${name} names a prototype SKU`);
  }
});

test("no tier is named by literal in the customer render tree", async () => {
  // A bare "T2"/"Tier 2" in rendered copy is a recommendation, an exclusion, or
  // a scope claim asserted without consulting the quote. Tier identity must
  // arrive as data — `tier.full`, `tier.label`, a governed prop.
  for (const [name, code] of await sources()) {
    assert.doesNotMatch(
      code,
      /(?:^|[^\w.$])(?:T[1-9]|Tier [1-9])(?:$|[^\w])/,
      `${name} names a tier by literal rather than from the quote`,
    );
  }
});

// ── the replacement actually names the right lines ────────────────────────

const TIERS = [
  { id: "t1", label: "T1", full: "Tier 1", quantity: 1000 },
  { id: "t2", label: "T2", full: "Tier 2", quantity: 5000 },
];
const sku = (code: string, prices: Array<number | null>) => ({
  id: code,
  code,
  name: code,
  pack: null,
  tier_prices: prices,
  shape: "step",
});

test("nothing unpriced yields no phrase, not an empty parenthetical", () => {
  assert.equal(unpricedLinePhrase([sku("AAA-1", [1, 2])], TIERS), null);
});

test("the unpriced cell is named by its own code and tier", () => {
  assert.equal(
    unpricedLinePhrase([sku("AAA-1", [1, null])], TIERS),
    "AAA-1 · Tier 2",
  );
});

test("several unpriced cells are all named", () => {
  assert.equal(
    unpricedLinePhrase([sku("AAA-1", [null, null]), sku("BBB-2", [1, 2])], TIERS),
    "AAA-1 · Tier 1; AAA-1 · Tier 2",
  );
});

test("a long list is summarised rather than printed whole", () => {
  // Thirty identities in one sentence is not a sentence. The itemised table
  // above already carries every one of them.
  const many = [
    sku("A", [null, null]),
    sku("B", [null, null]),
    sku("C", [null, null]),
  ];
  assert.equal(
    unpricedLinePhrase(many, TIERS),
    "A · Tier 1; A · Tier 2; B · Tier 1, and 3 more",
  );
});
