/**
 * Track A · proof 6 — the authorization leaves real evidence behind.
 *
 * EXERCISED, NOT INSPECTED. The schema says `reason` is NOT NULL and the action
 * reads the approver from the database; neither of those is evidence that a
 * decision persists what a later reader needs. This drives the REAL action
 * against a real database and reads the row back.
 *
 * WHY A SCRIPT RATHER THAN A SPEC. The action imports `@/db`, and the Playwright
 * harness has no app-module alias resolution — no e2e spec in this repo imports
 * from `@/`. Bending the harness for a single test would be the larger change,
 * so this uses the same loader the Gate 1B probes use. It is exercised and
 * repeatable; it is NOT suite-integrated, and that is stated rather than
 * glossed.
 *
 * WHAT THE ROW HAS TO CARRY, and why each element:
 *
 *   approver + timestamp   who decided and when -- the decision-time authority
 *                          attribution BV-005 asks for
 *   reason                 mandatory; an approval without a why satisfies an
 *                          auditor and helps nobody read the deal a year later
 *   version + tier         the scope the approval binds to, so a revision or a
 *                          different tier cannot inherit it
 *   margin + floor         what was true when it was taken, so a later floor
 *                          change cannot rewrite the history of a decision that
 *                          was correct at the time
 *   fingerprint            what makes "material change invalidates" checkable
 *                          rather than asserted
 *
 * THE FIXTURE IS NOT MANUFACTURED. `89d2a2de` carries two genuinely below-floor
 * tiers (margins 0.184 and 0.204 against a 0.25 floor) in the validation
 * estate. Raising the firm floor to force the condition would have proved the
 * record works for a state no operator produces; per Pattern 53 the fixture
 * reads from what is there.
 *
 * Controlled test identity. NOT the post-SSO exercise with two real staff.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, belowFloorAuthorizations, quoteTiers, users } from "@/db/schema";
import { authorizeBelowFloor } from "@/app/actions/below-floor-authorization";

const QUOTE = process.env.PROOF6_QUOTE_ID ?? "89d2a2de-faac-4b8f-82a7-7078d691db22";
const REASON = "Strategic account — approved by Commercial for launch volume.";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? " · " + detail : ""}`);
  if (!ok) failures += 1;
}

const [approver] = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .where(eq(users.email, "pm@nexus-validation.invalid"))
  .limit(1);
if (!approver) throw new Error("validation identity missing");

// Grant the governed permission for the duration. Membership is deliberately
// unseeded in the estate; this is a controlled test identity.
await db.update(users).set({ commercialApprover: true }).where(eq(users.id, approver.id));

const before = new Date();
try {
  const tiers = await db
    .select({ id: quoteTiers.id, label: quoteTiers.label })
    .from(quoteTiers)
    .where(eq(quoteTiers.quoteId, QUOTE));

  let authorizedTierId: string | null = null;
  let authorizationId: string | null = null;
  for (const t of tiers) {
    const r = await authorizeBelowFloor({ quoteId: QUOTE, tierId: t.id, reason: REASON });
    if (r.ok) {
      authorizedTierId = t.id;
      authorizationId = r.data.authorizationId;
      break;
    }
  }

  console.log("\nTrack A · proof 6 — recorded authorization evidence\n");
  check("a below-floor tier was authorizable", authorizedTierId !== null);
  if (!authorizedTierId || !authorizationId) {
    console.log("\n  no below-floor tier on the fixture; proof 6 needs one.\n");
    process.exit(1);
  }

  const [row] = await db
    .select()
    .from(belowFloorAuthorizations)
    .where(eq(belowFloorAuthorizations.id, authorizationId));

  check("the authorization persisted", Boolean(row));
  check("approving actor recorded", row.approvedByUserId === approver.id, row.approvedByUserId);
  check("mandatory reason recorded verbatim", row.reason === REASON);
  const at = new Date(row.approvedAt).getTime();
  check(
    "decision timestamp is real",
    at >= before.getTime() - 1000 && at <= Date.now() + 1000,
    new Date(at).toISOString(),
  );
  check("scoped to the tier", row.tierId === authorizedTierId);
  check(
    "scoped to a quote version",
    typeof row.quoteVersionNumber === "number",
    String(row.quoteVersionNumber),
  );
  check(
    "margin at decision recorded",
    Number.isFinite(Number(row.marginAtDecision)),
    String(row.marginAtDecision),
  );
  check("floor at decision recorded", Number(row.floorAtDecision) > 0, String(row.floorAtDecision));
  check(
    "validity fingerprint recorded",
    /^rev:.*\|cost:.*\|margin:/.test(row.stateFingerprint),
    row.stateFingerprint,
  );
  check("live, not invalidated", row.invalidatedAt === null);

  const [audit] = await db
    .select({ action: auditLog.action, userId: auditLog.userId, diffJson: auditLog.diffJson })
    .from(auditLog)
    .where(and(eq(auditLog.entityId, QUOTE), eq(auditLog.action, "below_floor_authorized")))
    .limit(1);
  check("audit row written under a transition-named action", Boolean(audit));
  if (audit) {
    const d = (audit.diffJson ?? {}) as Record<string, unknown>;
    check("audit attributes the same approver", audit.userId === approver.id);
    check("audit carries the reason", d.reason === REASON);
    check("audit carries the same fingerprint", d.state_fingerprint === row.stateFingerprint);
  }

  const empty = await authorizeBelowFloor({
    quoteId: QUOTE,
    tierId: authorizedTierId,
    reason: "   ",
  });
  check("an empty reason is refused BY THE ACTION, not only the column", empty.ok === false);
} finally {
  await db.delete(belowFloorAuthorizations).where(eq(belowFloorAuthorizations.quoteId, QUOTE));
  await db
    .delete(auditLog)
    .where(and(eq(auditLog.entityId, QUOTE), eq(auditLog.action, "below_floor_authorized")));
  await db.update(users).set({ commercialApprover: false }).where(eq(users.id, approver.id));
}

console.log(
  failures === 0
    ? "\n  PASS — every required element of the record is present.\n"
    : `\n  ${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
