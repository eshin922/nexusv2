import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { composePricingAdjustment } from "../../src/lib/pricing-adjustment.ts";

test("bulk pricing lift composes against the captured adjustment", () => {
  assert.equal(composePricingAdjustment(0.1, 0.05), 0.155);
  assert.equal(composePricingAdjustment(-0.1, 0.2), 0.08);
});

test("exact undo is receipt-based and rejects stale tier state", async () => {
  const source = await readFile(
    new URL("../../src/app/actions/pricing-apply.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /action: "pricing_suggestion_global_undone"/);
  assert.match(source, /tierPriceAdjPct: restore\.from/);
  assert.doesNotMatch(
    source.slice(source.indexOf("export async function undoGlobalAdj")),
    /composePricingAdjustment|applyDelta/,
  );
  assert.match(source, /changed after Apply; Undo was not performed/);
});

test("pricing Preview and Apply are separate server actions", async () => {
  const actionSource = await readFile(
    new URL("../../src/app/actions/pricing-apply.ts", import.meta.url),
    "utf8",
  );
  const preview = actionSource.slice(
    actionSource.indexOf("export async function previewGlobalAdj"),
    // Was `applySurgicalAdj`, which followed Preview in this file until P3-016
    // removed it. `applyGlobalAdj` is the next section now, and the property
    // under test is unchanged: Preview writes nothing.
    actionSource.indexOf("// ---------- applyGlobalAdj"),
  );
  assert.doesNotMatch(preview, /\.insert\(|\.update\(|revalidateQuoteTree/);

  const uiSource = await readFile(
    new URL("../../src/components/pricing-surface/detail-zone.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    // R12 §2 lower-cased it and, more importantly, gave it a sibling: preview
    // without a commit path was "staging with the second half absent". The
    // property this test defends is unchanged and now has one more instance —
    // previewing, staging and applying are three separate acts.
    "Preview changes", "Stage this adjustment",
    "Current adjustment", "Current price", "Delta",
    "Resulting adjustment", "Resulting price", "Apply", "Undo",
  ]) {
    assert.match(uiSource, new RegExp(label));
  }
  // Staging is in-memory until Apply. The panel must reach the staging model,
  // never a write path of its own.
  assert.match(uiSource, /stageGlobalAdj/);
  assert.doesNotMatch(
    uiSource.slice(uiSource.indexOf("function DetailGlobalAdjust")),
    /applyPricingAdjustments/,
  );
});
