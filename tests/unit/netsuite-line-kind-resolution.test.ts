import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { commercialLineKind } from "../../src/db/schema.ts";
import {
  LINE_KIND_RESOLUTION,
  resolvesBySku,
} from "../../src/lib/netsuite/line-kind-resolution.ts";
import { LINE_KIND_DESTINATION } from "../../src/lib/netsuite/bv011-destinations.ts";

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

test("the product kinds resolve by SKU", () => {
  // TWO, not three. `item_group` was here for one commit and moved to
  // `by_destination` when `item_group_production` became an approved
  // destination with a governed item -- see the note in the module. The Item
  // Group's COMMERCIAL line posts to IGP-0001; its SKU never becomes a priced
  // line.
  for (const kind of ["item_group_member", "direct_product"] as const) {
    assert.equal(resolvesBySku(kind), true, `${kind} is a product line`);
  }
  assert.equal(
    resolvesBySku("item_group"),
    false,
    "the Item Group commercial line resolves by destination, not by SKU",
  );
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

  // Products: NULL is correct and permanent. Neither may block.
  assert.equal(blocksOnNullDestination("direct_product"), false);
  assert.equal(blocksOnNullDestination("item_group_member"), false);

  // Charges and services: NULL is a genuine gap. Both must still block.
  assert.equal(blocksOnNullDestination("otc"), true);
  assert.equal(blocksOnNullDestination("direct_service"), true);

  // `item_group` is destination-resolved and therefore IN this set -- but its
  // destination is never NULL in practice, because readiness derives it from
  // the kind. That derivation, not an exemption, is what stopped it being
  // reported as "frozen before accounting destinations were recorded".
  assert.equal(blocksOnNullDestination("item_group"), true);
  assert.equal(LINE_KIND_DESTINATION.item_group, "item_group_production");
});

test("a governed destination is unaffected by the exemption", () => {
  // The exemption is about which lines are ASKED for a destination, never
  // about what happens once one is present. An OTC line with a governed
  // destination is not exempt and does not need to be — it passes on merit.
  assert.equal(resolvesBySku("otc"), false);
  // DPS-1072 v2 froze exactly this: otc_tooling and otc_formulation on the two
  // charge lines, which passed readiness both before and after this repair.
});

test("every frozen kind on DPS-1072 v2 resolves somewhere", () => {
  // The frozen line set of the accepted quote: four members, the Item Group
  // commercial line, two separately elected charges. Each must have exactly one
  // route to a NetSuite item -- by SKU, or by a destination that is governed.
  //
  // The original defect was a kind with NEITHER: exempt from the destination
  // check by omission and unresolvable by SKU, so it fell through to a blocker
  // whose remediation could not be followed.
  const frozenKinds = [
    "item_group_member", "item_group_member", "item_group_member", "item_group_member",
    "item_group", "otc", "otc",
  ] as const;

  for (const kind of frozenKinds) {
    const bySku = resolvesBySku(kind);
    const byDestination =
      !bySku &&
      ((kind as string) === "otc" ||
        (kind as string) === "direct_service" ||
        kind in LINE_KIND_DESTINATION);
    assert.ok(
      bySku !== byDestination,
      `${kind} must resolve by exactly one route, not both and not neither`,
    );
  }
});
