/**
 * Below-floor approval certification — evidence harness. READ-ONLY by default.
 *
 * The live workflow being certified:
 *
 *   Ed requests -> Slack -> Amy approves -> authorization persists
 *   -> progression opens -> SEND gate accepts
 *
 * Two steps in that chain are clicks in Slack by two different people, so this
 * cannot be a single script that "runs the certification". It is the instrument
 * either side of the human steps: it records a BASELINE before anything is
 * requested, and CHECKS the world against that baseline afterwards.
 *
 * ── WHY A BASELINE AT ALL ────────────────────────────────────────────────
 *
 * "No authority or commercial-state drift outside the approval record" is a
 * claim about what did NOT change. It cannot be established after the fact from
 * a single reading: every value would look plausible. It needs a before.
 *
 * Usage:
 *   … below-floor-certification.ts baseline   # write the baseline file
 *   … below-floor-certification.ts check      # compare + report
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { belowFloorAuthorizations } from "@/db/schema";
import { getCostingBundle } from "@/app/actions/costing";
import {
  evaluateBelowFloorAuthorization,
  fingerprintCommercialState,
} from "@/lib/below-floor-authorization";
import { evaluateProgression } from "@/lib/pricing-progression";
import { projectApprovalTierState } from "@/lib/below-floor-approval-state";
import { loadApprovalStateByTier } from "@/lib/below-floor-approval-loader";

const QUOTE_ID = "f2db6e10-8a38-4f95-b81b-e016c448b677";
const TIER_ID = "e0de4538-6ed6-48c7-89d4-af757b4797d0";
const ED = "e60b5670-86d8-437b-9654-36a1284c7b19";
const AMY = "46b2afe4-4a9d-4c9c-ba00-c7af2dd0ae75";

/** Outside the repo: an evidence file is not source, and must not be committed. */
const BASELINE =
  process.env.BF_CERT_BASELINE ??
  "C:/Users/edwar/AppData/Local/Temp/claude/C--Code-nexusv2/08fcb149-ec61-492c-9e35-f891a4d885b2/scratchpad/below-floor-baseline.json";

type Row = Record<string, unknown>;

/** Everything that must not move, plus the things that must. */
async function snapshot() {
  const users = (await db.execute(sql`
    select email, role::text as role, commercial_approver, can_edit_specs,
           can_create_leaves, binding_state::text as binding_state,
           (clerk_user_id is not null) as has_clerk,
           slack_user_id
      from users order by email`)) as unknown as Row[];

  const quote = (await db.execute(sql`
    select status::text as status, version_number, global_price_adj_pct,
           target_margin_pct, sent_at, accepted_at
      from quotes where id = ${QUOTE_ID}::uuid`)) as unknown as Row[];

  const bundle = await getCostingBundle(QUOTE_ID);
  const tier = bundle.ok
    ? bundle.data.costing.quoteRollup.find((r) => r.tierId === TIER_ID)
    : null;

  const requests = (await db.execute(sql`
    select id, status, requested_by_user_id, decided_by_user_id, decision_reason,
           state_fingerprint, delivery_status, authorization_id, slack_channel_id,
           (slack_message_ts is not null) as posted
      from below_floor_approval_requests where quote_id = ${QUOTE_ID}::uuid
      order by requested_at`)) as unknown as Row[];

  const auths = (await db.execute(sql`
    select id, tier_id, quote_version_number, approved_by_user_id,
           state_fingerprint, invalidated_at, reason
      from below_floor_authorizations where quote_id = ${QUOTE_ID}::uuid
      order by created_at`)) as unknown as Row[];

  const audits = (await db.execute(sql`
    select action, count(*)::int n from audit_log
     where entity_id = ${QUOTE_ID} group by action order by action`)) as unknown as Row[];

  return {
    users,
    quote: quote[0] ?? null,
    tier: tier
      ? {
          label: tier.label,
          status: tier.blendedMarginStatus,
          marginPct: tier.blendedMarginPct,
          totalRevenue: tier.totalRevenue,
          totalCost: tier.totalCost,
          fingerprint: fingerprintCommercialState({
            totalRevenue: tier.totalRevenue,
            totalCost: tier.totalCost,
            blendedMarginPct: tier.blendedMarginPct,
          }),
        }
      : null,
    requests,
    auths,
    audits,
  };
}

// ── reporting ─────────────────────────────────────────────────────────────

const results: Array<{ name: string; got: string; want: string }> = [];
const rec = (name: string, got: unknown, want: unknown) =>
  results.push({ name, got: String(got), want: String(want) });

function report(title: string) {
  console.log(`\n${title}\n`);
  let failed = 0;
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failed++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${r.name.padEnd(58)} ${ok ? r.got : `got ${r.got}, want ${r.want}`}`,
    );
  }
  console.log(`\n${failed === 0 ? "ALL CHECKS PASS" : `${failed} FAILURE(S)`}`);
  return failed;
}

async function main() {
  const mode = process.argv[2];

  if (mode === "baseline") {
    const snap = await snapshot();
    writeFileSync(BASELINE, JSON.stringify(snap, null, 2));
    console.log("BASELINE RECORDED\n");
    console.log("  quote          :", QUOTE_ID);
    console.log("  tier           :", snap.tier?.label, snap.tier?.status,
      `${((snap.tier?.marginPct as number) * 100).toFixed(2)}%`);
    console.log("  fingerprint    :", snap.tier?.fingerprint);
    console.log("  requests       :", snap.requests.length);
    console.log("  authorizations :", snap.auths.length);
    console.log("  approvers      :",
      snap.users.filter((u) => u.commercial_approver === true).map((u) => u.email).join(", "));
    console.log(`\nWritten to ${BASELINE}. Now: Ed raises the request.`);
    process.exit(0);
  }

  if (mode !== "check") {
    console.error("usage: baseline | check");
    process.exit(1);
  }

  if (!existsSync(BASELINE)) {
    console.error(`No ${BASELINE}. Run \`baseline\` before the workflow starts.`);
    process.exit(1);
  }
  const before = JSON.parse(readFileSync(BASELINE, "utf8")) as Awaited<ReturnType<typeof snapshot>>;
  const after = await snapshot();

  // ── 1 · the approval record itself ──────────────────────────────────────
  rec("a request exists", after.requests.length, 1);
  const req = after.requests[0] as Row | undefined;
  if (req) {
    rec("  requested by Ed", req.requested_by_user_id, ED);
    rec("  delivered to Slack", req.delivery_status, "delivered");
    rec("  posted to the governed channel", req.posted, "true");
    rec("  status", req.status, "approved");
    rec("  decided by Amy — NOT the requester", req.decided_by_user_id, AMY);
    rec("  carries its authorization", req.authorization_id === null ? "null" : "set", "set");
    rec(
      "  fingerprint matches current economics",
      req.state_fingerprint,
      after.tier?.fingerprint,
    );
  }

  rec("exactly one authorization", after.auths.length, 1);
  const auth = after.auths[0] as Row | undefined;
  if (auth) {
    rec("  approved by Amy", auth.approved_by_user_id, AMY);
    rec("  scoped to the blocking tier", auth.tier_id, TIER_ID);
    rec("  scoped to this version", auth.quote_version_number, before.quote?.version_number);
    rec("  fingerprint is current", auth.state_fingerprint, after.tier?.fingerprint);
    rec("  live (not invalidated)", auth.invalidated_at === null ? "live" : "invalidated", "live");
  }

  // ── 2 · Slack identity: bound by the decision, and never authority ───────
  const amyBefore = before.users.find((u) => u.email === "amy@thedps.co");
  const amyAfter = after.users.find((u) => u.email === "amy@thedps.co");
  rec("Amy had no Slack binding before", amyBefore?.slack_user_id === null ? "none" : "bound", "none");
  rec("Amy's Slack id bound by her decision", amyAfter?.slack_user_id ? "bound" : "none", "bound");
  rec("Amy's authority unchanged by binding", amyAfter?.commercial_approver, true);
  rec("Amy's role unchanged", amyAfter?.role, amyBefore?.role);

  // ── 3 · the gate, evaluated exactly as markAccepted/sendQuote evaluate ──
  const live = await db
    .select({
      id: belowFloorAuthorizations.id,
      quoteVersionNumber: belowFloorAuthorizations.quoteVersionNumber,
      tierId: belowFloorAuthorizations.tierId,
      approvedByUserId: belowFloorAuthorizations.approvedByUserId,
      stateFingerprint: belowFloorAuthorizations.stateFingerprint,
      invalidatedAt: belowFloorAuthorizations.invalidatedAt,
    })
    .from(belowFloorAuthorizations)
    .where(eq(belowFloorAuthorizations.quoteId, QUOTE_ID));

  const scope = {
    quoteVersionNumber: Number(after.quote?.version_number),
    tierId: TIER_ID,
  };
  const fp = after.tier?.fingerprint as string;

  rec(
    "gate ACCEPTS Ed acting on Amy's approval",
    evaluateBelowFloorAuthorization({ authorizations: live, scope, currentFingerprint: fp, operatorUserId: ED }).ok,
    true,
  );
  rec(
    "gate REFUSES Amy acting on her own approval",
    (() => {
      const v = evaluateBelowFloorAuthorization({ authorizations: live, scope, currentFingerprint: fp, operatorUserId: AMY });
      return v.ok ? "ALLOWED" : v.code;
    })(),
    "SELF_APPROVAL",
  );
  rec(
    "gate REFUSES a moved fingerprint",
    (() => {
      const v = evaluateBelowFloorAuthorization({ authorizations: live, scope, currentFingerprint: fp + "|moved", operatorUserId: ED });
      return v.ok ? "ALLOWED" : v.code;
    })(),
    "STATE_CHANGED",
  );
  rec(
    "gate REFUSES a different tier",
    (() => {
      const v = evaluateBelowFloorAuthorization({ authorizations: live, scope: { ...scope, tierId: "00000000-0000-0000-0000-000000000000" }, currentFingerprint: fp, operatorUserId: ED });
      return v.ok ? "ALLOWED" : v.code;
    })(),
    "NO_AUTHORIZATION",
  );
  rec(
    "gate REFUSES a later version",
    (() => {
      const v = evaluateBelowFloorAuthorization({ authorizations: live, scope: { ...scope, quoteVersionNumber: scope.quoteVersionNumber + 1 }, currentFingerprint: fp, operatorUserId: ED });
      return v.ok ? "ALLOWED" : v.code;
    })(),
    "NO_AUTHORIZATION",
  );

  // ── 4 · progression, through the surface's own predicate ────────────────
  const { states } = await loadApprovalStateByTier({
    quoteId: QUOTE_ID,
    quoteVersionNumber: scope.quoteVersionNumber,
    fingerprintByTier: new Map([[TIER_ID, fp]]),
  });
  const tiers = [{ tierId: TIER_ID, label: String(after.tier?.label), blendedStatus: "BELOW_FLOOR" as const }];

  rec("approval projects as approved", states[TIER_ID]?.kind, "approved");
  rec(
    "progression BEFORE approval was blocked",
    evaluateProgression({ tiers, approvalByTier: {}, unknownCellCount: 0 }).allowed,
    false,
  );
  rec(
    "progression AFTER approval is allowed",
    evaluateProgression({ tiers, approvalByTier: states, unknownCellCount: 0 }).allowed,
    true,
  );

  // ── 5 · no drift outside the approval record ────────────────────────────
  for (const b of before.users) {
    const a = after.users.find((u) => u.email === b.email);
    for (const col of ["role", "commercial_approver", "can_edit_specs", "can_create_leaves", "binding_state", "has_clerk"]) {
      rec(`no drift · ${b.email} ${col}`, a?.[col], b[col]);
    }
  }
  for (const col of ["global_price_adj_pct", "target_margin_pct", "version_number"]) {
    rec(`no drift · quote ${col}`, after.quote?.[col], before.quote?.[col]);
  }
  rec("commercial state unmoved · revenue", after.tier?.totalRevenue, before.tier?.totalRevenue);
  rec("commercial state unmoved · cost", after.tier?.totalCost, before.tier?.totalCost);
  rec("commercial state unmoved · fingerprint", after.tier?.fingerprint, before.tier?.fingerprint);

  const n = report("BELOW-FLOOR APPROVAL — LIVE CERTIFICATION");
  console.log("\nAudit actions on this quote:");
  for (const a of after.audits) console.log(`  ${String(a.action).padEnd(42)} ${a.n}`);
  process.exit(n === 0 ? 0 : 1);
}

void main();
