/**
 * The witness algebra — parser, inclusion, and the visibility partial order.
 *
 * Every numeric fixture below was MEASURED against PostgreSQL 16.14 on the
 * isolated validation database (proof P1, `cc-reconciliation-p1.md`), not
 * invented. Where a shape is constructed rather than observed it says so.
 *
 * Two of these cases exist because the first pass of P1 asserted the wrong
 * thing and went red:
 *
 *   F1  a held xid does NOT necessarily appear in `xip`. When it is the
 *       highest xid assigned, `xmax` equals it and the list is EMPTY. A test
 *       that only ever checks list membership passes while the second shape
 *       goes unexercised — and the second shape is what a lone writer makes.
 *
 *   F2  a snapshot says a transaction FINISHED, not that it COMMITTED.
 *       `included` reports true for an aborted xid, exactly as
 *       `pg_visible_in_snapshot` does. The two agree; both are silent. That is
 *       why the known-committed precondition is enforced at the arming site
 *       rather than here.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  compareWitness,
  dominates,
  included,
  parseWitness,
  parseWriteId,
} from "../../src/lib/costing-witness.ts";

const w = (text: string) => {
  const parsed = parseWitness(text);
  assert.ok(parsed, `fixture must parse: ${text}`);
  return parsed;
};
const id = (text: string) => {
  const parsed = parseWriteId(text);
  assert.ok(parsed !== null, `fixture must parse: ${text}`);
  return parsed;
};

// ── parsing ───────────────────────────────────────────────────────────────

test("parses the two shapes P1 measured", () => {
  const inRange = w("14346:14348:14346");
  assert.equal(inRange.xmin, 14346n);
  assert.equal(inRange.xmax, 14348n);
  assert.deepEqual([...inRange.xip], [14346n]);

  const empty = w("14345:14345:");
  assert.equal(empty.xmin, 14345n);
  assert.equal(empty.xmax, 14345n);
  assert.equal(empty.xip.size, 0);
});

test("parses a multi-entry in-progress list", () => {
  const many = w("100:110:100,103,109");
  assert.deepEqual([...many.xip].sort((x, y) => (x < y ? -1 : 1)), [100n, 103n, 109n]);
});

test("the text is retained verbatim for round-tripping", () => {
  assert.equal(w("14346:14348:14346").text, "14346:14348:14346");
});

test("values beyond 2^53 survive — this is why BigInt, not Number", () => {
  // 9007199254740993 is 2^53 + 1, which Number cannot represent exactly.
  const big = w("9007199254740993:9007199254740995:9007199254740993");
  assert.equal(big.xmin, 9007199254740993n);
  assert.ok(big.xip.has(9007199254740993n));
  assert.equal(included(id("9007199254740993"), big), false);
  assert.equal(included(id("9007199254740994"), big), true);
  // The same pair through Number would collapse onto one value.
  assert.equal(Number("9007199254740993"), Number("9007199254740992"));
});

test("invalid input fails closed — every rejection returns null", () => {
  for (const bad of [
    undefined,
    null,
    42,
    {},
    [],
    "",
    "not-a-snapshot",
    "1:2", // too few parts
    "1:2:3:4", // too many parts
    ":2:", // missing xmin
    "1::", // missing xmax
    "-1:2:", // negative
    "1.5:2:", // non-integer
    " 1:2:", // whitespace
    "1:2: ", // whitespace in list
    "0x10:20:", // hex
    "1e3:2000:", // exponent
    "3:2:", // xmin above xmax
    "10:20:5", // xip entry below xmin
    "10:20:25", // xip entry at or above xmax
    "10:20:20", // xip entry exactly at xmax
    "10:20:12,", // trailing separator
    "10:20:,12", // leading separator
    "10:20:12,,13", // empty entry
  ]) {
    assert.equal(
      parseWitness(bad as unknown),
      null,
      `must reject ${JSON.stringify(bad)}`,
    );
  }
});

test("write ids reject anything that is not a bare run of digits", () => {
  for (const bad of [undefined, null, 42, {}, "", " 1", "1 ", "-1", "1.0", "0x1", "1e3", "abc"]) {
    assert.equal(parseWriteId(bad as unknown), null, `must reject ${JSON.stringify(bad)}`);
  }
  assert.equal(parseWriteId("14346"), 14346n);
  assert.equal(parseWriteId("0"), 0n);
});

// ── inclusion, including both F1 exclusion shapes ─────────────────────────

test("F1 shape 1 — excluded by in-progress membership", () => {
  // Measured: xid 14346 held open while 14347 had committed.
  const s1 = w("14346:14348:14346");
  assert.equal(included(id("14346"), s1), false, "the held write is not included");
  assert.equal(included(id("14347"), s1), true, "the committed write is included");
});

test("F1 shape 2 — excluded by the bound, with an EMPTY in-progress list", () => {
  // Measured: `14345:14345:` while 14345 was held open. Nothing is in `xip`;
  // the `< xmax` clause is the only thing excluding it. A test asserting
  // xip membership here would assert something false about a real snapshot.
  const s = w("14345:14345:");
  assert.equal(s.xip.size, 0, "the list really is empty");
  assert.equal(included(id("14345"), s), false, "still excluded, by the bound");
  assert.equal(included(id("14344"), s), true, "anything below xmin is included");
  assert.equal(included(id("14346"), s), false, "anything above xmax is excluded");
});

test("inclusion after the commit — the same write, the next snapshot", () => {
  // Measured pair: before `14346:14348:14346`, after `14348:14348:`.
  assert.equal(included(id("14346"), w("14346:14348:14346")), false);
  assert.equal(included(id("14346"), w("14348:14348:")), true);
});

test("F2 — an aborted xid reads as included once its transaction ends", () => {
  // Measured: xid 14348 rolled back; pg_visible_in_snapshot returned TRUE
  // while the row was provably unchanged. `included` agrees. This is not a
  // defect in either — it is why the caller must only ever ask about a write
  // it knows committed.
  const afterAbort = w("14349:14349:");
  assert.equal(
    included(id("14348"), afterAbort),
    true,
    "the predicate cannot see commit status, and must not pretend to",
  );
});

// ── the visibility partial order ──────────────────────────────────────────

test("same xmax — the fresh read dominates and the stale read does not", () => {
  // The measured counterexample. Both report revision 14348, so the legacy
  // `<=` rule rejects them both; dominance separates them exactly.
  const stale = w("14346:14348:14346");
  const fresh = w("14348:14348:");
  assert.equal(stale.xmax, fresh.xmax, "the numbers really are equal");
  assert.equal(compareWitness(fresh, stale), "dominates");
  assert.equal(compareWitness(stale, fresh), "dominated");
  assert.equal(dominates(fresh, stale), true);
  assert.equal(dominates(stale, fresh), false);
});

test("a strictly greater xmax dominates regardless of the lists", () => {
  assert.equal(compareWitness(w("20:30:20"), w("10:15:10,14")), "dominates");
  assert.equal(compareWitness(w("10:15:10,14"), w("20:30:20")), "dominated");
});

test("identical witnesses dominate in neither direction", () => {
  const a = w("10:20:12,15");
  const b = w("10:20:15,12"); // same set, different textual order
  assert.equal(compareWitness(a, b), "identical");
  assert.equal(dominates(a, b), false);
  assert.equal(dominates(b, a), false);
  // And a witness against itself.
  assert.equal(compareWitness(a, a), "identical");
  assert.equal(dominates(a, a), false);
});

test("equal xmax with crossing lists is incomparable, not a coin toss", () => {
  const a = w("10:20:12");
  const b = w("10:20:15");
  assert.equal(compareWitness(a, b), "incomparable");
  assert.equal(compareWitness(b, a), "incomparable");
  assert.equal(dominates(a, b), false);
  assert.equal(dominates(b, a), false);
});

test("a superset list is dominated — it saw strictly less", () => {
  const sawLess = w("10:20:12,15");
  const sawMore = w("10:20:12");
  assert.equal(compareWitness(sawMore, sawLess), "dominates");
  assert.equal(compareWitness(sawLess, sawMore), "dominated");
});

test("the order is consistent with inclusion for every xid in range", () => {
  // A property check rather than another example: if B dominates A then every
  // xid A could see, B can see too. This is the guarantee the store relies on
  // when it lets a dominating read replace a stored one.
  const a = w("10:20:12,15");
  const b = w("10:20:12");
  assert.equal(dominates(b, a), true);
  for (let x = 5n; x < 25n; x += 1n) {
    if (included(x, a)) {
      assert.equal(included(x, b), true, `xid ${x} visible to A must be visible to B`);
    }
  }
});
