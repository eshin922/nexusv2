import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRuntimeSafety,
  isLoopbackNetworkUrl,
  PROVIDER_KIND_ENV,
} from "../../src/lib/config/runtime-config.ts";

function isolatedEnv(
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    NEXUS_ISOLATED_TEST: "1",
    DATABASE_URL:
      "postgresql://nexus:nexus@127.0.0.1:55432/nexus_validation_test",
    [PROVIDER_KIND_ENV.auth]: "isolated",
    [PROVIDER_KIND_ENV.hubspot]: "isolated",
    [PROVIDER_KIND_ENV.netsuite]: "isolated",
    [PROVIDER_KIND_ENV.artifacts]: "isolated",
    [PROVIDER_KIND_ENV.realtime]: "isolated",
    ...extra,
  };
}

test("accepts an isolated local validation configuration", () => {
  const result = assertRuntimeSafety(isolatedEnv());
  assert.equal(result.mode, "isolated");
  assert.equal(result.database?.host, "127.0.0.1");
  assert.equal(result.providers.hubspot, "isolated");
});

test("rejects remote database hostname", () => {
  assert.throws(
    () =>
      assertRuntimeSafety(
        isolatedEnv({
          DATABASE_URL:
            "postgresql://nexus:nexus@example.com:5432/nexus_validation_test",
        }),
      ),
    /database host is not local/,
  );
});

test("rejects unmarked database name", () => {
  assert.throws(
    () =>
      assertRuntimeSafety(
        isolatedEnv({
          DATABASE_URL: "postgresql://nexus:nexus@localhost:5432/postgres",
        }),
      ),
    /database name must contain 'nexus_validation'/,
  );
});

test("rejects production NODE_ENV", () => {
  assert.throws(
    () => assertRuntimeSafety(isolatedEnv({ NODE_ENV: "production" })),
    /NODE_ENV=production/,
  );
});

test("rejects Vercel production", () => {
  assert.throws(
    () => assertRuntimeSafety(isolatedEnv({ VERCEL_ENV: "production" })),
    /VERCEL_ENV=production/,
  );
});

for (const key of [
  "CLERK_SECRET_KEY",
  "HUBSPOT_ACCESS_TOKEN",
  "HUBSPOT_WRITE_ACCESS_TOKEN",
  "NETSUITE_ACCOUNT_ID",
  "NETSUITE_TOKEN_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  test(`rejects isolated credential ${key}`, () => {
    assert.throws(
      () => assertRuntimeSafety(isolatedEnv({ [key]: "definitely-not-empty" })),
      new RegExp(key),
    );
  });
}

test("rejects real adapter selection in isolated mode", () => {
  assert.throws(
    () =>
      assertRuntimeSafety(
        isolatedEnv({ [PROVIDER_KIND_ENV.hubspot]: "production" }),
      ),
    /requires NEXUS_HUBSPOT_PROVIDER=isolated/,
  );
});

test("rejects isolated adapter selection outside isolated mode", () => {
  assert.throws(
    () =>
      assertRuntimeSafety({
        NODE_ENV: "development",
        [PROVIDER_KIND_ENV.hubspot]: "isolated",
      }),
    /requires NEXUS_ISOLATED_TEST=1/,
  );
});

test("rejects validation identity selection outside isolated mode", () => {
  assert.throws(
    () =>
      assertRuntimeSafety({
        NODE_ENV: "development",
        NEXUS_VALIDATION_IDENTITY: "admin",
      }),
    /NEXUS_VALIDATION_IDENTITY requires isolated mode/,
  );
});

test("rejects an unknown validation identity", () => {
  assert.throws(
    () =>
      assertRuntimeSafety(
        isolatedEnv({ NEXUS_VALIDATION_IDENTITY: "request-controlled" }),
      ),
    /must be pm, admin, or unauthorized/,
  );
});

test("network allowlist accepts loopback protocols and rejects remote URLs", () => {
  assert.equal(isLoopbackNetworkUrl("http://127.0.0.1:3000/path"), true);
  assert.equal(isLoopbackNetworkUrl("ws://localhost:3000/socket"), true);
  assert.equal(isLoopbackNetworkUrl("https://api.hubapi.com"), false);
  assert.equal(
    isLoopbackNetworkUrl("https://example.suitetalk.api.netsuite.com"),
    false,
  );
  assert.equal(isLoopbackNetworkUrl("not-a-url"), false);
});

const sandboxRef = "awmnppovoyghaocrjfck";
const sandboxDatabase = `postgresql://postgres.${sandboxRef}:example@aws-1-us-west-2.pooler.supabase.com:5432/postgres`;

function sharedSandboxEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    NEXUS_SHARED_SANDBOX: "1",
    NEXT_PUBLIC_SUPABASE_URL: `https://${sandboxRef}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example",
    DATABASE_URL: sandboxDatabase,
    DIRECT_URL: sandboxDatabase,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_example",
    CLERK_SECRET_KEY: "sk_test_example",
    ...extra,
  };
}

test("accepts the dedicated shared sandbox without external production credentials", () => {
  const result = assertRuntimeSafety(sharedSandboxEnv());
  assert.equal(result.sharedSandbox, true);
  assert.equal(result.mode, "production");
});

test("refuses production Supabase project even when sandbox mode is requested", () => {
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://production-ref.supabase.co",
  })), /Supabase URL does not match/);
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    DATABASE_URL: "postgresql://postgres.production-ref:example@aws-1-us-west-2.pooler.supabase.com:5432/postgres",
  })), /dedicated session pooler/);
});

test("refuses transaction pooling and production integrations in the shared sandbox", () => {
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    DATABASE_URL: sandboxDatabase.replace(":5432/", ":6543/"),
  })), /dedicated session pooler/);
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    HUBSPOT_WRITE_ACCESS_TOKEN: "production-token",
  })), /refuses HubSpot configuration/);
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    HUBSPOT_DEV_ACCESS_TOKEN: "dev-token-before-routing-is-ready",
  })), /refuses HubSpot configuration/);
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    NETSUITE_ACCOUNT_ID: "7924416",
    NETSUITE_ENV: "sandbox",
  })), /NetSuite sandbox account/);
});

test("requires a separate Clerk instance for the shared sandbox", () => {
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    CLERK_SECRET_KEY: "sk_live_production",
  })), /Clerk development instance/);
});

test("Netlify cannot deploy without the sandbox guard", () => {
  assert.throws(() => assertRuntimeSafety({ NODE_ENV: "production", NETLIFY: "true" }), /requires NEXUS_SHARED_SANDBOX=1/);
});

test("sandbox rejects partial NetSuite credentials and missing Supabase keys", () => {
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    NETSUITE_TOKEN_SECRET: "unexpected-token",
  })), /NetSuite sandbox account/);
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    SUPABASE_SERVICE_ROLE_KEY: "",
  })), /new-format Supabase/);
  assert.throws(() => assertRuntimeSafety(sharedSandboxEnv({
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "legacy-or-production-key",
  })), /new-format Supabase/);
});
