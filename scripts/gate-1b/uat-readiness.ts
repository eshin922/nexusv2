/**
 * Accounting UAT readiness — what exists, what is mapped, what is missing.
 * READ ONLY.
 *
 * Written so the UAT matrix is grounded in the actual state of the lineage and
 * the destination map rather than in what a plan assumes exists. Every "blocked
 * on" line in the plan should trace to a row printed here.
 */
import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  assemblies,
  leaves as libraryLeaves,
  netsuiteDestinationItemMap,
  netsuiteServiceItemMap,
  projects,
  quoteLeaves,
  quotes,
} from "@/db/schema";

const LINEAGE = "d9dc519a-9965-4dd2-8b4a-f48cf2bf5a7a";

// ── 1 · BV-011 destination map, the sole authority going forward ──────────
console.log("── BV-011 destination map ────────────────────────────");
const map = await db
  .select({
    destination: netsuiteDestinationItemMap.destination,
    code: netsuiteDestinationItemMap.netsuiteItemCode,
    internalId: netsuiteDestinationItemMap.netsuiteInternalId,
  })
  .from(netsuiteDestinationItemMap);
console.table(map);

console.log("\n── LEGACY Direct Service map (to be retired) ─────────");
const legacy = await db
  .select({
    identity: netsuiteServiceItemMap.serviceIdentity,
    code: netsuiteServiceItemMap.netsuiteItemCode,
    internalId: netsuiteServiceItemMap.netsuiteInternalId,
  })
  .from(netsuiteServiceItemMap);
console.table(legacy);

// ── 2 · quotes on the certification lineage ───────────────────────────────
console.log("\n── quotes on the ZZ-VALIDATION lineage ───────────────");
const qs = await db
  .select({
    id: quotes.id,
    label: quotes.scenarioLabel,
    version: quotes.versionNumber,
    status: quotes.status,
    detailLevel: quotes.detailLevelSnapshot,
    soTranid: quotes.netsuiteSoTranid,
    updatedAt: quotes.updatedAt,
  })
  .from(quotes)
  .where(eq(quotes.projectId, LINEAGE))
  .orderBy(desc(quotes.updatedAt));
console.table(
  qs.map((x) => ({
    label: (x.label ?? "").slice(0, 34),
    v: x.version,
    status: x.status,
    detail: x.detailLevel,
    so: x.soTranid,
    id: x.id.slice(0, 8),
  })),
);

// ── 3 · structure carried by each lineage quote ───────────────────────────
console.log("\n── structure per lineage quote ───────────────────────");
for (const q of qs) {
  const asy = await db
    .select({ id: assemblies.id, sku: assemblies.sku, name: assemblies.name })
    .from(assemblies)
    .where(eq(assemblies.quoteId, q.id));
  // `quote_leaves` carries `assembly_id` itself, so grouped-vs-direct is read
  // from the row rather than reconstructed through the junction. sku/name live
  // on the library `leaves` row.
  const leaves = await db
    .select({
      id: quoteLeaves.id,
      assemblyId: quoteLeaves.assemblyId,
      kind: quoteLeaves.commercialKind,
      sku: libraryLeaves.sku,
      name: libraryLeaves.name,
    })
    .from(quoteLeaves)
    .innerJoin(libraryLeaves, eq(libraryLeaves.id, quoteLeaves.leafId))
    .where(eq(quoteLeaves.quoteId, q.id));
  const grouped = leaves.filter((l) => l.assemblyId !== null);
  const direct = leaves.filter((l) => l.assemblyId === null);
  console.log(
    `\n${(q.label ?? "").slice(0, 40)} v${q.version} [${q.status}${q.soTranid ? " · " + q.soTranid : ""}]`,
  );
  console.log(
    `  assemblies ${asy.length}${asy.length ? " (" + asy.map((a) => a.sku).join(", ") + ")" : ""}` +
      ` · leaves ${leaves.length} · grouped ${grouped.length} · direct ${direct.length}`,
  );
  for (const l of leaves)
    console.log(
      `    ${(l.kind ?? "product").padEnd(8)} ${(l.sku ?? "(no sku)").padEnd(20)} ${l.assemblyId ? "grouped" : "direct"}  ${(l.name ?? "").slice(0, 30)}`,
    );
  const svc = leaves.filter((l) => l.kind === "service");
  if (svc.length) console.log(`  Direct Services: ${svc.map((s) => s.sku).join(", ")}`);
}

// ── 4 · which projects exist at all, for cross-lineage cases ──────────────
console.log("\n── projects (for cases needing another lineage) ───────");
const ps = await db
  .select({ id: projects.id, deal: projects.dealName, client: projects.clientName })
  .from(projects)
  .where(sql`${projects.dealName} ILIKE '%ZZ-VALIDATION%' OR ${projects.dealName} ILIKE '%CERT%'`);
console.table(ps.map((p) => ({ deal: (p.deal ?? "").slice(0, 44), id: p.id.slice(0, 8) })));

process.exit(0);
