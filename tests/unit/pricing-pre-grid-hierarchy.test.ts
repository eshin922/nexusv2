/**
 * P-UX-1 — one compliance summary and one Apply action before the grid.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * The upper Pricing surface stated the same compliance fact three times before
 * the operator reached the grid — page sub-copy, the `REVIEW · N tiers below
 * target` strip, and StateCallout/StateCard — and then offered TWO primary
 * buttons carrying the same label, of which only the lower one applied
 * anything. The upper one was an in-page anchor to the lower one.
 *
 * The cost is vertical distance to the grid, which B-16 had just made the most
 * precise source of truth on the surface: it locates the affected cells rather
 * than restating the conclusion. Repeating the verdict above the one place
 * that answers "where" inverts the surface's own hierarchy.
 *
 * ── WHAT WAS PRESERVED, AND WHY IT IS ASSERTED ────────────────────────────
 *
 * Below-floor governance is NOT in any of the removed presentation. It is
 * `ApprovalStateCard` + `RequestOverrideModal`, rendered separately and below.
 * A presentation cleanup that quietly took an approval path with it would be
 * the expensive version of this mistake, so it is pinned here rather than
 * assumed.
 *
 * The strip was COLLAPSED, not deleted: `sl.qualifiers` ("12 cells awaiting
 * raws") is a readiness fact with no other home, and `justUpdated` marks a
 * transition rather than a state. Only the pill and the compliance lead went.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** Comments stripped — this suite explains the defect by naming the old code. */
async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// ── one compliance summary ────────────────────────────────────────────────

test("the state strip no longer restates the compliance verdict", async () => {
  const src = await code("components/pricing-surface/state-zone.tsx");
  const line = src.slice(
    src.indexOf("export function StateLine"),
    src.indexOf("export function StateCallout"),
  );
  assert.notEqual(line, "", "StateLine not found");
  // The pill and the lead were the restatement. `sl.status` drove the pill.
  assert.doesNotMatch(line, /sl\.lead/, "the compliance lead is back");
  assert.doesNotMatch(line, /sl\.status/, "the status pill is back");
  // The qualifiers are the part that was never a restatement.
  assert.match(line, /sl\.qualifiers\.map/);
});

test("the strip renders nothing when it has nothing of its own to say", async () => {
  // Otherwise the collapse trades a redundant line for an empty one.
  const src = await code("components/pricing-surface/state-zone.tsx");
  assert.match(
    src,
    /if \(sl\.qualifiers\.length === 0 && !justUpdated\) return null;/,
  );
});

test("StateCallout and StateCard remain, and remain the substantive summary", async () => {
  // The one compliance summary before the grid: they name the worst tier, the
  // blended margin, the target and the floor. Removing the strip must not have
  // removed the thing the strip was redundant WITH.
  const src = await code("components/pricing-surface/state-zone.tsx");
  assert.match(src, /export function StateCallout/);
  assert.match(src, /export function StateCard/);
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.match(shell, /state\.mode === "suggestion_led" && <StateCallout/);
  // Now additionally gated on progression: an AUTHORIZED below-floor quote
  // must not show CANNOT SEND beside a Continue to Quote banner. Certification
  // 2026-08-22 caught the two contradicting each other on one screen.
  assert.match(shell, /state\.mode === "blocked" && !progression\.allowed && <StateCard/);
});

// ── one Apply action ──────────────────────────────────────────────────────

test("the banner offers no CTA where the action lives on the page below it", async () => {
  // RE-POINTED, and the guarantee got stronger.
  //
  // P-UX-1 suppressed the href by MODE, leaving the banner carrying the
  // recommended action's label with no button. The below-floor slice found the
  // cost of that: `preview_pdf` is filtered out of the action list in every
  // mode, so `suggestion_led` — sendable by policy, and the copy said so — had
  // no forward affordance anywhere on the surface.
  //
  // The banner now carries a PROGRESSION label instead of an action label, so
  // it cannot duplicate a card below it whatever the mode. This asserts that
  // property rather than the old expression, which no longer exists.
  const head = await code("components/pricing/pricing-page-head.tsx");
  assert.match(head, /!progression\.allowed\s*\?\s*undefined/);
  // The in-page anchors were the duplication. Their absence is still the fix.
  assert.doesNotMatch(head, /#\$\{PSR_SUGGESTION_ANCHOR\}/);
  assert.doesNotMatch(head, /psr-suggestion-card/);
  assert.doesNotMatch(head, /PSR_ACTION_ANCHOR/);
});

test("the banner still STATES the move — only the second button went", async () => {
  // The heading is the half that was doing the work. If `label` stopped being
  // passed, this would be a removal of guidance rather than of duplication.
  const head = await code("components/pricing/pricing-page-head.tsx");
  assert.match(head, /label=\{bannerLabel\}/);
  // INVERTED, deliberately. This used to require the banner to carry the
  // recommended action's label — the surviving half of the duplicate pair.
  // Carrying it is now the defect: it made the banner restate a card, and it
  // was why the banner had nothing to say about moving forward. The action's
  // label belongs to the card that performs it.
  assert.doesNotMatch(head, /bannerLabel[\s\S]{0,200}recommendedOrPrimary\.label/);
  // Still states a move in every non-terminal state.
  assert.match(head, /"Continue to Quote →"/);
  // And the banner renders its heading independently of the CTA.
  const banner = await code("components/nav/your-next-move-banner.tsx");
  assert.match(banner, /\{label \?\? "—"\}/);
  assert.match(banner, /!isTerminal && label && href && \(/);
});

test("navigation to ANOTHER surface keeps its CTA", async () => {
  // Suppressing every CTA would strip the banner of the one job only it can
  // do: getting the operator to the Quote umbrella.
  const head = await code("components/pricing/pricing-page-head.tsx");
  assert.match(
    head,
    /resolveSurfaceHref\("customer_view", projectId, quoteId\)\}\?tab=preview/,
  );
});

// ── governance is untouched ───────────────────────────────────────────────

test("below-floor governance stayed out of the presentation cleanup", async () => {
  // The removed components carried no action of any kind — verified by sweep
  // below — so the approval path could only have been lost by accident. Pinned
  // because that is exactly how it would happen.
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.match(shell, /<ApprovalStateCard/);
  assert.match(shell, /RequestOverrideModal/);
  assert.match(shell, /mayRequestApproval\(approvalState\)/);
});

test("the state zone still contains no action of any kind", async () => {
  // The premise the removal rested on, re-checked rather than cited: if a
  // future edit puts a control in here, collapsing this component silently
  // starts destroying an affordance.
  const src = await code("components/pricing-surface/state-zone.tsx");
  for (const forbidden of [/<button/, /onClick/, /href=/, /<Link/, /onActivate/]) {
    assert.doesNotMatch(src, forbidden, `state-zone gained an action: ${forbidden}`);
  }
});
