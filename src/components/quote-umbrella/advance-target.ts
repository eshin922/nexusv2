// Slice 12 Step 9 — shared advance-target helper.
//
// The umbrella has 5 sub-tabs (Preview, Send, Client Review, Mark
// Accepted, Sales Order). Each renders an AdvanceBar whose target
// depends on WHERE the quote is in its lifecycle — not on which
// tab is currently rendered.
//
// Pre-Step-9 history: each tab hardcoded its advance target. That
// worked while quote.status stayed in sync with the "current"
// lifecycle position — draft on Preview/Send, sent on Review, etc.
// It broke the moment a PM revisited an earlier tab on a
// later-lifecycle quote: Client Review on an accepted quote still
// pointed at "Mark Accepted →" (P6). CB round 1 fixed the same
// defect on Send-to-Client but by branching in-file rather than
// centralizing — Client Review + others carried the pattern.
//
// This helper computes the "next lifecycle target" from
// quoteStatus alone. Every tab consumes it; hardcoded advance
// targets stop existing.
//
// Lifecycle → frontier tab (the sub-tab that owns the current
// state's forward action):
//   draft     → send      (draft's forward action is to send)
//   sent      → accepted  (post-send: record acceptance)
//   accepted  → tier      (post-accept: push the Sales Order)
//   complete  → null      (umbrella read-only)
//
// Additional rule: if the current tab IS the frontier, no forward
// advance from this tab (the tab has its own submit-style action
// like SendQuote, fireMark, or the SendOrderModal — not an
// AdvanceBar forward). Callers still render the AdvanceBar as
// a status pill without a forward button in that case.

import type { SubTabId } from "./subtabs";

export type FrontierAdvance = {
  targetTab: SubTabId;
  label: string;
  caption: string;
};

export function computeUmbrellaAdvance(
  currentTab: SubTabId,
  quoteStatus: string,
  opts?: {
    /** For target='tier', the captured tier label reads on the
     * button when advancing FROM Mark Accepted specifically
     * (Mark Accepted names the tier in the CTA per R9 canon). */
    capturedTierLabel?: string | null;
  },
): FrontierAdvance | null {
  if (quoteStatus === "complete") return null;

  const frontier: SubTabId | null =
    quoteStatus === "draft"
      ? "send"
      : quoteStatus === "sent"
        ? "accepted"
        : quoteStatus === "accepted"
          ? "tier"
          : null;

  if (!frontier) return null;
  // Current tab IS the frontier — this tab owns its own submit
  // action, not a forward advance. Caller renders no forward button.
  if (frontier === currentTab) return null;

  if (frontier === "send") {
    return {
      targetTab: "send",
      label: "Continue to Send →",
      caption: "Reversible — you can come back and revise",
    };
  }
  if (frontier === "accepted") {
    return {
      targetTab: "accepted",
      label: "Mark Accepted →",
      caption: "Reversible — acceptance can be rolled back",
    };
  }
  // frontier === "tier"
  // Only the Mark Accepted → Sales Order transition names the
  // captured tier in the CTA (R9 canon: "Review Sales Order · Tier N
  // →"). Other tab-to-tier transitions use the generic label.
  const tierSuffix = opts?.capturedTierLabel
    ? ` · ${opts.capturedTierLabel}`
    : "";
  const label =
    currentTab === "accepted"
      ? `Review Sales Order${tierSuffix} →`
      : "Sales Order →";
  return {
    targetTab: "tier",
    label,
    caption: "Next step is the irreversible one",
  };
}
