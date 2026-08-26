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
  // Slice 12 Step 8a — R9.1 renames per docs/design-prototypes/dist/
  // round-9/app/r9/data.js. String changes only — sub-tab ids
  // (`accepted`, `tier`) stay stable so URL params (`?tab=accepted`)
  // don't break for bookmarks. Rationale (R9.1-2): "Mark Accepted"
  // and "Tier Selection" both named buttons/actions; the new labels
  // name the ARTIFACT, which stays true across all of a tab's states.
  { id: "accepted", n: 4, label: "Acceptance",     state_req: "sent",     kind: "transition" },
  { id: "tier",     n: 5, label: "Sales Order",    state_req: "accepted", kind: "lock" },
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
  hasSentHistory: boolean = false,
): SubTabStatus {
  if (quoteStatus === "complete") return "locked";
  if (tab.id === activeId) return "current";
  // Slice 12 Step 7c review-fix (CB P2) — the review (log) tab is
  // reachable AS LONG AS there is history to read, even when the
  // current status is `draft` (post-Revise state). The `sent`
  // state_req rules out fresh pre-send drafts (no feed yet) but
  // must NOT rule out a draft that has been sent before — that's
  // exactly the state where PMs need to consult prior review
  // context.
  if (tab.id === "review" && hasSentHistory) return "done";
  // If the tab's state_req is at or below the quote's current state,
  // the user has "passed" it and can revisit (reversibility model).
  return stateReached(quoteStatus, tab.state_req) ? "done" : "upcoming";
}

export function subTabSubLabel(
  tab: SubTabDef,
  status: SubTabStatus,
  /**
   * The lock tab must not claim a readiness the send cannot honour. Set when a
   * known identity refusal (product_sku_missing / product_item_unresolved) is
   * predicted, so the strip reads "blocked" instead of "ready to send".
   * Advisory — the send guard still decides.
   */
  lockBlocked = false,
): string {
  // Slice 12 Step 9 CD audit Item 3 — lock-kind tab's post-commit
  // sub-label reads "order placed" instead of the generic "locked".
  // Sibling tabs (Preview / Send / Client Review / Mark Accepted)
  // keep "locked" — Pattern 52 freeze applies uniformly to them but
  // "order placed" is what the SALES ORDER tab specifically records:
  // the SO landed in NetSuite and the umbrella flipped to complete.
  //
  // Interpretation note (2026-07-29): CA's directive said "on the
  // lock tab in done." Read literally, `done` means the tab is
  // reachable + the quote is accepted (SO NOT yet placed); "order
  // placed" would be false in that state. Applied to `locked`
  // (post-commit) instead — where it's semantically true. If CA
  // meant `done` literally, the fix moves one branch up.
  if (status === "locked") return tab.kind === "lock" ? "order placed" : "locked";
  // Slice 12 Step 8b · CB P4 fix — unify the lock tab's sub-label
  // across current + done to "ready to send". Prior state emitted
  // "ready to send" when active and "ready · irreversible" when
  // done — CB flagged the drift (Sales Order tab reads "READY TO
  // SEND" in its footer, "READY · IRREVERSIBLE" in the strip from
  // sibling tabs). Both states describe the same underlying
  // capability (accept has landed, send is unlocked); the strip
  // pill collapses to R9's canonical active label. The
  // irreversibility signal already lives in the lock threshold
  // glyph (armed/solid when accepted), the AdvanceBar caption, the
  // dark-slab CTA treatment, and the SendOrderModal's "Send order
  // · irreversible" head + "keep it reversible" cancel copy — the
  // strip pill doesn't need to duplicate it.
  if (status === "done") {
    if (tab.kind === "lock") return lockBlocked ? "blocked" : "ready to send";
    return "done · revisitable";
  }
  if (status === "current") {
    return tab.kind === "lock"
      ? lockBlocked
        ? "blocked"
        : "ready to send"
      : tab.kind === "log"
        ? "logging"
        : "in progress";
  }
  return "awaiting " + tab.state_req;
}
