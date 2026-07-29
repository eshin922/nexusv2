import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRuntimeSafety,
  isLoopbackNetworkUrl,
  PROVIDER_KIND_ENV,
} from "../../src/lib/config/runtime-config.ts";
import {
  assertIsolatedProviderSet,
  type IntegrationProviderDescriptor,
} from "../../src/lib/integrations/provider-kind.ts";

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

test("provider set assertion rejects production provider", () => {
  const providers: IntegrationProviderDescriptor[] = [
    { name: "auth", kind: "isolated" },
    { name: "hubspot", kind: "production" },
  ];
  assert.throws(() => assertIsolatedProviderSet(providers), /hubspot/);
});

