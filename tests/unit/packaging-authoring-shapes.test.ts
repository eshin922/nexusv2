import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Packaging cost authoring must work for BOTH commercial shapes.
 *
 * ── WHAT THIS EXISTS TO CATCH ────────────────────────────────────────────
 *
 * A top-level Direct Product's packaging row carries `assembly_leaf_id = NULL`
 * — it attaches by the canonical `quote_leaf_id`. Two writers reached the quote
 * by INNER JOINing `assembly_leaves`, so those rows were invisible to them:
 *
 *   updateAssemblyLeafInputCell        → "Cell not found"
 *   quoteForAssemblyLeafInputLineGroup → "Packaging line not found"
 *
 * The second is worse than it sounds: it guards markup, category, pricing
 * vendor, qty-per-sellable-unit, notes and inventory-eligible. Every
 * line-level edit on a Direct Product refused.
 *
 * Neither surfaced as an error an operator could act on. The inputs accepted a
 * keystroke, the debounced save failed, and the value reverted about a second
 * later — so the controls read as inert rather than broken, and the cost cell
 * was the only one reported.
 *
 * ── THE SHAPE OF THE MISTAKE ─────────────────────────────────────────────
 *
 * The READ side was corrected for exactly this at OD-017, and says so in
 * `actions/costing.ts`: "Reaching the quote via `assemblies` structurally
 * excluded a Direct Component — its rows existed but no loader could see them,
 * which is most of why a direct attachment was unpriceable."
 *
 * The loaders were fixed. These writers were not. That is the migration lesson
 * about enumerating every PRODUCER and CONSUMER of a changed identity: a
 * consumer surfaces in a type error, a producer that emits a plausible-but-
 * unreachable value does not.
 *
 * It is also the fourth instance of one assumption in this slice:
 *   38db86c  Direct Service with no Item Group could not author production
 *   8ad9b7f  Production drilldown crashed on zero Item Groups
 *   fab165a  SEND gate counted Item Groups while claiming to count SKUs
 *   this     packaging authoring required an Item Group
 */

const read = (p: string) => readFile(p, "utf8");

// ── 1 · the cell writer resolves canonically ─────────────────────────────

test("the packaging CELL writer reaches the quote by canonical identity", async () => {
  const src = await read("src/app/actions/assembly-leaf-inputs.ts");
  const fn = src.slice(
    src.indexOf("export async function updateAssemblyLeafInputCell"),
    src.indexOf("export async function", src.indexOf("export async function updateAssemblyLeafInputCell") + 10),
  );
  assert.ok(fn.length > 0, "updateAssemblyLeafInputCell was not found");

  // Resolves through the governed canonical guard…
  assert.match(fn, /await quoteForQuoteLeaf\(row\.quoteLeafId\)/);
  // …and never through the assembly chain, which a Direct Product cannot travel.
  assert.doesNotMatch(
    fn,
    /innerJoin\(\s*assemblyLeaves/,
    "the cell writer inner-joins assembly_leaves again — a top-level Direct " +
      "Product's row carries NULL there and would refuse with 'Cell not found'",
  );
  assert.doesNotMatch(fn, /quoteForAssemblyLeaf\(/);
});

test("a cost row with NO canonical identity is refused, not guessed", async () => {
  const src = await read("src/app/actions/assembly-leaf-inputs.ts");
  // Falling back to the legacy join would attribute a cost to whichever line
  // the junction happened to name. Refusing is the only safe direction.
  assert.match(src, /if \(!row\.quoteLeafId\)/);
  assert.match(src, /carries no commercial identity and cannot be edited/);
});

// ── 2 · the LINE-level writer too — the half that was nearly missed ──────

test("the packaging LINE guard reaches the quote by canonical identity", async () => {
  const guards = await read("src/lib/quote-guards.ts");
  const fn = guards.slice(
    guards.indexOf("export async function quoteForAssemblyLeafInputLineGroup("),
  );
  const body = fn.slice(0, fn.indexOf("\nexport ", 10));

  assert.match(body, /await quoteForQuoteLeaf\(quoteLeafId\)/);
  assert.doesNotMatch(
    body,
    /innerJoin\(\s*assemblies/,
    "the line guard chains through assemblies again — markup, category, " +
      "vendor, qty and notes would all refuse on a Direct Product",
  );
  assert.match(body, /if \(!quoteLeafId\)/, "a line with no canonical identity must be refused");
});

test("its assembly is NULLABLE, because a Direct Product has none", async () => {
  const guards = await read("src/lib/quote-guards.ts");
  const sig = guards.slice(
    guards.indexOf("export async function quoteForAssemblyLeafInputLineGroup("),
  );
  const decl = sig.slice(0, sig.indexOf("{", sig.indexOf("Promise<")) + 400);
  assert.match(
    decl,
    /assembly: Assembly \| null/,
    "a non-null assembly in the signature is the same assumption in the type system",
  );
});

// ── 3 · the Item Group shape is unchanged ────────────────────────────────

test("BOTH shapes travel one path, with no branch on structure", async () => {
  const guards = await read("src/lib/quote-guards.ts");
  const canonical = guards.slice(
    guards.indexOf("export async function quoteForQuoteLeaf("),
  );
  const body = canonical.slice(0, canonical.indexOf("\nexport ", 10));

  // A LEFT join is what makes one path serve both: grouped members resolve
  // their assembly, a Direct Product resolves null, and neither is excluded.
  assert.match(body, /leftJoin\(assemblies/);
  assert.doesNotMatch(
    body,
    /innerJoin\(assemblies/,
    "an inner join here would re-exclude every Direct Product",
  );
  // And it still asserts draft — the property the delegation must preserve.
  assert.match(body, /requireDraft\(quote\)/);
});

test("the guard still proves attachment identity against quote membership", async () => {
  const guards = await read("src/lib/quote-guards.ts");
  const canonical = guards.slice(
    guards.indexOf("export async function quoteForQuoteLeaf("),
  );
  const body = canonical.slice(0, canonical.indexOf("\nexport ", 10));
  // Reachability was widened; the integrity check must not have been relaxed
  // along with it.
  assert.match(body, /attachment\.quoteId !== quote\.id/);
  assert.match(body, /attachment\.leafId !== quoteLeaf\.leafId/);
  assert.match(body, /does not match its Quote membership/);
});

// ── 4 · no placeholder assembly is invented ──────────────────────────────

test("nothing creates a synthetic Item Group to make the control work", async () => {
  const src = await read("src/app/actions/assembly-leaf-inputs.ts");
  const guards = await read("src/lib/quote-guards.ts");
  for (const [name, s] of [["actions", src], ["guards", guards]] as const) {
    assert.doesNotMatch(
      s,
      /insert\(assemblies\)/,
      `${name} creates an assembly — a placeholder Item Group would make the ` +
        `write succeed while corrupting the quote's commercial structure`,
    );
    assert.doesNotMatch(s, /insert\(assemblyLeaves\)/);
  }
});
