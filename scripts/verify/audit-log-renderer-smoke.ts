// One-shot smoke against the audit_log renderer map. Walks the actual
// audit_log entries and surfaces how each one would render via
// renderAction(). Catches:
//   - Action types the renderer doesn't have explicit cases for
//     (they fall through to the generic action key fallback)
//   - diff_json shapes that don't match the renderer's expectations
//     (would render with "—" placeholders)
//
// Run: node --env-file=.env.local --experimental-strip-types scripts/verify/audit-log-renderer-smoke.ts

import postgres from "postgres";
import { renderAction } from "../../src/app/admin/audit-log/renderers.ts";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL or DATABASE_URL must be set");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_label: string | null;
  diff_json: Record<string, unknown>;
  created_at: Date;
};

const rows = (await sql`
  SELECT id, action, entity_type, entity_label, diff_json, created_at
  FROM audit_log
  ORDER BY created_at DESC
  LIMIT 100
`) as unknown as AuditRow[];

console.log(`Audit log renderer smoke — ${rows.length} entries\n`);

// Group by action type to surface coverage.
const byAction = new Map<string, AuditRow[]>();
for (const r of rows) {
  if (!byAction.has(r.action)) byAction.set(r.action, []);
  byAction.get(r.action)!.push(r);
}

// Renderer cases explicitly defined in renderers.ts (keep in sync).
const EXPLICIT_CASES = new Set([
  "quote_sent",
  "customer_acceptance_recorded",
  "customer_acceptance_cleared",
  "user_phone_updated",
  "firm_settings_updated",
  "global_price_adj_updated",
  "cell_override_updated",
  "scenario_dropped",
  "create",
  "created",
  "update",
  "updated",
  "delete",
  "deleted",
]);

const fallbacks: string[] = [];

for (const [action, group] of byAction) {
  const isFallback = !EXPLICIT_CASES.has(action);
  if (isFallback) fallbacks.push(action);

  const sample = group[0];
  const rendered = renderAction(
    action,
    sample.diff_json,
    sample.entity_label,
  );
  console.log(
    `${isFallback ? "⚠ fallback " : "✓ explicit "} ${action.padEnd(38)} (${group.length}) → [${rendered.chip.color}] ${rendered.chip.label}`,
  );
  console.log(`    summary: ${rendered.summary}`);
  if (group.length > 1 && isFallback) {
    console.log(`    (only the first entry sampled)`);
  }
}

await sql.end();

console.log();
if (fallbacks.length === 0) {
  console.log("OK — every action seen has an explicit renderer case.");
} else {
  console.log(
    `${fallbacks.length} action type(s) fall through to the generic fallback:`,
  );
  for (const a of fallbacks) console.log(`  - ${a}`);
  console.log(
    "Generic fallback is intentional behavior (action key uppercased + neutral chip); these will render correctly but without action-specific surface details. Add explicit cases in renderers.tsx if any action would benefit from richer diff_json display.",
  );
}
