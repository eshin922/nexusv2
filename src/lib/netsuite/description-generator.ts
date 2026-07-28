// Pure function tree — no server-only import. See composition-hash.ts
// for the rationale + boundary discipline.

// Slice 12 Step 8c-1 — Item Group description generator.
//
// Per CA Q3 disposition + Aisha's "she can manually overwrite it"
// answer (2026-07-28): the description is WRITE-ONCE, NEVER RECONCILED.
// Nexus generates it exactly once at group creation. On reuse (cache
// hit OR SuiteQL by-externalId re-find), Nexus does NOT re-generate
// and does NOT write back to NetSuite. If a description looks wrong to
// Nexus on a later push, that's a human edit and it wins.
//
// Format (two lines, joined with '\n'):
//
//   <customer_display> · <deal_name> · <base_sku> · Deal <hubspot_deal_id>
//   Components: <qty>× <sku> (<name>) + <qty>× <sku> (<name>) + …
//
// The deal id names the deal that CAUSED the group's creation, which
// is honest and traceable. Groups reused on later orders for the same
// customer keep pointing at the original deal — that's the intended
// behavior. Refreshing the description would mutate NetSuite master
// data which contradicts the immutable-cache posture.
//
// Aisha can manually overwrite the description in NetSuite when she
// wants to. Nexus must never overwrite her edits — even on a cache
// miss where we re-find the group via externalId. The find path writes
// to the local cache only.

export interface DescriptionInput {
  customerDisplay: string;      // e.g. "Epicuren"
  dealName: string;              // e.g. "Pro Masks"
  baseSku: string;
  hubspotDealId: string;
  members: Array<{
    sku: string;
    name: string;
    quantity: number;
  }>;
}

/**
 * Build the two-line description. Empty/whitespace-only fields fail
 * loud — the description carries provenance and every field is
 * load-bearing.
 */
export function generateGroupDescription(input: DescriptionInput): string {
  requireNonEmpty("customerDisplay", input.customerDisplay);
  requireNonEmpty("dealName", input.dealName);
  requireNonEmpty("baseSku", input.baseSku);
  requireNonEmpty("hubspotDealId", input.hubspotDealId);
  if (!input.members?.length)
    throw new Error("[description-generator] members must be non-empty");

  const header = [
    input.customerDisplay.trim(),
    input.dealName.trim(),
    input.baseSku.trim(),
    `Deal ${input.hubspotDealId.trim()}`,
  ].join(" · ");

  const componentSummary = input.members
    .map((m) => {
      const sku = String(m.sku).trim();
      const name = String(m.name).trim();
      if (!sku)
        throw new Error("[description-generator] member.sku is required");
      if (
        !Number.isFinite(m.quantity) ||
        m.quantity <= 0 ||
        !Number.isInteger(m.quantity)
      )
        throw new Error(
          `[description-generator] member.quantity must be a positive integer (got ${m.quantity} for ${sku})`,
        );
      // If name is missing, just render the SKU without parentheses so
      // the line stays readable. Prefer callers pass name whenever
      // available.
      return name ? `${m.quantity}× ${sku} (${name})` : `${m.quantity}× ${sku}`;
    })
    .join(" + ");

  return `${header}\nComponents: ${componentSummary}`;
}

function requireNonEmpty(field: string, value: string): void {
  if (!value || !value.trim())
    throw new Error(`[description-generator] ${field} is required`);
}
