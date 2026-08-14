/**
 * Is this Item Group SKU a generated placeholder rather than an operator's own?
 *
 * `createAssembly` fills an omitted SKU with `ASY-{quoteId first 8}-{position}`
 * (src/app/actions/assemblies.ts). That value is real, stored, and referenced by
 * certified NetSuite projection and audit evidence — it must never change. It is
 * simply not something to show an operator, who was told this concept is called
 * an Item Group and has never been shown the word ASY anywhere else.
 *
 * WHY THIS TAKES THE QUOTE ID rather than matching /^ASY-/. An operator is free
 * to type `ASY-7` as a genuine SKU, and suppressing it would hide data they
 * entered deliberately. Reconstructing the exact generated string is the only
 * test that cannot produce that false positive: it recognises the value the
 * system wrote, not a family of values that look like it.
 *
 * B-4 item 3. Display only — no writer, no migration, no change to identity.
 */
export function isGeneratedAssemblySku(
  sku: string | null | undefined,
  quoteId: string,
): boolean {
  if (!sku) return false;
  const prefix = `ASY-${quoteId.slice(0, 8)}-`;
  if (!sku.startsWith(prefix)) return false;
  // The suffix is the 1-based position at creation time. Anything else sharing
  // the prefix was authored, not generated.
  return /^\d+$/.test(sku.slice(prefix.length));
}

/**
 * What the Item Group row shows in its SKU cell.
 *
 * `null` means "show no identifier" — the caller renders the tree's existing
 * no-value convention (`—`, as leaf rows already use for a missing SKU) rather
 * than inventing a second one.
 */
export function assemblyDisplaySku(
  sku: string | null | undefined,
  quoteId: string,
): string | null {
  if (!sku) return null;
  return isGeneratedAssemblySku(sku, quoteId) ? null : sku;
}
