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

test("ONE verdict renders before the grid, from the progression predicate", async () => {
  // SUPERSEDED by R13. P-UX-1 collapsed the strip and kept StateCallout /
  // StateCard as the substantive summary; the certification run then caught
  // StateCard's CANNOT SEND contradicting the banner's Continue to Quote on the
  // same authorized quote, because the two read different predicates.
  //
  // The fix was not a third gate on StateCard — it was one verdict with one
  // source. Neither component mounts on this surface any more.
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.doesNotMatch(shell, /<StateCallout/);
  assert.doesNotMatch(shell, /<StateCard/);
  assert.doesNotMatch(shell, /<StateLine/);
  assert.doesNotMatch(shell, /<SendableSummary/);
  assert.doesNotMatch(shell, /<SuggestionCard/);
  assert.match(shell, /<VerdictBar/);

  const verdict = await code("components/pricing-surface/verdict-bar.tsx");
  assert.match(verdict, /usePricingProgression\(\)/, "the verdict must read progression");
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
  // STRONGER after R13: the banner carries no href in ANY state.
  assert.match(head, /const bannerHref = undefined;/);
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

test("exactly one control navigates to the Quote umbrella", () => {
  // INVERTED. P-UX-1 kept the banner's CTA because nothing else on the page
  // could reach another surface. R13's verdict bar can, so keeping it produced
  // TWO identical `Continue to Quote` buttons — the duplication P-UX-1 removed,
  // arriving from the other side. Caught in the post-deploy capture.
  //
  // The assertion now runs the other way: the banner must NOT navigate, and the
  // verdict must.
  return Promise.all([
    code("components/pricing/pricing-page-head.tsx"),
    code("components/pricing-surface/verdict-bar.tsx"),
  ]).then(([head, verdict]) => {
    assert.doesNotMatch(head, /resolveSurfaceHref\("customer_view"/);
    assert.match(verdict, /quote\?tab=preview/);
    assert.match(verdict, /Continue to Quote/);
  });
});

// ── governance is untouched ───────────────────────────────────────────────

test("below-floor governance stayed out of the presentation cleanup", async () => {
  // The guard that matters most, and the one R13 had to be checked against:
  // a presentation cleanup that quietly took the approval path with it is the
  // expensive version of this work.
  //
  // RE-POINTED, not relaxed. `ApprovalStateCard` no longer mounts in the shell
  // because the approval state became the LABEL of the Request control — one
  // fact in one place instead of a button above and a notice below. The path
  // itself is intact and is asserted where it now lives.
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.match(shell, /RequestOverrideModal/);
  assert.match(shell, /onRequestApproval=/, "the shell must still open the request");
  assert.match(shell, /approvalState=\{approvalState\}/);

  const verdict = await code("components/pricing-surface/verdict-bar.tsx");
  assert.match(verdict, /Request approval/, "the request affordance must exist");
  assert.match(verdict, /Requested — awaiting a decision/, "in-flight state must show");
  assert.match(verdict, /authorized commercial approver/);
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
