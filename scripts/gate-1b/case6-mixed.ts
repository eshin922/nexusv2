/**
 * Case 6 Mixed — proof harness for 4781e4bb.
 *
 * Run `--before` to snapshot, attach ONE Direct Product through Setup in the
 * operator UI, then run `--after` to prove the five claims.
 *
 * The claims that matter are the NEGATIVE ones: adding a Direct Product must
 * leave the Item Group's members and the existing Direct Service economically
 * untouched, and no cost row may reference a structure it does not belong to.
 * A new product legitimately changes QUOTE totals, so tier rollups are reported
 * as context and never asserted equal — asserting that would be asserting the
 * new product costs nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";

const Q = "4781e4bb-0597-4044-a1ea-3ffc8c3be35a";
const SNAP = "docs/gate-1b/case6-before.json";

type Snap = {
  perSku: Record<string, string>;
  tiers: Record<string, string>;
  ownership: Array<Record<string, unknown>>;
};

async function capture(): Promise<Snap> {
  const r = await getCostingBundle(Q);
  if (!(r as any).ok) throw new Error("bundle failed");
  const c = (r as any).data.costing;
  const perSku: Record<string, string> = {};
  for (const s of c.skuRollups ?? []) {
    // Key on the CANONICAL id, always. Keying on skuLabel collapsed the two
    // grouped members onto one entry — both carry an EMPTY-STRING label, and
    // `??` only falls through on null — so one silently overwrote the other and
    // the byte-identical check ran on a single leaf while appearing to cover
    // both. A map key that can collide cannot certify per-item equality.
    const key = `${s.skuRole}:${s.canonicalQuoteLeafId ?? s.skuId}:${s.skuLabel || "(unnamed)"}`;
    perSku[key] = JSON.stringify(s.perTier ?? []);
  }
  const tiers: Record<string, string> = {};
  for (const t of c.quoteRollup ?? []) tiers[t.label] = JSON.stringify(t);
  const ownership = (await db.execute(sql.raw(
    `select l.sku, coalesce(a.sku,'<DIRECT>') grp, ql.id::text quote_leaf,
            (select count(*) from assembly_leaves al where al.quote_leaf_id=ql.id) junctions,
            (select count(*) from assembly_leaf_inputs i where i.quote_leaf_id=ql.id) cost_rows
       from quote_leaves ql join leaves l on l.id=ql.leaf_id
       left join assemblies a on a.id=ql.assembly_id
      where ql.quote_id='${Q}' order by grp, l.sku`,
  ))) as unknown as Array<Record<string, unknown>>;
  return { perSku, tiers, ownership };
}

let fails = 0;
const claim = (ok: boolean, label: string, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const mode = process.argv.includes("--after") ? "after" : "before";
  const now = await capture();

  if (mode === "before") {
    writeFileSync(SNAP, JSON.stringify(now, null, 2));
    console.log("\nCase 6 BEFORE snapshot written.");
    console.log("  per-SKU rows :", Object.keys(now.perSku).length);
    console.log("  tiers        :", Object.keys(now.tiers).join(", "));
    console.table(now.ownership);
    console.log("\nNow attach ONE Direct Product through Setup, then re-run with --after.\n");
    process.exit(0);
  }

  const before: Snap = JSON.parse(readFileSync(SNAP, "utf8"));
  console.log("\n=== Case 6 Mixed — after ===\n");

  // 1. a Direct Product was actually added (else every other claim is vacuous)
  const newDirect = now.ownership.filter(
    (r) => r.grp === "<DIRECT>" && !before.ownership.some((b) => b.quote_leaf === r.quote_leaf),
  );
  claim(newDirect.length === 1, "exactly one new top-level Direct Product attached",
    newDirect.map((r) => String(r.sku)).join(",") || "none — the run proves nothing");

  // 2. it is genuinely top-level, and authorable
  for (const d of newDirect) {
    claim(Number(d.junctions) === 0, `${d.sku}: no assembly_leaves junction (true Direct)`);
    claim(Number(d.cost_rows) > 0, `${d.sku}: packaging cost rows materialized`, `${d.cost_rows} rows`);
  }

  // 3. Item Group members unchanged, byte-identical
  for (const [k, v] of Object.entries(before.perSku)) {
    if (k.startsWith("assembly:") || !k.includes("SVC-")) {
      if (now.perSku[k] === undefined) { claim(false, `${k} disappeared`); continue; }
      claim(now.perSku[k] === v, `${k} economics byte-identical`);
    }
  }

  // 4. existing Direct Service unchanged
  for (const [k, v] of Object.entries(before.perSku)) {
    if (k.includes("SVC-")) claim(now.perSku[k] === v, `${k} (Direct Service) economics byte-identical`);
  }

  // 5. no cost row crosses structures
  const crossed = (await db.execute(sql.raw(
    `select count(*) n from assembly_leaf_inputs i
       join quote_leaves ql on ql.id = i.quote_leaf_id
      where ql.quote_id='${Q}'
        and ((ql.assembly_id is null and i.assembly_leaf_id is not null)
          or (i.assembly_leaf_id is not null and i.assembly_leaf_id not in (
                select al.id from assembly_leaves al where al.quote_leaf_id = ql.id)))`,
  ))) as unknown as Array<Record<string, string>>;
  claim(crossed[0].n === "0", "no packaging row crosses grouped/top-level ownership");

  console.log("\n  tier rollups (context — a new product SHOULD move these):");
  for (const label of Object.keys(before.tiers)) {
    const b = JSON.parse(before.tiers[label]), a = JSON.parse(now.tiers[label] ?? "{}");
    console.log(`    ${label}: revenue ${b.totalRevenue} -> ${a.totalRevenue}, cost ${b.totalCost} -> ${a.totalCost}`);
  }

  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${fails} failing claim(s)\n`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
