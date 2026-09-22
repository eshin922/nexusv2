/**
 * Aisha's report — cannot add or edit Library SKUs.
 *
 * ── WHAT ACTUALLY FAILED, OF THE THREE CANDIDATES ────────────────────────
 *
 *   opening Edit product   worked. The pencil was ungated.
 *   typing a missing SKU   worked. The no-SKU branch renders a live input.
 *   SAVING                 refused. `updateLeaf` gated on
 *                          `assertCanCreateLeaves`, and that reads
 *                          `users.can_create_leaves`, which NO SURFACE SETS.
 *
 * So the guard resolved in practice to "admins only", and the refusal arrived
 * at the end of the work rather than before it.
 *
 * Separately on the add side: the "+ Create new product" CTA in the
 * FILTERED-TO-ZERO state was still `disabled={!canCreateLeaves}` — the one
 * creation control the 2026-08-27 repair missed, at the end of the commonest
 * path to creating something (search, find nothing, create it).
 *
 * ── WHY THE EXISTING TEST DID NOT CATCH THAT ─────────────────────────────
 *
 * `library-create-open-to-all.test.ts` asserted the empty-state CTA was
 * ungated using `indexOf("+ Create new product →")` — the FIRST occurrence.
 * Two controls carry that exact label. It measured one and reported on both.
 * It also checked the refusal copy with a plain apostrophe against source that
 * renders `&apos;`. Four green assertions over a live defect.
 *
 * These tests count occurrences rather than finding one.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  canEditLibraryProduct,
  type LibraryProductActor,
} from "../../src/lib/permissions/library-product.ts";

const actor = (role: string, grant = false): LibraryProductActor => ({
  role,
  canCreateLeaves: grant,
});

const modal = () =>
  readFileSync("src/components/library/library-browse-modal.tsx", "utf8");
const leaves = () => readFileSync("src/app/actions/leaves.ts", "utf8");
const guard = () => readFileSync("src/lib/spec-permission-guard.ts", "utf8");

function body(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  assert.ok(start > 0, `${name} must exist`);
  const next = src.indexOf("\nexport async function", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

/** Comment lines removed — prose ABOUT a call is not a call. */
function code(text: string): string {
  return text
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/**
 * The same, for JSX: block comments removed entirely, then whole-line `//`.
 *
 * Needed because three of the six "+ Create new product" occurrences in the
 * modal are PROSE — one inside a `/* *\/` block whose continuation lines start
 * with `+`, so the line filter above cannot see them. Counting controls while
 * counting sentences about controls is the same class of error as the test
 * this replaces.
 */
function jsx(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

// ── the reproduction ─────────────────────────────────────────────────────

test("a PM with no grant could not pass the OLD rule, and passes the new one", () => {
  // This is Aisha's row shape exactly: role `pm`, can_create_leaves false.
  const aisha = actor("pm", false);

  // The old rule, written out, is what `assertCanCreateLeaves` still applies:
  // admin passes on role, everyone else needs the column.
  const oldRule = (u: LibraryProductActor) =>
    u.role === "admin" || u.canCreateLeaves === true;

  assert.equal(oldRule(aisha), false, "the reported failure must reproduce");
  assert.equal(canEditLibraryProduct(aisha), true, "and the fix must admit her");
});

test("the fix does not broadly grant admin access", () => {
  // Everything an admin can do stays an admin thing; only product editing moved.
  for (const role of ["accounting", "logistics", "sales", "purchasing", "production", "read_only"]) {
    assert.equal(
      canEditLibraryProduct(actor(role)),
      false,
      `${role} must NOT gain product editing`,
    );
  }
  assert.equal(canEditLibraryProduct(actor("admin")), true);
  assert.equal(canEditLibraryProduct(actor("pm")), true);
});

test("an explicit grant is still honoured, whatever the role", () => {
  // One row on the roster carries the column. It must not regress to refused.
  assert.equal(canEditLibraryProduct(actor("logistics", true)), true);
  assert.equal(canEditLibraryProduct(actor("read_only", true)), true);
});

// ── the two layers must agree ────────────────────────────────────────────

test("the server guard and the UI read the SAME predicate", () => {
  assert.match(
    guard(),
    /canEditLibraryProduct\(user\)/,
    "the action guard must call the shared predicate, not re-implement it",
  );
  const page = readFileSync(
    "src/app/projects/[id]/quotes/[quoteId]/page.tsx",
    "utf8",
  );
  assert.match(
    page,
    /canEditProduct:\s*canEditLibraryProduct\(user\)/,
    "the UI's capability must come from the same function",
  );
  // And the predicate must stay client-safe, or the UI cannot import it.
  // Checked for the IMPORT, not the string: the file's own commentary explains
  // why it is free of `server-only`, and a substring check cannot tell the
  // explanation from the thing it forbids.
  const pred = readFileSync("src/lib/permissions/library-product.ts", "utf8");
  assert.ok(
    !/^\s*import\s+["']server-only["']/m.test(pred),
    "the shared predicate must not import server-only",
  );
  assert.ok(
    !/^\s*import\b[^\n]*\bfrom\s+["']@\/(db|lib\/auth)\b/m.test(pred),
    "the shared predicate must not reach the database or the session",
  );
});

test("editing uses the new guard; creation, restore and pull are untouched", () => {
  const src = leaves();
  for (const fn of ["updateLeaf", "retryLeafEdit"]) {
    const b = code(body(src, fn));
    assert.match(b, /assertCanEditLibraryProduct\(\)/, `${fn} must use the edit guard`);
    assert.ok(
      !/assertCanCreateLeaves\(/.test(b),
      `${fn} must not still gate on the creation grant`,
    );
  }
  // The 2026-08-27 disposition and the two deliberate holdouts survive intact.
  assert.ok(
    !/assertCanCreateLeaves\(/.test(code(body(src, "createLeaf"))),
    "creation stays open to every authenticated user",
  );
  assert.match(
    body(src, "restoreLeaf"),
    /assertCanCreateLeaves/,
    "un-archiving keeps the old gate",
  );
  assert.match(
    readFileSync("src/app/actions/hubspot-pull.ts", "utf8"),
    /assertCanCreateLeaves/,
    "the catalog pull keeps the old gate",
  );
});

// ── the add-side defect, measured by COUNT ───────────────────────────────

test("every '+ Create new product' control is ungated — all of them", () => {
  const m = jsx(modal());
  let found = 0;
  for (const hit of m.matchAll(/\+ Create new product\b/g)) {
    found++;
    // The button element containing this label: walk back to its `<button`.
    const open = m.lastIndexOf("<button", hit.index);
    assert.ok(open >= 0, "label must sit inside a button");
    const el = m.slice(open, hit.index);
    assert.ok(
      !/disabled=\{[^}]*canCreateLeaves/.test(el),
      `creation control at index ${hit.index} is still gated on the creation grant`,
    );
  }
  // The previous test found ONE and believed it had covered the surface. If a
  // fourth creation control ever lands this floor forces it to be counted too.
  assert.equal(found, 3, `expected exactly 3 creation controls, saw ${found}`);
});

test("no refusal copy claims the operator cannot create products", () => {
  // Checked against the RENDERED apostrophe too. The old assertion used a
  // plain ' against source that writes &apos;, so it could not have matched.
  const m = modal();
  for (const needle of [
    "permission to create new\n",
    "permission to create new products",
    "permission to create new\r\n",
  ]) {
    assert.ok(!m.includes(needle), `stale refusal copy present: ${JSON.stringify(needle)}`);
  }
  assert.ok(
    !/don&apos;t have permission to create/.test(m.replace(/\s+/g, " ")),
    "stale refusal copy present in entity form",
  );
});

test("Refresh and Restore deliberately still read the creation grant", () => {
  // The repair must not have swept these along. Refresh pulls the HubSpot
  // catalog and Restore un-archives; neither is a product edit.
  const m = modal();
  assert.match(m, /permission to refresh the library catalog/);
  assert.match(m, /permission to restore library items/);
});

// ── what the fix must NOT have relaxed ───────────────────────────────────

test("established-SKU replacement requires explicit correction confirmation and retains uniqueness checks", () => {
  const src = leaves();
  assert.match(
    src,
    /hadSku && skuChanged && !values\.allowEstablishedSkuChange/,
    "the established-SKU guard must require explicit correction confirmation",
  );
  assert.match(src, /SKU is already established as/, "and explain the controlled correction");
  const idx = src.indexOf("if (values.sku !== null && skuChanged)");
  assert.ok(idx > 0, "unchanged legacy duplicate SKUs must not block unrelated edits");
  const around = src.slice(idx, idx + 1800);
  assert.match(around, /upper\(btrim\(\$\{leaves\.sku\}\)\)/, "corrected SKUs retain catalog uniqueness checks");
  assert.match(around, /claimedElsewhere/, "open edits retain their exclusive SKU claim");
  assert.ok(
    !/role|canEdit|admin/.test(around),
    "the correction confirmation is separate from role checks",
  );
});

test("auto-generation is untouched and still gated on its own three conditions", () => {
  const alloc = readFileSync("src/lib/sku/allocation.ts", "utf8");
  assert.match(alloc, /SKU_GENERATION_ENABLED/, "the flag gate survives");
  assert.match(alloc, /status.*approved|approved.*status/s, "the approved-brand gate survives");
  assert.match(alloc, /nextNumber/, "the seeded-counter gate survives");
  // And nothing on the generation path learned about this repair.
  assert.ok(
    !/canEditLibraryProduct/.test(alloc),
    "generation must not consult the edit permission",
  );
});
