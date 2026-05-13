// Phase 1 prep — probe HUBSPOT_WRITE_ACCESS_TOKEN's products scope
// without performing a destructive create. Two reads:
//   1. GET /crm/v3/objects/products/schema  (requires crm.objects.products.read)
//   2. GET /crm/v3/objects/products?limit=1 (also read-scope; sanity)
//
// If either succeeds the read scope is fine. To probe WRITE scope without
// creating data, we attempt a create with an intentionally invalid
// payload (missing required `name`). HubSpot returns:
//   - 400 VALIDATION_ERROR  → write scope is granted, create infra works
//   - 403 INVALID_AUTHENTICATION / OBJECT_NOT_PERMITTED → no write scope
// We never actually create a product.
//
// Run via:
//   node --env-file=.env.local scripts/hubspot-products-scope-probe.mjs

// Phase 1 dev posture: HUBSPOT_DEV_ACCESS_TOKEN is the dev-sandbox
// token. HUBSPOT_WRITE_ACCESS_TOKEN (prod) stays commented out in
// .env.local so dev writes can't accidentally hit prod.
const token =
  process.env.HUBSPOT_DEV_ACCESS_TOKEN ?? process.env.HUBSPOT_WRITE_ACCESS_TOKEN;
if (!token) {
  console.error(
    "Neither HUBSPOT_DEV_ACCESS_TOKEN nor HUBSPOT_WRITE_ACCESS_TOKEN is set",
  );
  process.exit(1);
}
console.log(
  `Using ${process.env.HUBSPOT_DEV_ACCESS_TOKEN ? "HUBSPOT_DEV_ACCESS_TOKEN" : "HUBSPOT_WRITE_ACCESS_TOKEN"} (length ${token.length})\n`,
);

const BASE = "https://api.hubapi.com";
const HEAD = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function probe(label, init) {
  process.stdout.write(`  ${label} ... `);
  const res = await fetch(init.url, {
    method: init.method ?? "GET",
    headers: HEAD,
    body: init.body,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  console.log(`${res.status} ${res.statusText}`);
  return { status: res.status, body };
}

console.log("Hub identity probe (verifies which HubSpot portal the token belongs to):");
const me = await probe("GET /account-info/v3/details", {
  url: `${BASE}/account-info/v3/details`,
});
if (me.body?.portalId) {
  console.log(`  -> portalId = ${me.body.portalId}`);
  console.log(`  -> HUBSPOT_PROD_HUB_ID  = ${process.env.HUBSPOT_PROD_HUB_ID ?? "(unset)"}`);
  console.log(`  -> HUBSPOT_DEV_HUB_ID   = ${process.env.HUBSPOT_DEV_HUB_ID ?? "(unset)"}`);
  if (String(me.body.portalId) === String(process.env.HUBSPOT_DEV_HUB_ID)) {
    console.log("  -> Token is for the DEV hub ✓");
  } else if (String(me.body.portalId) === String(process.env.HUBSPOT_PROD_HUB_ID)) {
    console.log("  -> Token is for the PROD hub (!) — env var named dev but value is prod");
  } else {
    console.log("  -> Token is for some OTHER hub — value doesn't match either configured ID");
  }
}
console.log("");

console.log("Read-scope probes:");
const schema = await probe("GET /crm/v3/objects/products/schema (read scope)", {
  url: `${BASE}/crm/v3/objects/products/schema`,
});
const list = await probe("GET /crm/v3/objects/products?limit=1 (read scope)", {
  url: `${BASE}/crm/v3/objects/products?limit=1`,
});

console.log("\nWrite-scope probe (PATCH non-existent id — no record touched):");
// HubSpot's Products endpoint is lenient on POST — even `{properties: {}}`
// creates an empty record (proved during initial probe; created
// 44744402968, deleted via DELETE 204). To verify write scope without
// any data side-effect, PATCH a non-existent id:
//   - 404 OBJECT_NOT_FOUND → write scope granted, endpoint reachable
//   - 403 MISSING_SCOPES   → write scope still blocked
// PATCH against a non-existent UUID-shaped id never creates a row.
const create = await probe(
  "PATCH /crm/v3/objects/products/0 (no record touched)",
  {
    url: `${BASE}/crm/v3/objects/products/0`,
    method: "PATCH",
    body: JSON.stringify({ properties: { name: "scope-probe-noop" } }),
  },
);

console.log("\n--- Summary ---");
const readOk = schema.status < 400 || list.status < 400;
// PATCH non-existent id: 404 OBJECT_NOT_FOUND means the call reached
// the products endpoint, which proves write scope. 403 MISSING_SCOPES
// (or related auth failures) means write scope is still blocked.
const writeOk =
  create.status === 404 ||
  (create.body?.category && create.body.category === "OBJECT_NOT_FOUND");
const writeBlocked =
  create.status === 403 ||
  (create.body?.category &&
    (create.body.category === "INVALID_AUTHENTICATION" ||
      create.body.category === "OBJECT_NOT_PERMITTED" ||
      create.body.category === "MISSING_SCOPES"));

console.log(`Read scope:  ${readOk ? "OK" : "BLOCKED"}`);
console.log(
  `Write scope: ${
    writeOk ? "OK (token reaches create endpoint)" : writeBlocked ? "BLOCKED (403 / no scope)" : "AMBIGUOUS"
  }`,
);

if (!writeOk) {
  console.log("\nRaw create response body:");
  console.log(JSON.stringify(create.body, null, 2));
}
