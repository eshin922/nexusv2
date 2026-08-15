/**
 * B-17 · dark-mode structural contrast.
 *
 * In dark mode, table and card boundaries and row separators sat too close in
 * luminance to the near-black background. Content was readable; STRUCTURE was
 * not — the operator could not perceive where one division ended and the next
 * began.
 *
 * These assert the PROPERTIES the finding named, not the specific numbers, so
 * a future tuning pass can move the values without having to defeat a test —
 * but cannot silently undo the hierarchy, brighten the surfaces, or lose the
 * fix by reverting one token and not the other.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/design-tokens.css", "utf8");

/**
 * The two token scopes, resolved by finding the block that actually DECLARES
 * the palette.
 *
 * Not `indexOf('[data-theme="dark"]')`. The first occurrence of that selector
 * sets `color-scheme` and nothing else, and it sits ABOVE the light `:root`
 * palette — so splitting there read light-mode white as dark-mode paper and
 * every assertion below failed for the wrong reason. A scope resolver that can
 * silently pick the wrong block makes every number it returns meaningless.
 */
function paletteBlocks() {
  const blocks: Array<{ selector: string; body: string }> = [];
  const re = /(:root|\[data-theme="[a-z]+"\])\s*\{([\s\S]*?)\n\}/g;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    if (m[2].includes("--rule:")) blocks.push({ selector: m[1], body: m[2] });
  }
  return blocks;
}

const blocks = paletteBlocks();
const scopeBody = (scope: "light" | "dark") => {
  const wanted = scope === "dark" ? '[data-theme="dark"]' : ":root";
  const found = blocks.find((b) => b.selector === wanted);
  assert.ok(found, `no palette block declares --rule for ${scope}`);
  return found!.body;
};

function lightness(scope: "light" | "dark", name: string): number {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)`).exec(scopeBody(scope));
  assert.ok(m, `--${name} not found in ${scope} scope`);
  return Number(m![1]);
}

test("precondition · the two palettes resolve, and to different blocks", () => {
  // Without this the suite can pass by comparing a scope to itself.
  assert.equal(blocks.length, 2, `expected 2 palette blocks, found ${blocks.length}`);
  assert.notEqual(scopeBody("light"), scopeBody("dark"));
  assert.notEqual(lightness("light", "paper"), lightness("dark", "paper"));
});

const dark = (n: string) => lightness("dark", n);
const light = (n: string) => lightness("light", n);

test("separators are perceptibly lifted off the darkest surface", () => {
  // The defect: `--rule` at 0.30 against `--paper` at 0.16 is a 0.14 gap, and
  // at hairline width that is what "structure is not readable" looked like.
  assert.ok(
    dark("rule") - dark("paper") >= 0.18,
    `separator/paper gap ${(dark("rule") - dark("paper")).toFixed(3)} is too small to scan`,
  );
});

test("a separator is distinguishable from the lightest SURFACE, not just the darkest", () => {
  // A card sits on `--paper-4`. A separator only lifted off `--paper` would
  // still vanish there — which is where the Item Group/member divisions live.
  assert.ok(
    dark("rule") > dark("paper-4"),
    "a separator must be lighter than every surface it can be drawn on",
  );
});

test("container boundaries stay stronger than internal separators", () => {
  // "The hierarchy between the two is itself the signal." Lifting both equally
  // would restore visibility and flatten the thing that tells an operator
  // which line is an outer boundary and which is a row division.
  assert.ok(
    dark("rule-2") > dark("rule"),
    "--rule-2 must remain the stronger of the two",
  );
  assert.ok(
    dark("rule-2") - dark("rule") >= 0.06,
    `the hierarchy gap ${(dark("rule-2") - dark("rule")).toFixed(3)} is too slight to read`,
  );
});

test("the near-black surfaces are preserved — dark mode is not brighter", () => {
  // The fix is lines, not light. If a later tuning pass raises the surfaces to
  // "fix contrast", this is what says that was a different change.
  assert.ok(dark("paper") <= 0.17, `--paper drifted to ${dark("paper")}`);
  assert.ok(dark("paper-2") <= 0.20);
  assert.ok(dark("paper-3") <= 0.23);
  assert.ok(dark("paper-4") <= 0.27);
});

test("borders stay neutral — no accent colour for ordinary structure", () => {
  // "No accent colors for ordinary structural separation." Chroma is what
  // would turn a divider into a signal, and a surface where every division is
  // a signal has none.
  const block = css.slice(css.indexOf('[data-theme="dark"]'));
  for (const name of ["rule", "rule-2"]) {
    const m = new RegExp(`--${name}:\\s*oklch\\([\\d.]+\\s+([\\d.]+)`).exec(block);
    assert.ok(m, `--${name} not found`);
    assert.ok(
      Number(m![1]) <= 0.02,
      `--${name} chroma ${m![1]} reads as a colour, not as structure`,
    );
  }
});

test("light mode is untouched by a dark-mode finding", () => {
  assert.equal(light("rule"), 0.88);
  assert.equal(light("rule-2"), 0.82);
  // And light mode's hierarchy runs the OTHER way — a darker line is the
  // stronger one on a white ground. Asserted so a future "make them
  // consistent" pass has to notice that consistency here would be inversion.
  assert.ok(light("rule-2") < light("rule"));
});

test("the fix is at the token, so every surface gets it", () => {
  // Patching Setup alone would have left the same defect on Costs, Pricing and
  // the admin surfaces while appearing resolved. This is the assertion that
  // the repair reached the shared level.
  const styles = readFileSync("src/styles/r7b-setup.css", "utf8");
  assert.ok(
    styles.includes("var(--rule)"),
    "Setup must consume the shared token rather than a local border colour",
  );
  // A LITERAL colour only. `oklch(from var(--accent) …)` is a relative-colour
  // derivation and still flows from a token, so it follows the theme — and the
  // two in Setup are accent affordances (a selected chip, an Item Group tag),
  // not structural separation, which B-17 explicitly leaves alone.
  //
  // The first version of this matched any `oklch(` after `border` and flagged
  // both. A rule that cannot tell a derived colour from a frozen one would
  // push the next author toward hardcoding to get past it.
  assert.doesNotMatch(
    styles,
    /border[^;]*:\s*[^;]*oklch\(\s*[\d.]/,
    "no surface may freeze a literal border colour past the token",
  );
});
