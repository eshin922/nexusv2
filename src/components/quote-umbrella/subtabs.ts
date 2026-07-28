// Slice 12 Step 1 — sub-tab definitions.
//
// Order is LOCKED per v3 brief §4.1 (Preview → Send → Client Review →
// Mark Accepted → Tier Selection). Sub-tab IDs are canonical from R8
// data.js (`window.NXR8.subtabs`); URL query param `?tab=<id>` uses
// these values verbatim.
//
// `state_req` — minimum quote.status for the tab to be reachable.
//   preview + send both need `draft`
//   review + accepted both need `sent`
//   tier needs `accepted`
// `kind` — visual treatment on the sub-tab strip:
//   transition — normal sub-tab (Preview, Send, Mark Accepted)
//   log        — Client Review (rounded-square numeral, dotted underline)
//   lock       — Tier Selection (the irreversible commit; heavy Advance)

export type SubTabId =
  | "preview"
  | "send"
  | "review"
  | "accepted"
  | "tier";

export type SubTabDef = {
  id: SubTabId;
  n: 1 | 2 | 3 | 4 | 5;
  label: string;
  state_req: "draft" | "sent" | "accepted";
  kind: "transition" | "log" | "lock";
};

export const SUBTABS: readonly SubTabDef[] = [
  { id: "preview",  n: 1, label: "Preview Quote",  state_req: "draft",    kind: "transition" },
  { id: "send",     n: 2, label: "Send to Client", state_req: "draft",    kind: "transition" },
  { id: "review",   n: 3, label: "Client Review",  state_req: "sent",     kind: "log" },
  { id: "accepted", n: 4, label: "Mark Accepted",  state_req: "sent",     kind: "transition" },
  { id: "tier",     n: 5, label: "Tier Selection", state_req: "accepted", kind: "lock" },
] as const;

export function isSubTabId(v: unknown): v is SubTabId {
  return (
    typeof v === "string" &&
    SUBTABS.some((t) => t.id === v)
  );
}

export function parseSubTabParam(raw: string | undefined): SubTabId {
  if (raw && isSubTabId(raw)) return raw;
  return "preview";
}

// Derives per-tab status from quote.status. Design canon (R8 designer
// notes §1):
//   locked   — quote.status = 'complete' (all tabs locked)
//   current  — this tab is the one the user is actively on
//   done     — passed AND still reachable (reversible model)
//   upcoming — not reachable yet (quote hasn't reached state_req)
//
// Step 1 note: `complete` enum value isn't in the DB yet (Step 2 adds
// it). Until then, `locked` never fires — quote.status can't be
// 'complete'. Renderer handles the missing state gracefully.
export type SubTabStatus = "current" | "done" | "upcoming" | "locked";

const STATE_ORDER = ["draft", "sent", "accepted"] as const;

function stateReached(
  quoteStatus: string,
  req: "draft" | "sent" | "accepted",
): boolean {
  const currentIdx = STATE_ORDER.indexOf(
    quoteStatus as (typeof STATE_ORDER)[number],
  );
  const reqIdx = STATE_ORDER.indexOf(req);
  if (currentIdx === -1 || reqIdx === -1) return false;
  return currentIdx >= reqIdx;
}

export function subTabStatus(
  tab: SubTabDef,
  activeId: SubTabId,
  quoteStatus: string,
): SubTabStatus {
  if (quoteStatus === "complete") return "locked";
  if (tab.id === activeId) return "current";
  // If the tab's state_req is at or below the quote's current state,
  // the user has "passed" it and can revisit (reversibility model).
  return stateReached(quoteStatus, tab.state_req) ? "done" : "upcoming";
}

export function subTabSubLabel(
  tab: SubTabDef,
  status: SubTabStatus,
): string {
  if (status === "locked") return "locked";
  if (status === "done") return "done · revisitable";
  if (status === "current") {
    return tab.kind === "lock"
      ? "the lock"
      : tab.kind === "log"
        ? "logging"
        : "in progress";
  }
  return "awaiting " + tab.state_req;
}
