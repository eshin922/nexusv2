/**
 * Does OUR private app actually control a property it creates?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * Four custom product properties in the production portal carry
 * `readOnlyValue: true`, and all four were app-created. That establishes the
 * capability EXISTS in the portal. It does NOT establish that our app has it:
 * those properties belong to other integrations, and "an app did this" is not
 * "this app can do this".
 *
 * The only thing that settles it is creating one and reading back what
 * HubSpot actually stored. So this probe creates, reads back, and archives --
 * IN A TEST PORTAL, never production.
 *
 * ── IT REFUSES TO TOUCH PRODUCTION ───────────────────────────────────────
 *
 * Guarded on the portal id, checked against the live token rather than taken
 * on trust from which variable it was read out of.
 *
 *   npm run probe:hubspot-property-capability
 *
 * Requires `crm.schemas.products.write` OR `e-commerce` on the dev private
 * app. It holds `e-commerce`, so the probe runs; if a future app does not,
 * it reports that as its finding rather than failing obscurely.
 *
 * RESULT, 2026-09-14 (portal 46710404): readOnlyValue requested true, stored
 * FALSE -- our app CANNOT declare a property integration-controlled.
 * hasUniqueValue requested true, stored true -- honoured, but it prevents
 * DUPLICATE values and establishes nothing about ownership. Automatic
 * adoption stays unavailable under the agreed design.
 */

const PRODUCTION_HUB_ID = 21497798;
const PROBE_NAME = "nexus_capability_probe";

const token = process.env.HUBSPOT_DEV_ACCESS_TOKEN ?? "";
if (!token) {
  console.error("HUBSPOT_DEV_ACCESS_TOKEN is not set. This probe never uses the production token.");
  process.exit(1);
}
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const info = await fetch("https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tokenKey: token }),
}).then((r) => r.json());

console.log(`portal: ${info.hubId}`);
if (info.hubId === PRODUCTION_HUB_ID) {
  console.error("REFUSING: that token is the production portal. This probe runs in the test portal only.");
  process.exit(1);
}

const scopes: string[] = info.scopes ?? [];
const canWriteSchema = scopes.includes("crm.schemas.products.write") || scopes.includes("e-commerce");
console.log(`crm.schemas.products.write: ${canWriteSchema ? "granted" : "NOT GRANTED"}`);
if (!canWriteSchema) {
  console.log(
    "\nFINDING: the capability cannot be tested yet.\n" +
      "  Grant `crm.schemas.products.write` on the DEV private app (portal " +
      `${info.hubId}), then re-run. Nothing was created.`,
  );
  process.exit(2);
}

// ── create, read back, archive ───────────────────────────────────────────
const created = await fetch("https://api.hubapi.com/crm/v3/properties/products", {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    name: PROBE_NAME,
    label: "Nexus capability probe",
    type: "string",
    fieldType: "text",
    groupName: "productinformation",
    description: "Temporary. Created by hubspot-property-capability-probe; safe to delete.",
    // What we are actually testing: can the app declare its own value
    // integration-controlled?
    modificationMetadata: { readOnlyValue: true, readOnlyDefinition: false, archivable: true },
    hasUniqueValue: true,
  }),
}).then((r) => r.json());

if (created.status === "error") {
  console.log("create refused:", created.message);
  process.exit(1);
}

const readBack = await fetch(
  `https://api.hubapi.com/crm/v3/properties/products/${PROBE_NAME}`,
  { headers: H },
).then((r) => r.json());

console.log("\nread-back — what HubSpot actually stored:");
console.log("  modificationMetadata:", JSON.stringify(readBack.modificationMetadata));
console.log("  hasUniqueValue:", readBack.hasUniqueValue);
console.log(
  `\nVERDICT: readOnlyValue requested=true stored=${readBack.modificationMetadata?.readOnlyValue}` +
    ` · hasUniqueValue requested=true stored=${readBack.hasUniqueValue}`,
);
console.log(
  readBack.modificationMetadata?.readOnlyValue === true
    ? "  -> our app CAN declare a property integration-controlled."
    : [
        "  -> our app CANNOT; HubSpot ignored the request.",
        "     hasUniqueValue is NOT a substitute: it bars duplicate values",
        "     and says nothing about who wrote one. Adoption stays",
        "     unavailable under the agreed design.",
      ].join("\n"),
);

await fetch(`https://api.hubapi.com/crm/v3/properties/products/${PROBE_NAME}`, {
  method: "DELETE",
  headers: H,
});
console.log("\nprobe property archived.");

export {};
