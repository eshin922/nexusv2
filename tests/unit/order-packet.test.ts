import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";
import { orderPacketPath, orderPacketUrl } from "../../src/lib/order-packet/url.ts";

/** Comments stripped AND line endings normalized — see #334 for why. */
const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// NEXUS ORDER PACKET — item-level specifications
//
// From a NetSuite Sales Order an operator opens one Nexus link and reads the
// EXACT frozen specification for each applicable ordered item.
//
// The whole value is that the answer cannot drift. So the tests are mostly
// about what the packet must NOT be able to reach: the live spec table, a
// deal-scoped identity, an expiring URL, or a guessed artifact.
// ═══════════════════════════════════════════════════════════════════════

const READER = () =>
  readFile(new URL("../../src/lib/order-packet/reader.ts", import.meta.url), "utf8");
const PAGE = () =>
  readFile(
    new URL("../../src/app/orders/[snapshotId]/documents/page.tsx", import.meta.url),
    "utf8",
  );
const SO = () =>
  readFile(new URL("../../src/lib/netsuite/sales-orders.ts", import.meta.url), "utf8");
const MARK = () =>
  readFile(new URL("../../src/lib/netsuite/mark-complete.ts", import.meta.url), "utf8");

// ── frozen state only ─────────────────────────────────────────────────────

test("the reader cannot reach the live spec table", async () => {
  const src = codeOnly(await READER());
  assert.doesNotMatch(
    src,
    /\bleafSpecs\b|["']leaf_specs["']/,
    "the live spec answers what the product is NOW; an order needs what was ordered",
  );
});

test("the reader reads only frozen snapshot tables", async () => {
  const src = codeOnly(await READER());
  for (const t of [
    "quoteSnapshots",
    "quoteSnapshotLines",
    "quoteSnapshotLeafSpecs",
    "quoteSnapshotTierTotals",
  ]) {
    assert.match(src, new RegExp(`\\b${t}\\b`), `${t} must be read`);
  }
});

test("the expiring signed URL is never the artifact authority", async () => {
  const src = codeOnly(await READER());
  assert.match(src, /pdfStoragePath/);
  assert.match(src, /pdfStorageBucket/);
  assert.doesNotMatch(
    src,
    /pdfUrl/,
    "quotes.pdf_url expires in 30 days and is marked internal-only",
  );
});

test("an unresolvable artifact is reported, never guessed", async () => {
  const src = codeOnly(await READER());
  assert.match(src, /state: "unresolved"/);
  // The old resolver fell back to "the most recent audit row", which could
  // attach a revision's PDF to the order that preceded it.
  assert.doesNotMatch(src, /order by .*created_at desc/i);
});

// ── the four dispositions stay distinct ───────────────────────────────────

test("not_spec_bearing is distinct from governed_no_spec", async () => {
  const src = codeOnly(await READER());
  for (const d of ["specified", "governed_no_spec", "not_spec_bearing", "unresolved"]) {
    assert.match(src, new RegExp(`"${d}"`), `${d} missing`);
  }
  // A line with no quote_leaf_id is not an item missing a spec — it is not a
  // specifiable item. Reporting them alike would invent a missing
  // specification for a setup fee.
  const branch = src.slice(src.indexOf("if (!l.quoteLeafId)"));
  assert.match(branch.slice(0, 400), /"not_spec_bearing"/);
});

test("every disposition has an operator-facing sentence", async () => {
  const src = codeOnly(await PAGE());
  for (const d of ["specified", "governed_no_spec", "not_spec_bearing", "unresolved"]) {
    assert.match(src, new RegExp(`case "${d}"`), `${d} has no note`);
  }
});

test("an unresolved item does NOT fall back to the live spec", async () => {
  const src = codeOnly(await PAGE());
  const note = src.slice(src.indexOf('case "unresolved"'));
  assert.match(note.slice(0, 400), /live spec is NOT shown/i);
});

// ── snapshot identity ─────────────────────────────────────────────────────

test("the route is keyed to the snapshot, not the quote or deal", () => {
  assert.equal(orderPacketPath("abc"), "/orders/abc/documents");
  assert.equal(
    orderPacketUrl("abc", "https://nexus.thedps.co"),
    "https://nexus.thedps.co/orders/abc/documents",
  );
  assert.equal(orderPacketUrl("abc", "https://nexus.thedps.co/"), "https://nexus.thedps.co/orders/abc/documents");
});

test("no base URL yields NO link rather than a wrong one", () => {
  // This value is written into a Sales Order and outlives the deploy that
  // produced it. An empty field is visibly empty; a link to the wrong host is
  // not, and nobody re-reads old orders.
  assert.equal(orderPacketUrl("abc", undefined), null);
  assert.equal(orderPacketUrl("abc", ""), null);
  assert.equal(orderPacketUrl("abc", "   "), null);
});

// ── the route is authenticated and read-only ──────────────────────────────

test("the route requires an enrolled Nexus identity", async () => {
  const src = codeOnly(await PAGE());
  assert.match(src, /await ensureUser\(\)/);
  const idx = src.indexOf("await ensureUser()");
  assert.ok(idx < src.indexOf("readOrderPacket("), "auth before reading");
});

test("the route performs no writes", async () => {
  const src = codeOnly(await PAGE());
  for (const w of ["insert(", "update(", "delete(", "use server"]) {
    assert.ok(!src.includes(w), `route must be read-only; found ${w}`);
  }
});

// ── the NetSuite field ────────────────────────────────────────────────────

test("the packet gets its OWN body field", async () => {
  const src = codeOnly(await SO());
  assert.match(src, /body\.custbody_nexus_order_packet = input\.orderPacketUrl/);
});

test("the SharePoint fields keep their established semantics", async () => {
  const src = codeOnly(await SO());
  // Measured: 456 of 716 Sales Orders carry the SharePoint deal-folder URL in
  // both, identically. Repurposing either would overwrite live data and swap
  // deal-scoped semantics for order-scoped ones.
  assert.match(src, /body\.custbody_dps_accounting_files = input\.dealFolderUrl/);
  assert.match(src, /body\.custbody_sharepoint_link = input\.dealFolderUrl/);
  // Neither may ever be assigned the packet URL.
  assert.doesNotMatch(src, /custbody_sharepoint_link = input\.orderPacketUrl/);
  assert.doesNotMatch(src, /custbody_dps_accounting_files = input\.orderPacketUrl/);
});

test("the packet URL is built from the ACCEPTED snapshot", async () => {
  const src = codeOnly(await MARK());
  assert.match(src, /orderPacketUrl\(\s*acceptedSnapshotId/);
  // Not the quote id: a quote-keyed link would begin showing a later revision.
  assert.doesNotMatch(src, /orderPacketUrl\(\s*quoteId/);
});

// ── scope boundary for this slice ─────────────────────────────────────────

test("no invoice guidance is derived in this slice", async () => {
  const src = codeOnly(await READER());
  assert.doesNotMatch(src, /guidance|Guidance/i);
  // The tempting inputs — detail_level, the unit/OTC split, line_kind — are
  // frozen but are NOT the operator's recovery decision. A sentence built from
  // them would present an inference to Accounting as an instruction.
  assert.doesNotMatch(src, /renderInvoiceGuidance|invoice/i);
});

test("no File Cabinet, RESTlet or SOAP work rides along", async () => {
  for (const f of [await READER(), await PAGE(), await SO()]) {
    const src = codeOnly(f);
    assert.doesNotMatch(src, /record\/v1\/file|RESTlet|SuiteTalk|soap/i);
  }
});
