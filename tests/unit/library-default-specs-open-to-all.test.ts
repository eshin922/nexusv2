/**
 * Training finding #2 — library master specs rarely existed to inherit.
 *
 * The inheritance architecture was never the defect and is ACCEPTED as
 * correct: library default → copied at attachment → the quote owns its copy →
 * later library edits do not propagate retroactively. Nothing here touches it.
 *
 * The defect was authorization. `updateLeafSpec` gated both scopes on
 * `assertCanEditSpecs`, which passes on `role === "admin"` alone, and
 * `users.can_edit_specs` is false for the entire roster — so master authoring
 * was reachable by four accounts and exercised by two, while the ✎ control was
 * ungated on every library row. Measured: 188 of 199 quote-owned spec rows
 * empty, 25 spec-audit rows ever, zero written by a PM.
 *
 * Business disposition (Edward, 2026-08-27): every authenticated Nexus user may
 * author library defaults for beta. Quote scope is unchanged.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const src = () => readFileSync("src/app/actions/leaf-specs.ts", "utf8");

/** `updateLeafSpec` with comment lines stripped — a check must read code. */
function updateLeafSpecCode(): string {
  const s = src();
  const start = s.indexOf("export async function updateLeafSpec");
  assert.ok(start > 0);
  const next = s.indexOf("\nexport async function", start + 1);
  return s
    .slice(start, next === -1 ? undefined : next)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

test("library scope needs only authentication; quote scope keeps its gate", () => {
  const code = updateLeafSpecCode();
  assert.match(
    code,
    /"library" in scope \? await ensureUser\(\) : await assertCanEditSpecs\(\)/,
    "the gate must branch on scope",
  );
});

test("quote scope is unchanged in BOTH of its rules", () => {
  const code = updateLeafSpecCode();
  // The permission gate...
  assert.match(code, /assertCanEditSpecs\(\)/);
  // ...and the draft guard. A quote-scoped value is customer-visible in the
  // PDF specification addendum (OD-023), so opening master authoring must not
  // open editing of an artifact a customer may already hold.
  assert.match(code, /if \("quoteId" in scope\) await quoteByIdDraft\(scope\.quoteId\)/);
});

test("narrowing the shared guard weakens no other action", () => {
  // The caveat was "do not weaken unrelated spec actions if
  // assertCanEditSpecs is shared". It is not shared — asserted, not assumed,
  // so a future second caller makes this fail rather than pass silently.
  const tree = [
    "src/app/actions/leaf-specs.ts",
    "src/app/actions/leaves.ts",
    "src/app/actions/quotes.ts",
    "src/lib/product-structure/quote-spec-authority.ts",
  ];
  let callers = 0;
  for (const f of tree) {
    const m = readFileSync(f, "utf8").match(/assertCanEditSpecs\(\)/g);
    callers += m ? m.length : 0;
  }
  assert.equal(callers, 1, "assertCanEditSpecs must still have exactly one call site");
});

test("audit attribution survives on the library path", () => {
  const code = updateLeafSpecCode();
  // Both branches bind the same `user`, so these carry a real author for a
  // library-default edit rather than a null.
  assert.match(code, /createdBy: user\.id/);
  assert.match(code, /updatedBy: user\.id/);
  assert.match(code, /userId: user\.id/);
});

test("the library write still targets the master row shape", () => {
  const code = updateLeafSpecCode();
  // First-time library edit INSERTs quote_id NULL + is_current true. This is
  // the row `ensureQuoteSpecAuthority` looks for at attachment; if the shape
  // moved, inheritance would silently find nothing.
  assert.match(code, /"library" in scope\s*\n?\s*\?\s*\{ isCurrent: true \}/);
  assert.match(code, /:\s*\{ quoteId: scope\.quoteId \}/);
});

test("the inheritance architecture is untouched", () => {
  // Accepted as correct. The attach path copies the master's values into a
  // quote-owned row; nothing in this repair may have edited that.
  const authority = readFileSync(
    "src/lib/product-structure/quote-spec-authority.ts",
    "utf8",
  );
  assert.match(authority, /specValues: libraryDefault\?\.specValues \?\? \{\}/);
  assert.match(authority, /isNull\(leafSpecs\.quoteId\)/);
  assert.match(authority, /eq\(leafSpecs\.isCurrent, true\)/);
});
