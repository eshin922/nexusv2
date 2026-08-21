/**
 * NetSuite File Cabinet capability probe. SANDBOX ONLY.
 *
 * Establishes what the CURRENT integration role can actually do, rather than
 * what the REST documentation says is possible. Every question is asked against
 * the live provider and answered by its response.
 *
 * ── WHY CONTROLS ─────────────────────────────────────────────────────────
 *
 * A probe that only tries the thing it wants cannot tell "the role may not do
 * this" from "the record type does not exist" from "my request was malformed" —
 * all three arrive as a failure, and the difference decides the whole design.
 * So every capability question is bracketed by:
 *
 *   POSITIVE  a call known to work, proving auth/connectivity/role are live.
 *             Without it, a wall of failures reads as "unsupported" when the
 *             credentials were simply wrong.
 *   NEGATIVE  a call known to be invalid, proving the probe can still FAIL.
 *             Without it, a wall of successes proves nothing about what was
 *             actually exercised.
 *
 * Raw status and NetSuite's own error class are reported for every call.
 *
 * Nothing is deleted unless deletion is proven safe AND the artifact is one this
 * probe created. Uncertainty leaves the artifact in place, named so a human can
 * find it.
 */
import { describeNetsuiteTarget, nsRequest, suiteQL } from "@/lib/netsuite/client";
import { NetsuiteError } from "@/lib/netsuite/errors";

/** The disposable SO created by the earlier precision probe. Not a customer order. */
const DISPOSABLE_SO = "362941";
const TAG = "nexus-file-cabinet-probe";

type Outcome = {
  q: string;
  ok: boolean;
  status: number | string;
  cls: string;
  detail: string;
  data?: unknown;
};
const results: Outcome[] = [];

async function ask(q: string, fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    const data = await fn();
    const o: Outcome = { q, ok: true, status: 200, cls: "-", detail: "ok", data };
    results.push(o);
    return o;
  } catch (e) {
    if (e instanceof NetsuiteError) {
      const o: Outcome = {
        q,
        ok: false,
        status: e.context.status ?? "-",
        cls: e.className,
        detail: String(e.context.detail ?? "").slice(0, 150),
      };
      results.push(o);
      return o;
    }
    const o: Outcome = {
      q,
      ok: false,
      status: "-",
      cls: "throw",
      detail: (e instanceof Error ? e.message : String(e)).slice(0, 150),
    };
    results.push(o);
    return o;
  }
}

function show(o: Outcome) {
  const v = o.ok ? "OK  " : "FAIL";
  console.log(`  ${v} [${String(o.status).padEnd(3)} ${o.cls.padEnd(12)}] ${o.q}`);
  if (!o.ok) console.log(`         ${o.detail}`);
}

async function main() {
  const target = describeNetsuiteTarget();
  console.log("target:", JSON.stringify(target));
  if (!target.accountIsSandbox) {
    console.error("REFUSING — not a sandbox account.");
    process.exit(1);
  }

  // ── CONTROLS ───────────────────────────────────────────────────────────
  console.log("\n── CONTROLS ─────────────────────────────────────────────");
  show(
    await ask("POSITIVE  GET salesOrder/362941 (auth + role live?)", () =>
      nsRequest({ method: "GET", path: `/record/v1/salesOrder/${DISPOSABLE_SO}`, maxRetries: 1 }),
    ),
  );
  show(
    await ask("NEGATIVE  GET record/v1/notARealRecordType (can the probe fail?)", () =>
      nsRequest({ method: "GET", path: "/record/v1/notARealRecordType", maxRetries: 1 }),
    ),
  );
  show(
    await ask("NEGATIVE  POST file with a malformed body", () =>
      nsRequest({
        method: "POST",
        path: "/record/v1/file",
        body: { nonsenseField: TAG },
        maxRetries: 1,
      }),
    ),
  );

  // ── DOES THE RECORD TYPE EXIST FOR THIS ROLE? ──────────────────────────
  console.log("\n── FILE CABINET RECORD TYPES ────────────────────────────");
  show(await ask("GET /record/v1/file (collection)", () =>
    nsRequest({ method: "GET", path: "/record/v1/file?limit=1", maxRetries: 1 })));
  show(await ask("GET /record/v1/folder (collection)", () =>
    nsRequest({ method: "GET", path: "/record/v1/folder?limit=1", maxRetries: 1 })));

  console.log("\n── SUITEQL VISIBILITY ───────────────────────────────────");
  const folders = await ask("SuiteQL: folders", () =>
    suiteQL(`select id, name from mediaitemfolder order by id fetch first 8 rows only`));
  show(folders);
  if (folders.ok) {
    const items = ((folders.data as { items?: Array<Record<string, string>> }).items ?? []);
    for (const f of items) console.log(`         folder ${f.id}  ${f.name}`);
  }
  show(await ask("SuiteQL: file table", () =>
    suiteQL(`select id, name, folder, filetype from file order by id desc fetch first 3 rows only`)));

  // ── CREATE ─────────────────────────────────────────────────────────────
  console.log("\n── CREATE A DISPOSABLE FILE ─────────────────────────────");
  const folderId = (() => {
    if (!folders.ok) return null;
    const items = ((folders.data as { items?: Array<Record<string, string>> }).items ?? []);
    return items.length ? items[0].id : null;
  })();
  console.log(`  using folder id: ${folderId ?? "(none resolved — will try without)"}`);

  const content = Buffer.from(`${TAG}\nDisposable capability probe. Safe to delete.\n`).toString("base64");
  const fileBody: Record<string, unknown> = {
    name: `${TAG}.txt`,
    fileType: "PLAINTEXT",
    contents: content,
    ...(folderId ? { folder: { id: folderId } } : {}),
  };

  const created = await ask("POST /record/v1/file", () =>
    nsRequest({ method: "POST", path: "/record/v1/file", body: fileBody, maxRetries: 1 }));
  show(created);

  // NetSuite returns the new id in a Location header, which nsRequest drops.
  // Recover it by SuiteQL on the name we chose — which also proves the file is
  // queryable, a property the design needs independently.
  const found = await ask("SuiteQL: locate the created file by name", () =>
    suiteQL(`select id, name, folder, filetype, filesize, url from file where name = '${TAG}.txt' order by id desc fetch first 3 rows only`));
  show(found);
  let fileId: string | null = null;
  let filePath: string | null = null;
  if (found.ok) {
    const items = ((found.data as { items?: Array<Record<string, string>> }).items ?? []);
    for (const f of items) {
      console.log(`         file ${f.id}  ${f.name}  folder=${f.folder} type=${f.filetype} size=${f.filesize}`);
      console.log(`              url=${f.url}`);
    }
    if (items.length) { fileId = items[0].id; filePath = items[0].url ?? null; }
  }

  // ── READ BACK ──────────────────────────────────────────────────────────
  if (fileId) {
    console.log("\n── READ BACK / PROVE IDENTITY ───────────────────────────");
    const readBack = await ask(`GET /record/v1/file/${fileId}`, () =>
      nsRequest({ method: "GET", path: `/record/v1/file/${fileId}`, maxRetries: 1 }));
    show(readBack);
    if (readBack.ok) {
      const d = readBack.data as Record<string, unknown>;
      console.log("         keys:", Object.keys(d).slice(0, 18).join(", "));
      for (const k of ["id", "name", "fileType", "fileSize", "folder", "url", "content"]) {
        if (k in d) {
          const v = typeof d[k] === "object" ? JSON.stringify(d[k]) : String(d[k]);
          console.log(`         ${k}: ${v.slice(0, 90)}`);
        }
      }
    }
  }

  // ── DUPLICATE / IDEMPOTENCY ────────────────────────────────────────────
  console.log("\n── DUPLICATE ATTEMPT (same name, same folder) ───────────");
  show(await ask("POST /record/v1/file again with identical body", () =>
    nsRequest({ method: "POST", path: "/record/v1/file", body: fileBody, maxRetries: 1 })));

  // ── SALES ORDER RELATIONSHIPS ──────────────────────────────────────────
  console.log("\n── SALES ORDER RELATIONSHIPS ────────────────────────────");
  const expanded = await ask("GET salesOrder?expandSubResources=true (what sublists exist?)", () =>
    nsRequest({ method: "GET", path: `/record/v1/salesOrder/${DISPOSABLE_SO}?expandSubResources=true`, maxRetries: 1 }));
  show(expanded);
  if (expanded.ok) {
    const d = expanded.data as Record<string, unknown>;
    console.log("         top-level keys:", Object.keys(d).sort().join(", ").slice(0, 700));
    const itemBlock = d.item as { items?: Array<Record<string, unknown>> } | undefined;
    if (itemBlock?.items?.length) {
      console.log("         LINE keys:", Object.keys(itemBlock.items[0]).sort().join(", ").slice(0, 700));
    }
  }

  for (const sub of ["attachedFiles", "file", "mediaItem", "mediaItemList"]) {
    show(await ask(`GET salesOrder/${DISPOSABLE_SO}/${sub} (header sublist?)`, () =>
      nsRequest({ method: "GET", path: `/record/v1/salesOrder/${DISPOSABLE_SO}/${sub}`, maxRetries: 1 })));
  }

  console.log("\n── NATIVE ATTACHMENT RELATIONSHIP (SuiteQL) ─────────────");
  for (const [label, q] of [
    ["transaction<->file link table", `select * from nexttransactionlinelink fetch first 1 rows only`],
    ["mediaitem on transaction", `select id, name from file where id = ${fileId ?? 0}`],
  ] as Array<[string, string]>) {
    show(await ask(`SuiteQL: ${label}`, () => suiteQL(q)));
  }

  // ── DISPOSITION ────────────────────────────────────────────────────────
  console.log("\n── DISPOSITION OF THE PROBE ARTIFACT ────────────────────");
  if (fileId) {
    const del = await ask(`DELETE /record/v1/file/${fileId}`, () =>
      nsRequest({ method: "DELETE", path: `/record/v1/file/${fileId}`, maxRetries: 1 }));
    show(del);
    if (!del.ok) {
      console.log(`         LEFT IN PLACE — file ${fileId} "${TAG}.txt". Named so it is findable.`);
    }
  } else {
    console.log("  no file id resolved; nothing to dispose of.");
  }

  console.log("\n── SUMMARY ──────────────────────────────────────────────");
  console.log(`  calls: ${results.length}   ok: ${results.filter((r) => r.ok).length}   failed: ${results.filter((r) => !r.ok).length}`);
  console.log(`  file cabinet id : ${fileId ?? "(not created)"}`);
  console.log(`  file cabinet url: ${filePath ?? "(none)"}`);
  const byClass = new Map<string, number>();
  for (const r of results.filter((x) => !x.ok)) byClass.set(r.cls, (byClass.get(r.cls) ?? 0) + 1);
  console.log(`  failure classes : ${[...byClass].map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  process.exit(0);
}

void main();
