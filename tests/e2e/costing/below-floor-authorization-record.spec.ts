/**
 * Track A · proof 6 — the authorization leaves real evidence behind.
 *
 * EXERCISED, NOT INSPECTED. The schema says `reason` is NOT NULL and the action
 * reads the approver from the database; neither of those is evidence that a
 * decision actually persists what a later reader needs. This drives the real
 * action against a real database and reads the row back.
 *
 * WHAT THE ROW HAS TO CARRY, and why each one:
 *
 *   approver + timestamp   who decided, and when — the attribution BV-005 calls
 *                          decision-time authority evidence
 *   reason                 mandatory; an approval without a why satisfies an
 *                          auditor and helps nobody read the deal later
 *   version + tier         the scope the approval is bound to, so a revision or
 *                          a different tier cannot inherit it
 *   margin + floor         what was true when it was taken, so a later floor
 *                          change cannot rewrite the history of a decision that
 *                          was correct at the time
 *   fingerprint            what makes "material change invalidates" checkable
 *                          rather than asserted
 *
 * Controlled test identities. NOT the post-SSO exercise with two real staff.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { test, expect } from "../../harness/network/playwright-fixture";
import type { FixtureManifest } from "../../harness/fixtures/world";

const runId = process.env.NEXUS_VALIDATION_RUN_ID ?? "slice12";

async function withSql<T>(fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

test("proof 6 · an authorization persists approver, reason, time and validity data", async () => {
  test.setTimeout(120_000);

  const manifest = JSON.parse(
    await readFile(
      path.resolve(process.cwd(), ".artifacts", "validation", runId, "fixture-manifest.json"),
      "utf8",
    ),
  ) as FixtureManifest;
  const fixture = manifest.operatorQuotes.r3Volume;

  // The action is a server action; exercised here through its own module rather
  // than through a browser, because the surface that will call it is not built
  // and the evidence question is about the record, not the click.
  const { authorizeBelowFloor } = await import(
    "../../../src/app/actions/below-floor-authorization"
  );

  const before = new Date();
  const REASON = "Strategic account — approved by Commercial for launch volume.";

  // Find a below-floor tier to authorize, and the identity the harness signs in
  // as, so the assertions below can be about a specific person.
  const setup = await withSql(async (sql) => {
    const [approver] = await sql`
      select id, email, commercial_approver from users
       where email = 'pm@nexus-validation.invalid' limit 1`;
    return { approver };
  });
  expect(setup.approver, "validation identity missing").toBeTruthy();

  // Grant the governed permission for the duration of this test. Membership is
  // deliberately unseeded in the estate; this is a controlled test identity.
  await withSql(
    (sql) => sql`update users set commercial_approver = true where id = ${setup.approver.id}`,
  );

  try {
    const tiers = await withSql(
      (sql) => sql`select id, label from quote_tiers where quote_id = ${fixture.quoteId} order by sort_order`,
    );

    // Try each tier; only a genuinely below-floor one is authorizable, and the
    // action refuses the rest — which is itself the guard working.
    let authorizedTierId: string | null = null;
    let result: { ok: boolean; data?: { authorizationId: string }; error?: { message: string } } | null = null;
    for (const t of tiers) {
      const r = await authorizeBelowFloor({
        quoteId: fixture.quoteId,
        tierId: t.id as string,
        reason: REASON,
      });
      if (r.ok) {
        authorizedTierId = t.id as string;
        result = r;
        break;
      }
    }

    expect(
      authorizedTierId,
      "no below-floor tier on the fixture — proof 6 needs one to authorize",
    ).not.toBeNull();
    expect(result?.ok).toBe(true);

    // ── READ THE EVIDENCE BACK ──────────────────────────────────────────
    const [row] = await withSql(
      (sql) => sql`select * from below_floor_authorizations
                    where id = ${result!.data!.authorizationId}`,
    );
    expect(row, "the authorization was not persisted").toBeTruthy();

    // approver
    expect(row.approved_by_user_id).toBe(setup.approver.id);
    // mandatory reason, stored verbatim
    expect(row.reason).toBe(REASON);
    // decision timestamp, and it is a real one
    expect(new Date(row.approved_at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(new Date(row.approved_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    // scope — what the approval is bound to
    expect(row.tier_id).toBe(authorizedTierId);
    expect(typeof row.quote_version_number).toBe("number");
    // what was true at decision time
    expect(Number.isFinite(Number(row.margin_at_decision))).toBe(true);
    expect(Number(row.floor_at_decision)).toBeGreaterThan(0);
    // and the data that makes validity checkable
    expect(row.state_fingerprint).toMatch(/^rev:.*\|cost:.*\|margin:/);
    expect(row.invalidated_at).toBeNull();

    // The audit trail carries the same decision, under a transition-named action.
    const [audit] = await withSql(
      (sql) => sql`select action, user_id, diff_json from audit_log
                    where entity_id = ${fixture.quoteId}
                      and action = 'below_floor_authorized'
                    order by created_at desc limit 1`,
    );
    expect(audit, "no audit row for the authorization").toBeTruthy();
    expect(audit.user_id).toBe(setup.approver.id);
    expect(audit.diff_json.reason).toBe(REASON);
    expect(audit.diff_json.state_fingerprint).toBe(row.state_fingerprint);

    // A reason is genuinely mandatory at the action, not only in the column.
    const empty = await authorizeBelowFloor({
      quoteId: fixture.quoteId,
      tierId: authorizedTierId!,
      reason: "   ",
    });
    expect(empty.ok, "an empty reason was accepted").toBe(false);
  } finally {
    // Leave the estate as found: permission revoked, decisions removed.
    await withSql(async (sql) => {
      await sql`delete from below_floor_authorizations where quote_id = ${fixture.quoteId}`;
      await sql`delete from audit_log where entity_id = ${fixture.quoteId}
                 and action = 'below_floor_authorized'`;
      await sql`update users set commercial_approver = false where id = ${setup.approver.id}`;
    });
  }
});
