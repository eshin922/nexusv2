/**
 * Add Destination — duplicate protection by request idempotency.
 *
 * Business-field uniqueness cannot serve here. Multiple commercial
 * alternatives for one destination and consignee ARE the comparison workflow
 * — quote `2f29af72` holds four legitimate "Texas" alternatives differing in
 * amount, markup and pricing shape, one of them selected as in-the-price. At
 * creation time an intentional alternative is byte-identical to an accidental
 * repeat, because a new destination carries no amounts yet.
 *
 * Timing cannot separate them either: a rapid deliberate alternative is valid,
 * and a delayed retry is still a duplicate. So the discriminator is the
 * SUBMISSION, carried by a client-minted key.
 *
 * The claim is modelled here against a simulated unique index so the
 * concurrency semantics are executable; structural tests bind the model to the
 * production wiring.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(
  new URL("../../src/app/actions/freight-worksheet.ts", import.meta.url),
  "utf8",
);
const ui = readFileSync(
  new URL("../../src/components/costs/freight-drilldown.tsx", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../../src/db/schema.ts", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// Reference model: claim + work commit atomically, as the transaction does.
// ---------------------------------------------------------------------------

type Row = { destination: string; consignee: string | null };

function makeServer() {
  const keys = new Map<string, { id: string } | null>();
  const rows: Array<Row & { id: string }> = [];
  let seq = 0;

  /** One request. Mirrors the single-transaction claim-then-work shape. */
  const add = (key: string | null, row: Row): { id: string; replayed: boolean } => {
    if (key !== null) {
      if (keys.has(key)) {
        const prior = keys.get(key);
        // A claimed key with no result means the original attempt rolled back
        // and there is nothing to replay — fall through and do the work.
        if (prior) return { id: prior.id, replayed: true };
      } else {
        keys.set(key, null);
      }
    }
    const id = `dest-${++seq}`;
    rows.push({ ...row, id });
    if (key !== null) keys.set(key, { id });
    return { id, replayed: false };
  };

  return { add, rows, keys };
}

test("simultaneous requests with the same key create exactly one row", () => {
  const server = makeServer();
  const key = "sub-1";
  // The unique index serialises them; both are modelled as reaching the claim.
  const a = server.add(key, { destination: "Texas", consignee: null });
  const b = server.add(key, { destination: "Texas", consignee: null });
  assert.equal(server.rows.length, 1);
  assert.equal(a.id, b.id);
  assert.equal(b.replayed, true);
});

test("sequential replay with the same key returns the same result", () => {
  const server = makeServer();
  const key = "sub-2";
  const first = server.add(key, { destination: "Texas", consignee: null });
  const replay = server.add(key, { destination: "Texas", consignee: null });
  assert.deepEqual(replay, { id: first.id, replayed: true });
  assert.equal(server.rows.length, 1);
});

test("four rapid retries of one submission collapse to one row", () => {
  // The observed failure: four identical submissions in nine seconds.
  const server = makeServer();
  for (let i = 0; i < 4; i++) server.add("sub-3", { destination: "Texas", consignee: null });
  assert.equal(server.rows.length, 1);
});

test("different keys may create two alternatives with identical destination and consignee", () => {
  // This is the workflow an absolute uniqueness guard destroyed.
  const server = makeServer();
  server.add("sub-a", { destination: "Texas", consignee: null });
  server.add("sub-b", { destination: "Texas", consignee: null });
  assert.equal(server.rows.length, 2);
  assert.deepEqual(
    server.rows.map((r) => [r.destination, r.consignee]),
    [["Texas", null], ["Texas", null]],
  );
});

test("idempotency does not depend on elapsed time", () => {
  // A retry an hour later is still the same submission; a deliberate add one
  // second later is still a new one. Neither is a function of the clock.
  const server = makeServer();
  server.add("sub-slow", { destination: "Texas", consignee: null });
  const late = server.add("sub-slow", { destination: "Texas", consignee: null });
  assert.equal(late.replayed, true);
  server.add("sub-fast", { destination: "Texas", consignee: null });
  assert.equal(server.rows.length, 2);
});

test("a failed original does not permanently block its key", () => {
  // Claim and work commit together, so a rollback takes the claim with it.
  // The model's null-result case covers a claim observed without a result.
  const server = makeServer();
  server.keys.set("sub-failed", null);
  const retry = server.add("sub-failed", { destination: "Texas", consignee: null });
  assert.equal(retry.replayed, false);
  assert.equal(server.rows.length, 1);
});

test("an absent key still creates a row", () => {
  // Backward compatible: a caller that sends no key is unprotected but works.
  const server = makeServer();
  server.add(null, { destination: "Texas", consignee: null });
  server.add(null, { destination: "Texas", consignee: null });
  assert.equal(server.rows.length, 2);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("the business-field uniqueness guard is gone", () => {
  // Two alternatives for one destination and consignee must be creatable.
  assert.doesNotMatch(action, /destinationIdentity/);
  assert.doesNotMatch(action, /already priced on this shipment/);
});

test("claim and work share one transaction", () => {
  const add = action.slice(action.indexOf("export async function addFreightDestination"));
  const body = add.slice(0, add.indexOf("export async function ", 1));
  assert.match(body, /db\.transaction\(async \(tx\) => \{/);
  assert.match(body, /\.insert\(actionIdempotency\)[\s\S]*?\.onConflictDoNothing\(\)/);
  // The destination insert must be inside that transaction, not alongside it.
  assert.ok(
    body.indexOf("db.transaction") < body.indexOf("tx.insert(freightDestinations)"),
    "destination insert must run inside the claiming transaction",
  );
});

test("the key is the primary key, so the claim is atomic", () => {
  assert.match(schema, /export const actionIdempotency = pgTable\("action_idempotency"/);
  assert.match(schema, /key: text\("key"\)\.primaryKey\(\)/);
});

test("the client mints one key per submission and rolls it after success", () => {
  assert.match(ui, /name="idempotencyKey"/);
  // Fresh key when the form opens for a deliberate new alternative...
  assert.match(ui, /setIdempotencyKey\(crypto\.randomUUID\(\)\); setOpen\(true\)/);
  // ...and again after a success, since the form stays open for another entry.
  assert.match(ui, /makeSubmit\(\(\) => setIdempotencyKey\(crypto\.randomUUID\(\)\)\)/);
});

test("action-scoped pending remains as the first UI defense", () => {
  // Retained, but explicitly not the persistence guarantee.
  assert.match(ui, /disabled=\{pending\}/);
});
