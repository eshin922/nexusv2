import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRuntimeSafety,
  PROVIDER_KIND_ENV,
} from "../../src/lib/config/runtime-config.ts";

function base(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    NEXUS_ISOLATED_TEST: "1",
    DATABASE_URL:
      "postgresql://nexus_validation:nexus_validation@nexus-validation-db:5432/nexus_validation_test",
    [PROVIDER_KIND_ENV.auth]: "isolated",
    [PROVIDER_KIND_ENV.hubspot]: "isolated",
    [PROVIDER_KIND_ENV.netsuite]: "isolated",
    [PROVIDER_KIND_ENV.artifacts]: "isolated",
    [PROVIDER_KIND_ENV.realtime]: "isolated",
  };
}

test("approved local container hostname is accepted", () => {
  const safety = assertRuntimeSafety(base());
  assert.equal(safety.database?.host, "nexus-validation-db");
});

test("lookalike validation marker on remote host remains rejected", () => {
  assert.throws(
    () =>
      assertRuntimeSafety({
        ...base(),
        DATABASE_URL:
          "postgresql://nexus:nexus@nexus-validation.example.com:5432/nexus_validation_test",
      }),
    /host is not local/,
  );
});
