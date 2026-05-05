// Cost Stack header — multi-tier horizontal, each tier is a column.
// Inside a tier: rows for PKG / PROD / FRT / D+T / PASS, each rendered as a
// horizontal cost+markup bar. Width of bars is normalised across tiers (relative
// to the largest subtotal seen) so the eye reads "tier 4 packaging is fatter
// than tier 1 packaging" — even though per-unit declines.
//
// "D+T" is the internal layer (margin+freight uplift), drawn with a hatched fill
// to mark it as not-customer-facing. PASS is the final passthrough/adjustment
// row — usually empty, kept visible so the stack grammar matches every surface.

const { useMemo: useMemoStack } = React;

function CostStack({ tiers, activeTierId, onPickTier, rawsMode, rawTotalT2 }) {
  // Normalise: find max subtotal among populated tiers
  const maxSub = useMemoStack(() => {
    return tiers.reduce((m, t) => {
      const s = t.subtotal != null ? t.subtotal : 0;
      return Math.max(m, s);
    }, 1) || 1;
  }, [tiers]);

  const showRaw = rawsMode === "dps_sources";

  return (
    <div className="r6-stack">
      <div className="r6-stack-head">
        <h2>Cost stack</h2>
        <div className="legend">
          <span><span className="swatch pkg" />Packaging</span>
          <span><span className="swatch prod" />Production</span>
          {showRaw && <span><span className="swatch raw" />Raws <span style={{ opacity: 0.7 }}>(DPS-sourced)</span></span>}
          <span><span className="swatch frt" />Freight</span>
          <span><span className="swatch dt" />D+T <span style={{ opacity: 0.7 }}>internal</span></span>
          <span><span className="swatch pass" />Passthrough</span>
        </div>
      </div>

      <div
        className="r6-stack-grid"
        style={{ gridTemplateColumns: `repeat(${tiers.length}, 1fr)` }}
      >
        {tiers.map((t) => (
          <TierColumn
            key={t.id}
            tier={t}
            maxSub={maxSub}
            active={t.id === activeTierId}
            onPick={() => onPickTier && onPickTier(t.id)}
            showRaw={showRaw}
            rawTotalT2={rawTotalT2}
          />
        ))}
      </div>
    </div>
  );
}

function TierColumn({ tier, maxSub, active, onPick, showRaw, rawTotalT2 }) {
  const empty = tier.margin_state === "incomplete";

  // Build component list with optional RAW row injected after PROD.
  // RAW per-tier cost: in this iteration we use a single rawTotalT2 number
  // for the active tier and scale slightly across tiers for visual variety.
  // (Real implementation would compute per-tier from ingredient native_cost
  // × usage_per_filled_unit, but raws don't tier the same way as PKG/PROD,
  // so a flat-ish stack is honest.)
  const buildComps = () => {
    const base = tier.components && tier.components.length > 0
      ? tier.components
      : ["pkg", "prod", "frt", "dt", "pass"].map((k) => ({ key: k, label: k.toUpperCase(), cost: null, markup: null, internal: k === "dt" }));

    if (!showRaw) return base;

    // Inject RAW immediately after PROD
    const out = [];
    for (const c of base) {
      out.push(c);
      if (c.key === "prod") {
        // Tier-scale RAW: T1 baseline, T2 -2%, T3 -5%, T4 -7% (volume break on raws)
        const tierIdx = ["T1", "T2", "T3", "T4"].indexOf(tier.id);
        const scale = [1.04, 1.0, 0.95, 0.92][tierIdx] ?? 1.0;
        const rawCost = rawTotalT2 != null && c.cost != null ? rawTotalT2 * scale : null;
        const rawMarkup = rawCost != null ? rawCost * 0.27 : null; // average raw category markup
        out.push({
          key: "raw",
          label: "RAW",
          cost: rawCost,
          markup: rawMarkup,
        });
      }
    }
    return out;
  };

  const comps = buildComps();

  // Recompute totals if RAW was injected
  let displaySubtotal = tier.subtotal;
  let displaySell = tier.sell;
  let displayMarginPct = tier.margin_pct;
  let displayMarginState = tier.margin_state;

  if (showRaw && tier.subtotal != null) {
    const rawComp = comps.find((c) => c.key === "raw");
    if (rawComp && rawComp.cost != null) {
      displaySubtotal = tier.subtotal + rawComp.cost + rawComp.markup;
      displaySell = displaySubtotal + (tier.adjustment || 0);
      // Recompute margin: cost+markup contribution from RAW
      const totalCost = comps.filter((c) => c.cost != null && c.key !== "dt").reduce((s, c) => s + c.cost, 0);
      displayMarginPct = displaySell > 0 ? 1 - totalCost / displaySell : null;
    }
  }

  return (
    <div
      className={`r6-tier-col ${active ? "active" : ""}`}
      onClick={onPick}
      data-screen-label={`Tier ${tier.label}`}
    >
      <div className="r6-tier-col-head">
        <span className="label">{tier.label}</span>
        <span className="qty">
          {tier.units.toLocaleString()}
          <span className="units">units</span>
        </span>
      </div>

      <div className="r6-tier-col-bars">
        {comps.map((c) => (
          <CompRow key={c.key} comp={c} maxSub={Math.max(maxSub, displaySubtotal || 0)} />
        ))}
      </div>

      <div className="r6-tier-col-foot">
        {!empty ? (
          <React.Fragment>
            <div className="row sub">
              <span className="lab">Subtotal</span>
              <span className="v">${displaySubtotal.toFixed(2)}</span>
            </div>
            {tier.adjustment !== 0 && tier.adjustment != null && (
              <div className="row sub">
                <span className="lab">Adjustment</span>
                <span className="v">${tier.adjustment.toFixed(2)}</span>
              </div>
            )}
            <div className="row sell">
              <span className="lab">Sell</span>
              <span className="v">${displaySell.toFixed(2)}</span>
            </div>
            <div className={`margin ${displayMarginState}`}>
              <span className="pip" />
              {displayMarginPct != null ? (displayMarginPct * 100).toFixed(1) : "—"}% margin
              {displayMarginState === "below_target" && (
                <span style={{ marginLeft: "auto", fontSize: "9.5px", letterSpacing: "0.06em" }}>BELOW 35</span>
              )}
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="row sell">
              <span className="lab">Sell</span>
              <span className="v empty">—</span>
            </div>
            <div className="margin incomplete">
              <span className="pip" />
              awaiting inputs
            </div>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

function CompRow({ comp, maxSub }) {
  const isEmpty = comp.cost == null;
  const isInternal = comp.key === "dt";
  const isRaw = comp.key === "raw";
  const rowClass = `r6-comp-row ${isInternal ? "dt" : ""} ${isRaw ? "raw" : ""}`;
  if (isEmpty) {
    return (
      <div className={`${rowClass} empty`}>
        <span className="key">{comp.label}</span>
        <span className="r6-bar empty" />
        <span className="price">—</span>
      </div>
    );
  }
  // Cost+markup widths as % of maxSub
  const costPct = Math.max(0.5, (comp.cost / maxSub) * 100);
  const mkPct = Math.max(0, (comp.markup / maxSub) * 100);
  return (
    <div className={rowClass}>
      <span className="key">{comp.label}</span>
      <span className="r6-bar">
        <span className={`seg cost ${comp.key}`} style={{ width: `${costPct}%` }} />
        {mkPct > 0 && <span className="seg markup" style={{ width: `${mkPct}%` }} />}
      </span>
      <span className="price">${(comp.cost + comp.markup).toFixed(2)}</span>
    </div>
  );
}

window.NXR6CostStack = CostStack;
