import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string => stripComments(src).replace(/\r\n/g, "\n");
const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

// ═══════════════════════════════════════════════════════════════════════
// The collapsible secondary panel is PRESENTATION ONLY. These assert the
// boundary as much as the behaviour — the risk in a shell change is not that
// it fails to collapse, it is that it quietly alters navigation.
// ═══════════════════════════════════════════════════════════════════════

test("collapsing is a view change, never a navigation", async () => {
  const src = codeOnly(await read("src/components/rails/inner-rail-collapse.tsx"));
  assert.match(src, /<button/, "the toggle is not a button");
  assert.doesNotMatch(src, /<Link|href=|router\.(push|replace)/, "the toggle can navigate");
  assert.match(src, /aria-expanded=/);
  assert.match(src, /aria-controls="inner-rail"/);
});

test("the panel's route and active-link logic is untouched", async () => {
  const rail = await read("src/components/rails/inner-rail.tsx");
  // The collapse work adds a wrapper and a toggle. It must not have introduced
  // or altered any link target or active-state computation.
  assert.match(rail, /id="inner-rail"/);
  assert.match(rail, /inner-rail-body/);
  assert.match(rail, /<InnerRailCollapse \/>/);
  // The rail still renders its own links; the collapse component adds none.
  const toggle = codeOnly(await read("src/components/rails/inner-rail-collapse.tsx"));
  assert.doesNotMatch(toggle, /activeQuoteId|activeScenarioLabel|scenarioStatus/);
});

test("the thin global rail is not part of this change", async () => {
  const outer = codeOnly(await read("src/components/rails/outer-rail.tsx"));
  assert.doesNotMatch(outer, /inner-rail/i, "the outer rail references the collapsible panel");
});

test("collapsed content is removed, not merely hidden", async () => {
  const css = await read("src/styles/inner-rail.css");
  // opacity/visibility would leave the panel keyboard-reachable behind a closed
  // surface and still occupying the reclaimed width.
  assert.match(
    css,
    /\[data-inner-rail="collapsed"\][\s\S]*?\.inner-rail-body\s*\{[^}]*display:\s*none/,
    "collapsed body is not display:none",
  );
});

test("one variable drives the panel and every offset", async () => {
  const css = await read("src/styles/inner-rail.css");
  for (const decl of [/--inner-rail-w:\s*15rem/, /--inner-rail-offset:\s*16rem/]) {
    assert.match(css, decl, "expanded geometry is not today's geometry");
  }
  assert.match(css, /\.inner-rail-offset\s*\{[^}]*padding-left:\s*var\(--inner-rail-offset\)/);

  // Both offset hosts must consume the class rather than a fixed utility, or
  // one surface would stay offset for a panel that is no longer there.
  for (const f of ["src/components/nav/nav-shell.tsx", "src/app/projects/[id]/page.tsx"]) {
    const src = await read(f);
    assert.match(src, /inner-rail-offset/, `${f} does not use the shared offset`);
    assert.doesNotMatch(src, /pl-64/, `${f} still hardcodes the expanded offset`);
  }
});

test("the state is applied before paint, and an explicit choice outranks the viewport", async () => {
  const layout = await read("src/app/layout.tsx");
  assert.match(layout, /nexus-inner-rail/, "no pre-hydration read of the stored state");
  assert.match(layout, /data-inner-rail/, "the attribute is not applied before paint");
  // The narrow-screen default must only apply when nothing is stored — otherwise
  // a narrow window silently overrides what the operator asked for.
  assert.match(
    layout,
    /r!=="expanded"&&r!=="collapsed"/,
    "the viewport default is not gated on the absence of a stored choice",
  );
});
