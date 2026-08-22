/**
 * NetSuite File Cabinet — capability measurement AFTER the Documents and Files
 * grant. SANDBOX ONLY, READ-ONLY.
 *
 * The #338 probes established, post-grant, a split that decides the design:
 *
 *   SuiteQL `file` / `mediaitemfolder`   READABLE  (grant took effect)
 *   REST `/record/v1/file`               404 "Record type 'file' does not exist"
 *
 * Permission can no longer explain the 404 — the same role now reads the File
 * Cabinet freely through SuiteQL. So the REST Record API genuinely does not
 * expose `file` in this account, which is a different problem with a different
 * answer, and it is worth being sure of before designing around it.
 *
 * This measures what IS available: the File Cabinet schema, folder/path
 * behaviour, and whether any native file-to-transaction relationship exists at
 * header or line level.
 */
import { suiteQL } from "@/lib/netsuite/client";
import { NetsuiteError } from "@/lib/netsuite/errors";

type Rows = { items?: Array<Record<string, unknown>> };

async function q(label: string, statement: string): Promise<Rows | null> {
  try {
    const r = (await suiteQL(statement)) as Rows;
    console.log(`  OK    ${label}  (${r.items?.length ?? 0} rows)`);
    return r;
  } catch (e) {
    const d = e instanceof NetsuiteError ? String(e.context.detail) : String(e);
    const kind = /Invalid search type/i.test(d)
      ? "NOT-A-TYPE"
      : /was not found/i.test(d)
        ? "DENIED"
        : "ERROR";
    console.log(`  ${kind.padEnd(5)} ${label}`);
    if (kind === "ERROR") console.log(`        ${d.replace(/\s+/g, " ").slice(0, 130)}`);
    return null;
  }
}

function columns(r: Rows | null): string[] {
  const first = r?.items?.[0];
  return first ? Object.keys(first).filter((k) => k !== "links").sort() : [];
}

async function main() {
  console.log("── FILE CABINET SCHEMA (what a file row actually carries) ───");
  const file = await q("select * from file", `select * from file fetch first 1 rows only`);
  const fileCols = columns(file);
  console.log(`        columns: ${fileCols.join(", ") || "(none)"}`);
  if (file?.items?.[0]) {
    for (const k of ["id", "name", "folder", "filetype", "filesize", "url", "isonline", "createddate"]) {
      if (k in file.items[0]) console.log(`        ${k} = ${String(file.items[0][k]).slice(0, 80)}`);
    }
  }

  console.log("\n── FOLDER / PATH BEHAVIOUR ─────────────────────────────────");
  const folders = await q("select * from mediaitemfolder", `select * from mediaitemfolder fetch first 1 rows only`);
  console.log(`        columns: ${columns(folders).join(", ") || "(none)"}`);
  // Does a folder carry a parent, i.e. is the path a tree we must place into?
  await q(
    "folders with parents",
    `select id, name, parent from mediaitemfolder where parent is not null fetch first 5 rows only`,
  ).then((r) => {
    for (const f of r?.items ?? []) console.log(`        ${f.id} ${f.name} parent=${f.parent}`);
  });
  await q("folder count", `select count(*) as n from mediaitemfolder`).then((r) =>
    console.log(`        total folders: ${r?.items?.[0]?.n}`),
  );

  console.log("\n── IS THERE A NATIVE FILE <-> TRANSACTION RELATIONSHIP? ─────");
  // POSITIVE control: a link table already proven readable, so a wall of
  // NOT-A-TYPE below cannot be blamed on SuiteQL access.
  await q("POSITIVE nexttransactionlinelink", `select * from nexttransactionlinelink fetch first 1 rows only`);
  for (const t of [
    "transactionattachment",
    "entityattachment",
    "mediaitemtransaction",
    "attachment",
    "transactionfile",
    "filetransaction",
    "systemnote",
  ]) {
    await q(t, `select * from ${t} fetch first 1 rows only`);
  }

  console.log("\n── DOES A FILE ROW POINT AT A TRANSACTION AT ALL? ───────────");
  // If the File Cabinet carried a transaction reference, it would be a column
  // on `file`. Reported from the measured column list rather than guessed.
  const txish = fileCols.filter((c) => /trans|record|entity|owner|link|parent/i.test(c));
  console.log(`        transaction-ish columns on file: ${txish.join(", ") || "NONE"}`);

  console.log("\n── SIZE / TYPE CONSTRAINTS VISIBLE IN EXISTING DATA ─────────");
  await q(
    "largest files",
    `select name, filetype, filesize from file order by filesize desc fetch first 5 rows only`,
  ).then((r) => {
    for (const f of r?.items ?? []) console.log(`        ${String(f.filesize).padStart(10)}  ${f.filetype}  ${String(f.name).slice(0, 50)}`);
  });
  await q("distinct file types", `select filetype, count(*) as n from file group by filetype order by n desc fetch first 10 rows only`)
    .then((r) => {
      for (const f of r?.items ?? []) console.log(`        ${String(f.n).padStart(5)}  ${f.filetype}`);
    });
  await q("any PDFs already stored?", `select count(*) as n from file where filetype = 'PDF'`)
    .then((r) => console.log(`        PDFs in the cabinet: ${r?.items?.[0]?.n}`));

  console.log("\n── WHAT THIS LEAVES FOR UPLOAD ─────────────────────────────");
  console.log("  SuiteQL is SELECT-only; it cannot create a file.");
  console.log("  REST /record/v1/file is absent from this account's record API.");
  console.log("  Remaining candidates are SOAP (SuiteTalk `add`) or a RESTlet.");
  process.exit(0);
}

void main();
