// Verifies audit_log shape for admin entity types
// (firm_settings, markup_defaults).
//
// Run: node --env-file=.env.local --experimental-strip-types \
//        scripts/verify/audit-log.ts
//
// When to run:
//   - After any audit_log schema change (column type, new column).
//   - After any change to admin action audit shape (firm-settings.ts,
//     markup-defaults.ts logAudit calls or transaction inserts).
//   - When debugging a "missing audit row" or "duplicate audit row"
//     report. Surfaces double-logs within 1s windows + revert pairs
//     (update where from === to).
//
// Currently checks the latest 30 rows. Extend the WHERE clause if you
// need to verify additional entity_types as new admin surfaces ship.

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 2 });

type Row = {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  diff_json: Record<string, unknown>;
  created_at: string;
};

const rows = (await sql<Row[]>`
  SELECT id, user_id, entity_type, entity_id, action,
         diff_json, created_at::text
  FROM audit_log
  WHERE entity_type IN ('firm_settings', 'markup_defaults')
  ORDER BY created_at DESC
  LIMIT 30
`) as unknown as Row[];

console.log(`\n=== audit_log rows (${rows.length} matching, last 30) ===`);
for (const r of rows) {
  const diffStr = JSON.stringify(r.diff_json);
  const truncated = diffStr.length > 100 ? diffStr.slice(0, 97) + "..." : diffStr;
  console.log(
    `  ${r.created_at}  ${r.entity_type}.${r.action}  entity=${r.entity_id.slice(0, 12)}${r.entity_id.length > 12 ? "…" : ""}\n    diff=${truncated}`,
  );
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `: ${detail}` : ""}`);
  }
}

console.log("\n=== Shape checks ===");

// firm_settings update: diff_json should have { from: {...}, to: {...} }
const firmUpdates = rows.filter(
  (r) => r.entity_type === "firm_settings" && r.action === "update",
);
console.log(`\n  firm_settings update count: ${firmUpdates.length}`);
for (const r of firmUpdates) {
  const d = r.diff_json as { from?: object; to?: object };
  check(
    `firm_settings update ${r.id.slice(0, 8)}: diff.to has targetMarginPct + floorMarginPct + effectiveFrom`,
    !!d.to &&
      "targetMarginPct" in (d.to as object) &&
      "floorMarginPct" in (d.to as object) &&
      "effectiveFrom" in (d.to as object),
  );
  // First-ever update may have from: null (no prior row); subsequent
  // updates must have from
  if (firmUpdates.indexOf(r) < firmUpdates.length - 1) {
    check(
      `  → diff.from has prior values`,
      !!d.from && "targetMarginPct" in (d.from as object),
    );
  }
}

// markup_defaults create: diff_json.to should have { category, defaultMarkupPct }
const markupCreates = rows.filter(
  (r) => r.entity_type === "markup_defaults" && r.action === "create",
);
console.log(`\n  markup_defaults create count: ${markupCreates.length}`);
for (const r of markupCreates) {
  const d = r.diff_json as { to?: { category?: string; defaultMarkupPct?: string } };
  check(
    `markup_defaults create entity=${r.entity_id}: diff.to has both category + defaultMarkupPct (self-contained)`,
    !!d.to &&
      typeof d.to.category === "string" &&
      typeof d.to.defaultMarkupPct === "string",
  );
  check(
    `  → diff.to.category matches entity_id`,
    d.to?.category === r.entity_id,
  );
}

// markup_defaults update: diff_json should have { from: {defaultMarkupPct}, to: {defaultMarkupPct} }
const markupUpdates = rows.filter(
  (r) => r.entity_type === "markup_defaults" && r.action === "update",
);
console.log(`\n  markup_defaults update count: ${markupUpdates.length}`);
for (const r of markupUpdates) {
  const d = r.diff_json as {
    from?: { defaultMarkupPct?: string };
    to?: { defaultMarkupPct?: string };
  };
  check(
    `markup_defaults update entity=${r.entity_id}: diff has from.defaultMarkupPct + to.defaultMarkupPct`,
    !!d.from?.defaultMarkupPct && !!d.to?.defaultMarkupPct,
  );
  check(
    `  → from ≠ to (no revert pair)`,
    d.from?.defaultMarkupPct !== d.to?.defaultMarkupPct,
  );
}

// markup_defaults delete: diff_json should have { from: {category, defaultMarkupPct}, orphaned_packaging_input_rows: N }
const markupDeletes = rows.filter(
  (r) => r.entity_type === "markup_defaults" && r.action === "delete",
);
console.log(`\n  markup_defaults delete count: ${markupDeletes.length}`);
for (const r of markupDeletes) {
  const d = r.diff_json as {
    from?: { category?: string; defaultMarkupPct?: string };
    orphaned_packaging_input_rows?: number;
  };
  check(
    `markup_defaults delete entity=${r.entity_id}: diff.from has category + defaultMarkupPct`,
    typeof d.from?.category === "string" &&
      typeof d.from?.defaultMarkupPct === "string",
  );
  check(
    `  → diff.orphaned_packaging_input_rows is a number`,
    typeof d.orphaned_packaging_input_rows === "number",
  );
}

// Dedup check: no two rows with the same (user, entity_type, entity_id,
// action, diff_json) within a 1-second window — would suggest double-log.
console.log("\n  Dedup check (1s window):");
let dupes = 0;
for (let i = 0; i < rows.length - 1; i += 1) {
  const a = rows[i];
  const b = rows[i + 1];
  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();
  if (
    Math.abs(aTime - bTime) < 1000 &&
    a.user_id === b.user_id &&
    a.entity_type === b.entity_type &&
    a.entity_id === b.entity_id &&
    a.action === b.action &&
    JSON.stringify(a.diff_json) === JSON.stringify(b.diff_json)
  ) {
    dupes += 1;
    console.log(
      `    DUPE: ${a.entity_type}.${a.action} entity=${a.entity_id.slice(0, 12)} at ${a.created_at}`,
    );
  }
}
check("no double-logs within 1s windows", dupes === 0, `found ${dupes}`);

console.log(
  `\n${failures === 0 ? "✓ ALL AUDIT SHAPE CHECKS PASS" : `✗ ${failures} CHECK(S) FAILED`}\n`,
);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
