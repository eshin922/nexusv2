import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  fakeHubSpot,
  readFakeHubSpotCalls,
  resetFakeHubSpot,
} from "../harness/providers/fake-hubspot.ts";

test("fake HubSpot Product creation is deterministic and ledgered", async () => {
  resetFakeHubSpot();
  const input = {
    name: "Validation Reusable Component",
    hs_sku: "VAL-COMP-001",
    hs_cost_of_goods_sold: "1.2500",
  };

  assert.deepEqual(await fakeHubSpot.createProduct(input), {
    id: "998000000000001",
    hs_sku: "VAL-COMP-001",
    name: "Validation Reusable Component",
  });
  assert.deepEqual(
    readFakeHubSpotCalls().map(({ operation, input: callInput }) => ({
      operation,
      input: callInput,
    })),
    [{ operation: "product-create", input }],
  );
});

test("fake HubSpot Product failure is deterministic", async () => {
  resetFakeHubSpot();
  await assert.rejects(
    fakeHubSpot.createProduct({ name: "Validation Product Provider Failure" }),
    /HubSpot fake product-create failure/,
  );
  assert.equal(readFakeHubSpotCalls()[0]?.operation, "product-create");
});

test("Product creation uses the governed provider before LEAF persistence", async () => {
  const source = await readFile(
    new URL("../../src/app/actions/leaves.ts", import.meta.url),
    "utf8",
  );
  const action = source.slice(
    source.indexOf("export async function createLeaf"),
    source.indexOf("export async function restoreLeaf"),
  );

  assert.doesNotMatch(source, /from\s+["']@\/lib\/hubspot["']/);
  const providerCreate = action.indexOf("await hubspot.createProduct(hubspotInput)");
  const leafInsert = action.indexOf(".insert(leaves)");
  assert.ok(providerCreate >= 0, "provider Product create call must exist");
  assert.ok(leafInsert > providerCreate, "LEAF persistence must follow HubSpot success");
});

test("Library distinguishes loading from empty and keeps creation persistent", async () => {
  const source = await readFile(
    new URL("../../src/components/library/library-browse-modal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /catalogState[\s\S]*"loading"[\s\S]*"ready"[\s\S]*"error"/);
  assert.match(
    source,
    /catalogState === "loading"[\s\S]*Loading components[\s\S]*catalogState === "error"[\s\S]*libraryTotalActive === 0[\s\S]*Your library is empty/,
  );
  const header = source.slice(
    source.indexOf('<div className="head-actions">'),
    source.indexOf("</div>", source.indexOf('<div className="head-actions">')),
  );
  assert.match(header, /\+ Create new product/);
  assert.doesNotMatch(header, /catalogState|libraryTotalActive|rows\.length/);
});
