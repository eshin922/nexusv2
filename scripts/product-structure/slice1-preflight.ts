// Product Structure Slice 1 — deterministic, read-only preflight and
// reconciliation evidence.
//
// Run only after the Expand migration has been applied to the target database:
//   node --env-file=.env.validation.local --experimental-strip-types \
//     scripts/product-structure/slice1-preflight.ts --mode preflight
//   node --env-file=.env.validation.local --experimental-strip-types \
//     scripts/product-structure/slice1-preflight.ts --mode reconcile \
//     --output .artifacts/validation/<run-id>/slice1-reconciliation.json

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export const PREFLIGHT_CLASSIFICATIONS = [
  "missing_canonical_row",
  "exact_existing_match",
  "value_conflict",
  "duplicate_canonical_candidates",
  "orphan_canonical_grouped_row",
  "cross_quote_product_reference",
  "nested_legacy_membership",
  "invalid_required_reference",
] as const;

export type PreflightClassification = (typeof PREFLIGHT_CLASSIFICATIONS)[number];

export type CanonicalCandidate = {
  id: string;
  quantity: string;
  position: number;
};

export type MembershipCandidate = {
  assemblyLeafId: string;
  quoteId: string | null;
  assemblyId: string;
  leafId: string;
  quantity: string;
  position: number;
  parentAssemblyLeafId: string | null;
  mappedQuoteLeafId: string | null;
  requiredReferencesValid: boolean;
  candidates: CanonicalCandidate[];
};

export function classifyMembership(
  row: MembershipCandidate,
): PreflightClassification {
  if (row.parentAssemblyLeafId !== null) return "nested_legacy_membership";
  if (row.quoteId === null || !row.requiredReferencesValid) {
    return "invalid_required_reference";
  }
  if (row.candidates.length > 1) return "duplicate_canonical_candidates";
  if (row.candidates.length === 0) {
    return row.mappedQuoteLeafId === null
      ? "missing_canonical_row"
      : "invalid_required_reference";
  }

  const candidate = row.candidates[0];
  if (row.mappedQuoteLeafId !== null && row.mappedQuoteLeafId !== candidate.id) {
    return "invalid_required_reference";
  }
  if (
    Number(row.quantity) !== Number(candidate.quantity) ||
    row.position !== candidate.position
  ) {
    return "value_conflict";
  }
  return "exact_existing_match";
}

type Sql = ReturnType<typeof postgres>;

type Detail = {
  classification: PreflightClassification;
  quoteId: string | null;
  assemblyId: string | null;
  leafId: string | null;
  assemblyLeafId: string | null;
  quoteLeafId: string | null;
  detail: Record<string, unknown>;
};

type Evidence = {
  schemaVersion: "product-structure-slice1-v1";
  mode: "preflight" | "reconcile";
  generatedAt: string;
  classifications?: Record<PreflightClassification, number>;
  details?: Detail[];
  invariants?: Record<string, number>;
  pass: boolean;
};

function parseArgs(argv: string[]): {
  mode: "preflight" | "reconcile";
  output: string | null;
} {
  let mode: "preflight" | "reconcile" = "preflight";
  let output: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode") {
      const value = argv[++i];
      if (value !== "preflight" && value !== "reconcile") {
        throw new Error("--mode must be preflight or reconcile");
      }
      mode = value;
    } else if (argv[i] === "--output") {
      output = argv[++i] ?? null;
      if (!output) throw new Error("--output requires a path");
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return { mode, output };
}

async function loadMembershipCandidates(sql: Sql): Promise<MembershipCandidate[]> {
  const rows = await sql<
    Array<{
      assembly_leaf_id: string;
      quote_id: string | null;
      assembly_id: string;
      leaf_id: string;
      quantity: string;
      position: number;
      parent_assembly_leaf_id: string | null;
      mapped_quote_leaf_id: string | null;
      required_references_valid: boolean;
      candidates: CanonicalCandidate[];
    }>
  >`
    SELECT
      al.id AS assembly_leaf_id,
      a.quote_id,
      al.assembly_id,
      al.leaf_id,
      al.quantity::text AS quantity,
      al.position,
      al.parent_assembly_leaf_id,
      al.quote_leaf_id AS mapped_quote_leaf_id,
      (a.id IS NOT NULL AND q.id IS NOT NULL AND l.id IS NOT NULL)
        AS required_references_valid,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', ql.id,
            'quantity', ql.quantity::text,
            'position', ql.position
          ) ORDER BY ql.id
        ) FILTER (WHERE ql.id IS NOT NULL),
        '[]'::jsonb
      ) AS candidates
    FROM assembly_leaves al
    LEFT JOIN assemblies a ON a.id = al.assembly_id
    LEFT JOIN quotes q ON q.id = a.quote_id
    LEFT JOIN leaves l ON l.id = al.leaf_id
    LEFT JOIN quote_leaves ql
      ON ql.quote_id = a.quote_id
     AND ql.assembly_id = al.assembly_id
     AND ql.leaf_id = al.leaf_id
    GROUP BY al.id, a.id, a.quote_id, q.id, l.id
    ORDER BY a.quote_id NULLS LAST, al.assembly_id, al.position, al.id
  `;

  return rows.map((row) => ({
    assemblyLeafId: row.assembly_leaf_id,
    quoteId: row.quote_id,
    assemblyId: row.assembly_id,
    leafId: row.leaf_id,
    quantity: row.quantity,
    position: Number(row.position),
    parentAssemblyLeafId: row.parent_assembly_leaf_id,
    mappedQuoteLeafId: row.mapped_quote_leaf_id,
    requiredReferencesValid: row.required_references_valid,
    candidates: row.candidates.map((candidate) => ({
      id: candidate.id,
      quantity: String(candidate.quantity),
      position: Number(candidate.position),
    })),
  }));
}

async function loadCanonicalOnlyProblems(sql: Sql): Promise<Detail[]> {
  const rows = await sql<
    Array<{
      classification:
        | "cross_quote_product_reference"
        | "orphan_canonical_grouped_row"
        | "invalid_required_reference";
      quote_id: string;
      assembly_id: string;
      leaf_id: string;
      quote_leaf_id: string;
      detail: Record<string, unknown>;
    }>
  >`
    WITH grouped AS (
      SELECT
        ql.id,
        ql.quote_id,
        ql.assembly_id,
        ql.leaf_id,
        a.quote_id AS assembly_quote_id,
        q.id AS resolved_quote_id,
        l.id AS resolved_leaf_id
      FROM quote_leaves ql
      LEFT JOIN assemblies a ON a.id = ql.assembly_id
      LEFT JOIN quotes q ON q.id = ql.quote_id
      LEFT JOIN leaves l ON l.id = ql.leaf_id
      WHERE ql.assembly_id IS NOT NULL
    )
    SELECT
      'invalid_required_reference'::text AS classification,
      g.quote_id,
      g.assembly_id,
      g.leaf_id,
      g.id AS quote_leaf_id,
      jsonb_build_object(
        'assemblyQuoteId', g.assembly_quote_id,
        'quoteExists', g.resolved_quote_id IS NOT NULL,
        'leafExists', g.resolved_leaf_id IS NOT NULL
      ) AS detail
    FROM grouped g
    WHERE g.assembly_quote_id IS NULL
       OR g.resolved_quote_id IS NULL
       OR g.resolved_leaf_id IS NULL
    UNION ALL
    SELECT
      'cross_quote_product_reference'::text AS classification,
      g.quote_id,
      g.assembly_id,
      g.leaf_id,
      g.id AS quote_leaf_id,
      jsonb_build_object('assemblyQuoteId', g.assembly_quote_id) AS detail
    FROM grouped g
    WHERE g.assembly_quote_id IS NOT NULL
      AND g.assembly_quote_id <> g.quote_id
    UNION ALL
    SELECT
      'orphan_canonical_grouped_row'::text AS classification,
      g.quote_id,
      g.assembly_id,
      g.leaf_id,
      g.id AS quote_leaf_id,
      '{}'::jsonb AS detail
    FROM grouped g
    WHERE g.assembly_quote_id = g.quote_id
      AND NOT EXISTS (
        SELECT 1
        FROM assembly_leaves al
        WHERE al.assembly_id = g.assembly_id
          AND al.leaf_id = g.leaf_id
          AND al.parent_assembly_leaf_id IS NULL
      )
    ORDER BY quote_id, assembly_id, leaf_id, quote_leaf_id
  `;

  return rows.map((row) => ({
    classification: row.classification,
    quoteId: row.quote_id,
    assemblyId: row.assembly_id,
    leafId: row.leaf_id,
    assemblyLeafId: null,
    quoteLeafId: row.quote_leaf_id,
    detail: row.detail,
  }));
}

export async function runPreflight(sql: Sql): Promise<Evidence> {
  const memberships = await loadMembershipCandidates(sql);
  const details: Detail[] = memberships.map((row) => {
    const classification = classifyMembership(row);
    return {
      classification,
      quoteId: row.quoteId,
      assemblyId: row.assemblyId,
      leafId: row.leafId,
      assemblyLeafId: row.assemblyLeafId,
      quoteLeafId: row.candidates.length === 1 ? row.candidates[0].id : null,
      detail: {
        quantity: row.quantity,
        position: row.position,
        mappedQuoteLeafId: row.mappedQuoteLeafId,
        candidateIds: row.candidates.map((candidate) => candidate.id),
      },
    };
  });
  details.push(...(await loadCanonicalOnlyProblems(sql)));

  const classifications = Object.fromEntries(
    PREFLIGHT_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as Record<PreflightClassification, number>;
  for (const detail of details) classifications[detail.classification]++;

  const blocking = PREFLIGHT_CLASSIFICATIONS.filter(
    (classification) =>
      classification !== "missing_canonical_row" &&
      classification !== "exact_existing_match",
  );

  return {
    schemaVersion: "product-structure-slice1-v1",
    mode: "preflight",
    generatedAt: new Date().toISOString(),
    classifications,
    details,
    pass: blocking.every((classification) => classifications[classification] === 0),
  };
}

export async function runReconciliation(sql: Sql): Promise<Evidence> {
  const rows = await sql<Array<{ invariant: string; violations: string }>>`
    SELECT 'legacy_missing_mapping' AS invariant, count(*)::text AS violations
      FROM assembly_leaves WHERE quote_leaf_id IS NULL
    UNION ALL
    SELECT 'mapped_identity_mismatch', count(*)::text
      FROM assembly_leaves al
      JOIN assemblies a ON a.id = al.assembly_id
      JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
      WHERE ql.quote_id <> a.quote_id
         OR ql.assembly_id IS DISTINCT FROM al.assembly_id
         OR ql.leaf_id <> al.leaf_id
    UNION ALL
    SELECT 'mapped_quantity_mismatch', count(*)::text
      FROM assembly_leaves al
      JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
      WHERE al.quantity <> ql.quantity
    UNION ALL
    SELECT 'mapped_position_mismatch', count(*)::text
      FROM assembly_leaves al
      JOIN quote_leaves ql ON ql.id = al.quote_leaf_id
      WHERE al.position <> ql.position
    UNION ALL
    SELECT 'duplicate_legacy_mapping', count(*)::text
      FROM (
        SELECT quote_leaf_id FROM assembly_leaves
        WHERE quote_leaf_id IS NOT NULL
        GROUP BY quote_leaf_id HAVING count(*) > 1
      ) d
    UNION ALL
    SELECT 'cross_quote_product_reference', count(*)::text
      FROM quote_leaves ql
      JOIN assemblies a ON a.id = ql.assembly_id
      WHERE ql.assembly_id IS NOT NULL AND ql.quote_id <> a.quote_id
    UNION ALL
    SELECT 'grouped_canonical_orphan', count(*)::text
      FROM quote_leaves ql
      WHERE ql.assembly_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM assembly_leaves al WHERE al.quote_leaf_id = ql.id
        )
    UNION ALL
    SELECT 'duplicate_direct_membership', count(*)::text
      FROM (
        SELECT quote_id, leaf_id FROM quote_leaves
        WHERE assembly_id IS NULL
        GROUP BY quote_id, leaf_id HAVING count(*) > 1
      ) d
    UNION ALL
    SELECT 'duplicate_grouped_membership', count(*)::text
      FROM (
        SELECT quote_id, assembly_id, leaf_id FROM quote_leaves
        WHERE assembly_id IS NOT NULL
        GROUP BY quote_id, assembly_id, leaf_id HAVING count(*) > 1
      ) d
    UNION ALL
    SELECT 'pinned_spec_leaf_mismatch', count(*)::text
      FROM quote_leaves ql
      JOIN leaf_specs ls ON ls.id = ql.leaf_spec_version_id
      WHERE ql.leaf_id <> ls.leaf_id
    ORDER BY invariant
  `;

  const invariants = Object.fromEntries(
    rows.map((row) => [row.invariant, Number(row.violations)]),
  );
  return {
    schemaVersion: "product-structure-slice1-v1",
    mode: "reconcile",
    generatedAt: new Date().toISOString(),
    invariants,
    pass: Object.values(invariants).every((violations) => violations === 0),
  };
}

async function main(): Promise<void> {
  const { mode, output } = parseArgs(process.argv.slice(2));
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL or DATABASE_URL must be set");

  const sql = postgres(url, {
    max: 1,
    connection: { application_name: `nexus_slice1_${mode}` },
  });
  try {
    await sql`SET default_transaction_read_only = on`;
    const evidence = mode === "preflight"
      ? await runPreflight(sql)
      : await runReconciliation(sql);
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    if (output) {
      const target = resolve(output);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, serialized, "utf8");
      console.log(target);
    } else {
      process.stdout.write(serialized);
    }
    if (!evidence.pass) process.exitCode = 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
