import assert from "node:assert/strict";
import test from "node:test";
import { includeAssociatedServicesInProductRows } from "../../src/lib/associated-service-presentation.ts";
import type { CommercialLine } from "../../src/lib/commercial-projection.ts";
import type { CustomerViewSku } from "../../src/types/quote.ts";

const priced = (rate: number, quantity: number) => ({
  state: "priced" as const,
  unitRate: rate,
  quantity,
  lineAmount: rate * quantity,
});
const line = (key: string, kind: CommercialLine["kind"], owner: string | null, rate: number): CommercialLine => ({
  key,
  kind,
  quoteLeafId: key,
  associatedProductQuoteLeafId: owner,
  cells: [priced(rate, 100)],
} as CommercialLine);
const sku = (id: string, rate: number): CustomerViewSku => ({
  id,
  label: id,
  name: id,
  pack: null,
  unitsPerPack: 1,
  multiplicityPerUnit: null,
  tierPrices: [rate],
  tierLineTotals: [rate * 100],
  shape: "flat",
});

test("two products sharing a service SKU stay distinct and conserve the customer total", () => {
  const lines = [
    line("product-a", "direct_product", null, 10),
    line("service-for-a", "direct_service", "product-a", 2),
    line("product-b", "direct_product", null, 20),
    line("service-for-b", "direct_service", "product-b", 3),
    line("standalone-service", "direct_service", null, 5),
  ];
  const rows = [sku("product-a", 10), sku("service-for-a", 2), sku("product-b", 20), sku("service-for-b", 3), sku("standalone-service", 5)];
  const originalTotal = rows.reduce((sum, row) => sum + row.tierLineTotals[0]!, 0);
  const grouped = includeAssociatedServicesInProductRows(lines, rows);
  assert.deepEqual(grouped.map((row) => row.id), ["product-a", "product-b", "standalone-service"]);
  assert.deepEqual(grouped.map((row) => row.tierPrices[0]), [12, 23, 5]);
  assert.equal(grouped.reduce((sum, row) => sum + row.tierLineTotals[0]!, 0), originalTotal);
  assert.equal(lines.length, 5, "presentation does not mutate the accounting line set");
});

test("an unpriced associated service stays visible instead of disappearing into a partial product price", () => {
  const product = line("product", "direct_product", null, 10);
  const service = { ...line("service", "direct_service", "product", 2), cells: [{ state: "quote_on_request" as const }] };
  const grouped = includeAssociatedServicesInProductRows([product, service], [sku("product", 10), sku("service", 2)]);
  assert.deepEqual(grouped.map((row) => row.id), ["product", "service"]);
});

test("a grouped product includes only its own associated service in the customer group subtotal", () => {
  const member = line("member", "item_group_member", null, 10);
  const service = line("service", "direct_service", "member", 2);
  const other = line("other", "item_group_member", null, 3);
  const result = includeAssociatedServicesInProductRows([member, service, other], [sku("member", 10), sku("service", 2), sku("other", 3)]);
  assert.deepEqual(result.map((row) => row.id), ["member", "other"]);
  assert.deepEqual(result.map((row) => row.tierLineTotals[0]), [1200, 300]);
});

test("two named tests for one grouped product contribute exactly once each", () => {
  const member = line("member", "item_group_member", null, 10);
  const micro = { ...line("micro", "direct_service", "member", 2), displayName: "Testing / Micros · Micro screening" };
  const stability = { ...line("stability", "direct_service", "member", 3), displayName: "Testing / Micros · Stability" };
  const result = includeAssociatedServicesInProductRows(
    [member, micro, stability],
    [sku("member", 10), sku("micro", 2), sku("stability", 3)],
  );
  assert.deepEqual(result.map((row) => row.id), ["member"]);
  assert.equal(result[0].tierLineTotals[0], 1500);
  assert.deepEqual(result[0].includedServices, [micro.displayName, stability.displayName]);
});
