/**
 * Stage 1 — Product Library Direct Service identity + attachment prohibition.
 *
 * BV-012 §5.c makes "a service entry is not an Item Group member" an
 * ATTACHMENT BOUNDARY rather than UI copy, and §5.f keeps the service
 * vocabulary closed. Both are asserted here against the code that enforces
 * them, not against the documents that state them.
 *
 * ── WHY THE GATE, AND NOT A NEW CHECK ─────────────────────────────────────
 *
 * `evaluateAttachmentEligibility` already carried a note explaining itself:
 * *"Same predicate the grouped path uses. One gate, so the two attachment
 * routes cannot diverge on what is attachable."* Adding a second check beside
 * it would have created exactly the divergence that note exists to prevent, so
 * the prohibition went inside it.
 *
 * The `destination` parameter is REQUIRED rather than optional-with-a-default.
 * The prohibition is destination-specific — the same entry is refused as a
 * member and welcome at top level — so a caller that omitted it would silently
 * take the permissive branch, which is the failure being prevented. Making it
 * required turned every call site into a compiler error that had to be answered
 * deliberately.
 *
 * ── WHY A NEW COLUMN, GIVEN STEP 9 ────────────────────────────────────────
 *
 * Step 9 removed `leaves.product_type_id` to end "two authorities for one
 * question". This is a different question — `hubspot_product_type` describes
 * what a thing physically IS and derives spec behaviour; `commercial_kind`
 * states what Nexus may SELL it as. The distinction is load-bearing and is
 * asserted below, because the cheapest future mistake is deriving one from the
 * other.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  evaluateAttachmentEligibility,
} from "../../src/lib/product-structure/attachment-eligibility.ts";
import {
  DIRECT_SERVICE_IDENTITIES,
  DIRECT_SERVICE_LABELS,
  directServiceLabel,
} from "../../src/lib/product-structure/direct-service.ts";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
async function code(rel: string): Promise<string> {
  const raw = await readFile(SRC + rel, "utf8");
  return raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const service = { sku: "SVC-1", archived: false, commercialKind: "service" as const };
const product = { sku: "PKG-1", archived: false, commercialKind: "product" as const };

// ── the attachment boundary ───────────────────────────────────────────────

test("a service is refused as an Item Group member, with the true reason", () => {
  const v = evaluateAttachmentEligibility(service, "group_member");
  assert.equal(v.attachable, false);
  assert.equal(v.attachable === false ? v.reason : null, "service_not_a_member");
  // Truthful and actionable — it says where the cost belongs instead.
  assert.match(
    v.attachable === false ? v.message : "",
    /item group already owns its production costs/i,
  );
});

test("the same service is attachable at top level", () => {
  // The prohibition is about MEMBERSHIP, not about the entry. A rule that
  // refused it everywhere would forbid the case this whole slice enables.
  assert.deepEqual(evaluateAttachmentEligibility(service, "direct"), {
    attachable: true,
  });
});

test("a packaging product is unaffected in both destinations", () => {
  assert.deepEqual(evaluateAttachmentEligibility(product, "direct"), {
    attachable: true,
  });
  assert.deepEqual(evaluateAttachmentEligibility(product, "group_member"), {
    attachable: true,
  });
});

test("an unclassified entry behaves exactly as before", () => {
  // Every pre-existing row and every existing caller. `commercial_kind`
  // defaults to `product` in the column, and absence means the same here — so
  // the migration changed no meaning.
  for (const dest of ["direct", "group_member"] as const) {
    assert.deepEqual(
      evaluateAttachmentEligibility({ sku: "OLD-1", archived: false }, dest),
      { attachable: true },
    );
  }
});

test("the pre-existing refusals still fire, and still take precedence", () => {
  // A service with no SKU is refused for the SKU, not the service: the missing
  // SKU is the more fundamental defect and the one the operator must fix first.
  const noSku = evaluateAttachmentEligibility(
    { sku: null, archived: false, commercialKind: "service" },
    "group_member",
  );
  assert.equal(noSku.attachable === false ? noSku.reason : null, "missing_sku");

  const archived = evaluateAttachmentEligibility(
    { sku: "SVC-1", archived: true, commercialKind: "service" },
    "group_member",
  );
  assert.equal(archived.attachable === false ? archived.reason : null, "archived");
});

// ── enforced at the write boundary, not in the UI ─────────────────────────

test("both attachment routes pass their destination to the one gate", async () => {
  const direct = await code("app/actions/quote-products.ts");
  assert.match(direct, /evaluateAttachmentEligibility\(leafRows\[0\], "direct"\)/);

  const grouped = await code("app/actions/assemblies.ts");
  assert.match(
    grouped,
    /evaluateAttachmentEligibility\([\s\S]{0,80}?"group_member",?\s*\)/,
  );
});

test("the destination parameter is required, so no call site can default in", async () => {
  const gate = await code("lib/product-structure/attachment-eligibility.ts");
  // Not `destination?:` and not `= "direct"`.
  assert.match(gate, /destination: AttachmentDestination,/);
  assert.doesNotMatch(gate, /destination\?:/);
  assert.doesNotMatch(gate, /destination: AttachmentDestination = /);
});

test("the library surface renders the gate's verdicts, never its own", async () => {
  // The modal's destination changes client-side, so one precomputed verdict
  // would go stale — but re-deriving the rule in the component would put a
  // governed prohibition in a second place. Both verdicts come from the gate.
  const loader = await code("lib/library-browse-loader.ts");
  assert.match(loader, /eligibility: evaluateAttachmentEligibility\(/);
  assert.match(loader, /eligibilityAsGroupMember: evaluateAttachmentEligibility\(/);

  const modal = await code("components/library/library-browse-modal.tsx");
  assert.doesNotMatch(
    modal,
    /commercialKind === "service"[\s\S]{0,200}?attachable/,
    "the modal re-derives the attachment rule",
  );
});

// ── the closed vocabulary ─────────────────────────────────────────────────

test("exactly the five governed identities, and no BV-011 destination", () => {
  assert.deepEqual([...DIRECT_SERVICE_IDENTITIES], [
    "formulation",
    "filling_blending",
    "packout_assembly",
    "testing_micros",
    "other_service",
  ]);
  // The ones deliberately NOT sellable on their own (BV-012 §5.f). Bulk Raw is
  // the tempting one and the one named in the disposition.
  for (const excluded of [
    "bulk_raw",
    "setup",
    "tooling",
    "artwork",
    "dies",
    "print_plates",
    "samples",
    "processing_fee",
    "freight",
    "customs",
    "cartons",
  ]) {
    assert.ok(
      !(DIRECT_SERVICE_IDENTITIES as readonly string[]).includes(excluded),
      `${excluded} was promoted to a Direct Service without a disposition`,
    );
  }
});

test("every identity has a label, and the stored value is never the label", () => {
  for (const id of DIRECT_SERVICE_IDENTITIES) {
    assert.ok(DIRECT_SERVICE_LABELS[id], `${id} has no label`);
    assert.notEqual(DIRECT_SERVICE_LABELS[id], id);
  }
  assert.equal(directServiceLabel("filling_blending"), "Filling / Blending");
  assert.equal(directServiceLabel(null), null);
});

test("the create action validates the vocabulary and refuses a nameless service", async () => {
  const src = await code("app/actions/leaves.ts");
  // A service must say WHICH service — refused in the action so the operator
  // gets a sentence, not a 500 naming a database constraint.
  assert.match(src, /commercialKind === "service" && serviceIdentityCandidate === null/);
  assert.match(src, /DIRECT_SERVICE_IDENTITIES/);
  // Narrowed by predicate, not cast — a cast would let a future edit widen the
  // accepted set without the compiler noticing.
  assert.match(src, /v is DirectServiceIdentity/);
  assert.doesNotMatch(src, /as DirectServiceIdentity\b/);
});

// ── the two classifications stay two questions ────────────────────────────

test("commercial kind is not derived from anything it was forbidden to be derived from", async () => {
  // BV-012 §5.f: not from product_types.scope, the legacy `Service / labor`
  // type, HubSpot's product type, presence of Production values, or attachment
  // position. Step 9's "two authorities for one question" stays answered.
  for (const rel of [
    "lib/product-structure/attachment-eligibility.ts",
    "lib/product-structure/direct-service.ts",
  ]) {
    const src = await code(rel);
    assert.doesNotMatch(src, /hubspotProductType/, `${rel} derives from HubSpot`);
    assert.doesNotMatch(src, /Service \/ labor/, `${rel} derives from the legacy type`);
    assert.doesNotMatch(src, /productTypeScope|product_type_scope/, `${rel} derives from scope`);
  }
  const action = await code("app/actions/leaves.ts");
  assert.match(
    action,
    /formData\.get\("commercialKind"\)/,
    "the classification must be stated, never inferred",
  );
});

// ── the create affordance ─────────────────────────────────────────────────

test("the operator chooses the kind; it is never inferred", async () => {
  const modal = await code("components/add-product/add-product-modal.tsx");
  assert.match(modal, /fd\.set\("commercialKind", commercialKind\)/);
  assert.match(modal, /DIRECT_SERVICE_IDENTITIES\.map/);
  // The five governed labels come from the shared module, not retyped here —
  // a second list is a second vocabulary waiting to drift from the enum.
  assert.match(modal, /DIRECT_SERVICE_LABELS\[id\]/);
});

test("a service sends no HubSpot type, and a product is unchanged", async () => {
  const modal = await code("components/add-product/add-product-modal.tsx");
  // Mutually exclusive at the submit, not merely hidden in the UI: a hidden
  // field still submits.
  assert.match(
    modal,
    /if \(commercialKind === "service"\) \{[\s\S]{0,120}?serviceIdentity[\s\S]{0,80}?\} else if \(hsTypeValue\)/,
  );
});

test("switching back to product clears the service identity", async () => {
  // Otherwise a stale identity sits in state and is submitted with a product,
  // which the action would reject — correctly, but for a reason the operator
  // could not see, having already switched the control back.
  const modal = await code("components/add-product/add-product-modal.tsx");
  assert.match(modal, /if \(next === "product"\) props\.onServiceIdentity\(""\)/);
});

test("a service creates no HubSpot product at all", async () => {
  // Not merely "omit the two classification fields" — a service's downstream
  // identity is a BV-011 accounting destination resolved at NetSuite
  // projection, and HubSpot is not in that path. Creating a catalog record for
  // it would put a row in a system with no question to answer about it.
  const action = await code("app/actions/leaves.ts");
  assert.match(action, /const isService = commercialKind === "service";/);
  assert.match(action, /if \(!isService\) \{[\s\S]{0,600}?hubspot\.createProduct/);
  assert.match(action, /hubspotProductType: isService \? null : hubspotProductType/);
  // And the local row is Nexus-local.
  assert.match(action, /let hubspotProductId: string \| null = null;/);
});
