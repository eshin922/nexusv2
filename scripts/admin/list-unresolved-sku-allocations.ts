/**
 * Support listing — unresolved SKU reservations.
 *
 *   npm run support:sku-unresolved
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ────────────────────────
 *
 * A read. It prints reservations that are held with an outcome nobody has
 * resolved, together with what is known about each: the identifier, the
 * HubSpot product id when one was seen, and the error that caused the hold.
 *
 * It does NOT repair anything, adopt any external product, release any
 * reservation, or reissue any number. Those are decisions, and an unresolved
 * allocation is precisely the case where the system does not have enough
 * information to make one -- which is why it stopped and asked.
 *
 * Resolution is a human reading this list, looking in HubSpot for the SKU, and
 * then acting. There is no dashboard and no automatic repair, on purpose.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.DIRECT_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

const rows = await sql`
  select a.id, a.sku, a.token, a.state, a.attempt_key, a.hubspot_product_id,
         a.note, a.allocated_at, a.updated_at, a.leaf_id,
         u.email as allocated_by
  from sku_allocations a
  left join users u on u.id = a.allocated_by_user_id
  where a.state = 'conflicted'
  order by a.updated_at desc
`;

if (rows.length === 0) {
  console.log("\nNo unresolved SKU reservations.\n");
  await sql.end();
  process.exit(0);
}

console.log(`\n${rows.length} unresolved SKU reservation(s):\n`);
for (const r of rows) {
  // A claim still in flight and a settled failure are BOTH `conflicted` --
  // both unresolved, both refusing further creates. The note is what tells a
  // reader which; nothing reads it for control flow.
  const inflight = String(r.note ?? "").startsWith("inflight:");
  console.log(
    `  ${r.sku}   [${inflight ? "CLAIMED, NO OUTCOME RECORDED" : "UNRESOLVED"}]`,
  );
  console.log(`    allocation   ${r.id}`);
  console.log(`    intent       ${r.attempt_key}`);
  console.log(`    by           ${r.allocated_by ?? "unknown"} at ${r.allocated_at?.toISOString?.() ?? r.allocated_at}`);
  console.log(`    HubSpot id   ${r.hubspot_product_id ?? "— none recorded —"}`);
  console.log(`    Nexus leaf   ${r.leaf_id ?? "— none —"}`);
  console.log(`    why          ${r.note ?? "—"}`);
  console.log("");
}

console.log(
  [
    "These are held, not lost. Each number stays spent -- reserved SKUs are",
    "never reissued -- and creation on them is refused until resolved.",
    "",
    "CLAIMED, NO OUTCOME RECORDED means a create was claimed and the process",
    "did not survive to record what happened. The request may or may not have",
    "reached HubSpot, which is why it is held rather than retried.",
    "",
    "To resolve one: search HubSpot for the SKU above.",
    "  * a product carrying it exists  -> the create landed. Decide whether that",
    "    product is the one intended; nothing here adopts it for you.",
    "  * nothing carries it            -> the create did not land. The number",
    "    stays spent; generate a new one for a fresh attempt.",
    "",
    "No automatic repair is provided, and none should be inferred.",
  ].join("\n"),
);

await sql.end();
