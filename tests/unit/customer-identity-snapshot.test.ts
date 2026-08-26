import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

/**
 * #431 Step 1 — the customer's identity must be frozen at send, in BOTH stores,
 * and read from the frozen one.
 *
 * The defect: `quote_snapshots` froze `prepared_by_*` (the seller) and captured
 * no customer identity at all, so a sent quote's PREPARED FOR block read
 * `projects.client_name` live. Rename the company in HubSpot, re-import, and a
 * quote sent weeks earlier re-rendered addressed to a different customer.
 *
 * These are source assertions rather than a database walk on purpose. The
 * failure mode being guarded is structural — a writer that updates one store
 * and not the other, or a resolver that keeps reading live — and that is
 * visible in the source. It is also exactly the shape that shipped once
 * already: 0102 added the column to the versioned record only, and the defect
 * stayed open in the document while closing on paper.
 */

test("both freeze stores carry the customer name", async () => {
  const schema = await read("src/db/schema.ts");

  // The mirror the resolver reads.
  assert.match(
    schema,
    /customerNameSnapshot: text\("customer_name_snapshot"\)/,
    "quotes.customer_name_snapshot is missing — the resolver's isSent branch has nothing to read",
  );

  // The versioned record.
  assert.match(
    schema,
    /customerName: text\("customer_name"\)/,
    "quote_snapshots.customer_name is missing — the per-version archive would lose the customer",
  );
});

test("sendQuote writes the customer name to both stores", async () => {
  const src = await read("src/app/actions/quotes.ts");

  assert.match(
    src,
    /customerName: project\.clientName/,
    "the versioned record is not written at send",
  );
  assert.match(
    src,
    /customerNameSnapshot: project\.clientName/,
    "the read-path mirror is not written at send — this is the 0102 failure: a column frozen in the store nothing reads",
  );
});

test("the resolver reads the frozen customer name on sent quotes", async () => {
  const src = await read("src/lib/customer-view-resolver.ts");

  // The live read must be GATED, not unconditional. Asserting on the gated
  // expression rather than merely on the absence of the old one: a test that
  // only checked "clientName no longer appears" would pass if the field were
  // deleted outright, which is a different bug.
  assert.match(
    src,
    /\(isSent \? quote\.customerNameSnapshot : null\) \?\?\s*\n?\s*project\.clientName/,
    "customer.name does not resolve frozen-first on sent quotes",
  );
});

test("the seller's freeze is untouched", async () => {
  // The customer block is the SIBLING of prepared_by, not a replacement for it.
  // A refactor that unified them would be wrong: they are two different parties
  // resolved from two different sources, and only one of them is the firm.
  const src = await read("src/lib/customer-view-resolver.ts");
  assert.match(src, /quote\.preparedByNameSnapshot/);
  assert.match(src, /quote\.preparedByEmailSnapshot/);
});

test("contact, role and address stay absent rather than guessed", async () => {
  // Step 2 adds the HubSpot Companies/Contacts source; Step 3 freezes what it
  // resolves. Until then these render as absent — the renderers are null-safe
  // and have been since RI.6.
  //
  // The rule this guards is the one that outlives Step 2: a deal may have
  // several associated contacts, and the selection rule is NOT decided. An
  // arbitrary pick would put a named individual on a customer-facing quotation
  // on the strength of a sort order.
  const src = await read("src/lib/customer-view-resolver.ts");
  assert.match(src, /contact: null,\s*\n\s*role: null,/);
});
