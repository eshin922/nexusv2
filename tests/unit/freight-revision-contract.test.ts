/**
 * F-3 — causal revision contract on every Freight mutation path.
 *
 * The reconciliation pipe cannot distinguish a fresh snapshot from a stale one
 * by timing. A slow read racing a fast second edit, or two operators on one
 * quote, can deliver an OLDER snapshot after a newer write; without a marker
 * minted after the write commits, the client has no basis to reject it.
 *
 * The gap this locks down was real and quiet: ten of eleven Freight mutations
 * returned no revision, and the three exercised during certification
 * (customsBreak, addDestination, createShipment) all logged `rev=?` while
 * converging correctly anyway — by timing, not by contract. Nothing failed, so
 * nothing surfaced it.
 *
 * These tests assert the contract structurally rather than waiting for a race
 * to be observed, because the race is exactly what a test cannot reliably
 * reproduce.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../src/app/actions/freight-worksheet.ts", import.meta.url),
  "utf8",
);

/** Source with comment lines removed, so prose is never mistaken for a call. */
const code = source
  .split(/\r?\n/)
  .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
  .join("\n");

test("every exported Freight mutation declares a revision in its result type", () => {
  const signatures = [
    ...source.matchAll(
      /export async function (\w+)\(fd: FormData\): (Promise<[^{]*\{[^}]*\}[^>]*>)/g,
    ),
  ];
  assert.ok(signatures.length >= 11, `expected >= 11 actions, found ${signatures.length}`);

  const missing = signatures
    .filter(([, , returnType]) => !returnType.includes("revision: string | null"))
    .map(([, name]) => name);

  assert.deepEqual(
    missing,
    [],
    `these Freight mutations omit the revision contract: ${missing.join(", ")}`,
  );
});

test("the revision is minted by a single shared helper, not re-derived per action", () => {
  // Per-action copies drift. One helper means one definition of "committed".
  const helperDefs = source.match(/async function committedRevision\(/g) ?? [];
  assert.equal(helperDefs.length, 1);

  // Only the helper may reach for the snapshot primitive directly.
  const rawUses = code.match(/pg_snapshot_xmax/g) ?? [];
  assert.equal(
    rawUses.length,
    1,
    "pg_snapshot_xmax should appear once in code, inside committedRevision()",
  );
});

test("every action that revalidates also mints a revision", () => {
  // revalidateQuoteTree marks the point where the write becomes visible to
  // readers. A path that reaches it without a revision is a path whose
  // ordering cannot be checked.
  const revalidations = code.match(/revalidateQuoteTree\(/g) ?? [];
  const mints = code.match(/const revision = await committedRevision\(\);/g) ?? [];
  assert.equal(
    mints.length,
    revalidations.length,
    `${revalidations.length} revalidation points but ${mints.length} revision reads`,
  );
});

test("the revision is read after the write, never inside the transaction", () => {
  // Read inside the transaction it describes, the marker would report a
  // snapshot the write is not yet part of — worse than no marker, because it
  // would look authoritative.
  assert.doesNotMatch(
    code,
    /tx\s*\.\s*execute\([^)]*pg_snapshot_xmax/,
    "revision must not be read from inside a transaction",
  );
  // And it must precede revalidation, so the value handed back describes state
  // readers can actually observe.
  for (const block of source.split("export async function").slice(1)) {
    const mint = block.indexOf("const revision = await committedRevision();");
    const reval = block.indexOf("revalidateQuoteTree(");
    if (mint === -1 || reval === -1) continue;
    assert.ok(mint < reval, "revision must be minted before revalidateQuoteTree");
  }
});

test("no Freight action was left out of the sweep", () => {
  // Guards against a new mutation landing without the contract: if an exported
  // action appears that never mints a revision, this fails rather than silently
  // reopening the gap.
  const actions = [...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  const withoutRevision = actions.filter((name) => {
    const start = source.indexOf(`export async function ${name}(`);
    const next = source.indexOf("export async function ", start + 1);
    const body = source.slice(start, next === -1 ? undefined : next);
    // Read-only helpers legitimately have no revision; mutations revalidate.
    if (!body.includes("revalidateQuoteTree(")) return false;
    return !body.includes("committedRevision()");
  });
  assert.deepEqual(withoutRevision, []);
});
