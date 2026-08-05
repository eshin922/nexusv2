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
  const legacyRead = action("getQuoteCosting", "updateQuoteGlobalPriceAdj");
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
});
