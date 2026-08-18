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
        .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

// ── reachability, which is the whole finding ──────────────────────────────

test("the control is mounted on a surface that renders, and on ONE of them", async () => {
  // `VerdictBand` was still on disk and still importing the popover, so an
  // assertion of the form "something imports it" would have passed throughout
  // the entire period the column was unwritable. That dead mount is now gone,
  // which makes this assertion mean what it says.
  const grid = await code("components/pricing-surface/compliance-grid.tsx");
  assert.match(grid, /import \{ QuoteTargetMarginPopover \}/);
  assert.match(grid, /<QuoteTargetMarginPopover/);

  const orphan = await code("components/pricing/verdict-band.tsx");
  assert.doesNotMatch(
    orphan,
    /QuoteTargetMarginPopover/,
    "the torn-down legacy host mounts the control again",
  );
});

test("the control IS the target figure, rather than an icon beside it", async () => {
  // The discoverability defect: a bare gear next to the word "target". The
  // number read as passive status and the icon read as generic settings, so
  // the restored authoring path was still effectively unfindable.
  const grid = await code("components/pricing-surface/compliance-grid.tsx");
  // The caption no longer prints the target itself — the control does.
  assert.doesNotMatch(grid, /target \{fmtPct\(targetPct\)\}/);
  assert.match(grid, /<QuoteTargetMarginPopover[\s\S]{0,300}?value=\{targetPct\}/);
  // Still inside the grid header caption, before the floor. No new card.
  assert.match(
    grid,
    /<QuoteTargetMarginPopover[\s\S]{0,320}?floor \{fmtPct\(floorPct\)\}/,
  );
});

test("the displayed target is the caller's, not a second read of the ladder", async () => {
  // The grid bands every cell against `targetPct`. A control that re-derived
  // its own value could be individually correct and still disagree with the
  // grid it sits on top of.
  const pop = await code("components/quote-target-margin-popover.tsx");
  assert.match(pop, /value: number;/);
  assert.match(pop, /\{fmtPct\(value\)\}/);
});

test("it names itself Margin Target, and the value is inside the clickable target", async () => {
  const pop = await code("components/quote-target-margin-popover.tsx");
  const trigger = pop.slice(0, pop.indexOf("psr-target-pop\""));
  assert.match(trigger, /Margin target/);
  // Label, value and edit affordance in ONE button — not an icon to hunt for.
  assert.match(
    trigger,
    /<button[\s\S]{0,900}?className=\{`psr-target-control[\s\S]{0,400}?Margin target[\s\S]{0,200}?\{fmtPct\(value\)\}[\s\S]{0,120}?Edit/,
  );
  assert.doesNotMatch(trigger, /⚙/, "the bare gear is back");
});

test("the grid is rendered by the live shell with editability threaded", async () => {
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.match(shell, /<ComplianceGrid[\s\S]{0,400}?editable=\{committable\}/);
});

test("a sent quote shows the target with NO edit treatment at all", async () => {
  // Not a dimmed control: a greyed affordance reads as something broken rather
  // than something absent, which is what the walk found with the old gear.
  const pop = await code("components/quote-target-margin-popover.tsx");
  assert.match(pop, /disabled \? \([\s\S]{0,400}?psr-target-static/);
  const readOnly = pop.slice(pop.indexOf("psr-target-static"));
  const untilElse = readOnly.slice(0, readOnly.indexOf(") : ("));
  assert.match(untilElse, /Margin target/, "the read-only state must still name it");
  assert.match(untilElse, /\{fmtPct\(value\)\}/, "and still state the value");
  assert.doesNotMatch(untilElse, /<button/, "read-only must not render a button");
  assert.doesNotMatch(untilElse, /Edit/, "read-only must not offer an edit affordance");

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
