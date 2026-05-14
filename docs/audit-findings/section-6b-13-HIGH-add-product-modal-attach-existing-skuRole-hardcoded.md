**Severity:** HIGH

**Dimension:** 11 — Add-product modal (Phase 1) — attach-existing flow

**Issue:** The "Pull existing" path in the Add-product modal hardcodes `fd.set("skuRole", "leaf")` regardless of whether the matched HubSpot product is structurally a leaf or has children defined elsewhere. From `add-product-modal.tsx:211-222`:

```tsx
const fd = new FormData();
fd.set("quoteId", quoteId);
fd.set("productId", lookup.data.product.id);
fd.set("skuRole", "leaf");   // ← hardcoded
const result = await addSkuFromHubspotProduct(fd);
```

Per OQ2 disposition (Phase 1 prep): "drop Leaf / Assembly from the modal entirely; sku_role hardcoded leaf". That's correct for the CREATE path (a new product is always leaf at creation; assembly creation requires children, which don't exist yet at create-time). But the ATTACH-existing path is different — the user is attaching an existing HubSpot product to the quote. If that product is already classified `hs_product_classification: bundle` in HubSpot, attaching it as `leaf` in Nexus mis-represents the structure.

OQ2 banked exception for the future: "leaf → assembly promotion via row drawer probably writes `hs_product_classification: bundle` back to HubSpot for consistency. Explicit audit when that work lands." The inverse (HubSpot `bundle` attached as Nexus `leaf`) isn't covered.

In Phase 1 scope, v1 just adds the product as leaf; PMs can promote to assembly via the row drawer (Type badge click). So functionally it's not broken — just sub-optimal. The Phase 4 reconcile of scenario/assembly model is where this gets fully addressed.

**Audit dimension:** Phase 1 brief OQ2 was explicit about hardcoding leaf. So the implementation matches the brief. But the audit-flag asks: does the brief disposition itself have a gap? Yes — Phase 1 brief OQ2 was framed for CREATE, not ATTACH. ATTACH is the second mode added during implementation; it inherited the same hardcoded leaf disposition without explicit OQ2 sign-off.

**Canonical reference:** `docs/product-modal-brief.md:88-91` — OQ2 RESOLVED disposition: drop Leaf/Assembly from modal; sku_role hardcoded leaf. Does NOT explicitly cover the attach-existing case.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:213`

**Fix proposal:**

Option A (minimal — bank Pattern 22 instance #8, defer to Phase 4):

Add a code comment + audit log note acknowledging the leaf-hardcoded-on-attach as Phase-4-future-resolution:

```tsx
// OQ2 disposition (Phase 1 prep) hardcoded sku_role = leaf for CREATE.
// ATTACH-existing inherits the same hardcoding for v1 — even if the
// HubSpot product is classified as `bundle`, it lands in Nexus as
// leaf and PM promotes via row drawer's Type badge.
// Phase 4 audit dimension banked: read existingMatch.classification
// from HubSpot; pre-fill skuRole from it; promote_audit on toggle.
// For Phase 1: leaf is fine; assembly promotion is a row-drawer action.
fd.set("skuRole", "leaf");
```

Option B (full fix — Phase 1 scope creep, NOT recommended):

Extend `ProductSummary` type (`src/lib/hubspot.ts`) to include `classification`. Read it on `checkProductSku`. Set `fd.set("skuRole", existingMatch.classification === "bundle" ? "assembly" : "leaf")`. Add validation in `addSkuFromHubspotProduct` action.

Recommended: **Option A**. Phase 4 audit banks this as a known Phase 1 limitation; addresses it when reconciling scenario/assembly model.

**Risk if shipped:** A HubSpot product classified `bundle` attached to a quote shows as Nexus `leaf`. PM clicks Type badge to promote to assembly; works. Sub-optimal UX (extra click) but not broken. Audit-log records the promotion correctly.

**Why HIGH not MEDIUM:** Misclassification at attach-time is a data-quality issue if PMs forget to promote. A `bundle` HubSpot product treated as a leaf throughout a quote → cost build → mark-accepted flow could produce silently-wrong cost rollups (the assembly's children would be missing). Frontend-side issue, but writes downstream consequences. Documenting the limitation explicitly is the load-bearing mitigation.
