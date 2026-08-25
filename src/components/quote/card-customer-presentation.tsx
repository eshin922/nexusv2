"use client";

import { useState, useTransition } from "react";

import {
  updatePresentationInclude,
  updatePresentationDetail,
  updatePresentationLayout,
  updatePresentationTierShown,
} from "@/app/actions/presentation-profile";
// Both of these write QUOTE facts, and both already existed with their own
// owners and audit trails. Reused rather than reimplemented — a second writer
// for either is precisely the duplication the disposition removed.
import { setTierRecommended, updateQuoteNotes } from "@/app/actions/quotes";
import type { CustomerViewDetailLevel, CustomerViewPdfLayout } from "@/types/quote";

export type PresentationState = {
  layout: CustomerViewPdfLayout;
  detailLevel: CustomerViewDetailLevel;
  presentedTierId: string | null;
  includeFeeLines: boolean;
  includeTerms: boolean;
  includeAddendum: boolean;
  includeNote: boolean;
  hiddenTierIds: string[];
  customerNote: string | null;
  stored: boolean;
};

export type PresentationTier = {
  id: string;
  label: string;
  quantity: number;
  recommended: boolean;
};

/** The authority's hard cap. Enforced in the control, never as a DB constraint. */
const NOTE_MAX = 400;

const qty = (n: number) =>
  n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : String(n);

/**
 * Card 2 · what the customer will SEE.
 *
 * ── TWO OWNERS, ONE CARD ─────────────────────────────────────────────────
 *
 * Almost every control here writes the versioned presentation profile. Two do
 * not, and the difference is not cosmetic:
 *
 *   Recommended tier  ->  `quote_tiers.recommended`, a governed QUOTE fact
 *   Customer note     ->  `quotes.customer_facing_notes`, also a quote fact
 *
 * Both already existed with their own owners and their own audit trails.
 * Duplicating either into the profile would have given one customer-facing
 * fact two columns with nothing saying which one the customer receives — the
 * conflation this workstream has spent its length removing.
 *
 * So the card says so, quietly, using the provenance grammar Card 0 already
 * uses rather than inventing a warning treatment. A control that writes a
 * governed quote fact is labelled as one.
 *
 * ── PENDING IS PER CONTROL ───────────────────────────────────────────────
 *
 * Pattern 47(f): a control may be disabled only by the pending state of the
 * action IT initiates. One shared transition across a card of eleven controls
 * is how an in-flight toggle makes ten unrelated ones dead — the failure the
 * Freight survey measured at 6.0 controls gated per transition.
 */
export function CardCustomerPresentation({
  quoteId,
  editable,
  presentation,
  tiers,
  detailLevel,
  onDetailLevelChange,
  pdfLayout,
  onPdfLayoutChange,
}: {
  quoteId: string;
  editable: boolean;
  presentation: PresentationState;
  tiers: readonly PresentationTier[];
  detailLevel: CustomerViewDetailLevel;
  onDetailLevelChange: (next: CustomerViewDetailLevel) => void;
  pdfLayout: CustomerViewPdfLayout;
  onPdfLayoutChange: (next: CustomerViewPdfLayout) => void;
}) {
  // One key, naming the control in flight. Keyed rather than boolean so a
  // pending toggle disables itself and nothing else.
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [note, setNote] = useState(presentation.customerNote ?? "");
  const [noteSaved, setNoteSaved] = useState(true);

  const hidden = new Set(presentation.hiddenTierIds);
  const recommendedId = tiers.find((t) => t.recommended)?.id ?? null;

  const run = (key: string, fd: FormData, fn: (f: FormData) => Promise<unknown>) => {
    setBusy(key);
    startTransition(async () => {
      try {
        await fn(fd);
      } finally {
        setBusy(null);
      }
    });
  };

  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };

  const toggles: { field: keyof PresentationState; label: string; meta: string }[] = [
    {
      field: "includeFeeLines",
      label: "Itemize included charges",
      // Says what OFF does, because the difference between collapsing the
      // itemization and omitting the charge is the whole point.
      meta: "Off collapses the list; the total is still stated.",
    },
    { field: "includeTerms", label: "Commercial terms block", meta: "Valid until, payment, lead time, Incoterms." },
    { field: "includeAddendum", label: "Specification addendum", meta: "Adds a second page when there is spec data." },
    { field: "includeNote", label: "Customer note", meta: "Prints verbatim above How to accept." },
  ];

  return (
    <section className="cv-card" data-testid="card-customer-presentation">
      <div className="cv-card-head">
        <span className="cv-step">2</span>
        <div>
          <div className="cv-card-title">Customer presentation</div>
          <div className="cv-card-sub">Never changes economics. Display only.</div>
        </div>
      </div>

      {/* ── Shape ─────────────────────────────────────────────────────── */}
      <div className="cv-section">
        <div className="cv-field">
          <span className="cv-eyebrow">Shape</span>
          <div className="cv-choice">
            {(
              [
                ["itemized", "Itemized", "line by line"],
                ["turnkey_only", "Turnkey", "one number"],
              ] as const
            ).map(([value, label, sub]) => (
              <button
                key={value}
                type="button"
                aria-pressed={detailLevel === value}
                aria-busy={busy === "detail" || undefined}
                disabled={!editable || busy === "detail"}
                title={!editable ? "This quote is no longer a draft." : undefined}
                data-testid={`cv-detail-${value === "itemized" ? "itemized" : "turnkey"}`}
                onClick={() => {
                  // Context first so the document moves on this frame; the
                  // write follows and is what makes it survive a reload.
                  onDetailLevelChange(value);
                  run("detail", form({ detailLevel: value }), updatePresentationDetail);
                }}
              >
                {label}
                <span className="cv-choice-sub">{sub}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="cv-field">
          <span className="cv-eyebrow">Tier layout</span>
          <div className="cv-choice">
            {(
              [
                ["tier_table", "Tier table"],
                ["single_tier", "Single tier"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={pdfLayout === value}
                aria-busy={busy === "layout" || undefined}
                // Single-tier needs a tier to present. The database refuses the
                // state outright; saying so here means the operator learns it
                // from the control rather than from a rejected write.
                disabled={
                  !editable ||
                  busy === "layout" ||
                  (value === "single_tier" && recommendedId === null)
                }
                title={
                  value === "single_tier" && recommendedId === null
                    ? "Mark a tier as recommended first — a single-tier document has to name the tier it presents."
                    : !editable
                      ? "This quote is no longer a draft."
                      : undefined
                }
                data-testid={`cv-layout-${value === "tier_table" ? "tier-table" : "single-tier"}`}
                onClick={() => {
                  onPdfLayoutChange(value);
                  run(
                    "layout",
                    form({
                      layout: value,
                      presentedTierId: value === "single_tier" ? (recommendedId ?? "") : "",
                    }),
                    updatePresentationLayout,
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tiers shown ───────────────────────────────────────────────── */}
      <div className="cv-section">
        <span className="cv-eyebrow">Tiers shown</span>
        {tiers.map((t) => {
          const shown = !hidden.has(t.id);
          const key = `tier:${t.id}`;
          // The last visible tier cannot be hidden — a customer document with
          // no priced column is not a quote. The action refuses it too; this
          // is so the operator sees why before clicking.
          const isLastVisible = shown && tiers.filter((x) => !hidden.has(x.id)).length === 1;
          return (
            <div className="cv-toggle-row" key={t.id}>
              <button
                type="button"
                role="switch"
                aria-checked={shown}
                aria-busy={busy === key || undefined}
                disabled={!editable || busy === key || isLastVisible}
                title={
                  isLastVisible
                    ? "At least one tier has to stay on the customer document."
                    : !editable
                      ? "This quote is no longer a draft."
                      : undefined
                }
                className="cv-switch"
                data-testid={`cv-tier-shown-${t.id}`}
                onClick={() =>
                  run(
                    key,
                    form({ tierId: t.id, shown: String(!shown) }),
                    updatePresentationTierShown,
                  )
                }
              />
              <span className="cv-toggle-label">
                {t.label}
                <span className="cv-toggle-meta">{qty(t.quantity)} units</span>
              </span>
              <span className={"cv-state-chip" + (shown ? "" : " off")}>
                {shown ? "Shown" : "Hidden"}
              </span>
            </div>
          );
        })}

        {/* Recommended — a GOVERNED QUOTE FACT, not a presentation choice.
            Labelled as one, using Card 0's provenance grammar rather than a
            new warning treatment. */}
        <div className="cv-field" style={{ marginTop: 10 }}>
          <span className="cv-eyebrow">
            Recommended <span className="cv-src-tag">quote fact</span>
          </span>
          <div className="cv-choice cv-choice-tight">
            {tiers.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={t.recommended}
                aria-busy={busy === `rec:${t.id}` || undefined}
                disabled={!editable || busy === `rec:${t.id}`}
                data-testid={`cv-recommended-${t.id}`}
                onClick={() =>
                  run(
                    `rec:${t.id}`,
                    form({ tierId: t.id, recommended: String(!t.recommended) }),
                    setTierRecommended,
                  )
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Include toggles ───────────────────────────────────────────── */}
      <div className="cv-section">
        {toggles.map((row) => {
          const on = presentation[row.field] as boolean;
          const key = `inc:${row.field}`;
          return (
            <div className="cv-toggle-row" key={row.field}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-busy={busy === key || undefined}
                disabled={!editable || busy === key}
                title={!editable ? "This quote is no longer a draft." : undefined}
                className="cv-switch"
                data-testid={`cv-include-${row.field}`}
                onClick={() =>
                  run(
                    key,
                    form({ field: row.field, value: String(!on) }),
                    updatePresentationInclude,
                  )
                }
              />
              <span className="cv-toggle-label">
                {row.label}
                <span className="cv-toggle-meta">{row.meta}</span>
              </span>
              <span className={"cv-state-chip" + (on ? "" : " off")}>
                {on ? "Hide" : "Show"}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Customer note · a quote fact, edited here ─────────────────── */}
      <div className="cv-section">
        <span className="cv-eyebrow">
          Customer note <span className="cv-src-tag">quote fact</span>
          <span className="cv-note-count">
            {note.length}/{NOTE_MAX}
          </span>
        </span>
        <textarea
          className="cv-note-input"
          rows={3}
          // The cap lives here, per the disposition — never as a DB constraint
          // against existing data, where it would be a tightening migration
          // over notes that may already exceed it.
          maxLength={NOTE_MAX}
          // Pattern 47(e): `disabled` must NOT carry a pending flag on an input.
          // Disabling mid-save drops focus and the next keystroke goes nowhere.
          disabled={!editable}
          placeholder="Printed verbatim above How to accept."
          value={note}
          data-testid="cv-customer-note"
          onChange={(e) => {
            setNote(e.target.value);
            setNoteSaved(false);
          }}
          onBlur={() => {
            if (note === (presentation.customerNote ?? "")) {
              setNoteSaved(true);
              return;
            }
            const fd = new FormData();
            fd.set("quoteId", quoteId);
            fd.set("customerFacingNotes", note);
            startTransition(async () => {
              await updateQuoteNotes(fd);
              setNoteSaved(true);
            });
          }}
        />
        {!noteSaved && <span className="cv-note-dirty">unsaved — click away to save</span>}
      </div>
    </section>
  );
}
