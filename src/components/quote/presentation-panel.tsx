"use client";

/**
 * The Presentation panel — operator controls, beside the document.
 *
 * ── WHAT THE AUTHORITY SPECIFIES ────────────────────────────────────────
 *
 * `docs/quote-presentation-profile-brief.md`, "Interaction model":
 *
 *   "One Presentation panel, grouped by what the reader of the PDF
 *    experiences: Structure (Itemized/Turnkey, tiers, featured tier) ·
 *    Disclosure (fee presentation, on-request lines, addendum) · Voice
 *    (customer-facing notes)."
 *
 * Grouped by the reader's experience rather than by underlying column, which
 * is why "Send as" and "Detail" sit together: both decide what shape the
 * document takes, though they are different axes underneath.
 *
 * ── NOTHING HERE IS AN INPUT TO ECONOMICS ───────────────────────────────
 *
 * The authority's rule, and it is load-bearing rather than stylistic:
 *
 *   "Governed figures visually locked. Any economic value surfaced in the
 *    panel renders in the read-only register with a lock affordance and a
 *    route to the surface that owns it. Nothing in this panel is an input to
 *    economics."
 *
 * with the property it protects stated so it can be falsified:
 *
 *   "Presentation may change arrangement, aggregation and inclusion. It may
 *    never change a value, and it may never change a total. A control that
 *    would change the total is not a presentation control."
 *
 * This is the rule the recovery workspace broke. Its election is economically
 * substantive — converting a charge from legacy to a governed contract moves
 * the customer's total — so under Edward's R5 disposition (2026-08-24) it is
 * not a Quote Presentation control and has been removed from this surface
 * rather than restyled onto it. See
 * `docs/quote-presentation-restoration-brief.md`.
 *
 * A test asserts this panel takes no handler that could write economics.
 *
 * ── AXES THAT DO NOT EXIST YET ──────────────────────────────────────────
 *
 * The authority's Disclosure group also names fee presentation and on-request
 * lines, and Structure names a featured tier. None has a column: the Layer 2
 * schema (`quote_presentation_profiles`) was never built, so those axes are
 * still derived rather than controlled (F2, F3). They are absent here rather
 * than faked, and F1 — the axes below still do not survive a reload — remains
 * live and needs the schema slice.
 */

import type { CustomerViewDetailLevel, CustomerViewPdfLayout } from "@/types/quote";
import { AddendumToggle } from "./addendum-toggle";
import type { QuoteAddendumData } from "@/lib/addendum-loader";

export function PresentationPanel({
  pdfLayout,
  onPdfLayoutChange,
  detailLevel,
  onDetailLevelChange,
  addendumOn,
  onAddendumToggle,
  addendumData,
  notesEditable,
  onEditNotes,
  locked,
  lockReason,
}: {
  pdfLayout: CustomerViewPdfLayout;
  onPdfLayoutChange: (next: CustomerViewPdfLayout) => void;
  detailLevel: CustomerViewDetailLevel;
  onDetailLevelChange: (next: CustomerViewDetailLevel) => void;
  addendumOn: boolean;
  onAddendumToggle: () => void;
  addendumData: QuoteAddendumData | null;
  notesEditable: boolean;
  onEditNotes: () => void;
  /** A sent quote renders its frozen snapshot; the axes no longer apply. */
  locked: boolean;
  lockReason?: string;
}) {
  return (
    <aside className="qp-rail" data-testid="presentation-panel">
      <h3 className="qp-rail-title">Presentation</h3>
      <p className="qp-rail-note">
        How this quote appears to the customer. These choices change the
        document&rsquo;s shape, never its figures.
      </p>

      <section className="qp-group">
        <div className="qp-group-label">Structure</div>

        <div className="qp-field">
          <span className="qp-field-label">Send as</span>
          <div className="qp-choice">
            <button
              type="button"
              aria-pressed={pdfLayout === "tier_table"}
              disabled={locked}
              title={lockReason}
              onClick={() => onPdfLayoutChange("tier_table")}
              data-testid="qp-layout-tier-table"
            >
              Tier table
            </button>
            <button
              type="button"
              aria-pressed={pdfLayout === "single_tier"}
              disabled={locked}
              title={lockReason}
              onClick={() => onPdfLayoutChange("single_tier")}
              data-testid="qp-layout-single-tier"
            >
              Single tier
            </button>
          </div>
        </div>

        <div className="qp-field">
          <span className="qp-field-label">Detail</span>
          <select
            value={detailLevel}
            disabled={locked}
            title={lockReason}
            onChange={(e) =>
              onDetailLevelChange(e.target.value as CustomerViewDetailLevel)
            }
            data-testid="qp-detail-level"
          >
            <option value="itemized">Itemized</option>
            <option value="turnkey_only">Turnkey only</option>
          </select>
        </div>
      </section>

      <section className="qp-group">
        <div className="qp-group-label">Disclosure</div>
        {addendumData ? (
          <div className="qp-field">
            <span style={{ opacity: locked ? 0.5 : 1 }} title={lockReason}>
              <AddendumToggle
                on={addendumOn}
                onToggle={() => {
                  if (locked) return;
                  onAddendumToggle();
                }}
                totalLeaves={addendumData.totalLeaves}
                totalAssemblies={addendumData.totalAssemblies}
                hasMeaningfulContent={addendumData.hasMeaningfulContent}
              />
            </span>
          </div>
        ) : (
          <p className="qp-hint">No specification addendum for this quote.</p>
        )}
      </section>

      <section className="qp-group">
        <div className="qp-group-label">Voice</div>
        {notesEditable ? (
          <div className="qp-field">
            <button
              type="button"
              onClick={onEditNotes}
              data-testid="qp-edit-notes"
              title="Customer-facing notes appear on the quote. Internal notes stay on Setup."
            >
              Edit customer-facing notes
            </button>
          </div>
        ) : (
          <p className="qp-hint">
            Notes are fixed once the quote has been sent.
          </p>
        )}
      </section>
    </aside>
  );
}
