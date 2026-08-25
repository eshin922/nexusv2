"use client";

import type { CustomerView } from "@/types/quote";
import { extendedAmount, unitPrice } from "@/lib/money-display";

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
 * ── PARITY BEFORE POLISH ─────────────────────────────────────────────────
 *
 * This first pass targets SEMANTIC parity: the same tiers, quantities, unit
 * prices, extended amounts, totals, fee lines, labels, terms and presentation
 * state, in the same order, saying the same things. Its geometry is
 * deliberately plain and is NOT yet reconciled to the registered Customer View
 * authority — that comes once parity is proven, so a geometry difference can
 * never be mistaken for a content difference while the evidence is gathered.
 */

const money = extendedAmount;
const unit = unitPrice;

/** Tier quantity as the document says it: "1k units", "10k units". */
function qtyLabel(n: number): string {
  return n >= 1000 && n % 1000 === 0 ? `${n / 1000}k units` : `${n} units`;
}

export function CustomerViewLive({ view }: { view: CustomerView }) {
  const { tiers, skus, serviceFees, quote, vendor, customer } = view;
  const turnkey = view.detailLevel === "turnkey_only";
  const singleTier = view.pdfLayout === "single_tier";
  const shown =
    singleTier && view.recommendedTierIdx !== null
      ? [view.recommendedTierIdx]
      : tiers.map((_, i) => i);

  return (
    <article className="cvl" data-testid="customer-view-live">
      <header className="cvl-masthead">
        <div className="cvl-vendor">{vendor.name}</div>
        {vendor.sub && <div className="cvl-tagline">{vendor.sub}</div>}
        <div className="cvl-meta">
          {quote.projectTitle && <span>{quote.projectTitle}</span>}
          {/* Absence is rendered as absence. No invented date. */}
          {quote.sentDate && <span>Issued · {quote.sentDate}</span>}
          <span>Valid until · {quote.validUntil ?? "—"}</span>
        </div>
      </header>

      <section className="cvl-parties">
        <div>
          <div className="cvl-eyebrow">Prepared for</div>
          <div>{customer.name}</div>
        </div>
        {view.preparedBy && (
          <div>
            <div className="cvl-eyebrow">Prepared by</div>
            <div>{vendor.name}</div>
            <div>{view.preparedBy.name}</div>
            {view.preparedBy.email && <div>{view.preparedBy.email}</div>}
          </div>
        )}
      </section>

      <section className="cvl-pricing">
        <div className="cvl-eyebrow">
          {turnkey ? "Turnkey pricing · all-in" : "Tiered pricing"}
        </div>
        <h2>
          {turnkey ? "Turnkey total by volume tier" : "Per-unit pricing across volume tiers"}
        </h2>

        <table className="cvl-table">
          <thead>
            <tr>
              <th scope="col">Product</th>
              {shown.map((ti) => (
                <th key={tiers[ti].id} scope="col">
                  <div>{tiers[ti].label}</div>
                  <div className="cvl-sub">{qtyLabel(tiers[ti].quantity)}</div>
                  {view.recommendedTierIdx === ti && (
                    <div className="cvl-rec">recommended</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!turnkey &&
              skus.map((s) => (
                <tr key={s.label}>
                  <th scope="row">
                    <div>{s.name}</div>
                    <div className="cvl-sub">{s.label}</div>
                    {/* Suppressed entirely when null — never a placeholder. */}
                    {s.pack && <div className="cvl-sub">{s.pack}</div>}
                  </th>
                  {shown.map((ti) => {
                    const price = s.tierPrices[ti];
                    const line = s.tierLineTotals[ti];
                    return (
                      <td key={tiers[ti].id}>
                        {price === null ? (
                          <span className="cvl-onrequest">on request</span>
                        ) : (
                          <>
                            <div>{unit(price)}</div>
                            <div className="cvl-sub">{money(line)}</div>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            <tr className="cvl-total">
              <th scope="row">
                {turnkey ? "Turnkey total" : "Turnkey total"}
                <div className="cvl-sub">all-in for this tier&apos;s order</div>
              </th>
              {shown.map((ti) => {
                const m = tiers[ti].money;
                // Selection, not construction: which composed figure this shape
                // shows. Both were summed once, upstream.
                const total = turnkey ? m.turnkeyTotal : m.goodsTotal;
                const per = turnkey ? m.perUnitTurnkey : m.perUnitGoods;
                return (
                  <td key={tiers[ti].id}>
                    {per === null ? (
                      <span className="cvl-onrequest">total on request</span>
                    ) : (
                      <>
                        <div className="cvl-strong">{money(total)}</div>
                        <div className="cvl-sub">
                          {m.hasUnpricedLine ? "from " : ""}
                          {unit(per)} /unit
                        </div>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </section>

      {serviceFees.length > 0 && (
        <section className="cvl-fees">
          <div className="cvl-eyebrow">Additional charges</div>
          <h2>One-time fees</h2>
          <dl>
            {serviceFees.map((f) => {
              const basis = shown[0];
              const amount = f.tierAmounts[basis];
              // A fee not billed at this tier is not shown as zero.
              if (amount === null) return null;
              return (
                <div key={f.id} className="cvl-fee">
                  <dt>
                    <div>{f.label}</div>
                    <div className="cvl-sub">{f.sub}</div>
                  </dt>
                  <dd className="cvl-qty">{f.qtyLabel}</dd>
                  <dd className="cvl-amt">{money(amount)}</dd>
                </div>
              );
            })}
          </dl>
        </section>
      )}

      <section className="cvl-terms">
        <div className="cvl-eyebrow">Commercial terms</div>
        <h2>Terms &amp; acceptance</h2>
        <dl className="cvl-termgrid">
          <div>
            <dt className="cvl-eyebrow">Valid until</dt>
            <dd>{quote.validUntil ?? "—"}</dd>
          </div>
          <div>
            <dt className="cvl-eyebrow">Payment terms</dt>
            <dd>{quote.paymentTerms ?? "—"}</dd>
          </div>
          <div>
            <dt className="cvl-eyebrow">Lead time</dt>
            <dd>{quote.leadTime ?? "—"}</dd>
          </div>
          <div>
            <dt className="cvl-eyebrow">Incoterms</dt>
            <dd>{quote.incoterms ?? "—"}</dd>
          </div>
        </dl>
        {quote.customerFacingNotes && (
          <p className="cvl-notes">{quote.customerFacingNotes}</p>
        )}
        {quote.tcs && <p className="cvl-tcs">{quote.tcs}</p>}
      </section>
    </article>
  );
}
