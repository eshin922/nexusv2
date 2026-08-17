/**
 * The recommended tier is chosen on Pricing.
 *
 * It was a star on the Setup tier row. Unlike the per-tier price adjustment,
 * this was never a duplicate — Pricing had no writer at all, only a reading
 * that said "None chosen · set one to price the order" and sent the operator
 * nowhere. So this is a MOVE, and the persisted semantics do not change: same
 * action, same one-per-quote invariant enforced in the same place, same
 * `recommended_updated` audit row.
 *
 * ── WHY THE SURFACE MATTERS FOR THIS ONE ──────────────────────────────────
 *
 * Three figures depend on the recommendation and none of them is on Setup:
 * order value, blended margin, and the sentence the customer PDF prints. The
 * decision was being made two surfaces away from everything that would tell
 * the operator whether it was the right one.
 *
 * ── WHY IT IS NOT STAGED ──────────────────────────────────────────────────
 *
 * A distinction, not an omission. The staged set holds the four levers that
 * move a PRICE, and Apply commits a price change. A recommendation moves no
 * number in the build — it selects which tier the quote is read and ordered
 * at. There is nothing to preview, because nothing computes differently; the
 * figures beside it simply become answerable.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const child = path.join(dir, name);
    if ((await stat(child)).isDirectory()) await walk(child, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(child);
  }
  return out;
}

async function code(file: string): Promise<string> {
  const raw = await readFile(file, "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const rel = (f: string) => f.slice(SRC.length).split(path.sep).join("/");

test("exactly one surface calls the writer, and it is Pricing", async () => {
  const callers: string[] = [];
  for (const file of await walk(SRC)) {
    if (rel(file) === "app/actions/quotes.ts") continue;
    if (/setTierRecommended\s*\(/.test(await code(file))) callers.push(rel(file));
  }
  assert.deepEqual(callers, [
    "components/pricing-surface/pricing-surface-shell.tsx",
  ]);
});

test("no Setup-side surface writes the recommendation", async () => {
  for (const file of await walk(SRC)) {
    if (!rel(file).startsWith("app/projects/")) continue;
    assert.doesNotMatch(
      await code(file),
      /setTierRecommended/,
      `${rel(file)} still decides the recommendation`,
    );
  }
});

test("nothing infers a recommendation from a tier's POSITION", async () => {
  // The durable one, and the reason this test exists at all.
  //
  // Two surfaces invented a recommendation for a quote that had none. The
  // customer PDF defaulted to index 0 (`recommendedTierIdx ?? 0`), removed in
  // Item 1. Mark-Accepted defaulted to the MIDDLE tier —
  // `Math.floor(tierData.length / 2)` — "so Mark-Accepted always surfaces a
  // recommendation", which it did; it just was not the firm's. Its comment
  // told the reader to override via a Setup star that no longer exists.
  //
  // Position is not a recommendation. A quote with none has none, and every
  // consumer already renders that state.
  for (const file of await walk(SRC)) {
    const src = await code(file);
    if (!/recommend/i.test(src)) continue;
    assert.doesNotMatch(
      src,
      /recommend[\s\S]{0,300}?Math\.floor\([^)]*length/i,
      `${rel(file)} picks a recommendation by position`,
    );
    assert.doesNotMatch(
      src,
      /recommendedTier(Idx|Id)?\s*\?\?\s*0/,
      `${rel(file)} falls back to the first tier`,
    );
  }
});

test("Setup still SHOWS it — the move is the decision, not the fact", async () => {
  // A quote's recommended tier is a fact about the quote and belongs on a page
  // listing its tiers. Removing the star along with the writer would have made
  // Setup silently disagree with Pricing about what the quote says.
  const row = await code(
    path.join(SRC, "app/projects/[id]/quotes/[quoteId]/tier-row.tsx"),
  );
  assert.match(row, /tier\.recommended &&/);
  assert.match(row, /★ recommended/);
  // And it is no longer pressable.
  assert.doesNotMatch(row, /className="rec rec-clickable"/);
  assert.doesNotMatch(row, /rec-set/);
});

test("the persisted semantics are untouched", async () => {
  const action = await code(path.join(SRC, "app/actions/quotes.ts"));
  const start = action.indexOf("export async function setTierRecommended");
  assert.notEqual(start, -1, "the action must survive the move");
  const body = action.slice(start, action.indexOf("\nexport ", start + 1));
  // One per quote, enforced where it always was — in the action, not in the
  // control that happens to be calling it this month.
  assert.match(body, /eq\(quoteTiers\.recommended, true\)/);
  assert.match(body, /action: "recommended_updated"/);
  assert.match(body, /assertDraft\(quote\)/);
});

test("the Pricing control is draft-gated and scoped to its own pending state", async () => {
  const shell = await code(
    path.join(SRC, "components/pricing-surface/pricing-surface-shell.tsx"),
  );
  // Pattern 47(f): its own transition, so a recommendation in flight cannot
  // disable an unrelated control.
  assert.match(shell, /const \[recPending, startRecommend\] = useTransition\(\)/);
  assert.match(shell, /committable \? onSetRecommended : undefined/);
  // A refusal is shown where the act was made.
  assert.match(shell, /if \(!r\.ok\) setRecError\(r\.error\.message\)/);
});

test("the control translates identity through idMap, never by parsing", async () => {
  // The card reports a NUMERIC tier id and the action takes a UUID. The list
  // handed to the card carries both, resolved where the correspondence is
  // owned — a recommendation printed against the wrong tier is the cost of
  // getting this wrong.
  const shell = await code(
    path.join(SRC, "components/pricing-surface/pricing-surface-shell.tsx"),
  );
  assert.match(shell, /numericId: numeric, uuid: t\.id, label: t\.label/);
  const card = await code(
    path.join(SRC, "components/pricing-surface/action-zone.tsx"),
  );
  assert.doesNotMatch(card, /uuidToNumeric|numericToUuid/);
});
