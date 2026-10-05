/**
 * NetSuite item-level specification audit — READ-ONLY runner. SANDBOX ONLY.
 *
 * Takes a JSON file of probes and runs each one, recording raw status and
 * NetSuite's error class. Two transports only:
 *
 *   { "q": "label", "get": "/record/v1/..." , "headers"?: {...} }
 *   { "q": "label", "sql": "SELECT ..." , "limit"?: 1000 }
 *
 * Read-only is enforced HERE, before the client's own guard: anything that is
 * not GET or the SuiteQL POST is refused without a request being made. The run
 * also refuses unless the resolved target is a sandbox account.
 *
 *   node --env-file=<env> --experimental-strip-types --conditions=react-server \
 *     --experimental-loader ./scripts/support/src-resolver.mjs \
 *     scripts/gate-1b/netsuite-item-spec-audit.ts probes.json out.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  isReadOnlyTransport,
  loadNetsuiteConfig,
  nsRequest,
} from "@/lib/netsuite/client";
import { NetsuiteError } from "@/lib/netsuite/errors";

type Probe = { q: string; get?: string; sql?: string; limit?: number; headers?: Record<string, string> };

const [, , inPath, outPath] = process.argv;
const probes: Probe[] = JSON.parse(readFileSync(inPath, "utf8"));

const cfg = loadNetsuiteConfig();
if (cfg.env !== "sandbox" || !/_SB\d+$/i.test(cfg.accountId)) {
  console.error("REFUSED: target is not a sandbox account");
  process.exit(2);
}
console.error(`target: sandbox account suffix ${cfg.accountId.replace(/^\d+/, "*")}`);

const out: unknown[] = [];
for (const p of probes) {
  const path = p.get ?? `/query/v1/suiteql?limit=${p.limit ?? 1000}`;
  const method = p.get ? "GET" : "POST";
  if (!isReadOnlyTransport(method, path)) {
    out.push({ q: p.q, refused: "not a read-only transport" });
    continue;
  }
  try {
    const data = await nsRequest({
      method,
      path,
      body: p.sql ? { q: p.sql } : undefined,
      extraHeaders: p.sql ? {} : p.headers,
      maxRetries: 2,
    });
    out.push({ q: p.q, ok: true, data });
    console.error(`ok   ${p.q}`);
  } catch (e) {
    if (e instanceof NetsuiteError) {
      out.push({
        q: p.q,
        ok: false,
        status: e.context.status ?? "-",
        cls: e.className,
        detail: String(e.context.detail ?? "").slice(0, 400),
      });
      console.error(`FAIL ${p.q} ${e.context.status} ${String(e.context.detail ?? "").slice(0, 160)}`);
    } else {
      out.push({ q: p.q, ok: false, error: String(e) });
      console.error(`ERR  ${p.q} ${String(e)}`);
    }
  }
}
writeFileSync(outPath, JSON.stringify(out, null, 1));
