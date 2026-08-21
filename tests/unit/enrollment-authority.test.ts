import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

/** Comments stripped AND line endings normalized — see #334 for why. */
const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// NEXUS ADMIN IS THE ENROLLMENT AUTHORITY
//
// Authenticating proves who someone is. It does not enroll them. Exactly three
// outcomes, and creating a user is not among them:
//
//   already bound        -> resolve
//   pre-authorized       -> bind, once
//   no record of them    -> REFUSE, and record it
//
// The defect this closes: an employee who had never been added in Nexus signed
// in and received a working account at `read_only`. That looked like least
// privilege and was not — `read_only` is a LABEL, not a boundary. No non-admin
// role value is read for any authorization decision, so the auto-provisioned
// row was no more constrained than any other non-admin row.
//
// Which is why these tests assert the ABSENCE of provisioning rather than the
// smallness of a role. A smaller role would not have fixed it.
// ═══════════════════════════════════════════════════════════════════════

const ENSURE = () =>
  readFile(new URL("../../src/lib/auth/ensure-user.ts", import.meta.url), "utf8");
const AUDIT = () => readFile(new URL("../../src/lib/audit.ts", import.meta.url), "utf8");

// ── nothing enrolls anyone ────────────────────────────────────────────────

test("no sign-in path creates a user", async () => {
  const src = codeOnly(await ENSURE());
  assert.doesNotMatch(src, /\.insert\(users\)/);
  assert.doesNotMatch(src, /onConflictDoNothing/);
});

test("no role is chosen at sign-in", async () => {
  const src = codeOnly(await ENSURE());
  assert.doesNotMatch(src, /isAdmin\(/, "a role derived from an address is enrollment");
  for (const role of ["read_only", "pm", "admin", "logistics"]) {
    assert.doesNotMatch(
      src,
      new RegExp(`role[^\\n]*"${role}"`),
      `sign-in must not assign the ${role} role`,
    );
  }
});

test("the three outcomes are exhaustive and named", async () => {
  const src = codeOnly(await ENSURE());
  // resolve
  assert.match(src, /if \(existing\.length > 0\) return existing\[0\]/);
  // bind
  assert.match(src, /binding\.kind === "bound" \|\| binding\.kind === "raced"/);
  // refuse — both kinds
  assert.match(src, /binding\.kind === "refused"/);
  assert.match(src, /recordEnrollmentRefusal\(/);
  // and every branch that is not resolve/bind ends in a throw
  const tail = src.slice(src.indexOf("recordEnrollmentRefusal("));
  assert.match(tail, /throw new Error/);
});

test("an unenrolled signer is refused even though they authenticated", async () => {
  const src = codeOnly(await ENSURE());
  assert.match(
    src,
    /is not enrolled in Nexus/,
    "the refusal must say what actually happened, so an operator knows an " +
      "admin has to act rather than that they should retry",
  );
});

// ── the refusal is auditable, without inventing an actor ──────────────────

test("the enrollment gate is a declared system actor", async () => {
  // Read from source rather than imported: `audit.ts` pulls in the database
  // layer, and a unit test asserting a naming rule should not need a pool.
  const src = codeOnly(await AUDIT());
  const set = src.slice(src.indexOf("export const SYSTEM_ACTORS"), src.indexOf("} as const;"));
  assert.match(set, /enrollmentGate: "Enrollment gate"/);
  // The set is closed on purpose — each entry is a claim that some process acts
  // on its own behalf, and names must read as systems, never as people.
  assert.match(set, /netsuiteIntegration: "NetSuite integration"/);
  assert.equal((set.match(/^\s+\w+: "/gm) ?? []).length, 2, "the set stays closed");
});

test("the refusal is written as a SYSTEM row, with no fabricated actor", async () => {
  const src = codeOnly(await ENSURE());
  assert.match(src, /writeSystemAuditEntry\(/);
  assert.doesNotMatch(
    src,
    /writeAuditEntry\(/,
    "writeAuditEntry requires a resolvable acting user; the identity being " +
      "refused is not a Nexus actor, and naming them would assert the very " +
      "enrollment the refusal denies",
  );
});

test("writeSystemAuditEntry leaves both actor columns NULL", async () => {
  // The property that makes this shape honest, asserted at its source rather
  // than assumed from its name.
  const src = codeOnly(await AUDIT());
  const fn = src.slice(src.indexOf("export async function writeSystemAuditEntry"));
  assert.match(fn, /userId: null/);
  assert.match(fn, /actorUserId: null/);
  assert.match(fn, /actorKind: "system"/);
});

test("the attempted address is the subject, never the actor", async () => {
  const src = codeOnly(await ENSURE());
  const call = src.slice(src.indexOf("writeSystemAuditEntry({"));
  assert.match(call, /entityType: "enrollment"/);
  assert.match(call, /entityId: normalized/);
  assert.match(call, /action: "enrollment_refused"/);
});

test("a failed audit write does not become an accidental admission", async () => {
  const src = codeOnly(await ENSURE());
  // The refusal throws whether or not the record was written. An unwritable
  // audit must not be distinguishable from an unenrolled user at the call site.
  const fn = src.slice(src.indexOf("async function recordEnrollmentRefusal"));
  assert.match(fn, /try \{/);
  assert.match(fn, /\} catch \{/);
  assert.doesNotMatch(fn, /throw/);
});

// ── existing identities are untouched ─────────────────────────────────────

test("the bound-user fast path runs before anything else", async () => {
  const src = codeOnly(await ENSURE());
  const fast = src.indexOf("eq(users.clerkUserId, userId)");
  const bind = src.indexOf("bindPendingUser(");
  const refuse = src.indexOf("recordEnrollmentRefusal(");
  assert.ok(fast > 0 && bind > fast && refuse > bind, "resolve -> bind -> refuse");
});

test("the vestigial provisioning flag is gone, not left lying", async () => {
  // A field named `provisionMissingUsers` on a system that never provisions is
  // a false statement about the code, and the next reader would believe it.
  for (const f of [
    "../../src/lib/auth/identity-provider.ts",
    "../../src/lib/auth/clerk-authentication-provider.tsx",
    "../../tests/harness/providers/validation-authentication-provider.tsx",
  ]) {
    const src = await readFile(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /provisionMissingUsers/, `${f} still declares it`);
  }
});
