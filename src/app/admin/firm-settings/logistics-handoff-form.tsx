"use client";

import { useState, useTransition } from "react";
import { updateFirmSettingsLogisticsHandoff } from "@/app/actions/firm-settings";

// Configuration for the packaging → logistics handoff.
//
// ── WHY THIS IS A SETTING AND NOT A ROLE LOOKUP ──────────────────────────
//
// Freight requests could be routed to "whoever holds the logistics role", and
// that would be wrong in a way nobody would notice until it mattered: a role
// says what a person MAY do, and this says whose work a task IS. Naming the
// recipient is a decision, made here, recorded in the audit log, and versioned
// like every other firm setting.
//
// Same versioning as the cards above -- Save writes a NEW current row carrying
// every unchanged column forward.

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export type LogisticsHandoffConfig = {
  logisticsRecipientUserId: string | null;
  slackLogisticsChannelId: string | null;
};

export function LogisticsHandoffForm({
  current,
  users,
}: {
  current: LogisticsHandoffConfig | null;
  users: { id: string; email: string; role: string }[];
}) {
  const [recipient, setRecipient] = useState(
    current?.logisticsRecipientUserId ?? "",
  );
  const [channel, setChannel] = useState(current?.slackLogisticsChannelId ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateFirmSettingsLogisticsHandoff(fd);
      if (!r.ok) setError(r.error.message);
      else
        setSuccess(`Saved. New current row effective from ${r.data.effectiveFrom}.`);
    });
  }

  const input =
    "rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:border-slate-500 focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-700">
          Freight recipient
        </legend>
        <p className="text-xs text-slate-500">
          Receives every &ldquo;Ready for freight&rdquo; handoff, and holds the
          task in their Needs you list until they mark it complete. Quote
          ownership is unaffected. With nobody set, the action refuses rather
          than picking someone.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Recipient</span>
          <select
            name="logisticsRecipientUserId"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className={input}
          >
            <option value="">— nobody set —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} ({u.role})
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-700">
          Slack notification
        </legend>
        <p className="text-xs text-slate-500">
          A dedicated channel, not the approvals channel — that one has a
          different audience, and freight requests would be noise there and
          invisible here. Leave it empty and the Nexus task is still created;
          the handoff simply records that no notification was configured.
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Channel ID</span>
          <div className="flex items-center gap-2">
            <input
              type="text"
              name="slackLogisticsChannelId"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="C01ABCDEFGH"
              className={`w-48 ${input}`}
            />
            <span className="text-xs text-slate-500">
              In Slack: channel name → View channel details → ID at the bottom.
              The Nexus bot must be a member.
            </span>
          </div>
        </label>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Effective from</span>
        <input
          type="date"
          name="effectiveFrom"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          required
          className={`w-40 ${input}`}
        />
      </label>

      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {success && <p className="text-sm text-emerald-700">{success}</p>}

      {/* `.r2-btn primary`, the same control the card above this one uses.
          The Tailwind classes this carried before produced NO background on
          this page -- the computed value was transparent -- so the save read
          as a line of text rather than a button, and an operator has no reason
          to click a label. Matching the sibling is also what keeps the two
          saves on one page looking like the same kind of act.

          No focus handling is added: `.r2-btn` does not clear the outline and
          nothing global suppresses it, so the browser's own focus ring still
          shows on Tab. */}
      <button
        type="submit"
        disabled={pending}
        className="r2-btn primary"
        style={{ opacity: pending ? 0.5 : 1 }}
      >
        {pending ? "Saving…" : "Save handoff settings"}
      </button>
    </form>
  );
}
