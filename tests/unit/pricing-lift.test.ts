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
    actionSource.indexOf("// ---------- applySurgicalAdj"),
  );
  assert.doesNotMatch(preview, /\.insert\(|\.update\(|revalidateQuoteTree/);

  const uiSource = await readFile(
    new URL("../../src/components/pricing-surface/detail-zone.tsx", import.meta.url),
    "utf8",
  );
  for (const label of [
    "Preview Changes", "Current adjustment", "Current price", "Delta",
    "Resulting adjustment", "Resulting price", "Apply", "Undo",
  ]) {
    assert.match(uiSource, new RegExp(label));
  }
});
