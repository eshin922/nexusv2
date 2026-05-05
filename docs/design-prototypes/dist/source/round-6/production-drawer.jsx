// Production drawer — heavier than packaging because four consequential
// toggles change the model:
//   1) Customer ships raws — when ON, raws are excluded from cost; this
//      removes packaging-as-cost but service fees still need a denominator.
//   2) Allocate service fees to unit cost — when ON, NRE / tooling / R&D get
//      amortized into per-unit. When OFF, they appear as line-item charges
//      (post-quote, on the order). Affects how margin is calculated and
//      where the customer sees the dollars.
//
// We make the consequence visible per toggle: each toggle row says what
// changes when it flips. No silent footguns.
//
// Bulk raw cost was a sub-section here in R6; it became a peer section
// (Bulk Raw) in R6.1 because the firm takes deposits against raws
// specifically, and a deposit workflow can't live on a sub-section.
//
// "Post-production yield" is a third sub-section, used during the
// reconciliation phase: when the actual run finishes, you log the actual
// units produced, and the system can either lock or reweight markup. We
// show it inline so it's not a separate hidden surface.

function ProductionDrawer({ data, tiers, onToggle, formulaYield }) {
  if (data.status === "empty" || data.lines.length === 0) {
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No production lines yet</h4>
        <p>Add filling, assembly, tooling, and any one-time charges. Raws live in the Bulk Raw section above.</p>
        <div className="actions">
          <button className="btn primary">+ Add production line</button>
        </div>
      </div>
    );
  }

  const lineTotalForTier = (tierKey) => data.lines.reduce((s, l) => s + (l[tierKey] || 0), 0);

  return (
    <React.Fragment>
      {/* Toggles */}
      <div className="r6-prod-toggles">
        <div
          className={`r6-prod-toggle ${data.customer_ships_raws ? "on" : ""}`}
          onClick={() => onToggle && onToggle("customer_ships_raws")}
        >
          <span className="tog" />
          <div className="body">
            <div className="lab">Customer ships raws</div>
            <div className="desc">If ON, packaging components are excluded from the unit cost. Use when the customer hands raws to the CM.</div>
            <div className="consequence">
              {data.customer_ships_raws ? "→ packaging cost: $0.00 in this quote" : "→ packaging cost included as priced"}
            </div>
          </div>
        </div>

        <div
          className={`r6-prod-toggle ${data.allocate_service_fees_to_unit_cost ? "on" : ""}`}
          onClick={() => onToggle && onToggle("allocate_service_fees_to_unit_cost")}
        >
          <span className="tog" />
          <div className="body">
            <div className="lab">Allocate service fees to unit cost</div>
            <div className="desc">NRE, tooling, and R&amp;D amortize across units. If OFF, they invoice separately as one-time charges.</div>
            <div className="consequence">
              {data.allocate_service_fees_to_unit_cost
                ? "→ NRE rolled into per-unit (smaller tiers carry more)"
                : "→ NRE invoiced as a separate line on the order"}
            </div>
          </div>
        </div>
      </div>

      <div className="drawer-toolbar">
        <div className="lhs">
          <span><strong>{data.lines.length}</strong> production lines</span>
          <span>·</span>
          <span>Service fees mode: <strong>{data.allocate_service_fees_to_unit_cost ? "amortized" : "billed separately"}</strong></span>
        </div>
        <div className="rhs">
          <button className="btn sm">+ Line</button>
          <button className="btn sm ghost">+ NRE charge</button>
        </div>
      </div>

      <div className="r6-dt prod" style={{ "--cols": tiers.length }}>
        <div className="r6-dt-head">
          <span>Line</span>
          <span>Category</span>
          <span>Supplier</span>
          <span>Kind</span>
          <span className="num">Markup</span>
          {tiers.map((t) => (
            <span key={t.id} className="num">{t.label}<br /><span style={{ fontSize: "9px", letterSpacing: "0.04em", opacity: 0.7 }}>{t.units.toLocaleString()}</span></span>
          ))}
          <span></span>
        </div>

        {data.lines.map((line) => (
          <div key={line.id} className="r6-dt-row">
            <div className="name">
              <span className="lab">{line.name}</span>
              {line.kind === "amortized_nre" && line.nre_total != null && (
                <span className="sub">NRE total ${line.nre_total.toLocaleString()} · spreads across run size</span>
              )}
              {line.kind === "per_unit" && (
                <span className="sub">priced per unit produced</span>
              )}
            </div>
            <div className="cat">{line.category}</div>
            <div className="sup">{line.supplier}</div>
            <div>
              <span className="r6-badge">
                {line.kind === "amortized_nre" ? "NRE" : "per-unit"}
              </span>
            </div>
            <div className="num"><span className="markup">{(line.markup_pct * 100).toFixed(0)}%</span></div>
            {tiers.map((t) => {
              const v = line[t.id.toLowerCase()];
              return (
                <span key={t.id} className={`cell-num ${v == null ? "empty" : ""}`}>
                  {v == null ? "—" : `$${v.toFixed(2)}`}
                </span>
              );
            })}
            <div className="actions">···</div>
          </div>
        ))}

        <div className="r6-dt-foot">
          <span className="total-lab">Total — production</span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          {tiers.map((t) => {
            const v = lineTotalForTier(t.id.toLowerCase());
            const allMissing = data.lines.every((l) => l[t.id.toLowerCase()] == null);
            return (
              <span key={t.id} className={`num ${allMissing ? "empty" : ""}`}>
                {allMissing ? "—" : `$${v.toFixed(2)}`}
              </span>
            );
          })}
          <span></span>
        </div>
      </div>

      {/* Post-production reconcile — dual axis: Production yield + Formula yield */}
      <div className="r6-post-prod">
        <div className="r6-post-prod-head">
          <h4>Post-production reconcile</h4>
          <div className="meta">
            {data.yield_locked ? "Locked · run complete" : "Pre-run · awaiting actuals"}
          </div>
        </div>
        <p className="desc">After the run, log two yield events separately. Production yield (units actually filled vs. ordered) feeds NRE re-amortization. Formula yield (mass consumed vs. ordered, and vs. theoretical) feeds raw cost reconciliation. They reconcile, they don't re-quote.</p>

        <div className="r6-yield-split">
          <div className={`r6-yield-block ${data.yield_locked ? "locked" : ""}`}>
            <div className="r6-yield-block-head">
              <h5>Production yield</h5>
              <span className="axis">units</span>
            </div>
            <p className="desc">How many units actually came off the line, vs. quoted. Drives NRE per-unit reconciliation and any tier-bracket movement.</p>
            <div className="r6-yield-block-grid">
              <div className="r6-yield-block-cell">
                <div className="lab">Actual units produced</div>
                <div className={`val ${data.actual_units_produced == null ? "empty" : ""}`}>
                  {data.actual_units_produced == null ? "—" : data.actual_units_produced.toLocaleString()}
                </div>
                {data.actual_units_produced != null && tiers[0] && (
                  <div className={`delta ${data.actual_units_produced < tiers[0].units ? "neg" : "pos"}`}>
                    {data.actual_units_produced > tiers[0].units ? "+" : ""}
                    {((data.actual_units_produced - tiers[0].units) / tiers[0].units * 100).toFixed(1)}% vs. quoted
                  </div>
                )}
              </div>
              <div className="r6-yield-block-cell">
                <div className="lab">NRE per-unit delta</div>
                <div className={`val ${data.actual_units_produced == null ? "empty" : ""}`}>
                  {data.actual_units_produced == null ? "—" : "+$0.01 / unit"}
                </div>
                {data.actual_units_produced != null && (
                  <div className="delta neg">−0.3 pts margin impact</div>
                )}
              </div>
            </div>
          </div>

          {formulaYield && (
            <div className={`r6-yield-block ${formulaYield.yield_locked ? "locked" : ""}`}>
              <div className="r6-yield-block-head">
                <h5>Formula yield</h5>
                <span className="axis">mass</span>
              </div>
              <p className="desc">Two checks: did we get billed for unused raws (procurement waste), and did the line over- or under-fill (fill efficiency).</p>
              <div className="r6-yield-block-grid">
                <div className="r6-yield-block-cell">
                  <div className="lab">Mass consumed vs. ordered</div>
                  <div className={`val ${formulaYield.mass_consumed_kg == null ? "empty" : ""}`}>
                    {formulaYield.mass_consumed_kg == null
                      ? "—"
                      : `${formulaYield.mass_consumed_kg.toFixed(1)} / ${formulaYield.mass_ordered_kg.toFixed(1)} kg`}
                  </div>
                  {formulaYield.mass_consumed_kg != null && (
                    <div className="delta neg">
                      {(formulaYield.mass_ordered_kg - formulaYield.mass_consumed_kg).toFixed(1)} kg billed but unused
                    </div>
                  )}
                </div>
                <div className="r6-yield-block-cell">
                  <div className="lab">Mass consumed vs. theoretical</div>
                  <div className={`val ${formulaYield.mass_consumed_kg == null ? "empty" : ""}`}>
                    {formulaYield.mass_consumed_kg == null
                      ? "—"
                      : `${formulaYield.mass_consumed_kg.toFixed(1)} / ${formulaYield.mass_theoretical_kg.toFixed(1)} kg`}
                  </div>
                  {formulaYield.mass_consumed_kg != null && (
                    <div className={`delta ${formulaYield.mass_consumed_kg > formulaYield.mass_theoretical_kg ? "neg" : "pos"}`}>
                      {((formulaYield.mass_consumed_kg / formulaYield.mass_theoretical_kg - 1) * 100).toFixed(1)}% over-fill
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </React.Fragment>
  );
}

window.NXR6Production = ProductionDrawer;
