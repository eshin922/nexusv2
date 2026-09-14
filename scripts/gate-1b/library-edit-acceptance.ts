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
      `[acceptance] refusing outside the isolated validation runtime: mode=${safety.mode} ` +
        `providers=${providers.join(",")} db=${safety.database?.name ?? "<unknown>"}`,
    );
  }
  console.log(`[acceptance] isolated runtime confirmed · db=${safety.database.name}`);
}
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assemblies,
  auditLog,
  leafEditAttempts,
  leaves,
  quotes,
} from "@/db/schema";
import { createLeaf, retryLeafEdit, updateLeaf } from "@/app/actions/leaves";
import { attachQuoteProduct } from "@/app/actions/quote-products";
import { evaluateAttachmentEligibility } from "@/lib/product-structure/attachment-eligibility";
import { __fakeHubspotProduct } from "../../tests/harness/providers/fake-hubspot.ts";

/**
 * #567 acceptance -- THE OPERATOR JOURNEY, END TO END.
 *
 * One pass over what an operator actually does: create a product, give it a
 * SKU, correct its details, attach it -- plus the failure they will eventually
 * hit and the remedy that gets them out of it.
 *
 * Deliberately not a catalogue of interleavings. Those were useful while the
 * design was being decided and are not what tells us the workflow is finished.
 */

type V = "PASS" | "FAIL" | "BLOCKED";
const out: { id: string; verdict: V; detail: string }[] = [];
function rec(id: string, verdict: V, detail: string) {
  out.push({ id, verdict, detail });
  console.log(`${verdict.padEnd(7)} ${id.padEnd(18)} ${detail}`);
}

const STAMP = Date.now().toString(36).toUpperCase();

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function versionOf(id: string): Promise<string> {
  const [row] = await db
    .select({ updatedAt: leaves.updatedAt })
    .from(leaves)
    .where(eq(leaves.id, id));
  return row?.updatedAt ? new Date(row.updatedAt).toISOString() : "";
}

async function main() {
  // Re-runnable. The fake mints product ids from a per-process counter, so a
  // second run collides with the first unless its own rows are cleared.
  await db.execute(sql`
    with mine as (
      select id from leaves
       where name like 'ACC · %'
          or hubspot_product_id like '998%'
          or hubspot_product_id like '996%'
    ),
    a as (delete from assembly_leaves where leaf_id in (select id from mine)),
    b as (delete from quote_leaves where leaf_id in (select id from mine))
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

  // ── 1 · CREATE ──────────────────────────────────────────────────────────
  const created = await createLeaf(
    form({
      name: `ACC · new product (${STAMP})`,
      sku: "",
      commercialKind: "product",
      hubspotProductType: "Labels",
      unitCost: "0",
    }),
  );
  if (!created.ok) {
    rec("CREATE", "FAIL", `refused: ${created.error.message}`);
    finish();
  }
  const leafId = created.data.leafId;
  const [born] = await db.select().from(leaves).where(eq(leaves.id, leafId));
  const hubspotId = born!.hubspotProductId!;
  rec(
    "CREATE",
    born?.sku === null && Boolean(hubspotId) ? "PASS" : "FAIL",
    `leaf ${leafId.slice(0, 8)} · no SKU yet · HubSpot ${hubspotId}`,
  );

  // ── 2 · IT CANNOT BE USED YET, AND SAYS WHY ─────────────────────────────
  {
    const e = evaluateAttachmentEligibility(born!, "group_member");
    rec(
      "BLOCKED:no-sku",
      !e.attachable && e.reason === "missing_sku" ? "PASS" : "FAIL",
      `eligibility = ${e.attachable ? "attachable" : e.reason}`,
    );
  }

  // ── 3 · EDIT DETAILS AND COMPLETE THE SKU ───────────────────────────────
  const sku = `ACC-${STAMP}-1`;
  {
    const res = await updateLeaf(
      form({
        leafId,
        expectedUpdatedAt: await versionOf(leafId),
        name: `ACC · corrected name (${STAMP})`,
        sku,
        hubspotProductType: "Primary",
        unitCost: "12.50",
        url: "https://supplier.invalid/part",
      }),
    );
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const idsKept =
      after?.id === leafId && after?.hubspotProductId === hubspotId;
    const carriers = await db.select().from(leaves).where(eq(leaves.sku, sku));
    rec(
      "EDIT",
      res.ok &&
        after?.sku === sku &&
        after?.name === `ACC · corrected name (${STAMP})` &&
        after?.unitCost === "12.50" &&
        after?.hubspotProductType === "Primary" &&
        idsKept &&
        carriers.length === 1 &&
        remote?.hs_sku === sku &&
        remote?.name === after?.name
        ? "PASS"
        : "FAIL",
      res.ok
        ? `name/type/cost/url updated · SKU "${after?.sku}" · both ids kept=${idsKept} · ` +
          `one product carries it=${carriers.length === 1} · HubSpot agrees=${
            remote?.hs_sku === sku && remote?.name === after?.name
          }`
        : `refused: ${res.error.message}`,
    );
  }

  // ── 4 · NOW IT ATTACHES ─────────────────────────────────────────────────
  {
    const [reloaded] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const e = evaluateAttachmentEligibility(reloaded!, "group_member");
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
      e.attachable && att.ok ? "PASS" : "FAIL",
      att.ok
        ? `eligible, and attached as quote_leaf ${att.data.quoteLeafId.slice(0, 8)}`
        : `refused: ${att.error.message}`,
    );
  }

  // ── 5 · IDENTITY IS PRESERVED ───────────────────────────────────────────
  {
    const replace = await updateLeaf(
      form({
        leafId,
        expectedUpdatedAt: await versionOf(leafId),
        name: `ACC · corrected name (${STAMP})`,
        sku: `ACC-${STAMP}-REPLACED`,
        hubspotProductType: "Primary",
        unitCost: "12.50",
        url: "",
      }),
    );
    const other = await createLeaf(
      form({
        name: `ACC · second product (${STAMP})`,
        sku: "",
        commercialKind: "product",
        hubspotProductType: "Labels",
        unitCost: "0",
      }),
    );
    const dup = other.ok
      ? await updateLeaf(
          form({
            leafId: other.data.leafId,
            expectedUpdatedAt: await versionOf(other.data.leafId),
            name: `ACC · second product (${STAMP})`,
            sku: `  ${sku.toLowerCase()}  `,
            hubspotProductType: "Labels",
            unitCost: "0",
            url: "",
          }),
        )
      : null;
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    rec(
      "IDENTITY",
      !replace.ok &&
        after?.sku === sku &&
        dup !== null &&
        !dup.ok &&
        /already belongs to/.test(dup.error.message)
        ? "PASS"
        : "FAIL",
      `replacing an established SKU refused=${!replace.ok} · SKU still "${after?.sku}" · ` +
        `a normalized duplicate on another product refused=${dup !== null && !dup.ok}`,
    );
  }

  // ── 6 · CONCURRENT EDITS DO NOT LOSE EACH OTHER ─────────────────────────
  {
    const [row] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const v = await versionOf(leafId);
    const results = await Promise.all([
      updateLeaf(form({ leafId, expectedUpdatedAt: v, name: row!.name, sku, hubspotProductType: "Primary", unitCost: "21.00", url: "" })),
      updateLeaf(form({ leafId, expectedUpdatedAt: v, name: `ACC · renamed by B (${STAMP})`, sku, hubspotProductType: "Primary", unitCost: row!.unitCost ?? "0", url: "" })),
    ]);
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const accepted = results.filter((r) => r.ok).length;
    const coherent =
      (after?.name === `ACC · renamed by B (${STAMP})` && after?.unitCost !== "21.00") ||
      (after?.unitCost === "21.00" && after?.name === row!.name);
    rec(
      "CONCURRENT",
      accepted === 1 &&
        coherent &&
        remote?.name === after?.name &&
        (remote?.hs_cost_of_goods_sold ?? null) === after?.unitCost
        ? "PASS"
        : "FAIL",
      `${accepted}/2 accepted · the winner's row is its own edit=${coherent} · ` +
        `neither change was silently merged · HubSpot matches Nexus=${
          remote?.name === after?.name
        }`,
    );
  }

  // ── 7 · AN ORDINARY SYNCHRONIZATION FAILURE ─────────────────────────────
  //
  // The one an operator will actually hit: HubSpot does not answer. Nothing
  // may move locally, the edit must be kept, and the product must not accept a
  // DIFFERENT edit on top of an unsettled one.
  const savedName = `ACC · saved edit (${STAMP})`;
  {
    const [before] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: savedName, sku, hubspotProductType: "Primary", unitCost: "33.00", url: "" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const [saved] = await db
      .select()
      .from(leafEditAttempts)
      .where(and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)));
    const different = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: "ACC · unrelated edit", sku, hubspotProductType: "Primary", unitCost: "44.00", url: "" }),
    );

    rec(
      "FAILURE",
      !res.ok &&
        after?.name === before!.name &&
        Boolean(saved) &&
        saved?.outcome === "unconfirmed" &&
        !different.ok &&
        different.error.code === "UNCONFIRMED_EDIT" &&
        /Retry that saved edit first/.test(different.error.message)
        ? "PASS"
        : "FAIL",
      !res.ok
        ? `refused without moving the local row=${after?.name === before!.name} · ` +
          `the edit was saved=${Boolean(saved)} (${saved?.outcome}) · ` +
          `a different edit is refused and points at the remedy=${
            !different.ok && different.error.code === "UNCONFIRMED_EDIT"
          }`
        : "an unconfirmed write was reported as success",
    );
  }

  // ── 8 · THE REMEDY WORKS, AND THE PRODUCT IS USABLE AGAIN ───────────────
  {
    const retry = await retryLeafEdit(form({ leafId }));
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const openLeft = await db
      .select()
      .from(leafEditAttempts)
      .where(and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)));
    // And an ordinary edit works again afterwards -- the point of a remedy.
    const nextEdit = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `ACC · edited after recovery (${STAMP})`, sku, hubspotProductType: "Primary", unitCost: "55.00", url: "" }),
    );
    const [end] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const endRemote = __fakeHubspotProduct(hubspotId);

    rec(
      "RECOVERY",
      retry.ok &&
        after?.name === savedName &&
        remote?.name === savedName &&
        openLeft.length === 0 &&
        nextEdit.ok &&
        end?.name === `ACC · edited after recovery (${STAMP})` &&
        endRemote?.name === end?.name
        ? "PASS"
        : "FAIL",
      retry.ok
        ? `the saved edit went through (${retry.data.hubspotOutcome}) · both catalogs hold it · ` +
          `nothing left open=${openLeft.length === 0} · ordinary editing works again=${nextEdit.ok}`
        : `the remedy failed: ${retry.error.message}`,
    );
  }

  // ── 9 · IT IS ALL ACCOUNTED FOR ─────────────────────────────────────────
  {
    const rows = await db
      .select({ diff: auditLog.diffJson })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, leafId), eq(auditLog.action, "leaf_updated")));
    const completion = rows.filter(
      (r) => (r.diff as Record<string, unknown> | null)?.sku_completed === true,
    );
    const retried = rows.filter(
      (r) => (r.diff as Record<string, unknown> | null)?.retried === true,
    );
    rec(
      "AUDIT",
      rows.length >= 4 && completion.length === 1 && retried.length === 1
        ? "PASS"
        : "FAIL",
      `${rows.length} edits recorded · exactly one completed the SKU · ` +
        `exactly one was a retry`,
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
