/**
 * R2 · Identity-resolution parity — the rehearsal, executable.
 *
 * `PHASE-3-PRICING-WORKSPACE.md` §2 R2:
 *
 *   "Slice 1's compatibility window means the lift and the cost base it
 *    modifies are keyed through different identities. Rehearse against real
 *    quote data: for every commercial attachment, prove the canonical row and
 *    the legacy input membership refer to the same Quote, Product, LEAF,
 *    quantity and position."
 *
 *   Stop condition: any missing, duplicate, cross-Quote or drifting mapping.
 *   Do not resolve through `leaf_id` or inferred tuple matching.
 *
 * ── WHAT THIS SCRIPT IS AND IS NOT ────────────────────────────────────────
 *
 * The VERDICT comes from `lookupCanonicalAttachment` and its reverse — the
 * production resolvers, the same code a lift would call. This script does not
 * reimplement the parity check; reimplementing it would prove that two copies
 * of the rule agree, which is the failure mode this phase has spent its length
 * removing.
 *
 * What the script adds is the SWEEP (every attachment, not one) and the
 * BREAKDOWN (which category refused, since the resolver throws one error type).
 * The breakdown reads row data directly. That is not a second authority: the
 * resolver has already decided pass or fail, and this only says why.
 *
 * Both directions are swept, because the compatibility window is two-way and a
 * lift resolves canonical→legacy while the cost base it modifies is keyed
 * legacy→canonical. A one-way sweep would leave the direction the cost base
 * actually uses unproven.
 *
 * READ ONLY. No writes, no fixtures, production data as it stands.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  CanonicalAttachmentResolutionError,
  canonicalQuoteLeafId,
  legacyAssemblyLeafId,
  lookupCanonicalAttachment,
  lookupCanonicalAttachmentByLegacyId,
} from "@/lib/product-structure/canonical-attachment-identity";

type Row = {
  quote_leaf_id: string;
  quote_id: string;
  leaf_id: string;
  assembly_id: string | null;
  quantity: string;
  position: number;
  legacy_count: number;
  legacy_id: string | null;
  legacy_quote_leaf_id: string | null;
  legacy_assembly_id: string | null;
  legacy_leaf_id: string | null;
  legacy_quantity: string | null;
  legacy_position: number | null;
  legacy_assembly_quote_id: string | null;
};

/**
 * Why the resolver refused. Diagnostic only — the verdict is already in.
 *
 * The four names are the spec's own stop conditions, so a failing sweep reports
 * in the vocabulary the gate is written in rather than in error strings.
 */
function category(r: Row): string {
  if (r.assembly_id === null) {
    return r.legacy_count > 0 ? "direct-form carrying legacy state" : "ok";
  }
  if (r.legacy_count === 0) return "missing";
  if (r.legacy_count > 1) return "duplicate";
  if (r.legacy_assembly_quote_id !== r.quote_id) return "cross-Quote";
  if (
    r.legacy_quote_leaf_id !== r.quote_leaf_id ||
    r.legacy_assembly_id !== r.assembly_id ||
    r.legacy_leaf_id !== r.leaf_id ||
    Number(r.legacy_quantity) !== Number(r.quantity) ||
    r.legacy_position !== r.position
  ) {
    return "drifting";
  }
  return "ok";
}

const rows = (await db.execute(sql`
  select ql.id::text            as quote_leaf_id,
         ql.quote_id::text      as quote_id,
         ql.leaf_id::text       as leaf_id,
         ql.assembly_id::text   as assembly_id,
         ql.quantity::text      as quantity,
         ql.position            as position,
         (select count(*) from assembly_leaves al where al.quote_leaf_id = ql.id)::int
                                as legacy_count,
         al.id::text            as legacy_id,
         al.quote_leaf_id::text as legacy_quote_leaf_id,
         al.assembly_id::text   as legacy_assembly_id,
         al.leaf_id::text       as legacy_leaf_id,
         al.quantity::text      as legacy_quantity,
         al.position            as legacy_position,
         a.quote_id::text       as legacy_assembly_quote_id
    from quote_leaves ql
    left join assembly_leaves al on al.quote_leaf_id = ql.id
    left join assemblies a on a.id = al.assembly_id
   order by ql.quote_id, ql.position
`)) as unknown as Row[];

console.log(`R2 · identity-resolution parity`);
console.log(`attachment set: ${rows.length} canonical rows\n`);

const failures: { id: string; quote: string; why: string; error: string }[] = [];
const byCategory = new Map<string, number>();
let forward = 0;

for (const r of rows) {
  const cat = category(r);
  byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  try {
    // THE VERDICT. Production resolver, not a copy of its rule.
    await lookupCanonicalAttachment(canonicalQuoteLeafId(r.quote_leaf_id));
    forward++;
  } catch (e) {
    failures.push({
      id: r.quote_leaf_id,
      quote: r.quote_id,
      why: cat,
      error: e instanceof CanonicalAttachmentResolutionError ? e.message : String(e),
    });
  }
}

// The reverse direction — the one the cost base uses.
const legacyIds = (await db.execute(sql`
  select id::text as id from assembly_leaves order by id
`)) as unknown as { id: string }[];

const reverseFailures: { id: string; error: string }[] = [];
let reverse = 0;
for (const { id } of legacyIds) {
  try {
    await lookupCanonicalAttachmentByLegacyId(legacyAssemblyLeafId(id));
    reverse++;
  } catch (e) {
    reverseFailures.push({
      id,
      error: e instanceof CanonicalAttachmentResolutionError ? e.message : String(e),
    });
  }
}

console.log("category breakdown (canonical side)");
for (const [k, v] of [...byCategory].sort()) console.log(`  ${k.padEnd(34)} ${v}`);
console.log("");
console.log(`forward  canonical -> legacy   ${forward}/${rows.length} resolved`);
console.log(`reverse  legacy -> canonical   ${reverse}/${legacyIds.length} resolved`);

if (failures.length > 0) {
  console.log(`\nFORWARD FAILURES (${failures.length})`);
  for (const f of failures.slice(0, 25)) {
    console.log(`  ${f.id}  quote ${f.quote.slice(0, 8)}  ${f.why}\n    ${f.error}`);
  }
}
if (reverseFailures.length > 0) {
  console.log(`\nREVERSE FAILURES (${reverseFailures.length})`);
  for (const f of reverseFailures.slice(0, 25)) {
    console.log(`  ${f.id}\n    ${f.error}`);
  }
}

const failing = failures.length + reverseFailures.length;
console.log(
  `\n${failing === 0 ? "PASS" : "FAIL"} — ${failing} failing mapping${failing === 1 ? "" : "s"}`,
);
console.log(
  failing === 0
    ? "  No missing, duplicate, cross-Quote or drifting mapping in either direction."
    : "  Stop condition met. Do not resolve through leaf_id or inferred tuple matching.",
);
process.exit(failing === 0 ? 0 : 1);
