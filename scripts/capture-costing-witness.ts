/**
 * Costing witness — a before/after economics digest for migrations.
 *
 * NOT S-7. That gate compares against a governed baseline captured months ago
 * over live quotes, and is red on untouched main for unrelated data drift. This
 * captures the CURRENT state to a file and is compared only against another
 * capture from this same script, so the only thing it can report is movement
 * caused by the change under test.
 *
 * Usage:
 *   node --env-file-if-exists=.env.local --experimental-strip-types \
 *     --conditions=react-server \
 *     --experimental-loader ./scripts/support/src-resolver.mjs \
 *     scripts/capture-costing-witness.ts <out.json> [--compare <before.json>]
 *
 * Captures every quote, not only those carrying the economics under test: a
 * migration that moves a number on a quote nobody predicted is exactly the
 * result worth having, and restricting the population to the expected one
 * would hide it.
 *
 * The payload is the whole computed result — quote, firmSettings, tiers,
 * skuRollups, quoteRollup, quoteSummary — deliberately rather than a chosen
 * subset. A subset is a prediction about which numbers matter.
 *
 * `policySource` is captured alongside the digest because a migration can hold
 * every number still while changing WHERE the policy came from, and that
 * transition is itself the thing being proven in the pin backfill.
 *
 * ── PRODUCTION OWNERSHIP (Stage 3 A) ──────────────────────────────────────
 *
 * The costing digest alone cannot see an OWNERSHIP change that leaves every
 * total intact — which is precisely what Stage 3 A risks, since it relaxes
 * `assembly_production_inputs.assembly_id` to nullable and adds a second
 * possible owner. "Exact reconciliation is necessary but not sufficient": a
 * value can move to a different owner and still sum correctly.
 *
 * So the witness also captures, per production row, its OWNER and a digest of
 * its VALUES, keyed by row id. After the migration the same row must have the
 * same owner and the same values — an assertion the costing digest cannot
 * make on its own.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { canonical } from "./gate-1b/canonical-digest.ts";
import { resolveQuoteCommercialSettings } from "@/lib/commercial-settings";

type Entry = {
  digest: string;
  policySource: string;
  status: string;
  label: string;
  /** `section=RungLabel@value`, e.g. `prod=Production default@0.4`. */
  rungs?: string[];
};

const out = process.argv[2];
if (!out || out.startsWith("--")) {
  throw new Error("usage: capture-costing-witness.ts <out.json> [--compare <before.json>]");
}
const cmpIdx = process.argv.indexOf("--compare");
const comparePath = cmpIdx > -1 ? process.argv[cmpIdx + 1] : null;

const quotes = (await db.execute(sql`
  select q.id::text id, q.status, q.scenario_label lbl, p.deal_name dn
    from quotes q join projects p on p.id = q.project_id
   order by q.id::text
`)) as unknown as { id: string; status: string; lbl: string; dn: string }[];

const entries: Record<string, Entry> = {};
let failed = 0;
for (const q of quotes) {
  const label = `${q.dn} / ${q.lbl}`;
  let policySource = "unknown";
  try {
    policySource = (await resolveQuoteCommercialSettings(q.id)).source;
  } catch (e) {
    policySource = `ERROR:${e instanceof Error ? e.message.slice(0, 60) : "?"}`;
  }
  const res = await getCostingBundle(q.id);
  if (!res.ok) {
    failed += 1;
    entries[q.id] = {
      digest: `ERROR:${res.error.code}`,
      policySource,
      status: q.status,
      label,
      rungs: [],
    };
    continue;
  }
  const c = res.data.costing as Record<string, unknown>;

  // ── BV-013 · which AUTHORITY priced each section ───────────────────────
  //
  // A digest of totals cannot see this. Production resolving through `Other`
  // and Production resolving through `Production` produce the SAME number
  // while both categories sit at 0.30 — which is the situation today, and
  // exactly the coincidence BV-013 removes. "Exact reconciliation is
  // necessary but not sufficient": the rung is the attribution half.
  //
  // Read off the engine's own resolution operand, never re-derived. A witness
  // that recomputed the ladder would agree with a broken ladder.
  const rungs = new Set<string>();
  const seenNodes = new Set<unknown>();
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 10) return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const n = node as Record<string, unknown>;
    if (n.kind === "markup" && typeof n.key === "string") {
      // Node keys are `<skuId>/<tierId>/<section>[/<lineId>]`. Strip the
      // UUIDs so the tally is per SECTION rather than per cell — otherwise
      // every one of thousands of cells is its own line and the pattern the
      // rung capture exists to show is invisible.
      const section =
        n.key
          .split("/")
          .filter((seg) => !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg))
          .join("/") || "?";
      const operands = Array.isArray(n.operands) ? n.operands : [];
      const resolution = operands[1] as Record<string, unknown> | undefined;
      const candidates = Array.isArray(resolution?.candidates)
        ? (resolution!.candidates as Record<string, unknown>[])
        : [];
      const chosen = candidates.find((x) => x.chosen === true);
      rungs.add(`${section}=${String(chosen?.label ?? "NONE")}@${String(chosen?.value ?? "-")}`);
    }
    for (const k of Object.keys(n)) walk(n[k], depth + 1);
  };
  walk(c, 0);
  const payload = {
    quote: c.quote,
    firmSettings: c.firmSettings,
    tiers: c.tiers,
    skuRollups: c.skuRollups,
    quoteRollup: c.quoteRollup,
    quoteSummary: c.quoteSummary,
  };
  entries[q.id] = {
    digest: createHash("sha256").update(canonical(payload)).digest("hex"),
    policySource,
    status: q.status,
    label,
    rungs: [...rungs].sort(),
  };
}

// ── production ownership ─────────────────────────────────────────────────
//
// Keyed by row id so a moved value is detectable as a CHANGED row rather than
// as a coincidentally-equal total. Every monetary column is included; adding
// one later changes the digest, which is the correct alarm.
const prodRows = (await db.execute(sql`
  select api.id::text id,
         api.assembly_id::text assembly_id,
         a.quote_id::text quote_id,
         coalesce(api.filling_blending_cost::text,'~')  a1,
         coalesce(api.cm_assembly_total::text,'~')      a2,
         coalesce(api.setup_fee_total::text,'~')        a3,
         coalesce(api.tooling_artwork_total::text,'~')  a4,
         coalesce(api.rd_total::text,'~')               a5,
         coalesce(api.other_service_total::text,'~')    a6,
         coalesce(api.bulk_raw_cost::text,'~')          a7,
         api.customer_ships_raws::text                  p1,
         api.allocate_service_fees_to_cost::text        p2
    from assembly_production_inputs api
    left join assemblies a on a.id = api.assembly_id
   order by api.id::text
`)) as unknown as Record<string, string | null>[];

const production: Record<string, { owner: string; quoteId: string | null; values: string }> = {};
for (const r of prodRows) {
  production[r.id!] = {
    // "assembly:<id>" today; Stage 3 A introduces "leaf:<id>". Encoding the
    // KIND of owner means a silent re-parenting cannot look like an id change.
    owner: r.assembly_id ? `assembly:${r.assembly_id}` : "NONE",
    quoteId: r.quote_id ?? null,
    values: [r.a1, r.a2, r.a3, r.a4, r.a5, r.a6, r.a7, r.p1, r.p2].join("|"),
  };
}
const productionDigest = createHash("sha256")
  .update(
    Object.keys(production)
      .sort()
      .map((k) => `${k}|${production[k].owner}|${production[k].values}`)
      .join("\n"),
  )
  .digest("hex");
const quotesWithProduction = [
  ...new Set(Object.values(production).map((p) => p.quoteId).filter(Boolean)),
].sort();

const global = createHash("sha256")
  .update(Object.keys(entries).sort().map((k) => `${k}|${entries[k].digest}`).join("\n"))
  .digest("hex");

writeFileSync(
  out,
  JSON.stringify(
    {
      count: quotes.length,
      failed,
      global,
      productionDigest,
      quotesWithProduction,
      entries,
      production,
    },
    null,
    2,
  ) + "\n",
);
console.log(`WITNESS quotes=${quotes.length} failed=${failed}`);
console.log(`WITNESS global ${global}`);
console.log(
  `WITNESS production rows=${Object.keys(production).length} quotes=${quotesWithProduction.length}`,
);
console.log(`WITNESS productionDigest ${productionDigest}`);

const rungTally: Record<string, number> = {};
for (const e of Object.values(entries)) {
  for (const r of e.rungs ?? []) rungTally[r] = (rungTally[r] ?? 0) + 1;
}
for (const [r, n] of Object.entries(rungTally).sort()) console.log(`WITNESS rung ${r}: ${n}`);

const bySource: Record<string, number> = {};
for (const e of Object.values(entries)) bySource[e.policySource] = (bySource[e.policySource] ?? 0) + 1;
for (const [s, n] of Object.entries(bySource).sort()) console.log(`WITNESS source ${s}: ${n}`);

if (comparePath) {
  const before = JSON.parse(readFileSync(comparePath, "utf8")) as {
    global: string;
    entries: Record<string, Entry>;
    productionDigest?: string;
    production?: Record<string, { owner: string; quoteId: string | null; values: string }>;
  };
  const moved: string[] = [];
  const sourceChanged: string[] = [];
  for (const [id, now] of Object.entries(entries)) {
    const was = before.entries[id];
    if (!was) { moved.push(`${id} ADDED`); continue; }
    if (was.digest !== now.digest) moved.push(`${now.label} [${now.status}]`);
    if (was.policySource !== now.policySource) {
      sourceChanged.push(`${now.label}: ${was.policySource} -> ${now.policySource}`);
    }
  }
  for (const id of Object.keys(before.entries)) if (!entries[id]) moved.push(`${id} REMOVED`);
  console.log("");
  console.log(`COMPARE global before ${before.global}`);
  console.log(`COMPARE global after  ${global}`);
  console.log(`COMPARE economics moved: ${moved.length}`);
  for (const m of moved.slice(0, 20)) console.log(`   MOVED ${m}`);
  const rungChanged: string[] = [];
  for (const [id, now] of Object.entries(entries)) {
    const was = before.entries[id];
    if (!was) continue;
    const a = (was.rungs ?? []).join(",");
    const b = (now.rungs ?? []).join(",");
    if (a !== b) rungChanged.push(`${now.label} [${now.status}]: ${a || "-"} -> ${b || "-"}`);
  }
  console.log(`COMPARE markup authority changed: ${rungChanged.length}`);
  for (const r of rungChanged.slice(0, 30)) console.log(`   RUNG ${r}`);

  console.log(`COMPARE policy source changed: ${sourceChanged.length}`);
  for (const s of sourceChanged.slice(0, 20)) console.log(`   SOURCE ${s}`);

  // Ownership is checked SEPARATELY from economics, because the whole risk of
  // Stage 3 A is a row that keeps its value and changes hands.
  if (before.production) {
    const reowned: string[] = [];
    const revalued: string[] = [];
    const vanished: string[] = [];
    for (const [id, was] of Object.entries(before.production)) {
      const now = production[id];
      if (!now) { vanished.push(id); continue; }
      if (now.owner !== was.owner) reowned.push(`${id}: ${was.owner} -> ${now.owner}`);
      if (now.values !== was.values) revalued.push(`${id}: ${was.values} -> ${now.values}`);
    }
    const added = Object.keys(production).filter((id) => !(id in before.production!));
    console.log(`COMPARE production digest ${before.productionDigest === productionDigest ? "UNCHANGED" : "CHANGED"}`);
    console.log(`COMPARE production re-owned: ${reowned.length}`);
    for (const r of reowned.slice(0, 20)) console.log(`   REOWNED ${r}`);
    console.log(`COMPARE production re-valued: ${revalued.length}`);
    for (const r of revalued.slice(0, 20)) console.log(`   REVALUED ${r}`);
    console.log(`COMPARE production removed: ${vanished.length} added: ${added.length}`);
  }
}
process.exit(0);
