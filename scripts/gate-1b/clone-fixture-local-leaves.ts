/**
 * Clone the two shared library products into FIXTURE-LOCAL validation leaves.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * #428 Part B reached the NetSuite identity boundary and stopped: both products
 * on the validation quote are frozen with `display_sku = null`, so NetSuite item
 * matching cannot resolve. Neither Nexus nor HubSpot holds a SKU for them
 * (`leaves.sku` null, `hs_sku` null), so there is nothing to recover.
 *
 * The obvious repair — set a SKU on the shared library leaf — is refused. Those
 * leaves are shared:
 *
 *   42de176a  ->  4781e4bb (explicitly protected), 2f29af72 "Primary",
 *                 a Nemah scenario, and this fixture
 *   5189aa38  ->  4781e4bb, 2f29af72, and this fixture
 *
 * Writing an invented identity onto a product master that three other quotes
 * read is exactly the failure this workstream keeps refusing. So the fixture
 * gets its OWN leaves instead, and the shared rows are proven untouched.
 *
 * ── WHAT THESE SKUs ARE, AND ARE NOT ────────────────────────────────────
 *
 * CERTIFICATION-FIXTURE IDENTITIES, authorized by Edward 2026-08-25. They are
 * NOT recovered HubSpot facts, NOT Nexus product-master facts, and NOT a
 * proposal for what these products' real SKUs should be. Nothing outside the
 * ZZ-VALIDATION fixture may read them as product identity.
 *
 * The `ZZ-VAL-` prefix matches the existing fixture ASY identity (ZZ-VAL-ASY)
 * so the synthetic set is greppable as one family.
 *
 * ── WHAT IT DOES NOT TOUCH ──────────────────────────────────────────────
 *
 * The source leaves are READ ONLY here. The script captures every column of
 * both before and after and refuses to exit 0 if a single byte moved, so
 * "shared library leaves are byte-identical" is a comparison rather than a
 * claim.
 *
 * It also does NOT repoint the quote. Structural reassignment happens on the v2
 * DRAFT after revision, never on the accepted v1 — v1 stays exactly as it was
 * certified through quantity 6.
 *
 * Usage:  ... clone-fixture-local-leaves.ts [--apply]
 * Without `--apply` it prints the plan and writes nothing.
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

const APPLY = process.argv.includes("--apply");

/** The shared library leaves. Read only. Never written by this script. */
const SOURCE = [
  { id: "42de176a-a113-4a88-b5b7-ced23532d559", sku: "ZZ-VAL-50ML-PCR" },
  { id: "5189aa38-8d7b-459a-93d7-2f24b6a02533", sku: "ZZ-VAL-75ML-ALU" },
];

const NOTE =
  "CERTIFICATION-FIXTURE IDENTITY - synthetic SKU authorized 2026-08-25 for " +
  "#428 Part B downstream regression certification. Not a recovered HubSpot " +
  "or Nexus product fact.";

async function snapshotShared() {
  const rows: any[] = (await db.execute(sql`
    select * from leaves
     where id in (${sql.join(SOURCE.map((s) => sql`${s.id}::uuid`), sql`, `)})
     order by id`)) as any;
  return rows;
}

const digest = (rows: any[]) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");

const before = await snapshotShared();
if (before.length !== SOURCE.length) {
  console.error(`expected ${SOURCE.length} source leaves, found ${before.length}`);
  process.exit(1);
}
const beforeHash = digest(before);

console.log("SOURCE (shared library leaves — read only)");
for (const r of before)
  console.log(
    `  ${r.id.slice(0, 8)}  sku=${JSON.stringify(r.sku)}  kind=${r.commercial_kind}` +
      `  hs=${r.hubspot_product_id}  ${r.name}`,
  );
console.log(`  sha256(before) = ${beforeHash}`);

if (!APPLY) {
  console.log("\nPLAN (dry run — pass --apply to write)");
  for (const s of SOURCE) {
    const src = before.find((r: any) => r.id === s.id);
    console.log(`  clone "${src.name}"  ->  new leaf, sku=${s.sku}`);
  }
  console.log("\n  Every other column is copied from the source verbatim, so the");
  console.log("  clone differs from its source in IDENTITY ONLY (id + sku + note).");
  console.log("  Economics are carried across unchanged: unit_cost, commercial_kind,");
  console.log("  service_identity, hubspot_product_type. hubspot_product_id is NULL —");
  console.log("  it is UNIQUE per product, and a fixture identity is not a HubSpot link.");
  console.log("\n  The quote is NOT repointed here. That happens on the v2 draft.");
  process.exit(0);
}

// ── apply ──────────────────────────────────────────────────────────────
const created: { sourceId: string; newId: string; sku: string; name: string }[] = [];

for (const s of SOURCE) {
  const src: any = before.find((r: any) => r.id === s.id);

  const existing: any[] = (await db.execute(sql`
    select id from leaves where sku = ${s.sku}`)) as any;
  if (existing.length > 0) {
    console.log(`  ${s.sku} already exists (${existing[0].id.slice(0, 8)}) — reusing`);
    created.push({ sourceId: s.id, newId: existing[0].id, sku: s.sku, name: src.name });
    // The leaf may exist from a partial earlier run whose audit row failed.
    // writeCreateAudit is a no-op when the row is already there.
    await writeCreateAudit(existing[0].id, src, s.sku, s.id);
    continue;
  }

  // Copy every commercially meaningful column verbatim. The clone differs from
  // its source in identity only, so the fixture's economics cannot move.
  const ins: any[] = (await db.execute(sql`
    insert into leaves (
      name, sku, url, image_url, unit_cost, fsc_claim, fsc_status,
      supplier_verified, owner_id, archived, hubspot_product_id,
      hubspot_product_type, commercial_kind, service_identity
    ) values (
      ${src.name}, ${s.sku}, ${src.url}, ${src.image_url}, ${src.unit_cost},
      ${src.fsc_claim}, ${src.fsc_status}, ${src.supplier_verified},
      ${src.owner_id}, false, null,
      ${src.hubspot_product_type}, ${src.commercial_kind}::leaf_commercial_kind,
      ${src.service_identity}
    ) returning id`)) as any;

  created.push({ sourceId: s.id, newId: ins[0].id, sku: s.sku, name: src.name });

  await writeCreateAudit(ins[0].id, src, s.sku, s.id);
}

/**
 * `actor_kind='system'` because no operator authored this — a certification
 * script did. Attributing it to a human would misrepresent the provenance of a
 * synthetic identity, which is the one thing this whole exercise is avoiding.
 */
async function writeCreateAudit(leafId: string, src: any, sku: string, sourceId: string) {
  const already: any[] = (await db.execute(sql`
    select 1 from audit_log
     where entity_type = 'leaf' and entity_id = ${leafId} and action = 'leaf_create'`)) as any;
  if (already.length > 0) return;

  await db.execute(sql`
    insert into audit_log (entity_type, entity_id, action, actor_kind, actor_display_name, diff_json)
    values ('leaf', ${leafId}, 'leaf_create', 'system',
            'Certification fixture (#428 Part B)', ${JSON.stringify({
      name: src.name,
      sku,
      hubspot_product_id: null,
      cloned_from_hubspot_product_id: src.hubspot_product_id,
      unit_cost: src.unit_cost,
      commercial_kind: src.commercial_kind,
      source: "certification_fixture_clone",
      cloned_from_leaf_id: sourceId,
      note: NOTE,
    })}::jsonb)`);
}

// ── prove the shared leaves did not move ───────────────────────────────
const after = await snapshotShared();
const afterHash = digest(after);

console.log("\nCREATED (fixture-local validation leaves)");
for (const c of created)
  console.log(`  ${c.newId}  sku=${c.sku}  (clone of ${c.sourceId.slice(0, 8)})  ${c.name}`);

console.log("\nSHARED-LEAF INTEGRITY");
console.log(`  sha256(before) = ${beforeHash}`);
console.log(`  sha256(after)  = ${afterHash}`);
if (beforeHash !== afterHash) {
  console.error("\n  MISMATCH — a shared library leaf changed. This must not happen.");
  process.exit(1);
}
console.log("  byte-identical — the shared library leaves were not touched.");
process.exit(0);
