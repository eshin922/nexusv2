/**
 * Ordered-spec customization: what an account HAS, read-only. Run once against
 * sandbox and once against production, then compare the two JSON outputs.
 *
 * READ-ONLY BY CONSTRUCTION, independent of NETSUITE_ENV: every request is a
 * GET or the SuiteQL query POST, checked by `isReadOnlyTransport` before it is
 * sent. Nothing is created, changed or deleted in either account. The account
 * id is never printed — only whether it carries a sandbox suffix.
 *
 *   node --env-file=<env> ... netsuite-spec-customization-compare.ts <out.json>
 */
import { writeFileSync } from "node:fs";

import { isReadOnlyTransport, loadNetsuiteConfig, nsRequest } from "@/lib/netsuite/client";

const [, , outPath] = process.argv;
if (!outPath) throw new Error("output JSON path is required");
const cfg = loadNetsuiteConfig();
const kind = /_SB\d+$/i.test(cfg.accountId) ? "sandbox" : "production";

async function read<T>(method: "GET" | "POST", path: string, body?: unknown, headers?: Record<string, string>) {
  if (!isReadOnlyTransport(method, path)) throw new Error(`REFUSED non-read transport ${method} ${path}`);
  return nsRequest<T>({ method, path, body, extraHeaders: headers, maxRetries: 2 });
}
async function probe(name: string, fn: () => Promise<unknown>) {
  try {
    return { name, ok: true, data: await fn() };
  } catch (e) {
    const ctx = (e as { context?: { status?: unknown; detail?: unknown } }).context;
    return { name, ok: false, status: ctx?.status ?? null, detail: String(ctx?.detail ?? e).slice(0, 300) };
  }
}
const sql = (q: string) => read<{ items: Record<string, unknown>[] }>("POST", "/query/v1/suiteql?limit=1000", { q }).then((r) => r.items.map(({ links, ...o }) => o));
const schema = { Accept: "application/schema+json" };

const RECORD = "customrecord_nx_ordered_spec";
const results = [
  await probe("control · item count", () => sql("SELECT COUNT(*) AS n FROM item")),
  await probe("record type row", () =>
    sql(
      `SELECT internalid, scriptid, name, includename, allowattachments, allowinlineediting, allowinlinedeleting, usepermissions, nopermissionrequired, isinactive, lastmodifieddate FROM customrecordtype WHERE scriptid = '${RECORD.toUpperCase()}'`,
    ),
  ),
  await probe("record metadata (fields + REST types)", async () => {
    const md = await read<{ properties?: Record<string, { type?: string; format?: string; title?: string; nullable?: boolean }> }>(
      "GET",
      `/record/v1/metadata-catalog/${RECORD}`,
      undefined,
      schema,
    );
    return Object.fromEntries(
      Object.entries(md.properties ?? {})
        .filter(([k]) => k.startsWith("custrecord_") || ["name", "externalId", "isInactive"].includes(k))
        .map(([k, v]) => [k, `${v.type ?? "object"}${v.format ? "/" + v.format : ""} · ${v.title ?? ""}`]),
    );
  }),
  await probe("record readable via SuiteQL (role grant)", () => sql(`SELECT COUNT(*) AS n FROM ${RECORD}`)),
  await probe("salesOrder line field custcol_nx_ordered_spec", async () => {
    const md = await read<{ properties?: { item?: { properties?: { items?: { items?: { properties?: Record<string, { type?: string; title?: string }> } } } } } }>(
      "GET",
      "/record/v1/metadata-catalog/salesOrder",
      undefined,
      schema,
    );
    const p = md.properties?.item?.properties?.items?.items?.properties ?? {};
    return {
      present: "custcol_nx_ordered_spec" in p,
      definition: p.custcol_nx_ordered_spec ?? null,
      otherNexusLineFields: Object.keys(p).filter((k) => /^custcol_nx/i.test(k)),
    };
  }),
  await probe("salesOrder header field custbody_nexus_order_packet", async () => {
    const md = await read<{ properties?: Record<string, unknown> }>("GET", "/record/v1/metadata-catalog/salesOrder", undefined, schema);
    return { present: "custbody_nexus_order_packet" in (md.properties ?? {}) };
  }),
  await probe("script-id collisions (custom record types named nx / nexus)", () =>
    sql("SELECT scriptid, name FROM customrecordtype WHERE LOWER(scriptid) LIKE '%_nx%' OR LOWER(name) LIKE '%nexus%'"),
  ),
  await probe("roles named Nexus (role grant target)", () => sql("SELECT id, name, scriptid, isinactive FROM role WHERE LOWER(name) LIKE '%nexus%'")),
];

const out = { account: kind, envLabel: cfg.env, generatedAt: new Date().toISOString(), results };
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`account=${kind}`);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : ` — ${r.status} ${r.detail}`}`);
