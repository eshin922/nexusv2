// Leaf-detach micro-slice Sub-item 5 — dry-run audit of orphaned
// cost data. Identifies all `quote_skus` rows where `sku_role =
// 'assembly'` AND any of the three per-SKU cost-input tables
// (`packaging_inputs` / `production_inputs` / `freight_inputs`)
// have rows referencing the SKU. Writes a per-SKU breakdown to
// `docs/orphaned-cost-data-audit.md` for Edward review.
//
// Per brief Q2 LOCKED: this script is dry-run only — it does NOT
// mutate data. Cleanup execution is a separate admin-gated server
// action (`runOrphanedCostDataCleanup` in `src/app/actions/
// admin-cleanup.ts`) that fires post-deploy after Edward reviews
// the audit doc.
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/orphaned-cost-data-audit.ts
//
// Exit code 0 always (success ≠ "no orphans" — success means the
// query + write completed). The audit doc's content is the
// signal: zero rows == zero orphans.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 2 });

type OrphanRow = {
  quote_sku_id: string;
  sku_label: string;
  product_name: string;
  parent_sku_id: string | null;
  quote_id: string;
  project_id: string;
  scenario_label: string;
  version_number: number;
  deal_name: string;
  packaging_rows: string;
  production_rows: string;
  freight_rows: string;
};

async function main() {
  const orphans = await sql<OrphanRow[]>`
    SELECT
      qs.id AS quote_sku_id,
      qs.sku_label,
      qs.product_name,
      qs.parent_sku_id,
      qs.quote_id,
      q.project_id,
      q.scenario_label,
      q.version_number,
      p.deal_name,
      (SELECT COUNT(*) FROM packaging_inputs pi WHERE pi.quote_sku_id = qs.id) AS packaging_rows,
      (SELECT COUNT(*) FROM production_inputs pri WHERE pri.quote_sku_id = qs.id) AS production_rows,
      (SELECT COUNT(*) FROM freight_inputs fi WHERE fi.quote_sku_id = qs.id) AS freight_rows
    FROM quote_skus qs
    INNER JOIN quotes q ON q.id = qs.quote_id
    INNER JOIN projects p ON p.id = q.project_id
    WHERE qs.sku_role = 'assembly'
      AND (
        EXISTS (SELECT 1 FROM packaging_inputs WHERE quote_sku_id = qs.id)
        OR EXISTS (SELECT 1 FROM production_inputs WHERE quote_sku_id = qs.id)
        OR EXISTS (SELECT 1 FROM freight_inputs WHERE quote_sku_id = qs.id)
      )
    ORDER BY p.deal_name, q.scenario_label, qs.sku_label;
  `;

  const totalRows = orphans.reduce(
    (sum, o) =>
      sum +
      Number(o.packaging_rows) +
      Number(o.production_rows) +
      Number(o.freight_rows),
    0,
  );
  const totalSkus = orphans.length;
  const totalQuotes = new Set(orphans.map((o) => o.quote_id)).size;

  // Compute proposed auto-name per orphan (collision-handled per
  // the Sub-item 3 convention — walk `-CMP`, `-CMP-2`, `-CMP-3`,...).
  // Lookup existing skuLabels per quote.
  const labelsByQuote = new Map<string, Set<string>>();
  if (orphans.length > 0) {
    const quoteIds = Array.from(new Set(orphans.map((o) => o.quote_id)));
    const rows = await sql<{ quote_id: string; sku_label: string }[]>`
      SELECT quote_id, sku_label FROM quote_skus
      WHERE quote_id = ANY(${quoteIds})
    `;
    for (const r of rows) {
      if (!labelsByQuote.has(r.quote_id))
        labelsByQuote.set(r.quote_id, new Set());
      labelsByQuote.get(r.quote_id)!.add(r.sku_label);
    }
  }

  function proposeAutoName(skuLabel: string, quoteId: string): string {
    const existing = labelsByQuote.get(quoteId) ?? new Set<string>();
    const base = `${skuLabel}-CMP`;
    if (!existing.has(base)) return base;
    for (let n = 2; n <= 1000; n++) {
      const next = `${skuLabel}-CMP-${n}`;
      if (!existing.has(next)) return next;
    }
    return `${skuLabel}-CMP-COLLISION-LIMIT-EXCEEDED`;
  }

  // Render the audit doc.
  const lines: string[] = [];
  lines.push("# Orphaned cost-data audit");
  lines.push("");
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(
    "**Source:** `scripts/verify/orphaned-cost-data-audit.ts` (dry-run)",
  );
  lines.push(
    "**Brief reference:** `docs/leaf-detach-micro-slice-brief.md` §4 Sub-item 5",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Orphaned assembly SKUs:** ${totalSkus}`);
  lines.push(`- **Quotes affected:** ${totalQuotes}`);
  lines.push(`- **Total orphan rows across the 3 cost tables:** ${totalRows}`);
  lines.push("");

  if (totalSkus === 0) {
    lines.push("> ✅ Zero orphans. No cleanup needed.");
    lines.push("");
  } else {
    lines.push(
      "> ⚠ Orphans present. Run cleanup via the admin action (`runOrphanedCostDataCleanup`) after smoke-verification on production. Per brief Q2 LOCKED: manual admin trigger post-deploy.",
    );
    lines.push("");
    lines.push("## Per-SKU breakdown");
    lines.push("");
    lines.push(
      "Each orphan would be smart-migrated per Sub-item 3 logic: cost rows reparent to an auto-created child leaf; original SKU stays as assembly with the child attached.",
    );
    lines.push("");
    lines.push(
      "| Project | Quote | Orphan SKU | Product | Pkg rows | Prod rows | Frt rows | Proposed child name |",
    );
    lines.push(
      "|---|---|---|---|---|---|---|---|",
    );
    for (const o of orphans) {
      const childName = proposeAutoName(o.sku_label, o.quote_id);
      const quoteLabel = `${o.scenario_label} v${o.version_number}`;
      lines.push(
        `| ${o.deal_name} | ${quoteLabel} | \`${o.sku_label}\` | ${o.product_name} | ${o.packaging_rows} | ${o.production_rows} | ${o.freight_rows} | \`${childName}\` |`,
      );
    }
    lines.push("");
    lines.push("## Audit action sequence (per orphan)");
    lines.push("");
    lines.push(
      "For each orphan SKU, the cleanup fires these audit log entries inside one atomic transaction (per Sub-item 3 smart-migrate action):",
    );
    lines.push("");
    lines.push(
      "1. `role_converted` on the original SKU with `diff_json.sku_role: {from: 'assembly', to: 'assembly'}` (no-op flip — the SKU is already assembly; this entry is omitted unless the original is leaf-role at execution time). For cleanup, the original is already assembly, so the role flip is skipped server-side; the reparent + child-create steps run.",
    );
    lines.push(
      "2. `cost_data_reparented` per source table (packaging / production / freight) with counts.",
    );
    lines.push(
      "3. `sku_created_auto_for_cost_migration` on the new child leaf with `auto_named_from: <original_sku_label>`.",
    );
    lines.push("");
    lines.push("## Per-SKU IDs (for execution traceability)");
    lines.push("");
    for (const o of orphans) {
      lines.push(
        `- \`${o.sku_label}\` (quote_sku_id: \`${o.quote_sku_id}\`, quote_id: \`${o.quote_id}\`)`,
      );
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "**Re-run this script** after cleanup execution to verify zero orphans remain.",
  );
  lines.push("");

  const outPath = resolve(process.cwd(), "docs/orphaned-cost-data-audit.md");
  writeFileSync(outPath, lines.join("\n"), "utf-8");

  console.log(
    `Audit written to ${outPath}: ${totalSkus} orphan SKUs across ${totalQuotes} quotes (${totalRows} cost rows total).`,
  );

  await sql.end();
}

main().catch((err) => {
  console.error("orphaned-cost-data-audit failed:", err);
  process.exit(1);
});
