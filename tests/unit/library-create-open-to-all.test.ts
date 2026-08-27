/**
 * Training finding #1 — "+ Create new product" was unavailable.
 *
 * It was never an intentional restriction. The two layers applied DIFFERENT
 * rules for the same question:
 *
 *   server   assertCanCreateLeaves  →  role === "admin" passes through
 *   UI       disabled={!permissions.canCreateLeaves}  →  the raw column
 *
 * and `can_create_leaves` is false for every admin on the roster bar one. So
 * an authorized operator was disabled in the UI, and the tooltip told an admin
 * to "ask an admin".
 *
 * Business disposition (Edward, 2026-08-27): every authenticated Nexus user may
 * create a library item for beta. So neither layer consults the grant for
 * creation any more, and they cannot disagree.
 *
 * These assert the SHAPE, not a permission model — there is no new check to
 * test, which is the point.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const modal = () =>
  readFileSync("src/components/library/library-browse-modal.tsx", "utf8");
const leaves = () => readFileSync("src/app/actions/leaves.ts", "utf8");

function createLeafBody(): string {
  const src = leaves();
  const start = src.indexOf("export async function createLeaf");
  assert.ok(start > 0, "createLeaf must exist");
  const next = src.indexOf("\nexport async function", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

/**
 * The body with comment lines removed.
 *
 * The first version of these tests matched raw text and failed on the repair's
 * own explanatory comment, which NAMES `assertCanCreateLeaves` while explaining
 * why creation no longer calls it. A check that cannot tell a call from prose
 * about a call is measuring the wrong thing.
 */
function createLeafCode(): string {
  return createLeafBody()
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

test("creation no longer consults the grant, on either layer", () => {
  assert.ok(
    !/await\s+assertCanCreateLeaves\(/.test(createLeafCode()),
    "createLeaf must not gate on the grant",
  );
  assert.match(createLeafCode(), /await ensureUser\(\)/, "authenticated, nothing more");

  // Neither creation control carries a disabled expression any more.
  const m = modal();
  const headerBtn = m.slice(m.indexOf("+ Create new product\n") - 900, m.indexOf("+ Create new product\n"));
  assert.ok(
    !/disabled=\{[^}]*canCreateLeaves/.test(headerBtn),
    "the header create button must not be gated",
  );
  const emptyIdx = m.indexOf("+ Create new product →");
  const emptyBtn = m.slice(emptyIdx - 600, emptyIdx);
  assert.ok(
    !/disabled=\{[^}]*canCreateLeaves/.test(emptyBtn),
    "the empty-state create CTA must not be gated",
  );

  // And the sentence that told an admin to ask an admin is gone.
  assert.ok(
    !m.includes("You don't have permission to create new products"),
    "the misleading refusal copy must be gone",
  );
});

test("no new permission system was introduced", () => {
  // The repair REMOVES a check. If any of these appear on the creation path,
  // the repair overshot its disposition.
  const code = createLeafCode();
  for (const forbidden of [/role === "admin"/, /assertCanCreateLeaves\(/, /canCreateLeaves/]) {
    assert.ok(!forbidden.test(code), `createLeaf must not reintroduce ${forbidden}`);
  }
});

test("restore and catalog refresh are deliberately UNCHANGED", () => {
  // The disposition covers creation only. `restoreLeaf` un-archives a library
  // item and `pullProductsBatch` pulls the HubSpot catalog; neither is
  // creation, so widening the shared guard would have carried both along.
  const src = leaves();
  const restore = src.slice(src.indexOf("export async function restoreLeaf"));
  assert.ok(
    restore.includes("assertCanCreateLeaves"),
    "restoreLeaf keeps its gate",
  );

  const pull = readFileSync("src/app/actions/hubspot-pull.ts", "utf8");
  assert.ok(pull.includes("assertCanCreateLeaves"), "the catalog pull keeps its gate");

  // The Refresh control in the modal likewise still reads the flag.
  assert.match(modal(), /permission to refresh the library catalog/);
});

test("creation's own validation and HubSpot semantics survive", () => {
  // The disposition changes WHO may initiate creation, nothing else.
  assert.match(createLeafCode(), /if \(!name\)/, "name is still required");
  assert.match(createLeafCode(), /ERR\.VALIDATION/, "and still refused as a validation error");
  assert.match(createLeafBody(), /HubSpot-first/, "HubSpot-first write-back still governs");
});
