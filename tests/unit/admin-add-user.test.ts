import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

/** Comments stripped AND line endings normalized — see #334 for why. */
const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// ADMIN → USERS → ADD USER IS A FRONT DOOR, NOT A SECOND ENROLLMENT PATH
//
// #336 made Nexus admin the enrollment authority: a sign-in binds to a
// pre-authorized row or is refused. That left exactly one way in — a script —
// and this slice gives it a UI.
//
// The risk the UI introduces is not that it enrolls the wrong person. It is
// that it enrolls the RIGHT person by a DIFFERENT mechanism: a second insert
// that agrees with the certified one today and drifts the first time either is
// edited without the other in view. Drift there is invisible, because both
// paths keep producing users that look correct.
//
// So these tests assert SINGULARITY, not behaviour. Behaviour is asserted
// against the live database by
// `scripts/gate-1b/add-user-refusal-falsification.ts`, which runs the real
// mechanism, proves each refusal writes nothing, and proves — via a control
// that DOES write — that "nothing written" is not vacuous.
// ═══════════════════════════════════════════════════════════════════════

const read = (p: string) => readFile(new URL(`../../${p}`, import.meta.url), "utf8");

const MECHANISM = () => read("src/lib/auth/provision-pending-user.ts");
const ACTION = () => read("src/app/actions/users.ts");
const SCRIPT = () => read("scripts/gate-1b/provision-pending-user.ts");
const MODAL = () => read("src/app/admin/users/add-user-modal.tsx");
const TABLE = () => read("src/app/admin/users/users-table.tsx");
const PAGE = () => read("src/app/admin/users/page.tsx");

// ── one mechanism, two front doors ────────────────────────────────────────

test("the Admin action does not enroll anyone itself", async () => {
  const src = codeOnly(await ACTION());
  assert.match(
    src,
    /provisionPendingUser\(/,
    "the action must call the certified mechanism",
  );
  assert.doesNotMatch(
    src,
    /\.insert\(users\)/,
    "a second insert is a second enrollment implementation",
  );
  assert.doesNotMatch(
    src,
    /bindingState:\s*"pending_first_sign_in"/,
    "the pending state is the mechanism's to write, not the action's",
  );
});

test("the CLI provisioner does not enroll anyone itself", async () => {
  const src = codeOnly(await SCRIPT());
  assert.match(src, /provisionPendingUser\(/);
  assert.doesNotMatch(
    src,
    /\.insert\(users\)/,
    "the script was the certified path; it must now BE the shared function, not a copy of it",
  );
});

test("only the mechanism inserts a user outside sign-in binding", async () => {
  // The whole point of the slice. If a third site ever writes `users`, this
  // fails and the reader is forced to decide whether it is a front door or a
  // rival mechanism.
  const mech = codeOnly(await MECHANISM());
  assert.match(mech, /\.insert\(users\)/);
});

// ── the authority is the role, not an env list ────────────────────────────

test("creation is guarded by the role-based admin gate", async () => {
  const src = codeOnly(await ACTION());
  const body = src.slice(src.indexOf("export async function addUser"));
  assert.match(body, /requireAdminAction\(\)/);
});

test("ADMIN_EMAILS is never the write authority", async () => {
  // `isAdmin(email)` reads a static env list that only ever SEEDED the first
  // role assignment. Used as the gate it would keep granting creation after a
  // demotion the database already recorded.
  for (const src of [codeOnly(await ACTION()), codeOnly(await MECHANISM())]) {
    assert.doesNotMatch(src, /isAdmin\(/);
    assert.doesNotMatch(src, /ADMIN_EMAILS/);
  }
});

test("the mechanism holds no guard of its own", async () => {
  // Deliberate: the CLI front door cannot satisfy a role guard, and a guard
  // buried in a data function hides the authority decision from both callers.
  const src = codeOnly(await MECHANISM());
  assert.doesNotMatch(src, /requireAdmin(Action|Page)\(/);
  assert.doesNotMatch(src, /ensureUser\(/);
});

// ── what a create grants, and what it does not ────────────────────────────

test("the created row carries no authority beyond its role", async () => {
  const src = codeOnly(await MECHANISM());
  for (const field of ["commercialApprover", "canEditSpecs", "canCreateLeaves"]) {
    assert.match(
      src,
      new RegExp(`${field}:\\s*false`),
      `${field} must be written false explicitly, so the omission reads as deliberate`,
    );
  }
  assert.match(src, /clerkUserId:\s*null/);
  assert.match(src, /bindingState:\s*"pending_first_sign_in"/);
});

test("no authority flag is settable from the form", async () => {
  // BV-005 keeps commercial approval independent of role. A checkbox on a
  // hiring form is exactly where that independence would erode.
  const mech = codeOnly(await MECHANISM());
  const args = mech.slice(mech.indexOf("export async function provisionPendingUser"), mech.indexOf("): Promise<ProvisionResult>"));
  for (const field of ["commercialApprover", "canEditSpecs", "canCreateLeaves", "slack", "hubspot"]) {
    assert.doesNotMatch(
      args,
      new RegExp(field, "i"),
      `${field} must not be a provisioning parameter`,
    );
  }

  const modal = codeOnly(await MODAL());
  for (const field of ["commercialApprover", "canEditSpecs", "canCreateLeaves", "slack", "hubspot"]) {
    assert.doesNotMatch(modal, new RegExp(field, "i"));
  }
});

test("Add User is creation only — it edits, disables and deletes nothing", async () => {
  const action = codeOnly(await ACTION());
  const body = action.slice(action.indexOf("export async function addUser"));
  assert.doesNotMatch(body, /\.update\(users\)/);
  assert.doesNotMatch(body, /\.delete\(users\)/);

  const modal = codeOnly(await MODAL());
  assert.doesNotMatch(modal, /updateUserRole|deleteUser|disableUser|archiveUser/);
});

// ── the refusal set ───────────────────────────────────────────────────────

test("every refusal is named, and refuses before anything is written", async () => {
  const src = codeOnly(await MECHANISM());
  for (const code of [
    "invalid_name",
    "invalid_email",
    "non_corporate_email",
    "invalid_role",
    "duplicate_email",
  ]) {
    assert.match(src, new RegExp(`"${code}"`), `${code} must be a distinct refusal`);
  }

  // Ordering is the zero-residue guarantee for four of the five: the insert is
  // the LAST thing in the function, so a refusal cannot have written first.
  const insertAt = src.indexOf(".insert(users)");
  for (const code of ["invalid_name", "invalid_email", "non_corporate_email", "invalid_role"]) {
    assert.ok(
      src.indexOf(`"${code}"`) < insertAt,
      `${code} must be decided before any write`,
    );
  }
});

test("a duplicate is a duplicate regardless of casing or enrollment state", async () => {
  const src = codeOnly(await MECHANISM());
  assert.match(
    src,
    /lower\(\$\{users\.email\}\) = \$\{normalized\}/,
    "case-folded comparison, or two rows can exist for one person",
  );
  // No binding-state predicate on the clash query: an address already bound is
  // just as much a duplicate as a pending one, and reporting only pending
  // collisions would let an admin believe they had created a second record for
  // an active employee.
  const clash = src.slice(src.indexOf("const clash ="), src.indexOf("const created ="));
  assert.doesNotMatch(clash, /bindingState,?\s*['"]?pending_first_sign_in/);
  assert.doesNotMatch(clash, /eq\(users\.bindingState/);
});

test("only the corporate domain can be pre-authorized", async () => {
  const src = codeOnly(await MECHANISM());
  assert.match(src, /isCorporateEmail\(/);
  // The domain is not restated here — one definition, in corporate-email.ts.
  assert.doesNotMatch(src, /@thedps\.co/);
});

test("the row and its provenance commit together", async () => {
  // A pending user with no record of who created it is an unexplained grant of
  // future access; an audit row for a user that does not exist is a claim
  // about nothing.
  const src = codeOnly(await MECHANISM());
  const tx = src.slice(src.indexOf("db.transaction"));
  assert.match(tx, /\.insert\(users\)/);
  assert.match(tx, /writeAuditEntry\(/);
  assert.match(tx, /"user_pre_authorized"/);
  assert.match(tx, /\n\s*tx,\n/, "the audit write must join the transaction");
});

// ── what the surface shows ────────────────────────────────────────────────

test("enrollment state is shown in words", async () => {
  const src = codeOnly(await TABLE());
  assert.match(src, /Pending sign-in/);
  assert.match(src, /Active/);
});

test("no Clerk id reaches the admin surface", async () => {
  // An identity-provider key is of no use to an administrator, and a surface
  // that prints one invites it into screenshots and support threads.
  for (const src of [codeOnly(await TABLE()), codeOnly(await PAGE()), codeOnly(await MODAL())]) {
    assert.doesNotMatch(src, /clerkUserId|clerk_user_id/);
  }
});

test("the role vocabulary offered is the schema's, entire", async () => {
  const schema = codeOnly(await read("src/db/schema.ts"));
  const declared = schema.slice(schema.indexOf('pgEnum("user_role"'));
  // From after the opening bracket — otherwise the enum's own NAME is counted
  // as one of its values, and the comparison passes or fails for the wrong
  // reason.
  const block = declared.slice(declared.indexOf("["), declared.indexOf("]"));
  const roles = Array.from(block.matchAll(/"([a-z_]+)"/g), (m) => m[1]);
  assert.ok(roles.length >= 8, "expected the full role vocabulary");

  const modal = codeOnly(await MODAL());
  const offered = Array.from(
    modal.slice(modal.indexOf("const ROLES"), modal.indexOf("] as const")).matchAll(/"([a-z_]+)"/g),
    (m) => m[1],
  );
  assert.deepEqual(
    [...offered].sort(),
    [...roles].sort(),
    "the form must offer exactly the roles the mechanism accepts — no more, no fewer",
  );
});

test("the mechanism validates the role against the schema, not a copy of it", async () => {
  const src = codeOnly(await MECHANISM());
  assert.match(src, /userRole\.enumValues/);
});

test("the page no longer claims users are auto-provisioned", async () => {
  // The copy described a mechanism removed in #336. Left in place it would
  // tell an admin that doing nothing is sufficient, which is now the one
  // thing that guarantees the employee cannot sign in.
  // Rendered copy only: the comment above it accurately records that
  // auto-provisioning WAS removed, and that history is worth keeping.
  const src = codeOnly(await PAGE());
  assert.doesNotMatch(src, /auto-provision/i);
  assert.doesNotMatch(src, /provision via Clerk sign-in/i);
  assert.match(
    src,
    /added here first/,
    "the copy must say what is now true: no record, no sign-in",
  );
});
