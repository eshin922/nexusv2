/**
 * Accounting Review Order A — POST-ACCEPT recovery + evidence script.
 *
 * Run IMMEDIATELY after pressing governed Accept in the Nexus UI. It closes the
 * HubSpot mutation window opened by that Accept.
 *
 *   Complete → NetSuite evidence → HubSpot restoration → live verification
 *
 * THE ONE RULE THIS SCRIPT EXISTS FOR: **restoration is unconditional.**
 * The business workflow is allowed to fail. The real HANKS deal is not allowed
 * to stay misstated. Every failure path below still reaches restoration, and the
 * original error is preserved and re-reported afterwards so cleanup can never
 * hide it.
 *
 * Deliberately NOT generalised. It is bound to one approved target and refuses
 * to run against anything else.
 *
 * `markAccepted` is NOT reproduced here — it is a governed Clerk action and
 * replicating its durable pre-write / push / transaction sequence would bypass
 * exactly the recoverability it provides.
 *
 * USAGE (all restoration values are REQUIRED — see §"capture is the authority"):
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *     --conditions=react-server --experimental-loader ./scripts/support/src-resolver.mjs \
 *     scripts/validation/acct-review-order-a-postaccept.ts \
 *       --quote=<uuid> --tier=<uuid> --actor=<uuid> \
 *       --deal=45429836294 \
 *       --stage=<pre-accept stage id> --amount=<pre-accept amount> \
 *       --closedate=<pre-accept closedate ISO>
 *
 * Exit codes: 0 = restored and verified (workflow may still have failed, and is
 * reported); 1 = RESTORATION VERIFICATION FAILED — human action required.
 */
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { quotes, netsuiteSoPushes } from "@/db/schema";
import { runMarkComplete } from "@/lib/netsuite/mark-complete";
import { getReadClient, updateDealStage } from "@/lib/hubspot";
import { suiteQL } from "@/lib/netsuite/client";

// ── The approved target. A mismatch is a refusal, not a warning. ────────────
const APPROVED_DEAL = "45429836294"; // HANKS · Sample Shipping Charges
const EXPECTED_TOTAL = 4500;

const arg = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const quoteId = arg("quote");
const tierId = arg("tier");
const actorUserId = arg("actor");
const dealId = arg("deal");
const capturedStage = arg("stage");
const capturedAmountRaw = arg("amount");
const capturedClosedate = arg("closedate");

// ── Preconditions. Refuse rather than improvise. ───────────────────────────
//
// CAPTURE IS THE AUTHORITY. These are required inputs taken from the
// IMMEDIATELY pre-Accept capture. There is deliberately no hardcoded fallback
// to the historical 685.92: a stale constant silently restoring the wrong value
// is worse than a refusal, because it looks like success.
const missing = Object.entries({
  quote: quoteId, tier: tierId, actor: actorUserId, deal: dealId,
  stage: capturedStage, amount: capturedAmountRaw, closedate: capturedClosedate,
})
  .filter(([, v]) => !v)
  .map(([k]) => `--${k}`);
if (missing.length) {
  console.error(`REFUSED · missing required input(s): ${missing.join(", ")}`);
  console.error(`  Restoration values MUST come from the immediately pre-Accept`);
  console.error(`  capture. This script has no historical fallback by design.`);
  process.exit(1);
}
if (dealId !== APPROVED_DEAL) {
  console.error(`REFUSED · deal ${dealId} is not the approved Order A target (${APPROVED_DEAL}).`);
  process.exit(1);
}
const capturedAmount = Number(capturedAmountRaw);
if (!Number.isFinite(capturedAmount)) {
  console.error(`REFUSED · --amount=${capturedAmountRaw} is not a number.`);
  process.exit(1);
}

const log = (s: string) => console.log(s);
const hs = getReadClient();
const readDeal = async () => {
  const d = await hs.crm.deals.basicApi.getById(APPROVED_DEAL, [
    "dealstage", "amount", "closedate", "hs_lastmodifieddate",
  ]);
  return d.properties as Record<string, string | null>;
};

log(`Accounting Review Order A — post-Accept sequence`);
log(`  quote ${quoteId} · tier ${tierId} · deal ${APPROVED_DEAL}`);
log(`  restore target: stage ${capturedStage} · amount ${capturedAmount}`);
log(`  closedate must remain: ${capturedClosedate}\n`);

// Sanity read of the post-Accept state. If it already equals the captured
// values, either Accept did not fire or the capture was taken too late — say
// so loudly, then continue: restoring to the captured values is harmless.
try {
  const now = await readDeal();
  if (now.dealstage === capturedStage && Number(now.amount) === capturedAmount) {
    log(`  ⚠ post-Accept state already equals the captured baseline.`);
    log(`    Either Accept did not fire, or the capture was taken AFTER it.`);
    log(`    Continuing — restoration to these values is a safe no-op.\n`);
  } else {
    log(`  observed post-Accept: stage ${now.dealstage} · amount ${now.amount}\n`);
  }
} catch (e) {
  log(`  ⚠ could not read post-Accept state: ${(e as Error).message}\n`);
}

let workflowError: unknown = null;
let completeResult: unknown = null;
let soId: string | null = null;
let tranid: string | null = null;
let restoreOk = false;
let closedateDrift: { before: string | null; after: string | null } | null = null;

// ═══ THE MUTATION WINDOW ════════════════════════════════════════════════════
//
// Steps 1-3 sit inside a `try`; restoration is the `finally`. Not defensive
// styling — the individual catches below only cover failures I ANTICIPATED, and
// an unanticipated throw between them would skip restoration and leave a real
// deal misstated. `finally` removes that entire class: restoration runs on
// every exit path out of this block, including ones I did not think of.
try {

// ── 1 · Complete. The governed path, not a reimplementation. ───────────────
try {
  log(`STEP 1 · runMarkComplete …`);
  completeResult = await runMarkComplete({ quoteId: quoteId!, actorUserId: actorUserId! });
  log(`  Complete returned: ${JSON.stringify(completeResult).slice(0, 300)}`);
} catch (e) {
  workflowError = e;
  log(`  Complete FAILED: ${(e as Error).message}`);
}

// ── 2 · Durable provider state. Best-effort; never blocks restoration. ─────
try {
  log(`\nSTEP 2 · durable push state`);
  const [push] = await db
    .select()
    .from(netsuiteSoPushes)
    .where(eq(netsuiteSoPushes.quoteId, quoteId!))
    .orderBy(desc(netsuiteSoPushes.createdAt))
    .limit(1);
  if (push) {
    soId = push.netsuiteSoId ?? null;
    tranid = push.netsuiteSoTranid ?? null;
    log(`  attempt status=${push.status} error_class=${push.errorClass ?? "-"}`);
    log(`  netsuite_so_id=${soId ?? "-"} tranid=${tranid ?? "-"} amount_pushed=${push.amountPushed ?? "-"}`);
    if (push.errorDetail) log(`  error_detail: ${String(push.errorDetail).slice(0, 300)}`);
  } else {
    log(`  no durable attempt row found`);
  }
  const [q] = await db
    .select({
      status: quotes.status,
      soId: quotes.netsuiteSoId,
      tranid: quotes.netsuiteSoTranid,
      pushStatus: quotes.netsuiteSoPushStatus,
    })
    .from(quotes)
    .where(eq(quotes.id, quoteId!))
    .limit(1);
  log(`  quote.status=${q?.status} push_status=${q?.pushStatus ?? "-"} so=${q?.soId ?? "-"} tranid=${q?.tranid ?? "-"}`);
  soId ??= q?.soId ?? null;
  tranid ??= q?.tranid ?? null;

  // NO automatic second CREATE, and no forward repair merely to obtain an
  // artifact. A missing SO is evidence, not a problem to paper over.
  if (!soId) log(`  ⚠ no Sales Order id — NOT retrying. Recorded as-is.`);
} catch (e) {
  log(`  provider-state read failed: ${(e as Error).message}`);
}

// ── 3 · SO evidence, only if one exists. Never blocks restoration. ─────────
if (soId) {
  try {
    log(`\nSTEP 3 · Accounting control SO evidence`);
    const head = await suiteQL<Record<string, string>>(
      `SELECT t.id, t.tranid, t.entity, t.status, t.custbody_dps_deal_id AS deal
         FROM transaction t WHERE t.id = ${soId}`,
    );
    log(`  header: ${JSON.stringify(head.items[0] ?? {})}`);
    const lines = await suiteQL<Record<string, string>>(
      `SELECT tl.item, tl.quantity, tl.rate, tl.netamount, tl.class
         FROM transactionline tl
        WHERE tl.transaction = ${soId} AND tl.mainline = 'F'
        ORDER BY tl.linesequencenumber`,
    );
    log(`  lines (${lines.items.length}):`);
    let sum = 0;
    for (const l of lines.items as any[]) {
      sum += Number(l.netamount ?? 0);
      log(`    item=${l.item} qty=${l.quantity} rate=${l.rate} amount=${l.netamount} class=${l.class ?? "-"}`);
      if (Number(l.netamount) === 0) log(`      ⚠ zero-amount governed commercial line`);
    }
    log(`  line sum=${sum} · expected ${EXPECTED_TOTAL} · ${sum === EXPECTED_TOTAL ? "MATCH" : "MISMATCH"}`);
    const groups = (lines.items as any[]).filter((l) => String(l.item ?? "").length && l.quantity === null);
    log(`  flat-lines-only check: ${groups.length === 0 ? "no group rows detected ✓" : "GROUP ROWS PRESENT ✗"}`);
  } catch (e) {
    log(`  SO evidence read failed: ${(e as Error).message}`);
  }
}

} catch (fatal) {
  // An unanticipated failure inside steps 1-3. Recorded, not swallowed; the
  // `finally` below still restores the deal.
  workflowError ??= fatal;
  log(`\n  ⚠ UNANTICIPATED failure in steps 1-3 — restoration still runs.`);
} finally {

// ── 4 · RESTORATION. Reached on EVERY path above, anticipated or not. ──────
log(`\nSTEP 4 · HubSpot restoration (unconditional)`);
try {
  await updateDealStage(APPROVED_DEAL, capturedStage!, { amount: capturedAmount });
  log(`  restore issued · stage ${capturedStage} · amount ${capturedAmount}`);
} catch (e) {
  log(`  ✗ RESTORE CALL FAILED: ${(e as Error).message}`);
}

// ── 5 · Live verification. Re-read; never trust the write's return value. ──
log(`\nSTEP 5 · live restoration verification`);
try {
  const after = await readDeal();
  const stageOk = after.dealstage === capturedStage;
  // Compare numerically: HubSpot may echo "685.92" or "685.9200".
  const amountOk = Number(after.amount) === capturedAmount;
  const closedateOk = (after.closedate ?? null) === capturedClosedate;

  log(`  stage    : ${after.dealstage} ${stageOk ? "✓ restored" : "✗ EXPECTED " + capturedStage}`);
  log(`  amount   : ${after.amount} ${amountOk ? "✓ restored" : "✗ EXPECTED " + capturedAmount}`);
  log(`  closedate: ${after.closedate} ${closedateOk ? "✓ unchanged" : "✗ CHANGED from " + capturedClosedate}`);

  if (!closedateOk) {
    closedateDrift = { before: capturedClosedate, after: after.closedate ?? null };
    log(`\n  ⚠ CLOSEDATE CHANGED and Nexus never wrote it.`);
    log(`    Classify as HubSpot stage-transition behaviour BEFORE repairing.`);
    log(`    NOT patched here — silently rewriting it would erase the evidence.`);
  }

  restoreOk = stageOk && amountOk;
} catch (e) {
  log(`  ✗ VERIFICATION READ FAILED: ${(e as Error).message}`);
}

} // ═══ end finally — mutation window closed ═════════════════════════════════

// ── 6 · Verdict. The workflow error survives cleanup. ──────────────────────
log(`\n── VERDICT ──`);
log(`  restoration verified : ${restoreOk ? "YES" : "NO"}`);
log(`  sales order          : ${tranid ?? soId ?? "none created"}`);
log(`  closedate drift      : ${closedateDrift ? "YES — classify before repair" : "none"}`);
if (workflowError) {
  log(`\n  WORKFLOW FAILED — preserved through cleanup, not swallowed:`);
  log(`  ${(workflowError as Error).stack ?? String(workflowError)}`);
}

if (!restoreOk) {
  log(`\n  ✗ HANKS deal ${APPROVED_DEAL} is NOT verified restored. HUMAN ACTION REQUIRED.`);
  log(`    Restore manually: stage ${capturedStage} · amount ${capturedAmount}`);
  process.exit(1);
}
log(`\n  ✓ HANKS deal restored and verified. Mutation window CLOSED.`);
if (workflowError) log(`    (The Accounting artifact failed; the deal is clean. Classify the failure.)`);
process.exit(0);
