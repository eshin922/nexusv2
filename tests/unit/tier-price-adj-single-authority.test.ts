/**
 * `quote_tiers.tier_price_adj_pct` has exactly one writer.
 *
 * It had two. Setup's tier row wrote the column through `updateTierPriceAdj`
 * on a debounce, immediately; Pricing staged the same column through
 * `planApply`. Same column, same audit action, same meaning — confirmed before
 * removal — so this was not two ways of doing one thing, it was two
 * authorities over one number.
 *
 * What differed was governance, entirely in Setup's disfavour. That path never
 * participated in the rule that clears tier overrides when the quote-wide rate
 * moves, and it sat outside both staleness guards. An operator could change a
 * committed price from Setup and never see a chip for it, and a write from
 * there could move a lever a Pricing operator had already staged against.
 *
 * The removal is a door, not a capability: the column, the audit action
 * `tier_price_adj_updated`, and every persisted value are untouched.
 *
 * These assertions exist because the cheapest way to reopen the door is for
 * someone to add "a quick inline adjust" back to a tier row without knowing
 * any of the above. A grep fails; a comment does not.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// fileURLToPath, not URL.pathname — the latter yields "/C:/..." on Windows and
// every read fails identically, which reads as "the code is gone" when it is
// only unreadable. An absence claim needs the read to have actually happened.
const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const child = path.join(dir, name);
    if ((await stat(child)).isDirectory()) await walk(child, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(child);
  }
  return out;
}

/** Source with comments stripped — the files here explain the removal. */
async function code(file: string): Promise<string> {
  const raw = await readFile(file, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");
}

const rel = (f: string) => f.slice(SRC.length).split(path.sep).join("/");

test("the Setup-side writer action no longer exists", async () => {
  const src = await code(path.join(SRC, "app/actions/costing.ts"));
  assert.doesNotMatch(src, /export async function updateTierPriceAdj/);
});

test("nothing calls the removed writer", async () => {
  for (const file of await walk(SRC)) {
    assert.doesNotMatch(
      await code(file),
      /updateTierPriceAdj/,
      `${file} still references the removed per-tier writer`,
    );
  }
});

test("every writer of the column is a known, governed one", async () => {
  // Any module setting `tierPriceAdjPct` is an authority over it, whatever it
  // is called. The store's reconcile READS server truth into `tiers`, which is
  // why the match is on an assignment.
  //
  // This list is the point of the test, and writing it down is what turned a
  // two-writer assumption into a four-writer fact. Each entry is here because
  // someone decided it should be, and a new one appearing is a decision nobody
  // has taken yet.
  const EXPECTED = [
    // The staged apply path. `applyPricingAdjustments` — previewed, planned,
    // stale-guarded. This is THE writer.
    "app/actions/pricing-lifts.ts",
    // `undoGlobalAdj` restores prior per-tier values from an audit row, and
    // `applyGlobalAdj` — which writes one tier row per tier for a quote-wide
    // decision — survives as an export with no caller. The Pricing shell
    // deliberately does not import it; see the note at its import site.
    "app/actions/pricing-apply.ts",
    // `applyClientTargetSolveTierAdj`, the reverse-solve apply. Currently
    // unreachable: no caller anywhere. It belongs to Client Target, which is
    // HELD, so it is left exactly as it is rather than removed by a slice that
    // was not asked to decide Client Target's shape.
    "app/actions/costing.ts",
  ];
  const writers: string[] = [];
  for (const file of await walk(SRC)) {
    const src = await code(file);
    if (/\.set\(\{[\s\S]{0,200}?tierPriceAdjPct/.test(src)) writers.push(rel(file));
  }
  assert.deepEqual(
    writers.sort(),
    [...EXPECTED].sort(),
    "the set of modules writing tier_price_adj_pct changed",
  );
});

test("Setup is not among them", async () => {
  // The specific removal: Setup's tier row wrote this column immediately, on a
  // debounce, outside the plan and outside both staleness guards.
  for (const file of await walk(SRC)) {
    if (!rel(file).startsWith("app/projects/")) continue;
    assert.doesNotMatch(
      await code(file),
      /tierPriceAdjPct/,
      `${rel(file)} — a Setup-side surface references the pricing authority`,
    );
  }
});

test("the Setup tier row authors label and quantity only", async () => {
  const src = await code(
    path.join(SRC, "app/projects/[id]/quotes/[quoteId]/tier-row.tsx"),
  );
  assert.doesNotMatch(src, /priceAdj/i);
  // The row is still a writer — of the things Setup legitimately owns: what a
  // tier is CALLED and how many units it is. Both are structure. If this ever
  // fails, the row has lost a capability it was supposed to keep, which is a
  // different mistake from the one above and worth telling apart.
  assert.match(src, /updateTier\b/);
  // The recommendation left too, for a different reason: not a second
  // authority, but a decision that was being made two surfaces away from the
  // three figures that depend on it. See recommended-tier-authority.
  assert.doesNotMatch(src, /setTierRecommended/);
});
