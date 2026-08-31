import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { commercialLineKind } from "../../src/db/schema.ts";
import {
  LINE_KIND_RESOLUTION,
  resolvesBySku,
} from "../../src/lib/netsuite/line-kind-resolution.ts";

// ═══════════════════════════════════════════════════════════════════════
// EVERY PRODUCT LINE KIND IS EXEMPT FROM THE DESTINATION CHECK.
//
// A product resolves in NetSuite by SKU, so `bv011_destination` is correctly
// and permanently NULL on it. A charge or a service resolves by destination,
// so a NULL there is a real blocker.
//
// The readiness check spelled the product set out as a literal
// (`item_group_member || direct_product`) written when those were the only
// two. OD-028 added `item_group`; the literal did not grow with it. The Item
// Group header was then reported as "frozen before accounting destinations
// were recorded" with the remediation "revise and re-send so the line records
// its destination" -- an instruction that CANNOT be followed, because a
// re-send freezes NULL again. DPS-1072 hit it on a freshly re-sent v2.
//
// These fail if a future product kind is added to the projection and readiness
// still treats its NULL destination as an accounting gap.
// ═══════════════════════════════════════════════════════════════════════

test("the classification is total over the line-kind enum", () => {
  // The guard that makes a new kind impossible to ignore. `satisfies` catches
  // it at compile time; this catches it loudly, and names the missing kind.
  for (const kind of commercialLineKind.enumValues) {
    assert.ok(
      kind in LINE_KIND_RESOLUTION,
      `line kind "${kind}" has no resolution classification — decide whether it ` +
        `resolves by SKU or by accounting destination`,
    );
  }
  assert.equal(
    Object.keys(LINE_KIND_RESOLUTION).length,
    commercialLineKind.enumValues.length,
    "the map must cover the enum exactly — no extra keys, none missing",
  );
});

test("the three product kinds resolve by SKU", () => {
  for (const kind of ["item_group", "item_group_member", "direct_product"] as const) {
    assert.equal(resolvesBySku(kind), true, `${kind} is a product line`);
  }
});

test("services and one-time charges stay OUTSIDE the exemption", () => {
  // The other half of the guard. Exempting these would let a line with no
  // governed destination post to whatever the emitter happened to pick.
  for (const kind of ["direct_service", "otc"] as const) {
    assert.equal(resolvesBySku(kind), false, `${kind} must still require a destination`);
  }
});

test("readiness exempts through the shared predicate, not a second list", async () => {
  // A second spelling of the product set is how the first one fell behind.
  const src = await readFile("src/lib/netsuite/projection-readiness.ts", "utf8");
  assert.match(src, /if \(resolvesBySku\(line\.kind\)\) \{/);
  assert.doesNotMatch(
    src,
    /line\.kind === "item_group_member" \|\| line\.kind === "direct_product"/,
    "the literal list must be gone, not merely supplemented",
  );
});

// ── BEHAVIOURAL: which NULL destinations block, and which do not ─────────
//
// `assessProjectionReadiness` is database-bound, so these exercise the exact
// predicate the loop branches on for every kind, against a NULL destination —
// the state the whole defect was about.

test("a NULL destination blocks only the kinds that resolve by destination", () => {
  const blocksOnNullDestination = (kind: (typeof commercialLineKind.enumValues)[number]) =>
    !resolvesBySku(kind);

  // Products: NULL is correct and permanent. None may block.
  assert.equal(blocksOnNullDestination("direct_product"), false);
  assert.equal(blocksOnNullDestination("item_group_member"), false);
  assert.equal(blocksOnNullDestination("item_group"), false, "the Order-1 defect");

  // Charges and services: NULL is a genuine gap. Both must still block.
  assert.equal(blocksOnNullDestination("otc"), true);
  assert.equal(blocksOnNullDestination("direct_service"), true);
});

test("a governed destination is unaffected by the exemption", () => {
  // The exemption is about which lines are ASKED for a destination, never
  // about what happens once one is present. An OTC line with a governed
  // destination is not exempt and does not need to be — it passes on merit.
  assert.equal(resolvesBySku("otc"), false);
  // DPS-1072 v2 froze exactly this: otc_tooling and otc_formulation on the two
  // charge lines, which passed readiness both before and after this repair.
});

test("reintroducing the literal reproduces the Order-1 blocker", () => {
  // The falsification. This is the predicate as it stood, applied to the
  // frozen line set of DPS-1072 v2 — four members, one Item Group header, two
  // charges — and it blocks the header on a NULL that is correct.
  const oldPredicate = (kind: string) =>
    kind === "item_group_member" || kind === "direct_product";

  const frozenKinds = [
    "item_group_member", "item_group_member", "item_group_member", "item_group_member",
    "item_group", "otc", "otc",
  ] as const;

  const blockedByOld = frozenKinds.filter(
    (k) => !oldPredicate(k) && (k === "item_group"),
  );
  assert.deepEqual(blockedByOld, ["item_group"], "the old literal blocks the header");

  const blockedByNew = frozenKinds.filter(
    (k) => !resolvesBySku(k) && (k === "item_group"),
  );
  assert.deepEqual(blockedByNew, [], "the repair does not");
});
