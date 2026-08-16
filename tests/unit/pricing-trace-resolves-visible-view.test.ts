/**
 * A pressed cell must resolve against the table that is on screen.
 *
 * ── THE DEFECT, TWICE ─────────────────────────────────────────────────────
 *
 * The Price Build renders a `why? ▸` button on every contribution cell. The
 * click handler finds which tier row the pressed node belongs to by searching a
 * map of node keys, and returns early if it finds nothing.
 *
 * P-PriceBuild-UX1: the cells had been switched to the per-unit price build
 * while the handler still searched the quote-wide blend. `unit/{id}/{tier}/pkg`
 * is not in a map of `quote/{tier}/…` keys, so every cell was a button that did
 * nothing. Fixed by pointing the search at the per-unit map, with a note saying
 * that naming the map once removed the class of defect.
 *
 * It did not. Entire Quote then arrived as a NEW DEFAULT VIEW with its own
 * keys; the map fell through to empty for it; and the same silent miss came
 * back on the view an operator sees first. The invariant was right — a second
 * map was added underneath it.
 *
 * ── WHY IT WAS SILENT BOTH TIMES ──────────────────────────────────────────
 *
 * `if (tierId === null) return;` — the failure mode of a wiring fault was
 * indistinguishable from a cell that legitimately has nothing to trace. It now
 * warns, so the second thing to check is not "is the operator clicking the
 * right pixel".
 *
 * ── WHAT IS ASSERTED ──────────────────────────────────────────────────────
 *
 * That the resolver is derived from the SELECTED VIEW and fed by every table
 * that can render cells, rather than from one of the tables. A third view
 * repeats this only by failing to appear here — a visible omission rather than
 * a silent miss.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SHELL = fileURLToPath(
  new URL("../../src/components/pricing-surface/pricing-surface-shell.tsx", import.meta.url),
);

/** Comments stripped: this file explains the defect by naming the old code. */
async function code(): Promise<string> {
  const raw = await readFile(SHELL, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The body of one `useMemo`/`useCallback`, sliced from its opening line. */
function sliceFrom(src: string, needle: string): string {
  const i = src.indexOf(needle);
  assert.notEqual(i, -1, `${needle} not found`);
  const rest = src.slice(i);
  const end = rest.indexOf("\n  const ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

test("the resolver is built from the selected view, not from one table", async () => {
  const body = sliceFrom(await code(), "const traceKeysByTier = useMemo(");
  // Both tables that can render traceable cells.
  assert.match(body, /entireQuoteByTier/, "Entire Quote cannot be traced");
  assert.match(body, /priceBuildByUnit/, "a priced unit cannot be traced");
  // Branched on the selection, so the source follows what is rendered.
  assert.match(body, /priceBuildUnitId === null/);
});

test("the click handler searches that resolver and nothing else", async () => {
  const body = sliceFrom(await code(), "const onTraceStackCell = useCallback(");
  assert.match(body, /for \(const \[numeric, keys\] of traceKeysByTier\)/);
  // `stackByTier` is the per-unit render map. Searching it was the defect, both
  // times — it is right for one view and empty for the other.
  assert.doesNotMatch(
    body,
    /stackByTier/,
    "the handler resolves against a single table again",
  );
});

test("an unresolvable key is reported, not swallowed", async () => {
  // The early return is correct — there is nothing else to do — but a silent
  // one is why this shipped twice.
  const body = sliceFrom(await code(), "const onTraceStackCell = useCallback(");
  assert.match(body, /if \(tierId === null\) \{[\s\S]{0,400}?console\.warn/);
});

test("the auto-close check uses the same resolver as the open", async () => {
  // Opening against one map and closing against another would pin a panel
  // beneath a row that is no longer rendered — the failure the close exists to
  // prevent, reintroduced by the fix to the open.
  const src = await code();
  assert.match(src, /tracedTierId !== null && !traceKeysByTier\.has\(tracedTierId\)/);
});
