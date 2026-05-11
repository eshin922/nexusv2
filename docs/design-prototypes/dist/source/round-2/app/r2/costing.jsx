/* global React, NXR2, MarginMeter */
const { useState: useStateC, useMemo: useMemoC } = React;

// ─── Two-axis verdict pill ────────────────────────────────
function TwoAxisVerdict({ marginStatus, competitiveStatus }) {
  const ms = { good: ["GOOD", "var(--good)"], warn: ["BELOW TARGET", "var(--warn)"], bad: ["BELOW FLOOR", "var(--bad)"] };
  const cs = {
    competitive: ["COMPETITIVE", "var(--good)"],
    over: ["OVER CLIENT TARGET", "var(--warn)"],
    none: ["NO CLIENT TARGET", "var(--ink-4)"],
  };
  return (
    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
      <span style={{
        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em",
        textTransform: "uppercase", padding: "3px 8px",
        borderRadius: 4, background: "var(--paper-3)",
        border: `1px solid ${ms[marginStatus][1]}`, color: ms[marginStatus][1],
      }}>
        ● margin · {ms[marginStatus][0]}
      </span>
      <span style={{
        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.1em",
        textTransform: "uppercase", padding: "3px 8px",
        borderRadius: 4, background: "var(--paper-3)",
        border: `1px solid ${cs[competitiveStatus][1]}`, color: cs[competitiveStatus][1],
      }}>
        ● client · {cs[competitiveStatus][0]}
      </span>
    </div>
  );
}

function CostingSheet({ scenario = "healthy" }) {
  const D = window.NXR2;
  const [globalAdj, setGlobalAdj] = useStateC(scenario === "healthy" ? D.quote.global_price_adj_pct : -2);
  const [activeTier, setActiveTier] = useStateC("t2");
  const [perTierAdj, setPerTierAdj] = useStateC({}); // 9.2
  const [perCellOverride, setPerCellOverride] = useStateC({}); // 9.3 — per (sku, tier)
  const [openCellOverride, setOpenCellOverride] = useStateC(null);

  // Compute per-(sku, tier) data from real schema
  const matrix = useMemoC(() => {
    return D.skus.map(sku => {
      // For demo we generate plausible costs for non-s2 SKUs from a base
      const baseCost = sku.id === "s2" ? null : (2.4 + (parseInt(sku.id.slice(1)) - 1) * 0.5);
      return {
        sku,
        tiers: D.tiers.map((tier, j) => {
          let math;
          if (sku.id === "s2") {
            math = D.tierMath(sku.id, tier.id, {
              gpa: globalAdj,
              tierAdj: perTierAdj[tier.id],
            });
          } else {
            // Synthetic for demo — real implementation pulls from cost tables
            const contributionCost = baseCost * (1 - j * 0.04);
            const beforeAdj = contributionCost * 1.32;
            const tierAdj = perTierAdj[tier.id];
            const eff = tierAdj != null ? tierAdj : globalAdj;
            const requiredSell = beforeAdj * (1 + eff / 100);
            const margin = requiredSell > 0 ? ((requiredSell - contributionCost) / requiredSell) * 100 : 0;
            math = { contributionCost, beforeAdj, requiredSell, margin, effectiveAdj: eff };
          }
          // Apply per-cell override
          const override = perCellOverride[`${sku.id}:${tier.id}`];
          let sell = math.requiredSell, margin = math.margin, isOverride = false;
          if (override != null) {
            sell = override;
            margin = ((sell - math.contributionCost) / sell) * 100;
            isOverride = true;
          }
          // Scenario forcing: in below-floor scenario, push some lines down
          if (scenario === "below" && (sku.id === "s4" || (sku.id === "s5" && tier.id === "t4"))) {
            sell = math.contributionCost * 1.20; // forced underpricing
            margin = ((sell - math.contributionCost) / sell) * 100;
          }
          // Client benchmark
          const clientTarget = tier.client_target_price_per_unit;
          const competitive = clientTarget == null ? "none" : sell <= clientTarget ? "competitive" : "over";
          return {
            tier, sku,
            contributionCost: math.contributionCost,
            sell, margin,
            isOverride,
            clientTarget, competitive,
            marginStatus: margin >= 35 ? "good" : margin >= 25 ? "warn" : "bad",
          };
        }),
      };
    });
  }, [globalAdj, perTierAdj, perCellOverride, scenario]);

  const allCells = matrix.flatMap(r => r.tiers);
  const blended = allCells.reduce((a, c) => a + c.margin, 0) / allCells.length;
  const blendedStatus = blended >= 35 ? "good" : blended >= 25 ? "warn" : "bad";

  const flagged = allCells.filter(c => c.marginStatus === "bad");
  const headroom = [...allCells].sort((a, b) => b.margin - a.margin)[0];
  const competitivenessOver = allCells.filter(c => c.competitive === "over");

  // Suggestion math — what GPA gets blended to target
  const suggestedGpa = useMemoC(() => {
    let best = globalAdj, bestDiff = Infinity;
    for (let g = -20; g <= 40; g += 0.5) {
      const m = allCells.map(c => {
        const beforeAdj = c.contributionCost * 1.32; // approximation for demo
        const sell = beforeAdj * (1 + g / 100);
        return ((sell - c.contributionCost) / sell) * 100;
      });
      const blendedTest = m.reduce((a, b) => a + b, 0) / m.length;
      const diff = Math.abs(blendedTest - 35);
      if (diff < bestDiff) { bestDiff = diff; best = g; }
    }
    return Math.round(best * 10) / 10;
  }, [allCells, globalAdj]);

  // Per-quote target margin override (9.2)
  const targetMargin = D.quote.target_margin_pct ?? D.firm_settings.target_margin_pct;
  const floorMargin = D.firm_settings.floor_margin_pct;

  return (
    <div className="page" data-screen-label={`Costing Sheet · ${scenario}`}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Costing Sheet · {D.project.client} / Quote v{D.quote.version_number}</p>
          <h1 className="page-title">Tune <em>price</em> &amp; review.</h1>
          <p className="page-sub">{
            blendedStatus === "good" ? "All margins above floor — review and send." :
            blendedStatus === "warn" ? `${flagged.length || "Some"} lines below target — soft warning, sendable.` :
            "Below floor — admin override required to send."
          }</p>
        </div>
        <div className="row gap-2">
          <button className="btn ghost sm">← Back to Cost Build</button>
          <button className="btn">Preview customer quote</button>
          {scenario === "healthy" ? (
            <button className="btn primary">Mark accepted →</button>
          ) : (
            <div className="row gap-2">
              <button className="btn" disabled style={{
                opacity: 0.55,
                cursor: "not-allowed",
                textDecoration: "line-through",
                textDecorationColor: "var(--bad)",
                textDecorationThickness: "1px",
              }}>
                Mark accepted
              </button>
              <button className="btn" style={{
                background: "var(--paper-2)",
                border: "1px dashed var(--bad)",
                color: "var(--bad)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}>
                ⚿ Request admin override
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lines requiring review — anchored, navigable. Lifted ABOVE the verdict in BELOW FLOOR
          so the first thing the user sees is the actionable list, not the score. */}
      {scenario === "below" && flagged.length > 0 && (
        <div style={{
          background: "var(--bad-soft)",
          border: "2px solid var(--bad)",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 14,
        }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow" style={{ color: "var(--bad)", fontWeight: 600, marginBottom: 2 }}>
                ● {flagged.length} lines below floor — resolve before send
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: 0 }}>
                Each line is below the {floorMargin}% floor. Either tune up sell price, accept and request admin override, or push back on cost.
              </div>
            </div>
            <button className="btn sm">Anchor first underpriced cell →</button>
          </div>
          <div className="col gap-1">
            {flagged.map((c, i) => (
              <div key={i} className="row gap-3" style={{
                background: "var(--paper-2)",
                padding: "8px 12px", borderRadius: 6,
                fontSize: 12.5,
              }}>
                <span className="mono" style={{ color: "var(--ink-4)", width: 30 }}>{String(i+1).padStart(2,"0")}</span>
                <span className="chip">{c.sku.label}</span>
                <span className="muted">·</span>
                <span>{c.tier.label}</span>
                <span style={{ flex: 1 }}></span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  contrib ${c.contributionCost.toFixed(2)} · selling ${c.sell.toFixed(2)} · need ${(c.contributionCost / 0.75).toFixed(2)}
                </span>
                <span className="chip bad">{c.margin.toFixed(1)}% · floor {floorMargin}%</span>
                <button className="btn sm" onClick={() => setActiveTier(c.tier.id)}>Fix →</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* THE VERDICT — the room. In BELOW FLOOR, treatment is hard-block (red border, red number,
          override-required messaging). In healthy/warn, it's the calm score. */}
      <div style={{
        background: blendedStatus === "bad" ? "var(--bad-soft)" : "var(--paper-2)",
        border: blendedStatus === "bad" ? "2px solid var(--bad)" : "1px solid var(--rule)",
        borderLeft: blendedStatus === "bad" ? "2px solid var(--bad)" : `4px solid var(--${blendedStatus})`,
        borderRadius: 12,
        padding: "32px 36px",
        marginBottom: 18,
        display: "grid",
        gridTemplateColumns: "1.1fr 1.2fr",
        gap: 44,
        alignItems: "center",
      }}>
        {/* Left — the number */}
        <div>
          <div className="row gap-3" style={{ marginBottom: 8 }}>
            <span className="eyebrow">Blended margin · all SKUs · all tiers</span>
            {D.quote.target_margin_pct != null && (
              <span className="chip accent" style={{ fontSize: 9 }}>quote target override · {D.quote.target_margin_pct}%</span>
            )}
          </div>
          <div style={{
            fontFamily: "var(--display)", fontSize: 96, fontWeight: 400, letterSpacing: "-0.04em", lineHeight: 0.92,
            color: blendedStatus === "bad" ? "var(--bad)" : "var(--ink)",
          }}>
            {blended.toFixed(1)}<span style={{ fontSize: 44, color: "var(--ink-3)", fontStyle: "italic", marginLeft: 4 }}>%</span>
          </div>
          <div className="mono" style={{ fontSize: 11.5, marginTop: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: `var(--${blendedStatus})`, fontWeight: 500 }}>
            ● {blendedStatus === "good" ? "above target — sendable" : blendedStatus === "warn" ? "below target — soft warning" : "below floor — send blocked"}
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6 }}>
            target {targetMargin}% · floor {floorMargin}% · {flagged.length} line{flagged.length === 1 ? "" : "s"} below floor
          </div>
          {/* Admin override path — only in BELOW FLOOR */}
          {blendedStatus === "bad" && (
            <div style={{
              marginTop: 14,
              padding: "10px 12px",
              background: "var(--paper)",
              border: "1px dashed var(--bad)",
              borderRadius: 6,
              fontSize: 11.5,
              color: "var(--ink-2)",
              lineHeight: 1.45,
            }}>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--bad)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
                ⚿ Admin override path
              </div>
              Send is blocked at the firm-wide floor ({floorMargin}%). Director or above can approve below-floor send with a written reason — Slack DM goes to <span className="mono">@nina (director)</span> or <span className="mono">@sales-leadership</span>. Approval logs to the quote.
            </div>
          )}
        </div>

        {/* Right — the tuning */}
        <div>
          <div className="row gap-3" style={{ marginBottom: 4, justifyContent: "space-between" }}>
            <span className="eyebrow">Global price adjustment</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
              applies to every cell unless overridden
            </span>
          </div>
          <div className="row gap-3" style={{ marginTop: 10 }}>
            <input
              type="range" min="-20" max="40" step="0.5"
              value={globalAdj} onChange={(e) => setGlobalAdj(+e.target.value)}
              style={{ flex: 1 }}
            />
            <span style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 500, minWidth: 70, textAlign: "right" }}>
              {globalAdj > 0 ? "+" : ""}{globalAdj}%
            </span>
          </div>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--ink-4)", marginTop: 4 }}>
            <span>−20%</span><span>0</span><span>+40%</span>
          </div>

          {/* Suggestion */}
          <div style={{
            marginTop: 14,
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            borderRadius: 7,
            padding: "10px 14px",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{ flex: 1, fontSize: 12.5, color: "var(--accent-ink)" }}>
              {Math.abs(suggestedGpa - globalAdj) < 0.5
                ? "You're at the system suggestion."
                : <>System suggests <strong>{suggestedGpa > 0 ? "+" : ""}{suggestedGpa}%</strong> to {blendedStatus === "bad" ? "lift blended above floor" : `land blended at target (${targetMargin}%)`}.</>}
            </div>
            <button className="btn accent sm" onClick={() => setGlobalAdj(suggestedGpa)} disabled={Math.abs(suggestedGpa - globalAdj) < 0.5}>
              Apply
            </button>
          </div>
        </div>
      </div>

      {/* Healthy — headroom + competitive insights */}
      {scenario === "healthy" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 18 }}>
          <div className="card" style={{ padding: "14px 18px" }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Most headroom</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 22, letterSpacing: "-0.015em" }}>
              {headroom.sku.label} · {headroom.tier.label}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--good)", marginTop: 4 }}>
              {headroom.margin.toFixed(1)}% · {(headroom.margin - targetMargin).toFixed(1)}pp above target
            </div>
          </div>
          <div className="card" style={{ padding: "14px 18px" }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Client benchmark</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 22, letterSpacing: "-0.015em" }}>
              {competitivenessOver.length === 0 ? "All competitive" : `${competitivenessOver.length} over`}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: competitivenessOver.length === 0 ? "var(--good)" : "var(--warn)", marginTop: 4 }}>
              vs client_target_price_per_unit · {allCells.filter(c => c.clientTarget != null).length} of {allCells.length} cells benchmarked
            </div>
          </div>
          <div className="card" style={{ padding: "14px 18px" }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>0 lines need review</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 22, letterSpacing: "-0.015em" }}>
              You can send.
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>
              all margins above floor · global adj {globalAdj > 0 ? "+" : ""}{globalAdj}%
            </div>
          </div>
        </div>
      )}

      {/* Per-(SKU, tier) — cards with active-tier emphasis + per-tier adj rail (9.2) */}
      <div className="section-head">
        <h2>Per-SKU breakdown <em>· active tier {D.tiers.find(t => t.id === activeTier).label}</em></h2>
        <div className="row gap-2">
          {D.tiers.map(t => (
            <button key={t.id}
              onClick={() => setActiveTier(t.id)}
              className={"btn sm" + (t.id === activeTier ? " primary" : " ghost")}
              style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
              {t.label}
              {perTierAdj[t.id] != null && <span style={{ marginLeft: 4, color: "var(--accent)" }}>•</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Per-tier adjustment override (9.2) — quietly above the breakdown */}
      <div className="card" style={{ marginBottom: 12, padding: "12px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div className="eyebrow" style={{ flexShrink: 0 }}>
          {D.tiers.find(t => t.id === activeTier).label} · price adjustment
        </div>
        <div className="row gap-3" style={{ flex: 1 }}>
          <input
            type="range" min="-20" max="40" step="0.5"
            value={perTierAdj[activeTier] ?? globalAdj}
            onChange={(e) => setPerTierAdj({ ...perTierAdj, [activeTier]: +e.target.value })}
            style={{ flex: 1 }}
          />
          <span className="mono" style={{ fontSize: 13, fontWeight: 500, minWidth: 60, textAlign: "right" }}>
            {(perTierAdj[activeTier] ?? globalAdj) > 0 ? "+" : ""}{(perTierAdj[activeTier] ?? globalAdj).toFixed(1)}%
          </span>
          <button className="btn sm ghost"
            onClick={() => { const n = { ...perTierAdj }; delete n[activeTier]; setPerTierAdj(n); }}
            disabled={perTierAdj[activeTier] == null}>
            ↺ inherit global
          </button>
        </div>
        <div className="mono" style={{ fontSize: 11, color: perTierAdj[activeTier] != null ? "var(--accent-ink)" : "var(--ink-4)" }}>
          {perTierAdj[activeTier] != null ? "OVERRIDE active" : "inheriting global"}
        </div>
      </div>

      {/* SKU rows */}
      <div className="col gap-2">
        {matrix.map(row => {
          const active = row.tiers.find(t => t.tier.id === activeTier);
          return (
            <div key={row.sku.id} className="card" style={{
              borderLeft: active.marginStatus === "bad" ? "3px solid var(--bad)" : undefined,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.4fr 1.5fr 1.4fr", gap: 0 }}>
                {/* SKU identity */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--rule)" }}>
                  <div className="row gap-2" style={{ marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{row.sku.label}</span>
                    {active.marginStatus === "bad" && <span className="chip bad" style={{ fontSize: 9 }}>UNDERPRICED</span>}
                  </div>
                  <div style={{ fontFamily: "var(--display)", fontSize: 17, letterSpacing: "-0.01em" }}>{row.sku.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 2 }}>{row.sku.pack}</div>
                </div>

                {/* Cost → sell */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--rule)" }}>
                  <p className="eyebrow" style={{ marginBottom: 4, fontSize: 9.5 }}>Contribution → required sell</p>
                  <div className="mono" style={{ fontSize: 13 }}>
                    ${active.contributionCost.toFixed(2)} <span className="muted">→</span>
                    {/* Per-cell sell override (9.3 — per cell, not page mode) */}
                    <button
                      onClick={() => setOpenCellOverride(`${row.sku.id}:${active.tier.id}`)}
                      style={{
                        fontFamily: "var(--mono)", fontSize: 13, fontWeight: 500,
                        color: active.isOverride ? "var(--accent-ink)" : "var(--ink)",
                        background: active.isOverride ? "var(--accent-soft)" : "transparent",
                        padding: "1px 6px", borderRadius: 4, marginLeft: 4,
                        border: active.isOverride ? "1px solid var(--accent)" : "1px dashed var(--rule-2)",
                      }}
                      title={active.isOverride ? "Sell price overridden — click to edit or revert" : "Click to override sell price for this cell"}
                    >
                      ${active.sell.toFixed(2)}
                      {active.isOverride && <span style={{ marginLeft: 4, fontSize: 9 }}>OVR</span>}
                    </button>
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 4 }}>
                    retail ${row.sku.retail} · {((active.sell / row.sku.retail) * 100).toFixed(0)}% of retail
                  </div>
                  {openCellOverride === `${row.sku.id}:${active.tier.id}` && (
                    <div style={{
                      marginTop: 8,
                      padding: 10,
                      background: "var(--paper-3)", borderRadius: 6,
                      border: "1px solid var(--accent)",
                    }}>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>Override sell price</div>
                      <div className="row gap-2">
                        <input
                          type="number" step="0.01"
                          defaultValue={active.sell.toFixed(2)}
                          onBlur={(e) => {
                            setPerCellOverride({ ...perCellOverride, [`${row.sku.id}:${active.tier.id}`]: +e.target.value });
                            setOpenCellOverride(null);
                          }}
                          autoFocus
                          style={{
                            flex: 1, fontFamily: "var(--mono)", fontSize: 13,
                            background: "var(--paper)", border: "1px solid var(--rule)",
                            padding: "5px 8px", borderRadius: 4, color: "var(--ink)",
                          }}
                        />
                        <button className="btn sm ghost" onClick={() => {
                          const n = { ...perCellOverride }; delete n[`${row.sku.id}:${active.tier.id}`]; setPerCellOverride(n);
                          setOpenCellOverride(null);
                        }}>↺ revert</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Margin verdict */}
                <div style={{ padding: "16px 20px", borderRight: "1px solid var(--rule)" }}>
                  <p className="eyebrow" style={{ marginBottom: 4, fontSize: 9.5 }}>Margin · {active.tier.label}</p>
                  <div style={{
                    fontFamily: "var(--display)", fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1,
                    color: `var(--${active.marginStatus})`, marginBottom: 10,
                  }}>
                    {active.margin.toFixed(1)}<span style={{ fontSize: 14, opacity: 0.7 }}>%</span>
                  </div>
                  <TwoAxisVerdict marginStatus={active.marginStatus} competitiveStatus={active.competitive} />
                  {active.clientTarget != null && (
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 6 }}>
                      client target ${active.clientTarget.toFixed(2)} · gap ${(active.sell - active.clientTarget).toFixed(2)}
                      {active.competitive === "over" && (
                        <button className="btn sm ghost" style={{ marginLeft: 8, fontSize: 10, padding: "1px 6px" }}
                          onClick={() => setPerCellOverride({ ...perCellOverride, [`${row.sku.id}:${active.tier.id}`]: active.clientTarget })}>
                          → match target
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* All tiers comparison */}
                <div style={{ padding: "16px 20px" }}>
                  <p className="eyebrow" style={{ marginBottom: 6, fontSize: 9.5 }}>All tiers</p>
                  <div className="col" style={{ gap: 5 }}>
                    {row.tiers.map(t => {
                      const isAct = t.tier.id === activeTier;
                      return (
                        <div key={t.tier.id} className="row" style={{ gap: 8, alignItems: "center", fontSize: 11, opacity: isAct ? 1 : 0.65 }}>
                          <span className="mono" style={{ width: 36, color: "var(--ink-4)" }}>{(t.tier.quantity / 1000).toFixed(0)}k</span>
                          <div style={{ flex: 1 }}>
                            <MarginMeter value={t.margin} compact />
                          </div>
                          <span className="mono" style={{ width: 50, textAlign: "right", color: `var(--${t.marginStatus})`, fontWeight: 500 }}>
                            {t.margin.toFixed(1)}%
                          </span>
                          {t.isOverride && <span className="chip accent" style={{ fontSize: 8, padding: "1px 4px" }}>OVR</span>}
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
