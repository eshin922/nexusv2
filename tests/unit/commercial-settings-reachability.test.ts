import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/app/actions/costing.ts", "utf8");

function action(name: string, nextName: string): string {
  return source.slice(
    source.indexOf(`export async function ${name}`),
    source.indexOf(`export async function ${nextName}`),
  );
}

test("every production costing route uses the lifecycle-aware commercial resolver", () => {
  // The legacy read's LOADER, which is where the resolver call lives.
  // `getQuoteCosting` was split into `loadQuoteCostingInput` + the engine call
  // so the recovery workspace can run a counterfactual on the same input; the
  // slice follows the load rather than the name, because the load is what has
  // to reach the resolver.
  const legacyRead = action("loadQuoteCostingInput", "getQuoteCosting");
  const draftSolve = action("applyClientTargetSolveTierAdj", "getCostingBundle");
  const bundle = source.slice(source.indexOf("export async function getCostingBundle"));

  for (const [name, route] of [
    ["legacy read", legacyRead],
    ["draft solve", draftSolve],
    ["canonical bundle", bundle],
  ] as const) {
    assert.match(route, /resolveQuoteCommercialSettings\(quoteId\)/, `${name} bypasses resolver`);
    assert.doesNotMatch(route, /\.from\(markupDefaults\)/, `${name} reads live markup directly`);
    assert.doesNotMatch(route, /\.from\(firmSettings\)/, `${name} reads live thresholds directly`);
  }

  // And the split cannot be how a route escapes the check: the public entry
  // must go through the loader that was just verified, not load its own way.
  const publicEntry = action("getQuoteCosting", "updateQuoteGlobalPriceAdj");
  assert.match(
    publicEntry,
    /loadQuoteCostingInput\(quoteId\)/,
    "getQuoteCosting no longer delegates to the verified loader",
  );
  assert.doesNotMatch(
    publicEntry,
    /resolveQuoteCommercialSettings|buildQuoteCostingInputFromNewModel/,
    "getQuoteCosting loads independently of the loader the check verified",
  );
});
