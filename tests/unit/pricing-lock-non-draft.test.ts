import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

/**
 * The Global price adjustment control says it is locked, at the control.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────
 *
 * `previewGlobalAdj` calls `quoteByIdDraft` and refuses on a non-draft quote.
 * That guard was — and remains — correct. What was wrong was the operator's
 * FIRST indication of it: the input and Preview rendered fully enabled, the
 * click produced a refusal, and the refusal rendered as an alert at the TOP of
 * a long section, roughly a thousand pixels above the button that caused it.
 *
 * Reproduced on an accepted quote: type a percentage, click Preview, nothing
 * appears and nothing is said. The message was on the page the whole time,
 * off-screen.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────
 *
 * That the SERVER guard is untouched, because a UI lock is a convenience and
 * the guard is the authority; and that each of the three controls is gated on
 * `committable` with a reason stated locally.
 */

test("the server guard is unchanged and remains the authority", async () => {
  const src = await read("src/app/actions/pricing-apply.ts");
  assert.match(
    src,
    /await quoteByIdDraft\(quoteId\);/,
    "the draft guard is gone — the UI lock is a convenience, not the boundary",
  );
});

test("all three controls are gated on committable", async () => {
  const src = await read("src/components/pricing-surface/detail-zone.tsx");
  const cluster = src.slice(
    src.indexOf('<div className="input-cluster">'),
    // lastIndexOf: "Stage this adjustment" first appears inside a comment
    // ABOVE the Preview button, so slicing to the first occurrence cut the
    // region in half and reported a defect that was not there.
    src.lastIndexOf("Stage this adjustment"),
  );
  assert.ok(cluster.length > 0, "could not locate the control cluster");

  assert.match(
    cluster,
    /disabled=\{!committable\}/,
    "the lift input is not disabled on a non-draft quote",
  );
  assert.match(
    cluster,
    /disabled=\{pending \|\| !committable\}/,
    "Preview is not disabled on a non-draft quote",
  );
  // Stage was already gated through `stageable`, which includes committable.
  assert.match(src, /const stageable =\s*\n?\s*committable &&/);
});

test("the input is NOT disabled by pending", async () => {
  // Pattern 47(e): disabling an input mid-save drops focus. This control is
  // locked by the quote's STATE, which does not change under the operator's
  // hands, so the two must not be conflated.
  const src = await read("src/components/pricing-surface/detail-zone.tsx");
  const cluster = src.slice(
    src.indexOf('<div className="input-cluster">'),
    src.indexOf("% sell-price lift"),
  );
  assert.doesNotMatch(
    cluster,
    /disabled=\{pending/,
    "the lift input is disabled by `pending` — that drops focus mid-keystroke",
  );
});

test("the reason is stated at the control, not only at the top of the page", async () => {
  const src = await read("src/components/pricing-surface/detail-zone.tsx");

  // Visible copy beside the lever, gated on the same flag.
  assert.match(
    src,
    /\{!committable && \(/,
    "no local explanatory block for the locked state",
  );
  assert.match(src, /Pricing is locked — this quote is no longer a draft\./);
  assert.match(src, /Revise it into a new version to adjust pricing\./);
});

test("a disabled control never names the wrong cause", async () => {
  // Stage's tooltip said "enter a percentage different from the one in effect"
  // even when the quote was locked — telling the operator to do something that
  // would not have helped, about a control that could never work.
  const src = await read("src/components/pricing-surface/detail-zone.tsx");
  const stage = src.slice(
    src.indexOf("onClick={handleStage}"),
    // lastIndexOf: "Stage this adjustment" first appears inside a comment
    // ABOVE the Preview button, so slicing to the first occurrence cut the
    // region in half and reported a defect that was not there.
    src.lastIndexOf("Stage this adjustment"),
  );
  assert.match(
    stage,
    /!committable\s*\n?\s*\?\s*"Pricing is locked/,
    "the lock reason must take precedence over the value-unchanged reason",
  );
  assert.match(stage, /Enter a percentage different from the one in effect\./);
});
