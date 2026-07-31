export type SalesOwnerIdentity = {
  id: string | null;
  name: string | null;
};

export function presentSalesOwner(
  authoritativeHubspotOwnerId: string | null,
  cachedOwner: SalesOwnerIdentity | null,
  nexusUser: SalesOwnerIdentity | null,
): string | null {
  if (!authoritativeHubspotOwnerId) return null;
  if (
    cachedOwner?.id === authoritativeHubspotOwnerId &&
    cachedOwner.name?.trim()
  ) {
    return cachedOwner.name.trim();
  }
  if (
    nexusUser?.id === authoritativeHubspotOwnerId &&
    nexusUser.name?.trim()
  ) {
    return nexusUser.name.trim();
  }
  return null;
}
