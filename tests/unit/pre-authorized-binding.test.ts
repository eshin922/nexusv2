import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

import { normalizeCorporateEmail } from "../../src/lib/auth/corporate-email.ts";
import { userBindingState, users } from "../../src/db/schema.ts";

// ═══════════════════════════════════════════════════════════════════════
// #327 — PRE-AUTHORIZED FIRST-SIGN-IN BINDING
//
// One test per governing invariant. The dangerous failure is not that binding
// stops working — that is loud. It is that binding starts working on rows it
// must never touch, which is silent and would re-point a historical actor.
// ═══════════════════════════════════════════════════════════════════════

const BINDING = () =>
  readFile(new URL("../../src/lib/auth/pending-binding.ts", import.meta.url), "utf8");
const ENSURE = () =>
  readFile(new URL("../../src/lib/auth/ensure-user.ts", import.meta.url), "utf8");
const MIGRATION = () =>
  readFile(
    new URL("../../drizzle/0093_pre_authorized_first_signin_binding.sql", import.meta.url),
    "utf8",
  );

// ── the pending state is STATED, not inferred ─────────────────────────────

test("pending is an explicit state, not the nullity of a handle", () => {
  assert.deepEqual(userBindingState.enumValues, ["pending_first_sign_in", "bound"]);
});

test("a DB CHECK stops the state and the handle from disagreeing", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /users_binding_state_matches_clerk_id/);
  assert.match(sql, /'bound'\s*AND "clerk_user_id" IS NOT NULL/);
  assert.match(sql, /'pending_first_sign_in'\s*AND "clerk_user_id" IS NULL/);
});

test("a pending row can exist without a Clerk identity", () => {
  assert.equal(users.clerkUserId.notNull, false, "clerk_user_id must be nullable");
});

// ── exactly one normalized match, made unrepresentable ────────────────────

test("normalization is case-fold and trim ONLY", () => {
  assert.equal(normalizeCorporateEmail("  Cally@TheDPS.co "), "cally@thedps.co");
  // Deliberately NOT collapsed. Stripping plus-addressing would let one
  // person's sign-in claim another person's pre-authorized row.
  assert.equal(normalizeCorporateEmail("cally+x@thedps.co"), "cally+x@thedps.co");
  assert.notEqual(
    normalizeCorporateEmail("cally+x@thedps.co"),
    normalizeCorporateEmail("cally@thedps.co"),
  );
  assert.equal(normalizeCorporateEmail("c.ally@thedps.co"), "c.ally@thedps.co");
});

test("two rows for one address are unrepresentable, not merely checked", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /CREATE UNIQUE INDEX "users_email_lower_unique" ON "users" \(lower\("email"\)\)/);
});

test("the query matches the index — code and schema agree on sameness", async () => {
  const src = codeOnly(await BINDING());
  assert.match(src, /lower\(\$\{users\.email\}\) = \$\{normalized\}/);
});

// ── THE invariant: a bound row is immutable to email-based rebinding ──────

test("the write is double-keyed on pending AND unbound", async () => {
  const src = codeOnly(await BINDING());
  const update = src.slice(src.indexOf(".update(users)"));
  const where = update.slice(update.indexOf(".where("), update.indexOf(".returning()"));
  assert.match(where, /eq\(users\.bindingState, "pending_first_sign_in"\)/);
  assert.match(where, /isNull\(users\.clerkUserId\)/);
  assert.match(where, /eq\(users\.id, target\.id\)/);
});

test("a write affecting other than exactly one row is not treated as success", async () => {
  const src = codeOnly(await BINDING());
  assert.match(src, /if \(updated\.length !== 1\)/);
});

test("no sign-in path writes clerk_user_id outside the pending guard", async () => {
  const src = codeOnly(await BINDING());
  // Exactly one UPDATE in this module, and it is the guarded one.
  assert.equal((src.match(/\.update\(users\)/g) ?? []).length, 1);

  const ensure = codeOnly(await ENSURE());
  // ensure-user may INSERT a new row with an identity, but must never UPDATE
  // an existing row's identity — that is the rebinding this design forbids.
  assert.doesNotMatch(
    ensure,
    /\.update\(users\)/,
    "ensure-user must not update a users row; rebinding is an admin act",
  );
});

// ── the binding writes ONLY the handle and its state transition ───────────

test("the binding sets clerk_user_id, the state, and nothing else", async () => {
  const src = codeOnly(await BINDING());
  const set = src.slice(src.indexOf(".set({"), src.indexOf(".where(", src.indexOf(".set({")));
  const fields = [...set.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), ["bindingState", "clerkUserId", "updatedAt"]);
});

test("authority and identity are never in the write set", async () => {
  const src = codeOnly(await BINDING());
  const set = src.slice(src.indexOf(".set({"), src.indexOf(".where(", src.indexOf(".set({")));
  for (const forbidden of [
    "role",
    "commercialApprover",
    "canEditSpecs",
    "canCreateLeaves",
    "email",
    "id:",
    "name",
    // Separate identity relationships with their own governance. A sign-in has
    // no standing to rewrite either.
    "hubspotOwnerId",
    "slackUserId",
  ]) {
    assert.doesNotMatch(
      set,
      new RegExp(`\\b${forbidden.replace(":", "")}\\s*:`),
      `the binding must not write ${forbidden} — SSO proves who someone is, ` +
        `not what they may do`,
    );
  }
});

test("commercial_approver is not referenced as a writable field anywhere here", async () => {
  const src = codeOnly(await BINDING());
  // It appears once, in the audit's `preserved` record — never in a write.
  assert.equal((src.match(/commercialApprover/g) ?? []).length, 1);
  assert.match(src, /preserved:[\s\S]*commercial_approver: user\.commercialApprover/);
});

// ── ordering: binding must precede least-privilege provisioning ───────────

test("binding runs BEFORE the fallback insert", async () => {
  const src = codeOnly(await ENSURE());
  const bind = src.indexOf("bindPendingUser(");
  const insert = src.indexOf(".insert(users)");
  assert.ok(bind > 0 && insert > 0);
  assert.ok(
    bind < insert,
    "a rostered employee would otherwise get a duplicate read_only row while " +
      "their pre-authorized row sat pending forever",
  );
});

test("unknown signers still land read_only", async () => {
  const src = codeOnly(await ENSURE());
  assert.match(src, /isAdmin\(email\)\s*\?\s*"admin"\s*:\s*"read_only"/);
});

test("integrity failures refuse instead of provisioning", async () => {
  // The four hard refusals share one branch in ensure-user; which of them
  // fired is carried on the refusal, not on the outcome kind. Their individual
  // enumeration and their refusal semantics live in
  // `pre-authorized-binding-refusals.test.ts`; this only asserts the caller
  // routes them away from provisioning.
  const src = codeOnly(await ENSURE());
  const idx = src.indexOf('binding.kind === "refused"');
  assert.ok(idx > 0, "ensure-user must handle the refused outcome");
  assert.ok(
    src.indexOf("throw new Error", idx) < src.indexOf(".insert(users)", idx),
    "a refusal must throw before any provisioning path is reachable",
  );
});

// ── audit ─────────────────────────────────────────────────────────────────

test("the audit names the transition, not the mechanism", async () => {
  const src = codeOnly(await BINDING());
  assert.match(src, /action: "user_identity_bound"/);
  assert.doesNotMatch(src, /action: "clerk_/, "mechanism-anchored action name");
  assert.match(src, /audit_source: "enterprise_sso_first_sign_in"/);
});

test("the audit records what did NOT move", async () => {
  const src = codeOnly(await BINDING());
  for (const f of ["user_id", "email", "role", "commercial_approver"]) {
    assert.match(src, new RegExp(`${f}: user\\.`), `${f} missing from preserved`);
  }
});

// ── deployment compatibility ──────────────────────────────────────────────

test("binding_state KEEPS its default — the deployed writer must stay valid", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /ADD COLUMN "binding_state"[\s\S]*?NOT NULL DEFAULT 'bound'/);
  assert.doesNotMatch(
    sql,
    /ALTER COLUMN "binding_state" DROP DEFAULT/,
    "dropping the default makes this a tightening against a deployed writer " +
      "that does not mention the column — the 0066 outage shape",
  );
});

test("every statement in the migration is a loosening", async () => {
  const sql = await MIGRATION();
  assert.match(sql, /ALTER COLUMN "clerk_user_id" DROP NOT NULL/);
  assert.doesNotMatch(sql, /SET NOT NULL/);
  assert.doesNotMatch(sql, /DROP COLUMN|DROP TABLE/);
});

test("no roster identity is provisioned by this slice", async () => {
  // SQL comments stripped as well as TS ones. The migration explains itself
  // using `cally@thedps.co` as a worked example of why plus-addressing is not
  // collapsed, and a check that cannot tell an explanation from a seeded row
  // would be measuring the wrong thing — the same mistake as matching the bare
  // domain in the roles slice.
  const sqlCode = (await MIGRATION())
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  for (const src of [codeOnly(await BINDING()), codeOnly(await ENSURE()), sqlCode]) {
    assert.doesNotMatch(src, /[\w.]+@thedps\.co/);
  }
  assert.doesNotMatch(sqlCode, /INSERT INTO/i);
});
