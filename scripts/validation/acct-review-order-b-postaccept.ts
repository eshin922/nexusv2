/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SUPERSEDED FOR PRODUCTION-HUBSPOT TESTING — 2026-08-12
 *
 * This harness can restore HubSpot stage/amount after Nexus Accept, but a
 * production HubSpot stage transition may trigger downstream automation that
 * restoration cannot undo.
 *
 * Do not use this script as authorization to Accept a real production HubSpot
 * deal for testing or certification.
 *
 * It may only be used with an explicitly safe validation/test deal or
 * environment where the stage transition cannot trigger production workflows.
 *
 * Context: Nexus writes to the PRODUCTION HubSpot portal 21497798 while
 * NetSuite is sandboxed (7924416_SB2) — the isolation is asymmetric. Restoring
 * stage/amount restores CRM FIELD STATE ONLY, and makes the record look
 * untouched, erasing evidence of the trigger from the record that would show it.
 *
 * PRESERVED as recovery tooling and evidence. The grouped provider assertions
 * below remain reusable once a safe validation deal or isolated portal exists.
 * See docs/validation/hubspot-stage-trigger-finding.md.
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * Accounting Review Order B — POST-ACCEPT recovery + GROUPED evidence.
 *
 * Run IMMEDIATELY after pressing governed Accept in the Nexus UI. It closes the
 * HubSpot mutation window opened by that Accept.
 *
 *   Complete → NetSuite grouped evidence → HubSpot restoration → live verify
 *
 * RESTORATION IS UNCONDITIONAL. Steps 1-3 sit in a `try`; restoration is the
 * `finally`, so it runs on every exit path including unanticipated throws. The
 * business workflow may fail; the real Root deal may not stay misstated.
 *
 * NOT a copy of Order A's verifier. A asserted FLAT-LINES-ONLY; B must prove the
 * OPPOSITE structural shape — exactly one Item Group, expanded members, and no
 * duplicate flat member lines outside it. Reusing A's assertions here would pass
 * a wrong artifact.
 *
 * `markAccepted` is NOT reproduced — governed Clerk action.
 *
 * USAGE — every restoration value is REQUIRED; there is no historical fallback:
 *   node --env-file=.env.local --experimental-strip-types \
 *     --conditions=react-server --experimental-loader ./scripts/support/src-resolver.mjs \
 *     scripts/validation/acct-review-order-b-postaccept.ts \
 *       --quote=<uuid> --tier=<uuid> --actor=<uuid> --deal=59153706532 \
 *       --stage=<fresh> --amount=<fresh> --closedate=<fresh> \
 *       --boxRate=<rate> --bottleRate=<rate>
 *
 * EXIT CONTRACT — cleanup success is NOT order success:
 *   0 · Complete succeeded, grouped provider evidence passed, restoration
 *       verified, closedate unchanged.
 *   2 · Complete and/or provider evidence FAILED, restoration verified. CRM
 *       safe. Do NOT start Order C.
 *   1 · Restoration failed or unverified. HUMAN INTERVENTION REQUIRED —
 *       highest severity regardless of Complete.
 */
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { quotes, netsuiteSoPushes, netsuiteItemGroups } from "@/db/schema";
import { runMarkComplete } from "@/lib/netsuite/mark-complete";
import { getReadClient, updateDealStage } from "@/lib/hubspot";
import { suiteQL } from "@/lib/netsuite/client";

const APPROVED_DEAL = "59153706532";        // Root · 2 Side Seal Sachets
const EXPECTED_TOTAL = 3500;
const GROUP_QTY = 1000;
const BOX_ITEM = "1024";                     // Class 10
const BOTTLE_ITEM = "66476";                 // Class 1
const EXPECTED_CLASS: Record<string, string> = { [BOX_ITEM]: "10", [BOTTLE_ITEM]: "1" };

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;
const quoteId = arg("quote"), tierId = arg("tier"), actorUserId = arg("actor"), dealId = arg("deal");
const capturedStage = arg("stage"), capturedAmountRaw = arg("amount"), capturedClosedate = arg("closedate");
const boxRateRaw = arg("boxRate"), bottleRateRaw = arg("bottleRate");

const missing = Object.entries({
  quote: quoteId, tier: tierId, actor: actorUserId, deal: dealId, stage: capturedStage,
  amount: capturedAmountRaw, closedate: capturedClosedate, boxRate: boxRateRaw, bottleRate: bottleRateRaw,
}).filter(([, v]) => !v).map(([k]) => `--${k}`);
if (missing.length) {
  console.error(`REFUSED · missing required input(s): ${missing.join(", ")}`);
  console.error(`  Restoration values MUST come from the immediately pre-Accept capture.`);
  console.error(`  Rates are required so the verifier asserts the ACTUAL negotiated split.`);
  process.exit(1);
}
if (dealId !== APPROVED_DEAL) {
  console.error(`REFUSED · deal ${dealId} is not the approved Order B target (${APPROVED_DEAL}).`);
  process.exit(1);
}
const capturedAmount = Number(capturedAmountRaw);
const boxRate = Number(boxRateRaw), bottleRate = Number(bottleRateRaw);
for (const [n, v] of [["amount", capturedAmount], ["boxRate", boxRate], ["bottleRate", bottleRate]] as const) {
  if (!Number.isFinite(v)) { console.error(`REFUSED · --${n} is not a number.`); process.exit(1); }
}
if (Math.abs((boxRate + bottleRate) * GROUP_QTY - EXPECTED_TOTAL) > 0.005) {
  console.error(`REFUSED · rates ${boxRate} + ${bottleRate} over ${GROUP_QTY} = ${(boxRate + bottleRate) * GROUP_QTY}, not ${EXPECTED_TOTAL}.`);
  console.error(`  The verifier will not assert a total the inputs cannot produce.`);
  process.exit(1);
}

const log = (s = "") => console.log(s);
const hs = getReadClient();
const readDeal = async () => (await hs.crm.deals.basicApi.getById(APPROVED_DEAL,
  ["dealstage", "amount", "closedate", "hs_lastmodifieddate"])).properties as Record<string, string | null>;

log(`Accounting Review Order B — post-Accept sequence`);
log(`  quote ${quoteId} · deal ${APPROVED_DEAL}`);
log(`  restore: stage ${capturedStage} · amount ${capturedAmount} · closedate must stay ${capturedClosedate}`);
log(`  rates  : Box ${boxRate} + Bottle ${bottleRate} = ${boxRate + bottleRate}/unit × ${GROUP_QTY} = ${EXPECTED_TOTAL}\n`);

try {
  const now = await readDeal();
  if (now.dealstage === capturedStage && Number(now.amount) === capturedAmount) {
    log(`  ⚠ post-Accept state already equals the capture — Accept may not have fired,`);
    log(`    or the capture was taken after it. Continuing; restoration is a no-op.\n`);
  } else log(`  observed post-Accept: stage ${now.dealstage} · amount ${now.amount}\n`);
} catch (e) { log(`  ⚠ could not read post-Accept state: ${(e as Error).message}\n`); }

let workflowError: unknown = null, restoreError: unknown = null;
let soId: string | null = null, tranid: string | null = null;
let restoreOk = false, closedateOk = false, evidenceOk = false;
let closedateDrift: { before: string | null; after: string | null } | null = null;

try {
  // ── 1 · Complete, via the governed path ────────────────────────────────
  try {
    log(`STEP 1 · runMarkComplete …`);
    const r = await runMarkComplete({ quoteId: quoteId!, actorUserId: actorUserId! });
    log(`  returned: ${JSON.stringify(r).slice(0, 260)}`);
  } catch (e) { workflowError = e; log(`  Complete FAILED: ${(e as Error).message}`); }

  // ── 2 · durable push state ─────────────────────────────────────────────
  let pushStatusOk = false;
  try {
    log(`\nSTEP 2 · durable push state`);
    const [p] = await db.select().from(netsuiteSoPushes)
      .where(eq(netsuiteSoPushes.quoteId, quoteId!)).orderBy(desc(netsuiteSoPushes.createdAt)).limit(1);
    if (p) {
      soId = p.netsuiteSoId ?? null; tranid = p.netsuiteSoTranid ?? null;
      pushStatusOk = p.status === "succeeded";
      log(`  status=${p.status} ${pushStatusOk ? "✓" : "✗ expected succeeded"} so=${soId ?? "-"} tranid=${tranid ?? "-"}`);
      if (p.errorDetail) log(`  error_detail: ${String(p.errorDetail).slice(0, 260)}`);
    } else log(`  no durable attempt row`);
    const [q] = await db.select({ soId: quotes.netsuiteSoId, tranid: quotes.netsuiteSoTranid, st: quotes.status })
      .from(quotes).where(eq(quotes.id, quoteId!)).limit(1);
    soId ??= q?.soId ?? null; tranid ??= q?.tranid ?? null;
    log(`  quote.status=${q?.st}`);
    if (!soId) log(`  ⚠ no Sales Order id — NOT retrying, no forward repair.`);
  } catch (e) { log(`  provider-state read failed: ${(e as Error).message}`); }

  // ── 3 · GROUPED evidence. The inverse of Order A's flat contract. ──────
  if (soId) {
    try {
      log(`\nSTEP 3 · grouped Accounting evidence`);

      // 3a · Item Group master — created/reused by the certified path only.
      const groups = await db.select().from(netsuiteItemGroups)
        .where(eq(netsuiteItemGroups.firstUsedByQuoteId, quoteId!));
      log(`  deterministic groups for this quote: ${groups.length} ${groups.length === 1 ? "✓" : "✗ expected exactly 1"}`);
      let masterOk = false;
      if (groups.length === 1) {
        const g = groups[0];
        log(`    ${g.netsuiteExternalId} → NS ${g.netsuiteInternalId} customer=${g.customerNetsuiteId}`);
        const mem = await suiteQL<Record<string, string>>(
          `SELECT item, quantity FROM itemgroupmember WHERE itemgroup = ${g.netsuiteInternalId}`);
        const byItem = new Map((mem.items as any[]).map((m) => [String(m.item), Number(m.quantity)]));
        const boxQty = byItem.get(BOX_ITEM), bottleQty = byItem.get(BOTTLE_ITEM);
        masterOk = byItem.size === 2 && boxQty === 1 && bottleQty === 1;
        log(`    master membership: Box ${BOX_ITEM}×${boxQty ?? "-"} · Bottle ${BOTTLE_ITEM}×${bottleQty ?? "-"} ${masterOk ? "✓" : "✗ expected ×1 each, exactly 2 members"}`);
        log(`    (master quantities are qtyPerParent — 1,000,000 must never appear)`);
      }

      // 3b · Sales Order shape.
      const head = await suiteQL<Record<string, string>>(
        `SELECT t.id,t.tranid,t.entity,t.status,t.custbody_dps_deal_id AS deal,t.terms
           FROM transaction t WHERE t.id = ${soId}`);
      const h = head.items[0] as any;
      log(`  header: tranid=${h?.tranid} entity=${h?.entity} terms=${h?.terms ?? "-"} deal=${h?.deal}`);
      const dealOk = String(h?.deal ?? "") === APPROVED_DEAL;
      const custOk = String(h?.entity ?? "") === "360189";
      const termsOk = !!h?.terms;

      const lines = await suiteQL<Record<string, string>>(
        `SELECT tl.item,tl.quantity,tl.rate,tl.netamount,tl.class,tl.itemtype,tl.linesequencenumber
           FROM transactionline tl WHERE tl.transaction = ${soId} AND tl.mainline='F'
          ORDER BY tl.linesequencenumber`);
      log(`  lines (${lines.items.length}):`);
      let sum = 0, zeroMembers = 0, groupRows = 0;
      const seen = new Map<string, number>();
      for (const l of lines.items as any[]) {
        sum += Number(l.netamount ?? 0);
        if (String(l.itemtype) === "Group" || String(l.itemtype) === "EndGroup") groupRows++;
        else {
          const k = String(l.item);
          seen.set(k, (seen.get(k) ?? 0) + 1);
          if (Number(l.netamount) === 0) zeroMembers++;
        }
        log(`    seq=${l.linesequencenumber} item=${l.item} type=${l.itemtype} qty=${l.quantity} rate=${l.rate} amt=${l.netamount} class=${l.class ?? "-"}`);
      }
      const memberLines = (lines.items as any[]).filter((l) => String(l.itemtype) !== "Group" && String(l.itemtype) !== "EndGroup");
      const box = memberLines.find((l) => String(l.item) === BOX_ITEM);
      const bottle = memberLines.find((l) => String(l.item) === BOTTLE_ITEM);

      const groupPresent = groupRows > 0;
      const qtyOk = Number(box?.quantity) === GROUP_QTY && Number(bottle?.quantity) === GROUP_QTY;
      const rateOk = Math.abs(Number(box?.rate) - boxRate) < 0.005 && Math.abs(Number(bottle?.rate) - bottleRate) < 0.005;
      const classOk = String(box?.class ?? "") === EXPECTED_CLASS[BOX_ITEM] && String(bottle?.class ?? "") === EXPECTED_CLASS[BOTTLE_ITEM];
      const noDupes = [...seen.values()].every((n) => n === 1);
      const totalOk = Math.abs(sum - EXPECTED_TOTAL) < 0.005;

      log(`  group structure present : ${groupPresent ? "✓" : "✗ NO GROUP — this is the wrong artifact"}`);
      log(`  expanded quantities 1000: ${qtyOk ? "✓" : `✗ box=${box?.quantity} bottle=${bottle?.quantity}`}`);
      log(`  negotiated rates        : ${rateOk ? "✓" : `✗ box=${box?.rate} bottle=${bottle?.rate}`}`);
      log(`  Item-derived Class 10/1 : ${classOk ? "✓" : `✗ box=${box?.class} bottle=${bottle?.class}`}`);
      log(`  no duplicate flat member: ${noDupes ? "✓" : "✗ a member appears outside the Group"}`);
      log(`  no $0.00 governed member: ${zeroMembers === 0 ? "✓" : `✗ ${zeroMembers}`}`);
      log(`  SO total ${sum} = ${EXPECTED_TOTAL}   : ${totalOk ? "✓" : "✗"}`);
      log(`  customer 360189 / terms / deal: ${custOk ? "✓" : "✗"} / ${termsOk ? "✓" : "✗"} / ${dealOk ? "✓" : "✗"}`);

      evidenceOk = masterOk && groupPresent && qtyOk && rateOk && classOk && noDupes
        && zeroMembers === 0 && totalOk && custOk && termsOk && dealOk && pushStatusOk;
      log(`  GROUPED PROVIDER EVIDENCE: ${evidenceOk ? "PASS" : "FAIL"}`);
    } catch (e) { log(`  evidence read failed: ${(e as Error).message}`); }
  }
} catch (fatal) {
  workflowError ??= fatal;
  log(`\n  ⚠ UNANTICIPATED failure in steps 1-3 — restoration still runs.`);
} finally {
  // ── 4 · RESTORATION, every path ─────────────────────────────────────────
  log(`\nSTEP 4 · HubSpot restoration (unconditional)`);
  try {
    await updateDealStage(APPROVED_DEAL, capturedStage!, { amount: capturedAmount });
    log(`  restore issued · stage ${capturedStage} · amount ${capturedAmount}`);
  } catch (e) { restoreError = e; log(`  ✗ RESTORE CALL FAILED: ${(e as Error).message}`); }

  // ── 5 · live verification — re-read, never trust the write ─────────────
  log(`\nSTEP 5 · live restoration verification`);
  try {
    const after = await readDeal();
    const stageOk = after.dealstage === capturedStage;
    const amountOk = Number(after.amount) === capturedAmount;
    closedateOk = (after.closedate ?? null) === capturedClosedate;
    log(`  stage    : ${after.dealstage} ${stageOk ? "✓" : "✗ EXPECTED " + capturedStage}`);
    log(`  amount   : ${after.amount} ${amountOk ? "✓" : "✗ EXPECTED " + capturedAmount}`);
    log(`  closedate: ${after.closedate} ${closedateOk ? "✓ unchanged" : "✗ CHANGED"}`);
    if (!closedateOk) {
      closedateDrift = { before: capturedClosedate, after: after.closedate ?? null };
      log(`\n  ⚠ CLOSEDATE CHANGED and Nexus never wrote it. Classify as HubSpot`);
      log(`    stage-transition behaviour BEFORE repairing. NOT patched here.`);
    }
    restoreOk = stageOk && amountOk;
  } catch (e) { restoreError ??= e; log(`  ✗ VERIFICATION READ FAILED: ${(e as Error).message}`); }
}

// ── 6 · verdict ────────────────────────────────────────────────────────────
const workflowOk = workflowError === null;
log(`\n── VERDICT ──`);
log(`  Complete succeeded   : ${workflowOk ? "YES" : "NO"}`);
log(`  grouped evidence     : ${evidenceOk ? "PASS" : "FAIL"}`);
log(`  restoration verified : ${restoreOk ? "YES" : "NO"}`);
log(`  closedate unchanged  : ${closedateOk ? "YES" : "NO"}`);
log(`  sales order          : ${tranid ?? soId ?? "none created"}`);
if (workflowError) { log(`\n  WORKFLOW / PROVIDER FAILURE — preserved through cleanup:`); log(`  ${(workflowError as Error).stack ?? String(workflowError)}`); }
if (restoreError) { log(`\n  RESTORATION FAILURE — separate finding, reported alongside:`); log(`  ${(restoreError as Error).stack ?? String(restoreError)}`); }

if (!restoreOk) {
  log(`\n  ✗ EXIT 1 · HUMAN INTERVENTION REQUIRED`);
  log(`    Root deal ${APPROVED_DEAL} is NOT verified restored.`);
  log(`    Restore manually: stage ${capturedStage} · amount ${capturedAmount}`);
  process.exit(1);
}
if (!workflowOk || !evidenceOk || !closedateOk) {
  log(`\n  ⚠ EXIT 2 · Order B FAILED CLEANLY; CRM state is safe.`);
  if (!workflowOk) log(`    - Complete failed.`);
  if (!evidenceOk) log(`    - Grouped provider evidence did not pass.`);
  if (!closedateOk) log(`    - closedate changed; classify the provider behaviour.`);
  log(`    Do NOT proceed to Order C.`);
  process.exit(2);
}
log(`\n  ✓ EXIT 0 · Order B CERTIFIED and CRM restored. SO ${tranid ?? soId}.`);
process.exit(0);
