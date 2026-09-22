/** Setup's HubSpot Product Type governs a packaging line's markup category. */
export function packagingMarkupCategory(
  hubspotProductType: string | null | undefined,
  storedCategory: string | null | undefined,
): string | null {
  return hubspotProductType?.trim() || storedCategory?.trim() || null;
}

/** A stored category-default amount is a cache for the editor, not an override. */
export function packagingLineOverride(
  markupPct: number | null | undefined,
  source: "category_default" | "manual_override" | null | undefined,
): number | null {
  return source === "category_default" ? null : markupPct ?? null;
}
