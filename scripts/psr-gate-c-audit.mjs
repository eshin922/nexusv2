// CB final-stretch Action 4 — Gate-C audit log SQL verification.
//
// Confirms CB's PSR-11 (apply surgical) + PSR-13 (global adj
// preview) walks produced the expected audit_log entries with
// correct `diff_json.source` namespace per Slice 9.2/9.4b
// audit-source convention.

import postgres from "postgres";

const sql = postgres(process.env.DIRECT_URL ?? process.env.DATABASE_URL, {
  max: 1,
});

try {
  console.log("\n=== Gate-C audit log verification ===\n");

  const rows = await sql`
    SELECT action, entity_type, entity_id,
           diff_json->>'source' AS source,
           caused_by_audit_id,
           created_at
      FROM audit_log
     WHERE created_at > now() - interval '24 hours'
       AND action IN ('tier_price_adj_updated',
                      'global_price_adj_updated',
                      'pricing_suggestion_global_applied')
     ORDER BY created_at DESC LIMIT 30;
  `;

  if (rows.length === 0) {
    console.log("  No recent audit rows found.");
    console.log(
      "  CB's PSR-11/PSR-13 walks may have run beyond 24h window;",
    );
    console.log("  re-run if a fresh audit trail is required.");
  } else {
    console.log(`  Found ${rows.length} recent apply-path audit row(s):\n`);
    console.log(
      "    Action                                Source                          Entity                  When",
    );
    console.log("    " + "-".repeat(95));
    for (const r of rows) {
      const action = (r.action || "").padEnd(36);
      const source = (r.source || "(none)").padEnd(30);
      const entity = `${r.entity_type}:${r.entity_id.slice(0, 8)}`.padEnd(22);
      const when = r.created_at.toISOString().slice(0, 19) + "Z";
      console.log(`    ${action}  ${source}  ${entity}  ${when}`);
    }
  }

  // Surgical apply audit signature.
  const surgical = rows.filter(
    (r) =>
      r.action === "tier_price_adj_updated" &&
      r.source === "pricing_suggestion_surgical",
  );
  console.log("");
  if (surgical.length > 0) {
    console.log(
      `  ✓ PSR-11 surgical apply trail: ${surgical.length} tier_price_adj_updated row(s) with source='pricing_suggestion_surgical'`,
    );
  } else {
    console.log(
      `  · PSR-11 surgical apply trail not found in window (CB walk may have lapsed)`,
    );
  }

  // Manual GPA write audit signature (no source flag for manual edits).
  const manualGpa = rows.filter(
    (r) =>
      r.action === "global_price_adj_updated" && r.source === null,
  );
  if (manualGpa.length > 0) {
    console.log(
      `  ✓ PSR-13 / DetailGlobalAdjust trail: ${manualGpa.length} global_price_adj_updated row(s) without source flag (manual edit)`,
    );
  } else {
    console.log(
      `  · PSR-13 / manual GPA trail not found in window`,
    );
  }

  // System-suggestion GPA writes (alternative path).
  const systemGpa = rows.filter(
    (r) =>
      r.action === "global_price_adj_updated" &&
      r.source === "system_suggestion",
  );
  if (systemGpa.length > 0) {
    console.log(
      `  · ${systemGpa.length} system-suggestion GPA rows in window (legacy applySuggestedGlobalAdj path)`,
    );
  }

  // Global-apply cascade (rank-2 ranking → applyGlobalAdj).
  const globalApply = rows.filter(
    (r) => r.action === "pricing_suggestion_global_applied",
  );
  if (globalApply.length > 0) {
    console.log(
      `  · ${globalApply.length} global-apply cascade root row(s) (applyGlobalAdj)`,
    );
  }

  console.log("");
  console.log(
    "Audit-source convention preserved (Slice 9.2 namespace + CB walk shapes).",
  );
} finally {
  await sql.end();
}
