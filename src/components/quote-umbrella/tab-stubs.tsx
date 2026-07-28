"use client";

// Slice 12 Step 1 — placeholder sub-tab bodies for the remaining
// Steps. Each stub renders a minimal `.r8-wrap` shell pointing at the
// future step that fills it in. Sub-tabs still route correctly so
// the IA + Advance mechanism is testable end-to-end; only the tab
// CONTENT is stubbed.
//
// Slice 12 Step 5c filled TabSendToClient — moved to
// `./tab-send-to-client.tsx`. The remaining stubs live here:
// Step 6 fills TabClientReview (feed + Revise + mismatch banner).
// Step 7 fills TabMarkAccepted (accept write-path + HubSpot push).
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

export function TabClientReview({ onGo }: StubProps) {
  return (
    <>
      <StubBody
        n={3}
        title="Client Review"
        note="Activity-feed log + Revise-in-place + sent-vs-draft mismatch banner land here in Step 6."
        fillsInStep="Step 6 wires quote_review_events + Revise + mismatch banner"
      />
      <AdvanceBar
        weight="light"
        back={{ label: "Send", onClick: () => onGo("send") }}
        mid={<span>logging customer activity</span>}
        label="Mark Accepted →"
        onAdvance={() => onGo("accepted")}
        disabled
      />
    </>
  );
}

export function TabMarkAccepted({ onGo }: StubProps) {
  return (
    <>
      <StubBody
        n={4}
        title="Mark Accepted"
        note="Acceptance recording + HubSpot Closed Won push + rollback affordance land here in Step 7."
        fillsInStep="Step 7 wires the accept write-path + HubSpot deal-stage push + Q7 rollback"
      />
      <AdvanceBar
        weight="light"
        back={{ label: "Client Review", onClick: () => onGo("review") }}
        mid={<span>quote state · sent</span>}
        caption="Reversible — Mark Accepted can be rolled back"
        label="Tier Selection →"
        onAdvance={() => onGo("tier")}
        disabled
      />
    </>
  );
}

export function TabTierSelection({ onGo }: StubProps) {
  return (
    <>
      <StubBody
        n={5}
        title="Tier Selection"
        note="Tier picker + finalization warning + NetSuite SO push (THE LOCK) land here in Step 8."
        fillsInStep="Step 8 wires the accepted-tier write + typed FINALIZE confirm + NetSuite push"
      />
      <AdvanceBar
        weight="heavy"
        back={{ label: "Mark Accepted", onClick: () => onGo("accepted") }}
        mid={<span>quote state · accepted</span>}
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
