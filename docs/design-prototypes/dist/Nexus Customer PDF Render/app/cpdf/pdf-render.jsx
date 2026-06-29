/* global React, NXCPDF */
// CD Commission — Customer-Facing PDF Render Layer  ·  + ADDENDUM 1
// The paged render of the locked customer-view tree (brief §1).
// Authored to react-pdf primitives (brief §3): flex-only composition,
// explicit page boxes, running header/footer as fixed elements, hard page splits.
// Addendum 1: per-line totals, a grand turnkey total, and an orthogonal
// detail_level (itemized | turnkey_only) crossing pdf_layout (tier_table | single_tier).
// Boundary guard (brief §1): this tree reads ONLY customer-visible fields;
// every total derives from sell prices (no cost/margin exposure).

const D = NXCPDF;
const SERVICE_FEES_TOTAL = D.service_fees.reduce((a, f) => a + f.amount, 0);

// ─── formatters ──────────────────────────────────────────
function money(n) {
  if (n == null) return "—";
  const dp = Math.abs(n) >= 100 ? 0 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function unit(n) { return n == null ? "—" : "$" + n.toFixed(2); }
function qtyK(n) { return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString("en-US"); }
function longDate(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// ─── totals (Addendum 1 — all sell-price derived) ────────
function lineTotal(price, ti) { return price == null ? null : price * D.tiers[ti].quantity; }
function tierGrand(skuSet, ti, foldFees) {
  let priced = 0, pricedCount = 0, hasUnpriced = false;
  skuSet.forEach(s => {
    const p = s.tier_prices[ti];
    if (p == null) hasUnpriced = true; else { priced += p * D.tiers[ti].quantity; pricedCount++; }
  });
  const total = priced + (foldFees ? SERVICE_FEES_TOTAL : 0);
  const units = pricedCount * D.tiers[ti].quantity;       // total units shipped at this tier
  const perUnit = units > 0 ? total / units : null;        // blended all-in per unit
  return { total, hasUnpriced, perUnit };
}

// ─── Masthead (first page only) ──────────────────────────
function Masthead({ vendor, quote }) {
  return (
    <div className="pp-masthead">
      <div className="v-id">
        <div className="v-name">{vendor.name}</div>
        <div className="v-sub">{vendor.sub}</div>
      </div>
      <div className="v-meta">
        <span className="qnum">{quote.quote_number}</span>
        <div><strong>Issued</strong> · {longDate(quote.issued_date)}</div>
        <div><strong>Valid until</strong> · {longDate(quote.valid_until)}</div>
      </div>
    </div>
  );
}

// ─── Parties (first page only) ───────────────────────────
function Parties({ vendor, customer }) {
  return (
    <div className="pp-parties">
      <div className="party">
        <div className="label">Prepared for</div>
        <div className="pname">{customer.name}</div>
        <div className="pline">{customer.contact} · {customer.role}</div>
        <div className="pline">{customer.email}</div>
        <div className="pline">{customer.address}</div>
      </div>
      <div className="party">
        <div className="label">Prepared by</div>
        <div className="pname">{vendor.name}</div>
        <div className="pline">{vendor.contact_name}</div>
        <div className="pline">{vendor.contact_email} · {vendor.contact_phone}</div>
        <div className="pline">{vendor.address}</div>
      </div>
    </div>
  );
}

// ─── Pricing table (flex; tier_table | single_tier; splittable) ──
// Each priced cell now stacks unit price over the extended line total (Addendum §1).
function PricingTable({ skus, layout, continued = false }) {
  const { tiers, recommendedTierIdx } = D;
  const isSingle = layout === "single_tier";
  const cols = isSingle ? [{ tier: tiers[recommendedTierIdx], ti: recommendedTierIdx }]
                        : tiers.map((t, i) => ({ tier: t, ti: i }));

  return (
    <div className="pp-table">
      {continued && (
        <div className="pp-eyebrow" style={{ marginBottom: 8 }}>Tiered pricing · continued — {D.quote.quote_number}</div>
      )}

      <div className={"pp-thead" + (continued ? " continued" : "")}>
        <div className="pp-c-prod"><div className="pp-th-lab">Product</div></div>
        {cols.map(({ tier }) => {
          const rec = tier.recommended;
          return (
            <div key={tier.id} className={"pp-c-num" + (!isSingle && rec ? " pp-c-rec" : "")}>
              <div className="pp-th-lab">
                {isSingle ? <span>Unit price</span>
                  : rec ? <span className="pp-th-rec"><span className="star">★</span>{tier.label}</span>
                  : <span>{tier.label}</span>}
              </div>
              <div className="pp-th-sub">
                {isSingle
                  ? <span>{tier.label} · {qtyK(tier.quantity)} units · <span className="rec-word">recommended</span></span>
                  : <span>{qtyK(tier.quantity)} units{rec ? <span className="rec-word"> · recommended</span> : null}</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="pp-tbody">
        {skus.map(sku => {
          const isFlat = sku.shape === "flat";
          return (
            <div key={sku.id} className="pp-tr">
              <div className="pp-c-prod">
                <div className="pp-prod-name">{sku.name}</div>
                <div className="pp-prod-meta"><span className="code">{sku.code}</span> · {sku.pack}</div>
                {isFlat && <div className="pp-prod-flat">Flat unit across all volume tiers</div>}
              </div>
              {cols.map(({ tier, ti }) => {
                const p = sku.tier_prices[ti];
                const rec = !isSingle && tier.recommended;
                const lt = lineTotal(p, ti);
                let unitNode;
                if (p == null) unitNode = <span className="pp-price req">quote on request</span>;
                else if (isFlat && !isSingle && ti !== 0) unitNode = <span className="pp-price dash">—</span>;
                else unitNode = <span className="pp-price">{unit(p)}</span>;
                return (
                  <div key={tier.id} className={"pp-c-num" + (rec ? " pp-c-rec" : "")}>
                    {unitNode}
                    {lt != null && <div className="pp-linetotal">{money(lt)}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Grand turnkey total (Addendum §2) ───────────────────
function GrandTotalRow({ skuSet, layout, foldFees, freightAtCost, allInUnit }) {
  const { tiers, recommendedTierIdx } = D;
  const isSingle = layout === "single_tier";
  const cols = isSingle ? [{ tier: tiers[recommendedTierIdx], ti: recommendedTierIdx }]
                        : tiers.map((t, i) => ({ tier: t, ti: i }));
  const colData = cols.map(({ tier, ti }) => ({ tier, ...tierGrand(skuSet, ti, foldFees), rec: !isSingle && tier.recommended }));
  const anyUnpriced = colData.some(c => c.hasUnpriced);

  return (
    <div>
      <div className="pp-grand">
        <div className="pp-c-prod">
          <div className="g-label">Turnkey total</div>
          <div className="g-sub">all-in for this tier’s order</div>
        </div>
        {colData.map(({ tier, total, hasUnpriced, perUnit, rec }) => (
          <div key={tier.id} className={"pp-c-num" + (rec ? " pp-c-rec" : "")}>
            {hasUnpriced
              ? <span className="pp-grand-num"><span className="from">from</span>{money(total)}</span>
              : <span className="pp-grand-num">{money(total)}</span>}
            {perUnit != null && <div className="pp-grand-unit">{hasUnpriced ? "from " : ""}{unit(perUnit)}<span className="per"> /unit</span></div>}
          </div>
        ))}
      </div>
      <div className="pp-grand-notes">
        <div className="pp-grand-note"><span className="k">Per&nbsp;unit</span>The blended all-in unit price across the basket at that tier — the turnkey total divided by units shipped.</div>
        {allInUnit && <div className="pp-grand-note"><span className="k">All-in</span>Setup, tooling, freight, duty &amp; tariffs are landed in the unit price shown — the total is what you pay.</div>}
        {foldFees && <div className="pp-grand-note"><span className="k">Includes</span>One-time project &amp; SKU fees of <span className="amt">{money(SERVICE_FEES_TOTAL)}</span>, folded into the total above and itemized below.</div>}
        {freightAtCost && <div className="pp-grand-note freight"><span className="k">Plus</span>Outbound freight — billed separately at cost (itemized below); not included in the turnkey total.</div>}
        {anyUnpriced && <div className="pp-grand-note"><span className="k">From</span>Totals exclude lines marked “quote on request” (CAP-60 · Tier 1); the final total issues once that line is priced.</div>}
      </div>
    </div>
  );
}

// ─── Turnkey-only summary (Addendum §3 — no SKU rows) ────
function TurnkeySummary({ skuSet, layout, foldFees, freightAtCost, allInUnit, partial, lede }) {
  const { tiers, recommendedTierIdx } = D;
  const isSingle = layout === "single_tier";

  const Included = (
    <div className="pp-tk-included">
      <div className="label">What this turnkey price includes</div>
      <div className="pp-tk-scope">
        Covers {skuSet.length} finished products — <span className="code">{skuSet.map(s => s.code).join(" · ")}</span>.
      </div>
      <div className="pp-tk-incl-list">
        {allInUnit && <div className="pp-tk-incl"><span className="tick">→</span>Container freight, duty &amp; applicable tariffs — landed in the price (FOB Long Beach).</div>}
        {allInUnit && <div className="pp-tk-incl"><span className="tick">→</span>Project setup &amp; tooling — included in the unit price.</div>}
        {foldFees && <div className="pp-tk-incl"><span className="tick">→</span>One-time project &amp; SKU fees ({money(SERVICE_FEES_TOTAL)}) — folded into the total.</div>}
        {freightAtCost && <div className="pp-tk-incl out"><span className="tick">×</span>Outbound freight — billed separately at cost (EXW); not in the turnkey figure.</div>}
        {partial && <div className="pp-tk-incl out"><span className="tick">×</span>CAP-60 · Tier 1 — quote on request; the total finalizes once that line is priced.</div>}
      </div>
    </div>
  );

  if (isSingle) {
    const { total, hasUnpriced, perUnit } = tierGrand(skuSet, recommendedTierIdx, foldFees);
    const t = tiers[recommendedTierIdx];
    return (
      <div className="pp-turnkey single">
        <div className="pp-eyebrow">Turnkey pricing · all-in</div>
        <div className="pp-h2">Your turnkey total</div>
        {lede && <p className="pp-lede">{lede}</p>}
        <div className="pp-tk-hero">
          <div className="h-meta">
            <div className="h-label">Recommended volume</div>
            <div className="h-tier"><span className="star">★</span> {t.full}</div>
            <div className="h-qty">{t.quantity.toLocaleString("en-US")} units</div>
          </div>
          {hasUnpriced ? <div className="h-num req">total on request</div> : <div className="h-num">{money(total)}</div>}
        </div>
        {perUnit != null && <div className="pp-tk-hero-unit">{unit(perUnit)} <span className="per">/ unit · blended all-in</span></div>}
        {Included}
      </div>
    );
  }

  return (
    <div className="pp-turnkey">
      <div className="pp-eyebrow">Turnkey pricing · all-in</div>
      <div className="pp-h2">Turnkey total by volume tier</div>
      {lede && <p className="pp-lede">{lede}</p>}
      <div className="pp-tk-cards">
        {tiers.map((t, ti) => {
          const { total, hasUnpriced, perUnit } = tierGrand(skuSet, ti, foldFees);
          return (
            <div key={t.id} className={"pp-tk-card" + (t.recommended ? " rec" : "")}>
              <div className="pp-tk-tier">{t.recommended && <span className="star">★</span>}{t.label}</div>
              <div className="pp-tk-qty">{qtyK(t.quantity)} units</div>
              {hasUnpriced ? <div className="pp-tk-total req">total on request</div> : <div className="pp-tk-total">{money(total)}</div>}
              {perUnit != null && <div className="pp-tk-perunit">{hasUnpriced ? "from " : ""}{unit(perUnit)} <span className="per">/unit</span></div>}
              {t.recommended && <div className="pp-tk-rec-word">recommended</div>}
            </div>
          );
        })}
      </div>
      {Included}
    </div>
  );
}

function PricingFoot({ partial = false }) {
  return (
    <div className="pp-table-foot">
      <span>Per-unit and extended pricing, in USD. ★ T2 is our recommended first-PO tier.</span>
      {partial && <span>quote on request — pricing finalizes once the noted milestone clears.</span>}
    </div>
  );
}

// ─── Charges block (one-time fees + pass-through freight) ──
function ChargesBlock({ tiers, recommendedTierIdx }) {
  const { service_fees, freight_lines } = D;
  const recTier = tiers[recommendedTierIdx];
  return (
    <div className="pp-charges">
      <div className="pp-eyebrow">Additional charges</div>
      <div className="pp-h2">One-time fees &amp; pass-through freight</div>
      <div className="pp-charge-sub">
        Freight amounts shown landed per unit for {recTier.full} ({qtyK(recTier.quantity)} units). Per-tier amounts available on request.
      </div>
      <div className="pp-charge-group-label">Project &amp; SKU fees · one-time</div>
      {service_fees.map(sf => (
        <div className="pp-charge-row" key={sf.id}>
          <div className="c-label"><span className="t">{sf.label}</span><span className="s">{sf.sub}</span></div>
          <div className="c-qty">{sf.qty_label}</div>
          <div className="c-amt">{money(sf.amount)}</div>
        </div>
      ))}
      <div className="pp-charge-group-label">Pass-through freight · billed at cost</div>
      {freight_lines.map(fl => (
        <div className="pp-charge-row" key={fl.id}>
          <div className="c-label"><span className="t">{fl.label}</span><span className="s">{fl.sub}</span></div>
          <div className="c-qty">{fl.qty_label}</div>
          <div className="c-amt">{unit(fl.tier_amounts[recommendedTierIdx])}<span className="per">/unit</span></div>
        </div>
      ))}
    </div>
  );
}

// ─── Commercial terms ────────────────────────────────────
function TermsBlock({ quote, incoterms }) {
  return (
    <div className="pp-terms">
      <div className="pp-term"><div className="label">Valid until</div><div className="value">{longDate(quote.valid_until)}</div></div>
      <div className="pp-term"><div className="label">Payment terms</div><div className="value">{quote.payment_terms}</div></div>
      <div className="pp-term"><div className="label">Lead time</div><div className="value">{quote.lead_time}</div></div>
      <div className="pp-term"><div className="label">Incoterms</div><div className="value">{incoterms}</div></div>
    </div>
  );
}

function NotesBlock({ notes }) {
  if (!notes) return null;
  return <div className="pp-notes"><div className="label">Notes</div><p>{notes}</p></div>;
}

function HowToAccept() {
  return (
    <div className="pp-accept">
      <div className="pp-h3">How to accept</div>
      <p>Reply to this quote with the tier and quantity you'd like to proceed on. We'll issue a PO confirmation and production schedule within 2 business days of acceptance.</p>
    </div>
  );
}

// ─── Running elements ────────────────────────────────────
function RunHead({ vendor, quote }) {
  return (
    <div className="pp-runhead">
      <div className="l"><strong>{vendor.name}</strong> · {quote.quote_number}</div>
      <div className="r">Quotation · continued</div>
    </div>
  );
}
function Footer({ vendor, quote, page, pages }) {
  return (
    <div className="pp-footer">
      <div className="l"><strong>{vendor.name}</strong> · {quote.quote_number}</div>
      <div className="r">Page {page} of {pages}</div>
    </div>
  );
}

// ─── Page wrapper ────────────────────────────────────────
function Sheet({ children, footer, runhead = null, continuation = false }) {
  return (
    <div className={"pp-sheet" + (continuation ? " continuation" : "")}>
      {runhead}
      <div className="pp-flow">{children}</div>
      {footer}
    </div>
  );
}

function Break({ label }) { return <div className="cpdf-break">{label}</div>; }

// ═══ State A · Pure tier-pricing (single page, both modes) ═══
function StatePure({ layout, detail }) {
  const { vendor, customer, quote, skuSets, skus, tiers, recommendedTierIdx } = D;
  const set = skuSets.pure.map(id => skus.find(s => s.id === id));
  const isSingle = layout === "single_tier";
  const turnkey = detail === "turnkey_only";
  return (
    <div className="cpdf-doc">
      <Sheet footer={<Footer vendor={vendor} quote={quote} page={1} pages={1} />}>
        <Masthead vendor={vendor} quote={quote} />
        <Parties vendor={vendor} customer={customer} />
        {turnkey ? (
          <div className="pp-section">
            <TurnkeySummary skuSet={set} layout={layout} foldFees={false} freightAtCost={false} allInUnit partial={false}
              lede="Pricing is landed and all-in — one number per volume tier, freight and duty included." />
          </div>
        ) : (
          <div className="pp-section">
            <div className="pp-eyebrow">{isSingle ? "Confirmed pricing" : "Tiered pricing"}</div>
            <div className="pp-h2">{isSingle ? `Per-unit pricing · ${tiers[recommendedTierIdx].full}` : "Per-unit pricing across volume tiers"}</div>
            <p className="pp-lede">
              Pricing landed <em>FOB Long Beach</em> — container freight, duty, and applicable tariffs are included in the unit price shown.
              {isSingle ? " Full volume tier-pricing available on request." : " Tier 2 is recommended for first-PO production runs."}
            </p>
            <PricingTable skus={set} layout={layout} />
            <GrandTotalRow skuSet={set} layout={layout} foldFees={false} freightAtCost={false} allInUnit />
            <PricingFoot />
          </div>
        )}
        <div className="pp-section">
          <TermsBlock quote={quote} incoterms={quote.incoterms_bundled} />
          <NotesBlock notes={quote.customer_facing_notes} />
          <HowToAccept />
        </div>
      </Sheet>
    </div>
  );
}

// ═══ State B · Pass-through freight + visible fees ═══════
function StatePassThrough({ layout, detail }) {
  const { vendor, customer, quote, skuSets, skus, tiers, recommendedTierIdx } = D;
  const set = skuSets.passThrough.map(id => skus.find(s => s.id === id));
  const turnkey = detail === "turnkey_only";

  if (turnkey) {
    // turnkey-only suppresses the itemized charges block — fees fold into the total. Single page.
    return (
      <div className="cpdf-doc">
        <Sheet footer={<Footer vendor={vendor} quote={quote} page={1} pages={1} />}>
          <Masthead vendor={vendor} quote={quote} />
          <Parties vendor={vendor} customer={customer} />
          <div className="pp-section">
            <TurnkeySummary skuSet={set} layout={layout} foldFees freightAtCost allInUnit={false} partial={false}
              lede="The all-in turnkey total per tier — one-time fees folded in. Outbound freight is billed separately at cost." />
          </div>
          <div className="pp-section tight">
            <TermsBlock quote={quote} incoterms={quote.incoterms_passthrough} />
            <NotesBlock notes={quote.customer_facing_notes} />
            <HowToAccept />
          </div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="cpdf-doc">
      <Sheet footer={<Footer vendor={vendor} quote={quote} page={1} pages={2} />}>
        <Masthead vendor={vendor} quote={quote} />
        <Parties vendor={vendor} customer={customer} />
        <div className="pp-section">
          <div className="pp-eyebrow">Tiered pricing</div>
          <div className="pp-h2">Per-unit pricing across volume tiers</div>
          <p className="pp-lede">
            Pricing landed <em>EXW Long Beach</em>. Outbound freight is billed separately at cost; one-time charges are itemized below. See page 2 for commercial terms.
          </p>
          <PricingTable skus={set} layout={layout} />
          <GrandTotalRow skuSet={set} layout={layout} foldFees freightAtCost allInUnit={false} />
          <PricingFoot />
        </div>
        <div className="pp-section">
          <ChargesBlock tiers={tiers} recommendedTierIdx={recommendedTierIdx} />
        </div>
      </Sheet>

      <Break label="page break · 1 → 2" />

      <Sheet continuation runhead={<RunHead vendor={vendor} quote={quote} />}
        footer={<Footer vendor={vendor} quote={quote} page={2} pages={2} />}>
        <div className="pp-section tight">
          <div className="pp-eyebrow">Commercial terms</div>
          <div className="pp-h2">Terms &amp; acceptance</div>
          <TermsBlock quote={quote} incoterms={quote.incoterms_passthrough} />
          <NotesBlock notes={quote.customer_facing_notes} />
          <HowToAccept />
        </div>
      </Sheet>
    </div>
  );
}

// ═══ State C · Partial completeness + table overflow ════
function StatePartial({ layout, detail }) {
  const { vendor, customer, quote, skuSets, skus } = D;
  const set = skuSets.partial.map(id => skus.find(s => s.id === id));
  const turnkey = detail === "turnkey_only";

  if (turnkey) {
    return (
      <div className="cpdf-doc">
        <Sheet footer={<Footer vendor={vendor} quote={quote} page={1} pages={1} />}>
          <Masthead vendor={vendor} quote={quote} />
          <Parties vendor={vendor} customer={customer} />
          <div className="pp-section">
            <TurnkeySummary skuSet={set} layout={layout} foldFees={false} freightAtCost={false} allInUnit partial
              lede="All-in turnkey total per tier. One tier is still pending a final line price, noted below." />
          </div>
          <div className="pp-section tight">
            <TermsBlock quote={quote} incoterms={quote.incoterms_bundled} />
            <NotesBlock notes={quote.customer_facing_notes} />
            <HowToAccept />
          </div>
        </Sheet>
      </div>
    );
  }

  const pageOne = set.slice(0, 4);
  const pageTwo = set.slice(4);
  return (
    <div className="cpdf-doc">
      <Sheet footer={<Footer vendor={vendor} quote={quote} page={1} pages={2} />}>
        <Masthead vendor={vendor} quote={quote} />
        <Parties vendor={vendor} customer={customer} />
        <div className="pp-section">
          <div className="pp-eyebrow">Tiered pricing</div>
          <div className="pp-h2">Per-unit pricing across volume tiers</div>
          <p className="pp-lede">
            Pricing landed <em>FOB Long Beach</em>. <em>Glow Capsule (CAP-60)</em> Tier 1 pricing is pending finalization of the formulation R&amp;D milestone — a quote is available on request once raw-ingredient sourcing is locked.
          </p>
          <PricingTable skus={pageOne} layout={layout} />
        </div>
      </Sheet>

      <Break label="page break · 1 → 2 · table continues" />

      <Sheet continuation runhead={<RunHead vendor={vendor} quote={quote} />}
        footer={<Footer vendor={vendor} quote={quote} page={2} pages={2} />}>
        <div className="pp-section tight">
          <PricingTable skus={pageTwo} layout={layout} continued />
          <GrandTotalRow skuSet={set} layout={layout} foldFees={false} freightAtCost={false} allInUnit />
          <PricingFoot partial />
        </div>
        <div className="pp-section">
          <TermsBlock quote={quote} incoterms={quote.incoterms_bundled} />
          <NotesBlock notes={quote.customer_facing_notes} />
          <HowToAccept />
        </div>
      </Sheet>
    </div>
  );
}

// ─── Host (preview chrome — NOT part of the PDF) ─────────
const STATES = [
  { id: "pure",        n: "①", label: "Pure tier-pricing" },
  { id: "passThrough", n: "②", label: "Pass-through + fees" },
  { id: "partial",     n: "③", label: "Partial + overflow" },
];

function CustomerPdfHost({ state, setState, layout, setLayout, detail, setDetail }) {
  const Variant = ({ pure: StatePure, passThrough: StatePassThrough, partial: StatePartial })[state] || StatePure;
  return (
    <div className="cpdf-stage">
      <div className="cpdf-toolbar">
        <div className="grp">
          <span className="ribbon">PDF render · this is the customer artifact</span>
          <div className="seg">
            {STATES.map(s => (
              <button key={s.id} className={state === s.id ? "active" : ""} onClick={() => setState(s.id)}>
                {s.n} {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grp">
          <span className="layout-toggle">
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Layout:</span>
            <button className={layout === "tier_table" ? "active" : ""} onClick={() => setLayout("tier_table")}>tier table</button>
            <span className="bar">|</span>
            <button className={layout === "single_tier" ? "active" : ""} onClick={() => setLayout("single_tier")}>single tier</button>
          </span>
          <span className="layout-toggle">
            <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>Detail:</span>
            <button className={detail === "itemized" ? "active" : ""} onClick={() => setDetail("itemized")}>itemized</button>
            <span className="bar">|</span>
            <button className={detail === "turnkey_only" ? "active" : ""} onClick={() => setDetail("turnkey_only")}>turnkey only</button>
          </span>
          <div className="cpdf-dl"><button className="btn sm">⤓ Download PDF</button></div>
        </div>
      </div>

      <div className="cpdf-dn">
        <div className="eyebrow">CD · paged render layer · + addendum 1</div>
        <strong>This is the paged layer, not the web preview.</strong> Flex composition only, no CSS grid, US-Letter page boxes, running header/footer as <code>fixed</code> elements. <strong>Addendum 1:</strong> each priced cell stacks the extended line total under the unit price; a <code>Turnkey total</code> row sums them (allocated fees fold in, pass-through freight held out). <code>detail_level</code> crosses <code>pdf_layout</code> — <code>turnkey_only</code> drops the SKU rows for an all-in figure. Boundary guard holds: every number derives from sell prices — no margin, markup, cost, supplier, duty, CBM, version, or scenario.
      </div>

      <Variant layout={layout} detail={detail} />
    </div>
  );
}

Object.assign(window, {
  CustomerPdfHost,
  StatePure, StatePassThrough, StatePartial,
  PricingTable, GrandTotalRow, TurnkeySummary, ChargesBlock, TermsBlock,
});
