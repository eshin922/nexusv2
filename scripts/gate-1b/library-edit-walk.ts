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
// The fake's own store, so the walk can ask HubSpot what it actually holds
// rather than trusting the echo of the request that was sent to it.
import { __fakeHubspotProduct } from "../../tests/harness/providers/fake-hubspot.ts";

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

/**
 * The version a form would have been populated from.
 *
 * Ordinary cases read it immediately before submitting, which is what a
 * freshly-opened form does. The concurrency case deliberately does NOT --
 * it submits two edits from ONE snapshot, which is the situation the check
 * exists for.
 */
async function versionOf(id: string): Promise<string> {
  const [row] = await db
    .select({ updatedAt: leaves.updatedAt })
    .from(leaves)
    .where(eq(leaves.id, id));
  return row?.updatedAt ? new Date(row.updatedAt).toISOString() : "";
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
  //
  // Matched on a MARKER every name carries, not on the names individual cases
  // happen to use: later cases RENAME the product, so a name-per-case sweep
  // stops matching the row it created and leaves it behind to collide.
  await db.execute(sql`
    with mine as (
      select id from leaves where name like 'EW · %'
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
      name: `EW · SKU-less (${STAMP})`,
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
  //
  // A status-less failure, which is the UNCERTAIN class: the refusal here is
  // reached by READING THE PRODUCT BACK and finding it unmoved, not by
  // assuming a thrown error means nothing happened. The rejected path is
  // case 8b.
  {
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-fails";
    const res = await updateLeaf(
      form({
        leafId,
        expectedUpdatedAt: await versionOf(leafId),
        name: `EW · renamed (${STAMP})`,
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
        expectedUpdatedAt: await versionOf(leafId),
        name: `EW · renamed (${STAMP})`,
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
        expectedUpdatedAt: await versionOf(leafId),
        name: `EW · renamed (${STAMP})`,
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
        name: `EW · second (${STAMP})`,
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
          expectedUpdatedAt: await versionOf(other.data.leafId),
          name: `EW · second (${STAMP})`,
          sku: `  ${sku.toLowerCase()}  `,
          hubspotProductType: "Labels",
          unitCost: "0",
          url: "",
        }),
      );
      // The refusal must be ABOUT the duplicate. Any refusal at all would
      // satisfy `!res.ok`, and this case has already passed once on an
      // unrelated one -- a missing version token -- while establishing
      // nothing about uniqueness at all.
      const refusedForTheRightReason =
        !res.ok && /already belongs to/.test(res.error.message);
      const holders = await db
        .select({ id: leaves.id })
        .from(leaves)
        .where(sql`upper(btrim(${leaves.sku})) = ${sku.toUpperCase()}`);
      rec(
        "UNIQUE",
        refusedForTheRightReason && holders.length === 1 ? "PASS" : "FAIL",
        !res.ok
          ? `refused: "${res.error.message.slice(0, 70)}" · about the duplicate=${refusedForTheRightReason} · products carrying the SKU: ${holders.length}`
          : "two products now share one SKU",
      );
    }
  }

  // ── 7 · CONCURRENT edits to the SAME product ────────────────────────────
  //
  // Two operators edit DIFFERENT fields of one product at the same time: one
  // changes the cost, the other the name. Both changes must survive.
  //
  // The lock alone does NOT fix this, and finding that out is why the case
  // exists. Serialising the two edits decides their ORDER; it does not stop
  // the second from carrying a whole row built on a read taken before the
  // first. Both still succeed, and the earlier change is gone -- with no error
  // anywhere, and an audit whose `before` records a state that had already
  // been replaced by the time it was written.
  //
  // The version check is what refuses it: the second edit is describing a row
  // that no longer exists, so it is declined rather than applied. The lock is
  // still load-bearing -- it is what makes the comparison and the write see
  // the same row.
  //
  // The read-back against HubSpot is asserted too, but note what it can and
  // cannot establish: within one request the HubSpot write and the local write
  // are strictly sequential, so this harness cannot make the two systems
  // resolve in opposite orders. That assertion holds in this run and is NOT
  // evidence that reordering is impossible. The lost-update half below is the
  // half that discriminates.
  {
    const [row] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const hubspotId = row!.hubspotProductId!;
    const baseName = row!.name;
    const baseType = row!.hubspotProductType ?? "Raw ingredients";

    const results = await Promise.all([
      // A changes the COST only, keeping the name it read.
      updateLeaf(form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: baseName, sku, hubspotProductType: baseType, unitCost: "7.77", url: "" })),
      // B changes the NAME only, keeping the cost it read.
      updateLeaf(form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Concurrent B (${STAMP})`, sku, hubspotProductType: baseType, unitCost: row!.unitCost ?? "0", url: "" })),
    ]);

    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const okCount = results.filter((r) => r.ok).length;

    // EXACTLY ONE is accepted. The other was written against a version that
    // no longer describes the row, so accepting it would mean overwriting a
    // change its author never saw -- which is a lost update whichever way the
    // two happen to be ordered.
    const refusals = results.filter((r) => !r.ok);
    const staleRefusal =
      refusals.length === 1 && refusals[0].error.code === "STALE_WRITE";
    const winnerIsWhole =
      // Whoever won wrote a coherent row: their own edit, and nothing of the
      // other's silently mixed in.
      (after?.name === `EW · Concurrent B (${STAMP})` && after?.unitCost !== "7.77") ||
      (after?.unitCost === "7.77" && after?.name === baseName);
    const agreesWithHubspot =
      remote?.name === after?.name &&
      (remote?.hs_cost_of_goods_sold ?? null) === after?.unitCost;

    rec(
      "CONCURRENT:no-lost-update",
      okCount === 1 && staleRefusal && winnerIsWhole && agreesWithHubspot && after?.sku === sku
        ? "PASS"
        : "FAIL",
      `${okCount}/2 accepted · the loser was refused as stale=${staleRefusal}` +
        (refusals[0] ? ` (${refusals[0].error.code})` : "") +
        ` · the winner's row is its own edit=${winnerIsWhole} (name="${after?.name}" cost=${after?.unitCost})` +
        ` · hubspot agrees=${agreesWithHubspot}` +
        (okCount === 2 ? " — both were accepted, so one operator's change was discarded" : ""),
    );
  }

  // ── 8 · CONCURRENT completion of the SAME SKU on two products ───────────
  //
  // `leaves_sku_idx` is NOT unique, so the uniqueness check is a read with
  // nothing holding the value between the check and the write. Without a lock
  // on the claim, both callers read "free" and both commit.
  {
    const contested = `EDIT-${STAMP}-CONTESTED`;
    const pair = await Promise.all([
      createLeaf(form({ name: `EW · claimant A (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" })),
      createLeaf(form({ name: `EW · claimant B (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" })),
    ]);
    if (!pair[0].ok || !pair[1].ok) {
      rec("SKU:contested", "BLOCKED", "could not create both claimants");
    } else {
      const ids = [pair[0].data.leafId, pair[1].data.leafId];
      const versions = await Promise.all(ids.map((id) => versionOf(id)));
      const claims = await Promise.all(
        ids.map((id, i) =>
          updateLeaf(
            form({
              leafId: id,
              expectedUpdatedAt: versions[i],
              name: `EW · claimant ${i === 0 ? "A" : "B"} (${STAMP})`,
              sku: contested,
              hubspotProductType: "Labels",
              unitCost: "0",
              url: "",
            }),
          ),
        ),
      );
      const accepted = claims.filter((r) => r.ok).length;
      const holders = await db
        .select({ id: leaves.id })
        .from(leaves)
        .where(sql`upper(btrim(${leaves.sku})) = ${contested.toUpperCase()}`);
      rec(
        "SKU:contested",
        accepted === 1 && holders.length === 1 ? "PASS" : "FAIL",
        `${accepted}/2 claims accepted · products now carrying the SKU: ${holders.length}` +
          (accepted === 1 ? "" : " — a SKU identifies one product"),
      );
    }
  }

  // ── 8b · REJECTED — HubSpot answered and refused ────────────────────────
  //
  // The ONE case where "nothing was changed" is a statement rather than an
  // assumption, and the only one allowed to make it. No read-back is needed:
  // HubSpot returned a 400, so the write demonstrably did not apply.
  {
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-rejected";
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Rejected (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "9.00", url: "" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const msg = res.ok ? "" : res.error.message;
    const saysRefused = /HubSpot refused the update, so nothing was changed/.test(msg);
    const unchanged = after?.name !== `EW · Rejected (${STAMP})`;
    rec(
      "REJECTED",
      !res.ok && saysRefused && unchanged ? "PASS" : "FAIL",
      !res.ok
        ? `refused, and says so on HubSpot's own answer=${saysRefused} · local unchanged=${unchanged}`
        : "a refused write was reported as success",
    );
  }

  // ── 9 · UNCERTAIN, and the write DID apply ──────────────────────────────
  //
  // The call fails with no status. Reporting "nothing was changed" here would
  // be a claim about a remote system nobody asked -- and it would be false.
  // Reading the product back is the only thing that can tell this case from
  // the next one.
  {
    const [row] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const hubspotId = row!.hubspotProductId!;
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-applied";
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Reconciled (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "4.00", url: "" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    rec(
      "UNCERTAIN:applied",
      res.ok &&
        res.data.hubspotOutcome === "reconciled" &&
        after?.name === `EW · Reconciled (${STAMP})` &&
        remote?.name === after?.name
        ? "PASS"
        : "FAIL",
      res.ok
        ? `outcome=${res.data.hubspotOutcome} · local caught up ("${after?.name}") · hubspot="${remote?.name}"`
        : `refused: "${res.error.message.slice(0, 100)}" — but the write HAD applied`,
    );
  }

  // ── 10 · UNCERTAIN, and the write did NOT apply ─────────────────────────
  {
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Lost (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "5.00", url: "" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const unchanged = after?.name === `EW · Reconciled (${STAMP})`;
    // The claim is allowed here because a read-back ESTABLISHED it.
    const saysEstablished = !res.ok && /read-back confirms nothing was/i.test(res.error.message);
    rec(
      "UNCERTAIN:lost",
      !res.ok && unchanged && saysEstablished ? "PASS" : "FAIL",
      !res.ok
        ? `refused: "${res.error.message.slice(0, 90)}" · local unchanged=${unchanged}`
        : "an unapplied write was reported as success",
    );
  }

  // ── 11 · INDETERMINATE — the write AND the read-back both failed ────────
  //
  // Three outcomes, not two. This one must not be dressed up as either of the
  // others: nothing is known about HubSpot, and the message has to say so.
  {
    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-indeterminate";
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Indeterminate (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "6.00", url: "" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const msg = res.ok ? "" : res.error.message;
    const admitsUnknown = /UNKNOWN/.test(msg);
    const avoidsFalseClaim = !/nothing was changed there/i.test(msg);
    rec(
      "INDETERMINATE",
      !res.ok &&
        admitsUnknown &&
        avoidsFalseClaim &&
        after?.name === `EW · Reconciled (${STAMP})`
        ? "PASS"
        : "FAIL",
      !res.ok
        ? `refused · admits unknown=${admitsUnknown} · avoids claiming HubSpot is unchanged=${avoidsFalseClaim}`
        : "an indeterminate outcome was reported as success",
    );
  }

  // ── 12 · HUBSPOT SUCCEEDED, LOCAL FAILED ────────────────────────────────
  //
  // Driven by a unit cost that passes format validation and overflows the
  // numeric column, so the local UPDATE fails AFTER HubSpot has moved. The
  // operator must not be told nothing changed: one of the two catalogs is
  // already carrying the new values.
  {
    const [row] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const hubspotId = row!.hubspotProductId!;
    const beforeName = row!.name;
    const overflow = "9".repeat(140000); // valid decimal; exceeds numeric
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Diverged (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: overflow, url: "" }),
    );
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const localUnchanged = after?.name === beforeName;
    const remoteMoved = remote?.name === `EW · Diverged (${STAMP})`;
    const namesTheDivergence =
      !res.ok && /HubSpot was updated but Nexus could not record it/i.test(res.error.message);
    rec(
      "DIVERGENCE",
      !res.ok && namesTheDivergence && localUnchanged && remoteMoved ? "PASS" : "FAIL",
      !res.ok
        ? `refused with the divergence named=${namesTheDivergence} · local held at "${after?.name}" · hubspot moved=${remoteMoved}`
        : "a failed local write was reported as success",
    );
  }

  // ── 13 · AUDIT is atomic with the write ─────────────────────────────────
  {
    const rows = await db
      .select({ action: auditLog.action, diff: auditLog.diffJson })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, leafId), eq(auditLog.action, "leaf_updated")));
    const completion = rows.filter(
      (r) => (r.diff as Record<string, unknown> | null)?.sku_completed === true,
    );
    const reconciled = rows.filter(
      (r) => (r.diff as Record<string, unknown> | null)?.hubspot_reconciled === true,
    );
    // Every accepted edit left a row, and no refused one did: the audit and
    // the row move together or not at all.
    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const lastAudited = rows
      .map((r) => (r.diff as { after?: { name?: string } } | null)?.after?.name)
      .filter(Boolean);
    rec(
      "AUDIT:atomic",
      rows.length > 0 &&
        completion.length === 1 &&
        reconciled.length === 1 &&
        lastAudited.includes(after?.name ?? "")
        ? "PASS"
        : "FAIL",
      `${rows.length} leaf_updated rows · one marks sku_completed · ` +
        `${reconciled.length} marks hubspot_reconciled · ` +
        `the live name "${after?.name}" is accounted for by an audit row=${lastAudited.includes(after?.name ?? "")}`,
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
