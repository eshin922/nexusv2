/**
 * Read-only catalog and row-count inventory for a Nexus reset rehearsal.
 *
 * Run against a restored copy with DATABASE_URL set. This script never decides
 * what to delete: FK reachability is only a review candidate, since mixed
 * tables (notably leaf_specs and audit_log) require row-level classification.
 */
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required (use a restored database copy).");
}

const db = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

try {
  const inventory = await db.begin(async (tx) => {
    await tx`SET TRANSACTION READ ONLY`;
    const tables = await tx`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const columns = await tx`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE '%quote%id%'
          OR column_name LIKE '%project%id%'
          OR column_name LIKE '%snapshot%id%'
          OR column_name LIKE '%sales%order%id%')
      ORDER BY table_name, column_name
    `;
    const foreignKeys = await tx`
      SELECT child.relname AS child_table, parent.relname AS parent_table,
             con.conname AS constraint_name
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      WHERE con.contype = 'f'
        AND child_ns.nspname = 'public'
        AND parent_ns.nspname = 'public'
      ORDER BY child.relname, parent.relname, con.conname
    `;

    const related = new Set(["projects", "quotes"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const fk of foreignKeys) {
        if (related.has(fk.parent_table) && !related.has(fk.child_table)) {
          related.add(fk.child_table);
          changed = true;
        }
      }
    }

    const softReferences = new Map();
    for (const column of columns) {
      if (!softReferences.has(column.table_name)) softReferences.set(column.table_name, []);
      softReferences.get(column.table_name).push(column.column_name);
    }
    const candidates = [...new Set([...related, ...softReferences.keys()])].sort();
    const counts = [];
    for (const table of candidates) {
      if (!tables.some((row) => row.table_name === table)) continue;
      const [{ count }] = await tx`SELECT count(*)::bigint AS count FROM ${tx("public")}.${tx(table)}`;
      counts.push({
        table,
        rows: String(count),
        fkReachableFromProjectOrQuote: related.has(table),
        idLikeColumns: softReferences.get(table) ?? [],
        classification: "REVIEW_REQUIRED",
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      database: new URL(process.env.DATABASE_URL).pathname.slice(1),
      tableCount: tables.length,
      candidateCounts: counts,
      foreignKeys,
      preserveAndMixedReview: [
        "leaves", "leaf_specs", "product_types", "firm_settings",
        "audit_log", "action_idempotency", "netsuite_item_groups",
        "netsuite_customer_map", "netsuite_service_item_map",
        "netsuite_destination_item_map",
      ],
      warning: "Inventory only. FK reachability is not deletion authorization; archive, storage objects, external order lineage, and mixed rows require separate review.",
    };
  });
  process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
} finally {
  await db.end();
}
