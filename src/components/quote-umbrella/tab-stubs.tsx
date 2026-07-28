"use client";

// Slice 12 Step 1 — placeholder sub-tab bodies for the remaining
// Steps. Each stub renders a minimal `.r8-wrap` shell pointing at the
// future step that fills it in. Sub-tabs still route correctly so
// the IA + Advance mechanism is testable end-to-end; only the tab
// CONTENT is stubbed.
//
// Slice 12 Step 5c filled TabSendToClient — moved to
// `./tab-send-to-client.tsx`.
// Slice 12 Step 6a filled TabClientReview — moved to
// `./tab-client-review.tsx`.
// Slice 12 Step 7a filled TabMarkAccepted — moved to
// `./tab-mark-accepted.tsx`. (HubSpot push wire = Step 7b.)
// The remaining stub lives here:
// Step 8 fills TabTierSelection (tier select + NetSuite + THE LOCK).

import { AdvanceBar } from "./advance-bar";
import type { SubTabId } from "./subtabs";

type StubProps = { onGo: (id: SubTabId) => void };

function StubBody({
  n,
  title,
  note,
  fillsInStep,
}: {
  n: number;
  title: string;
  note: string;
  fillsInStep: string;
}) {
  return (
    <div className="r8-wrap">
      <p className="eyebrow">Sub-tab {n}</p>
      <h1 className="r8-h1">{title}</h1>
      <p className="r8-sub">{note}</p>
      <p
        className="mono muted"
        style={{ fontSize: 11, marginTop: 12, letterSpacing: "0.04em" }}
      >
        Placeholder body — {fillsInStep}.
      </p>
    </div>
  );
}

// TabSendToClient moved to `./tab-send-to-client.tsx` in Step 5c.
// TabClientReview moved to `./tab-client-review.tsx` in Step 6a.
// TabMarkAccepted moved to `./tab-mark-accepted.tsx` in Step 7a.

export function TabTierSelection({ onGo }: StubProps) {
  return (
    <>
      <StubBody
        n={5}
        title="Tier Selection"
        note="Tier picker + finalization warning + NetSuite SO push (THE LOCK) land here in Step 8."
        fillsInStep="Step 8 wires the accepted-tier write + typed FINALIZE confirm + NetSuite push"
      />
      {/* Slice 12 Step 7c review-fix (CB P4.4) — bare "quote state
          · accepted" was a CC invention (Pattern 30 violation). R8
          canonical Tier body renders live "selected T{n} · $X
          turnkey" driven by picker state (umbrella.jsx:807), which
          requires Step 8 wiring. Stub-scoped placeholder makes the
          deferral explicit rather than inventing a new pill wording
          that isn't in R8. */}
      <AdvanceBar
        weight="heavy"
        back={{ label: "Mark Accepted", onClick: () => onGo("accepted") }}
        mid={<span className="mono muted">placeholder · Step 8</span>}
        caption="Irreversible — creates a NetSuite Sales Order"
        label="Finalize & push to NetSuite"
        onAdvance={() => {
          /* Step 8 wires the finalization modal + NetSuite push */
        }}
        disabled
      />
    </>
  );
}
