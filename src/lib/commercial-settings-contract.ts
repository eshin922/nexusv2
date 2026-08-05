export type CommercialSettingsValues = {
  targetMarginPct: number;
  floorMarginPct: number;
  freightMarkupPct: number;
  markupDefaults: Record<string, number>;
};

export type CommercialSettingsResolution = CommercialSettingsValues & {
  source: "live" | "pinned" | "legacy_live";
};

export function resolveCommercialSettingsForLifecycle(args: {
  status: "draft" | "sent" | "accepted" | "complete" | "superseded" | "lost";
  live: CommercialSettingsValues;
  pinned: CommercialSettingsValues | null;
}): CommercialSettingsResolution {
  if (args.status === "draft") return { ...args.live, source: "live" };
  if (args.pinned) return { ...args.pinned, source: "pinned" };
  return { ...args.live, source: "legacy_live" };
}
