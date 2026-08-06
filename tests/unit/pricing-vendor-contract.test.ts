import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fakeHubSpot,
  readFakeHubSpotCalls,
  resetFakeHubSpot,
} from "../harness/providers/fake-hubspot.ts";

test("fake HubSpot boundary filters Vendor search and resolves exact stable IDs", async () => {
  resetFakeHubSpot();
  assert.deepEqual(await fakeHubSpot.searchVendors("packaging"), [
    {
      id: "900000000000001",
      name: "Validation Packaging Vendor",
    },
  ]);
  assert.deepEqual(await fakeHubSpot.resolveVendor("900000000000002"), {
    id: "900000000000002",
    name: "Acme Contract Manufacturing",
  });
  assert.equal(await fakeHubSpot.resolveVendor("900000000009999"), null);
  assert.deepEqual(
    readFakeHubSpotCalls().map(({ operation, input }) => ({ operation, input })),
    [
      {
        operation: "vendor-search",
        input: { query: "packaging", limit: 20 },
      },
      {
        operation: "vendor-resolve",
        input: { companyId: "900000000000002" },
      },
      {
        operation: "vendor-resolve",
        input: { companyId: "900000000009999" },
      },
    ],
  );
});

test("fake HubSpot boundary deterministically exposes Vendor lookup outages", async () => {
  const previous = process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
  process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = "vendor-search-fails";
  try {
    await assert.rejects(
      fakeHubSpot.searchVendors("packaging"),
      /vendor-search failure/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.NEXUS_FAKE_HUBSPOT_SCENARIO;
    } else {
      process.env.NEXUS_FAKE_HUBSPOT_SCENARIO = previous;
    }
  }
});

test("server action trusts only the exact HubSpot ID and canonical provider name", async () => {
  const source = await readFile(
    new URL("../../src/app/actions/assembly-leaf-inputs.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /hubspot\.resolveVendor\(requestedVendorId\)/);
  assert.doesNotMatch(
    source,
    /formData\.get\(["']pricingVendorNameSnapshot["']\)/,
  );
  assert.match(
    source,
    /pricingVendorNameSnapshot:\s*newPricingVendor\?\.name \?\? null/,
  );
  assert.match(source, /quoteForAssemblyLeafInputLineGroup\(lineGroupId\)/);
  const guard = source.indexOf(
    "quoteForAssemblyLeafInputLineGroup(lineGroupId)",
  );
  const resolve = source.indexOf("hubspot.resolveVendor(requestedVendorId)");
  const update = source.indexOf(".update(assemblyLeafInputs)", resolve);
  const audit = source.indexOf(
    'action: "assembly_leaf_input_line_updated"',
    update,
  );
  assert.ok(guard >= 0 && guard < resolve);
  assert.ok(resolve < update && update < audit);
  assert.match(
    source,
    /requestedVendorId === beforeRow\.pricingVendorHubspotCompanyId/,
  );
  const component = await readFile(
    new URL(
      "../../src/components/costs/packaging-drilldown.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(component, /Pricing Vendors could not be loaded\./);
  assert.match(component, /No eligible HubSpot Vendors match/);
  assert.match(
    component,
    /not the awarded or purchasing vendor\./,
  );

  const guards = await readFile(
    new URL("../../src/lib/quote-guards.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    guards,
    /quoteForAssemblyLeafInputLineGroup[\s\S]*requireDraft\(quote\)/,
  );
  assert.match(guards, /quote\.status !== "draft"/);
});

test("tier, preset, and clone paths preserve governed vendor identity only", async () => {
  // The tier and preset fan-outs moved into the shared materialization helper
  // (packaging-materialization.ts) so the leaf axis could not keep being
  // forgotten. Vendor identity is still preserved on every path -- it is just
  // preserved in one place now instead of three, so the invariant is asserted
  // where the copying actually happens rather than by counting occurrences in
  // quotes.ts.
  const [source, helper] = await Promise.all([
    readFile(new URL("../../src/app/actions/quotes.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../src/lib/packaging-materialization.ts", import.meta.url),
      "utf8",
    ),
  ]);
  for (const field of [
    "pricingVendorHubspotCompanyId",
    "pricingVendorNameSnapshot",
  ]) {
    // Read from the template row and written onto the new row.
    assert.ok(
      helper.split(field).length >= 3,
      `${field} must be carried by the shared materialization helper`,
    );
    // The clone path still lives in quotes.ts and must carry it too.
    assert.ok(
      source.split(field).length >= 3,
      `${field} must be preserved by the clone path in quotes.ts`,
    );
  }
  assert.doesNotMatch(source, /pricingDate/);
  assert.doesNotMatch(helper, /pricingDate/);
});

test("Pricing Date is dormant while its nullable production column remains", async () => {
  const [component, action, schema, migration] = await Promise.all([
    readFile(
      new URL(
        "../../src/components/costs/packaging-drilldown.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../../src/app/actions/assembly-leaf-inputs.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../src/db/schema.ts", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../../drizzle/0047_slice_13_pricing_vendor_identity.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.doesNotMatch(component, /Pricing Date|pricingDate/);
  assert.doesNotMatch(action, /Pricing Date|pricingDate|pricing_date/);
  assert.match(schema, /pricingDate: date\("pricing_date"\)/);
  assert.match(migration, /ADD COLUMN "pricing_date" date/);
});

test("Pricing Vendor provenance is absent from customer and NetSuite boundaries", async () => {
  const files = [
    "../../src/lib/customer-view-resolver.ts",
    "../../src/lib/customer-view-to-cpdf.ts",
    "../../src/lib/netsuite/sales-orders.ts",
    "../../src/lib/netsuite/mark-complete.ts",
  ];
  for (const relative of files) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.doesNotMatch(source, /pricingVendor|pricing_vendor|pricingDate/);
  }
});
