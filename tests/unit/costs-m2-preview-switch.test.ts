/**
 * The M2 preview switch.
 *
 * The property under test is FEATURE-OFF PRESERVATION: absent or unrecognised
 * means the original workspace, and turning the preview off restores the URL it
 * was entered from. That is the whole rollback story for this milestone, so it
 * is asserted rather than described.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  COSTS_M2_PREVIEW_VALUE,
  costsPreviewHref,
  isCostsM2PreviewEnabled,
} from "../../src/lib/costs/m2-preview-switch.ts";

test("the preview is off unless it is asked for by name", () => {
  assert.equal(isCostsM2PreviewEnabled(undefined), false);
  assert.equal(isCostsM2PreviewEnabled(""), false);
  assert.equal(isCostsM2PreviewEnabled("1"), false);
  assert.equal(isCostsM2PreviewEnabled("true"), false);
  // A DIFFERENT milestone must not open this one.
  assert.equal(isCostsM2PreviewEnabled("costs-m3"), false);
  // Near misses fail closed rather than being helpfully accepted.
  assert.equal(isCostsM2PreviewEnabled("costs-m2 "), false);
  assert.equal(isCostsM2PreviewEnabled("COSTS-M2"), false);
  assert.equal(isCostsM2PreviewEnabled(COSTS_M2_PREVIEW_VALUE), true);
});

test("a repeated parameter is read, not silently dropped", () => {
  // `?preview=x&preview=costs-m2` arrives as an array. A reader that only
  // handled `string` would report off for a reason nobody could see.
  assert.equal(isCostsM2PreviewEnabled(["x", "costs-m2"]), true);
  assert.equal(isCostsM2PreviewEnabled(["x", "y"]), false);
  assert.equal(isCostsM2PreviewEnabled([]), false);
});

test("leaving the preview restores the URL it was entered from", () => {
  const original = "/projects/p/quotes/q/costs?section=freight&tier=t-2";
  const [path, query] = original.split("?");
  const params = new URLSearchParams(query);

  const entered = costsPreviewHref(path, params, true);
  assert.equal(
    entered,
    "/projects/p/quotes/q/costs?section=freight&tier=t-2&preview=costs-m2",
  );

  // Round trip. The operator's open section and selected tier survive both
  // directions; dropping them would make the switch look like a reset.
  const left = costsPreviewHref(path, new URLSearchParams(entered.split("?")[1]), false);
  assert.equal(left, original);
});

test("turning the preview off on a bare URL leaves no query string behind", () => {
  const href = costsPreviewHref(
    "/projects/p/quotes/q/costs",
    new URLSearchParams("preview=costs-m2"),
    false,
  );
  assert.equal(href, "/projects/p/quotes/q/costs", "no trailing '?'");
});

test("the href builder accepts Next's searchParams record shape", () => {
  const href = costsPreviewHref(
    "/costs",
    { section: "packaging", preview: undefined, tier: ["t-1"] },
    true,
  );
  assert.equal(href, "/costs?section=packaging&tier=t-1&preview=costs-m2");
});
