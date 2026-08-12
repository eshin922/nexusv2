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
 * EXIT CONTRACT — cleanup success is NOT order success:
 *   0 · Complete succeeded, provider evidence passed, restoration verified,
 *       closedate unchanged. Accounting Order A completed and CRM restored.
 *   2 · Complete and/or provider evidence FAILED, but stage + amount were
 *       restored and verified. Order failed cleanly; CRM is safe. Do NOT
 *       start Order B until the failure is classified.
 *   1 · Restoration failed or unverified. HUMAN INTERVENTION REQUIRED — the
 *       highest severity outcome, regardless of whether Complete succeeded.
 *
 * Both the workflow error and any restoration error are reported when both
 * exist; cleanup never overwrites the original failure evidence.
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
let closedateOk = false;
let evidenceOk = false;
let restoreError: unknown = null;
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
    const totalOk = sum === EXPECTED_TOTAL;
    log(`  line sum=${sum} · expected ${EXPECTED_TOTAL} · ${totalOk ? "MATCH" : "MISMATCH"}`);
    const groups = (lines.items as any[]).filter((l) => String(l.item ?? "").length && l.quantity === null);
    const flatOnly = groups.length === 0;
    log(`  flat-lines-only check: ${flatOnly ? "no group rows detected ✓" : "GROUP ROWS PRESENT ✗"}`);
    const zeroLines = (lines.items as any[]).filter((l) => Number(l.netamount) === 0).length;
    const dealOk = String((head.items[0] as any)?.deal ?? "") === APPROVED_DEAL;
    log(`  deal id on SO: ${dealOk ? "matches ✓" : "MISMATCH ✗"} · zero-amount lines: ${zeroLines}`);

    // The provider-evidence verdict. Exit 0 requires ALL of it — a partially
    // correct Accounting artifact is not an Accounting artifact.
    evidenceOk =
      totalOk && flatOnly && dealOk && zeroLines === 0 && lines.items.length === 3;
    log(`  PROVIDER EVIDENCE: ${evidenceOk ? "PASS" : "FAIL"}`);
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
  restoreError = e;
  log(`  ✗ RESTORE CALL FAILED: ${(e as Error).message}`);
}

// ── 5 · Live verification. Re-read; never trust the write's return value. ──
log(`\nSTEP 5 · live restoration verification`);
try {
  const after = await readDeal();
  const stageOk = after.dealstage === capturedStage;
  // Compare numerically: HubSpot may echo "685.92" or "685.9200".
  const amountOk = Number(after.amount) === capturedAmount;
  closedateOk = (after.closedate ?? null) === capturedClosedate;

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
  restoreError ??= e;
  log(`  ✗ VERIFICATION READ FAILED: ${(e as Error).message}`);
}

} // ═══ end finally — mutation window closed ═════════════════════════════════

// ── 6 · Verdict. The workflow error survives cleanup. ──────────────────────
const workflowOk = workflowError === null;

log(`\n── VERDICT ──`);
log(`  Complete succeeded   : ${workflowOk ? "YES" : "NO"}`);
log(`  provider evidence    : ${evidenceOk ? "PASS" : "FAIL"}`);
log(`  restoration verified : ${restoreOk ? "YES" : "NO"}`);
log(`  closedate unchanged  : ${closedateOk ? "YES" : "NO"}`);
log(`  sales order          : ${tranid ?? soId ?? "none created"}`);
log(`  closedate drift      : ${closedateDrift ? "YES — classify before repair" : "none"}`);

// BOTH errors are reported when both exist. A cleanup failure must never
// overwrite the evidence of why the business step failed — they are different
// findings with different owners, and collapsing them loses one.
if (workflowError) {
  log(`\n  WORKFLOW / PROVIDER FAILURE — preserved through cleanup:`);
  log(`  ${(workflowError as Error).stack ?? String(workflowError)}`);
}
if (restoreError) {
  log(`\n  RESTORATION FAILURE — separate finding, reported alongside the above:`);
  log(`  ${(restoreError as Error).stack ?? String(restoreError)}`);
}

// ── EXIT CONTRACT ─────────────────────────────────────────────────────────
//
// Cleanup success is NOT order success. The two were conflated before: a
// restored deal exited 0 even when no Accounting artifact existed, which would
// have read as "Order A done" and licensed starting Order B on a failed order.
//
//   1 · restoration failed or unverified   → HUMAN INTERVENTION REQUIRED.
//       Highest severity, regardless of whether Complete succeeded. A real
//       commercial deal is left misstated; nothing else outranks that.
//   2 · order failed, CRM safe             → failed cleanly. Do NOT start B.
//   0 · order complete AND CRM restored    → the only success.
if (!restoreOk) {
  log(`\n  ✗ EXIT 1 · HUMAN INTERVENTION REQUIRED`);
  log(`    HANKS deal ${APPROVED_DEAL} is NOT verified restored.`);
  log(`    Restore manually: stage ${capturedStage} · amount ${capturedAmount}`);
  log(`    Stop all review-set execution until this deal is clean.`);
  process.exit(1);
}

if (!workflowOk || !evidenceOk || !closedateOk) {
  log(`\n  ⚠ EXIT 2 · Accounting Order A FAILED CLEANLY; CRM state is safe.`);
  log(`    HANKS restored and verified. The Accounting artifact is not valid.`);
  if (!workflowOk) log(`    - Complete failed.`);
  if (!evidenceOk) log(`    - Provider evidence did not pass.`);
  if (!closedateOk) log(`    - closedate changed; classify the provider behaviour.`);
  log(`    Do NOT proceed to Order B until the failure is classified.`);
  process.exit(2);
}

log(`\n  ✓ EXIT 0 · Accounting Order A COMPLETED and CRM state restored.`);
log(`    SO ${tranid ?? soId} · HANKS restored and verified. Window CLOSED.`);
process.exit(0);
