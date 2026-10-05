/**
 * Scan NetSuite File Cabinet script/template CONTENT for references to the
 * legacy specification fields. READ-ONLY. SANDBOX ONLY.
 *
 * What this can and cannot establish (Pattern 61): it observes text files the
 * integration role can read. Saved searches, workflows, Advanced PDF/HTML
 * templates stored as template records, reports, and script DEPLOYMENT status
 * are outside it. A hit proves a file names a field; it does not prove the
 * file is deployed. No hit proves nothing about the dimensions above.
 */
import { writeFileSync } from "node:fs";
import { isReadOnlyTransport, loadNetsuiteConfig, nsRequest } from "@/lib/netsuite/client";

const cfg = loadNetsuiteConfig();
if (cfg.env !== "sandbox" || !/_SB\d+$/i.test(cfg.accountId)) {
  console.error("REFUSED: target is not a sandbox account");
  process.exit(2);
}
const [, , outPath] = process.argv;

const PATTERN =
  /cust(?:body|col|item|record|entity)_(?:dps|nexus)[a-z0-9_]*|custbody_size\b/gi;

async function get<T>(path: string): Promise<T> {
  if (!isReadOnlyTransport("GET", path)) throw new Error("not read-only");
  return nsRequest<T>({ method: "GET", path, maxRetries: 2 });
}
async function sql(q: string, offset: number) {
  const path = `/query/v1/suiteql?limit=1000&offset=${offset}`;
  if (!isReadOnlyTransport("POST", path)) throw new Error("not read-only");
  return nsRequest<{ items: Record<string, string>[]; hasMore: boolean }>({
    method: "POST",
    path,
    body: { q },
    maxRetries: 2,
  });
}

const Q = `SELECT f.id, f.name, f.folder, f.filetype, f.filesize, f.lastmodifieddate, f.package
  FROM file f
 WHERE f.filetype IN ('JAVASCRIPT','FREEMARKER','XMLDOC','HTMLDOC','PLAINTEXT','JSON','CSV')
   AND f.package IS NULL
   AND f.filesize < 600000
   AND LOWER(f.name) NOT LIKE '%.min.js'
 ORDER BY f.id`;

const files: Record<string, string>[] = [];
for (let off = 0; ; off += 1000) {
  const page = await sql(Q, off);
  files.push(...page.items);
  if (!page.hasMore) break;
}
console.error(`candidate files: ${files.length}`);

const hits: unknown[] = [];
const failures: unknown[] = [];
let scanned = 0;
for (const f of (process.env.SCAN_LIMIT ? files.slice(0, Number(process.env.SCAN_LIMIT)) : files)) {
  try {
    const content = await get<string>(`/document/v1/file/${f.id}/content`);
    const text = typeof content === "string" ? content : JSON.stringify(content);
    const found = [...new Set((text.match(PATTERN) ?? []).map((s) => s.toLowerCase()))];
    if (found.length) {
      hits.push({ id: f.id, name: f.name, folder: f.folder, type: f.filetype, modified: f.lastmodifieddate, fields: found.sort() });
    }
    scanned++;
  } catch (e) {
    const err = e as { context?: { status?: unknown; detail?: unknown } };
    failures.push({ id: f.id, name: f.name, error: String(e).slice(0, 200), status: err.context?.status, detail: String(err.context?.detail ?? "").slice(0, 200) });
    if (failures.length <= 3) console.error("fail", f.id, f.name, JSON.stringify(failures[failures.length - 1]));
  }
  if (scanned % 100 === 0 && scanned > 0) console.error(`scanned ${scanned}`);
}
writeFileSync(outPath, JSON.stringify({ candidates: files.length, scanned, failures, hits }, null, 1));
console.error(`done: scanned=${scanned} failures=${failures.length} hits=${hits.length}`);
