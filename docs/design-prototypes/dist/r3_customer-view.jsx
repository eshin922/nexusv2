/* global React, NXR3 */
// Round 3 — Customer view (PDF preview)
// Three states: pure / passThrough / partial

const { Fragment } = React;

function fmtCurrency(n, opts = {}) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const fixed = abs >= 100 ? n.toFixed(0) : n.toFixed(2);
  return (opts.symbol === false ? "" : "$") + Number(fixed).toLocaleString("en-US", {
    minimumFractionDigits: abs >= 100 ? 0 : 2,
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  });
}

function fmtQty(n) {
  if (n >= 1000) return `${(n/1000).toFixed(0)}k`;
  return n.toLocaleString("en-US");
}

function PdfHeader({ vendor, quote, customer }) {
  return (
    <div>
      <div className="pdf-header">
        <div>
          <div className="vendor">{vendor.name}</div>
          <div className="vendor-sub">{vendor.sub}</div>
        </div>
        <div className="doc-meta">
          <div><strong>Quotation</strong> · {quote.quote_number}</div>
          <div>Issued · {new Date(quote.sent_date).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</div>
          <div>Valid until · {new Date(quote.valid_until).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
      </div>
      <div className="pdf-customer">
        <div>
          <div className="label">Prepared for</div>
          <div className="name">{customer.name}</div>
          <div className="sub">{customer.contact} · {customer.role}</div>
          <div className="sub">{customer.address}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="label">Prepared by</div>
          <div className="name">{vendor.name}</div>
          <div className="sub">{vendor.contact}</div>
          <div className="sub">{vendor.address}</div>
        </div>
      </div>
    </div>
  );
}

function PdfTerms({ quote, includeIncoterms }) {
  return (
    <div className="pdf-terms">
      <div className="row">
        <div className="label">Valid until</div>
        <div className="value mono">{new Date(quote.valid_until).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
      <div className="row">
        <div className="label">Payment terms</div>
        <div className="value">{quote.payment_terms}</div>
      </div>
      <div className="row">
        <div className="label">Lead time</div>
        <div className="value">{quote.lead_time}</div>
      </div>
      {includeIncoterms && (
        <div className="row">
          <div className="label">Incoterms</div>
          <div className="value">{quote.incoterms}</div>
        </div>
      )}
    </div>
  );
}

function PdfNotes({ notes }) {
  if (!notes) return null;
  return (
    <div className="pdf-notes">
      <div className="label">Notes</div>
      <p>{notes}</p>
    </div>
  );
}

function PdfFooter({ quote, vendor, page = 1, pages = 1 }) {
  return (
    <div className="pdf-footer">
      <div>{vendor.name} · {quote.quote_number}</div>
      <div>Page {page} of {pages}</div>
    </div>
  );
}

// ─── Pure tier-pricing table (the "room") ────────────────
// Renders a wide multi-SKU pricing table where tiers are columns.
// This is the customer's "room organizer" — what the eye lands on first.
function PdfPricingTable({ tiers, skus, recommendedTierIdx, pdfLayout }) {
  const cols = pdfLayout === "single_tier" ? [tiers[recommendedTierIdx]] : tiers;
  const colIdx = (i) => pdfLayout === "single_tier" ? recommendedTierIdx : i;
  return (
    <table className="pdf-pricing">
      <thead>
        <tr>
          <th>Product</th>
          {cols.map((t, i) => (
            <th key={t.id}>
              {pdfLayout === "single_tier" ? "Unit price" : t.label}
              <div style={{ fontSize: 9, fontWeight: 400, color: "oklch(0.55 0.02 255)", marginTop: 2, letterSpacing: "0.04em" }}>
                {fmtQty(t.quantity)} units{pdfLayout === "single_tier" ? " · recommended" : ""}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {skus.map(sku => {
          const isFlat = sku.shape === "flat";
          return (
            <tr key={sku.id}>
              <td>
                <div style={{ fontWeight: 500 }}>{sku.name}</div>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "oklch(0.50 0.02 255)", letterSpacing: "0.04em", marginTop: 2 }}>
                  {sku.pack}
                </div>
              </td>
              {cols.map((_, ii) => {
                const i = colIdx(ii);
                const p = sku.tier_prices[i];
                if (p == null) {
                  return <td key={ii} className="unpriced">quote on request</td>;
                }
                if (isFlat && i > 0 && pdfLayout !== "single_tier") {
                  return <td key={ii} style={{ color: "oklch(0.55 0.02 255)" }}>—</td>;
                }
                if (isFlat && i === 0 && pdfLayout !== "single_tier") {
                  return <td key={ii} colSpan={1}>
                    <div>${p.toFixed(2)}<span style={{ fontSize: 10, color: "oklch(0.50 0.02 255)", marginLeft: 6, fontStyle: "italic", fontFamily: "Newsreader, serif" }}>flat across all tiers</span></div>
                  </td>;
                }
                return <td key={ii}>${p.toFixed(2)}</td>;
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Charges block (one-time fees + pass-through freight) ────
function PdfChargesBlock({ service_fees, freight_lines, recommendedTierIdx, tiers }) {
  const tier = tiers[recommendedTierIdx];
  const tierLabel = tier ? `${tier.label} (${fmtQty(tier.quantity)} units)` : "";
  const hasFees = service_fees && service_fees.length > 0;
  const hasFreight = freight_lines && freight_lines.length > 0;
  if (!hasFees && !hasFreight) return null;

  return (
    <div className="pdf-charges">
      <h3 className="pdf-h3">Additional charges</h3>
      <p style={{ fontSize: 11.5, color: "oklch(0.45 0.015 255)", margin: "0 0 10px", fontStyle: "italic" }}>
        Charges shown for {tierLabel}. Per-tier amounts available on request.
      </p>
      {hasFees && service_fees.map(sf => (
        <div className="pdf-charge-row" key={sf.id}>
          <div className="label">
            {sf.label}
            <span className="sub">{sf.sub}</span>
          </div>
          <div className="qty">{sf.qty_label}</div>
          <div className="amount">{fmtCurrency(sf.amount)}</div>
        </div>
      ))}
      {hasFreight && freight_lines.map(fl => (
        <div className="pdf-charge-row" key={fl.id}>
          <div className="label">
            {fl.label}
            <span className="sub">{fl.sub}</span>
          </div>
          <div className="qty">{fl.qty_label}</div>
          <div className="amount">
            {fmtCurrency(fl.tier_amounts[recommendedTierIdx])}<span style={{ fontSize: 10, color: "oklch(0.55 0.015 255)", marginLeft: 4 }}>/unit</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── The PDF page wrapper ────────────────────────────────
function PdfPage({ children, footer }) {
  return (
    <div className="pdf-page">
      {children}
      {footer}
    </div>
  );
}

// ─── State A: Pure tier-pricing ──────────────────────────
function CustomerViewPure({ pdfLayout = "tier_table" }) {
  const { vendor, customer, quote, tiers, skus } = NXR3;
  const cleanSkus = skus.filter(s => s.shape !== "partial");
  const isSingle = pdfLayout === "single_tier";
  return (
    <div>
      <PdfPage footer={<PdfFooter quote={quote} vendor={vendor} page={1} pages={1} />}>
        <PdfHeader vendor={vendor} quote={quote} customer={customer} />
        <p className="pdf-eyebrow" style={{ marginTop: 28 }}>{isSingle ? "Confirmed pricing" : "Tiered pricing"}</p>
        <h2 className="pdf-h2" style={{ marginTop: 0 }}>{isSingle ? "Per-unit pricing — Tier 2 (25,000 units)" : "Per-unit pricing across volume tiers"}</h2>
        <p style={{ margin: "0 0 18px", maxWidth: "60ch" }}>
          Pricing landed FOB Long Beach. Container freight, duty, and applicable tariffs included in the unit price shown.{isSingle ? " Volume tier-pricing available on request." : " Tier 2 is recommended for first-PO production runs."}
        </p>
        <PdfPricingTable tiers={tiers} skus={cleanSkus} recommendedTierIdx={1} pdfLayout={pdfLayout} />
        <PdfTerms quote={quote} />
        <PdfNotes notes={quote.customer_facing_notes} />
      </PdfPage>
    </div>
  );
}

// ─── State B: Pass-through freight + visible service fees ──
function CustomerViewPassThrough({ pdfLayout = "tier_table" }) {
  const { vendor, customer, quote, tiers, skus, service_fees, freight_lines } = NXR3;
  const cleanSkus = skus.filter(s => s.shape !== "partial");
  return (
    <div>
      <PdfPage footer={<PdfFooter quote={quote} vendor={vendor} page={1} pages={2} />}>
        <PdfHeader vendor={vendor} quote={quote} customer={customer} />
        <p className="pdf-eyebrow" style={{ marginTop: 28 }}>Tiered pricing</p>
        <h2 className="pdf-h2" style={{ marginTop: 0 }}>Per-unit pricing across volume tiers</h2>
        <p style={{ margin: "0 0 18px", maxWidth: "60ch" }}>
          Pricing landed EXW Long Beach. Outbound freight billed separately at cost; one-time charges itemized below. See terms for details.
        </p>
        <PdfPricingTable tiers={tiers} skus={cleanSkus} recommendedTierIdx={1} pdfLayout={pdfLayout} />
        <PdfChargesBlock service_fees={service_fees} freight_lines={freight_lines} recommendedTierIdx={1} tiers={tiers} />
      </PdfPage>
      <div className="page-break-marker">page break · 1 of 2</div>
      <PdfPage footer={<PdfFooter quote={quote} vendor={vendor} page={2} pages={2} />}>
        <p className="pdf-eyebrow">Terms & notes</p>
        <h2 className="pdf-h2" style={{ marginTop: 0 }}>Commercial terms</h2>
        <PdfTerms quote={quote} includeIncoterms />
        <PdfNotes notes={quote.customer_facing_notes} />
        <div style={{ marginTop: 28 }}>
          <h3 className="pdf-h3">How to accept</h3>
          <p>Reply to this email with the tier and quantity you'd like to proceed on. We'll issue a PO confirmation and production schedule within 2 business days.</p>
        </div>
      </PdfPage>
    </div>
  );
}

// ─── State C: Mixed-completeness (partial-tier) ──────────
function CustomerViewPartial({ pdfLayout = "tier_table" }) {
  const { vendor, customer, quote, tiers, skus } = NXR3;
  return (
    <div>
      <PdfPage footer={<PdfFooter quote={quote} vendor={vendor} page={1} pages={1} />}>
        <PdfHeader vendor={vendor} quote={quote} customer={customer} />
        <p className="pdf-eyebrow" style={{ marginTop: 28 }}>Tiered pricing</p>
        <h2 className="pdf-h2" style={{ marginTop: 0 }}>Per-unit pricing across volume tiers</h2>
        <p style={{ margin: "0 0 18px", maxWidth: "60ch" }}>
          Pricing landed FOB Long Beach. Glow Capsule (CAP-60) Tier 1 pricing pending finalization of the formulation R&D milestone — quote available on request once raw-ingredient sourcing is locked.
        </p>
        <PdfPricingTable tiers={tiers} skus={skus} recommendedTierIdx={1} pdfLayout={pdfLayout} />
        <PdfTerms quote={quote} />
        <PdfNotes notes={quote.customer_facing_notes} />
      </PdfPage>
    </div>
  );
}

// ─── State switcher within Customer view ─────────────────
function CustomerViewHost({ subState, setSubState, pdfLayout, setPdfLayout }) {
  const { quote } = NXR3;
  const Variant = ({
    pure: CustomerViewPure,
    passThrough: CustomerViewPassThrough,
    partial: CustomerViewPartial,
  })[subState] || CustomerViewPure;

  return (
    <div className="preview-chrome">
      <div className="preview-toolbar">
        <div className="left">
          <span className="ribbon">PM-internal preview · this becomes the PDF</span>
          <span className="meta">
            <strong>{quote.quote_number}</strong> · sent {new Date(quote.sent_date).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
          </span>
          <span className="meta" style={{ color: "var(--ink-4)" }}>·</span>
          <span className="meta" style={{ color: "var(--ink-3)", textTransform: "none", letterSpacing: 0 }}>
            Send as:&nbsp;
            <button
              onClick={() => setPdfLayout("tier_table")}
              style={{
                background: "transparent", border: "none", padding: "2px 6px", cursor: "pointer",
                fontFamily: "inherit", fontSize: "inherit",
                color: pdfLayout === "tier_table" ? "var(--ink)" : "var(--ink-4)",
                textDecoration: pdfLayout === "tier_table" ? "underline" : "none",
                textUnderlineOffset: 3,
              }}
            >tier table</button>
            <span style={{ color: "var(--ink-4)" }}>|</span>
            <button
              onClick={() => setPdfLayout("single_tier")}
              style={{
                background: "transparent", border: "none", padding: "2px 6px", cursor: "pointer",
                fontFamily: "inherit", fontSize: "inherit",
                color: pdfLayout === "single_tier" ? "var(--ink)" : "var(--ink-4)",
                textDecoration: pdfLayout === "single_tier" ? "underline" : "none",
                textUnderlineOffset: 3,
              }}
            >single tier</button>
          </span>
        </div>
        <div className="right">
          <div className="state-sub" title="Prototype navigation only — production renders whichever state the data is in.">
            <button className={subState === "pure" ? "active" : ""} onClick={() => setSubState("pure")}>① Pure tier-pricing</button>
            <button className={subState === "passThrough" ? "active" : ""} onClick={() => setSubState("passThrough")}>② Pass-through + fees</button>
            <button className={subState === "partial" ? "active" : ""} onClick={() => setSubState("partial")}>③ Partial completeness</button>
          </div>
          <button className="btn sm" title="Generates the PDF and saves to your Downloads. You attach it to your usual email.">⤓ Download PDF</button>
          <button className="btn sm primary" title="Generates the PDF, saves to Downloads, and opens a new email draft in your default mail client (mailto:) addressed to the customer with the quote attached. No SMTP integration — your email, your client.">↳ Download + open mail draft</button>
        </div>
      </div>

      <div className="dn-inline compact" style={{ maxWidth: 880, margin: "0 auto 18px" }}>
        <div className="dn-eyebrow">Boundary guard · customer view</div>
        <strong>Nothing below this line is in the customer's tree.</strong> Margin, markup, cost stack, supplier names, duty %, tariff %, CBM, version_number, scenario_label — all forbidden. The component tree for <code>{`<PdfPage>`}</code> imports zero costing primitives.
      </div>

      <Variant pdfLayout={pdfLayout} />
    </div>
  );
}

// Export
Object.assign(window, {
  CustomerViewHost,
  CustomerViewPure, CustomerViewPassThrough, CustomerViewPartial,
});
