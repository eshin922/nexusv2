/**
 * The bounded pre-soak presentation queue — soak run 1's logged observations.
 *
 * Three of the four are structural enough to assert. The fourth (the Costs
 * header's removed sync scaffolding) is an absence, and is asserted as one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { leafCostDisplay, leafCostTitle } from "../../src/lib/leaf-cost-display.ts";

// ── one empty-cost register ────────────────────────────────────────────────

test("a zero from the product library is not a price of zero", () => {
  // The observation: one table showed `$0.00 cost` and `— cost` at once.
  // `"0.0000"` is a truthy string, so a truthiness check sent two spellings of
  // "nobody costed this" down two different branches.
  assert.equal(leafCostDisplay("0.0000"), "— cost");
  assert.equal(leafCostDisplay(0), "— cost");
  assert.equal(leafCostDisplay(null), "— cost");
  assert.equal(leafCostDisplay(undefined), "— cost");

  // One state, one register.
  assert.equal(leafCostDisplay("0.0000"), leafCostDisplay(null));
});

test("a real cost still renders as a cost", () => {
  assert.equal(leafCostDisplay("1.8500"), "$1.85 cost");
  assert.equal(leafCostDisplay(0.42), "$0.42 cost");
  // Rounds for display but only for display — a sub-cent cost is still costed,
  // and must not fall back into the empty register.
  assert.equal(leafCostDisplay("0.0040"), "$0.00 cost");
  assert.notEqual(leafCostDisplay("0.0040"), "— cost");
});

test("garbage is absence, not a cost", () => {
  assert.equal(leafCostDisplay("not-a-number"), "— cost");
});

test("the raw fact survives in the hover text", () => {
  // Absence and a recorded zero are different FACTS. They are just not
  // different prices, so they differ in the tooltip and not in the table.
  assert.match(leafCostTitle("0.0000"), /library carries 0\.00/);
  assert.match(leafCostTitle(null), /No unit cost on file/);
  assert.notEqual(leafCostTitle("0.0000"), leafCostTitle(null));
  assert.match(leafCostTitle("1.8500"), /\$1\.8500/);
});

test("both Setup rows read the shared register", () => {
  for (const f of [
    "src/components/assembly-tree/asy-row.tsx",
    "src/components/assembly-tree/direct-product-row.tsx",
  ]) {
    const src = readFileSync(f, "utf8");
    assert.ok(src.includes("leafCostDisplay("), `${f} must use the shared register`);
    // The duplicated expression that let the two spellings drift is gone.
    assert.ok(
      !/\?\s*`\$\$\{Number\([a-z]+\.unitCost\)\.toFixed\(2\)\} cost`/.test(src),
      `${f} must not re-derive the register locally`,
    );
  }
});

// ── the Send-order modal width ─────────────────────────────────────────────

test("the send-order modal has one width, and it is not the inline cap", () => {
  const modal = readFileSync("src/components/quote-umbrella/send-order-modal.tsx", "utf8");
  // The 560 cap inside a 720 dialog was the unused white column.
  assert.ok(!modal.includes("maxWidth: 560"), "the inline content cap is gone");
  assert.ok(modal.includes('className="send-order"'), "width comes from CSS");

  const css = readFileSync("src/styles/r3-shared-overrides.css", "utf8");
  const m = css.match(/\.modal\.lg\.send-order\s*\{\s*max-width:\s*(\d+)px/);
  assert.ok(m, "the override must exist");
  const px = Number(m![1]);
  assert.ok(px >= 760 && px <= 820, `width ${px}px must sit in the 760-820 band`);

  // Canonical CSS stays pristine — Pattern 30.
  const canonical = readFileSync("src/styles/r3-shared.css", "utf8");
  assert.ok(!canonical.includes("send-order"), "the canonical file must not be edited");

  // And the override must be imported AFTER the canonical file or it loses the
  // cascade at equal specificity — the trap r-a1v2-overrides.css already sits in.
  const globals = readFileSync("src/app/globals.css", "utf8");
  assert.ok(
    globals.indexOf("r3-shared-overrides.css") > globals.indexOf("r3-shared.css"),
    "the override must be imported after the file it overrides",
  );
});

// ── the removed scaffolding, and the relabelled sync age ───────────────────

test("the Costs header no longer advertises a sync it cannot measure", () => {
  const src = readFileSync("src/components/costs/costs-header.tsx", "utf8");
  assert.ok(!src.includes("<span>Sync status pending"), "the chip is gone");
  assert.ok(
    !/className="meta pending"/.test(src),
    "and so is the shape that reserved space for it",
  );
});

test("the project header says which timestamp it is showing", () => {
  const src = readFileSync("src/app/projects/[id]/page.tsx", "utf8");
  // "synced" was ambiguous between the project snapshot and the deal cache,
  // and the operator resolved it against the cache, which was current.
  assert.ok(!/<span>synced \{/.test(src), "the ambiguous label is gone");
  assert.ok(src.includes("deal context refreshed"));
  // Past a month a relative age informs least and matters most.
  assert.ok(src.includes("ageInDays(project.lastHubspotRefreshAt) >= 30"));
  assert.ok(src.includes("fmtDated("), "and the date carries its year");
});
