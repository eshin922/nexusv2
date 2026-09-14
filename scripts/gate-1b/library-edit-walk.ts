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
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { assemblies, auditLog, leafEditAttempts, leaves, quotes, users } from "@/db/schema";
import {
  confirmLeafEdit,
  createLeaf,
  releaseOrderingHold,
  retryLeafEdit,
  updateLeaf,
} from "@/app/actions/leaves";
import { pullProductsBatch } from "@/lib/hubspot-pull";
import { attachQuoteProduct } from "@/app/actions/quote-products";
import { evaluateAttachmentEligibility } from "@/lib/product-structure/attachment-eligibility";
// The fake's own store, so the walk can ask HubSpot what it actually holds
// rather than trusting the echo of the request that was sent to it.
import {
  __fakeHubspotCallCount,
  __fakeHubspotLandInflight,
  __fakeHubspotProduct,
  __fakeHubspotSetProduct,
} from "../../tests/harness/providers/fake-hubspot.ts";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** Clear any open attempt, so an unrelated later case is not blocked by it. */
async function clearOpenAttempts(id: string) {
  await db
    .update(leafEditAttempts)
    .set({ resolvedAt: new Date(), resolution: "walk_cleanup" })
    .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
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
      select id from leaves
       where name like 'EW · %'
          -- OR the fake's own minted id range. The name marker is fragile:
          -- anything that renames a row out of band -- a later case, a manual
          -- correction during a browser check -- makes it stop matching the
          -- row it created, which is how a leftover survived to collide on
          -- the hubspot_product_id unique index. The id range cannot be renamed.
          or hubspot_product_id like '998%'
          or hubspot_product_id like '996%'
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
    .select({
      assemblyId: assemblies.id,
      quoteId: assemblies.quoteId,
      projectId: quotes.projectId,
    })
    .from(assemblies)
    .innerJoin(quotes, eq(quotes.id, assemblies.quoteId))
    .where(eq(quotes.status, "draft"))
    .limit(1);
  if (!asm) {
    rec("SETUP", "BLOCKED", "no draft quote with an assembly");
    finish();
  }
  const projectId = asm.projectId;
  // The refresh is a background writer and takes its actor explicitly, unlike
  // the actions which resolve one from the session.
  const [actor] = await db.select({ id: users.id }).from(users).limit(1);
  if (!actor) {
    rec("SETUP", "BLOCKED", "no user to attribute the refresh to");
    finish();
  }
  const actorUserId = actor.id;

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
    // This case deliberately leaves an unconfirmed attempt. The RETRY case
    // below is the operator's real path out of it; clearing it here keeps the
    // two independent.
    await clearOpenAttempts(leafId);
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
    // Either refusal is correct and they mean different things: the loser was
    // either written against a version that moved, or blocked by the winner's
    // claim. What matters is that it did NOT apply.
    const staleRefusal =
      refusals.length === 1 &&
      ["STALE_WRITE", "UNCONFIRMED_EDIT"].includes(refusals[0].error.code);
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
      `${okCount}/2 accepted · the loser was refused without applying=${staleRefusal}` +
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
    // The refusal states what the read-back ESTABLISHED -- that the product
    // does not hold the requested values -- and does not upgrade that into
    // "nothing changed", which the read-back cannot support.
    const saysEstablished =
      !res.ok && /does NOT hold the requested values/.test(res.error.message);
    rec(
      "UNCERTAIN:lost",
      !res.ok && unchanged && saysEstablished ? "PASS" : "FAIL",
      !res.ok
        ? `refused: "${res.error.message.slice(0, 90)}" · local unchanged=${unchanged}`
        : "an unapplied write was reported as success",
    );
    await clearOpenAttempts(leafId);
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
    const avoidsFalseClaim = !/nothing was changed/i.test(msg);
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
    await clearOpenAttempts(leafId);
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

  // ── 12b · PARTIAL read-back ─────────────────────────────────────────────
  //
  // Some of the write landed. The read-back matches neither the requested
  // state nor the prior one, so neither "it applied" nor "nothing changed" is
  // a true statement about it -- and the second is the one that was being
  // made. All that is established is that the requested state is NOT
  // CONFIRMED, and the edit is kept so it can be recovered.
  {
    await clearOpenAttempts(leafId);
    const [row] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const hubspotId = row!.hubspotProductId!;
    const beforeName = row!.name;

    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-partial";
    const res = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `EW · Partial (${STAMP})`, sku, hubspotProductType: "Raw ingredients", unitCost: "11.00", url: "https://partial.invalid" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

    const [after] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const [attempt] = await db
      .select()
      .from(leafEditAttempts)
      .where(and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)));

    const msg = res.ok ? "" : res.error.message;
    // The name landed remotely; the cost did not. HubSpot is in a state that
    // is neither the old one nor the requested one.
    const remoteIsMixed =
      remote?.name === `EW · Partial (${STAMP})` &&
      remote?.hs_cost_of_goods_sold !== "11.00";
    const saysNotConfirmed = /does NOT hold the requested values/.test(msg);
    const avoidsNothingChanged = !/nothing was changed/i.test(msg);
    const kept = Boolean(attempt) && attempt?.outcome === "unconfirmed";
    const observedRecorded =
      (attempt?.observed as Record<string, string | null> | null)?.name ===
      `EW · Partial (${STAMP})`;

    rec(
      "PARTIAL",
      !res.ok &&
        saysNotConfirmed &&
        avoidsNothingChanged &&
        remoteIsMixed &&
        kept &&
        observedRecorded &&
        after?.name === beforeName
        ? "PASS"
        : "FAIL",
      `hubspot is partly moved (name="${remote?.name}" cost=${String(remote?.hs_cost_of_goods_sold ?? "").slice(0, 12)}) · ` +
        `says NOT CONFIRMED=${saysNotConfirmed} · avoids "nothing changed"=${avoidsNothingChanged} · ` +
        `edit kept=${kept} · what was observed is recorded=${observedRecorded} · local held at "${after?.name}"`,
    );
  }

  // ── 12c · LATE remote completion, and recovery ──────────────────────────
  //
  // A request that timed out is not a request that stopped. The read-back
  // legitimately shows the product unchanged and the write lands afterwards,
  // which is why a read-back is a statement about a MOMENT and not an
  // outcome. Recovery re-reads first: if the write completed late, nothing is
  // re-sent and the local row simply catches up.
  {
    await clearOpenAttempts(leafId);
    const [row] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const hubspotId = row!.hubspotProductId!;
    const target = `EW · Late (${STAMP})`;

    process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-late";
    const first = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: target, sku, hubspotProductType: "Raw ingredients", unitCost: "12.00", url: "" }),
    );
    delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

    const midLocal = (await db.select().from(leaves).where(eq(leaves.id, leafId)))[0];
    const midRemote = __fakeHubspotProduct(hubspotId);

    // The recovery replays THE RECORDED EDIT. Nothing is read from a form.
    const recovered = await retryLeafEdit(form({ leafId }));
    const [end] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const endRemote = __fakeHubspotProduct(hubspotId);
    const [stillOpen] = await db
      .select()
      .from(leafEditAttempts)
      .where(and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)));

    rec(
      "LATE:recovered",
      !first.ok &&
        midLocal?.name !== target &&
        midRemote?.name === target && // it DID land, after the read-back
        recovered.ok &&
        end?.name === target &&
        endRemote?.name === target &&
        !stillOpen
        ? "PASS"
        : "FAIL",
      `refused at the time=${!first.ok} · landed late in hubspot=${midRemote?.name === target} · ` +
        `recovery replayed the RECORDED edit=${recovered.ok ? recovered.data.hubspotOutcome : "refused"} · ` +
        `final local="${end?.name}" remote="${endRemote?.name}" · attempt closed=${!stillOpen}`,
    );
  }

  // ── 12d · REMOTE SKU SUCCEEDED, LOCAL ROLLED BACK, THEN A DIFFERENT SKU ─
  //
  // The dangerous shape. HubSpot accepted a SKU; the local write then failed,
  // so Nexus still shows no SKU. Ordinary editing reads the LOCAL row, sees
  // no SKU, and would happily assign a different one -- replacing an
  // identifier the catalog has already issued, with nothing anywhere
  // recording that it did.
  //
  // Local state cannot answer this, because local state is exactly what
  // failed to be written. The preserved attempt is what answers it.
  {
    const fresh = await createLeaf(
      form({ name: `EW · remote sku (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("REMOTE-SKU", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hubspotId = r0!.hubspotProductId!;
      const issued = `EW-${STAMP}-ISSUED`;

      // HubSpot applies the SKU; the local write then fails (a cost that
      // passes format validation and overflows the column).
      const diverge = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · remote sku (${STAMP})`, sku: issued, hubspotProductType: "Labels", unitCost: "9".repeat(140000), url: "" }),
      );
      const [afterDiverge] = await db.select().from(leaves).where(eq(leaves.id, id));
      const remoteAfterDiverge = __fakeHubspotProduct(hubspotId);

      // Now an ordinary edit tries a DIFFERENT SKU.
      const different = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · remote sku (${STAMP})`, sku: `EW-${STAMP}-OTHER`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );
      const [afterAttempt] = await db.select().from(leaves).where(eq(leaves.id, id));
      const remoteAfterAttempt = __fakeHubspotProduct(hubspotId);

      // A recovery may NOT change the SKU. That is the identity-bearing field
      // and the whole reason ordinary editing is blocked.
      const skuSwap = await retryLeafEdit(
        form({ leafId: id, sku: `EW-${STAMP}-SWAPPED` }),
      );

      // Replaying the record verbatim cannot settle this one: the value that
      // broke the local write is IN the record, so it breaks it again. The
      // correctable fields may be amended; the SKU stays pinned.
      const verbatim = await retryLeafEdit(form({ leafId: id }));
      const recovered = await retryLeafEdit(form({ leafId: id, unitCost: "1.00" }));
      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(hubspotId);

      const remoteHeldIssued = remoteAfterDiverge?.hs_sku === issued;
      const localHadNone = !afterDiverge?.sku;
      const refused = !different.ok && different.error.code === "UNCONFIRMED_EDIT";
      const namesTheRemoteSku =
        !different.ok && different.error.message.includes(issued);
      const remoteUntouched = remoteAfterAttempt?.hs_sku === issued;
      const swapRefused = !skuSwap.ok;
      const verbatimFailed = !verbatim.ok;
      const settled =
        recovered.ok && end?.sku === issued && endRemote?.hs_sku === issued;

      rec(
        "REMOTE-SKU",
        remoteHeldIssued &&
          localHadNone &&
          refused &&
          namesTheRemoteSku &&
          remoteUntouched &&
          swapRefused &&
          verbatimFailed &&
          settled
          ? "PASS"
          : "FAIL",
        `hubspot issued "${remoteAfterDiverge?.hs_sku}" while local had none=${localHadNone} · ` +
          `a different SKU was refused=${refused} naming the remote one=${namesTheRemoteSku} · ` +
          `remote untouched=${remoteUntouched} · recovery refused a SKU swap=${swapRefused} · ` +
          `a verbatim replay still failed=${verbatimFailed} · ` +
          `amended recovery settled BOTH at "${end?.sku}"/"${endRemote?.hs_sku}"=${settled}`,
      );
    }
  }

  // ── 12e · A REFRESH THAT FETCHED ITS SNAPSHOT BEFORE WAITING ────────────
  //
  // The refresh writes the same columns the edit authors, from a snapshot it
  // took earlier. Serialising it is not enough on its own: it queues for the
  // leaf lock, the edit commits, the lock is released, and the refresh then
  // applies data read BEFORE that edit. Acquiring a lock says nothing about
  // what happened while waiting for it.
  //
  // Constructed deterministically: the edit holds the lock across a slow
  // HubSpot call while the refresh queues behind it.
  {
    const fresh = await createLeaf(
      form({ name: `EW · refresh race (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("REFRESH:stale", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      // Point the leaf at a product the fake's catalog listing returns, so the
      // refresh has something to apply to it.
      const catalogId = "996000000000001";
      await db.execute(
        sql`update leaves set hubspot_product_id = ${catalogId} where id = ${id}`,
      );
      process.env.NEXUS_FAKE_HUBSPOT_ACTIVE_PRODUCTS = "1";

      const editedName = `EW · edited during refresh (${STAMP})`;
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-slow";
      const editPromise = updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: editedName, sku: `EW-${STAMP}-RACE`, hubspotProductType: "Labels", unitCost: "3.50", url: "" }),
      );
      // Long enough for the refresh to read its snapshot and then queue on the
      // lock the edit is already holding.
      await new Promise((r) => setTimeout(r, 400));
      const pullPromise = pullProductsBatch({
        userId: actorUserId,
        projectId,
        batchNumber: 1,
        includeArchived: false,
      });

      const [editRes, pullRes] = await Promise.all([editPromise, pullPromise]);
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
      delete process.env.NEXUS_FAKE_HUBSPOT_ACTIVE_PRODUCTS;

      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const editKept = end?.name === editedName && end?.sku === `EW-${STAMP}-RACE`;
      const declined = pullRes.skippedStale === 1 && pullRes.updated === 0;

      rec(
        "REFRESH:stale",
        editRes.ok && editKept && declined ? "PASS" : "FAIL",
        `edit accepted=${editRes.ok} · the edit survived the refresh=${editKept} ` +
          `(name="${end?.name}" sku="${end?.sku}") · refresh declined the stale write=` +
          `${declined} (skippedStale=${pullRes.skippedStale} updated=${pullRes.updated})`,
      );
    }
  }

  // ── 12f · TWO CONCURRENT RECOVERIES ─────────────────────────────────────
  //
  // Both read the same open attempt, then race. Exactly one may apply.
  //
  // The hazard is specific: a recovery is EXEMPT from the product version
  // check, because it is replaying a recorded edit rather than submitting one
  // written against a version of the row. So a recovery that finds its
  // attempt already settled -- and proceeds anyway because "no open attempt"
  // reads as "nothing blocking" -- writes with no version protection at all.
  // The check that the attempt is still open, and still the same one, is the
  // only thing standing there.
  {
    const fresh = await createLeaf(
      form({ name: `EW · double recovery (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("RECOVER:concurrent", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hubspotId = r0!.hubspotProductId!;
      const target = `EW · double recovered (${STAMP})`;

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: target, sku: `EW-${STAMP}-DBL`, hubspotProductType: "Labels", unitCost: "2.00", url: "" }),
      );
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [openBefore] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      const both = await Promise.all([
        retryLeafEdit(form({ leafId: id })),
        retryLeafEdit(form({ leafId: id })),
      ]);
      const accepted = both.filter((r) => r.ok).length;
      const refusedAsSettled = both.some(
        (r) => !r.ok && /already been settled|being\s+recovered by someone else/i.test(r.error.message),
      );

      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(hubspotId);
      const stillOpen = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      rec(
        "RECOVER:concurrent",
        Boolean(openBefore) &&
          accepted === 1 &&
          refusedAsSettled &&
          end?.name === target &&
          endRemote?.name === target &&
          stillOpen.length === 0
          ? "PASS"
          : "FAIL",
        `${accepted}/2 recoveries applied · the loser was refused as already settled=${refusedAsSettled} · ` +
          `local="${end?.name}" remote="${endRemote?.name}" · open attempts left=${stillOpen.length}`,
      );
    }
  }

  // ── 12g · RECOVERY READS BEFORE IT WRITES ───────────────────────────────
  //
  // The outstanding request completed after the read-back that failed to see
  // it. A recovery that simply re-sends would also end correct -- the update
  // is idempotent -- and would establish nothing about whether it looked
  // first. So the assertion is on the REQUEST COUNT: no second write is made
  // when HubSpot already holds the recorded values.
  {
    const fresh = await createLeaf(
      form({ name: `EW · read first (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("RECOVER:reads-first", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hubspotId = r0!.hubspotProductId!;
      const target = `EW · read first landed (${STAMP})`;

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-late";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: target, sku: `EW-${STAMP}-READ`, hubspotProductType: "Labels", unitCost: "5.00", url: "" }),
      );
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const landedLate = __fakeHubspotProduct(hubspotId)?.name === target;
      const writesBefore = __fakeHubspotCallCount("product-update");
      const recovered = await retryLeafEdit(form({ leafId: id }));
      const writesAfter = __fakeHubspotCallCount("product-update");

      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(hubspotId);

      rec(
        "RECOVER:reads-first",
        landedLate &&
          recovered.ok &&
          recovered.data.hubspotOutcome === "already_held" &&
          writesAfter === writesBefore &&
          end?.name === target &&
          endRemote?.name === target
          ? "PASS"
          : "FAIL",
        `landed late=${landedLate} · outcome=${recovered.ok ? recovered.data.hubspotOutcome : recovered.error.code} · ` +
          `writes issued by the recovery=${writesAfter - writesBefore} (must be 0) · ` +
          `local="${end?.name}" remote="${endRemote?.name}"`,
      );
    }
  }

  // ── 12h · A PROCESS KILLED BETWEEN THE REQUEST AND THE LOCAL WRITE ──────
  //
  // Really killed: SIGKILL to a child, mid-HubSpot-call. Nothing in that
  // process gets to run a cleanup path or record anything afterwards, which
  // is precisely the window an attempt written AFTER a failure does not
  // cover.
  //
  // What must survive is the claim itself -- committed before the request was
  // issued -- and with it the protection: the product cannot be edited
  // normally, and the recorded edit can still be recovered.
  {
    const fresh = await createLeaf(
      form({ name: `EW · interrupted (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("INTERRUPT", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const target = `EW · interrupted edit (${STAMP})`;
      const claimedSku = `EW-${STAMP}-INT`;
      const version = await versionOf(id);

      // The provider signals receipt here; the parent waits for it.
      const receiptPath = join(
        tmpdir(),
        `nexus-interrupt-receipt-${STAMP}-${Math.abs(Number(BigInt("0x" + id.replace(/-/g, "").slice(0, 8))))}.txt`,
      );
      try {
        rmSync(receiptPath, { force: true });
      } catch {
        /* nothing to clear */
      }

      const child = spawn(
        process.execPath,
        [
          "--env-file=.env.validation.local",
          "--experimental-strip-types",
          "--conditions=react-server",
          "--experimental-loader",
          "./scripts/support/src-resolver.mjs",
          "scripts/gate-1b/library-edit-interrupt-child.ts",
          id,
          version,
          target,
          claimedSku,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, NEXUS_FAKE_HUBSPOT_RECEIPT: receiptPath },
        },
      );
      const childExited = new Promise<number | null>((resolve) =>
        child.on("exit", (code) => resolve(code)),
      );
      let childOut = "";
      child.stdout.on("data", (d) => (childOut += String(d)));
      child.stderr.on("data", (d) => (childOut += String(d)));

      // Kill at the PROVIDER-SIDE BOUNDARY.
      //
      // Two earlier versions of this were weaker. A fixed sleep made it a race
      // that a warm machine won, so it passed on timing luck. Polling for the
      // CLAIM fixed the flakiness but proved an earlier boundary: the intent
      // was committed, which says nothing about whether a request was ever
      // issued -- and the whole point is what survives a death AFTER the
      // remote system has the request.
      //
      // The provider signals receipt and then holds. The parent waits for that
      // signal, terminates, and AWAITS THE EXIT, so nothing is asserted while
      // the child could still be writing.
      const killedAt = Date.now();
      let receiptSeen = false;
      for (let i = 0; i < 600; i++) {
        if (existsSync(receiptPath)) {
          receiptSeen = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      const claimVisible = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
      child.kill("SIGKILL");
      await childExited;
      try {
        rmSync(receiptPath, { force: true });
      } catch {
        /* best effort */
      }

      const completedAnyway = /CHILD:completed/.test(childOut);

      // The protection must hold against a process that no longer exists.
      const ordinary = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "EW · overwrite attempt", sku: `EW-${STAMP}-OTHER`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );
      // Refused, and for the claim -- not for some incidental reason. A
      // refusal that happens to occur proves nothing about the protection.
      const blocked =
        !ordinary.ok &&
        ordinary.error.code === "UNCONFIRMED_EDIT" &&
        /claimed and has not been settled/i.test(ordinary.error.message);

      const recovered = await retryLeafEdit(form({ leafId: id }));
      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const [r1] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(r1!.hubspotProductId!);

      rec(
        "INTERRUPT",
        receiptSeen &&
          !completedAnyway &&
          claimVisible.length === 1 &&
          claimVisible[0].outcome === "pending" &&
          blocked &&
          recovered.ok &&
          end?.sku === claimedSku &&
          endRemote?.hs_sku === claimedSku
          ? "PASS"
          : "FAIL",
        `HubSpot confirmed receipt of the request=${receiptSeen}; the child was ` +
          `killed ${Date.now() - killedAt}ms in and its exit awaited, ` +
          `without completing=${!completedAnyway} · ` +
          `a committed claim survived it=${claimVisible.length === 1} (outcome=${claimVisible[0]?.outcome}) · ` +
          `ordinary editing blocked=${blocked} · recovery settled both at ` +
          `"${end?.sku}"/"${endRemote?.hs_sku}"`,
      );
    }
  }

  // ── 12i · AN EDIT LANDING DURING THE REMOTE FETCH ───────────────────────
  //
  // The interval a version captured after the fetch does not cover. The
  // refresh reads HubSpot at T0 and the local row at T1; an edit completing
  // between them is already in the version captured at T1, so the swap agrees
  // and a snapshot taken BEFORE that edit is written over it. The swap was
  // comparing against the wrong instant, and it fails silently.
  {
    const fresh = await createLeaf(
      form({ name: `EW · fetch window (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("REFRESH:fetch-window", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const catalogId = "996000000000001";
      // The earlier refresh case parked a leaf on this same catalog id. Two
      // leaves cannot hold one HubSpot id, and a batch mapping onto two rows
      // would make the counts below ambiguous anyway.
      await db.execute(
        sql`update leaves set hubspot_product_id = null
             where hubspot_product_id = ${catalogId} and id <> ${id}`,
      );
      await db.execute(
        sql`update leaves set hubspot_product_id = ${catalogId} where id = ${id}`,
      );
      process.env.NEXUS_FAKE_HUBSPOT_ACTIVE_PRODUCTS = "1";

      const editedName = `EW · edited mid-fetch (${STAMP})`;
      const editedSku = `EW-${STAMP}-WINDOW`;

      // The refresh starts and blocks inside its catalog read.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-list-slow";
      const pullPromise = pullProductsBatch({
        userId: actorUserId,
        projectId,
        batchNumber: 1,
        includeArchived: false,
      });

      // The edit lands entirely INSIDE that read: after the remote snapshot
      // was taken, before a post-fetch capture would have run.
      await new Promise((r) => setTimeout(r, 400));
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const editRes = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: editedName, sku: editedSku, hubspotProductType: "Labels", unitCost: "6.50", url: "" }),
      );
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-list-slow";

      const pullRes = await pullPromise;
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
      delete process.env.NEXUS_FAKE_HUBSPOT_ACTIVE_PRODUCTS;

      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const survived = end?.name === editedName && end?.sku === editedSku;
      const declined = pullRes.skippedStale === 1 && pullRes.updated === 0;

      rec(
        "REFRESH:fetch-window",
        editRes.ok && survived && declined ? "PASS" : "FAIL",
        `the edit landed during the catalog read and survived=${survived} ` +
          `(name="${end?.name}" sku="${end?.sku}") · refresh declined it=` +
          `${declined} (skippedStale=${pullRes.skippedStale} updated=${pullRes.updated})`,
      );
    }
  }

  // ── 12j · A SUPERSEDED WORKER MUST NOT RESOLVE THE ATTEMPT ──────────────
  //
  // A first edit claims the product and goes slow. While it is out at HubSpot,
  // a recovery takes the claim over. The original then comes back and tries to
  // settle -- on the strength of an outcome that is no longer the current one.
  //
  // Every write to the attempt carries the version its worker claimed, so the
  // superseded one matches zero rows and changes nothing. Without that fence
  // it would resolve, or re-open, an attempt that now belongs to someone else.
  {
    const fresh = await createLeaf(
      form({ name: `EW · superseded (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("SUPERSEDED:resolved", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hubspotId = r0!.hubspotProductId!;

      // The original: claims, then sits in a slow HubSpot call.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-slow";
      const originalPromise = updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · original (${STAMP})`, sku: `EW-${STAMP}-SUP`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );

      // The recovery takes the claim over while it is out there.
      await new Promise((r) => setTimeout(r, 500));
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const recovery = await retryLeafEdit(form({ leafId: id }));

      const original = await originalPromise;
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const attempts = await db
        .select()
        .from(leafEditAttempts)
        .where(eq(leafEditAttempts.leafId, id));
      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(hubspotId);

      // The recovery settled it. The superseded original must not have
      // re-opened it, re-resolved it, or moved its outcome.
      const single = attempts.length === 1;
      const resolvedByRecovery =
        single && attempts[0].resolvedAt !== null && attempts[0].outcome !== "diverged";
      const originalRefused = !original.ok;

      rec(
        "SUPERSEDED:resolved",
        recovery.ok && originalRefused && single && resolvedByRecovery && end?.sku === `EW-${STAMP}-SUP`
          ? "PASS"
          : "FAIL",
        `recovery applied=${recovery.ok} · the superseded original was refused=${originalRefused}` +
          `${original.ok ? "" : ` (${original.error.code})`} · ` +
          `attempt rows=${attempts.length} outcome=${attempts[0]?.outcome} ` +
          `resolution=${attempts[0]?.resolution} · local sku="${end?.sku}" remote sku="${endRemote?.hs_sku}"`,
      );
    }
  }

  // ── 12j2 · A SUPERSEDED WORKER MUST NOT ALTER AN ATTEMPT THAT IS STILL OPEN
  //
  // The case above is settled by the `resolved` guard alone: the new owner had
  // already closed the attempt, so the stale worker found nothing to write to.
  // That is NOT evidence that the version fence does anything, and removing
  // the fence leaves it passing.
  //
  // This is the shape where the fence is the only thing standing there. The
  // new owner leaves the attempt OPEN -- an amended recovery, held for
  // confirmation -- and the superseded worker then comes back on a FAILURE
  // path. Without the version, its `markUnconfirmed` matches the open row and
  // overwrites the held state, destroying the expectation confirmation needs
  // and replacing an adjudicated outcome with a stale one.
  {
    const fresh = await createLeaf(
      form({ name: `EW · fence (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("SUPERSEDED:open", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;

      // The original claims, goes out to HubSpot, and will fail when it gets
      // back -- by which time it no longer owns the attempt.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-slow-then-lost";
      const originalPromise = updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · fence original (${STAMP})`, sku: `EW-${STAMP}-FEN`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );

      // Take the claim over the moment it appears.
      for (let i = 0; i < 200; i++) {
        const seen = await db
          .select()
          .from(leafEditAttempts)
          .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
        if (seen.length > 0) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const recovery = await retryLeafEdit(
        form({ leafId: id, name: `EW · fence amended (${STAMP})`, unitCost: "9.00" }),
      );

      const [heldBefore] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      // Now the superseded original comes back, and fails.
      const original = await originalPromise;
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [heldAfter] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      const wasHeld = heldBefore?.outcome === "ordering_unresolved";
      const stillHeld = heldAfter?.outcome === "ordering_unresolved";
      const expectationIntact = Boolean(heldAfter?.expected);
      // Confirmation must still work -- which it cannot if the held state was
      // overwritten.
      const confirmed = await confirmLeafEdit(form({ leafId: id }));

      rec(
        "SUPERSEDED:open",
        recovery.ok &&
          !original.ok &&
          wasHeld &&
          stillHeld &&
          expectationIntact &&
          confirmed.ok
          ? "PASS"
          : "FAIL",
        `the new owner held it=${wasHeld} · the superseded original failed=${!original.ok}` +
          `${original.ok ? "" : ` (${original.error.code})`} · ` +
          `the held state survived it=${stillHeld} (outcome=${heldAfter?.outcome}) · ` +
          `its expectation survived=${expectationIntact} · it can still be observed=` +
          `${confirmed.ok ? confirmed.data.observation : confirmed.error.code}`,
      );
    }
  }

  // ── 12k · A REJECTED RETRY DOES NOT CLEAR THE EARLIER UNCERTAINTY ───────
  //
  // "This retry was rejected" is a fact about the retry. It establishes
  // nothing whatever about the original request, whose outcome was never
  // confirmed and which may still have applied. Closing the claim on the
  // strength of it would discard that and unblock ordinary editing over a
  // remote state nobody has looked at.
  {
    const fresh = await createLeaf(
      form({ name: `EW · rejected retry (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("RETRY:rejected", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · rejected retry (${STAMP})`, sku: `EW-${STAMP}-REJ`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-rejected";
      const retry = await retryLeafEdit(form({ leafId: id }));
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [attempt] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      // And ordinary editing must STILL be blocked.
      const ordinary = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "EW · overwrite", sku: `EW-${STAMP}-OTHER2`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );

      const msg = retry.ok ? "" : retry.error.message;
      const saysOnlyAboutTheRetry =
        /does NOT establish anything about the earlier request/i.test(msg);
      const stillOpen = Boolean(attempt) && attempt?.outcome === "unconfirmed";
      const stillBlocked = !ordinary.ok && ordinary.error.code === "UNCONFIRMED_EDIT";

      rec(
        "RETRY:rejected",
        !retry.ok && saysOnlyAboutTheRetry && stillOpen && stillBlocked ? "PASS" : "FAIL",
        `retry refused · says it is only about the retry=${saysOnlyAboutTheRetry} · ` +
          `the claim is still open as ${attempt?.outcome ?? "RESOLVED"} · ` +
          `ordinary editing still blocked=${stillBlocked}`,
      );
    }
  }

  // ── 12l · AGREEMENT NOW, THEN THE ORIGINAL LANDS ANYWAY ─────────────────
  //
  // THE case. An amended recovery is accepted, an observation finds the two
  // catalogs agreeing, and the original request lands AFTER that.
  //
  // If agreement had released the hold -- which it did, until this case was
  // written -- the product would be editable and the catalogs would then
  // silently diverge with nothing recording it. A matching read proves
  // agreement AT THAT INSTANT. The question is what can still arrive, and a
  // read cannot answer it.
  {
    const fresh = await createLeaf(
      form({ name: `EW · agree then land (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("ORDERING:agree-then-land", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hubspotId = r0!.hubspotProductId!;
      const originalName = `EW · atl original (${STAMP})`;
      const amendedName = `EW · atl amended (${STAMP})`;

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-inflight";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: originalName, sku: `EW-${STAMP}-ATL`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const recovered = await retryLeafEdit(
        form({ leafId: id, name: amendedName, unitCost: "2.00" }),
      );

      // The observation agrees -- HubSpot really does hold the amended values
      // at this moment.
      const observedAgreeing = await confirmLeafEdit(form({ leafId: id }));

      // And the product must STILL be blocked, because agreeing now is not
      // evidence about later.
      const blockedAfterAgreement = !(
        await updateLeaf(
          form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "EW · atl edit after agreement", sku: `EW-${STAMP}-ATL`, hubspotProductType: "Labels", unitCost: "3.00", url: "" }),
        )
      ).ok;

      // NOW the original lands, after the agreement.
      const landed = __fakeHubspotLandInflight(hubspotId);
      const observedAfter = await confirmLeafEdit(form({ leafId: id }));
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(hubspotId);
      const [stillOpen] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      const agreedAtTheTime =
        observedAgreeing.ok &&
        observedAgreeing.data.observation === "agrees_now" &&
        observedAgreeing.data.released === false;
      const caught =
        observedAfter.ok && observedAfter.data.observation === "diverged";

      rec(
        "ORDERING:agree-then-land",
        recovered.ok &&
          agreedAtTheTime &&
          blockedAfterAgreement &&
          landed &&
          caught &&
          Boolean(stillOpen) &&
          end?.name === amendedName &&
          endRemote?.name === originalName
          ? "PASS"
          : "FAIL",
        `the observation agreed and released nothing=${agreedAtTheTime} · ` +
          `still blocked after agreeing=${blockedAfterAgreement} · ` +
          `the original then landed=${landed} · the next look caught it=${caught} · ` +
          `local="${end?.name}" remote="${endRemote?.name}" · claim still open=${Boolean(stillOpen)}`,
      );
    }
  }

  // ── 12m · AMENDED + already_held IS STILL HELD ──────────────────────────
  //
  // The recovery reads first, finds HubSpot ALREADY holding the amended
  // values, and sends nothing. That is a reading of an instant too -- the
  // older request can still land on top of it -- so the hold condition is the
  // AMENDMENT, not how this particular request happened to end.
  {
    const fresh = await createLeaf(
      form({ name: `EW · amended held (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("ORDERING:already-held", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hubspotId = r0!.hubspotProductId!;
      const amendedName = `EW · ah amended (${STAMP})`;

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · ah original (${STAMP})`, sku: `EW-${STAMP}-AH`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      // Put the amended values there by another route, so the recovery's
      // read-first finds them already present.
      __fakeHubspotSetProduct(hubspotId, {
        name: amendedName,
        hs_sku: `EW-${STAMP}-AH`,
        hs_cost_of_goods_sold: "4.00",
        hs_product_type: "Labels",
        hs_url: "",
      });

      const writesBefore = __fakeHubspotCallCount("product-update");
      const recovered = await retryLeafEdit(
        form({ leafId: id, name: amendedName, unitCost: "4.00" }),
      );
      const writesAfter = __fakeHubspotCallCount("product-update");

      const [attempt] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
      const blocked = !(
        await updateLeaf(
          form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "EW · ah edit", sku: `EW-${STAMP}-AH`, hubspotProductType: "Labels", unitCost: "5.00", url: "" }),
        )
      ).ok;

      rec(
        "ORDERING:already-held",
        recovered.ok &&
          recovered.data.hubspotOutcome === "ordering_unresolved" &&
          writesAfter === writesBefore &&
          attempt?.outcome === "ordering_unresolved" &&
          blocked
          ? "PASS"
          : "FAIL",
        `nothing was re-sent=${writesAfter === writesBefore} · ` +
          `outcome=${recovered.ok ? recovered.data.hubspotOutcome : recovered.error.code} · ` +
          `the claim is held as ${attempt?.outcome ?? "RESOLVED"} · editing blocked=${blocked}`,
      );
    }
  }

  // ── 12n · AMENDED + reconciled IS STILL HELD ────────────────────────────
  //
  // The recovery's own write fails without an answer and a read-back shows it
  // applied. Same exposure by a different route, and the earlier condition
  // released it immediately.
  {
    const fresh = await createLeaf(
      form({ name: `EW · amended reconciled (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("ORDERING:reconciled", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · rc original (${STAMP})`, sku: `EW-${STAMP}-RC`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );

      // The recovery applies, then reports failure; its read-back finds it.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-applied";
      const recovered = await retryLeafEdit(
        form({ leafId: id, name: `EW · rc amended (${STAMP})`, unitCost: "6.00" }),
      );
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [attempt] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
      const blocked = !(
        await updateLeaf(
          form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "EW · rc edit", sku: `EW-${STAMP}-RC`, hubspotProductType: "Labels", unitCost: "7.00", url: "" }),
        )
      ).ok;

      rec(
        "ORDERING:reconciled",
        recovered.ok &&
          recovered.data.hubspotOutcome === "ordering_unresolved" &&
          attempt?.outcome === "ordering_unresolved" &&
          blocked
          ? "PASS"
          : "FAIL",
        `outcome=${recovered.ok ? recovered.data.hubspotOutcome : recovered.error.code} · ` +
          `held as ${attempt?.outcome ?? "RESOLVED"} · editing blocked=${blocked}`,
      );
    }
  }

  // ── 12o · NOTHING RELEASES AN UNRESOLVED ORDERING ───────────────────────
  //
  // Identical replay is harmless and stays permitted; a DIFFERENT edit is
  // refused; and the release path releases nothing -- it names what a
  // reconciliation would require instead of pretending an operator's click is
  // evidence that a request stopped being in flight.
  {
    const fresh = await createLeaf(
      form({ name: `EW · release (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("ORDERING:no-release", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-lost";
      await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `EW · rel original (${STAMP})`, sku: `EW-${STAMP}-REL`, hubspotProductType: "Labels", unitCost: "1.00", url: "" }),
      );
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const recovered = await retryLeafEdit(
        form({ leafId: id, name: `EW · rel amended (${STAMP})`, unitCost: "2.00" }),
      );

      const differentEdit = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "EW · rel different", sku: `EW-${STAMP}-REL`, hubspotProductType: "Labels", unitCost: "8.00", url: "" }),
      );
      // Identical replay: the recorded intent again, unamended.
      const identicalReplay = await retryLeafEdit(form({ leafId: id }));

      const named = await releaseOrderingHold(
        form({ leafId: id, basis: "provider_ordering_guarantee" }),
      );
      const invented = await releaseOrderingHold(form({ leafId: id, basis: "i_looked" }));
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [stillOpen] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      const differentRefused =
        !differentEdit.ok && differentEdit.error.code === "ORDERING_UNRESOLVED";
      const replayAllowed = identicalReplay.ok;
      const namedRefused =
        !named.ok && /If-Match|ETag|ordering contract/i.test(named.error.message);
      const inventedRefused =
        !invented.ok && /No reconciliation basis/i.test(invented.error.message);

      rec(
        "ORDERING:no-release",
        recovered.ok &&
          differentRefused &&
          replayAllowed &&
          namedRefused &&
          inventedRefused &&
          Boolean(stillOpen)
          ? "PASS"
          : "FAIL",
        `a different edit was refused=${differentRefused} · identical replay stayed ` +
          `permitted=${replayAllowed} · a named basis refused with what it would ` +
          `require=${namedRefused} · an invented basis refused=${inventedRefused} · ` +
          `the hold survived all of it=${Boolean(stillOpen)}`,
      );
    }
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
    // The audit names HOW the remote outcome was established, not merely that
    // it was. `reconciled` means the call failed and a read-back proved it had
    // applied -- a distinction a later reader cannot reconstruct.
    const reconciled = rows.filter(
      (r) => (r.diff as Record<string, unknown> | null)?.hubspot_outcome === "reconciled",
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
