/**
 * B-16 · the pricing grid locates the compliance condition.
 *
 * Next Move already told the operator a quote was below target or below floor.
 * The grid did not say WHERE, so they read a verdict and then scanned
 * percentages to find the cells it meant.
 *
 * THE PART THAT CAN GO WRONG QUIETLY is not whether a cell is tinted. It is
 * WHERE THE TINT'S AUTHORITY COMES FROM. A component that recomputed margin
 * policy would look identical on every fixture anyone thought to build, and
 * would diverge from Next Move the first time a threshold moved. So these
 * assert the SOURCE, not the appearance.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const grid = stripComments(
  readFileSync("src/components/pricing-surface/compliance-grid.tsx", "utf8"),
);
const overrides = readFileSync(
  "src/styles/r12-pricing-workspace-overrides.css",
  "utf8",
);
const canonical = readFileSync(
  "src/styles/r11-pricing-workspace.css",
  "utf8",
);

/**
 * JUST the B-16 section, not everything after it.
 *
 * This sliced to end-of-file, so every rule appended to the overrides sheet
 * later was read as part of B-16 — and the cell drawer's shadow token failed
 * a "no literal colour in B-16" assertion for a declaration B-16 never made.
 * A check that cannot say where its subject ends will eventually fail on
 * something else's code, and the report will name the wrong author.
 */
function b16Block(): string {
  const start = overrides.indexOf("B-16");
  assert.notEqual(start, -1, "the B-16 section is gone");
  // Sections in this file open with a `/* ── ` heading rule.
  const next = overrides.indexOf("/* ── ", start);
  return next === -1 ? overrides.slice(start) : overrides.slice(start, next);
}

test("the cell carries the compliance state, not only the percentage", () => {
  // The defect B-16 names: the bundle colours `.cgm`, which is the digits. At
  // 27 cells a coloured digit is still a per-cell read.
  assert.match(
    grid,
    /"r11-bcell r11-cg cg-" \+ cell\.status/,
    "the cell's own class must carry the status",
  );
  assert.match(overrides, /\.r11-bcell\.r11-cg\.cg-below_target\s*\{/);
  assert.match(overrides, /\.r11-bcell\.r11-cg\.cg-below_floor\s*\{/);
});

test("the state is FORWARDED from the classifier, never recomputed here", () => {
  // The constraint that matters. The grid must not know what a target or a
  // floor is; if it did, it would be a second authority, and the first time
  // firm policy moved the grid and the banner would disagree — with no way for
  // an operator to tell which one was lying.
  assert.doesNotMatch(
    grid,
    /target_margin_pct|floor_margin_pct/,
    "the grid must not read margin policy",
  );
  // Bounded-gap, not adjacent. The first version of this asserted
  // `margin_pct\s*[<>]` and a planted `(cell.margin_pct ?? 1) < 0.25` walked
  // straight through it — the `?? 1)` was enough to break adjacency. A check
  // that only catches the tidiest way of writing the defect catches nothing.
  assert.doesNotMatch(
    grid,
    /margin_pct[\s\S]{0,40}?[<>]=?[\s\S]{0,20}?\d/,
    "the grid must not compare a margin against a threshold",
  );
  assert.doesNotMatch(
    grid,
    /Math\.(min|max)\([^)]*margin/,
    "nor derive one by comparison",
  );
  // And the tint's source is the classifier's decided verdict.
  assert.match(grid, /cell\.status/);
});

test("no margin policy leaks into the stylesheet either", () => {
  // A CSS file cannot compare numbers, but it CAN encode a threshold in a
  // class name and invite one — `.cg-below-25` and the like. Named here so the
  // next person adding a state has to notice.
  assert.doesNotMatch(overrides, /cg-(below|above)-\d/);
});

test("selection coexists with compliance rather than masking it", () => {
  // The bundle's `.sel` sets an accent BACKGROUND and a ring. On a red cell the
  // background would win, and the breach would disappear at the moment the
  // operator clicked the cell to act on it — the signal removed exactly when
  // it is being used.
  assert.match(
    canonical,
    /\.r11-bcell\.r11-cg\.sel\s*\{[^}]*background:/,
    "precondition: the bundle's selected state does set a background",
  );
  for (const status of ["below_target", "below_floor"]) {
    assert.match(
      overrides,
      new RegExp(`\\.r11-bcell\\.r11-cg\\.sel\\.cg-${status}\\s*\\{[^}]*background:`),
      `selection must not take the background from a ${status} cell`,
    );
  }
});

test("hover does not erase the state it is hovering over", () => {
  assert.match(
    canonical,
    /\.r11-bcell:hover\s*\{[^}]*background:/,
    "precondition: the bundle's hover sets a background",
  );
  for (const status of ["below_target", "below_floor"]) {
    assert.match(
      overrides,
      new RegExp(`\\.r11-bcell\\.r11-cg\\.cg-${status}:hover\\s*\\{[^}]*background:`),
    );
  }
});

test("the treatment uses the existing warn/bad vocabulary, not new colour", () => {
  // "Restrained, and within the existing Nexus warning/error vocabulary." A new
  // hue here would be a fourth signal colour on a surface that already has
  // three, and it would not follow the theme.
  const block = b16Block();
  assert.match(block, /var\(--warn-soft\)/);
  assert.match(block, /var\(--bad-soft\)/);
  assert.doesNotMatch(
    block,
    /#[0-9a-fA-F]{3,8}\b|oklch\(|rgb\(/,
    "no literal colour — the tokens carry light and dark",
  );
});

test("above_target and unknown get no cell treatment", () => {
  // A compliant cell is the normal case and must stay visually quiet; tinting
  // it would make the grid uniformly loud and locate nothing. `unknown` has no
  // verdict to state, and a tint would assert one.
  const block = b16Block();
  assert.doesNotMatch(block, /\.cg-above_target\s*\{/);
  assert.doesNotMatch(block, /\.cg-unknown\s*\{/);
});

test("canonical bundle files are untouched", () => {
  // Pattern 30 — the bundle is a verbatim copy so a refresh stays a drop-in.
  // Everything above lives in the overrides file.
  assert.doesNotMatch(canonical, /cg-below_target|cg-below_floor/);
});
