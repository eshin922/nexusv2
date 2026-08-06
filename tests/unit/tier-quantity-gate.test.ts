import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  describeInvalidTierQuantities,
  findInvalidTierQuantities,
  setupTierEditorHref,
  tierQuantitiesResolved,
} from "../../src/lib/tier-quantity-gate.ts";

// ============================================================================
// Setup → Costs waterfall — tier-quantity gate
// ============================================================================
//
// Business rule: a tier may exist with its quantity unset while Setup is being
// built, but the quote may not proceed into EDITABLE Costs until every active
// tier carries a valid positive quantity.

const costsPage = await readFile(
  new URL(
    "../../src/app/projects/[id]/quotes/[quoteId]/costs/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const costStack = await readFile(
  new URL("../../src/components/costs/cost-stack-header.tsx", import.meta.url),
  "utf8",
);
const quotesActions = await readFile(
  new URL("../../src/app/actions/quotes.ts", import.meta.url),
  "utf8",
);
const gate = await readFile(
  new URL("../../src/lib/tier-quantity-gate.ts", import.meta.url),
  "utf8",
);

test("a blank tier can still be created and edited within Setup", () => {
  // addTier deliberately creates with qty: null — the create-then-fill
  // authoring flow must survive this gate. Requiring a quantity at creation
  // would break Setup and retroactively invalidate already-sent quotes.
  assert.match(
    quotesActions,
    /label: `Tier \$\{sortOrder \+ 1\}`,\s*\n\s*qty: null,/,
    "addTier must keep creating tiers with an unset quantity",
  );
  // The gate itself must not be applied at the creation seam.
  assert.ok(
    !/findInvalidTierQuantities|tierQuantitiesResolved/.test(quotesActions),
    "tier creation must not be gated on quantity",
  );
});

test("editable Costs is blocked until every tier quantity is valid", () => {
  assert.match(
    costsPage,
    /const editable = quote\.status === "draft" && tierQuantitiesOk/,
    "editability must require resolved tier quantities as well as draft status",
  );
});

test("every invalid quantity shape is caught, and none is defaulted", () => {
  const invalid = findInvalidTierQuantities([
    { id: "t1", label: "Tier 1", qty: null },
    { id: "t2", label: "Tier 2", qty: 0 },
    { id: "t3", label: "Tier 3", qty: -5 },
    { id: "t4", label: "Tier 4", qty: Number.NaN },
    { id: "t5", label: "Tier 5", qty: 5000 },
  ]);
  assert.deepEqual(
    invalid.map((t) => [t.tierId, t.reason]),
    [
      ["t1", "missing"],
      ["t2", "not_positive"],
      ["t3", "not_positive"],
      ["t4", "invalid"],
    ],
    "null, zero, negative and non-finite all block; a positive quantity passes",
  );
  // No fallback or sentinel anywhere in the gate: a missing quantity is a
  // question for the operator, never a value the system invents. A defaulted
  // quantity would yield a wrong per-unit cost and a wrong margin.
  assert.ok(
    !/\?\?\s*1\b|\?\?\s*0\b|DEFAULT_QTY|fallbackQty/.test(gate),
    "gate must not introduce a default or sentinel quantity",
  );
});

test("correcting the quantity immediately re-enables calculation", () => {
  const tiers = [
    { id: "t1", label: "Tier 1", qty: null as number | null },
    { id: "t2", label: "Tier 2", qty: 25_000 },
  ];
  assert.equal(tierQuantitiesResolved(tiers), false);
  // Same predicate the page derives `editable` from, so setting the quantity
  // restores editable Costs on the next render with no further action.
  tiers[0].qty = 5_000;
  assert.equal(tierQuantitiesResolved(tiers), true);
  assert.deepEqual(findInvalidTierQuantities(tiers), []);
});

test("frozen revisions stay readable and are never mutated by the gate", () => {
  // Read access is preserved for non-draft quotes: the gate only ever removes
  // editability. Three quotes were sent carrying unset quantities; blocking
  // the read would hide commercial history to enforce a later rule.
  assert.match(
    costsPage,
    /quote\.status !== "draft" && <SentStatusBanner/,
    "non-draft quotes must still render their status banner, not be blocked",
  );
  assert.ok(
    !/update\(quoteTiers\)|set\(\{\s*qty/.test(costsPage),
    "the Costs page must never write a tier quantity",
  );
  assert.ok(
    !/insert|update|delete/i.test(gate),
    "the gate is a pure predicate and must perform no writes",
  );
});

test("the diagnostic names the affected tiers and links back to Setup", () => {
  const one = describeInvalidTierQuantities([
    { tierId: "t1", tierLabel: "Tier 1", reason: "missing" },
  ]);
  assert.match(one, /Missing tier quantity: Tier 1\./);

  const many = describeInvalidTierQuantities([
    { tierId: "t1", tierLabel: "MOQ", reason: "missing" },
    { tierId: "t2", tierLabel: "Volume", reason: "not_positive" },
  ]);
  assert.match(many, /2 tiers/);
  assert.match(many, /MOQ/);
  assert.match(many, /Volume \(must be above zero\)/);

  assert.equal(
    setupTierEditorHref("p1", "q1", "t1"),
    "/projects/p1/quotes/q1/setup?tier=t1",
  );
});

test("Cost Stack reports the real blocker instead of a generic message", () => {
  // "awaiting inputs" pointed at no input and read as a Packaging fault when
  // Packaging was complete and correct. The stack must distinguish the two.
  assert.match(costStack, /missingTierQty/);
  assert.match(costStack, /"missing tier quantity"/);
  assert.match(
    costStack,
    /missingTierQty=\{!\(tierQty > 0\)\}/,
    "the flag must derive from the tier's own quantity",
  );
});
