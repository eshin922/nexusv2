// The certification endpoint must prove the NetSuite target WITHOUT disclosing
// it. Those two requirements pull against each other, so both are pinned here.
//
// The disclosure half matters more than it looks: this endpoint is deliberately
// UNAUTHENTICATED, so anything it returns is public. A leaked account id is an
// identifier for the firm's NetSuite instance; a leaked token is worse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  describeNetsuiteTarget,
  _resetNetsuiteConfigForTests,
} from "../../src/lib/netsuite/client.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFile(path.join(root, p), "utf8");

const SECRETS = {
  NETSUITE_CONSUMER_KEY: "ck-secret-value",
  NETSUITE_CONSUMER_SECRET: "cs-secret-value",
  NETSUITE_TOKEN_ID: "ti-secret-value",
  NETSUITE_TOKEN_SECRET: "ts-secret-value",
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const prior: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetNetsuiteConfigForTests();
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetNetsuiteConfigForTests();
  }
}

// ------------------------------------------------------------- disclosure
test("the facts contain no account id and no credential", () => {
  const accountId = "7924416_SB2";
  const facts = withEnv(
    { NETSUITE_ACCOUNT_ID: accountId, NETSUITE_ENV: undefined, ...SECRETS },
    describeNetsuiteTarget,
  );

  // Exactly three derived fields — an allowlist, so a future addition has to be
  // deliberate rather than arriving by spreading the config.
  assert.deepEqual(Object.keys(facts).sort(), [
    "accountIsSandbox",
    "environment",
    "writeAuthorized",
  ]);

  const serialized = JSON.stringify(facts);
  assert.doesNotMatch(serialized, /7924416/);
  for (const secret of Object.values(SECRETS)) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  // No value may BE the account id, whole or in part.
  for (const value of Object.values(facts)) {
    assert.notEqual(value, accountId);
  }
});

test("the route never reads a credential or account variable", async () => {
  const src = await read("src/app/api/certification-status/route.ts");
  for (const name of [
    "NETSUITE_ACCOUNT_ID",
    "NETSUITE_CONSUMER_KEY",
    "NETSUITE_CONSUMER_SECRET",
    "NETSUITE_TOKEN_ID",
    "NETSUITE_TOKEN_SECRET",
    "accountId",
    "consumerKey",
    "tokenSecret",
  ]) {
    assert.doesNotMatch(src, new RegExp(name), `route must not reference ${name}`);
  }
});

// ----------------------------------------------------------------- proof
test("a sandbox account with no override is sandbox and writable", () => {
  const facts = withEnv(
    { NETSUITE_ACCOUNT_ID: "7924416_SB2", NETSUITE_ENV: undefined, ...SECRETS },
    describeNetsuiteTarget,
  );
  assert.deepEqual(facts, {
    environment: "sandbox",
    accountIsSandbox: true,
    writeAuthorized: true,
  });
});

test("a production account is production and refuses the write", () => {
  const facts = withEnv(
    { NETSUITE_ACCOUNT_ID: "7924416", NETSUITE_ENV: undefined, ...SECRETS },
    describeNetsuiteTarget,
  );
  assert.equal(facts.environment, "production");
  assert.equal(facts.accountIsSandbox, false);
  // The guard's own verdict, not a restatement of it.
  assert.equal(facts.writeAuthorized, false);
});

// ------------------------------------------- the hole the pair exists to close
test("NETSUITE_ENV=sandbox on a production account is exposed, not hidden", () => {
  // This is the ONE configuration that looks safe from every other angle: the
  // environment reads "sandbox" and the guard permits the write, because the
  // override defeats the account inference. `accountIsSandbox` is the only
  // field that still tells the truth, which is why it is asked separately.
  const facts = withEnv(
    { NETSUITE_ACCOUNT_ID: "7924416", NETSUITE_ENV: "sandbox", ...SECRETS },
    describeNetsuiteTarget,
  );
  assert.equal(facts.environment, "sandbox");
  assert.equal(facts.writeAuthorized, true);
  assert.equal(facts.accountIsSandbox, false); // ← the disagreement
  // So certification must require all three, never `environment` alone.
  const certificationPasses =
    facts.environment === "sandbox" &&
    facts.accountIsSandbox &&
    facts.writeAuthorized;
  assert.equal(certificationPasses, false);
});

// --------------------------------------------------------------- reuse
test("the endpoint reuses the production guard rather than restating it", async () => {
  const src = await read("src/lib/netsuite/client.ts");
  // writeAuthorized must come from calling assertWriteAuthorized. A parallel
  // implementation could agree today and diverge silently later — reporting a
  // safety it no longer establishes.
  assert.match(src, /describeNetsuiteTarget[\s\S]*assertWriteAuthorized\(config, "POST"\)/);
  // And accountIsSandbox must come from the same inference the client uses.
  assert.match(src, /accountIsSandbox: inferEnv\(config\.accountId\) === "sandbox"/);
});
