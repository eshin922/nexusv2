import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");
/** Comments explain what was REMOVED, so a raw-source check matches its own
 *  explanation. Absence assertions read code only. */
const code = async (p: string) => codeOnly(await read(p));
const PKG = "src/components/costs/packaging-drilldown.tsx";
const SVC = "src/components/costs/direct-service-production.tsx";
const CSS = "src/styles/r6-costs.css";

// ═══════════════════════════════════════════════════════════════════════
// Direct Service's tier cell must match PACKAGING'S, not a Production-specific
// approximation of it.
//
// The defect these pin: the cell was `<div className="num cell">` around an
// unstyled input, and `.r6-dt-row .cell` has NO rule in the canonical
// stylesheet. One omission produced all three reported symptoms — default
// typography, no editable-cell blue, and an input at its ~20ch intrinsic width
// blowing an 80px grid track across the next tier column.
//
// Asserted AGAINST PACKAGING wherever possible rather than against literals I
// picked, so the two cannot drift apart without failing here.
// ═══════════════════════════════════════════════════════════════════════

test("both tier cells use the same class, and that class is the styled one", async () => {
  const [pkg, svc, css] = await Promise.all([read(PKG), read(SVC), read(CSS)]);

  assert.match(pkg, /className=\{`cell-num \$\{isEmpty \? "empty" : ""\}`\}/);
  assert.match(svc, /className=\{`cell-num \$\{isEmpty \? "empty" : ""\}`\}/);

  // `cell-num` carries a rule; `.cell` never did. Asserting the rule EXISTS is
  // the part that makes the class choice meaningful rather than cosmetic.
  assert.match(css, /\.r6-dt-row \.cell-num \{[^}]*font-family: var\(--mono\)/);
  assert.doesNotMatch(
    await code(SVC),
    /className="num cell"/,
    "the unstyled cell wrapper is back",
  );
});

test("the inner input declares the same properties in both sections", async () => {
  const [pkg, svc] = await Promise.all([read(PKG), read(SVC)]);
  // `width: 100%` is the geometry contract: the input is 100% OF ITS CELL, so
  // it cannot exceed its own tier column. A fixed px width would look correct
  // at one column size and wrong at every other — which is why this is asserted
  // as the shared declaration rather than as any particular number.
  for (const decl of [
    /background: "transparent"/,
    /border: "none"/,
    /font: "inherit"/,
    /color: "inherit"/,
    /width: "100%"/,
    /textAlign: "right"/,
    /padding: 0/,
  ]) {
    assert.match(pkg, decl, `packaging (the reference) lost ${decl}`);
    assert.match(svc, decl, `direct service does not match packaging on ${decl}`);
  }
  // No one-off width patch.
  assert.doesNotMatch(svc, /width: "?\d+px/, "a fixed pixel width was applied");
  assert.doesNotMatch(svc, /minWidth: "?\d+px/, "a fixed min-width was applied");
});

test("the editable-cell shading is the same signal, from the same store read", async () => {
  const [pkg, svc] = await Promise.all([read(PKG), read(SVC)]);
  for (const src of [pkg, svc]) {
    assert.match(
      src,
      /style=\{isActive \? \{ background: "var\(--accent-soft\)" \} : undefined\}/,
      "the active-cell treatment differs between the two sections",
    );
  }
  // Both must derive `isActive` from the SAME store selector, or they can shade
  // different columns while each looking correct in isolation.
  assert.match(svc, /selectActiveTierId/);
  assert.match(svc, /isActive=\{activeTierId === t\.id\}/);
});

test("tier columns are the same width in both section grids", async () => {
  const css = await read(CSS);
  // Finding 2 was reported as an editor spanning two columns; the TRACKS were
  // never the cause and this pins that. If they ever diverge, the editor
  // geometry stops being comparable and this fails before a visual pass would.
  const pkgCols = css.match(/\.r6-dt\.pkg \.r6-dt-head[^{]*\{\s*grid-template-columns: ([^;]+);/)?.[1];
  const prodCols = css.match(/\.r6-dt\.prod \.r6-dt-head[^{]*\{\s*grid-template-columns: ([^;]+);/)?.[1];
  assert.ok(pkgCols && prodCols, "could not read both grid definitions");
  const tierTrack = /repeat\(var\(--cols, 4\), 80px\)/;
  assert.match(pkgCols, tierTrack);
  assert.match(prodCols, tierTrack, "production tier columns are not 80px like packaging's");
});
