import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { codeOnly } from "../support/code-only.ts";
import {
  evaluateRecoverySupersession,
  supersessionMessage,
  type AuthorizationForWarning,
} from "../../src/lib/commercial-recovery/supersession.ts";
import { fingerprintCommercialState } from "../../src/lib/below-floor-authorization.ts";

const auth = (over: Partial<AuthorizationForWarning> = {}): AuthorizationForWarning => ({
  tierId: "t1",
  quoteVersionNumber: 1,
  stateFingerprint: "rev:1000.00|cost:800.00|margin:20.000000",
  invalidatedAt: null,
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════
// The warning WARNS. It does not invalidate, and it does not decide.
// ═══════════════════════════════════════════════════════════════════════

test("the warning surface performs no write of any kind", async () => {
  const src = codeOnly(
    await readFile(
      new URL("../../src/lib/commercial-recovery/supersession.ts", import.meta.url),
      "utf8",
    ),
  );
  // Existing authorization supersession stays THE mechanism. A second
  // invalidation write is exactly what this must not become.
  for (const forbidden of [/\bdb\b/, /insert\(/, /update\(/, /delete\(/, /invalidatedAt:\s*new Date/]) {
    assert.doesNotMatch(src, forbidden, `the warning surface grew a write: ${forbidden}`);
  }
});

test("it compares fingerprints, never modes — no second definition of material", async () => {
  const src = codeOnly(
    await readFile(
      new URL("../../src/lib/commercial-recovery/supersession.ts", import.meta.url),
      "utf8",
    ),
  );
  // A mode-shaped rule ("warn if absorbed") would be a rival definition of
  // material change sitting beside the real one, free to drift from it.
  assert.doesNotMatch(src, /"absorbed"|"included"|"separate"/);
  assert.doesNotMatch(src, /RecoveryMode/);
});

test("a moved fingerprint supersedes; an unmoved one does not", () => {
  const a = auth();
  const unmoved = evaluateRecoverySupersession({
    authorizations: [a],
    quoteVersionNumber: 1,
    projectedFingerprintByTier: new Map([["t1", a.stateFingerprint]]),
  });
  assert.equal(unmoved.willSupersede, false);
  assert.equal(supersessionMessage(unmoved), null);

  const moved = evaluateRecoverySupersession({
    authorizations: [a],
    quoteVersionNumber: 1,
    projectedFingerprintByTier: new Map([
      ["t1", fingerprintCommercialState({ totalRevenue: 900, totalCost: 800, blendedMarginPct: 11.11 })],
    ]),
  });
  assert.equal(moved.willSupersede, true);
  assert.equal(moved.superseded[0].tierId, "t1");
  assert.match(supersessionMessage(moved) ?? "", /authorize again before the quote can be sent/i);
});

test("revenue-neutral recomposition does not warn", () => {
  // included <-> separate is revenue-neutral by construction, so the terms the
  // fingerprint is built from do not move — and the warning stays silent
  // WITHOUT anyone having written a rule that says "included/separate is safe".
  const before = fingerprintCommercialState({
    totalRevenue: 1000,
    totalCost: 800,
    blendedMarginPct: 20,
  });
  const after = fingerprintCommercialState({
    totalRevenue: 1000,
    totalCost: 800,
    blendedMarginPct: 20,
  });
  const w = evaluateRecoverySupersession({
    authorizations: [auth({ stateFingerprint: before })],
    quoteVersionNumber: 1,
    projectedFingerprintByTier: new Map([["t1", after]]),
  });
  assert.equal(w.willSupersede, false);
});

test("float noise below the fingerprint's rounding does not warn", () => {
  // Invalidating an approval because the tenth decimal moved would teach
  // operators that invalidation is noise. The rounding lives in the
  // fingerprint, so this inherits it rather than re-deciding it.
  const before = fingerprintCommercialState({
    totalRevenue: 1000,
    totalCost: 800,
    blendedMarginPct: 20,
  });
  const after = fingerprintCommercialState({
    totalRevenue: 1000.0000001,
    totalCost: 800,
    blendedMarginPct: 20.0000000001,
  });
  const w = evaluateRecoverySupersession({
    authorizations: [auth({ stateFingerprint: before })],
    quoteVersionNumber: 1,
    projectedFingerprintByTier: new Map([["t1", after]]),
  });
  assert.equal(w.willSupersede, false);
});

test("an authorization for another version or already withdrawn is not warned about", () => {
  const moved = new Map([["t1", "rev:900.00|cost:800.00|margin:11.110000"]]);

  assert.equal(
    evaluateRecoverySupersession({
      authorizations: [auth({ quoteVersionNumber: 2 })],
      quoteVersionNumber: 1,
      projectedFingerprintByTier: moved,
    }).willSupersede,
    false,
  );

  assert.equal(
    evaluateRecoverySupersession({
      authorizations: [auth({ invalidatedAt: new Date("2026-08-01") })],
      quoteVersionNumber: 1,
      projectedFingerprintByTier: moved,
    }).willSupersede,
    false,
    "warning about an already-withdrawn approval says something already gone is about to go",
  );
});

test("a tier with no projected fingerprint is not asserted about", () => {
  // Silence beats a warning asserted from data that was never computed — the
  // same discipline as distinguishing 'not_found' from 'read_failed'.
  const w = evaluateRecoverySupersession({
    authorizations: [auth()],
    quoteVersionNumber: 1,
    projectedFingerprintByTier: new Map(),
  });
  assert.equal(w.willSupersede, false);
});

test("every superseded tier reports both fingerprints", () => {
  const w = evaluateRecoverySupersession({
    authorizations: [auth({ tierId: "a" }), auth({ tierId: "b" })],
    quoteVersionNumber: 1,
    projectedFingerprintByTier: new Map([
      ["a", "rev:1.00|cost:1.00|margin:0.000000"],
      ["b", "rev:2.00|cost:1.00|margin:50.000000"],
    ]),
  });
  assert.equal(w.superseded.length, 2);
  for (const s of w.superseded) {
    // Both sides, so a support question can be answered from the record
    // rather than by re-deriving what the state used to be.
    assert.notEqual(s.authorizedFingerprint, s.projectedFingerprint);
    assert.ok(s.authorizedFingerprint.length > 0);
  }
  assert.match(supersessionMessage(w) ?? "", /2 tiers'/);
});
