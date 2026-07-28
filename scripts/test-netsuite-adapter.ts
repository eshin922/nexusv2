// Slice 12 Step 8c-1 — unit-test harness for pure-function NetSuite
// adapter primitives.
//
// Run via:
//   node --experimental-strip-types scripts/test-netsuite-adapter.ts
//
// Exercises composition-hash + description-generator + item-resolver
// formatting. No external calls; no DB access. On any assertion
// failure, exits 1 with a diff.

import {
  computeCompositionHash,
  computeCompositionHashDebug,
  externalIdForHash,
} from "../src/lib/netsuite/composition-hash.ts";
import { generateGroupDescription } from "../src/lib/netsuite/description-generator.ts";
import {
  formatResolutionErrors,
  type ResolveResult,
} from "../src/lib/netsuite/item-resolver-format.ts";
import { classifyResponse } from "../src/lib/netsuite/errors.ts";

let failures = 0;

function expect(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${b}`);
    console.log(`      actual:   ${a}`);
  }
}

function expectThrows(label: string, fn: () => unknown, matcher: RegExp) {
  try {
    fn();
    failures++;
    console.log(`  ✗ ${label} — expected throw matching ${matcher}, got no throw`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (matcher.test(msg)) {
      console.log(`  ✓ ${label}`);
    } else {
      failures++;
      console.log(`  ✗ ${label} — throw message didn't match ${matcher}`);
      console.log(`      got: ${msg}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
console.log("\n=== composition-hash ===\n");

const base = {
  customerNetsuiteId: "131860",
  baseSku: "TCS-BAR-01-EPICUREN-01",
  members: [
    { netsuiteItemId: "1234", quantity: 1 },
    { netsuiteItemId: "5678", quantity: 2 },
  ],
};
const hash1 = computeCompositionHash(base);
expect("hash length", hash1.length, 64);
expect("hash is hex", /^[0-9a-f]{64}$/.test(hash1), true);

// Determinism
const hash2 = computeCompositionHash(base);
expect("determinism — same input → same hash", hash2, hash1);

// Order invariance
const reordered = {
  ...base,
  members: [
    { netsuiteItemId: "5678", quantity: 2 },
    { netsuiteItemId: "1234", quantity: 1 },
  ],
};
expect("order invariance — reordering members preserves hash", computeCompositionHash(reordered), hash1);

// Customer change → different hash
const otherCustomer = { ...base, customerNetsuiteId: "999999" };
expect("customer change → different hash", computeCompositionHash(otherCustomer) !== hash1, true);

// Base SKU change → different hash
const otherBase = { ...base, baseSku: "TCS-BAR-01-OTHER" };
expect("base SKU change → different hash", computeCompositionHash(otherBase) !== hash1, true);

// Quantity change → different hash
const qtyChange = {
  ...base,
  members: [
    { netsuiteItemId: "1234", quantity: 2 }, // was 1
    { netsuiteItemId: "5678", quantity: 2 },
  ],
};
expect("qty change (1→2 on one member) → different hash", computeCompositionHash(qtyChange) !== hash1, true);

// Extra member → different hash
const extraMember = {
  ...base,
  members: [...base.members, { netsuiteItemId: "9999", quantity: 1 }],
};
expect("adding a member → different hash", computeCompositionHash(extraMember) !== hash1, true);

// Whitespace insensitivity on string inputs (trim + preserve case)
const withWhitespace = {
  ...base,
  customerNetsuiteId: "  131860  ",
  baseSku: " TCS-BAR-01-EPICUREN-01 ",
};
expect("whitespace trimmed on string inputs", computeCompositionHash(withWhitespace), hash1);

// externalId format
expect("externalId format", externalIdForHash(hash1), `nxs-grp-${hash1}`);

// Validation failures
expectThrows(
  "empty customer id throws",
  () => computeCompositionHash({ ...base, customerNetsuiteId: "" }),
  /customerNetsuiteId is required/,
);
expectThrows(
  "empty base sku throws",
  () => computeCompositionHash({ ...base, baseSku: "  " }),
  /baseSku is required/,
);
expectThrows(
  "empty members throws",
  () => computeCompositionHash({ ...base, members: [] }),
  /members must be non-empty/,
);
expectThrows(
  "duplicate member id throws",
  () =>
    computeCompositionHash({
      ...base,
      members: [
        { netsuiteItemId: "1234", quantity: 1 },
        { netsuiteItemId: "1234", quantity: 2 },
      ],
    }),
  /duplicate member ns item id/,
);
expectThrows(
  "zero quantity throws",
  () =>
    computeCompositionHash({
      ...base,
      members: [{ netsuiteItemId: "1234", quantity: 0 }],
    }),
  /positive integer/,
);
expectThrows(
  "float quantity throws",
  () =>
    computeCompositionHash({
      ...base,
      members: [{ netsuiteItemId: "1234", quantity: 1.5 }],
    }),
  /positive integer/,
);

// Debug output includes canonicalized shape
const debug = computeCompositionHashDebug(base);
expect("debug hash matches computeCompositionHash", debug.hash, hash1);
expect("debug canonical.members length", debug.canonical.members.length, 2);
expect("debug members sorted by id", debug.canonical.members[0].id, "1234");

// ────────────────────────────────────────────────────────────
console.log("\n=== description-generator ===\n");

const desc = generateGroupDescription({
  customerDisplay: "Epicuren",
  dealName: "Pro Masks",
  baseSku: "TCS-BAR-01-EPICUREN-01",
  hubspotDealId: "40412634025",
  members: [
    { sku: "TCS-BAR-01", name: "Bar Soap Travel Case", quantity: 1 },
    { sku: "UC-CAP", name: "Undercap", quantity: 1 },
    { sku: "OTC-Tooling-EP", name: "Epicuren tooling", quantity: 1 },
  ],
});
const expectedDesc =
  "Epicuren · Pro Masks · TCS-BAR-01-EPICUREN-01 · Deal 40412634025\n" +
  "Components: 1× TCS-BAR-01 (Bar Soap Travel Case) + 1× UC-CAP (Undercap) + 1× OTC-Tooling-EP (Epicuren tooling)";
expect("description exact text (CA-approved format)", desc, expectedDesc);

// Multi-quantity member
const descMulti = generateGroupDescription({
  customerDisplay: "Roman",
  dealName: "Hair Sprayer",
  baseSku: "HS-01",
  hubspotDealId: "99999",
  members: [
    { sku: "BOTTLE-100ML", name: "Bottle 100ml", quantity: 2 },
    { sku: "PUMP", name: "Pump", quantity: 1 },
  ],
});
expect(
  "description with multi-qty",
  descMulti,
  "Roman · Hair Sprayer · HS-01 · Deal 99999\nComponents: 2× BOTTLE-100ML (Bottle 100ml) + 1× PUMP (Pump)",
);

// Missing name — SKU-only render
const descNoName = generateGroupDescription({
  customerDisplay: "Test",
  dealName: "Test Deal",
  baseSku: "X",
  hubspotDealId: "1",
  members: [{ sku: "SKU-A", name: "", quantity: 1 }],
});
expect(
  "description with missing name renders SKU alone",
  descNoName,
  "Test · Test Deal · X · Deal 1\nComponents: 1× SKU-A",
);

expectThrows(
  "empty customerDisplay throws",
  () =>
    generateGroupDescription({
      customerDisplay: "",
      dealName: "d",
      baseSku: "s",
      hubspotDealId: "1",
      members: [{ sku: "x", name: "y", quantity: 1 }],
    }),
  /customerDisplay is required/,
);
expectThrows(
  "empty members throws",
  () =>
    generateGroupDescription({
      customerDisplay: "c",
      dealName: "d",
      baseSku: "s",
      hubspotDealId: "1",
      members: [],
    }),
  /members must be non-empty/,
);

// ────────────────────────────────────────────────────────────
console.log("\n=== item-resolver error formatting ===\n");

const allFound: ResolveResult[] = [
  { status: "found", sku: "A", netsuiteItemId: "1", itemid: "A", itemtype: "InvtPart" },
];
expect("all-found → null", formatResolutionErrors(allFound), null);

const mixed: ResolveResult[] = [
  { status: "found", sku: "A", netsuiteItemId: "1", itemid: "A", itemtype: "InvtPart" },
  { status: "not_found", sku: "B" },
  {
    status: "ambiguous",
    sku: "C",
    matches: [
      { netsuiteItemId: "10", itemid: "C", itemtype: "InvtPart" },
      { netsuiteItemId: "20", itemid: "C", itemtype: "InvtPart" },
    ],
  },
];
const errText = formatResolutionErrors(mixed);
expect(
  "mixed formatting — header count",
  errText?.startsWith("Cannot resolve 2 NetSuite items:"),
  true,
);
expect(
  "mixed formatting — not_found line present",
  errText?.includes("• B: no matching NetSuite item found"),
  true,
);
expect(
  "mixed formatting — ambiguous line present",
  errText?.includes("• C: 2 matching NetSuite items"),
  true,
);

// Singular / plural
const singular: ResolveResult[] = [{ status: "not_found", sku: "X" }];
expect(
  "singular — 'item' not 'items'",
  formatResolutionErrors(singular)?.startsWith("Cannot resolve 1 NetSuite item:"),
  true,
);

// ────────────────────────────────────────────────────────────
console.log("\n=== errors.classifyResponse ===\n");

const auth = classifyResponse({
  status: 401,
  body: { title: "Unauthorized", "o:errorDetails": [{ detail: "Invalid login attempt", "o:errorCode": "INVALID_LOGIN" }] },
  url: "/x",
  method: "GET",
});
expect("401 → auth class", auth.className, "auth");
expect("401 detail extracted", auth.context.detail, "Invalid login attempt");
expect("401 code extracted", auth.context.code, "INVALID_LOGIN");
expect("auth is blocking", auth.isBlocking(), true);
expect("auth is not retryable", auth.isRetryable(), false);

const forbidden = classifyResponse({ status: 403, body: {}, url: "/x", method: "GET" });
expect("403 → forbidden class", forbidden.className, "forbidden");

const notFound = classifyResponse({ status: 404, body: {}, url: "/x", method: "GET" });
expect("404 → not_found class", notFound.className, "not_found");
expect("not_found is not blocking (legitimate probe outcome)", notFound.isBlocking(), false);

const validation = classifyResponse({
  status: 400,
  body: { "o:errorDetails": [{ detail: "Missing required field: itemId" }] },
  url: "/x",
  method: "POST",
});
expect("400 → validation class", validation.className, "validation");
expect("validation is blocking", validation.isBlocking(), true);

const concurrency = classifyResponse({
  status: 400,
  body: { "o:errorDetails": [{ detail: "Concurrency Limit Exceeded" }] },
  url: "/x",
  method: "POST",
});
expect("400 with concurrency detail → rate_limit class", concurrency.className, "rate_limit");
expect("rate_limit is retryable", concurrency.isRetryable(), true);

const server = classifyResponse({ status: 503, body: "", url: "/x", method: "POST" });
expect("503 → server class", server.className, "server");
expect("server is retryable", server.isRetryable(), true);

// ────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
