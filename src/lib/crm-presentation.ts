import type { HubSpotStage } from "@/lib/integrations/hubspot-provider";

export const UNKNOWN_HUBSPOT_STAGE_LABEL = "Unknown HubSpot stage";

export function presentHubspotStage(
  stored: string | null,
  stages: readonly HubSpotStage[],
): string | null {
  if (!stored) return null;
  const byId = stages.find((stage) => stage.id === stored);
  if (byId) return byId.label;
  const normalized = stored.trim().toLocaleLowerCase();
  const byLabel = stages.find(
    (stage) => stage.label.trim().toLocaleLowerCase() === normalized,
  );
  return byLabel?.label ?? UNKNOWN_HUBSPOT_STAGE_LABEL;
}
