// FIRST: refuse before `@/db` is evaluated and a pool is opened.
import { assertRuntimeSafety } from "@/lib/config/runtime-config";
{
  const safety = assertRuntimeSafety();
  const providers = Object.values(safety.providers);
  if (
    safety.mode !== "isolated" ||
    providers.some((k) => k !== "isolated") ||
    !safety.database?.name.includes("nexus_validation")
  ) {
    throw new Error(
      `[walk] refusing outside the isolated validation runtime: mode=${safety.mode} ` +
        `providers=${providers.join(",")} db=${safety.database?.name ?? "<unknown>"}`,
    );
  }
  console.log(`[walk] isolated runtime confirmed · db=${safety.database.name}`);
}
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, auditLog, leaves, quotes } from "@/db/schema";
import { createLeaf, updateLeaf } from "@/app/actions/leaves";
import { attachQuoteProduct } from "@/app/actions/quote-products";
import { evaluateAttachmentEligibility } from "@/lib/product-structure/attachment-eligibility";

/**
 * #567 acceptance: an EXISTING SKU-less product is corrected in place.
 *
 * The claim under test is not "an edit form exists". It is that a product
 * already stranded can be completed WITHOUT recreation, keeps both identities,
 * and then attaches -- which is the operator's actual blocked path.
 */

type V = "PASS" | "FAIL" | "BLOCKED";
const out: { id: string; verdict: V; detail: string }[] = [];
function rec(id: string, verdict: V, detail: string) {
  out.push({ id, verdict, detail });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(16)} ${detail}`);
}

const STAMP = Date.now().toString(36).toUpperCase();

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function main() {
  // ── RE-RUNNABLE ─────────────────────────────────────────────────────────
  //
  // The fake HubSpot mints product ids from a counter that starts at zero in
  // every process, so a second run collides with the first on
  // `leaves_hubspot_product_id_idx`. A control that only works once is a
  // control that cannot be re-run after it is changed -- and a changed control
  // must be re-run rather than inherit the prior run's result. Clearing this
  // walk's own prior artifacts first is what makes the evidence reproducible.
  await db.execute(sql`
    with mine as (
      select id from leaves
       where name like 'Edit walk %' or name like 'Concurrent %'
    ),
    detached as (
      delete from assembly_leaves where leaf_id in (select id from mine)
    ),
    unattached as (
      delete from quote_leaves where leaf_id in (select id from mine)
    )
    delete from leaves where id in (select id from mine)
  `);

  const [asm] = await db
    .select({ assemblyId: assemblies.id, quoteId: assemblies.quoteId })
    .from(assemblies)
    .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
    .where(eq(quotes.status, "draft"))
    .limit(1);
  if (!asm) {
    rec("SETUP", "BLOCKED", "no draft quote with an assembly");
    finish();
  }

  // ── 1 · a product that is already stranded ──────────────────────────────
  const created = await createLeaf(
    form({
      name: `Edit walk · SKU-less (${STAMP})`,
      sku: "",
      commercialKind: "product",
      hubspotProductType: "Raw ingredients",
      unitCost: "0",
    }),
  );
  if (!created.ok) {
    rec("CREATE", "FAIL", `refused: ${created.error.message}`);
    finish();
  }
  const leafId = created.data.leafId;
  const [before] = await db.select().from(leaves).where(eq(leaves.id, leafId));
  rec(
    "CREATE",
    before?.sku === null ? "PASS" : "FAIL",
    `leaf ${leafId.slice(0, 8)} sku=${JSON.stringify(before?.sku)} hubspot=${before?.hubspotProductId}`,
  );

  // It cannot be attached. This is the operator's blocker, reproduced.
  {
    const e = evaluateAttachmentEligibility(before!, "group_member");
    rec(
      "BLOCKED:before",
      !e.attachable && e.reason === "missing_sku" ? "PASS" : "FAIL",
      `eligibility = ${e.attachable ? "attachable" : e.reason}`,
    );
  }

  // ── 2 · SYNC FAILURE is visible, and nothing moves ──────────────────────
  {
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-fails";
    const res = await updateLeaf(
      form({
        leafId,
        name: `Edit walk · renamed (${STAMP})`,
        sku: `EDIT-${STAMP}-A`,
        hubspotProductType: "Raw ingredients",
        unitCost: "1.25",
        url: "",
      }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const unchanged = after?.sku === null && after?.name === before?.name;
    rec(
      "SYNC:fail",
      !res.ok && unchanged ? "PASS" : "FAIL",
      !res.ok
        ? `refused: "${res.error.message.slice(0, 80)}" · local row unchanged=${unchanged}`
        : "the edit was ACCEPTED while HubSpot failed",
    );
  }

  // ── 3 · RETRY succeeds, ids preserved, SKU completed ────────────────────
  const sku = `EDIT-${STAMP}-A`;
  {
    const res = await updateLeaf(
      form({
        leafId,
        name: `Edit walk · renamed (${STAMP})`,
        sku,
        hubspotProductType: "Raw ingredients",
        unitCost: "1.25",
        url: "",
      }),
    );
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const idsKept =
      after?.id === before?.id &&
      after?.hubspotProductId === before?.hubspotProductId;
    const rows = await db.select().from(leaves).where(eq(leaves.sku, sku));
    rec(
      "RETRY",
      res.ok && after?.sku === sku && idsKept && rows.length === 1
        ? "PASS"
        : "FAIL",
      `sku="${after?.sku}" · nexus id kept=${after?.id === before?.id} · hubspot id kept=${
        after?.hubspotProductId === before?.hubspotProductId
      } (${after?.hubspotProductId}) · products carrying this sku=${rows.length}`,
    );
  }

  // ── 4 · RELOAD and ATTACH ───────────────────────────────────────────────
  {
    const [reloaded] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const e = evaluateAttachmentEligibility(reloaded!, "group_member");
    rec(
      "RELOAD",
      e.attachable ? "PASS" : "FAIL",
      `eligibility after edit = ${e.attachable ? "attachable" : e.reason}`,
    );
    const att = await attachQuoteProduct(
      form({
        quoteId: asm.quoteId,
        leafId,
        assemblyId: asm.assemblyId,
        quantity: "1",
      }),
    );
    rec(
      "ATTACH",
      att.ok ? "PASS" : "FAIL",
      att.ok ? `quote_leaf ${att.data.quoteLeafId.slice(0, 8)}` : `refused: ${att.error.message}`,
    );
  }

  // ── 5 · an ESTABLISHED SKU is not ordinary editing ──────────────────────
  {
    const res = await updateLeaf(
      form({
        leafId,
        name: `Edit walk · renamed (${STAMP})`,
        sku: `EDIT-${STAMP}-REPLACED`,
        hubspotProductType: "Raw ingredients",
        unitCost: "1.25",
        url: "",
      }),
    );
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    rec(
      "ESTABLISHED",
      !res.ok && after?.sku === sku ? "PASS" : "FAIL",
      !res.ok
        ? `refused: "${res.error.message.slice(0, 90)}" · sku still "${after?.sku}"`
        : "an established SKU was replaced by an ordinary edit",
    );
  }

  // ── 6 · UNIQUENESS across the catalog ───────────────────────────────────
  {
    const other = await createLeaf(
      form({
        name: `Edit walk · second (${STAMP})`,
        sku: "",
        commercialKind: "product",
        hubspotProductType: "Labels",
        unitCost: "0",
      }),
    );
    if (!other.ok) {
      rec("UNIQUE", "BLOCKED", `could not create the second product: ${other.error.message}`);
    } else {
      // Lower-cased and padded: uniqueness is on the NORMALIZED value, so this
      // must be refused as the same SKU rather than accepted as a new one.
      const res = await updateLeaf(
        form({
          leafId: other.data.leafId,
          name: `Edit walk · second (${STAMP})`,
          sku: `  ${sku.toLowerCase()}  `,
          hubspotProductType: "Labels",
          unitCost: "0",
          url: "",
        }),
      );
      rec(
        "UNIQUE",
        !res.ok ? "PASS" : "FAIL",
        !res.ok
          ? `refused a normalized duplicate: "${res.error.message.slice(0, 80)}"`
          : "two products now share one SKU",
      );
    }
  }

  // ── 7 · CONCURRENT edits ────────────────────────────────────────────────
  {
    const results = await Promise.all([
      updateLeaf(form({ leafId, name: `Concurrent A (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "2.00", url: "" })),
      updateLeaf(form({ leafId, name: `Concurrent B (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "3.00", url: "" })),
    ]);
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const okCount = results.filter((r) => r.ok).length;
    const landed =
      after?.name === `Concurrent A (${STAMP})` ||
      after?.name === `Concurrent B (${STAMP})`;
    const skuIntact = after?.sku === sku;
    rec(
      "CONCURRENT",
      landed && skuIntact ? "PASS" : "FAIL",
      `${okCount}/2 accepted · final name="${after?.name}" · sku intact=${skuIntact} — last write wins, and neither edit forked identity`,
    );
  }

  // ── 8 · the change is AUDITED ───────────────────────────────────────────
  {
    const rows = await db
      .select({ action: auditLog.action, diff: auditLog.diffJson })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, leafId), eq(auditLog.action, "leaf_updated")));
    const completion = rows.filter(
      (r) => (r.diff as Record<string, unknown> | null)?.sku_completed === true,
    );
    rec(
      "AUDIT",
      rows.length > 0 && completion.length === 1 ? "PASS" : "FAIL",
      `${rows.length} leaf_updated rows · exactly one marks sku_completed=${completion.length === 1}`,
    );
  }

  finish();
}

function finish(): never {
  const fail = out.filter((r) => r.verdict === "FAIL").length;
  const blocked = out.filter((r) => r.verdict === "BLOCKED").length;
  console.log(`\nPASS ${out.length - fail - blocked}  FAIL ${fail}  BLOCKED ${blocked}`);
  process.exit(fail + blocked > 0 ? 1 : 0);
}

await main();
