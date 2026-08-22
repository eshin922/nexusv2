/**
 * NetSuite File Cabinet — second probe. SANDBOX ONLY, READ-ONLY.
 *
 * The first probe established that `/record/v1/file` returns 404 with the SAME
 * message as a record type invented on the spot:
 *
 *   notARealRecordType  ->  "Record type 'notARealRecordType' does not exist."
 *   file                ->  "Record type 'file' does not exist."
 *
 * That is genuinely ambiguous, and the ambiguity decides the design. NetSuite
 * reports a record the ROLE cannot see and a record that DOES NOT EXIST with
 * the same 404, so "File Cabinet is unavailable" and "this role lacks Documents
 * and Files" are indistinguishable from that endpoint.
 *
 * The metadata catalog can distinguish them: it enumerates the record types
 * exposed to THIS role. A `file` present there but 404-ing on access is a
 * permission problem; absent means the REST record catalog does not carry it,
 * and no permission grant will change that.
 */
import { describeNetsuiteTarget, nsRequest, suiteQL } from "@/lib/netsuite/client";
import { NetsuiteError } from "@/lib/netsuite/errors";

async function ask<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const d = await fn();
    console.log(`  OK    ${label}`);
    return d;
  } catch (e) {
    if (e instanceof NetsuiteError) {
      console.log(`  FAIL  ${label}`);
      console.log(`        [${e.context.status} ${e.className}] ${String(e.context.detail).slice(0, 140)}`);
    } else {
      console.log(`  FAIL  ${label}: ${(e as Error).message.slice(0, 140)}`);
    }
    return null;
  }
}

async function main() {
  const t = describeNetsuiteTarget();
  console.log("target:", JSON.stringify(t));
  if (!t.accountIsSandbox) { console.error("REFUSING — not sandbox."); process.exit(1); }

  console.log("\n── THE RECORD CATALOG THIS ROLE SEES ────────────────────");
  const cat = await ask("GET /record/v1/metadata-catalog", () =>
    nsRequest<{ items?: Array<{ name?: string }> }>({
      method: "GET",
      path: "/record/v1/metadata-catalog",
      extraHeaders: { Accept: "application/schema+json" },
      maxRetries: 1,
    }));

  if (cat?.items) {
    const names = cat.items.map((i) => i.name ?? "").filter(Boolean).sort();
    console.log(`        record types visible to this role: ${names.length}`);
    const fileish = names.filter((n) => /file|folder|media|document|attach/i.test(n));
    console.log(`        file/folder/media/document/attach matches: ${fileish.length ? fileish.join(", ") : "NONE"}`);
    // Controls: record types we KNOW work, to prove the catalog is real.
    for (const known of ["salesOrder", "customer", "itemGroup", "inventoryItem"]) {
      console.log(`        contains "${known}": ${names.includes(known)}`);
    }
  }

  console.log("\n── SUITEQL: WHICH FILE-ADJACENT TABLES EXIST? ───────────");
  // POSITIVE control first — a table we know is readable, so a wall of
  // failures below cannot be blamed on SuiteQL access itself.
  await ask("POSITIVE  suiteQL transaction (known readable)", () =>
    suiteQL(`select id from transaction fetch first 1 rows only`));
  for (const tbl of ["file", "mediaitem", "mediaitemfolder", "documentfile", "filecabinet"]) {
    await ask(`suiteQL ${tbl}`, () => suiteQL(`select * from ${tbl} fetch first 1 rows only`));
  }

  console.log("\n── WHAT THE SO CAN CARRY INSTEAD ────────────────────────");
  const so = await ask("GET salesOrder/362941?expandSubResources=true", () =>
    nsRequest<Record<string, unknown>>({
      method: "GET", path: "/record/v1/salesOrder/362941?expandSubResources=true", maxRetries: 1,
    }));
  if (so) {
    const keys = Object.keys(so).sort();
    const custbody = keys.filter((k) => k.startsWith("custbody"));
    console.log(`        header custbody fields: ${custbody.length}`);
    console.log(`        url-ish / file-ish header fields: ${
      keys.filter((k) => /url|link|file|doc|attach|sharepoint/i.test(k)).join(", ") || "none"}`);
    const items = (so.item as { items?: Array<Record<string, unknown>> } | undefined)?.items ?? [];
    if (items.length) {
      const lk = Object.keys(items[0]).sort();
      console.log(`        LINE custcol fields: ${lk.filter((k) => k.startsWith("custcol")).join(", ") || "none"}`);
      console.log(`        LINE url/file-ish  : ${lk.filter((k) => /url|link|file|doc|attach/i.test(k)).join(", ") || "none"}`);
    }
  }

  console.log("\n── EXISTING CUSTOM RECORD TYPES (a candidate carrier) ───");
  await ask("suiteQL customrecordtype", () =>
    suiteQL(`select scriptid, name from customrecordtype order by name fetch first 15 rows only`))
    .then((d) => {
      const items = (d as { items?: Array<Record<string, string>> } | null)?.items ?? [];
      for (const r of items) console.log(`        ${r.scriptid}  ${r.name}`);
    });

  process.exit(0);
}

void main();
