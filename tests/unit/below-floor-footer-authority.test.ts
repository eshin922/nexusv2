import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { codeOnly } from "../support/code-only.ts";
import { projectBelowFloorAuthorization } from "../../src/lib/below-floor-projection.ts";

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

const rollup = (tierId: string, status: string | null) => ({
  tierId,
  label: tierId.toUpperCase(),
  totalRevenue: 1000,
  totalCost: 900,
  blendedMarginPct: 0.1,
  blendedMarginStatus: status,
});

const auth = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "a1",
    quoteVersionNumber: 1,
    tierId: "t1",
    approvedByUserId: "u1",
    stateFingerprint: "",
    invalidatedAt: null,
    ...over,
  }) as never;

/**
 * The footer and the send gate answer ONE question.
 *
 * They did not. The gate asked the governed `blendedMarginStatus` and read
 * authorizations; the footer hand-rolled `blendedMarginPct < floor - 1e-6` and
 * read none. So a below-floor tier that had been properly authorized still
 * showed `blocked`, and offered "Request pricing approval" — sending an
 * operator to seek approval they already held, for a send that would have
 * succeeded.
 */

test("an authorized below-floor tier does not block", async () => {
  // The whole point of the repair, stated as the arithmetic-free case: the
  // margin is identical either way, and only the authorization differs.
  const rollups = [rollup("t1", "BELOW_FLOOR")];
  const fingerprint = projectBelowFloorAuthorization({
    rollups,
    authorizations: [],
    quoteVersionNumber: 1,
  });
  assert.equal(fingerprint.ok, false, "unauthorized below-floor must block");
  assert.equal(fingerprint.anyBelowFloor, true);

  // Now the same rollup WITH a matching authorization. The fingerprint has to
  // be the one the projection itself computes, so it is read back from the
  // refusal path rather than guessed.
  const { fingerprintCommercialState } = await import(
    "../../src/lib/below-floor-authorization.ts"
  );
  const fp = fingerprintCommercialState({
    totalRevenue: 1000,
    totalCost: 900,
    blendedMarginPct: 0.1,
  });
  const authorized = projectBelowFloorAuthorization({
    rollups,
    authorizations: [auth({ stateFingerprint: fp })],
    quoteVersionNumber: 1,
  });
  assert.equal(authorized.ok, true, "an authorized tier must not block the send");
  assert.equal(authorized.anyBelowFloor, true, "it is still below floor, and still says so");
});

test("an authorization for another version or tier does not carry", () => {
  const rollups = [rollup("t1", "BELOW_FLOOR")];
  for (const wrong of [{ quoteVersionNumber: 2 }, { tierId: "t9" }]) {
    const out = projectBelowFloorAuthorization({
      rollups,
      authorizations: [auth(wrong)],
      quoteVersionNumber: 1,
    });
    assert.equal(out.ok, false, `an authorization scoped ${JSON.stringify(wrong)} must not apply`);
  }
});

test("nothing below floor costs no verdict at all", () => {
  const out = projectBelowFloorAuthorization({
    rollups: [rollup("t1", "GOOD"), rollup("t2", null)],
    authorizations: [],
    quoteVersionNumber: 1,
  });
  assert.deepEqual(out, { ok: true, tiers: [], anyBelowFloor: false });
});

test("one unauthorized tier fails the quote, and every one is reported", () => {
  const out = projectBelowFloorAuthorization({
    rollups: [rollup("t1", "BELOW_FLOOR"), rollup("t2", "BELOW_FLOOR")],
    authorizations: [],
    quoteVersionNumber: 1,
  });
  assert.equal(out.ok, false);
  // Both, not the first. An operator who fixes one and is then refused for the
  // next has been made to discover the work one item at a time.
  assert.equal(out.tiers.length, 2);
  assert.ok(out.tiers.every((t) => t.message && t.message.length > 0));
});

test("the footer reads the verdict and derives no threshold of its own", async () => {
  const rail = codeOnly(await read("src/components/quote/customer-view-rail.tsx"));
  assert.match(rail, /const blocked = !belowFloor\.ok/, "the footer reads the shared verdict");
  // The hand-rolled comparison must be gone, not merely unused.
  assert.doesNotMatch(
    rail,
    /blendedMarginPct[\s\S]{0,40}floorMarginPct/,
    "the footer must not re-derive the floor",
  );
});

test("the primary action is called what it does", async () => {
  // Edward's call, 2026-08-25. Nexus does not email the customer, and this
  // footer says so two lines above the button. "Freeze & send" directly
  // beneath "Delivery is manual — Nexus does not email the customer" is the
  // surface contradicting itself about the one act the operator is performing.
  const raw = await read("src/components/quote/customer-view-rail.tsx");
  assert.match(raw, /Finalize quote/);

  // Asserted against CODE, not prose. The first version matched the whole
  // file and caught the comment that explains the rename — the same shape as
  // the /terms/ regex that once matched "Payment terms" and reported T&Cs
  // present in both documents. A file is allowed to discuss the old wording;
  // the button is not allowed to use it.
  const code = codeOnly(raw);
  assert.doesNotMatch(
    code,
    /Freeze & send/,
    "the button must not promise a send Nexus does not perform",
  );
  // And the line it used to contradict is still there.
  assert.match(raw, /Nexus does not email the customer/);
});
