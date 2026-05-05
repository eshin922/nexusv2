/* global React, NX_DATA, MarginVerdict, MarginMeter */
const { useState: useStateC, useMemo: useMemoC } = React;

function CostingSheet({ scenario = "healthy" }) {
  const D = window.NX_DATA;
  const [globalAdj, setGlobalAdj] = useStateC(scenario === "healthy" ? 8 : -4);
  const [activeTier, setActiveTier] = useStateC("t2");

  // Per-(SKU, tier) data — illustrative
  const skuTierData = useMemoC(() => {
    const base = D.skus.map((s, i) => ({
      sku: s,
      tiers: D.tiers.map((t, j) => {
        // contribution cost decreases with volume
        const contribution = (3.2 + i * 0.4) * (1 - j * 0.05);
        const baseSell = contribution / (1 - 0.34);
        return {
          tier: t,
          contribution,
          requiredSell: baseSell,
          actualSell: baseSell, // editable
        };
      })
    }));
    return base;
  }, []);

  // Apply global adjustment
  const lines = skuTierData.map(row => ({
    ...row,
    tiers: row.tiers.map(td => {
      const sell = td.requiredSell * (1 + globalAdj / 100);
      const margin = ((sell - td.contribution) / sell) * 100;
      const flagged = scenario === "below" && margin < 25;
      return { ...td, sell, margin, flagged };
    })
  }));

  const allMargins = lines.flatMap(r => r.tiers.map(t => t.margin));
  const blended = allMargins.reduce((a, b) => a + b, 0) / allMargins.length;
  const targetGap = 35 - blended;
  const suggestedAdj = +(globalAdj + (targetGap / 35) * 35).toFixed(1);

  const flaggedLines = lines.flatMap(r => r.tiers.filter(t => t.flagged).map(t => ({ sku: r.sku, ...t })));
  const isBelow = blended < 25;
  const isWarn = blended < 35 && blended >= 25;

  // Headroom — for healthy state — tier with the most margin above target
  const headroom = lines.flatMap(r => r.tiers.map(t => ({ sku: r.sku, ...t })))
    .sort((a, b) => b.margin - a.margin)[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Costing sheet · v3 · {scenario === "healthy" ? "GOOD margin" : "BELOW FLOOR"}</p>
          <h1 className="page-title">Tune <em>price</em> &amp; review</h1>
          <p className="page-sub">Quote-level analysis. The room is organized around the verdict — not a wall of cells.</p>
        </div>
        <div className="row gap-2">
          <button className="btn ghost sm">← Back to cost build</button>
          <button className="btn">Preview customer quote</button>
          {scenario === "healthy" ? (
            <button className="btn primary">Mark accepted →</button>
          ) : (
            <button className="btn" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
              🔒 Mark accepted · admin override required
            </button>
          )}
        </div>
      </div>

      {/* THE ROOM IS ORGANIZED AROUND THE VERDICT */}
      <div style={{
        background: "var(--paper)",
        border: "1px solid var(--rule)",
        borderLeft: `4px solid var(--${isBelow ? "bad" : isWarn ? "warn" : "good"})`,
        borderRadius: 12,
        padding: "28px 32px",
        marginBottom: 20,
        display: "grid",
        gridTemplateColumns: "1.1fr 1fr",
        gap: 40,
        alignItems: "center",
      }}>
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>
            Blended margin · all SKUs · all tiers
          </div>
          <div style={{ fontFamily: "var(--display)", fontSize: 96, fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 0.9, color: "var(--ink)" }}>
            {blended.toFixed(1)}<span style={{ fontSize: 48, color: "var(--ink-3)", fontStyle: "italic", marginLeft: 4 }}>%</span>
          </div>
          <div className="mono" style={{
            marginTop: 12, fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase",
            color: `var(--${isBelow ? "bad" : isWarn ? "warn" : "good"})`, fontWeight: 500
          }}>
            {isBelow ? "● Below floor — admin override required" : isWarn ? "● Below target — soft warning" : "● Good — above target"}
          </div>
        </div>

        {/* What-if controls right next to the verdict */}
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 12 }}>
            Tune · global adjustment
          </div>
          <div className="row gap-3" style={{ marginBottom: 8 }}>
            <input type="range" min="-20" max="40" value={globalAdj} onChange={e => setGlobalAdj(+e.target.value)}
              className="slider" style={{ flex: 1, height: 6 }} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 500, minWidth: 70, textAlign: "right" }}>
              {globalAdj > 0 ? "+" : ""}{globalAdj}%
            </span>
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-4)", marginBottom: 16 }}>
            <span>−20%</span><span>0</span><span>+40%</span>
          </div>

          {/* Suggestion */}
          <div style={{
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            padding: "12px 14px",
            display: "flex", alignItems: "center", gap: 12
          }}>
            <div style={{ flex: 1, fontSize: 12.5, color: "var(--accent-ink)" }}>
              Suggestion · {globalAdj.toFixed(0)}% → <strong>{suggestedAdj.toFixed(1)}%</strong> would put blended at {(35.0).toFixed(1)}%
            </div>
            <button className="btn accent sm" onClick={() => setGlobalAdj(suggestedAdj)}>Apply</button>
          </div>
        </div>
      </div>

      {/* Below-floor: lines requiring review surfaced loudly */}
      {scenario === "below" && flaggedLines.length > 0 && (
        <div style={{
          background: "var(--bad-soft)",
          border: "1px solid var(--bad)",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 20,
        }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="row gap-2">
              <span className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--bad)", fontWeight: 600 }}>
                ● {flaggedLines.length} lines underpriced
              </span>
            </div>
            <button className="btn sm" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>Anchor first →</button>
          </div>
          <div className="col gap-2">
            {flaggedLines.slice(0, 4).map((f, i) => (
              <div key={i} className="row gap-3" style={{
                background: "var(--paper)", padding: "10px 14px", borderRadius: 6,
                fontSize: 13
              }}>
                <span className="chip muted mono">{f.sku.label}</span>
                <span className="muted">·</span>
                <span>{f.tier.label}</span>
                <span style={{ flex: 1 }}></span>
                <span className="muted mono" style={{ fontSize: 12 }}>need ${(f.contribution * 1.34).toFixed(2)} · selling ${f.sell.toFixed(2)}</span>
                <span className="chip bad">{f.margin.toFixed(1)}% · floor 25%</span>
                <button className="btn sm">Fix →</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Healthy: headroom + benchmark insights */}
      {scenario === "healthy" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: "16px 18px" }}>
            <p className="eyebrow" style={{ marginBottom: 6 }}>Most headroom</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, color: "var(--ink)", letterSpacing: "-0.015em" }}>
              {headroom.sku.label} · {headroom.tier.label}
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--good)", marginTop: 4 }}>
              {headroom.margin.toFixed(1)}% · {(headroom.margin - 35).toFixed(1)}pp above target
            </div>
          </div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <p className="eyebrow" style={{ marginBottom: 6 }}>Customer benchmark</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, color: "var(--ink)", letterSpacing: "-0.015em" }}>
              ~22% under retail
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
              Healthy contract pricing range for this category
            </div>
          </div>
          <div className="card" style={{ padding: "16px 18px" }}>
            <p className="eyebrow" style={{ marginBottom: 6 }}>0 lines need review</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 24, color: "var(--ink)", letterSpacing: "-0.015em" }}>
              You can send.
            </div>
            <div className="mono" style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>
              All margins above floor · global adj +{globalAdj}%
            </div>
          </div>
        </div>
      )}

      {/* Per-(SKU, tier) — cards, not table. Active-tier emphasized; others as comparison strip. */}
      <div className="section-head">
        <h2>Per-SKU breakdown <em>· {D.tiers.find(t => t.id === activeTier).label} active</em></h2>
        <div className="row gap-2">
          {D.tiers.map(t => (
            <button key={t.id}
              onClick={() => setActiveTier(t.id)}
              className={"btn sm" + (t.id === activeTier ? " primary" : " ghost")}
              style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="col gap-3">
        {lines.map(row => {
          const active = row.tiers.find(t => t.tier.id === activeTier);
          const others = row.tiers.filter(t => t.tier.id !== activeTier);
          return (
            <div key={row.sku.id} className="card" style={{
              border: active.flagged ? "1px solid var(--bad)" : undefined,
              borderLeft: active.flagged ? "3px solid var(--bad)" : undefined
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr", gap: 0 }}>
                {/* SKU identity */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--rule)" }}>
                  <div className="row gap-2" style={{ marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{row.sku.label}</span>
                    {active.flagged && <span className="chip bad" style={{ fontSize: 9 }}>UNDERPRICED</span>}
                  </div>
                  <div style={{ fontFamily: "var(--display)", fontSize: 18, color: "var(--ink)", letterSpacing: "-0.01em" }}>
                    {row.sku.name}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{row.sku.pack}</div>
                </div>

                {/* Cost stack mini */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--rule)" }}>
                  <p className="eyebrow" style={{ marginBottom: 4 }}>Contribution → Sell</p>
                  <div className="mono" style={{ fontSize: 14, color: "var(--ink)" }}>
                    ${active.contribution.toFixed(2)} <span className="muted">→</span> <strong>${active.sell.toFixed(2)}</strong>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
                    retail ${row.sku.retail} · {((active.sell / row.sku.retail) * 100).toFixed(0)}% of retail
                  </div>
                </div>

                {/* Margin — the verdict */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--rule)" }}>
                  <p className="eyebrow" style={{ marginBottom: 4 }}>Margin · {active.tier.label}</p>
                  <div style={{
                    fontFamily: "var(--display)", fontSize: 32, letterSpacing: "-0.02em", lineHeight: 1,
                    color: `var(--${active.margin >= 35 ? "good" : active.margin >= 25 ? "warn" : "bad"})`
                  }}>
                    {active.margin.toFixed(1)}<span style={{ fontSize: 16, opacity: 0.7 }}>%</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <MarginMeter value={active.margin} floor={25} target={35} />
                  </div>
                </div>

                {/* Other tiers as comparison strip */}
                <div style={{ padding: "16px 20px" }}>
                  <p className="eyebrow" style={{ marginBottom: 6 }}>All tiers</p>
                  <div className="col" style={{ gap: 4 }}>
                    {row.tiers.map(t => {
                      const isAct = t.tier.id === activeTier;
                      const stat = t.margin >= 35 ? "good" : t.margin >= 25 ? "warn" : "bad";
                      return (
                        <div key={t.tier.id} className="row" style={{
                          gap: 8, alignItems: "center", fontSize: 11.5,
                          opacity: isAct ? 1 : 0.7
                        }}>
                          <span className="mono" style={{ width: 40, color: "var(--ink-3)" }}>{(t.tier.qty/1000)}k</span>
                          <div style={{ flex: 1 }}>
                            <MarginMeter value={t.margin} floor={25} target={35} />
                          </div>
                          <span className="mono" style={{ width: 48, textAlign: "right", color: `var(--${stat})`, fontWeight: 500 }}>
                            {t.margin.toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.CostingSheet = CostingSheet;
