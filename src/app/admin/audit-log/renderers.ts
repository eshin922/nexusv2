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
    case "freight_markup_updated": {
      // Slice RI.8 freight-markup feature — line-level override audit.
      // from/to are decimal strings ("0.3000"); render as percent
      // display for human scan.
      const fromVal = diff(diffJson, "from");
      const toVal = diff(diffJson, "to");
      const fmtPct = (v: unknown): string => {
        if (v === null || v === undefined) return "—";
        const n = Number(v) * 100;
        return Number.isFinite(n) ? `${Number(n.toFixed(2))}%` : String(v);
      };
      return {
        chip: { color: "neutral", label: "FREIGHT MARKUP" },
        summary: `Freight markup · ${fmtPct(fromVal)} → ${fmtPct(toVal)}`,
      };
    }
    // Cost-input CRUD actions use past-tense keys throughout the
    // action layer (`created` / `updated` / `deleted` — see
    // src/app/actions/{freight,packaging,production}.ts). Smoke
    // against real audit_log entries during RI.7 caught the
    // original renderer's present-tense `create`/`update`/`delete`
    // mismatch — keys never matched, fell through to generic
    // fallback. Both forms accepted now for forward/backward compat.
    case "create":
    case "created":
      return {
        chip: { color: "good", label: "CREATED" },
        summary: entityLabel ? `Created ${entityLabel}` : "Created",
      };
    case "update":
    case "updated":
      return {
        chip: { color: "neutral", label: "UPDATED" },
        summary: entityLabel ? `Updated ${entityLabel}` : "Updated",
      };
    case "delete":
    case "deleted":
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

// Slice RI.8 step 5 — R5 action-chip color name (`.r5-al-row .action`
// has variants .good / .accent / .warn / .bad — see r5-admin.css).
// Translates the renderer's ChipColor into the R5 class suffix.
// Neutral falls through to the default pill style on the .action
// base class.
export function r5ActionClass(color: ChipColor): string {
  switch (color) {
    case "accent":
      return "accent";
    case "good":
      return "good";
    case "warn":
      return "warn";
    case "bad":
      return "bad";
    case "neutral":
    default:
      return "";
  }
}

// Extract 1-2 letter initials from a display name or email. Used for
// the R5 audit-log avatar circle. Falls back to "—" if neither is
// available.
export function initialsFor(
  name: string | null,
  email: string | null,
): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return parts[0][0]?.toUpperCase() ?? "—";
  }
  if (email) {
    const local = email.split("@")[0];
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    return local[0]?.toUpperCase() ?? "—";
  }
  return "—";
}

// Day-group label for R5 feed separators. Maps a Date to a header
// like "TODAY · MAY 12", "YESTERDAY · MAY 11", "MAY 10".
export function dayGroupLabel(d: Date, now: Date = new Date()): string {
  const dStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const nowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round(
    (nowStart.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24),
  );
  const monthDay = d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (diffDays === 0) return `Today · ${monthDay}`;
  if (diffDays === 1) return `Yesterday · ${monthDay}`;
  if (diffDays < 7) return `${diffDays} days ago · ${monthDay}`;
  return monthDay;
}

// Compact "5h ago" / "2d ago" / "Apr 30" timestamp for the row left
// column. Same vocabulary as the R5 source's e.ts values.
export function compactRelativeTime(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD === 1) return "yesterday";
  if (diffD < 7) return `${diffD}d ago`;
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}
