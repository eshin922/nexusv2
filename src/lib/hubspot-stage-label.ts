import "server-only";

// Slice 12 Step 8a — resolve firm_settings.hubspot_deal_stage_on_accept
// to a human-readable label for the sub-tab 4 "Now · HubSpot" system
// card copy.
//
// firm_settings currently stores this as an internal id
// (e.g., '195607084') post the Slice 12 Step 7b fix-pass — labels are
// editable in HubSpot's UI, so the runtime key must be the stable
// internal id per CA review. Sub-tab 4's PM-facing copy still wants
// the label ("Won - In production"), not the numeric id.
//
// Cache alignment: uses the same `loadPipelineStages` cache
// (`_pipelineStagesCache` in src/lib/hubspot.ts) that markAccepted
// and getDealStage already warm at first use. On a warm cache this
// is a synchronous Map-lookup shape; on a cold cache it's a single
// HubSpot pipelines API call per Node instance lifetime.
//
// Degrades gracefully:
//   - Stored value is a label (not an id) → return as-is (no lookup)
//   - Stored value is an id + resolver matches → return the label
//   - Stored value is an id + resolver doesn't match → return the raw id
//   - firm_settings has no active row → return a generic phrase
//   - Pipeline API call fails → return the raw stored value or a
//     generic phrase, DO NOT block page render
//
// Display-only. Never used as a lookup key or a HubSpot write target.

import { getApplicationDependencies } from "@/lib/integrations/composition";

export async function resolveHubspotAcceptStageLabel(
  stored: string | null,
): Promise<string> {
  if (!stored) return "the accept stage";
  // Fast path: if the stored value doesn't look like an internal id
  // (numeric string), assume it's already a label and return verbatim.
  const looksLikeId = /^\d+$/.test(stored);
  if (!looksLikeId) return stored;
  try {
    const { hubspot } = await getApplicationDependencies();
    const stages = await hubspot.listDealStages();
    const match = stages.find((s) => s.id === stored);
    return match?.label ?? stored;
  } catch {
    // API failure — degrade to the raw id. Sub-tab 4's copy still
    // renders; it's less friendly but honest about state.
    return stored;
  }
}
