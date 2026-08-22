import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly as stripComments } from "../support/code-only.ts";

const codeOnly = (src: string): string =>
  stripComments(src).replace(/\r\n/g, "\n");

// ═══════════════════════════════════════════════════════════════════════
// COMMERCIAL APPROVER AUTHORITY IS NOT DERIVED FROM ROLE
//
// BV-005: authority "must not be hardcoded to the `admin` role". The three
// approvers granted on 2026-08-22 all happen to be Admins, which makes this the
// moment the derivation is most likely to be introduced — by someone who reads
// the table, sees the correlation, and "simplifies".
//
// `below-floor-authorization.test.ts` already proves `mayAuthorizeBelowFloor`
// ignores `role`. That is the READ side. These tests cover the WRITE side: that
// nothing anywhere sets the column from a role, and that the paths which create
// users cannot grant it at all.
// ═══════════════════════════════════════════════════════════════════════

const SRC = new URL("../../src/", import.meta.url);
const SCRIPTS = new URL("../../scripts/", import.meta.url);

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(child)));
    else if (/\.tsx?$/.test(e.name)) out.push(child);
  }
  return out;
}

/**
 * A write of the authority column whose value mentions a role.
 *
 * Covers the Drizzle spelling and the SQL one, and does NOT require the word
 * "admin" — `role === "accounting"` would be just as much a derivation, and a
 * pattern that only caught `admin` would pass the day someone picked a
 * different role.
 */
const DERIVATION =
  /(commercialApprover|commercial_approver)\s*[:=][^\n,;)]*\brole\b/i;

// ── the instrument, checked before it is trusted ──────────────────────────

test("the derivation pattern can actually match a violation", () => {
  // A grep that cannot express the failure it excludes reports zero for the
  // wrong reason. Four shapes a future author might plausibly write.
  for (const violation of [
    `commercialApprover: user.role === "admin",`,
    `commercialApprover: role === "accounting"`,
    `commercial_approver = (role = 'admin')`,
    `set({ commercialApprover: r.role !== "read_only" })`,
  ]) {
    assert.match(violation, DERIVATION, `should have caught: ${violation}`);
  }
  // And does not fire on the legitimate shapes, or it would be unusable and
  // get deleted by the first person it inconveniences.
  for (const ok of [
    `commercialApprover: false,`,
    `commercialApprover: true, updatedAt: new Date()`,
    `select({ role: users.role, commercialApprover: users.commercialApprover })`,
  ]) {
    assert.doesNotMatch(ok, DERIVATION, `false positive on: ${ok}`);
  }
});

// ── the sweep ─────────────────────────────────────────────────────────────

test("no file in src/ derives approver authority from a role", async () => {
  const hits: string[] = [];
  for (const f of await walk(SRC)) {
    const src = codeOnly(await readFile(f, "utf8"));
    if (DERIVATION.test(src)) hits.push(f.pathname);
  }
  assert.deepEqual(hits, [], `authority derived from role in: ${hits.join(", ")}`);
});

test("no script derives approver authority from a role", async () => {
  const hits: string[] = [];
  for (const f of await walk(SCRIPTS)) {
    const src = codeOnly(await readFile(f, "utf8"));
    if (DERIVATION.test(src)) hits.push(f.pathname);
  }
  assert.deepEqual(hits, [], `authority derived from role in: ${hits.join(", ")}`);
});

// ── the grant itself ──────────────────────────────────────────────────────

const GRANT = () =>
  readFile(new URL("gate-1b/grant-commercial-approvers.ts", SCRIPTS), "utf8");

test("the grant selects its subjects by address, never by role", async () => {
  const src = codeOnly(await GRANT());
  // The three are named literally. A grant that queried `where role = 'admin'`
  // would produce the same three rows today and a different set tomorrow.
  for (const email of ["edward@thedps.co", "amy@thedps.co", "daniel@thedps.co"]) {
    assert.match(src, new RegExp(email.replace(".", "\\.")));
  }
  assert.doesNotMatch(src, /where[^\n]*\brole\b/i);
  assert.doesNotMatch(src, /eq\(users\.role/);
});

test("the grant excludes the historical actor by name", async () => {
  // Two approver rows for one human defeats independence, which is evaluated
  // between user IDS and cannot see that they are the same person. The
  // exclusion is asserted rather than left as an omission, because an omission
  // is invisible to the next person editing the list.
  const src = codeOnly(await GRANT());
  assert.match(src, /MUST_NOT_GRANT\s*=\s*"edward\.shin@gmail\.com"/);
  assert.match(src, /commercial_approver === true/, "must refuse if it is already set");
});

test("the grant moves exactly one column", async () => {
  const src = codeOnly(await GRANT());
  const set = src.slice(src.indexOf(".set({"), src.indexOf(".where(and(eq(users.id"));
  assert.match(set, /commercialApprover:\s*true/);
  for (const forbidden of [
    "role:",
    "bindingState:",
    "clerkUserId:",
    "canEditSpecs:",
    "canCreateLeaves:",
    "hubspotOwnerId:",
    "slackUserId:",
  ]) {
    assert.ok(!set.includes(forbidden), `${forbidden} must not appear in the SET clause`);
  }
});

test("the grant is double-keyed so a re-run cannot re-grant", async () => {
  const src = codeOnly(await GRANT());
  assert.match(src, /eq\(users\.commercialApprover,\s*false\)/);
});

// ── creation paths cannot grant it ────────────────────────────────────────

test("becoming a user — by any path — grants no approver authority", async () => {
  for (const rel of [
    "lib/auth/provision-pending-user.ts",
    "lib/auth/ensure-user.ts",
    "lib/auth/pending-binding.ts",
  ]) {
    const src = codeOnly(await readFile(new URL(rel, SRC), "utf8"));
    assert.doesNotMatch(
      src,
      /commercialApprover:\s*true/,
      `${rel} must never set approver authority`,
    );
  }
});
