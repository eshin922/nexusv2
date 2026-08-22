import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

import {
  CORPORATE_DOMAIN,
  isCorporateEmail,
} from "../../src/lib/auth/corporate-email.ts";
import { users } from "../../src/db/schema.ts";

/**
 * Comments stripped AND line endings normalized.
 *
 * These files are checked out with CRLF on Windows and LF on CI, so any pattern
 * containing a bare newline silently stops matching depending on where it runs.
 * That turns every multi-line assertion below into a coin flip between
 * environments rather than a statement about the code — which is exactly how
 * two of these passed when freshly written and failed after git normalized the
 * file.
 */
const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// #327 — HARD REFUSALS, ATOMICITY, AND THE DISCRIMINATING TESTS
//
// The suite in `pre-authorized-binding.test.ts` asserts that the new mechanism
// behaves. This one asserts two things that suite cannot:
//
//   1  every integrity failure REFUSES rather than degrading into "provision a
//      fresh read_only user" — which would answer a question about enrollment
//      integrity by creating a second record for the same person;
//
//   2  the OLD ensureUser behaviour could not satisfy this contract. Without
//      that, every assertion here would still pass against a codebase where
//      the old provisioning path simply sat beside the new one.
// ═══════════════════════════════════════════════════════════════════════

const BINDING = () =>
  readFile(new URL("../../src/lib/auth/pending-binding.ts", import.meta.url), "utf8");
const ENSURE = () =>
  readFile(new URL("../../src/lib/auth/ensure-user.ts", import.meta.url), "utf8");
const MIDDLEWARE = () =>
  readFile(new URL("../../src/lib/auth/production-middleware.ts", import.meta.url), "utf8");
const MIGRATION = () =>
  readFile(
    new URL("../../drizzle/0093_pre_authorized_first_signin_binding.sql", import.meta.url),
    "utf8",
  );

// ── refusal vs fall-through ───────────────────────────────────────────────

test("the outcome vocabulary is closed", async () => {
  const src = codeOnly(await BINDING());
  const kinds = [...src.matchAll(/kind: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    ["bound", "no_pending_row", "raced", "refused"],
    "a new outcome kind must be classified deliberately by the caller",
  );
  // `no_pending_row` no longer means "provision them" — the caller refuses and
  // records it. The name is kept because it still describes what this module
  // found, and the module does not decide what follows.
});

test("all four hard refusals are enumerated", async () => {
  const src = codeOnly(await BINDING());
  for (const code of [
    "non_corporate_identity",
    "ambiguous_email_match",
    "clerk_id_already_bound",
    "email_already_bound",
  ]) {
    assert.match(src, new RegExp(`code: "${code}"`), `${code} is not handled`);
  }
});

test("a refusal throws rather than provisioning a second record", async () => {
  const src = codeOnly(await ENSURE());
  const idx = src.indexOf('binding.kind === "refused"');
  assert.ok(idx > 0, "ensure-user must handle the refused outcome");
  // Ordering, not a fixed window — a window wide enough to contain the branch
  // is also wide enough to reach the provisioning path below it, and would then
  // fail on code that is behaving correctly.
  assert.ok(src.indexOf("throw new Error", idx) > 0, "the refusal must throw");
  // Stronger than the ordering this once asserted: there is no provisioning
  // path left to reach, in this branch or any other.
  assert.doesNotMatch(src, /\.insert\(users\)/);
});

test("an already-bound address refuses instead of reaching the unique index", async () => {
  const src = codeOnly(await BINDING());
  // The lookup must NOT pre-filter to pending rows. Filtering makes a bound row
  // indistinguishable from no row at all; the caller then provisions a
  // duplicate, hits the unique index on email, and surfaces a raw constraint
  // error where a diagnosis belongs.
  const q = src.slice(
    src.indexOf("const forEmail"),
    src.indexOf("if (forEmail.length === 0)"),
  );
  assert.doesNotMatch(q, /bindingState/, "the lookup must see rows in ANY state");
  assert.match(
    src,
    /target\.bindingState !== "pending_first_sign_in" \|\| target\.clerkUserId !== null/,
  );
});

// ── binding is stricter than sign-in ──────────────────────────────────────

test("the corporate check is stricter than the middleware's allow-list", () => {
  assert.equal(isCorporateEmail("cally@thedps.co"), true);
  assert.equal(isCorporateEmail("  CALLY@THEDPS.CO "), true);
  // An ALLOWED_EMAILS break-glass address may be permitted to SIGN IN, but must
  // never be able to CLAIM a row provisioned for an employee.
  assert.equal(isCorporateEmail("contractor@example.com"), false);
  assert.equal(CORPORATE_DOMAIN, "@thedps.co");
});

test("the domain is defined once and shared with the middleware", async () => {
  const mw = codeOnly(await MIDDLEWARE());
  assert.match(mw, /import \{ CORPORATE_DOMAIN \} from "@\/lib\/auth\/corporate-email"/);
  assert.doesNotMatch(mw, /"@thedps\.co"/, "the domain must not be redeclared");
});

// ── atomicity ─────────────────────────────────────────────────────────────

test("preconditions and the write share one transaction", async () => {
  const src = codeOnly(await BINDING());
  // One body, run either on a caller's transaction or on a fresh one — never
  // partly on the pool.
  assert.match(src, /const run = async \(tx: Tx\)/);
  assert.match(src, /return outerTx \? run\(outerTx\) : db\.transaction\(run\)/);
  // Nothing inside may reach back to the pool and escape the transaction.
  const body = src.slice(src.indexOf("const run = async"));
  assert.doesNotMatch(body, /\bdb\s*\.\s*(select|update|insert)/);
});

test("the caller-supplied transaction is honoured, not merely accepted", async () => {
  const src = codeOnly(await BINDING());
  // A parameter that is taken and then ignored would still typecheck, still
  // read correctly, and would silently commit test writes to production.
  assert.match(src, /outerTx \? run\(outerTx\)/);
});

test("the audit commits with the binding, not beside it", async () => {
  const src = codeOnly(await BINDING());
  assert.match(
    src,
    /writeAuditEntry\([\s\S]*?\n\s*tx,\n\s*\);/,
    "the audit must be written on the transaction it describes",
  );
});

// ── DISCRIMINATING: the old behaviour cannot satisfy this contract ────────

test("OLD BEHAVIOUR: provisioning-only could not reach a pre-authorized row", async () => {
  const src = codeOnly(await ENSURE());
  // The old path's entire vocabulary was INSERT: it read no row it had not
  // created, so a pre-authorized row was unreachable by construction rather
  // than by oversight.
  //
  // Both halves are now asserted as absence — the binding exists, and the
  // INSERT it once had to outrun is gone entirely.
  assert.match(src, /bindPendingUser\(/, "the contract requires a binding attempt");
  assert.doesNotMatch(src, /\.insert\(users\)/, "sign-in must not create a user");
});

test("OLD BEHAVIOUR: a pending row would have COLLIDED, not bound", async () => {
  // The sharpest discriminator. Old ensureUser INSERTed {clerkUserId, email, …}
  // on any first sign-in. Against a pre-authorized row carrying the same
  // address that is a unique-constraint violation on `email` — so the person
  // could not sign in AT ALL, and the pending row was never consumed.
  //
  // The contract is therefore not merely unimplemented by the old path; it is
  // UNSATISFIABLE by it. Asserted against the schema rather than a diff, so it
  // keeps holding as the code moves.
  assert.equal(
    users.email.isUnique,
    true,
    "email uniqueness is what made the old path collide rather than bind",
  );
  assert.match(await MIGRATION(), /users_email_lower_unique/);
});

test("OLD BEHAVIOUR: a role derived from an address cannot express a provisioned one", async () => {
  const src = codeOnly(await ENSURE());
  // The old path derived role from the EMAIL — first `isAdmin(email) ? "admin"
  // : "pm"`, later `: "read_only"`. A role an admin chose in advance is not
  // derivable from an address, so any provisioning-time role would have been
  // discarded at first sign-in.
  //
  // That derivation is now gone entirely, along with the provisioning it fed.
  // Asserting its ABSENCE is the stronger form of the same claim: there is no
  // longer any path by which a sign-in can decide someone's authority.
  assert.doesNotMatch(src, /isAdmin\(/, "no role may be derived from an address");
  assert.doesNotMatch(src, /\.insert\(users\)/, "a sign-in may not create a user");
});

test("OLD BEHAVIOUR: no state existed to consume, so binding could not be one-time", async () => {
  // Pending had no representation before this slice, so "consume the pending
  // state exactly once" had nothing to consume. The column plus the CHECK are
  // what make the transition one-way rather than a repeatable email match.
  assert.equal(users.bindingState.notNull, true);
  assert.match(await MIGRATION(), /users_binding_state_matches_clerk_id/);
});

// ── the zero-row race may NEVER fall through ──────────────────────────────
//
// The subtlest way to reach the forbidden outcome: not by returning it where a
// reader would look for it, but through the race handler — the branch nobody
// reads twice. Once a row is observed owning the address, "nobody is
// provisioned" is a false statement, and acting on it creates a second record
// for a person who demonstrably has one.

test("no_pending_row is unreachable once a row is observed", async () => {
  const src = codeOnly(await BINDING());
  const observed = src.indexOf("const target = forEmail[0]");
  assert.ok(observed > 0, "the observation point must exist");
  const after = src.slice(observed);
  assert.doesNotMatch(
    after,
    /no_pending_row/,
    "every path after a row is observed must end in bound, raced, or a refusal",
  );
});

test("the race handler re-reads by durable users.id, not the incoming identity", async () => {
  const src = codeOnly(await BINDING());
  const handler = src.slice(src.indexOf("if (updated.length !== 1)"));
  const reread = handler.slice(0, handler.indexOf("if (after.length !== 1)"));
  assert.match(
    reread,
    /eq\(users\.id, target\.id\)/,
    "a lookup keyed on the identity we failed to write can only answer " +
      "'did I win?', and returns nothing in exactly the cases that matter",
  );
  assert.doesNotMatch(reread, /eq\(users\.clerkUserId, args\.clerkUserId\)/);
});

test("the race handler classifies all three post-write states", async () => {
  const src = codeOnly(await BINDING());
  const handler = src.slice(src.indexOf("if (updated.length !== 1)"));
  // vanished -> integrity refusal
  assert.match(handler, /code: "binding_target_missing"/);
  // ours -> raced
  assert.match(
    handler,
    /now\.clerkUserId === args\.clerkUserId && now\.bindingState === "bound"/,
  );
  // someone else's -> refusal
  assert.match(handler, /code: "pending_row_claimed"/);
});

// ── provisioning atomicity ────────────────────────────────────────────────

/**
 * The provisioning MECHANISM. It used to live in the CLI script; Admin →
 * Users → Add User needed the same behaviour, so it was extracted rather than
 * written a second time, and these assertions followed it.
 *
 * Repointed, NOT relaxed — the test below still requires the script to reach
 * the mechanism, so "the script no longer does this" cannot become a way to
 * pass by doing nothing.
 */
const PROVISION = () =>
  readFile(new URL("../../src/lib/auth/provision-pending-user.ts", import.meta.url), "utf8");

const PROVISION_CLI = () =>
  readFile(new URL("../../scripts/gate-1b/provision-pending-user.ts", import.meta.url), "utf8");

test("the CLI provisioner is a front door onto that mechanism", async () => {
  const src = codeOnly(await PROVISION_CLI());
  assert.match(src, /provisionPendingUser\(/);
  assert.doesNotMatch(
    src,
    /\.insert\(users\)/,
    "a copy of the insert here would agree with the mechanism today and drift " +
      "the first time either is edited without the other in view",
  );
});

test("the pending row and its audit commit together or not at all", async () => {
  const src = codeOnly(await PROVISION());
  assert.match(src, /db\.transaction\(async \(tx\) =>/);
  const body = src.slice(src.indexOf("db.transaction("));
  // The INSERT is on the transaction, not the pool.
  assert.match(body, /await tx\s*\.insert\(users\)/);
  assert.doesNotMatch(body, /await db\s*\.insert/);
  // And the audit joins it, so an audit failure rolls the row back and an
  // insert failure never reaches the audit.
  assert.match(body, /writeAuditEntry\([\s\S]*?\n\s*tx,\n\s*\);/);
});

test("provisioning grants no authority beyond the role", async () => {
  const src = codeOnly(await PROVISION());
  const values = src.slice(src.indexOf(".values({"), src.indexOf(".returning()"));
  for (const flag of ["commercialApprover", "canEditSpecs", "canCreateLeaves"]) {
    assert.match(
      values,
      new RegExp(`${flag}: false`),
      `${flag} must be explicitly false — BV-005 keeps commercial approval ` +
        `independent of role, and a provisioning flag is where that erodes`,
    );
  }
  assert.match(values, /bindingState: "pending_first_sign_in"/);
  assert.match(values, /clerkUserId: null/);
});

test("provisioning does not build SQL by interpolating its argument", async () => {
  // Both halves: the mechanism receives the argument, the CLI hands it over.
  const src = codeOnly(await PROVISION()) + codeOnly(await PROVISION_CLI());
  assert.doesNotMatch(
    src,
    /sql\.raw\(/,
    "the address comes from a CLI argument; interpolating it into raw SQL is " +
      "an injection whether or not this caller is trusted today",
  );
});
