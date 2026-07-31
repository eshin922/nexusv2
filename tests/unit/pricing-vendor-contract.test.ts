import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parsePricingDateOnly,
  PricingDateValidationError,
} from "../../src/lib/pricing-vendor.ts";
import {
  fakeHubSpot,
  readFakeHubSpotCalls,
  resetFakeHubSpot,
} from "../harness/providers/fake-hubspot.ts";

test("pricing date is nullable, date-only, and calendar-valid", () => {
  assert.equal(parsePricingDateOnly(null), null);
  assert.equal(parsePricingDateOnly(""), null);
  assert.equal(parsePricingDateOnly(" 2026-07-30 "), "2026-07-30");
  assert.throws(
    () => parsePricingDateOnly("07/30/2026"),
    PricingDateValidationError,
  );
  assert.throws(
    () => parsePricingDateOnly("2026-02-30"),
    PricingDateValidationError,
  );
});

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
    name: "Validation Contract Manufacturer",
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
  assert.match(component, /No matching HubSpot Vendors\./);
  assert.match(
    component,
    /Source of quoted pricing; not the awarded or purchasing vendor\./,
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

test("tier, preset, and clone paths preserve governed pricing provenance", async () => {
  const source = await readFile(
    new URL("../../src/app/actions/quotes.ts", import.meta.url),
    "utf8",
  );
  for (const field of [
    "pricingVendorHubspotCompanyId",
    "pricingVendorNameSnapshot",
    "pricingDate",
  ]) {
    assert.ok(
      source.split(field).length >= 7,
      `${field} must be selected and inserted by tier, preset, and clone paths`,
    );
  }
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
