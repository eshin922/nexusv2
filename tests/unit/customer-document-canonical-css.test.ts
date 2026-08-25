import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// The real CSS parser Next builds this project with. Asserting against what
// the PARSER sees, rather than against the file's text, is the whole point of
// the third test below — see its comment.
const { transform } = createRequire(import.meta.url)("lightningcss") as {
  transform: (o: { filename: string; code: Buffer; minify: boolean }) => {
    code: Buffer;
  };
};

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

const ADOPTED = "src/styles/pp-customer-document.css";
const UPSTREAM =
  "docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/styles.css";

/** The upstream line where the paged artifact begins — its divider comment. */
const ARTIFACT_MARKER = "THE PAGED ARTIFACT";

/**
 * The canonical customer-document stylesheet is adopted VERBATIM (Pattern 30).
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────
 *
 * The first adoption copied from one line too late. It began on the CLOSING
 * line of the artifact's divider comment, so the file opened with an unpaired
 * comment terminator. CSS has no error to raise for that: the parser treated
 * the wreckage plus the following rule as one unparseable block and discarded
 * it.
 *
 * (This very comment reproduced the bug while being written — spelling the
 * terminator literally inside a block comment ends the block. That one at
 * least fails loudly, at parse time.)
 *
 * The rule it discarded was `.pp-sheet` — which is where the document's entire
 * local palette lives, every `--pp-*` token, deliberately declared there
 * because the artifact is print-target and theme-independent.
 *
 * So the document rendered with NO paper colour, NO ink colour and NO rules,
 * inheriting whatever sat behind it. It still laid out correctly, still showed
 * every figure, still passed the boundary verifier and the whole unit suite,
 * and looked at a glance like a slightly grey version of the right thing.
 * What exposed it was not the screenshot — the eye accepted the grey — but a
 * measurement of `backgroundColor` returning `rgba(0,0,0,0)` on paper that is
 * supposed to be near-white.
 *
 * A byte comparison is the instrument that can express this failure. "Does it
 * contain .pp-sheet" cannot: the text was present the whole time, in a block
 * the parser had thrown away.
 */

test("the adopted stylesheet is byte-identical to its upstream slice", async () => {
  const adopted = await read(ADOPTED);
  const upstream = await read(UPSTREAM);

  const at = upstream.indexOf(ARTIFACT_MARKER);
  assert.ok(at > 0, "upstream must still mark where the paged artifact begins");

  // Back up to the opening `/*` of the divider comment that marks the start.
  // Copying from anywhere after this point truncates a comment and silently
  // destroys the rule that follows it.
  const start = upstream.lastIndexOf("/*", at);
  assert.ok(start > 0, "the marker must sit inside a comment");

  const expected = upstream.slice(start);

  // The adopted file is the Nexus header comment followed by that slice.
  assert.ok(
    adopted.endsWith(expected),
    "the adopted stylesheet must end with the upstream slice, unedited — " +
      "edit upstream and re-copy rather than editing the adopted file",
  );

  // And it must contain nothing of the upstream's preview-only chrome, which
  // upstream itself marks as "NOT part of the artifact".
  const rules = adopted.slice(adopted.indexOf(expected));
  assert.ok(!rules.includes(".cpdf-"), "preview chrome must not be adopted");
});

test("the adopted stylesheet parses — every brace balances", async () => {
  const adopted = await read(ADOPTED);
  const withoutComments = adopted.replace(/\/\*[\s\S]*?\*\//g, "");

  // An unpaired comment terminator is what the byte comparison above was
  // written for; this catches the same wreckage from any other cause.
  assert.ok(
    !withoutComments.includes("*/"),
    "an unpaired comment terminator means a comment was truncated — " +
      "the rule after it is silently discarded",
  );

  const open = (withoutComments.match(/\{/g) ?? []).length;
  const close = (withoutComments.match(/\}/g) ?? []).length;
  assert.equal(open, close, "unbalanced braces — rules will be swallowed");
});

test("the document's local palette survives an actual CSS parse", async () => {
  // ── WHY THIS PARSES INSTEAD OF PATTERN-MATCHING ────────────────────────
  //
  // The first version of this test stripped comments and then checked that
  // the first rule was `.pp-sheet` carrying the palette. Run against the real
  // defect — a copy begun one line late, opening on an unpaired comment
  // terminator — it PASSED. Stripping comments normalises the wreckage away,
  // so the text looked exactly like a healthy file while the browser was
  // discarding the rule and rendering a document with no colours at all.
  //
  // A guard written specifically to catch "an instrument that cannot express
  // the failure" could not express the failure. The fix is to stop reading the
  // text and ask the parser: lightningcss throws on the broken file, and its
  // output is what the browser would actually apply.
  const adopted = await read(ADOPTED);
  const parsed = transform({
    filename: "pp-customer-document.css",
    code: Buffer.from(adopted),
    minify: false,
  }).code.toString();

  // Present in the PARSED output — i.e. in a rule that survived, not merely
  // in the source text.
  for (const token of [
    "--pp-ink",
    "--pp-paper",
    "--pp-rule",
    "--pp-strong",
    "--pp-rec-edge",
    "--pp-star",
  ]) {
    assert.ok(
      parsed.includes(token),
      `${token} did not survive the parse — the .pp-sheet rule was discarded, ` +
        `and the document has no other source for the palette`,
    );
  }

  assert.match(parsed, /\.pp-sheet/, "the sheet rule itself must survive");
});

test("Nexus adaptations live outside the canonical file", async () => {
  // Pattern 30: the adopted file stays pristine so an R-round refresh is a
  // re-copy. Anything Nexus needs goes in the fit sheet beside it.
  const fit = await read("src/styles/pp-customer-document-fit.css");
  assert.match(fit, /font-family: var\(--display\)/, "fonts are bound here, not upstream");
  assert.match(fit, /\.pp-fit/, "the pane fit is a Nexus concern");
});

test("every canonical font family is bound to a loaded face", async () => {
  // The canonical rules name `"Newsreader"` and `"JetBrains Mono"` literally.
  // next/font serves both under GENERATED family names, so those literals
  // match nothing and the stack falls through to Georgia — a document set in
  // the wrong face, silently, against a PDF that gets the right one.
  //
  // Derived the same way the fit sheet's lists were: every canonical rule that
  // names a family must be re-bound. A new canonical rule naming a family and
  // missing from the fit sheet fails here rather than shipping unbound.
  const adopted = await read(ADOPTED);
  const fit = await read("src/styles/pp-customer-document-fit.css");
  const body = adopted.replace(/\/\*[\s\S]*?\*\//g, "");

  const unbound: string[] = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].split("\n").map((s) => s.trim()).filter(Boolean).join(" ");
    const declarations = m[2];
    if (!/font-family:\s*"(Newsreader|JetBrains Mono)"/.test(declarations)) continue;
    // The fit sheet must re-bind this exact selector.
    if (!fit.includes(selector)) unbound.push(selector);
  }

  assert.deepEqual(
    unbound,
    [],
    "these canonical rules name a font family that next/font does not serve " +
      "under that name, and the fit sheet does not re-bind them",
  );
});
