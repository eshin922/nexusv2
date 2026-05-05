/* global React, NX_DATA, MarginVerdict */
const { useState: useStateB, useMemo: useMemoB } = React;

// ── Mini margin meter — used in tier sidecar ─────────
function MarginMeter({ value, floor, target, max = 50 }) {
  const status = value >= target ? "good" : value >= floor ? "warn" : "bad";
  const pos = Math.min(Math.max((value / max) * 100, 2), 98);
  const floorPos = (floor / max) * 100;
  const targetPos = (target / max) * 100;
  return (
    <div style={{ position: "relative", height: 18 }}>
      <div style={{
        position: "absolute", top: 7, left: 0, right: 0, height: 4,
        borderRadius: 2,
        background: `linear-gradient(to right,
          var(--bad-soft) 0% ${floorPos}%,
          var(--warn-soft) ${floorPos}% ${targetPos}%,
          var(--good-soft) ${targetPos}% 100%)`
      }} />
      <div style={{
        position: "absolute", top: 0, left: `${pos}%`,
        width: 2, height: 18, background: `var(--${status})`, transform: "translateX(-1px)"
      }} />
    </div>
  );
}

// ── Cost group (packaging / production / freight) ────
function CostGroup({ title, lines, role, total, viewer, defaultOpen = true, accent }) {
  const [open, setOpen] = useStateB(defaultOpen);
  const filled = lines.filter(l => l.cost != null).length;
  const empty = lines.length - filled;
  const owned = viewer === role || viewer === "pm";

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head" style={{ cursor: "pointer" }} onClick={() => setOpen(!open)}>
        <div className="row gap-3">
          <span style={{
            width: 8, height: 8, borderRadius: 2, background: accent,
            display: "inline-block"
          }} />
          <h3>{title}</h3>
          <span className="chip muted" style={{ fontSize: 10 }}>
            owned by {role === "purch" ? "Purchasing" : role === "prod" ? "Production" : "Freight desk"}
          </span>
          {!owned && <span className="chip muted" style={{ fontSize: 10, opacity: 0.7 }}>read-only for you</span>}
        </div>
        <div className="row gap-3">
          {empty > 0 && <span className="chip warn" style={{ fontSize: 10 }}>{empty} empty</span>}
          {empty === 0 && lines.length > 0 && <span className="chip good" style={{ fontSize: 10 }}>complete</span>}
          <span className="mono" style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500, minWidth: 70, textAlign: "right" }}>
            {total != null ? `$${total.toFixed(2)}` : "—"}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)" }}>{open ? "▾" : "▸"}</span>
        </div>
      </div>
      {open && (
        <div className="card-body" style={{ padding: 0 }}>
          {lines.map(l => (
            <div className={"line" + (l.cost == null ? " empty" : "")} key={l.id}
              style={{ cursor: owned ? "pointer" : "default", opacity: owned ? 1 : 0.78 }}>
              <div className="lab">
                <span className="name">
                  {l.name}
                  {l.supplier && <span className="sub">{l.supplier}{l.note ? ` · ${l.note}` : ""}</span>}
                  {!l.supplier && l.note && <span className="sub">{l.note}</span>}
                </span>
              </div>
              <span className="markup">{l.markup > 0 ? `+${l.markup}%` : (l.allocated ? "allocated" : "—")}</span>
              <span className="price">
                {l.cost != null ? `$${l.cost.toFixed(2)}` : <span className="empty">awaiting {role === "purch" ? "supplier" : role === "prod" ? "fee" : "quote"}</span>}
                {l.fresh && <span className="diff-mark" style={{ display: "inline-block", marginLeft: 8 }}></span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CostBuild({ stage = "tunable", viewer = "pm" }) {
  const D = window.NX_DATA;
  const [activeTier, setActiveTier] = useStateB("t2");
  const [activeSku, setActiveSku] = useStateB("s2");
  const [globalAdj, setGlobalAdj] = useStateB(stage === "tunable" ? 8 : 0);

  const sku = D.skus.find(s => s.id === activeSku);
  const tier = D.tiers.find(t => t.id === activeTier);

  // Build lines per stage
  const baseLines = D.costLines;
  const stagedLines = useMemoB(() => {
    if (stage === "empty") return {
      pkg: baseLines.pkg.map(l => ({ ...l, cost: null, fresh: false })),
      prod: baseLines.prod.map(l => ({ ...l, cost: null, fresh: false })),
      frt: baseLines.frt.map(l => ({ ...l, cost: null, fresh: false })),
    };
    if (stage === "partial") return {
      pkg: baseLines.pkg.map((l, i) => i < 2 ? { ...l } : { ...l, cost: null, fresh: false }),
      prod: baseLines.prod.map(l => ({ ...l, cost: null, fresh: false })),
      frt: baseLines.frt.map(l => ({ ...l, cost: null, fresh: false })),
    };
    return baseLines;
  }, [stage]);

  const sumCat = (arr) => arr.filter(l => l.cost != null).reduce((a, l) => a + l.cost * (l.qty || 1), 0);
  const sumWithMarkup = (arr) => arr.filter(l => l.cost != null).reduce((a, l) => a + l.cost * (l.qty || 1) * (1 + l.markup / 100), 0);
  const pkgCost = sumCat(stagedLines.pkg);
  const prodCost = sumCat(stagedLines.prod);
  const frtCost = sumCat(stagedLines.frt);
  const subtotal = pkgCost + prodCost + frtCost;
  const withMarkup = sumWithMarkup(stagedLines.pkg) + sumWithMarkup(stagedLines.prod) + sumWithMarkup(stagedLines.frt);
  const requiredSell = withMarkup * (1 + globalAdj / 100);
  const margin = requiredSell > 0 ? ((requiredSell - subtotal) / requiredSell) * 100 : 0;

  const stackTotal = subtotal + (withMarkup - subtotal) + (requiredSell - withMarkup);
  const stackPct = (n) => stackTotal > 0 ? (n / stackTotal * 100).toFixed(1) + "%" : "0%";

  // Stage-scoped next-action
  const stageNext = {
    empty: { lead: "Start with what you know.", body: "Drop in any packaging costs you've quoted before — most beauty serums reuse the same dropper bottles. Production fees and freight can wait.", cta: "Add packaging line" },
    partial: { lead: "Production fees missing on Tier 2.", body: "Jin (Production) usually needs 1 day. Bulk raws still missing on this SKU — Tomás was pinged 2h ago. You're waiting on inputs; nothing to do here right now.", cta: "Ping Production" },
    tunable: { lead: "Margin is below target by 0.9pp. Try +10% global adjustment.", body: "Bumping global adjustment to +10% gets you to 35.2% blended. Or tune line markups on the costing sheet for surgical control.", cta: "Apply suggestion · +10%" },
  }[stage];

  const accents = {
    pkg: "oklch(0.55 0.08 250)",
    prod: "oklch(0.50 0.08 220)",
    frt: "oklch(0.55 0.08 195)",
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Cost build · v3 · {stage === "empty" ? "Day 1" : stage === "partial" ? "Day 4 · partial" : "Day 6 · tunable"} · viewing as {viewer === "purch" ? "Purchasing (Tomás)" : viewer === "prod" ? "Production (Jin)" : "PM (Maya)"}</p>
          <h1 className="page-title">{D.project.client} <em>—</em> {sku.name}</h1>
          <p className="page-sub">
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{sku.label}</span>
            &nbsp;· {sku.pack} · editing <strong style={{ color: "var(--ink)" }}>{tier.label} ({(tier.qty/1000)}k units)</strong>
          </p>
        </div>
        <div className="row gap-2">
          <button className="btn ghost sm">Quick edit</button>
          <button className="btn">Costing sheet →</button>
        </div>
      </div>

      {/* Scoped Next-Action — only when there's something to say */}
      {stage !== "empty" && (
        <div className="next-action" style={{ marginBottom: 16 }}>
          <span className="glyph-circle">!</span>
          <div className="body">
            <p className="lead">{stageNext.lead}</p>
            <p className="meta">{stageNext.body}</p>
          </div>
          <button className={"btn " + (stage === "tunable" ? "accent" : "primary")}>{stageNext.cta}</button>
        </div>
      )}

      {/* Persistent verdict — shifts visual weight by stage */}
      {stage === "empty" ? (
        <div className="card" style={{ marginBottom: 16, padding: "26px 28px", display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "var(--paper-2)", border: "1px dashed var(--rule-2)",
            display: "grid", placeItems: "center",
            fontFamily: "var(--display)", fontSize: 22, color: "var(--ink-4)", fontStyle: "italic"
          }}>—</div>
          <div>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Margin · awaiting inputs</p>
            <div style={{ fontFamily: "var(--display)", fontSize: 22, color: "var(--ink-3)", fontStyle: "italic", letterSpacing: "-0.015em" }}>
              We'll compute this once you have at least one packaging cost in.
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <MarginVerdict value={margin} floor={25} target={35} label={`Margin · ${sku.label} / ${tier.label} · live`} />
        </div>
      )}

      {/* Workspace: SKUs · cost groups · tier sidecar */}
      <div className="workspace">
        {/* LEFT — SKU list */}
        <div className="card">
          <div className="card-head">
            <h3>SKUs · 5</h3>
            <span className="meta">completion</span>
          </div>
          <div className="sku-list">
            {D.skus.map((s, i) => (
              <div key={s.id}
                className={"sku-row" + (s.id === activeSku ? " active" : "")}
                onClick={() => setActiveSku(s.id)}>
                <span className="num-tag">{String(i + 1).padStart(2, "0")}</span>
                <div className="sku-name">
                  {s.label}
                  <span className="sub">{s.name}</span>
                </div>
                <div className="completion">
                  {(stage === "empty" ? Array(6).fill("empty") :
                    stage === "partial" ? ["filled","partial","empty","empty","empty","empty"] :
                    s.completion).map((c, j) => (
                    <span key={j} className={"dot " + c} title={c}></span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 14px", borderTop: "1px solid var(--rule)", fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            6 dots = inputs filled per tier
          </div>
        </div>

        {/* CENTER — Cost groups, stacked, with cost stack persistent at bottom */}
        <div>
          <CostGroup title="Packaging" role="purch" lines={stagedLines.pkg} total={pkgCost > 0 ? pkgCost : null} viewer={viewer} accent={accents.pkg} />
          <CostGroup title="Production" role="prod" lines={stagedLines.prod} total={prodCost > 0 ? prodCost : null} viewer={viewer} accent={accents.prod} defaultOpen={stage !== "empty"} />
          <CostGroup title="Freight" role="frt" lines={stagedLines.frt} total={frtCost > 0 ? frtCost : null} viewer={viewer} accent={accents.frt} defaultOpen={stage !== "empty"} />

          {/* Internal customs zone */}
          {stage === "tunable" && (
            <div className="internal-zone" style={{ marginTop: 4, marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--internal)", fontWeight: 500 }}>
                  Customs · for landed-cost math only
                </span>
                <span className="chip internal">Hidden from quote</span>
              </div>
              <div className="row gap-6" style={{ flexWrap: "wrap" }}>
                {D.costLines.frtInternal.map(f => (
                  <div key={f.label} className="col" style={{ gap: 2 }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--internal)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{f.label}</span>
                    <span className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost-stack: persistent at bottom of cost groups, shows the math */}
          <div className="card">
            <div className="card-head">
              <h3>Cost stack · how this number is built</h3>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {stage === "empty" ? "awaiting inputs" : `→ $${requiredSell.toFixed(2)} required sell`}
              </span>
            </div>
            <div style={{ padding: "16px 18px" }}>
              {stage === "empty" ? (
                <div style={{
                  height: 40, borderRadius: 6, border: "1px dashed var(--rule-2)",
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)", letterSpacing: "0.04em"
                }}>
                  Pkg · + Prod · + Frt · + Markup · + Adj  →  Required sell
                </div>
              ) : (
                <div className="stack">
                  {pkgCost > 0 && <div className="seg pkg" style={{ width: stackPct(pkgCost) }}>Pkg ${pkgCost.toFixed(2)}</div>}
                  {prodCost > 0 && <div className="seg prod" style={{ width: stackPct(prodCost) }}>Prod ${prodCost.toFixed(2)}</div>}
                  {frtCost > 0 && <div className="seg frt" style={{ width: stackPct(frtCost) }}>Frt ${frtCost.toFixed(2)}</div>}
                  {(withMarkup - subtotal) > 0 && <div className="seg markup" style={{ width: stackPct(withMarkup - subtotal) }}>+Markup ${(withMarkup - subtotal).toFixed(2)}</div>}
                  {(requiredSell - withMarkup) !== 0 && <div className="seg adj" style={{ width: stackPct(Math.abs(requiredSell - withMarkup)) }}>+Adj {globalAdj}%</div>}
                </div>
              )}
            </div>

            <div className="totals">
              <div className="row sub" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Subtotal · raw cost</span>
                <span className="v">{stage === "empty" ? "—" : `$${subtotal.toFixed(2)}`}</span>
              </div>
              <div className="row sub" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>+ Per-component markup</span>
                <span className="v">{stage === "empty" ? "—" : `$${(withMarkup - subtotal).toFixed(2)}`}</span>
              </div>
              <div className="row sub" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>+ Global price adjustment</span>
                <div className="row gap-3" style={{ flex: 1, marginLeft: 16 }}>
                  <input type="range" min="-15" max="25" value={globalAdj} onChange={e => setGlobalAdj(+e.target.value)}
                    className="slider" style={{ flex: 1, height: 4 }} disabled={stage === "empty"} />
                  <span className="v mono" style={{ minWidth: 56, textAlign: "right" }}>{globalAdj > 0 ? "+" : ""}{globalAdj}%</span>
                </div>
              </div>
              <div className="row grand" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span className="lab">Required sell · per unit</span>
                <span className="v">{stage === "empty" ? "—" : `$${requiredSell.toFixed(2)}`}</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — Tier sidecar with margin-at-a-glance */}
        <div className="col gap-4">
          <div className="card">
            <div className="card-head">
              <h3>Tiers</h3>
              <span className="meta">switch to edit</span>
            </div>
            <div style={{ padding: 8 }}>
              {D.tiers.map(t => {
                const isActive = t.id === activeTier;
                const tMargin = stage === "empty" ? null : (stage === "partial" ? null : t.margin);
                return (
                  <div key={t.id}
                    onClick={() => setActiveTier(t.id)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 8,
                      background: isActive ? "var(--ink)" : "var(--paper-2)",
                      color: isActive ? "var(--paper)" : "var(--ink)",
                      marginBottom: 6,
                      cursor: "pointer",
                    }}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                      <div>
                        <div className="mono" style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.label}</div>
                        <div style={{ fontFamily: "var(--display)", fontSize: 18, letterSpacing: "-0.015em" }}>
                          {(t.qty/1000)}k <span style={{ fontSize: 11, opacity: 0.6, fontFamily: "var(--ui)" }}>units</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="mono" style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.06em", textTransform: "uppercase" }}>margin</div>
                        <div className="mono" style={{ fontSize: 14, fontWeight: 500 }}>
                          {tMargin != null ? `${tMargin.toFixed(1)}%` : "—"}
                        </div>
                      </div>
                    </div>
                    {tMargin != null && <MarginMeter value={tMargin} floor={25} target={35} />}
                    {tMargin == null && (
                      <div style={{ height: 4, background: "var(--rule)", borderRadius: 2, opacity: 0.4 }} />
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "8px 12px", borderTop: "1px solid var(--rule)" }}>
              <button className="btn ghost sm" style={{ width: "100%", justifyContent: "center" }}>
                Copy this tier's setup → next tier
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Live · 2 here</h3>
              <span className="chip good"><span className="dot" />Synced</span>
            </div>
            <div className="card-body" style={{ paddingTop: 10 }}>
              <div className="col gap-3">
                {D.presence.map(u => (
                  <div className="row gap-3" key={u.id}>
                    <span className="avatar sm">{u.id}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5 }}>{u.name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>editing <em>{u.viewing}</em></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CostBuild = CostBuild;
window.MarginMeter = MarginMeter;
