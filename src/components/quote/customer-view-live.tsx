"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerView } from "@/types/quote";
import { extendedAmount, unitPrice } from "@/lib/money-display";
import { longDate } from "@/lib/customer-dates";
import "@/styles/pp-customer-document.css";
import "@/styles/pp-customer-document-fit.css";

/**
 * The live customer document.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────
 *
 * A second RENDERER of the customer artifact, over the same `CustomerView` the
 * PDF consumes. It exists because Chrome's PDF plugin cannot behave as an
 * interactive surface: every strategy for swapping the document inside it
 * either blanked the pane for the length of a server render or promoted a
 * frame before the plugin had painted, and there is no event that means "the
 * PDF is on screen" to time it against.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────
 *
 * It is not a second authority over customer economics, and the boundary is
 * enforced rather than promised:
 *
 *   - no commercial arithmetic. Every figure below is read from the
 *     projection. `verify:boundaries` fails the build on price × quantity,
 *     total ÷ quantity, reduce over charges, or any rate/markup symbol
 *     appearing in a renderer — proven red against both shapes before it was
 *     trusted.
 *   - no PDF adapter dependency. This imports `CustomerView`, never
 *     `customer-view-to-cpdf` or anything under `components/pdf/`. The PDF
 *     adapter is a sibling formatting consumer, not an upstream of this.
 *   - no independent fallbacks or defaults. Where the projection says null,
 *     this renders the absence. It does not invent a zero, a placeholder
 *     price, or a default term — an invented figure on a customer document is
 *     the one class of defect that cannot be apologised for afterwards
 *     (Pattern 45).
 *
 * The PDF remains the artifact of record for Download and Freeze & send. This
 * is what the operator watches while they work.
 *
 * ── GATE B · TRANSCRIPTION, NOT REDESIGN ─────────────────────────────────
 *
 * Gate A certified SEMANTIC parity (13/13) while this renderer's geometry was
 * deliberately plain, so that a geometry difference could never be mistaken
 * for a content difference while the evidence was being gathered. That is
 * done, and this pass closes the visual gap.
 *
 * The markup below is transcribed from CD's own source — the `.pp-*` register
 * in `docs/design-prototypes/dist/Nexus Customer PDF Render/app/cpdf/`, which
 * is the SAME source `customer-pdf-styles.ts` was Pattern-30 ported from. So
 * the two documents are two renderings of one stylesheet rather than two
 * designs that resemble each other. Class names are the canonical ones; a
 * future R-round refresh is a re-copy, not a re-interpretation.
 *
 * Copy is taken from the SHIPPED PDF components, not from the prototype,
 * wherever the two differ — the prototype still carries fixture sentences and
 * pre-dates deliberate removals (the "in USD" reading instruction and the
 * PER UNIT / INCLUDES / FROM legends, dropped 2026-08-20). Transcribing the
 * prototype would have quietly reinstated content the firm had removed.
 *
 * ── ONE STRUCTURAL NOTE ──────────────────────────────────────────────────
 *
 * The canonical pricing table is FLEX, not `<table>` — authored that way so it
 * ports 1:1 to react-pdf, which has no table primitive. Transcribing it as a
 * real `<table>` would have diverged from the register on every rule, gutter
 * and column edge. It is transcribed as flex and given explicit ARIA table
 * roles, so the visual register is canonical and the semantics a screen reader
 * gets are the ones a pricing table should have.
 */

const money = extendedAmount;
const unit = unitPrice;

/** Tier quantity as the document says it: "1k units", "10k units". */
function qtyLabel(n: number): string {
  return n >= 1000 && n % 1000 === 0 ? `${n / 1000}k units` : `${n} units`;
}

/**
 * The page is a fixed 816px artifact — US Letter at 96dpi. It is SCALED to the
 * available width, never reflowed.
 *
 * That is the whole point: a customer document whose columns re-wrapped to fit
 * an operator's pane would no longer be a preview of the thing the customer
 * receives, which is the only reason this renderer exists. A PDF viewer zooms
 * for exactly the same reason. Scaling keeps every proportion the canonical
 * stylesheet sets; reflowing would keep none of them.
 */
const SHEET_W = 816;

/**
 * Scaled with `zoom`, not `transform`.
 *
 * `transform` does not affect layout: the scaled sheet keeps its unscaled box,
 * so the wrapper's height has to be reserved by hand. Reserving one page's
 * worth — 1056px, US Letter at 96dpi — silently CLIPPED every quote that runs
 * past a page. The notes, the Terms & conditions and the whole "How to accept"
 * block disappeared from a preview that still looked finished. Measuring the
 * document instead fixed the steady state and left the first paint wrong,
 * because a server-rendered pass has no measurement yet.
 *
 * `zoom` scales the layout box itself. There is no height to reserve, nothing
 * to measure for it, and no server/client gap — vertical clipping stops being
 * a thing that can happen rather than a thing that is currently handled. The
 * unscaled first paint can overflow horizontally for a frame, which the
 * wrapper crops; that is a visibly transient crop rather than content that
 * looks deliberately absent.
 */
function useFitScale() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth;
      if (w > 0) setScale(Math.min(1, w / SHEET_W));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  return { ref, scale };
}

export function CustomerViewLive({ view }: { view: CustomerView }) {
  const { tiers, skus, serviceFees, freightLines, quote, vendor, customer } = view;
  const { ref, scale } = useFitScale();

  const turnkey = view.detailLevel === "turnkey_only";
  const singleTier = view.pdfLayout === "single_tier";

  // Whether the tier total folds the fees is the PROJECTION's decision, not
  // this renderer's. Deriving it from the layout here made the HTML print a
  // goods-only total where the PDF printed the all-in one.
  const hasCharges = view.foldFeesIntoTotal;

  // Freight-specific copy renders from freight lines actually in the model,
  // never from `hasCharges` — the Proof-5 repair. A service fee satisfies
  // `hasCharges`, and gating freight prose on it told the customer freight was
  // billed separately at cost when there was no freight line at all.
  const hasSeparateFreight = freightLines.length > 0;
  const allInUnit = !hasCharges;

  // Deliberately the PDF's exact predicate — any SKU with a null price at any
  // tier, including tiers this layout does not show. Scoping it to the shown
  // columns is arguably more correct (the footnote would then explain a mark
  // the reader can actually see), but parity is the requirement here and a
  // transcription pass is not where that argument gets settled.
  const hasUnpriced = skus.some((s) => s.tierPrices.some((p) => p === null));

  const shown =
    singleTier && view.recommendedTierIdx !== null
      ? [view.recommendedTierIdx]
      : tiers.map((_, i) => i);

  /**
   * "Tier 2" — derived positionally, exactly as the PDF adapter derives it.
   * Two sentences on one page naming the recommended tier must not be able to
   * disagree, and the way to guarantee that is one derivation.
   */
  const fullLabel = (idx: number) => `Tier ${idx + 1}`;
  const recommendedFull =
    view.recommendedTierIdx !== null ? fullLabel(view.recommendedTierIdx) : null;

  const eyebrow = singleTier ? "Confirmed pricing" : "Tiered pricing";
  const h2 =
    singleTier && shown.length === 1
      ? `Per-unit pricing · ${fullLabel(shown[0])}`
      : "Per-unit pricing across volume tiers";
  const showRecommendedNote =
    !singleTier && !hasUnpriced && recommendedFull !== null;

  const feeBasis = view.feeBasisTierIdx;
  const basisTier = tiers[feeBasis];
  const feesVaryByTier = serviceFees.some((f) =>
    f.tierAmounts.some((a) => a !== f.tierAmounts[feeBasis]),
  );

  const termsTight = hasCharges || (turnkey && hasUnpriced);

  const cols = shown.map((ti) => ({
    ti,
    tier: tiers[ti],
    rec: !singleTier && view.recommendedTierIdx === ti,
  }));

  return (
    <div className="pp-fit" ref={ref}>
      <div
        className="pp-fit-inner"
        style={{ zoom: scale }}
      >
        <article className="pp-sheet" data-testid="customer-view-live">
          <div className="pp-flow">
            {/* ── Masthead ─────────────────────────────────────────── */}
            <div className="pp-masthead">
              <div className="v-id">
                <div className="v-name">{vendor.name}</div>
                {vendor.sub && <div className="v-sub">{vendor.sub}</div>}
              </div>
              <div className="v-meta">
                {/* Absence is rendered as absence. No invented number or date. */}
                {quote.quoteNumber && (
                  <span className="qnum">{quote.quoteNumber}</span>
                )}
                {quote.sentDate && (
                  <div>
                    <strong>Issued</strong> · {longDate(quote.sentDate)}
                  </div>
                )}
                {quote.validUntil && (
                  <div>
                    <strong>Valid until</strong> · {longDate(quote.validUntil)}
                  </div>
                )}
              </div>
            </div>

            {/* ── Parties ──────────────────────────────────────────── */}
            <div className="pp-parties">
              <div className="party">
                <div className="label">Prepared for</div>
                <div className="pname">{customer.name}</div>
                {(customer.contact || customer.role) && (
                  <div className="pline">
                    {[customer.contact, customer.role].filter(Boolean).join(" · ")}
                  </div>
                )}
                {customer.email && <div className="pline">{customer.email}</div>}
                {customer.address && <div className="pline">{customer.address}</div>}
              </div>
              <div className="party">
                <div className="label">Prepared by</div>
                <div className="pname">{vendor.name}</div>
                {view.preparedBy && (
                  <>
                    <div className="pline">{view.preparedBy.name}</div>
                    <div className="pline">
                      {[view.preparedBy.email, view.preparedBy.phone]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </>
                )}
                {vendor.address && <div className="pline">{vendor.address}</div>}
              </div>
            </div>

            {/* ── Pricing ──────────────────────────────────────────── */}
            <div className="pp-section">
              <div className="pp-eyebrow">{eyebrow}</div>
              <div className="pp-h2">{h2}</div>
              <p className="pp-lede">
                Pricing per the terms below across volume tiers.
                {hasSeparateFreight &&
                  " Outbound freight is billed separately at cost."}
                {hasCharges && " One-time charges are itemized below."}
                {hasUnpriced &&
                  " One or more items are pending finalization — a quote is available on request once sourcing is locked."}
                {showRecommendedNote &&
                  ` ${recommendedFull} is recommended for first-PO production runs.`}
                {singleTier &&
                  !hasUnpriced &&
                  " Full volume tier-pricing available on request."}
              </p>

              <div className="pp-table" role="table" aria-label="Pricing">
                <div className="pp-thead" role="row">
                  <div className="pp-c-prod" role="columnheader">
                    <div className="pp-th-lab">Product</div>
                  </div>
                  {cols.map(({ ti, tier, rec }) => (
                    <div
                      key={tier.id}
                      role="columnheader"
                      className={"pp-c-num" + (rec ? " pp-c-rec" : "")}
                    >
                      <div className="pp-th-lab">
                        {rec ? (
                          <span className="pp-th-rec">
                            <span className="star">★</span>
                            {tier.label}
                          </span>
                        ) : (
                          <span>{tier.label}</span>
                        )}
                      </div>
                      <div className="pp-th-sub">
                        <span>
                          {qtyLabel(tier.quantity)}
                          {view.recommendedTierIdx === ti ? (
                            <span className="rec-word"> · recommended</span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {!turnkey && (
                  <div className="pp-tbody" role="rowgroup">
                    {skus.map((s) => (
                      <div key={s.label} className="pp-tr" role="row">
                        <div className="pp-c-prod" role="rowheader">
                          <div className="pp-prod-name">{s.name}</div>
                          <div className="pp-prod-meta">
                            <span className="code">{s.label}</span>
                            {/* Suppressed entirely when null — never a placeholder. */}
                            {s.pack ? ` · ${s.pack}` : ""}
                          </div>
                        </div>
                        {cols.map(({ ti, tier, rec }) => {
                          const price = s.tierPrices[ti];
                          const line = s.tierLineTotals[ti];
                          return (
                            <div
                              key={tier.id}
                              role="cell"
                              className={"pp-c-num" + (rec ? " pp-c-rec" : "")}
                            >
                              {price === null ? (
                                // The PDF's wording, verbatim. This said "on
                                // request" and the PDF says "quote on request"
                                // — the same state described two ways to the
                                // customer, which is a content difference, not
                                // a styling one.
                                <span className="pp-price req">
                                  quote on request
                                </span>
                              ) : (
                                <>
                                  <span className="pp-price">{unit(price)}</span>
                                  {line !== null && (
                                    <div className="pp-linetotal">{money(line)}</div>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── What the turnkey total is made of ───────────────
                  Native rows of the pricing table, in tier-column geometry, so
                  each figure sits under its own tier and reads as part of the
                  quote rather than as an annotation on it.

                  ORDER IS THE COMMERCIAL STATEMENT. The two components come
                  first and the turnkey total closes beneath them, because it
                  is the final result and the strongest row. Sitting above its
                  own components -- as it did -- made the total read as the
                  headline and the parts as a footnote explaining it.

                  Subordinate, not diagnostic: same families and alignment as
                  the product rows, one step quieter in weight and colour. The
                  uppercase mono micro-caps this replaced were an engineering
                  register on a customer document.

                  There is NO recovery line here. What portion of the unit price
                  recovers a one-time charge is how DPS builds a price, not
                  something the client is party to; it stays in the projection
                  for the operator-facing reconciliation and is not rendered.

                  Shown only when charges exist. With none, the subtotal equals
                  the total and the separate row is zero -- two rows that state
                  nothing. */}
              {hasCharges && (
                <div className="pp-components" data-testid="cvl-components">
                  {/* A tier whose total reads "total on request" has no known
                      subtotal either. Printing $0.00 there would tell the
                      customer the goods cost nothing, which is the opposite of
                      "not yet priced" (OD-005). The em dash is this document's
                      existing mark for a fact it does not have. */}
                  <div className="pp-component-row" role="row">
                    <div className="pp-c-prod" role="rowheader">
                      <span className="pp-component-k">Unit-price subtotal</span>
                    </div>
                    {cols.map(({ ti, tier, rec }) => (
                      <div
                        key={tier.id}
                        role="cell"
                        className={"pp-c-num" + (rec ? " pp-c-rec" : "")}
                      >
                        <span className="pp-component-num">
                          {tiers[ti].money.perUnitTurnkey === null
                            ? "—"
                            : money(tiers[ti].money.goodsTotal)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="pp-component-row" role="row">
                    <div className="pp-c-prod" role="rowheader">
                      <span className="pp-component-k">One-time fees</span>
                    </div>
                    {cols.map(({ ti, tier, rec }) => (
                      <div
                        key={tier.id}
                        role="cell"
                        className={"pp-c-num" + (rec ? " pp-c-rec" : "")}
                      >
                        <span className="pp-component-num">
                          {tiers[ti].money.perUnitTurnkey === null
                            ? "—"
                            : money(tiers[ti].money.feesTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Turnkey total ─────────────────────────────────── */}
              <div className="pp-grand" role="row">
                <div className="pp-c-prod" role="rowheader">
                  <div className="g-label">Turnkey total</div>
                  <div className="g-sub">all-in for this tier&rsquo;s order</div>
                </div>
                {cols.map(({ ti, tier, rec }) => {
                  const m = tiers[ti].money;
                  // Selection, not construction: which composed figure this
                  // shape shows. Both were summed once, upstream.
                  const total = hasCharges ? m.turnkeyTotal : m.goodsTotal;
                  const per = hasCharges ? m.perUnitTurnkey : m.perUnitGoods;
                  return (
                    <div
                      key={tier.id}
                      role="cell"
                      className={"pp-c-num" + (rec ? " pp-c-rec" : "")}
                    >
                      {per === null ? (
                        <span className="pp-grand-num">total on request</span>
                      ) : (
                        <>
                          <span className="pp-grand-num">
                            {m.hasUnpricedLine && (
                              <span className="from">from </span>
                            )}
                            {money(total)}
                          </span>
                          <div className="pp-grand-unit">
                            {m.hasUnpricedLine ? "from " : ""}
                            {unit(per)}
                            <span className="per"> /unit</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ALL-IN and PLUS only. The PER UNIT / INCLUDES / FROM legends
                  were removed from the artifact 2026-08-20 as reading
                  instructions rather than commercial statements; these two
                  remain because they are inclusion and exclusion disclosures
                  the customer relies on. */}
              {(allInUnit || hasSeparateFreight) && (
                <div className="pp-grand-notes">
                  {allInUnit && (
                    <div className="pp-grand-note">
                      <span className="k">All-in</span>
                      Setup, tooling, freight, duty &amp; tariffs are landed in
                      the unit price shown — the total is what you pay.
                    </div>
                  )}
                  {hasSeparateFreight && (
                    <div className="pp-grand-note freight">
                      <span className="k">Plus</span>
                      Outbound freight — billed separately at cost (itemized
                      below); not included in the turnkey total.
                    </div>
                  )}
                </div>
              )}

              <div className="pp-table-foot">
                {recommendedFull !== null && (
                  <span>{`★ ${recommendedFull} is our recommended first-PO tier.`}</span>
                )}
                {/* Gate A recorded this sentence as a bounded content-fidelity
                    item: present in the artifact of record, absent here. */}
                {hasUnpriced && (
                  <span>
                    quote on request — pricing finalizes once the noted
                    milestone clears.
                  </span>
                )}
              </div>
            </div>

            {/* ── Additional charges ───────────────────────────────── */}
            {hasCharges && (
              <div className="pp-section">
                <div className="pp-charges">
                  <div className="pp-eyebrow">Additional charges</div>
                  <div className="pp-h2">
                    One-time fees
                    {hasSeparateFreight ? " & pass-through freight" : ""}
                  </div>
                  {hasSeparateFreight && basisTier && (
                    <div className="pp-charge-sub">
                      Freight amounts shown landed per unit for{" "}
                      {fullLabel(feeBasis)} ({qtyLabel(basisTier.quantity)}).
                      Per-tier amounts available on request.
                    </div>
                  )}

                  {/* ── C1 · collapsing the itemization never removes the
                      charge ────────────────────────────────────────────────
                      `includeFeeLines = false` hides the LINES and keeps the
                      money stated: the total is still disclosed, still inside
                      the turnkey figure, and still described in words. "Hide
                      the fee lines" and "omit the fees" are one edit apart and
                      the second is a quote that charges for something it does
                      not mention. */}
                  {!view.includeFeeLines && basisTier && (
                    <div className="pp-charge-sub" data-testid="cvl-fee-fold">
                      One-time fees of {money(basisTier.money.feesTotal)} are
                      included in the totals above — itemization available on
                      request.
                    </div>
                  )}

                  {view.includeFeeLines && serviceFees.length > 0 && (
                    <>
                      <div className="pp-charge-group-label">
                        Project &amp; SKU fees · one-time
                      </div>
                      {feesVaryByTier && basisTier && (
                        <div className="pp-charge-sub">
                          Fees shown for {fullLabel(feeBasis)} (
                          {qtyLabel(basisTier.quantity)}). Per-tier amounts
                          available on request.
                        </div>
                      )}
                      {serviceFees.map((f) => {
                        // The projection decides which column is quoted.
                        // Reading `shown[0]` here was a second renderer making
                        // the same presentation decision independently, and it
                        // disagreed.
                        const amount = f.tierAmounts[feeBasis];
                        // A fee not billed at this tier is not shown as zero.
                        if (amount === null || amount === undefined) return null;
                        return (
                          <div key={f.id} className="pp-charge-row">
                            <div className="c-label">
                              <span className="t">{f.label}</span>
                              <span className="s">{f.sub}</span>
                            </div>
                            <div className="c-qty">{f.qtyLabel}</div>
                            <div className="c-amt">{money(amount)}</div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {view.includeFeeLines && hasSeparateFreight && (
                    <>
                      <div className="pp-charge-group-label">
                        Pass-through freight · billed at cost
                      </div>
                      {freightLines.map((fl) => {
                        const a = fl.tierAmounts[feeBasis];
                        if (a === null || a === undefined) return null;
                        return (
                          <div key={fl.id} className="pp-charge-row">
                            <div className="c-label">
                              <span className="t">{fl.label}</span>
                              <span className="s">{fl.sub}</span>
                            </div>
                            <div className="c-qty">{fl.qtyLabel}</div>
                            <div className="c-amt">
                              {unit(a)}
                              <span className="per">/unit</span>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Terms, notes, T&Cs, acceptance ───────────────────── */}
            <div className={"pp-section" + (termsTight ? " tight" : "")}>
              {hasCharges && !turnkey && (
                <>
                  <div className="pp-eyebrow">Commercial terms</div>
                  <div className="pp-h2">Terms &amp; acceptance</div>
                </>
              )}

              {view.includeTerms && (
              <div className="pp-terms">
                <div className="pp-term">
                  <div className="label">Valid until</div>
                  <div className="value">{longDate(quote.validUntil)}</div>
                </div>
                <div className="pp-term">
                  <div className="label">Payment terms</div>
                  <div className="value">{quote.paymentTerms ?? "—"}</div>
                </div>
                <div className="pp-term">
                  <div className="label">Lead time</div>
                  <div className="value">{quote.leadTime ?? "—"}</div>
                </div>
                <div className="pp-term">
                  <div className="label">Incoterms</div>
                  <div className="value">{quote.incoterms ?? "—"}</div>
                </div>
              </div>
              )}

              {view.includeNote && quote.customerFacingNotes && (
                <div className="pp-notes">
                  <div className="label">Notes</div>
                  <p>{quote.customerFacingNotes}</p>
                </div>
              )}

              {/* Under its own heading, matching the PDF. Without it the
                  customer reads the clause as a continuation of the notes
                  above, and the two documents carry different labels for the
                  same content. */}
              {quote.tcs && (
                <div className="pp-notes">
                  <div className="label">Terms &amp; conditions</div>
                  <p>{quote.tcs}</p>
                </div>
              )}

              <div className="pp-accept">
                <div className="pp-h3">How to accept</div>
                <p>
                  Reply to this quote with the tier and quantity you&rsquo;d like
                  to proceed on. We&rsquo;ll issue a PO confirmation and
                  production schedule within 2 business days of acceptance.
                </p>
              </div>
            </div>
          </div>

          {/* Canon pins this to the bottom of a PAGE, modelling react-pdf's
              `fixed` (Pattern 49). A continuous preview has no pages to pin
              to: absolutely positioned at `bottom: 30px` of a one-page box, it
              landed in the MIDDLE of the document, printed across the terms
              grid. It sits in flow at the end instead — see the fit sheet.

              And no page count. The PDF paginates; this does not, so "Page 1
              of 1" would be this renderer asserting something it cannot know
              and that is usually false. The identifying line stays; the claim
              goes. Rendering the absence rather than inventing the figure is
              the same rule that governs every price on this page. */}
          <div className="pp-footer">
            <div className="l">
              <strong>{vendor.name}</strong>
              {quote.quoteNumber ? ` · ${quote.quoteNumber}` : ""}
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
