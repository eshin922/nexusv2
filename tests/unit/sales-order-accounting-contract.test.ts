import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSalesOrderPayload,
  computeIdempotencyKey,
  type SalesOrderPayloadInput,
} from "../../src/lib/netsuite/sales-orders.ts";
import { codeOnly } from "../support/code-only.ts";

const fullInput: SalesOrderPayloadInput = {
  netsuiteCustomerId: "customer-101",
  subsidiaryId: "subsidiary-2",
  orderStatusCode: "B",
  paymentTermsText: "  50% deposit, balance on shipment  ",
  hubspotDealId: "deal-40412634025",
  hubspotDealName: "Accounting Contract",
  dealFolderUrl: "https://example.invalid/accounting",
  projectServiceS: "Co-Packing",
  projectCategory: "Packaging",
  projectSourceId: "source-3",
  businessSegmentId: "segment-4",
  businessSegmentLabel: "Personal Care",
  clientPo: "PO-9001",
  invoiceDateEst: "2026-09-15",
  productionShipDateEst: "2026-10-01",
  priority: "HIGH",
  dealType: "newbusiness",
  projectManagerNsId: "employee-88",
  lines: [
    {
      netsuiteItemId: "item-123",
      sku: "SKU-EXACT-123",
      description: "Exact resolved leaf",
      quantity: 250,
      rate: 1.23456,
      unitCost: 0.98765,
    },
  ],
};

const prohibitedFields = [
  "terms",
  "custbody_nexus_quote_id",
  "custbody_dps_auto_generate_project",
  "custbody_report_timestamp",
  "custbody_dps_related_opportunity",
  "custbody_stc_amount_after_discount",
  "custbody_stc_tax_after_discount",
  "custbody_stc_total_after_discount",
  "custcol_2663_isperson",
  "custcol_p2p_ln_allow_po",
  "custcol_statistical_value_base_curr",
  "opportunity",
  "previousOpportunity",
  "job",
  "createdFrom",
] as const;

function own(record: unknown, key: string): boolean {
  return (
    typeof record === "object" &&
    record !== null &&
    Object.prototype.hasOwnProperty.call(record, key)
  );
}

test("maps the verified required and optional Sales Order accounting fields", () => {
  const payload = buildSalesOrderPayload(fullInput);

  assert.deepEqual(payload, {
    entity: { id: "customer-101" },
    subsidiary: { id: "subsidiary-2" },
    orderStatus: "B",
    memo: "HubSpot Deal deal-40412634025 · Accounting Contract",
    custbody_dps_deal_id: "deal-40412634025",
    custbody_dps_payment_terms_text: "50% deposit, balance on shipment",
    custbody_dps_accounting_files: "https://example.invalid/accounting",
    custbody_sharepoint_link: "https://example.invalid/accounting",
    custbody_dps_project_service_s: "Co-Packing",
    custbody_dps_project_category: "Packaging",
    custbody_dps_project_source: { id: "source-3" },
    // C.3 (2026-08-11): the customer PO now also reaches the standard field
    // Accounting named. Both are asserted here so the exhaustive payload
    // contract stays exhaustive; the projection itself is proven in
    // tests/unit/c3-customer-po-projection.test.ts.
    otherRefNum: "PO-9001",
    custbody_dps_client_po: "PO-9001",
    custbody_dps_est_invoice_date: "2026-09-15",
    custbody_dps_pp_production_ship_date: "2026-10-01",
    shipDate: "2026-10-01",
    custbody_dps_priority: "HIGH",
    custbody_dps_deal_type: "newbusiness",
    custbody_project_manager: { id: "employee-88" },
    // V1 Class contract (2026-08-12): `class` is NOT emitted. NetSuite owns
    // line Class through the Item record; Nexus sending it installed a
    // competing authority that was either rejected or silently wrong. Removed
    // from this exhaustive expectation rather than the expectation loosened,
    // so a reintroduction fails here too.
    // Evidence: tests/unit/netsuite-class-item-authority.test.ts
    cseg_dps_bus_seg: { id: "segment-4" },
    item: {
      items: [
        {
          item: { id: "item-123" },
          quantity: 250,
          rate: 1.2346,
          description: "Exact resolved leaf",
          taxCode: { id: "-8" },
          custcol_dps_sku: "SKU-EXACT-123",
          custcol_dps_unit_cost: 0.9877,
          // Governed product cost reaches NetSuite's STANDARD cost basis, not
          // only the custom column. The custom column is retained alongside —
          // added, never substituted — because it has carried this value since
          // Slice 12 and may feed reporting not visible from this side.
          // `costEstimate` is deliberately absent: NetSuite derives it as
          // quantity × rate, and sending it would create a second authority for
          // the same number.
          costEstimateType: { id: "CUSTOM" },
          costEstimateRate: 0.9877,
        },
      ],
    },
  });
});

test("omits optional, standard-terms, historical, derived, and unknown fields", () => {
  const payload = buildSalesOrderPayload({
    ...fullInput,
    paymentTermsText: "   ",
    dealFolderUrl: null,
    projectServiceS: null,
    projectCategory: null,
    projectSourceId: null,
    businessSegmentId: null,
    businessSegmentLabel: null,
    clientPo: null,
    invoiceDateEst: null,
    productionShipDateEst: null,
    priority: null,
    dealType: null,
    projectManagerNsId: null,
    lines: [{ ...fullInput.lines[0], unitCost: null }],
  });
  const line = (payload.item as { items: Array<Record<string, unknown>> }).items[0];

  for (const field of prohibitedFields) {
    assert.equal(own(payload, field), false, `header must omit ${field}`);
    assert.equal(own(line, field), false, `line must omit ${field}`);
  }
  assert.equal(own(payload, "custbody_dps_payment_terms_text"), false);
  assert.equal(own(payload, "custbody_project_manager"), false);
  // taxCode is NOT optional any more, so it does not belong in this test's
  // omission set — it is asserted PRESENT here on purpose. Every Nexus Sales
  // Order is non-taxable by governed rule, and this case (every optional field
  // stripped) is precisely where a conditional emitter would drop it.
  assert.deepEqual(line.taxCode, { id: "-8" });
  assert.equal(own(line, "custcol_dps_unit_cost"), false);
  // A null governed cost must leave NetSuite's own default intact rather than
  // assert a zero. A zero claims the product is free; silence claims nothing.
  assert.equal(own(line, "costEstimateType"), false);
  assert.equal(own(line, "costEstimateRate"), false);
  assert.equal(own(line, "amount"), false);
});

test("missing projectManagerNsId is omitted without identifier inference", () => {
  const { projectManagerNsId: _omitted, ...withoutProjectManager } = fullInput;
  const payload = buildSalesOrderPayload(withoutProjectManager);
  assert.equal(own(payload, "custbody_project_manager"), false);
});

test("flat leaf lines preserve resolved item IDs and derive amount from quantity times rate", () => {
  const payload = buildSalesOrderPayload(fullInput);
  const lines = (payload.item as { items: Array<Record<string, unknown>> }).items;

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].item, { id: "item-123" });
  assert.equal(lines[0].custcol_dps_sku, "SKU-EXACT-123");
  assert.equal(lines[0].quantity, 250);
  assert.equal(lines[0].rate, 1.2346);
  assert.equal(own(lines[0], "amount"), false);
  assert.equal(
    Number(lines[0].quantity) * Number(lines[0].rate),
    308.65,
  );
});

test("idempotency key is stable for one accepted sent snapshot", () => {
  const key = computeIdempotencyKey("quote-1", "snapshot-1");

  assert.match(key, /^nxs-so-[0-9a-f]{40}$/);
  assert.equal(computeIdempotencyKey("quote-1", "snapshot-1"), key);
  assert.notEqual(computeIdempotencyKey("quote-2", "snapshot-1"), key);
  assert.notEqual(computeIdempotencyKey("quote-1", "snapshot-2"), key);
});

test("completion structurally resolves exact SKUs, computes quantities, and checks prior success before create", () => {
  const source = readFileSync(
    "src/lib/netsuite/mark-complete.ts",
    "utf8",
  );
  const schema = readFileSync("src/db/schema.ts", "utf8");

  // SKU resolution is still exact-match through the real resolver.
  assert.match(source, /resolutionResults\.push\(await netsuite\.resolveItem\(sku\)\)/);
  // …and its results are still what the product item id comes from. The
  // `nsIdBySku` map this used to assert on is gone: product lines now take
  // their item from `buildFrozenSalesOrder`, which resolves each frozen SKU
  // through `resolveSku` — the SAME results, memoised. Two maps would be two
  // answers to "which item is this line".
  assert.match(source, /const resolveSkuMemo = new Map<string, ResolveResult>\(\)/);
  assert.match(source, /for \(const r of resolutionResults\) resolveSkuMemo\.set\(r\.sku, r\)/);
  assert.match(source, /buildFrozenSalesOrder\(quoteId, \{ resolveSku \}\)/);
  assert.doesNotMatch(codeOnly(source), /nsIdBySku/);

  // The Item Group DEFINITION multiplier is still read from the math layer.
  // It is STRUCTURE — how many of a leaf one group contains — and structure is
  // the one thing the live tree is still permitted to say.
  assert.match(
    source,
    /qtyPerParent: Math\.max\(1, Math\.round\(leafRollup\.qtyPerParent \?\? 1\)\)/,
  );

  // ── F1/F4 · quantity and rate are FROZEN, not computed here ─────────────
  //
  // This block used to assert the opposite: `effectiveQty = (tierRow.qty ?? 0)
  // × qtyPerParent` and `rate = perTierRollup.requiredSellPerUnit`, both
  // recomputed from live costing at push time. That reproduced the accepted
  // quote only for as long as draft-lock happened to hold every input still —
  // a convention, not an authority.
  //
  // Both directions are asserted. The positive alone would pass while a stray
  // live derivation survived somewhere else in the builder.
  assert.match(source, /quantity: frozenLine\.quantity/);
  assert.match(source, /const lineRate = Number\(frozenLine\.rate\)/);
  assert.match(source, /netsuiteItemId: frozenLine\.netsuiteItemId/);
  assert.doesNotMatch(codeOnly(source), /const effectiveQty/);
  assert.doesNotMatch(codeOnly(source), /requiredSellPerUnit/);
  // The live effective-quantity multiply, in ANY spelling — not just the
  // `const effectiveQty` binding it used to live in.
  //
  // Found by falsification: replacing the PRODUCT line's `quantity:
  // frozenLine.quantity` with `(tierRow.qty ?? 0) * live.qtyPerParent` left the
  // suite fully green, because the positive assertion above was still satisfied
  // by the ACCOUNTING line's identical text. A check that passes while the
  // thing it names is broken measures nothing. `tierRow.qty` itself survives —
  // the structure guard is handed it as `tierQty`, unmultiplied — so the
  // forbidden token is the multiplication.
  assert.doesNotMatch(codeOnly(source), /\(tierRow\.qty \?\? 0\) \*/);
  assert.match(source, /tierQty: tierRow\.qty \?\? 0/);
  // Narrow on purpose. `tierRollup.totalRevenue` survives ONE legitimate use —
  // `fingerprintCommercialState`, which pins the state a below-floor
  // authorization was granted against. That is a margin-guard input, not a
  // figure on the Sales Order. What must never come back is the old order
  // amount, so the forbidden token is that expression rather than the field.
  assert.doesNotMatch(
    codeOnly(source),
    /Number\(tierRollup\.totalRevenue\.toFixed\(2\)\)/,
  );
  assert.match(source, /fingerprintCommercialState\(\{/);

  // The order amount is the frozen accepted total, converted through integer
  // cents rather than divided out of a float.
  assert.match(
    source,
    /currentAmount = Number\(decimalFromCents\(frozenOrder\.totalCents\)\)/,
  );

  // Every refusal that must precede the POST is wired, in order.
  assert.match(source, /checkStructureAgreement\(\{/);
  assert.match(source, /checkPostGroupingReg4\(\{/);
  assert.ok(
    source.indexOf("checkPostGroupingReg4({") <
      source.indexOf("await netsuite.createSalesOrder("),
    "post-grouping REG-4 must run BEFORE the CREATE, not after it",
  );
  // Provenance is written after the order exists, never before.
  assert.ok(
    source.indexOf("recordPostingProvenance(") >
      source.indexOf("await netsuite.createSalesOrder("),
    "posting provenance must be recorded AFTER the CREATE",
  );

  // Step 2 extracted the payload input into `soPayloadInput` so the
  // turnkey_only branch can rebuild the SAME header with group lines swapped
  // in. What this assertion guards is unchanged: the completion input carries
  // the send-time terms snapshot and does NOT carry a project-manager id.
  const payloadBuild = source.indexOf("const soPayloadInput = {");
  const payloadBuildEnd = source.indexOf("\n    };", payloadBuild);
  assert.ok(payloadBuild >= 0);
  assert.ok(payloadBuildEnd > payloadBuild);
  const completionInput = source.slice(payloadBuild, payloadBuildEnd);
  assert.match(
    completionInput,
    /paymentTermsText: quote\.paymentTermsSnapshot/,
  );
  assert.doesNotMatch(completionInput, /projectManagerNsId/);

  const priorLookup = source.indexOf("const [priorSuccess]");
  const convergenceBranch = source.indexOf("if (priorSuccess)", priorLookup);
  const freshCreateBranch = source.indexOf("} else {", convergenceBranch);
  const createCall = source.indexOf("await netsuite.createSalesOrder(", convergenceBranch);
  assert.ok(priorLookup >= 0);
  assert.ok(convergenceBranch > priorLookup);
  assert.ok(freshCreateBranch > convergenceBranch);
  assert.ok(createCall > freshCreateBranch);
  assert.equal(source.indexOf("await netsuite.createSalesOrder("), createCall);
  assert.match(
    source.slice(convergenceBranch, createCall),
    /retryOutcome = "converged_from_prior_success"/,
  );
  // Track B §4 amended this from `createSalesOrder(payload, ...)`. What the
  // assertion guards is unchanged: the transmitted body derives from the
  // DURABLE payload rather than a rebuild, and carries the idempotency key.
  // The only permitted wrapper is `stripGroupingPlan`, which removes the
  // reserved plan envelope so the frozen snapshot can carry the grouping plan
  // without transmitting it. Naming the wrapper explicitly — rather than
  // relaxing to `.*` — keeps a future rebuild-at-send-time from slipping past.
  assert.match(
    source.slice(createCall, createCall + 200),
    /await netsuite\.createSalesOrder\(\s*stripGroupingPlan\(payload\),\s*\{\s*idempotencyKey,?\s*\}/,
  );
  assert.match(
    schema,
    /uniqueIndex\("netsuite_so_pushes_success_unique_idx"\)[\s\S]*?\.where\(sql`status = 'succeeded'`\)/,
  );
  assert.match(source, /acceptedSnapshotRows\.length !== 1/);
  assert.match(source, /computeIdempotencyKey\(quoteId, acceptedSnapshotId\)/);
  assert.match(source, /durableAttempt\?\.payloadSnapshot \?\? builtPayloadWithPlan/);
  assert.match(source, /Could not establish the durable Sales Order send identity before NetSuite execution/);
  assert.match(schema, /quoteSnapshotId: uuid\("quote_snapshot_id"\)/);
  assert.match(
    schema,
    /netsuite_so_pushes_snapshot_success_unique_idx[\s\S]*?quote_snapshot_id IS NOT NULL/,
  );
  assert.match(schema, /netsuite_so_pushes_snapshot_attempt_unique_idx/);
});
