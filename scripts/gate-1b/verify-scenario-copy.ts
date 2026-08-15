/**
 * Scenario Copy acceptance.
 *
 * The contract: a copy is an editable ALTERNATIVE whose initial working
 * commercial state is EQUIVALENT to the source. Immediately after the copy and
 * before any operator edit, cost / sell / revenue / margin must match at every
 * tier.
 *
 * ── WHY THE ECONOMIC COMPARISON IS A MULTISET ────────────────────────────────
 *
 * `skuRollups` is index-keyed, so a copy that reproduces every value but orders
 * products differently walks as a difference at every index while being
 * commercially identical. Comparing path-tagged numeric leaves as multisets, with
 * array indices erased, answers "did any NUMBER move" rather than "did anything
 * shift position" — which are different questions, and only the first one is
 * about money. Same instrument as confirm-s7-delta.ts, for the same reason.
 *
 * Float noise is tolerated at 1e-9 RELATIVE, because IEEE-754 addition is not
 * associative and the same total accumulated in a different row order differs in
 * the last bit. Nothing a human would call a price change hides under that.
 *
 * ── FIXTURES ─────────────────────────────────────────────────────────────────
 *
 * SOURCE is `2f29af72` — READ-ONLY evidence, and never written here; a copy
 * reads its source. It is used because it is the only quote carrying the full
 * coverage this defect needs: grouped AND Direct products, plus canonical-only
 * economic rows (assembly_leaf_id NULL) which are precisely what the old
 * legacy-keyed SELECT could not see.
 *
 * Every quote this script CREATES is labelled `ZZ-VALIDATION-copy-*`. That
 * namespace is excluded from the S-7 basket by basket.ts, so an acceptance run
 * cannot pollute the preservation baseline — which is exactly how the earlier
 * "Copy of Cert mixed" / "Alt 1" copies got in, since they were not namespaced.
 * All created quotes are deleted at the end regardless of outcome.
 */
import { sql, eq, and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { getCostingBundle } from "@/app/actions/costing";
import { cloneQuoteGraph } from "@/app/actions/quotes";
import { quotes, quoteLeaves, quoteTiers, assemblies } from "@/db/schema";
import type { QuoteCostingResult } from "@/lib/costing";

const SOURCE_ID = "2f29af72-805b-446c-866c-73e9b0991b1a";
const NOISE = 1e-9;
const isNoise = (x: number, y: number) =>
  x === y || Math.abs(x - y) <= NOISE * Math.max(1, Math.abs(x), Math.abs(y));

const created: string[] = [];
let failures = 0;
let checks = 0;

function claim(ok: boolean, label: string, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Every numeric leaf, path-tagged, array indices erased. */
function numerics(node: unknown, path: string, out: Map<string, number[]>) {
  if (typeof node === "number") {
    (out.get(path) ?? out.set(path, []).get(path)!).push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) numerics(v, `${path}[]`, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>))
      numerics(v, path ? `${path}.${k}` : k, out);
  }
}

type Costing = QuoteCostingResult;

async function economics(quoteId: string) {
  const res = await getCostingBundle(quoteId);
  if (!res.ok) throw new Error(`getCostingBundle failed for ${quoteId}`);
  const costing = res.data.costing;
  const out = new Map<string, number[]>();
  numerics(costing as unknown, "costing", out);
  return { paths: out, costing };
}

/**
 * The tier economics, read straight off `quoteRollup` rather than off the path
 * walk.
 *
 * A SECOND, INDEPENDENT AGGREGATION of the same quantities is also taken, by
 * summing the top-level SKU rows. The two have to agree on each side, which is
 * what makes "the totals match" a falsification rather than a restatement: a
 * compensating pair of per-SKU errors moves the re-aggregation and not the
 * engine's own total, and only comparing both can see it.
 */
function tierEconomics(c: Costing) {
  return c.quoteRollup.map((t, i) => {
    let revenue = 0;
    let cost = 0;
    for (const s of c.skuRollups) {
      if (s.parentSkuId !== null) continue;
      const pt = s.perTier.find((p) => p.tierId === t.tierId);
      if (!pt) continue;
      revenue += pt.revenue;
      cost += pt.cost;
    }
    return {
      label: t.label ?? `tier ${i}`,
      tierId: t.tierId,
      revenue: t.totalRevenue,
      cost: t.totalCost,
      margin: t.blendedMarginPct,
      resummedRevenue: revenue,
      resummedCost: cost,
    };
  });
}

/** Returns the paths whose numeric multiset genuinely moved. */
function movedPaths(a: Map<string, number[]>, b: Map<string, number[]>) {
  const moved: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = [...(a.get(key) ?? [])].sort((m, n) => m - n);
    const y = [...(b.get(key) ?? [])].sort((m, n) => m - n);
    if (x.length !== y.length) {
      moved.push(`${key} (count ${x.length}→${y.length})`);
      continue;
    }
    for (let i = 0; i < x.length; i++) {
      if (!isNoise(x[i], y[i])) {
        moved.push(`${key} (${x[i]} → ${y[i]})`);
        break;
      }
    }
  }
  return moved;
}

/** Structure as a comparable, identity-free shape. */
async function structure(quoteId: string) {
  const rows = await db.execute(sql`
    select coalesce(a.sku,'<direct>') as grp,
           a.position as grp_pos,
           l.sku as leaf_sku,
           ql.quantity::text as qty,
           ql.position as pos,
           (ql.assembly_id is null) as is_direct
      from quote_leaves ql
      join leaves l on l.id = ql.leaf_id
      left join assemblies a on a.id = ql.assembly_id
     where ql.quote_id = ${quoteId}
     order by is_direct, grp_pos nulls first, grp, pos, leaf_sku
  `);
  return rows as unknown as Record<string, unknown>[];
}

async function tiersOf(quoteId: string) {
  const rows = await db
    .select({ label: quoteTiers.label, qty: quoteTiers.qty, sort: quoteTiers.sortOrder })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, quoteId));
  return rows.sort((a, b) => a.sort - b.sort);
}

/**
 * Exercises `cloneQuoteGraph` inside a transaction rather than calling
 * `copyScenarioWithinProject`.
 *
 * Not a convenience: the action calls `ensureUser()`, and Clerk's `auth()` reads
 * `headers()`, which does not exist outside a request scope — the action is
 * unreachable from a script at all. `cloneQuoteGraph` IS the unit that carried
 * the defect; the wrapper adds only the audit row and the optional family drop,
 * neither of which is under test. The wrapper's own transaction handling is
 * what Phase 3 falsifies.
 */
async function copyOf(sourceId: string, label: string) {
  const [meta] = await db
    .select({ projectId: quotes.projectId, createdBy: quotes.createdByUserId })
    .from(quotes)
    .where(eq(quotes.id, sourceId))
    .limit(1);
  let newId = "";
  await db.transaction(async (tx) => {
    const r = await cloneQuoteGraph(tx, {
      sourceQuoteId: sourceId,
      targetProjectId: meta.projectId,
      newScenarioLabel: label,
      intentNote: null,
      customerTargetTierLabel: null,
      createdByUserId: meta.createdBy!,
    });
    newId = r.newQuoteId;
  });
  created.push(newId);
  return newId;
}

async function cleanup() {
  if (created.length === 0) return;
  await db.transaction(async (tx) => {
    // Safety conditions re-asserted INSIDE the transaction rather than trusted
    // from the read that authorized the delete — a separate read is a separate
    // moment, and this one deletes.
    const victims = await tx
      .select({ id: quotes.id, label: quotes.scenarioLabel, status: quotes.status })
      .from(quotes)
      .where(inArray(quotes.id, created));
    const safe = victims
      .filter((v) => v.label?.startsWith("ZZ-VALIDATION-copy-") && v.status === "draft")
      .map((v) => v.id);
    const refused = victims.filter((v) => !safe.includes(v.id));
    if (refused.length > 0) {
      console.log(`  !! refused to delete ${refused.length} quote(s) failing the safety condition`);
    }
    if (safe.length > 0) await tx.delete(quotes).where(inArray(quotes.id, safe));
    console.log(`\ncleanup: deleted ${safe.length} acceptance quote(s)`);
  });
}

async function main() {
  console.log("\n=== Scenario Copy acceptance ===\n");

  // ── Phase 1 · economic equivalence, source → copy ─────────────────────────
  console.log("Phase 1 · source → copy");
  const srcStruct = await structure(SOURCE_ID);
  const srcTiers = await tiersOf(SOURCE_ID);
  const srcEcon = await economics(SOURCE_ID);

  const copyId = await copyOf(SOURCE_ID, "ZZ-VALIDATION-copy-acceptance");
  const cpyStruct = await structure(copyId);
  const cpyTiers = await tiersOf(copyId);
  const cpyEcon = await economics(copyId);

  claim(
    srcStruct.length === cpyStruct.length,
    "every source product appears exactly once in the copy",
    `${srcStruct.length} → ${cpyStruct.length}`,
  );
  claim(
    JSON.stringify(srcStruct) === JSON.stringify(cpyStruct),
    "Direct/grouped placement, ordering and quantities match",
  );
  claim(
    JSON.stringify(srcTiers) === JSON.stringify(cpyTiers),
    "tiers and tier quantities match",
    JSON.stringify(cpyTiers.map((t) => `${t.label}:${t.qty}`)),
  );
  const srcDirect = srcStruct.filter((r) => r.is_direct === true).length;
  claim(
    srcDirect > 0 && cpyStruct.filter((r) => r.is_direct === true).length === srcDirect,
    "Direct products enumerated and cloned (the gap)",
    `${srcDirect} direct`,
  );

  // ── economic equivalence, in the two questions it is actually made of ─────
  //
  // This was ONE claim comparing every numeric leaf in `costing` as a multiset,
  // and it could not distinguish money moving from freight being ATTRIBUTED to
  // a different product. Pattern 58 makes that distinction load-bearing: the
  // anchor may move attribution and must never move arithmetic, so an
  // instrument that fails on both cannot certify either.
  //
  // It is a real distinction here, not a convenient one. Source quote 2f29af72
  // has three leaves sharing position 0 in one assembly, so "the lowest-position
  // leaf" is a tie, and source and copy break it differently — deterministically
  // on each side (measured: five consecutive reads of each are identical), just
  // not identically to each other. The freight AMOUNTS are unchanged; which
  // product carries them is not.
  //
  // So the questions are separated, and each is asserted where it is true.
  const srcTiers2 = tierEconomics(srcEcon.costing);
  const cpyTiers2 = tierEconomics(cpyEcon.costing);
  const tierMoved: string[] = [];
  for (let i = 0; i < Math.max(srcTiers2.length, cpyTiers2.length); i++) {
    const a = srcTiers2[i];
    const b = cpyTiers2[i];
    if (!a || !b) {
      tierMoved.push(`tier ${i} present on one side only`);
      continue;
    }
    for (const f of ["revenue", "cost", "margin"] as const) {
      const x = a[f];
      const y = b[f];
      if (x === null || y === null) {
        if (x !== y) tierMoved.push(`${a.label}.${f} (${x} → ${y})`);
        continue;
      }
      if (!isNoise(x, y)) tierMoved.push(`${a.label}.${f} (${x} → ${y})`);
    }
  }
  claim(
    tierMoved.length === 0,
    "cost / sell / revenue / margin identical at every tier",
    tierMoved.length ? tierMoved.join("; ") : srcTiers2.map((t) => `${t.label}:${t.revenue}`).join(" "),
  );

  // The independent re-aggregation, on BOTH sides. Without this the claim above
  // compares one engine total to another engine total, and a per-SKU
  // redistribution that did not conserve the total would still have to pass
  // through `quoteRollup` to be seen. This sees it from the other end.
  const resumOff: string[] = [];
  for (const [tag, rows] of [["source", srcTiers2], ["copy", cpyTiers2]] as const)
    for (const t of rows) {
      if (!isNoise(t.revenue, t.resummedRevenue))
        resumOff.push(`${tag} ${t.label} revenue ${t.revenue} vs ${t.resummedRevenue}`);
      if (!isNoise(t.cost, t.resummedCost))
        resumOff.push(`${tag} ${t.label} cost ${t.cost} vs ${t.resummedCost}`);
    }
  claim(
    resumOff.length === 0,
    "per-product rows re-aggregate to the tier totals on both sides",
    resumOff.length ? resumOff.join("; ") : "two independent aggregations agree",
  );

  // Everything OUTSIDE the per-product rows and the node graph still has to be
  // bit-for-bit equal as a multiset. Narrowing the exclusion to those two
  // subtrees keeps the original instrument's reach over the rest of `costing`.
  const moved = movedPaths(srcEcon.paths, cpyEcon.paths);
  const attributionScoped = (p: string) =>
    p.startsWith("costing.skuRollups") || p.startsWith("costing.graph");
  const movedElsewhere = moved.filter((p) => !attributionScoped(p));
  claim(
    movedElsewhere.length === 0,
    "no number moved outside per-product attribution",
    movedElsewhere.length ? movedElsewhere.slice(0, 6).join("; ") : "no numeric moved",
  );

  // And the freight itself is UNCHANGED — same amounts, as a multiset over
  // products, whichever product each one landed on. This is what makes the
  // exclusion above safe rather than merely convenient: if the anchor move had
  // altered a freight figure instead of relocating it, the multiset would differ and
  // this claim would fail while the two above still passed.
  const freightMultiset = (c: Costing) => {
    const out: number[] = [];
    for (const s of c.skuRollups)
      for (const pt of s.perTier)
        out.push(
          Number(
            (
              pt.totalContainerFreightBeforeMarkup + pt.totalDutyTariffBeforeMarkup
            ).toFixed(9),
          ),
        );
    return out.sort((m, n) => m - n);
  };
  const fSrc = freightMultiset(srcEcon.costing);
  const fCpy = freightMultiset(cpyEcon.costing);
  claim(
    fSrc.length === fCpy.length && fSrc.every((v, i) => isNoise(v, fCpy[i])),
    "freight amounts unchanged — only which product carries them may differ",
    `${fSrc.filter((v) => v !== 0).length} bearing product-tier cell(s)`,
  );

  // Canonical-only rows are the ones the legacy-keyed SELECT could not see.
  const canon = await db.execute(sql`
    select
      (select count(*) from assembly_leaf_inputs i join quote_leaves ql on ql.id=i.quote_leaf_id
        where ql.quote_id = ${SOURCE_ID} and i.assembly_leaf_id is null) as src_canon_only,
      (select count(*) from assembly_leaf_inputs i join quote_leaves ql on ql.id=i.quote_leaf_id
        where ql.quote_id = ${copyId} and i.assembly_leaf_id is null) as cpy_canon_only,
      (select count(*) from assembly_leaf_inputs i join quote_leaves ql on ql.id=i.quote_leaf_id
        where ql.quote_id = ${SOURCE_ID}) as src_inputs,
      (select count(*) from assembly_leaf_inputs i join quote_leaves ql on ql.id=i.quote_leaf_id
        where ql.quote_id = ${copyId}) as cpy_inputs,
      (select count(*) from assembly_production_inputs p join assemblies a on a.id=p.assembly_id
        where a.quote_id = ${SOURCE_ID}) as src_prod,
      (select count(*) from assembly_production_inputs p join assemblies a on a.id=p.assembly_id
        where a.quote_id = ${copyId}) as cpy_prod
  `) as unknown as Record<string, string>[];
  const c = canon[0];
  claim(
    Number(c.src_canon_only) > 0 && c.src_canon_only === c.cpy_canon_only,
    "canonical-only (assembly_leaf_id NULL) cost rows copied",
    `${c.src_canon_only} → ${c.cpy_canon_only}`,
  );
  claim(c.src_inputs === c.cpy_inputs, "packaging rows copied", `${c.src_inputs} → ${c.cpy_inputs}`);
  claim(c.src_prod === c.cpy_prod, "production rows copied", `${c.src_prod} → ${c.cpy_prod}`);

  // Specs must be quote-owned and distinct rows carrying the SOURCE's values.
  const specs = await db.execute(sql`
    select
      (select count(*) from quote_leaves ql where ql.quote_id=${copyId}
         and ql.leaf_spec_version_id is null) as unpinned,
      (select count(*) from quote_leaves a join quote_leaves b
         on a.leaf_spec_version_id = b.leaf_spec_version_id
        where a.quote_id=${copyId} and b.quote_id=${SOURCE_ID}) as shared_authority
  `) as unknown as Record<string, string>[];
  claim(specs[0].unpinned === "0", "every copied product carries a pinned spec authority");
  claim(
    specs[0].shared_authority === "0",
    "copy owns its spec rows (no shared authority with source)",
  );

  // ── Identity leakage ──────────────────────────────────────────────────────
  const leak = await db.execute(sql`
    select count(*) as n from assembly_leaf_inputs i
     where i.quote_leaf_id in (select id from quote_leaves where quote_id = ${copyId})
       and (i.tier_id not in (select id from quote_tiers where quote_id = ${copyId})
            or (i.assembly_leaf_id is not null and i.assembly_leaf_id not in (
                  select al.id from assembly_leaves al
                    join assemblies a on a.id = al.assembly_id
                   where a.quote_id = ${copyId})))
  `) as unknown as Record<string, string>[];
  claim(leak[0].n === "0", "copied dependents reference destination identities only");

  // ── Phase 2 · bidirectional independence ──────────────────────────────────
  // Run between two COPIES, because the source is read-only evidence and this
  // check must mutate both sides.
  console.log("\nPhase 2 · independence (copy ↔ copy-of-copy)");
  const copy2Id = await copyOf(copyId, "ZZ-VALIDATION-copy-isolation");
  const before2 = await economics(copy2Id);
  const before1 = await economics(copyId);

  await db.execute(sql`
    update assembly_leaf_inputs set unit_cost = coalesce(unit_cost,0) + 1
     where quote_leaf_id in (select id from quote_leaves where quote_id = ${copyId})
  `);
  claim(
    movedPaths(before2.paths, (await economics(copy2Id)).paths).length === 0,
    "mutating the copy leaves the other scenario unchanged",
  );

  await db.execute(sql`
    update assembly_leaf_inputs set unit_cost = coalesce(unit_cost,0) + 1
     where quote_leaf_id in (select id from quote_leaves where quote_id = ${copy2Id})
  `);
  const after1 = await economics(copyId);
  const moved1 = movedPaths(before1.paths, after1.paths);
  claim(
    moved1.length > 0,
    "control: the first mutation did move that scenario's own economics",
    `${moved1.length} path(s)`,
  );

  // ── Phase 3 · rollback ────────────────────────────────────────────────────
  // Falsifies the one property a static read cannot settle: that no write in
  // the clone escapes the caller's transaction onto the ambient connection.
  console.log("\nPhase 3 · rollback");
  const [{ n: qBefore }] = (await db.execute(
    sql`select count(*)::text as n from quotes`,
  )) as unknown as Record<string, string>[];
  const [meta] = await db
    .select({ projectId: quotes.projectId, createdBy: quotes.createdByUserId })
    .from(quotes)
    .where(eq(quotes.id, SOURCE_ID))
    .limit(1);
  const srcCreatedBy = meta.createdBy;
  let aborted = false;
  try {
    await db.transaction(async (tx) => {
      await cloneQuoteGraph(tx, {
        sourceQuoteId: SOURCE_ID,
        targetProjectId: meta.projectId,
        newScenarioLabel: "ZZ-VALIDATION-copy-rollback",
        intentNote: null,
        customerTargetTierLabel: null,
        createdByUserId: srcCreatedBy!,
      });
      throw new Error("forced failure mid-clone");
    });
  } catch {
    aborted = true;
  }
  const [{ n: qAfter }] = (await db.execute(
    sql`select count(*)::text as n from quotes`,
  )) as unknown as Record<string, string>[];
  const [{ n: orphans }] = (await db.execute(
    sql`select count(*)::text as n from quotes where scenario_label = 'ZZ-VALIDATION-copy-rollback'`,
  )) as unknown as Record<string, string>[];
  claim(aborted, "forced mid-clone failure propagates");
  claim(qBefore === qAfter, "quote count unchanged after abort", `${qBefore} → ${qAfter}`);
  claim(orphans === "0", "zero destination scenario survives the abort");

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} claims\n`);
}

main()
  .then(cleanup, async (e) => {
    console.error("\nERROR:", e?.message ?? e);
    failures++;
    await cleanup();
  })
  .then(() => process.exit(failures === 0 ? 0 : 1));
