// Slice RI.7 — audit-log read-view action renderers.
//
// Maps each `audit_log.action` to a renderer that produces the chip
// color + human-readable one-line summary. RI.7 adds five action types
// (per docs/ri7-state-machine.md §6.1):
//   - quote_sent
//   - customer_acceptance_recorded
//   - customer_acceptance_cleared
//   - user_phone_updated
//   - firm_settings_updated (extended diff_json shapes)
//
// Pre-RI.7 actions render via a generic fallback that surfaces the
// action key + diff_json summary. Future slices add their renderers
// here as new audit actions land.

export type ChipColor = "neutral" | "accent" | "good" | "warn" | "bad";

export type ActionRendering = {
  chip: { color: ChipColor; label: string };
  /** Short one-line summary rendered next to the entity label. */
  summary: string;
};

type DiffJson = Record<string, unknown>;

function fmtTier(diff: DiffJson): string {
  const tierId = diff["customer_accepted_tier_id"];
  if (typeof tierId === "string") return tierId.slice(0, 8);
  return "—";
}

function fmtPreparedBySource(source: unknown): string {
  if (source === "users.id") return "Nexus user";
  if (source === "hubspot_owner_id") return "HubSpot one-shot";
  return "unknown source";
}

function fmtMaybeNull(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export function renderAction(
  action: string,
  diffJson: DiffJson,
  entityLabel: string | null,
): ActionRendering {
  switch (action) {
    case "quote_sent": {
      const quoteNumber = fmtMaybeNull(diff(diffJson, "quoteNumber"));
      const validUntil = fmtMaybeNull(diff(diffJson, "validUntil"));
      const preparedBy = diff(diffJson, "preparedBy") as
        | { name?: string; derived_from?: string }
        | undefined;
      const repName = preparedBy?.name ?? "—";
      const source = fmtPreparedBySource(preparedBy?.derived_from);
      return {
        chip: { color: "accent", label: "SENT" },
        summary: `Quote sent · ${quoteNumber} · valid until ${validUntil} · prepared by ${repName} (${source})`,
      };
    }
    case "customer_acceptance_recorded": {
      const tier = fmtTier(diffJson);
      const emailRef = fmtMaybeNull(diff(diffJson, "email_ref"));
      return {
        chip: { color: "accent", label: "CUSTOMER ACCEPTED" },
        summary: `Customer accepted tier ${tier} · email ref: ${emailRef}`,
      };
    }
    case "customer_acceptance_cleared": {
      const from = fmtMaybeNull(diff(diffJson, "from"));
      return {
        chip: { color: "warn", label: "CLEARED" },
        summary: `Cleared customer acceptance · was tier ${from.slice(0, 8)}`,
      };
    }
    case "user_phone_updated": {
      const from = fmtMaybeNull(diff(diffJson, "from"));
      const to = fmtMaybeNull(diff(diffJson, "to"));
      return {
        chip: { color: "neutral", label: "USER" },
        summary: `User phone updated · ${from} → ${to}`,
      };
    }
    case "firm_settings_updated": {
      // Diff_json shape: { from: {...}, to: {...} }. Show which
      // columns changed (set comparison) for an at-a-glance read.
      const from = (diff(diffJson, "from") ?? {}) as DiffJson;
      const to = (diff(diffJson, "to") ?? {}) as DiffJson;
      const changedKeys = Object.keys(to).filter((k) => {
        if (k === "effectiveFrom") return false; // versioning, not a content edit
        return JSON.stringify(from[k]) !== JSON.stringify(to[k]);
      });
      const display =
        changedKeys.length === 0
          ? "no content changes (effective-from only)"
          : changedKeys.slice(0, 4).join(", ") +
            (changedKeys.length > 4 ? ` + ${changedKeys.length - 4} more` : "");
      return {
        chip: { color: "neutral", label: "FIRM SETTINGS" },
        summary: `Firm settings updated · ${display}`,
      };
    }
    case "global_price_adj_updated": {
      const src = fmtMaybeNull(diff(diffJson, "source"));
      const tag =
        src === "system_suggestion" ? " (from coaching banner)" : "";
      return {
        chip: { color: "neutral", label: "PRICE ADJ" },
        summary: `Global price adjustment updated${tag}`,
      };
    }
    case "cell_override_updated":
      return {
        chip: { color: "neutral", label: "OVERRIDE" },
        summary: "Per-cell sell-price override updated",
      };
    case "scenario_dropped":
      return {
        chip: { color: "warn", label: "DROPPED" },
        summary: `Scenario dropped · reason: ${fmtMaybeNull(diff(diffJson, "drop_reason"))}`,
      };
    case "create":
      return {
        chip: { color: "good", label: "CREATED" },
        summary: entityLabel ? `Created ${entityLabel}` : "Created",
      };
    case "update":
      return {
        chip: { color: "neutral", label: "UPDATED" },
        summary: entityLabel ? `Updated ${entityLabel}` : "Updated",
      };
    case "delete":
      return {
        chip: { color: "bad", label: "DELETED" },
        summary: entityLabel ? `Deleted ${entityLabel}` : "Deleted",
      };
    default:
      return {
        chip: { color: "neutral", label: action.toUpperCase() },
        summary: action,
      };
  }
}

function diff(d: DiffJson, key: string): unknown {
  return d[key];
}

// Chip color → tailwind-ish utility classes. Reuses the existing
// register from Project Detail (Round 4) status badges so the audit
// log's chip vocabulary stays visually consistent with surfaces PMs
// already recognize.
export function chipClass(color: ChipColor): string {
  switch (color) {
    case "accent":
      return "border-accent/40 bg-accent-soft text-accent-ink";
    case "good":
      return "border-good/40 bg-good-soft text-good";
    case "warn":
      return "border-warn/40 bg-warn-soft text-warn";
    case "bad":
      return "border-bad/40 bg-bad-soft text-bad";
    case "neutral":
    default:
      return "border-slate-300 bg-slate-50 text-slate-700";
  }
}
