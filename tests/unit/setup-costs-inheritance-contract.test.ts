import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ============================================================================
// Setup → Costs inheritance — regression contract (Gate 4b)
// ============================================================================
//
// Governing business rule: **Setup owns product structure; Costs inherits it
// automatically.** An operator enters cost values against structure Setup
// established; they never re-declare a component from the Costs surface.
//
// This contract is structural rather than behavioural because the defect it
// protects against was an *absence* — no materialisation path existed at all,
// so no behavioural test could fail. A test that exercises cost entry passes
// happily against a surface that inherited nothing. What has to be asserted is
// that each structure-creating action also creates the cost rows that
// structure owes, and that the surface never offers to recreate Setup.

const assembliesSrc = await readFile(
  new URL("../../src/app/actions/assemblies.ts", import.meta.url),
  "utf8",
);
const quotesSrc = await readFile(
  new URL("../../src/app/actions/quotes.ts", import.meta.url),
  "utf8",
);
const packagingSrc = await readFile(
  new URL("../../src/components/costs/packaging-drilldown.tsx", import.meta.url),
  "utf8",
);
const backfillSrc = await readFile(
  new URL("../../scripts/backfill/setup-costs-inheritance.ts", import.meta.url),
  "utf8",
);
const standardSrc = await readFile(
  new URL("../../docs/NEXUS_IMPLEMENTATION_STANDARD.md", import.meta.url),
  "utf8",
);

/** Extract one exported action body so assertions cannot match a neighbour. */
function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `action ${name} not found`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("leaf attach materialises a Packaging row for every existing tier", () => {
  const body = actionBody(assembliesSrc, "attachAssemblyLeaf");
  assert.match(
    body,
    /materializePackagingForLeaf\(/,
    "attachAssemblyLeaf must materialise inherited packaging rows",
  );
  // Must run inside the same transaction as the structure write — a leaf
  // committed without its rows is precisely the defect being corrected.
  const txIndex = body.indexOf("db.transaction");
  const materializeIndex = body.indexOf("materializePackagingForLeaf(");
  assert.ok(
    txIndex >= 0 && materializeIndex > txIndex,
    "materialisation must occur inside the attach transaction",
  );
});

test("assembly create materialises a Production row for every existing tier", () => {
  const body = actionBody(assembliesSrc, "createAssembly");
  assert.match(body, /materializeProductionForAssembly\(/);
  const txIndex = body.indexOf("db.transaction");
  const materializeIndex = body.indexOf("materializeProductionForAssembly(");
  assert.ok(
    txIndex >= 0 && materializeIndex > txIndex,
    "materialisation must occur inside the create transaction",
  );
});

test("materialised rows leave cost fields unset, not zero", () => {
  // NULL means "structure exists, awaiting a cost". Zero would be a priced
  // line and would silently understate a quote.
  for (const fn of ["materializePackagingForLeaf", "materializeProductionForAssembly"]) {
    const start = assembliesSrc.indexOf(`async function ${fn}`);
    assert.ok(start >= 0, `${fn} not found`);
    const body = assembliesSrc.slice(start, start + 1600);
    assert.ok(
      !/unitCost:\s*"?0/.test(body) && !/purchaseQty:\s*0/.test(body),
      `${fn} must not seed zero costs`,
    );
  }
});

test("adding a tier covers every attached leaf, not only leaves that already have a line", () => {
  const body = actionBody(quotesSrc, "addTier");
  // The pre-existing fan-out only reaches leaves that already carry a line.
  // Without a second pass over all attached leaves, a leaf attached in Setup
  // but never priced would be skipped — reintroducing the defect per tier.
  assert.match(
    body,
    /coveredLeafIds/,
    "addTier must track which leaves the fan-out already covered",
  );
  assert.match(
    body,
    /from\(assemblyLeaves\)/,
    "addTier must enumerate all attached leaves for the new tier",
  );
});

test("Packaging empty state does not offer to recreate Setup structure", () => {
  const start = packagingSrc.indexOf("if (lines.length === 0)");
  assert.ok(start >= 0, "packaging empty state not found");
  const body = packagingSrc.slice(start, start + 900);
  assert.ok(
    !/PackagingAddLineActions/.test(body),
    "empty state must not render the per-leaf Add-line wall",
  );
  assert.match(
    body,
    /inherited/i,
    "empty state should explain that lines are inherited from Setup",
  );
});

test("backfill is draft-only, additive, and idempotent", () => {
  assert.match(
    backfillSrc,
    /status = 'draft'/,
    "backfill must select only draft quotes (assertDraft mutability contract)",
  );
  assert.match(
    backfillSrc,
    /not exists/i,
    "backfill must guard inserts so re-running is a no-op",
  );
  assert.ok(
    !/\bupdate\s+assembly_leaf_inputs|\bdelete\s+from\s+assembly_leaf_inputs/i.test(
      backfillSrc,
    ),
    "backfill must never update or delete an existing cost row",
  );
});

test("overlapping materialisation paths cannot double-insert a row", () => {
  // Four paths can reach the same (leaf, tier): attach, tier-add, preset, and
  // backfill. Each needs its own guard, because they run independently and in
  // any order — a leaf attached, then a tier added, then a backfill run must
  // still yield exactly one inherited row.
  const addTier = actionBody(quotesSrc, "addTier");
  assert.match(
    addTier,
    /if \(coveredLeafIds\.has\(leaf\.id\)\) continue/,
    "tier-add must skip leaves the line fan-out already covered",
  );
  assert.match(
    backfillSrc,
    /not exists \(\s*select 1 from assembly_leaf_inputs/i,
    "backfill must skip (leaf, tier) pairs that already have a row",
  );
  assert.match(
    backfillSrc,
    /not exists \(\s*select 1 from assembly_production_inputs/i,
    "backfill must skip (assembly, tier) pairs that already have a row",
  );
  // Attach materialises only for the leaf it just created, so it cannot
  // collide with a pre-existing row by construction — but it must run after
  // the duplicate-attach rejection, not before.
  const attach = actionBody(assembliesSrc, "attachAssemblyLeaf");
  assert.ok(
    attach.indexOf("already attached to this assembly") <
      attach.indexOf("materializePackagingForLeaf("),
    "duplicate-attach rejection must precede materialisation",
  );
});

test("Setup structure is visible in Costs without any manually added cost line", () => {
  // The business contract: an operator never adds a line to make Setup
  // structure appear. Visibility must follow from materialisation alone, so
  // neither materialiser may depend on a pre-existing line.
  for (const fn of ["materializePackagingForLeaf", "materializeProductionForAssembly"]) {
    const start = assembliesSrc.indexOf(`async function ${fn}`);
    const body = assembliesSrc.slice(start, start + 1600);
    assert.ok(
      !/assemblyLeafInputs\)?\s*\.?\s*where|existingLines/.test(body),
      `${fn} must not condition materialisation on an existing line`,
    );
    assert.match(
      body,
      /from\(quoteTiers\)/,
      `${fn} must fan out across every existing tier`,
    );
  }
});

test("Gate 4b Structural Inheritance is recorded in the implementation standard", () => {
  assert.match(standardSrc, /Structural Inheritance/);
  assert.match(
    standardSrc,
    /Which upstream surface owns the structure this surface operates on/,
  );
});
