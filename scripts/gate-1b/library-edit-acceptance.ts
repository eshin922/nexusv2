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
  users,
} from "@/db/schema";
import { createLeaf, retryLeafEdit, updateLeaf } from "@/app/actions/leaves";
import { attachQuoteProduct } from "@/app/actions/quote-products";
import { evaluateAttachmentEligibility } from "@/lib/product-structure/attachment-eligibility";
import {
  __fakeHubspotLandInflight,
  __fakeHubspotProduct,
} from "../../tests/harness/providers/fake-hubspot.ts";
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
        /Retry that saved edit/.test(different.error.message)
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

  // ── 8 · THE REMEDY: RETRY CONVERGES, AND THE SUPPORT PROCEDURE RELEASES ─
  //
  // The failure above went UNANSWERED, so the retry can bring both catalogs to
  // the saved values but cannot establish that the original request finished.
  // The product converges and stays held; releasing it is a decision someone
  // makes, with the residual risk recorded.
  {
    const retry = await retryLeafEdit(form({ leafId }));
    const [afterRetry] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const remote = __fakeHubspotProduct(hubspotId);
    const [heldAfter] = await db
      .select()
      .from(leafEditAttempts)
      .where(and(eq(leafEditAttempts.leafId, leafId), isNull(leafEditAttempts.resolvedAt)));

    if (!heldAfter) {
      // The retry released an attempt that had an unanswered request. Reported
      // rather than thrown: a control that crashes is harder to read than one
      // that says what it found.
      rec(
        "RECOVERY",
        "FAIL",
        `the retry RELEASED the claim (${
          retry.ok ? retry.data.hubspotOutcome : retry.error.code
        }) even though a dispatched request was never answered`,
      );
      finish();
    }

    // Released by the documented support procedure, attributed and recorded.
    const [actor] = await db.select({ id: users.id }).from(users).limit(1);
    const released = await db
      .update(leafEditAttempts)
      .set({
        resolvedAt: new Date(),
        resolution: "released_with_residual_risk",
        releasedWithRiskBy: actor!.id,
        releasedWithRiskAt: new Date(),
        releasedWithRiskNote: "acceptance: residual overwrite risk accepted",
        updatedAt: new Date(),
      })
      .where(eq(leafEditAttempts.id, heldAfter!.id))
      .returning({ id: leafEditAttempts.id });

    const nextEdit = await updateLeaf(
      form({ leafId, expectedUpdatedAt: await versionOf(leafId), name: `ACC · edited after release (${STAMP})`, sku, hubspotProductType: "Primary", unitCost: "55.00", url: "" }),
    );
    const [end] = await db.select().from(leaves).where(eq(leaves.id, leafId));
    const endRemote = __fakeHubspotProduct(hubspotId);

    rec(
      "RECOVERY",
      retry.ok &&
        retry.data.hubspotOutcome === "converged_unknown" &&
        afterRetry?.name === savedName &&
        remote?.name === savedName &&
        heldAfter?.outcome === "converged_unknown" &&
        released.length === 1 &&
        nextEdit.ok &&
        end?.name === `ACC · edited after release (${STAMP})` &&
        endRemote?.name === end?.name
        ? "PASS"
        : "FAIL",
      retry.ok
        ? `the retry brought both catalogs to the saved values (${retry.data.hubspotOutcome}) ` +
          `WITHOUT releasing · the support procedure released it, recorded · ` +
          `ordinary editing works again=${nextEdit.ok}`
        : `the remedy failed: ${retry.error.message}`,
    );
  }

  // ── 8b · A RETRY DOES NOT PROVE THE ORIGINAL FINISHED ───────────────────
  //
  // Original A is accepted by HubSpot and left IN FLIGHT. A retry of A
  // succeeds. If that released the claim, a different edit B would be allowed
  // -- and A landing afterwards reverts HubSpot to A's values while Nexus
  // keeps B's, with nothing reporting it.
  //
  // The retry establishes that A REQUEST carrying those values was accepted.
  // It establishes nothing about the one that was never answered. So the claim
  // converges and stays held, and B is refused.
  {
    const fresh = await createLeaf(
      form({ name: `ACC · unanswered (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("UNANSWERED", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const hsId = r0!.hubspotProductId!;
      const aName = `ACC · A (${STAMP})`;
      const bName = `ACC · B (${STAMP})`;
      const aSku = `ACC-${STAMP}-A`;

      // A is accepted and held in flight -- no answer comes back.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-inflight";
      const a1 = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: aName, sku: aSku, hubspotProductType: "Labels", unitCost: "10.00", url: "" }),
      );

      // The retry of A goes through.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const retryA = await retryLeafEdit(form({ leafId: id }));

      // B -- a DIFFERENT edit -- must be refused while A is unaccounted for.
      const b = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: bName, sku: aSku, hubspotProductType: "Labels", unitCost: "20.00", url: "" }),
      );

      // Now the original A lands, last.
      const landed = __fakeHubspotLandInflight(hsId);
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;

      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));
      const endRemote = __fakeHubspotProduct(hsId);
      const [heldAttempt] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      const convergedNotReleased =
        retryA.ok &&
        retryA.data.hubspotOutcome === "converged_unknown" &&
        heldAttempt?.outcome === "converged_unknown" &&
        heldAttempt!.dispatchedCount > heldAttempt!.answeredCount;
      const bRefused = !b.ok && b.error.code === "UNCONFIRMED_EDIT";
      // B never happened, so the late original cannot have overwritten it --
      // and both catalogs agree on A's values.
      const catalogsAgree = end?.name === aName && endRemote?.name === aName;

      rec(
        "UNANSWERED",
        !a1.ok &&
          convergedNotReleased &&
          bRefused &&
          landed &&
          catalogsAgree &&
          end?.name !== bName
          ? "PASS"
          : "FAIL",
        `the retry converged without releasing=${convergedNotReleased} ` +
          `(${retryA.ok ? retryA.data.hubspotOutcome : retryA.error.code}) · ` +
          `a different edit was refused=${bRefused} · the original then landed=${landed} · ` +
          `local="${end?.name}" remote="${endRemote?.name}" · they agree=${catalogsAgree}`,
      );
    }
  }

  // ── 8c · AN ANSWERED FAILURE RECOVERS NORMALLY ──────────────────────────
  //
  // The case that must NOT be caught by the hold above, and in practice the
  // likeliest failure: HubSpot answered and applied the edit, and only the
  // local write failed -- a database blip after a successful call. Nothing is
  // outstanding, so the retry releases and the product is editable again with
  // no decision required of anyone.
  //
  // The state is CONSTRUCTED rather than provoked. Reaching it needs a
  // transient local fault between a successful remote call and the commit, and
  // the harness has no way to inject one; a permanent fault would fail the
  // retry too and test nothing. What is under test is the behaviour given the
  // state, and that is exercised for real.
  {
    const fresh = await createLeaf(
      form({ name: `ACC · answered (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("ANSWERED", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const [r0] = await db.select().from(leaves).where(eq(leaves.id, id));
      const okSku = `ACC-${STAMP}-OK`;
      const wanted = {
        name: `ACC · answered recovered (${STAMP})`,
        sku: okSku,
        url: null,
        unitCost: "3.00",
        hubspotProductType: "Labels",
      };

      await db.insert(leafEditAttempts).values({
        leafId: id,
        hubspotProductId: r0!.hubspotProductId,
        attempted: wanted,
        submitted: {
          name: wanted.name,
          hs_sku: okSku,
          hs_cost_of_goods_sold: "3.00",
          hs_product_type: "Labels",
          hs_url: "",
        },
        outcome: "diverged",
        // HubSpot ANSWERED. One request dispatched, one answered: nothing is
        // in flight.
        dispatchedCount: 1,
        answeredCount: 1,
        reason: "acceptance: HubSpot applied it; the local write failed",
        createdBy: (await db.select({ id: users.id }).from(users).limit(1))[0]!.id,
      });

      const blockedFirst = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "ACC · answered different", sku: okSku, hubspotProductType: "Labels", unitCost: "9.00", url: "" }),
      );
      const retry = await retryLeafEdit(form({ leafId: id }));
      const openLeft = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
      const nextEdit = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `ACC · answered edited (${STAMP})`, sku: okSku, hubspotProductType: "Labels", unitCost: "4.00", url: "" }),
      );
      const [end] = await db.select().from(leaves).where(eq(leaves.id, id));

      rec(
        "ANSWERED",
        !blockedFirst.ok &&
          retry.ok &&
          retry.data.hubspotOutcome !== "converged_unknown" &&
          openLeft.length === 0 &&
          nextEdit.ok &&
          end?.name === `ACC · answered edited (${STAMP})`
          ? "PASS"
          : "FAIL",
        `a different edit was blocked first=${!blockedFirst.ok} · the retry released it=` +
          `${retry.ok ? retry.data.hubspotOutcome : retry.error.code} · nothing left open=` +
          `${openLeft.length === 0} · editable again with no decision needed=${nextEdit.ok}`,
      );
    }
  }

  // ── 8d · A PROCESS KILLED DURING THE CALL STAYS UNCERTAIN ───────────────
  //
  // The dispatch is counted in the committed claim, BEFORE the request goes
  // out. Counting it on return instead would leave a process that died
  // mid-call looking as though it had sent nothing -- so its attempt would
  // read as fully answered and a retry would release it.
  //
  // Really killed: the fake signals receipt and holds, the parent terminates
  // and awaits the exit.
  {
    const fresh = await createLeaf(
      form({ name: `ACC · interrupted (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("INTERRUPT", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const intSku = `ACC-${STAMP}-INT`;
      const receipt = join(tmpdir(), `nexus-acc-receipt-${STAMP}.txt`);
      rmSync(receipt, { force: true });

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
          await versionOf(id),
          `ACC · interrupted edit (${STAMP})`,
          intSku,
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, NEXUS_FAKE_HUBSPOT_RECEIPT: receipt },
        },
      );
      let childOut = "";
      child.stdout.on("data", (d) => (childOut += String(d)));
      const exited = new Promise((r) => child.on("exit", r));

      let received = false;
      for (let i = 0; i < 600; i++) {
        if (existsSync(receipt)) {
          received = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      child.kill("SIGKILL");
      await exited;
      rmSync(receipt, { force: true });

      const [survived] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      // The retry must NOT release it: a request was dispatched and never
      // answered, and the interruption is why.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const retry = await retryLeafEdit(form({ leafId: id }));
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
      const openAfter = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      rec(
        "INTERRUPT",
        received &&
          !/CHILD:completed/.test(childOut) &&
          survived?.dispatchedCount === 1 &&
          survived?.answeredCount === 0 &&
          retry.ok &&
          retry.data.hubspotOutcome === "converged_unknown" &&
          openAfter.length === 1
          ? "PASS"
          : "FAIL",
        `HubSpot received the request=${received}, the child was killed without ` +
          `completing=${!/CHILD:completed/.test(childOut)} · the claim survived with ` +
          `dispatched=${survived?.dispatchedCount} answered=${survived?.answeredCount} · ` +
          `the retry did NOT release it=${
            retry.ok ? retry.data.hubspotOutcome : retry.error.code
          } · still held=${openAfter.length === 1}`,
      );
    }
  }

  // ── 8e · A MATCHING READ-BACK DOES NOT CLEAR UNCERTAINTY ────────────────
  //
  // The call goes unanswered; a read-back finds the values present. That is
  // evidence about the OBJECT -- it does not say which request put them there,
  // nor that ours has finished. Counting it as an answer would clear an
  // uncertainty nothing resolved, and a retry would then release the product.
  {
    const fresh = await createLeaf(
      form({ name: `ACC · readback (${STAMP})`, sku: "", commercialKind: "product", hubspotProductType: "Labels", unitCost: "0" }),
    );
    if (!fresh.ok) {
      rec("READBACK", "BLOCKED", `could not create: ${fresh.error.message}`);
    } else {
      const id = fresh.data.leafId;
      const rbSku = `ACC-${STAMP}-RB`;

      // Applies the write, then fails without answering. The read-back that
      // follows finds the values there.
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "product-update-uncertain-applied";
      const first = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: `ACC · readback edit (${STAMP})`, sku: rbSku, hubspotProductType: "Labels", unitCost: "2.00", url: "" }),
      );
      const [afterFirst] = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));

      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "success";
      const retry = await retryLeafEdit(form({ leafId: id }));
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
      const openAfter = await db
        .select()
        .from(leafEditAttempts)
        .where(and(eq(leafEditAttempts.leafId, id), isNull(leafEditAttempts.resolvedAt)));
      const differentEdit = await updateLeaf(
        form({ leafId: id, expectedUpdatedAt: await versionOf(id), name: "ACC · readback different", sku: rbSku, hubspotProductType: "Labels", unitCost: "6.00", url: "" }),
      );

      rec(
        "READBACK",
        first.ok &&
          Boolean(afterFirst) &&
          afterFirst!.dispatchedCount > afterFirst!.answeredCount &&
          retry.ok &&
          retry.data.hubspotOutcome === "converged_unknown" &&
          openAfter.length === 1 &&
          !differentEdit.ok
          ? "PASS"
          : "FAIL",
        `the read-back matched and the local row caught up=${first.ok} · the attempt ` +
          `stayed outstanding (dispatched=${afterFirst?.dispatchedCount} answered=` +
          `${afterFirst?.answeredCount}) · the retry did NOT release it=${
            retry.ok ? retry.data.hubspotOutcome : retry.error.code
          } · still held=${openAfter.length === 1} · a different edit still refused=${
            !differentEdit.ok
          }`,
      );
    }
  }

  // ── 8f · THE ADMIN RELEASE IS CONDITIONAL ───────────────────────────────
  //
  // It releases the state that was REVIEWED. If the attempt has moved since --
  // retried, released, changed -- zero rows match, and nothing is written,
  // audit included. An audit row for a release that did not happen is a false
  // record, which is worse than none.
  {
    const [held] = await db
      .select()
      .from(leafEditAttempts)
      .where(
        and(
          eq(leafEditAttempts.outcome, "converged_unknown"),
          isNull(leafEditAttempts.resolvedAt),
        ),
      )
      .limit(1);
    if (!held) {
      rec("ADMIN:stale", "BLOCKED", "no held attempt to try this against");
    } else {
      const auditBefore = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.action, "leaf_edit_released_with_risk"));

      // A release naming a version that is no longer current.
      const stale = await db
        .update(leafEditAttempts)
        .set({
          resolvedAt: new Date(),
          resolution: "released_with_residual_risk",
          releasedWithRiskNote: "acceptance: stale version, must not apply",
          version: held.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leafEditAttempts.id, held.id),
            eq(leafEditAttempts.version, held.version - 1),
            eq(leafEditAttempts.outcome, "converged_unknown"),
            isNull(leafEditAttempts.resolvedAt),
          ),
        )
        .returning({ id: leafEditAttempts.id });

      const [stillHeld] = await db
        .select()
        .from(leafEditAttempts)
        .where(eq(leafEditAttempts.id, held.id));
      const auditAfter = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(eq(auditLog.action, "leaf_edit_released_with_risk"));

      rec(
        "ADMIN:stale",
        stale.length === 0 &&
          stillHeld?.resolvedAt === null &&
          auditAfter.length === auditBefore.length
          ? "PASS"
          : "FAIL",
        `a release naming a superseded version matched ${stale.length} rows · ` +
          `the attempt is still held=${stillHeld?.resolvedAt === null} · ` +
          `no release audit was written=${auditAfter.length === auditBefore.length}`,
      );
    }
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
