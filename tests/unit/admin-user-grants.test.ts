// Granting spec and leaf permission.
//
// Until this landed, `users.can_edit_specs` and `users.can_create_leaves` were
// read by a guard on every spec and library write and set by NOTHING. Both had
// been seeded once by migration, so the guards resolved in practice to
// admins-only — and a PM asked to complete a SKU was refused at save, after
// the form had let her type it. The guard was working; the grant was
// unreachable.
//
// These pin the properties that make the grant safe to hand an admin, and the
// one that made its absence invisible: nothing else may write the columns.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const codeOnly = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const ACTIONS = "src/app/actions/users.ts";

/** The body of one exported action, bounded by the next export. */
function actionBody(src: string, name: string): string {
  const from = src.indexOf(`export async function ${name}`);
  assert.ok(from >= 0, `no exported action named ${name}`);
  const next = src.indexOf("export async function ", from + 1);
  return src.slice(from, next === -1 ? src.length : next);
}

test("granting is admin-only, and refuses before it writes", () => {
  const body = actionBody(codeOnly(ACTIONS), "updateUserGrants");

  assert.match(body, /requireAdminAction\(\)/, "any signed-in user could grant themselves authority");

  const guardAt = body.indexOf("requireAdminAction()");
  const writeAt = body.indexOf(".update(users)");
  assert.ok(writeAt > 0, "the action writes nothing");
  assert.ok(guardAt < writeAt, "the write happens before the authority check");
});

test("the grant and its audit entry commit together", () => {
  const body = actionBody(codeOnly(ACTIONS), "updateUserGrants");

  // Authority granted with no record of who granted it is the one change that
  // must never survive its own audit failing.
  assert.match(body, /db\.transaction\(/, "the grant is not transactional");

  const txAt = body.indexOf("db.transaction(");
  const writeAt = body.indexOf(".update(users)");
  const auditAt = body.indexOf("writeAuditEntry(");
  assert.ok(txAt < writeAt && txAt < auditAt, "the write or the audit sits outside the transaction");
  assert.match(body, /\n\s*tx,\n/, "the audit entry is written on a different connection");
});

test("the audit records what it changed FROM, read inside the transaction", () => {
  const body = actionBody(codeOnly(ACTIONS), "updateUserGrants");

  // A from/to taken from the submitting screen would record what the admin
  // believed, not what was true.
  const txAt = body.indexOf("db.transaction(");
  const priorReadAt = body.indexOf(".select(", txAt);
  const writeAt = body.indexOf(".update(users)");
  assert.ok(priorReadAt > txAt && priorReadAt < writeAt, "the prior value is not read inside the transaction before the write");

  assert.match(body, /action: "user_grants_updated"/);
  assert.match(body, /from: \{/);
  assert.match(body, /to: \{/);
});

test("only the exact checkbox value confers a grant", () => {
  // `Boolean(formData.get(...))` reads any non-empty string as true, so a
  // caller sending `canEditSpecs=off` -- or `=false` -- would be GRANTED it.
  // The strict comparison is what makes the negative safe to spell out.
  //
  // An absent field confers nothing, which is the direction a permission
  // should fail in.
  const body = actionBody(codeOnly(ACTIONS), "updateUserGrants");
  for (const field of ["canEditSpecs", "canCreateLeaves"]) {
    assert.match(
      body,
      new RegExp(`formData\\.get\\("${field}"\\) === "on"`),
      `${field} is not read as an explicit presence check`,
    );
  }
});

test("nothing else in the app writes these columns", () => {
  // The reason the gap was invisible for so long: the columns had exactly one
  // writer, a migration, and no code path at all. If a second writer appears,
  // the audited grant stops being the whole story.
  const offenders: string[] = [];
  const files = [
    "src/app/actions/users.ts",
    "src/lib/auth/provision-pending-user.ts",
    "src/lib/auth/pending-binding.ts",
  ];
  for (const file of files) {
    const src = codeOnly(file);
    // A write is an assignment in a `.set({...})`; the provisioning paths
    // legitimately name these columns when INSERTING a new user at false.
    const setBlocks = src.match(/\.set\(\{[\s\S]*?\}\)/g) ?? [];
    for (const block of setBlocks) {
      if (/canEditSpecs|canCreateLeaves/.test(block) && file !== ACTIONS) {
        offenders.push(`${file}: ${block.slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `a second writer of the grant columns exists:\n${offenders.join("\n")}`);
});

test("the surface shows grants, and offers them only where they mean something", () => {
  const table = read("src/app/admin/users/users-table.tsx");

  assert.match(table, /updateUserGrants/, "the table cannot grant anything");
  assert.match(table, /canEditSpecs/);
  assert.match(table, /canCreateLeaves/);

  // Admins pass both guards by role, so a toggle on an admin row would imply
  // it does something. The row says "by role" instead.
  assert.match(
    table,
    /by role/,
    "an admin's row offers a toggle that changes nothing about their access",
  );
});
