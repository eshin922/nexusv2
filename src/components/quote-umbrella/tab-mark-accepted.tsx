"use client";

// Slice 12 Step 8a — Acceptance sub-tab body (R9.1 AcceptedCapture).
//
// Pattern 30 port of R9 canonical `AcceptedCapture` in
// docs/design-prototypes/dist/round-9/app/r9/ceremony.jsx:21-207.
// R9 design intent (docs/r9-designer-notes.md §1):
//
//   > R8 asked the PM to perform two ceremonies for one customer
//   > decision. Customers accept and name a tier in the same breath,
//   > so R9 splits choice from commitment:
//   > - Sub-tab 4 (renamed "Acceptance") — a CAPTURE, not a ceremony.
//   >   Their words, the tier chips, how it arrived. Writes
//   >   customer_accepted_tier_id. Fires the HubSpot push. Reversible.
//   > - Sub-tab 5 (renamed "Sales Order") — the ORDER RECEIPT.
//   >   Writes accepted_tier_id, pushes the NetSuite SO, locks.
//
// Two variants driven by quote.status:
//   - sent:     capture layout — "Their words" textarea (prefilled),
//               tier chips, source picker (email/call/portal/other),
//               Now/Later system cards, "Record acceptance · TierN"
//               advance. Fault surface: HubSpot error banner at top
//               of surface, OUTSIDE any modal (§6 LOAD-BEARING #4).
//   - accepted: resolved-in-place — success card + rollback + revise
//               + handoff advance that names the next act ("Review
//               Sales Order · TierN →"). No auto-navigation per §4
//               "the deliberate handoff" — entry to the irreversible
//               tab must always be an explicit click on a button
//               that names the act.
//
// Step 8a scope: DB write path + HubSpot push for stage AND amount.
// Zero NetSuite. accepted_tier_id stays NULL until Step 8c.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerView } from "@/types/quote";
import type { QuotePerTierRollup } from "@/lib/costing";
import { markAccepted, unmarkAccepted } from "@/app/actions/quotes";
import { AdvanceBar } from "./advance-bar";
import { computeUmbrellaAdvance } from "./advance-target";
import { ReviseButton } from "./revise-button";
import type { SubTabId } from "./subtabs";

function shortDateTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

function usd(n: number, dec = 0): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Map QuotePerTierRollup.blendedMarginStatus → R9 CSS status class
// for the chip margin token (`.r9-chip .m.good/.warn/.bad`).
function marginStatusClass(status: QuotePerTierRollup["blendedMarginStatus"]): string {
  switch (status) {
    case "GOOD": return "good";
    case "BELOW_TARGET": return "warn";
    case "BELOW_FLOOR": return "bad";
    default: return "";
  }
}

type ActionState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

type ChannelOption = { id: "email" | "call" | "portal" | "other"; label: string; hint: string };

// R9 data.js `capture.source_options` — verbatim per Pattern 30.
const CHANNEL_OPTIONS: readonly ChannelOption[] = [
  { id: "email",  label: "Email",  hint: "Written reply" },
  { id: "call",   label: "Call",   hint: "Verbal, you logged it" },
  { id: "portal", label: "Portal", hint: "Accepted in-app" },
  // "Other" is a schema-supported enum value; R9 fixture doesn't ship
  // it as a picker option, but we include it here so PMs have an
  // escape hatch (in-person, PO, SMS, etc.) without a schema change.
  { id: "other",  label: "Other",  hint: "In-person, PO, other channel" },
];

export function TabMarkAccepted({
  view,
  quoteId,
  quoteStatus,
  quoteVersionNumber,
  quoteAcceptedAt,
  quoteNumberDb,
  quoteSentAtDb,
  quoteRollup,
  customerAcceptedTierIdDb,
  prefillNote,
  prefillSourceRowId,
  prefillSourceAt,
  hubspotAcceptStageLabel,
  onGo,
}: {
  view: CustomerView;
  quoteId: string;
  quoteStatus: string;
  quoteVersionNumber: number;
  quoteAcceptedAt: Date | null;
  quoteNumberDb: string | null;
  quoteSentAtDb: Date | null;
  /** Slice 12 Step 8a — full per-tier rollups for the tier chips
   * (label, qty, revenue = turnkey, margin %, margin status).
   * PM-facing only; the customer PDF projection strips these fields
   * per Pattern 45. */
  quoteRollup: QuotePerTierRollup[];
  /** Slice 12 Step 8a — previously-captured tier id (nullable).
   * Populated after a first accept + rollback: schema keeps
   * customer_accepted_tier_id intact on rollback (per FK SET NULL
   * asymmetry — see Architect §0.5 verdict). When populated, the
   * matching chip renders a "named" marker so PMs recognize the
   * prior capture. Fresh sent quotes have this as null; no marker. */
  customerAcceptedTierIdDb: string | null;
  /** Slice 12 Step 8a — server-side prefill for the transcription
   * textarea. Pulled from the most recent PM-authored 'responded'
   * feed event via getLatestRespondedEventForPrefill. Null when no
   * such event exists (fresh quote, or all responded events were
   * system-generated). PM edits before submit; whatever lands is
   * what lands. */
  prefillNote: string | null;
  prefillSourceRowId: string | null;
  prefillSourceAt: Date | null;
  /** Slice 12 Step 8a — human-readable target stage from firm_
   * settings for the "Now · HubSpot" system card copy. The v1 config
   * stores an id ('195607084'); page.tsx resolves to a label via
   * loadPipelineStages if the value is an id, else passes verbatim.
   * Fallback: 'the accept stage' if resolution fails. */
  hubspotAcceptStageLabel: string;
  onGo: (id: SubTabId) => void;
}) {
  const router = useRouter();
  const [_pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>({ kind: "idle" });

  // Capture-form state
  const [tierId, setTierId] = useState<string>(
    customerAcceptedTierIdDb ?? "",
  );
  const [channel, setChannel] = useState<ChannelOption["id"]>("email");
  const [note, setNote] = useState<string>(prefillNote ?? "");

  const customer = view.customer;
  const quote = view.quote;
  const isSent = quoteStatus === "sent";
  const isAccepted = quoteStatus === "accepted";
  const isPending = state.kind === "pending";
  const hasError = state.kind === "error";

  // Selected tier's rollup — powers the advance-bar mid pill + amount
  // preview on the "Now · HubSpot" system card.
  const selectedTier = tierId
    ? quoteRollup.find((t) => t.tierId === tierId) ?? null
    : null;

  function fireMark() {
    if (!tierId) {
      setState({ kind: "error", message: "Pick the tier the customer named before recording." });
      return;
    }
    setState({ kind: "pending" });
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("tierId", tierId);
    fd.set("channel", channel);
    fd.set("note", note.trim());
    startTransition(async () => {
      const r = await markAccepted(fd);
      if (!r.ok) {
        setState({ kind: "error", message: r.error.message });
        return;
      }
      setState({ kind: "idle" });
      router.refresh();
    });
  }

  function fireRollback() {
    if (
      !window.confirm(
        "Roll back this acceptance? Quote returns to 'sent' AND the HubSpot deal stage reverses to the pre-Accept snapshot.",
      )
    ) {
      return;
    }
    setState({ kind: "pending" });
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    startTransition(async () => {
      const r = await unmarkAccepted(fd);
      if (!r.ok) {
        setState({ kind: "error", message: r.error.message });
        return;
      }
      setState({ kind: "idle" });
      router.refresh();
    });
  }

  // ─── ACCEPTED / RECORDED state ─────────────────────────────
  // Resolves IN PLACE per R9 §4 "the deliberate handoff" — no
  // auto-navigation into the irreversible tab. Advance re-labels
  // to name the tier it will commit.
  if (isAccepted) {
    // Show the captured tier as the source of truth for the "carried"
    // display. Fall back to the currently-selected local state if
    // customerAcceptedTierIdDb happens to be null (shouldn't be —
    // markAccepted just wrote it — but defensive).
    const capturedTier = customerAcceptedTierIdDb
      ? quoteRollup.find((t) => t.tierId === customerAcceptedTierIdDb)
      : null;
    const capturedLabel = capturedTier?.label ?? "the captured tier";
    return (
      <div className="r9-wrap">
        <div className="r8-cols r9-single">
          <div>
            <p className="eyebrow">Sub-tab 4 · Acceptance · recorded</p>
            <h1 className="r8-h1">
              {customer.name ?? "The customer"} accepted at <em>{capturedLabel}</em>
            </h1>
            <p className="r8-sub">
              Recorded against v{quoteVersionNumber} and pushed to HubSpot. Nothing is
              locked — this can be rolled back, and the quote can still be revised.
            </p>

            {hasError && (
              <div className="r8-push error" style={{ marginTop: 14 }}>
                <span className="mark">!</span>
                <div className="txt">
                  <div className="t">Action failed</div>
                  <div className="s">{state.message}</div>
                </div>
                <div className="acts">
                  <button className="btn sm" onClick={fireRollback}>Retry</button>
                </div>
              </div>
            )}

            <div className="r9-handoff">
              <span className="mark">✓</span>
              <div className="txt">
                <h4>Acceptance recorded · HubSpot set to {hubspotAcceptStageLabel}</h4>
                <p>
                  {customer.name ?? "The customer"} accepted v{quoteVersionNumber} at{" "}
                  <strong>{capturedLabel}</strong>
                  {capturedTier && (
                    <> ({capturedTier.qty.toLocaleString()} units, {usd(capturedTier.totalRevenue)} turnkey)</>
                  )}
                  . The tier they named carries into Sales Order — you'll review the
                  order and send it there.
                </p>
                <span className="meta">
                  quote.status = accepted · customer_accepted_tier_id = {capturedLabel} ·
                  accepted_tier_id = null · accepted {shortDateTime(quoteAcceptedAt)}
                </span>
              </div>
            </div>

            <div className="r8-rollback" style={{ marginTop: 14 }}>
              <div className="t">
                <strong>Recorded in error?</strong> Roll back to Send to Client —
                reverses the HubSpot stage and returns the quote to <code>sent</code>.
                The review log and the tier they named are kept.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="btn"
                  onClick={fireRollback}
                  disabled={isPending}
                  data-testid="mark-accepted-rollback"
                >
                  {isPending ? "Rolling back…" : "↺ Roll back to Send to Client"}
                </button>
                <ReviseButton
                  quoteId={quoteId}
                  currentVersionNumber={quoteVersionNumber}
                  quoteNumber={quote.quoteNumber ?? quoteNumberDb}
                  disabled={isPending}
                  buttonLabel={`↺ Revise → v${quoteVersionNumber + 1}`}
                  buttonClassName="btn"
                  buttonTestId="mark-accepted-revise"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Slice 12 Step 9 — advance derived from computeUmbrellaAdvance;
            capturedTierLabel is passed so the helper's tier→CTA copy
            variant "Review Sales Order · {tier} →" renders (that
            wording is specific to the Mark Accepted → Sales Order
            transition per R9 canon). */}
        {(() => {
          const adv = computeUmbrellaAdvance("accepted", quoteStatus, {
            capturedTierLabel: capturedLabel,
          });
          return (
            <AdvanceBar
              weight="light"
              back={{ label: "Client Review", onClick: () => onGo("review") }}
              mid={
                <span>
                  quote state · accepted · reversible · nothing in NetSuite yet
                </span>
              }
              caption={adv?.caption ?? "Umbrella read-only — no advance"}
              label={adv?.label}
              onAdvance={adv ? () => onGo(adv.targetTab) : undefined}
              disabled={!adv}
            />
          );
        })()}
      </div>
    );
  }

  // ─── SENT state — capture form ─────────────────────────────
  const canRecord = isSent && !!tierId && !isPending;
  const advanceLabel = isPending
    ? "Recording…"
    : selectedTier
      ? `Record acceptance · ${selectedTier.label}`
      : "Record acceptance";

  return (
    <div className="r9-wrap">
      <div className="r8-cols r9-single">
        <div>
          <p className="eyebrow">Sub-tab 4 · Acceptance</p>
          <h1 className="r8-h1">
            What did <em>{customer.name ?? "the customer"}</em> say?
          </h1>
          <p className="r8-sub">
            Record the acceptance and the tier they named — they arrive together, so
            you enter them together. This closes the deal in HubSpot. It does not
            commit anything operationally.
          </p>

          {/* R9 §6 LOAD-BEARING item 4 — HubSpot failure surfaced
              OUTSIDE any modal, on this sub-tab, stating that state
              did not advance. Sits above the capture card so it's the
              first thing PMs read on retry. */}
          {hasError && (
            <div className="r8-push error" style={{ marginBottom: 14 }}>
              <span className="mark">!</span>
              <div className="txt">
                <div className="t">Acceptance not recorded</div>
                <div className="s">{state.message}</div>
                <div className="s" style={{ marginTop: 4, opacity: 0.8 }}>
                  quote.status is still <code>sent</code>. Nothing was written.
                  Retry when ready.
                </div>
              </div>
              <div className="acts">
                <button className="btn sm" onClick={fireMark} disabled={isPending}>
                  Retry
                </button>
              </div>
            </div>
          )}

          <div className="r9-capture">
            <div className="r9-capture-head">
              <span className="t">
                Acceptance of {quoteNumberDb ?? "(quote)"} v{quoteVersionNumber}
              </span>
              {quoteSentAtDb && (
                <span className="s">
                  sent {shortDateTime(quoteSentAtDb)} · the version they saw
                </span>
              )}
            </div>

            <div className="r9-field">
              <span className="lbl">Their words</span>
              {/* Slice 12 Step 9 Pattern 47 — textarea disabled must
                  NOT include `isPending`. Focus drops on disabled
                  elements, so a mid-flight save that then errors
                  strands the PM outside the input. Button-side
                  disabled (fireMark button below) handles double-
                  click protection; textarea stays interactive. */}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Transcribe what the customer said — their words, in their voice."
                maxLength={4000}
                rows={4}
                style={{
                  width: "100%",
                  minHeight: 84,
                  padding: "10px 12px",
                  fontFamily: "var(--display)",
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--ink)",
                  background: "var(--paper-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  resize: "vertical",
                }}
                data-testid="acceptance-note"
              />
              {prefillNote && prefillSourceAt && (
                <span className="r9-quote-src" style={{ display: "block", marginTop: 6 }}>
                  prefilled from a &lsquo;responded&rsquo; log entry from{" "}
                  {shortDateTime(prefillSourceAt)} — edit if transcribing something else
                </span>
              )}
              {!prefillNote && (
                <span className="r9-quote-src" style={{ display: "block", marginTop: 6 }}>
                  no prior response logged — type the customer&apos;s words as you have them
                </span>
              )}
            </div>

            <div className="r9-field">
              <span className="lbl">Tier they named</span>
              <div className="r9-tierchips">
                {quoteRollup.map((t) => {
                  const disabled = t.blendedMarginStatus === "BELOW_FLOOR";
                  const isNamed = customerAcceptedTierIdDb === t.tierId;
                  const isOn = tierId === t.tierId;
                  return (
                    <button
                      key={t.tierId}
                      className={
                        "r9-chip" +
                        (isOn ? " on" : "") +
                        (disabled ? " disabled" : "")
                      }
                      onClick={disabled ? undefined : () => setTierId(t.tierId)}
                      disabled={disabled || isPending}
                      type="button"
                      data-testid={`tier-chip-${t.label}`}
                    >
                      <span className="top">
                        <span className="tl">{t.label}</span>
                        {isNamed && <span className="named">named</span>}
                      </span>
                      <span className="q">{t.qty.toLocaleString()} units</span>
                      <span className={"m " + marginStatusClass(t.blendedMarginStatus)}>
                        {t.blendedMarginPct.toFixed(1)}% margin
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="hint">
                Carried to Sales Order as an intent — you confirm and commit it there.
                Below-floor tiers can&apos;t be committed without an admin override.
              </span>
            </div>

            <div className="r9-field">
              <span className="lbl">How it arrived</span>
              <div className="r9-source">
                {CHANNEL_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    className={channel === o.id ? "on" : ""}
                    onClick={() => setChannel(o.id)}
                    disabled={isPending}
                    type="button"
                    data-testid={`channel-${o.id}`}
                  >
                    <span className="t">{o.label}</span>
                    <span className="h">{o.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="r9-systems">
            <div className="r9-system pending">
              <div className="k">Now · HubSpot</div>
              <div className="v">
                Deal moves to <strong>{hubspotAcceptStageLabel}</strong>
                {selectedTier && (
                  <> at {usd(selectedTier.totalRevenue)}</>
                )}
                . Acceptance is a sales fact — it closes when the customer says yes.
              </div>
              <span className="badge">fires on record</span>
            </div>
            <div className="r9-system pending">
              <div className="k">Later · NetSuite</div>
              <div className="v">
                No Sales Order yet. The SO is pushed when you{" "}
                <strong>send the order</strong> from Sales Order — that&apos;s the
                irreversible act.
              </div>
              <span className="badge">not yet</span>
            </div>
          </div>
        </div>
      </div>

      <AdvanceBar
        weight="light"
        back={{ label: "Client Review", onClick: () => onGo("review") }}
        mid={
          <span>
            {hasError
              ? "push failed · state unchanged (sent)"
              : `quote state · ${quoteStatus}${selectedTier ? ` · recording ${selectedTier.label}` : ""}`}
          </span>
        }
        caption={
          isSent
            ? "Reversible — rollback and revise both stay available"
            : "Advance available once the quote is sent"
        }
        label={advanceLabel}
        onAdvance={canRecord ? fireMark : undefined}
        disabled={!canRecord}
      />
    </div>
  );
}
