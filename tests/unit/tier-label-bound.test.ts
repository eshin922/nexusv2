/**
 * A tier label is a name, and the writer is where that is enforced.
 *
 * ── WHAT HAPPENED ───────────────────────────────────────────────────────
 *
 * `updateTier` took `String(formData.get("label")).trim()` straight to the
 * column with no bound of any kind. On 2026-08-28 a 1,366-character paste — a
 * page of engineering prose — landed in one production tier's label, and every
 * consumer did exactly what it should with the value it was given:
 *
 *   Costs      it became the Tier 2 column heading in the Price Build grid and
 *              expanded that column vertically, breaking the page geometry
 *   Pricing    the tier selector chip and the Pricing Detail column header
 *   Quote      `Goods sell · <label>` in the governed side rail
 *   PDF        the tier heading inside the customer-facing document
 *
 * None of those is a rendering defect. They are four correct consumers of one
 * corrupt authoritative value, which is why the bound belongs at the writer:
 * truncating at a surface would hide the corruption while leaving the customer
 * document built from it.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TIER_LABEL_MAX, assertTierLabel } from "../../src/lib/tier-label.ts";

const read = (p: string) => readFileSync(p, "utf8").split(String.fromCharCode(13)).join("");

// ══════════════════════════════════════════════════════════════════════
// The bound itself
// ══════════════════════════════════════════════════════════════════════

test("every label real operators use is accepted", () => {
  // ── THE BOUND IS CHOSEN FROM THE DATA, SO THE DATA IS THE TEST ─────────
  //
  // Read from production 2026-08-28: 16 distinct labels across 149 rows, the
  // longest six characters. The field IS used as free text — `T1`, `5K`,
  // `25000` are real — so the repair bounds its LENGTH and nothing else.
  for (const real of [
    "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 6",
    "T1", "T2", "T3", "T4", "T5",
    "5K", "15K", "50K",
    "5000", "10000", "25000",
  ]) {
    assert.equal(assertTierLabel(real), real, `${real} is a real production label`);
  }
});

test("names nobody has used yet are still accepted", () => {
  // A bound tight enough to break plausible naming would trade one defect for
  // another. 24 is four times the longest real label.
  for (const plausible of [
    "Initial production run",
    "First PO · 10k",
    "Pilot",
    "Launch volume",
  ]) {
    assert.equal(assertTierLabel(plausible), plausible);
  }
});

test("the paragraph that caused this is refused", () => {
  const paragraph =
    "Tier 2Additional reachability defect  I also found that Add one-time " +
    "charges is currently available only for components inside an Item Group.";
  assert.throws(() => assertTierLabel(paragraph), /at most 24 characters/);
});

test("the refusal says what it is protecting", () => {
  // An operator who pasted by accident needs to know why a label field has an
  // opinion, and the reason is that this string names a column on four
  // surfaces including the customer's document.
  try {
    assertTierLabel("x".repeat(TIER_LABEL_MAX + 1));
    assert.fail("should have thrown");
  } catch (e) {
    const m = (e as { message: string }).message;
    assert.match(m, /Costs, Pricing, the Quote rail/);
    assert.match(m, /customer PDF/);
    // And it states the actual length, so the operator can see how far over.
    assert.match(m, new RegExp(String(TIER_LABEL_MAX + 1)));
  }
});

test("a label is ONE line", () => {
  // Multi-line is the shape that expanded a grid column vertically.
  //
  // The bad values are BUILT from code points rather than typed as escapes.
  // Typing them got the literal bytes into this file twice — a raw VT and a
  // raw NUL — which made it binary to grep and, in the validator itself,
  // silently collapsed the character class into a range matching almost
  // nothing. A guard that cannot survive being written down is not a guard,
  // and neither is its test.
  const ch = (code: number) => "Tier" + String.fromCharCode(code) + "2";
  for (const code of [10, 13, 11, 12, 0, 9, 27, 127]) {
    assert.throws(
      () => assertTierLabel(ch(code)),
      /one line/,
      `code point ${code} must be refused`,
    );
  }
});

test("an empty label is refused rather than silently kept", () => {
  assert.throws(() => assertTierLabel("   "), /needs a label/);
});

test("it trims, because a pasted label usually arrives padded", () => {
  assert.equal(assertTierLabel("  Tier 2  "), "Tier 2");
});

// ══════════════════════════════════════════════════════════════════════
// Where it is enforced
// ══════════════════════════════════════════════════════════════════════

test("the ONE path that accepts operator text goes through it", () => {
  const actions = read("src/app/actions/quotes.ts");
  assert.match(actions, /const newLabel = assertTierLabel\(/);
  // `addTier` generates its own name and presets are governed constants, so
  // `updateTier` is the whole surface. Asserted rather than assumed: a second
  // operator-writable path appearing later must come through here too.
  assert.match(actions, /label: `Tier \$\{sortOrder \+ 1\}`/);
});

test("the surfaces are NOT where this is solved", () => {
  // The consumers render the authoritative value. Truncating there would hide
  // a corrupt source while the customer document was still built from it.
  for (const consumer of [
    "src/components/costs/packaging-drilldown.tsx",
    "src/lib/commercial-projection.ts",
    "src/components/quote/customer-view-rail.tsx",
  ]) {
    const t = read(consumer);
    assert.ok(
      !/tierLabel[^\n]*\.slice\(0,|label[^\n]*substring\(0,/.test(t),
      `${consumer} must not truncate a tier label`,
    );
  }
});

test("the input carries the same bound, from the same constant", () => {
  // A courtesy, not the enforcement — a browser attribute is advice to one
  // client. Sharing the constant is what stops the two drifting.
  const row = read("src/app/projects/[id]/quotes/[quoteId]/tier-row.tsx");
  assert.match(row, /maxLength=\{TIER_LABEL_MAX\}/);
  assert.match(row, /import \{ TIER_LABEL_MAX \} from "@\/lib\/tier-label"/);
});
