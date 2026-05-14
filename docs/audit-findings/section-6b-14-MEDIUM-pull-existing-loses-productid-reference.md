**Severity:** MEDIUM

**Dimension:** 11 — Add-product modal Pull-existing flow

**Issue:** When the SKU blur surfaces an existing HubSpot product and the user clicks "Pull existing":

```tsx
function handlePullExisting() {
  if (!existingMatch) return;
  setMode("attach_existing");
  setForm((f) => ({
    ...f,
    name: existingMatch.name,
    hs_sku: existingMatch.sku ?? "",
    description: existingMatch.description ?? "",
    hs_product_type: existingMatch.productType ?? "",
    price: existingMatch.price ?? "",
  }));
  setExistingMatch(null);  // ← clears the reference
}
```

The `existingMatch` (which contains `existingMatch.id`, the HubSpot productId) is cleared after the form is hydrated. On submit, the attach path re-resolves the productId by re-calling `checkProductSku(form.hs_sku)`:

```tsx
const lookup = await checkProductSku(form.hs_sku);
if (!lookup.ok || !lookup.data.found || !lookup.data.product) {
  setError("Couldn't re-find the existing product. Refresh and try again.");
  return;
}
const fd = new FormData();
fd.set("productId", lookup.data.product.id);
```

This works in the happy path BUT:
1. **Two API calls instead of one** — the productId is lost and re-resolved. Extra HubSpot API call for every attach submit.
2. **Edge case failure** — if the HubSpot product was DELETED between blur-check and submit (admin or another PM cleaned up), the re-resolve returns no match and the modal surfaces "Couldn't re-find the existing product." The original blur already had the canonical reference; losing it is unnecessary.
3. **Edit-the-SKU-then-submit-attach race** — if the user clicked "Pull existing" then edited the SKU field, the blur warning clears (mode stays `attach_existing`), submit re-resolves with the NEW SKU value. The user's intent ("attach the product I just confirmed") is lost; they may end up attaching a different product (if the new SKU also matches) or hitting the not-found error.

**Canonical reference:** `docs/product-modal-brief.md:62-72` — SKU blur behavior. Brief specifies the warning has two CTAs ("Pull existing", "Use different SKU") but doesn't dictate state-management for productId across mode transitions.

**Implementation reference:** `src/app/projects/[id]/quotes/[quoteId]/add-product-modal.tsx:162-176, 186-225`

**Fix proposal:** Preserve the productId across mode transitions. Add a `matchedProductId` state that's set by `handlePullExisting` and cleared on reset / "Use different SKU" / user-edits-SKU:

```tsx
const [matchedProductId, setMatchedProductId] = useState<string | null>(null);

function handlePullExisting() {
  if (!existingMatch) return;
  setMode("attach_existing");
  setMatchedProductId(existingMatch.id);  // ← preserve productId
  setForm((f) => ({
    ...f,
    name: existingMatch.name,
    hs_sku: existingMatch.sku ?? "",
    description: existingMatch.description ?? "",
    hs_product_type: existingMatch.productType ?? "",
    price: existingMatch.price ?? "",
  }));
  setExistingMatch(null);
}

function handleUseDifferentSku() {
  setExistingMatch(null);
  setMatchedProductId(null);            // ← clear
  setMode("create");                    // ← revert mode too
  update("hs_sku", "");
  document.getElementById("ap-hs-sku")?.focus();
}

// On SKU input change:
onChange={(e) => {
  update("hs_sku", e.target.value);
  if (existingMatch) setExistingMatch(null);
  // If user edits SKU after Pull-existing, clear the matched ref + revert mode
  if (mode === "attach_existing") {
    setMatchedProductId(null);
    setMode("create");
  }
}}

// In submit() attach_existing branch:
if (!matchedProductId) {
  setError("Lost the product reference. Re-enter the SKU.");
  return;
}
startTransition(async () => {
  const fd = new FormData();
  fd.set("quoteId", quoteId);
  fd.set("productId", matchedProductId);  // ← use preserved id
  fd.set("skuRole", "leaf");              // (per Finding 13)
  const result = await addSkuFromHubspotProduct(fd);
  …
});
```

Drop the re-resolve call entirely. Cleaner, faster, race-safe.

**Risk if shipped:** Edge case: HubSpot product deleted between blur and submit → unrecoverable error. Hairier edge case: user edits SKU after pull-existing → unintentional attach to different product. Both rare but real; HIGH-adjacent. Marked MEDIUM because the happy path works.
