/**
 * Which node answers for a cell's quoted price is the ENGINE's answer.
 *
 * The cell drawer's Show calculation needs the graph key of the node behind
 * "Final quoted sell". It was built in the shell as `{sku}/{tier}/quoted`, and
 * that node exists ONLY when the cell carries an override — without one the
 * root is the computed chain, whose own key depends on whether a lift applied.
 * So on an ordinary cell the trace resolved nothing.
 *
 * It failed loudly, which is the one good part: single-reachability refused
 * rather than showing a chain that might belong to a different figure. The
 * cheap fix would have been to reproduce the precedence — override, else lift,
 * else sell — in the drawer. That is a second copy of a rule the engine owns,
 * correct until the rules move and silently wrong after.
 *
 * So the engine reports the key of the node it already chose and pushed, and
 * every layer forwards it. These tests hold that chain: reported at the
 * source, carried through the classifier, and consumed rather than rebuilt.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

test("the engine reports the key of the cell root it chose", async () => {
  const src = await code("lib/costing.ts");
  // The root is picked once, by name, and the reported key is that same node's
  // — not a re-derivation that happens to agree today.
  assert.match(src, /sellNodeKey: cellRootNode\.key/);
});

test("a fold reports no key rather than one of its children's", async () => {
  const src = await code("lib/costing.ts");
  // An assembly rollup is not a cell. Borrowing a child's key would open a
  // trace on one product's price under a heading naming the assembly.
  const nulls = src.match(/sellNodeKey: null/g) ?? [];
  assert.equal(nulls.length, 2, "the empty and the folded rollup both say null");
});

test("the classifier forwards the key and never builds one", async () => {
  const src = await code("lib/pricing-classifier.ts");
  assert.match(src, /sell_node_key: cellRaw\.sell_node_key \?\? null/);
  // No construction anywhere in the classifier.
  assert.doesNotMatch(src, /\/quoted`|\/sell`|nodeKey\(/);
});

test("the surface consumes the key and does not reconstruct it", async () => {
  const shell = await code("components/pricing-surface/pricing-surface-shell.tsx");
  assert.match(shell, /quotedNodeKey: cell\.sell_node_key/);
  // The shape that was wrong. Any template ending in a node-name segment is a
  // display layer deciding identity.
  assert.doesNotMatch(
    shell,
    /`\$\{[^`]*\}\/(quoted|sell|lift)`/,
    "a node key is being assembled from parts on the surface",
  );
});

test("the drawer renders nothing rather than tracing a null key", async () => {
  // Null is a real answer — a fold, or a cell with no price. Falling back to
  // any key at all would put a chain under a figure it does not explain.
  const src = await code("components/pricing-surface/cell-drawer.tsx");
  assert.match(src, /nodeKey === null \|\| graph === null/);
});
