// The approval message — DECISION-SIZED, not a quote representation.
//
// A reviewer needs enough to say yes or no and a link for everything else.
// Reproducing the quote in Slack would put commercial detail in a surface with
// no boundary guard, and would invite deciding from the message instead of from
// Nexus.
//
// Pure: builds blocks from values, performs no IO, so the content is assertable
// without a Slack workspace.

export const APPROVE_ACTION_ID = "below_floor_approve";
export const REJECT_ACTION_ID = "below_floor_reject";
export const REASON_VIEW_CALLBACK_ID = "below_floor_decision_reason";

export interface ApprovalMessageContext {
  requestId: string;
  customerName: string;
  dealName: string;
  quoteNumber: string | null;
  scenarioLabel: string;
  tierLabel: string;
  tierQty: number | null;
  marginPct: number;
  floorPct: number;
  tierRevenue: number;
  requesterName: string;
  justification: string;
  nexusUrl: string;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Plain-text fallback — notifications and accessibility read this. */
export function approvalFallbackText(c: ApprovalMessageContext): string {
  return `Below-floor approval — ${c.customerName} · ${pct(c.marginPct)} against a ${pct(c.floorPct)} floor · requested by ${c.requesterName}`;
}

export function buildApprovalBlocks(c: ApprovalMessageContext): unknown[] {
  const shortfall = c.floorPct - c.marginPct;
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "⚠  Below-floor approval", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Customer*\n${c.customerName}` },
        { type: "mrkdwn", text: `*Deal*\n${c.dealName}` },
        {
          type: "mrkdwn",
          text: `*Quote*\n${c.quoteNumber ?? "(unsent)"} · ${c.scenarioLabel}`,
        },
        {
          type: "mrkdwn",
          text: `*Tier*\n${c.tierLabel}${c.tierQty ? ` · ${c.tierQty.toLocaleString("en-US")} units` : ""}`,
        },
        {
          type: "mrkdwn",
          text: `*Margin*\n${pct(c.marginPct)}  _(floor ${pct(c.floorPct)})_`,
        },
        {
          type: "mrkdwn",
          text: `*Impact*\n${usd(c.tierRevenue)} · ${pct(shortfall)} below floor`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Requested by* ${c.requesterName}\n*Why* ${c.justification}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in Nexus", emoji: true },
          url: c.nexusUrl,
          action_id: "below_floor_view",
        },
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "Approve", emoji: true },
          action_id: APPROVE_ACTION_ID,
          value: c.requestId,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "Reject", emoji: true },
          action_id: REJECT_ACTION_ID,
          value: c.requestId,
        },
      ],
    },
  ];
}

/**
 * The message after disposition. **Buttons are gone** — a decided request must
 * not continue to present itself as actionable, which is the same reason a
 * superseded request is re-rendered rather than left alone.
 */
export function buildDecidedBlocks(input: {
  context: ApprovalMessageContext;
  status: "approved" | "rejected" | "superseded" | "cancelled";
  reviewerName: string | null;
  decidedAt: Date | null;
  reason: string | null;
}): unknown[] {
  const { context: c, status, reviewerName, decidedAt, reason } = input;
  const banner = {
    approved: "✅  Approved",
    rejected: "⛔  Rejected",
    superseded: "🗑  Superseded — the quote's economics changed",
    cancelled: "↩︎  Withdrawn by the requester",
  }[status];

  const lines: string[] = [`*${banner}*`];
  if (reviewerName) lines.push(`by ${reviewerName}`);
  if (decidedAt) lines.push(`· ${decidedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`);
  const head = lines.join(" ");

  return [
    { type: "section", text: { type: "mrkdwn", text: head } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Customer*\n${c.customerName}` },
        {
          type: "mrkdwn",
          text: `*Quote*\n${c.quoteNumber ?? "(unsent)"} · ${c.tierLabel}`,
        },
        { type: "mrkdwn", text: `*Margin*\n${pct(c.marginPct)}` },
        { type: "mrkdwn", text: `*Floor*\n${pct(c.floorPct)}` },
      ],
    },
    ...(reason
      ? [{ type: "section", text: { type: "mrkdwn", text: `*Reason*\n${reason}` } }]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            status === "superseded"
              ? "Nexus is authoritative. A new request is required."
              : "Nexus is authoritative; this message is a record of the decision.",
        },
      ],
    },
  ];
}

/** The reason modal. Required on reject, optional on approve. */
export function buildReasonView(input: {
  requestId: string;
  action: "approve" | "reject";
  prefill: string | null;
}): unknown {
  const rejecting = input.action === "reject";
  return {
    type: "modal",
    callback_id: REASON_VIEW_CALLBACK_ID,
    private_metadata: JSON.stringify({ requestId: input.requestId, action: input.action }),
    title: {
      type: "plain_text",
      text: rejecting ? "Reject request" : "Approve request",
    },
    submit: { type: "plain_text", text: rejecting ? "Reject" : "Approve" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "reason_block",
        // Required on reject: a refusal without a why is exactly as useless to
        // an auditor as an approval without one.
        optional: !rejecting,
        label: {
          type: "plain_text",
          text: rejecting ? "Why are you rejecting this?" : "Note (optional)",
        },
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
          ...(input.prefill && !rejecting ? { initial_value: input.prefill } : {}),
        },
      },
    ],
  };
}
