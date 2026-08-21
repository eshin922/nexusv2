import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

import {
  CORPORATE_DOMAIN,
  isCorporateEmail,
} from "../../src/lib/auth/corporate-email.ts";
import { users } from "../../src/db/schema.ts";

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

test("exactly one outcome falls through to provisioning", async () => {
  const src = codeOnly(await BINDING());
  const kinds = [...src.matchAll(/kind: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(kinds)].sort(),
    ["bound", "no_pending_row", "raced", "refused"],
    "a new outcome kind must be classified as refusal or fall-through explicitly",
  );
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
  const throwIdx = src.indexOf("throw new Error", idx);
  const insertIdx = src.indexOf(".insert(users)", idx);
  assert.ok(throwIdx > 0, "the refusal must throw");
  assert.ok(
    throwIdx < insertIdx,
    "the refusal must throw BEFORE any provisioning path is reachable",
  );
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
  assert.match(src, /db\.transaction\(async \(tx\) =>/);
  // Nothing inside may reach back to the pool and escape the transaction.
  const body = src.slice(src.indexOf("db.transaction("));
  assert.doesNotMatch(body, /\bdb\s*\.\s*(select|update|insert)/);
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
  const insertIdx = src.indexOf(".insert(users)");
  const bindIdx = src.indexOf("bindPendingUser(");
  assert.ok(bindIdx > 0, "the contract requires a binding attempt to exist");
  assert.ok(bindIdx < insertIdx, "and it must be reachable before provisioning");
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
  // The old path derived role from the EMAIL. A role an admin chose in advance
  // is not derivable from an address, so any provisioning-time role would have
  // been discarded at first sign-in.
  assert.match(src, /isAdmin\(email\)\s*\?\s*"admin"\s*:\s*"read_only"/);
  // The early return above it is what protects a provisioned role from being
  // overwritten by that derivation.
  assert.ok(
    src.indexOf("bindPendingUser(") < src.indexOf("isAdmin(email)"),
    "role derivation must sit AFTER the binding's early return",
  );
});

test("OLD BEHAVIOUR: no state existed to consume, so binding could not be one-time", async () => {
  // Pending had no representation before this slice, so "consume the pending
  // state exactly once" had nothing to consume. The column plus the CHECK are
  // what make the transition one-way rather than a repeatable email match.
  assert.equal(users.bindingState.notNull, true);
  assert.match(await MIGRATION(), /users_binding_state_matches_clerk_id/);
});
