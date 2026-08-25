import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

/**
 * A refused Finalize must not claim the feature does not exist.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * `.cv-primary:disabled::after` appended " · not wired yet" to the Finalize
 * button. It was added (59d95dc) while the button was genuinely inert for a
 * visual review, and it outlived that: once the button was wired, EVERY
 * legitimate refusal wore the suffix.
 *
 * Seen on production the moment the pre-flight started reporting unbillable
 * recovery — the button read:
 *
 *     Resolve recovery placement · not wired yet
 *
 * An operator holding a real work item was told the remedy did not exist. The
 * same applied to "Request pricing approval" on an unauthorized below-floor
 * tier and to "Frozen - start v2" on a sent quote: three true labels, each
 * followed by a false one.
 *
 * The whole point of surfacing the refusal is that the surface tells the truth.
 * A stale decoration that contradicts it is worse than silence, because the
 * operator believes the second half.
 */

test("no disabled state claims the button is not wired", async () => {
  const css = await read("src/styles/r3-customer-view.css");
  // The comment explaining the removal legitimately names the old string, so
  // this asserts over the RULE, not over any mention of it.
  assert.doesNotMatch(
    css,
    /\.cv-primary:disabled::after\s*\{/,
    "a disabled Finalize must not append a suffix; its label already says what is wrong",
  );
  assert.doesNotMatch(css, /content:\s*" · not wired yet"/);
});

test("the disabled button still reads as unavailable", async () => {
  // Removing the suffix must not make a refused primary action look live. The
  // reason the suffix existed at all was real: a full-width accent button
  // reads as the primary action even when disabled.
  const css = await read("src/styles/r3-customer-view.css");
  const rule = css.slice(css.indexOf(".cv-primary:disabled {"));
  assert.match(rule.slice(0, 160), /cursor:\s*not-allowed/);
  assert.match(rule.slice(0, 160), /opacity/);
});
