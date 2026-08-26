import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CASCADING_DEPENDENT_TABLES,
  NOT_COUNTED,
  describeDependents,
} from "../../src/lib/product-structure/attachment-dependents-rules.ts";

// ── The sentence ────────────────────────────────────────────────────────────
//
// A confirmation that does not name what it destroys is the defect being
// repaired. A confirmation that names it WRONGLY would be the same defect
// wearing a number, so the phrasing is asserted rather than trusted.

test("nothing at risk says nothing — no empty reassurance", () => {
  assert.equal(describeDependents({ entries: [], total: 0 }), null);
});

test("one kind reads as a plain sentence, singular where it should", () => {
  const s = describeDependents({
    entries: [{ singular: "packaging line", plural: "packaging lines", count: 1 }],
    total: 1,
  });
  assert.equal(s, "Also deletes 1 packaging line. This cannot be undone.");
});

test("several kinds join without a stray comma, and never hedge", () => {
  const s = describeDependents({
    entries: [
      { singular: "packaging line", plural: "packaging lines", count: 6 },
      { singular: "price override", plural: "price overrides", count: 2 },
      { singular: "freight membership", plural: "freight memberships", count: 1 },
    ],
    total: 9,
  })!;
  assert.equal(
    s,
    "Also deletes 6 packaging lines, 2 price overrides and 1 freight membership. This cannot be undone.",
  );
  // The old caption reassured about the library while saying nothing about the
  // quote. Whatever this says, it must not soften.
  assert.doesNotMatch(s, /stays|safe|only|just/i);
});

// ── The coverage guard ──────────────────────────────────────────────────────
//
// Pattern 60. A control that cannot capture everything it claims to protect is
// worse than no control, because it is believed. This count is cited in a
// destructive confirmation, so it must fail loudly when the schema grows a
// cascade it does not know about — not quietly undercount.

test("every ON DELETE CASCADE reference to quote_leaves is accounted for", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");

  // Table blocks, so a cascade can be attributed to the table declaring it.
  const blocks: { table: string; body: string }[] = [];
  const re = /export const \w+ = pgTable\(\s*"([a-z_]+)"/g;
  let m: RegExpExecArray | null;
  const marks: { table: string; at: number }[] = [];
  while ((m = re.exec(schema))) marks.push({ table: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    blocks.push({
      table: marks[i].table,
      body: schema.slice(marks[i].at, marks[i + 1]?.at ?? schema.length),
    });
  }

  // A cascading FK on quote_leaf_id. Deliberately narrow: a reference WITHOUT
  // `onDelete: "cascade"` does not vanish with the attachment and must not be
  // reported as destroyed.
  const cascading = blocks
    .filter(({ body }) =>
      /quoteLeafId: uuid\("quote_leaf_id"\)[\s\S]{0,240}?onDelete:\s*"cascade"/.test(
        body,
      ),
    )
    .map(({ table }) => table);

  // The instrument must be able to express a failure before its silence means
  // anything. If the pattern matches nothing at all, it is broken, not clean.
  assert.ok(
    cascading.length >= 5,
    `the schema scan found ${cascading.length} cascading references — the pattern is probably broken rather than the schema clean`,
  );

  const known = new Set<string>(CASCADING_DEPENDENT_TABLES);
  const missing = cascading.filter((t) => !known.has(t));
  assert.deepEqual(
    missing,
    [],
    `these tables cascade on quote_leaves delete but are not in CASCADING_DEPENDENT_TABLES, so the removal confirmation undercounts what it destroys: ${missing.join(", ")}`,
  );

  // And the reverse: a table listed here that no longer cascades would inflate
  // the operator's number with something a delete does not touch.
  const stale = [...known].filter((t) => !cascading.includes(t));
  assert.deepEqual(
    stale,
    [],
    `listed as cascading but no longer does: ${stale.join(", ")}`,
  );
});

test("every uncounted cascade carries a stated reason", () => {
  // Excluding a table is allowed; excluding it silently is not.
  const counted = new Set([
    "assembly_leaf_inputs",
    "assembly_production_inputs",
    "assembly_leaf_overrides",
    "assembly_leaf_targets",
    "quote_client_targets",
    "quote_leaf_lifts",
    "freight_subcategory_items",
    "freight_leg_component_tier_costs",
    "quote_other_service_items",
  ]);
  for (const t of CASCADING_DEPENDENT_TABLES) {
    if (counted.has(t)) continue;
    assert.ok(
      NOT_COUNTED[t],
      `${t} is in the cascade list but is neither counted nor given a reason for being excluded`,
    );
  }
});
