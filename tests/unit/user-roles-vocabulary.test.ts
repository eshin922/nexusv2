import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";

import { userRole } from "../../src/db/schema.ts";

// ═══════════════════════════════════════════════════════════════════════
// NEXUS APPLICATION ROLES
//
// `logistics` and `sales` were added WITHOUT per-role gates, on the finding
// that no non-admin role is read for an authorization decision anywhere. That
// is only safe while it stays true, so the tests below assert the finding
// rather than the addition — if a future gate starts branching on a role, the
// silent-inheritance question reopens and these fail.
// ═══════════════════════════════════════════════════════════════════════

const SRC = (p: string) => readFile(new URL(`../../src/${p}`, import.meta.url), "utf8");

test("the vocabulary is exactly the governed eight, ordered by authority", () => {
  assert.deepEqual(userRole.enumValues, [
    "admin",
    "pm",
    "purchasing",
    "production",
    "accounting",
    "logistics",
    "sales",
    "read_only",
  ]);
});

test("read_only is LAST — the ladder must not be broken by an append", () => {
  const v = userRole.enumValues;
  assert.equal(v[v.length - 1], "read_only");
});

test("finance is not a role — it maps to accounting", () => {
  assert.equal(
    userRole.enumValues.includes("finance" as never),
    false,
    "a `finance` label would be a synonym nothing distinguishes from accounting",
  );
});

// ── the finding the addition rests on ─────────────────────────────────────

test("no non-admin role is read for an authorization decision", async () => {
  const files = [
    "lib/admin-guard.ts",
    "lib/spec-permission-guard.ts",
    "lib/below-floor-authorization.ts",
    "lib/auth/ensure-user.ts",
  ];
  for (const f of files) {
    const src = codeOnly(await SRC(f));
    for (const role of userRole.enumValues) {
      if (role === "admin") continue;
      assert.doesNotMatch(
        src,
        new RegExp(`role\\s*[=!]==\\s*["']${role}["']`),
        `${f} branches on the "${role}" role — per-role gating has arrived, and ` +
          `the inheritance question these values were added under must be re-asked`,
      );
    }
  }
});

test("logistics and sales appear in no guard at all", async () => {
  for (const f of [
    "lib/admin-guard.ts",
    "lib/spec-permission-guard.ts",
    "lib/below-floor-authorization.ts",
  ]) {
    const src = codeOnly(await SRC(f));
    assert.doesNotMatch(src, /logistics|sales/);
  }
});

// ── least privilege for an unrecognised identity ──────────────────────────

test("an unrecognised first-time signer is provisioned read_only, not pm", async () => {
  const src = codeOnly(await SRC("lib/auth/ensure-user.ts"));
  assert.match(
    src,
    /isAdmin\(email\)\s*\?\s*"admin"\s*:\s*"read_only"/,
    "the fallback must be least privilege",
  );
  assert.doesNotMatch(
    src,
    /:\s*"pm"/,
    "the pm fallback granted quote-authoring standing to anyone who fell " +
      "through onboarding, and overrode the column default to do it",
  );
});

test("the fallback agrees with the column default", async () => {
  const schema = await SRC("db/schema.ts");
  assert.match(schema, /userRole\("role"\)\.notNull\(\)\.default\("read_only"\)/);
});

// ── commercial approval stays independent ─────────────────────────────────

test("commercial_approver is not inferred from any role, including admin", async () => {
  const src = codeOnly(await SRC("lib/below-floor-authorization.ts"));
  assert.match(src, /return user\.commercialApprover === true;/);
  // BV-005: the cheapest way for this to erode is an `|| role === "admin"`
  // added to a helper that already has the role in hand.
  assert.doesNotMatch(src, /commercialApprover[^;]*\|\|/);
  assert.doesNotMatch(src, /role\s*===\s*"admin"\s*\|\|/);
});

test("no role implies spec or leaf authority except admin", async () => {
  const src = codeOnly(await SRC("lib/spec-permission-guard.ts"));
  const implicit = [...src.matchAll(/user\.role === "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(implicit)], ["admin"]);
});

// ── the roster is not provisioned by this slice ───────────────────────────

test("no roster identity is seeded in code or migration", async () => {
  const schema = await SRC("db/schema.ts");
  const ensure = await SRC("lib/auth/ensure-user.ts");
  const migration = await readFile(
    new URL("../../drizzle/0092_user_role_logistics_sales.sql", import.meta.url),
    "utf8",
  );
  // A NAMED identity, not the bare domain — `ensure-user` legitimately refers
  // to the @thedps.co check in prose, and a test that cannot tell a comment
  // from a seeded row would be measuring the wrong thing.
  for (const src of [codeOnly(schema), codeOnly(ensure), migration]) {
    assert.doesNotMatch(
      src,
      /[\w.]+@thedps\.co/,
      "roster provisioning is a separate, later step and must not ride along " +
        "with the vocabulary change",
    );
  }
  assert.doesNotMatch(migration, /INSERT|UPDATE/i, "the migration is additive only");
});

test("the migration keeps the authority order rather than appending", async () => {
  const migration = await readFile(
    new URL("../../drizzle/0092_user_role_logistics_sales.sql", import.meta.url),
    "utf8",
  );
  for (const v of ["logistics", "sales"]) {
    assert.match(
      migration,
      new RegExp(`ADD VALUE IF NOT EXISTS '${v}' BEFORE 'read_only'`),
      `${v} must be inserted before read_only, not appended after it`,
    );
  }
});
