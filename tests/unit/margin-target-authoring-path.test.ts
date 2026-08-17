/**
 * Margin Target — the per-quote override has an operator write path again.
 *
 * ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
 *
 * Nothing about the authority. `updateQuoteTargetMargin` writes
 * `quotes.target_margin_pct`, audits as `quote_target_margin_updated`, enforces
 * the draft guard, and the resolution chain
 * `quote.targetMarginPct ?? firm.targetMarginPct` is live throughout the
 * classifier and the costing engine.
 *
 * The UI was ORPHANED. `QuoteTargetMarginPopover`'s only mount was
 * `VerdictBand`, torn down when the classifier-driven PSR replaced the legacy
 * reframe shell; `pricing/page.tsx` recorded it as "orphan-on-disk … preserved
 * for potential v1.1 re-mount". So the engine read a column that no operator
 * could set.
 *
 * Measured on the live database before the repair: **3** audit rows ever, most
 * recent **2026-05-03** — three and a half months. 12 of 75 quotes carry a
 * value and every sampled one is `0.3500`, identical to the firm default, so
 * they are not meaningful overrides either.
 *
 * Third instance of CLAUDE.md's "Surface unification can orphan components".
 * The tests below are shaped by that: they pin the MOUNT, because the authority
 * was never the part that broke and a component that exists is not a component
 * that is reachable.
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
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// ── reachability, which is the whole finding ──────────────────────────────

test("the control is mounted on a surface that renders", async () => {
  // `VerdictBand` is still on disk and still imports the popover. An assertion
  // that "something imports it" would therefore have passed throughout the
  // entire period the column was unwritable. This pins the LIVE surface.
  const grid = await code("components/pricing-surface/compliance-grid.tsx");
  assert.match(grid, /import \{ QuoteTargetMarginPopover \}/);
  assert.match(grid, /<QuoteTargetMarginPopover disabled=\{!editable\} \/>/);
});

test("the mount sits on the target figure it governs, not merely near it", async () => {
  const grid = await code("components/pricing-surface/compliance-grid.tsx");
  // Between the target and the floor, inside the header caption.
  assert.match(
    grid,
    /target \{fmtPct\(targetPct\)\}[\s\S]{0,120}?<QuoteTargetMarginPopover[\s\S]{0,80}?floor \{fmtPct\(floorPct\)\}/,
  );
});

test("the grid is rendered by the live shell with editability threaded", async () => {
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.match(shell, /<ComplianceGrid[\s\S]{0,400}?editable=\{committable\}/);
});

test("a sent quote shows the target and cannot change it", async () => {
  // Affordance only — the action enforces the draft guard server-side too.
  const grid = await code("components/pricing-surface/compliance-grid.tsx");
  assert.match(grid, /disabled=\{!editable\}/);
  const action = await code("app/actions/costing.ts");
  const fn = action.slice(action.indexOf("export async function updateQuoteTargetMargin"));
  assert.match(fn.slice(0, 1200), /assertDraft|requireDraft|ERR\./);
});

// ── the authority was never the broken part; keep it that way ─────────────

test("the write still goes through the one governed action", async () => {
  const pop = await code("components/quote-target-margin-popover.tsx");
  assert.match(pop, /import \{ updateQuoteTargetMargin \}/);
  assert.match(pop, /await updateQuoteTargetMargin\(fd\)/);
  // No second writer appeared while the control was dark.
  const grid = await code("components/pricing-surface/compliance-grid.tsx");
  assert.doesNotMatch(grid, /targetMarginPct.*=|\.set\(\{/);
});

test("blank still means inherit, and the effective value is read from the graph", async () => {
  // The NULL=inherit semantic is what makes the override legible. The
  // "currently effective" line must come from the engine's published
  // resolution, not from a private re-derivation of the ladder.
  const pop = await code("components/quote-target-margin-popover.tsx");
  assert.match(pop, /readEffectiveTargetMargin\(graph\)/);
  assert.match(pop, /revertToFirm/);
});

// ── the two repairs the re-mount required ─────────────────────────────────

test("the popover carries no hardcoded palette — it renders in dark mode", async () => {
  // It shipped in `gray-*` / `blue-*` Tailwind, which is light-mode only.
  // Re-mounting it unconverted would have put the one un-themed card on a
  // surface whose dark mode was just verified clean under B-17.
  const pop = await readFile(SRC + "components/quote-target-margin-popover.tsx", "utf8");
  for (const shade of [/\bbg-white\b/, /\bgray-\d/, /\bblue-\d/, /\bred-\d/]) {
    assert.doesNotMatch(pop, shade, `hardcoded palette back in the popover: ${shade}`);
  }
});

test("Cancel is not disabled by the save it does not initiate", async () => {
  // Pattern 47(f). One transition gated Save, Cancel AND revert, so an
  // in-flight save trapped the operator in a dialog they had decided to leave.
  const pop = await code("components/quote-target-margin-popover.tsx");
  const cancel = pop.slice(pop.indexOf("onClick={() => setOpen(false)}"));
  const untilClose = cancel.slice(0, cancel.indexOf("</button>"));
  assert.doesNotMatch(untilClose, /disabled=\{pending\}/, "Cancel is gated again");
  // Save keeps its own pending — double-click protection, permitted on buttons.
  assert.match(pop, /onClick=\{\(\) => attemptSave\(draft\)\}[\s\S]{0,200}?disabled=\{pending\}/);
});

test("a disabled control says why", async () => {
  // Pattern 47(f): a greyed control with no explanation is not acceptable
  // operator behaviour. Revert stays gated on `pending` because it DOES write.
  const pop = await code("components/quote-target-margin-popover.tsx");
  assert.match(pop, /pending[\s\S]{0,80}?Saving — the revert will be available/);
});
