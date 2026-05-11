/* global React, NXR2 */
const { useState: useStateB, useMemo: useMemoB, useEffect: useEffectB, useRef: useRefB } = React;

// ─── Mini margin meter — 0-50% range, floor + target marks ─────
function MarginMeter({ value, floor = 25, target = 35, max = 50, compact = false }) {
  if (value == null) {
    return (
      <div className="margin-meter" style={{ height: compact ? 14 : 22 }}>
        <div className="track" style={{ background: "var(--paper-4)", opacity: 0.6, top: compact ? 5 : 9 }} />
      </div>
    );
  }
  const status = value >= target ? "good" : value >= floor ? "warn" : "bad";
  const pos = Math.min(Math.max((value / max) * 100, 1), 99);
  const floorPos = (floor / max) * 100;
  const targetPos = (target / max) * 100;

  return (
    <div className="margin-meter" style={{ height: compact ? 14 : 22 }}>
      <div className="track" style={{
        background: `linear-gradient(to right,
          oklch(from var(--bad)  l c h / 0.35) 0% ${floorPos}%,
          oklch(from var(--warn) l c h / 0.35) ${floorPos}% ${targetPos}%,
          oklch(from var(--good) l c h / 0.35) ${targetPos}% 100%)`,
        top: compact ? 5 : 9,
      }} />
      {!compact && (
        <>
          <div className="tick" style={{ left: `${floorPos}%` }} />
          <div className="tick-label" style={{ left: `${floorPos}%` }}>{floor}</div>
          <div className="tick" style={{ left: `${targetPos}%` }} />
          <div className="tick-label" style={{ left: `${targetPos}%` }}>{target}</div>
        </>
      )}
      <div className="needle" style={{ left: `${pos}%`, background: `var(--${status})`, height: compact ? 14 : 22 }} />
    </div>
  );
}

// ─── Inline cell — supports focus, keyboard "Enter to leave" ───
function Cell({ value, onChange, prefix = "$", placeholder = "—", focusKey, focusedKey, onFocus, readOnly = false }) {
  const ref = useRefB(null);
  const isFocused = focusKey && focusKey === focusedKey;

  useEffectB(() => {
    if (isFocused && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [isFocused]);

  if (readOnly) {
    return <span className="value mono">{value != null ? `${prefix}${value.toFixed(2)}` : <span className="empty">{placeholder}</span>}</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      {value != null && <span className="mono" style={{ color: "var(--ink-4)", fontSize: 11 }}>{prefix}</span>}
      <input
        ref={ref}
        type="text"
        value={value != null ? value.toFixed(2) : ""}
        placeholder={placeholder}
        onChange={(e) => onChange?.(parseFloat(e.target.value) || null)}
        onFocus={() => onFocus?.(focusKey)}
        className={"cell-input " + (isFocused ? "cell-edit" : "")}
        style={{
          width: 72, textAlign: "right",
          background: "transparent", border: "none",
          fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink)",
          padding: "3px 6px",
          fontWeight: value != null ? 500 : 400,
        }}
      />
    </span>
  );
}

// ─── Cost group — packaging / production / freight ────────────
function CostGroup({ title, accent, owner, ownerRole, viewer, rows, columnHelp, focusedKey, setFocusedKey, onChange }) {
  const [open, setOpen] = useStateB(true);
  const owned = viewer === ownerRole || viewer === "u_maya";
  const filled = rows.filter(r => r.unit_cost != null).length;
  const empty = rows.length - filled;
  const total = rows.filter(r => r.unit_cost != null).reduce((a, r) => a + r.unit_cost, 0);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-head" onClick={() => setOpen(!open)} style={{ cursor: "pointer", padding: "10px 16px" }}>
        <div className="row gap-3">
          <span style={{ width: 6, height: 22, background: accent, borderRadius: 3 }} />
          <h3 style={{ fontSize: 14 }}>{title}</h3>
          <span className="chip" style={{ fontSize: 9.5 }}>
            owned by {owner}
          </span>
          {!owned && <span className="chip" style={{ fontSize: 9.5, opacity: 0.7 }}>read-only · viewing as {viewer === "u_tomas" ? "Purchasing" : viewer === "u_jin" ? "Production" : "Logistics"}</span>}
        </div>
        <div className="row gap-3">
          {empty > 0 && <span className="chip warn" style={{ fontSize: 9.5 }}>{empty} empty</span>}
          {empty === 0 && rows.length > 0 && <span className="chip good" style={{ fontSize: 9.5 }}>complete</span>}
          {rows.length === 0 && <span className="chip" style={{ fontSize: 9.5 }}>no rows yet</span>}
          <span className="mono" style={{ fontSize: 13, color: "var(--ink)", minWidth: 70, textAlign: "right", fontWeight: 500 }}>
            {total > 0 ? `$${total.toFixed(2)}` : "—"}
          </span>
          <span style={{ fontFamily: "var(--mono)", color: "var(--ink-3)", fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        </div>
      </div>
      {open && (
        <>
          {/* Column header */}
          <div className="field" style={{
            background: "transparent",
            borderTop: "none", borderBottom: "1px solid var(--rule)",
            padding: "6px 14px",
            fontSize: 10, fontFamily: "var(--mono)", letterSpacing: "0.08em",
            textTransform: "uppercase", color: "var(--ink-4)",
          }}>
            <span>{columnHelp.label}</span>
            <span style={{ textAlign: "right" }}>{columnHelp.markup}</span>
            <span style={{ textAlign: "right" }}>{columnHelp.cost}</span>
          </div>

          {rows.length === 0 && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--ink-4)", fontSize: 12.5, fontStyle: "italic", borderTop: "1px solid var(--rule)" }}>
              No {title.toLowerCase()} rows yet — <button className="btn sm ghost" style={{ display: "inline-flex", padding: "1px 6px", fontSize: 12 }}>+ add row</button>
            </div>
          )}

          {rows.map(r => {
            const focusKey = `${r.id}:cost`;
            const isOverride = r.markup_pct_source === "override";
            const isAlloc = r.allocated_from != null;
            return (
              <div key={r.id} className={"field" + (r.unit_cost == null ? " empty" : "") + (!owned ? " read-only" : "")}>
                <div className="label">
                  <div>
                    <div className="name">
                      {r.component_name || r.fee_name || r.line_name}
                      {r.fresh && <span className="fresh-dot" title="Updated since you were last here" />}
                    </div>
                    <div className="meta">
                      {r.category}
                      {r.supplier && ` · ${r.supplier}`}
                      {r.allocated_from && ` · allocated ${r.allocated_from}`}
                      {r.freight_treatment && ` · ${r.freight_treatment === "bundled" ? "bundled with unit" : "passes through to customer"}`}
                    </div>
                  </div>
                </div>
                <span className={"markup" + (isOverride ? " override" : "")}>
                  {isAlloc ? "allocated" : `+${r.markup_pct}%`}
                  {isOverride && <span title="Overridden from category default" style={{ marginLeft: 4 }}>•</span>}
                </span>
                <div style={{ textAlign: "right" }}>
                  <Cell
                    value={r.unit_cost}
                    onChange={(v) => onChange?.(r.id, v)}
                    focusKey={focusKey}
                    focusedKey={focusedKey}
                    onFocus={setFocusedKey}
                    readOnly={!owned}
                    placeholder={r.unit_cost == null ? "awaiting input" : "—"}
                  />
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── The big screen ───────────────────────────────────────────
function CostBuild({ stage = "tunable", viewer = "u_maya" }) {
  const D = window.NXR2;
  const [activeTier, setActiveTier] = useStateB("t2");
  const [activeSku] = useStateB("s2");
  const [focusedKey, setFocusedKey] = useStateB(null);
  const [tierAdjLocal, setTierAdjLocal] = useStateB({}); // local override demo

  const sku = D.skus.find(s => s.id === activeSku);

  // Filter rows for active SKU+tier, but stage-mutate to show empty/partial
  const rawPkg  = D.packaging_inputs.filter(r => r.quote_sku_id === activeSku && r.tier_id === activeTier);
  const rawProd = D.production_inputs.filter(r => r.quote_sku_id === activeSku && r.tier_id === activeTier);
  const rawFrt  = D.freight_inputs.filter(r => r.quote_sku_id === activeSku && r.tier_id === activeTier);

  const stagedRows = useMemoB(() => {
    if (stage === "empty") {
      return {
        pkg: [], // Day 1 — fields not even seeded
        prod: [],
        frt: [],
      };
    }
    if (stage === "partial") {
      return {
        pkg: rawPkg.map((r, i) => i < 3 ? r : { ...r, unit_cost: null }),
        prod: rawProd.map(r => ({ ...r, unit_cost: null })),
        frt: rawFrt.map(r => ({ ...r, unit_cost: null })),
      };
    }
    return { pkg: rawPkg, prod: rawProd, frt: rawFrt };
  }, [stage, activeTier, activeSku]);

  // Compute math
  const math = useMemoB(() => {
    // Re-derive on staged rows so the visible numbers match what's on screen
    const pkgCost = stagedRows.pkg.filter(r => r.unit_cost != null).reduce((a, r) => a + r.unit_cost, 0);
    const prodCost = stagedRows.prod.filter(r => r.unit_cost != null).reduce((a, r) => a + r.unit_cost, 0);
    const bundled = stagedRows.frt.filter(r => r.freight_treatment === "bundled" && r.unit_cost != null);
    const passThrough = stagedRows.frt.filter(r => r.freight_treatment === "pass_through" && r.unit_cost != null);
    const containerFrt = bundled.reduce((a, r) => a + r.unit_cost, 0);
    const passFrt = passThrough.reduce((a, r) => a + r.unit_cost, 0);
    const dutyAmt = containerFrt * (sku.duty_pct / 100);
    const tariffAmt = containerFrt * (sku.tariff_pct / 100);
    const frtMarkup = bundled[0]?.markup_pct ?? 15;
    const landedFrt = (containerFrt + dutyAmt + tariffAmt) * (1 + frtMarkup / 100);

    const sumWith = (arr) => arr.filter(r => r.unit_cost != null).reduce((a, r) => a + r.unit_cost * (1 + r.markup_pct / 100), 0);
    const beforeAdj = sumWith(stagedRows.pkg) + sumWith(stagedRows.prod) + landedFrt + sumWith(passThrough);
    const contributionCost = pkgCost + prodCost + containerFrt + dutyAmt + tariffAmt + passFrt;

    const gpa = D.quote.global_price_adj_pct;
    const tierAdj = tierAdjLocal[activeTier] ?? D.tiers.find(t => t.id === activeTier).tier_price_adj_pct;
    const effectiveAdj = tierAdj != null ? tierAdj : gpa;

    const requiredSell = beforeAdj * (1 + effectiveAdj / 100);
    const margin = requiredSell > 0 ? ((requiredSell - contributionCost) / requiredSell) * 100 : 0;

    return { pkgCost, prodCost, containerFrt, passFrt, dutyAmt, tariffAmt, landedFrt, beforeAdj, contributionCost, requiredSell, margin, effectiveAdj, gpa, tierAdj, frtMarkup };
  }, [stagedRows, activeTier, tierAdjLocal, sku]);

  const totalSell = math.requiredSell;
  const stackPct = (n) => totalSell > 0 ? `${((n / totalSell) * 100).toFixed(1)}%` : "0%";

  const stageHelpers = {
    empty: {
      lead: "No costs in yet. Most quotes start with packaging — add the line items, then drop in costs as suppliers come back.",
      cta: "+ Seed packaging from template",
    },
    partial: {
      lead: <>{stagedRows.pkg.filter(r => r.unit_cost == null).length + stagedRows.prod.filter(r => r.unit_cost == null).length + stagedRows.frt.filter(r => r.unit_cost == null).length} fields awaiting input. Margin can’t lock until they’re filled or struck.</>,
      cta: null,
    },
    tunable: {
      lead: null,
      cta: null,
    },
  }[stage];

  // Presence (backlog item; design assumes it ships)
  const presenceHere = [D.users.u_tomas, D.users.u_jin].filter(u => {
    if (viewer === "u_maya") return true;
    return u.id !== viewer;
  });

  return (
    <div className="page" data-screen-label={`Cost Build · ${stage} · viewing as ${viewer}`}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Cost Build · {D.project.client} / Quote v{D.quote.version_number}</p>
          <h1 className="page-title">{sku.name} <em>·</em> {sku.label}</h1>
          <p className="page-sub">
            <span className="mono">{sku.pack}</span> · {D.tiers.find(t => t.id === activeTier).label} · {(D.tiers.find(t => t.id === activeTier).quantity / 1000).toFixed(0)}k units · viewing as <strong>{D.users[viewer].name}</strong>
          </p>
        </div>
        <div className="row gap-2">
          <button className="btn ghost sm">← All SKUs</button>
          <button className="btn">Costing Sheet →</button>
        </div>
      </div>

      {/* Scoped help — never the wishful "next action" */}
      {stageHelpers.lead && (
        <div style={{
          padding: "10px 16px",
          background: "var(--paper-2)",
          border: "1px solid var(--rule)",
          borderLeft: "3px solid var(--accent)",
          borderRadius: 6,
          marginBottom: 16,
          fontSize: 13,
          color: "var(--ink-2)",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16,
        }}>
          <span>{stageHelpers.lead}</span>
          {stageHelpers.cta && <button className="btn sm">{stageHelpers.cta}</button>}
        </div>
      )}

      {/* Three-column workspace: tier rail · cost groups + stack · live presence */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr 240px", gap: 16, alignItems: "start" }}>

        {/* LEFT — Tier comparison rail */}
        <div className="col gap-3" style={{ position: "sticky", top: 76 }}>
          <div className="card">
            <div className="card-head"><h3>Tiers · {sku.label}</h3><span className="meta">click to switch</span></div>
            <div style={{ padding: 8 }}>
              {D.tiers.map(t => {
                const isActive = t.id === activeTier;
                let tMargin = null;
                if (stage !== "empty") {
                  // Compute per-tier margin from data
                  const tm = D.tierMath(activeSku, t.id, { tierAdj: tierAdjLocal[t.id] });
                  tMargin = (stage === "partial" && t.id !== "t1") ? null : tm.margin;
                  if (stage === "partial" && t.id === activeTier) tMargin = math.margin > 0 ? math.margin : null;
                }
                const status = tMargin == null ? "muted" : tMargin >= 35 ? "good" : tMargin >= 25 ? "warn" : "bad";
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTier(t.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 7,
                      background: isActive ? "var(--paper-4)" : "transparent",
                      border: isActive ? "1px solid var(--rule-2)" : "1px solid transparent",
                      marginBottom: 4,
                      display: "block",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                      <div>
                        <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{t.label}</div>
                        <div style={{ fontFamily: "var(--display)", fontSize: 16, color: "var(--ink)", letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                          {(t.quantity / 1000).toFixed(0)}k <span style={{ fontSize: 10, color: "var(--ink-4)", fontFamily: "var(--ui)" }}>units</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="mono" style={{ fontSize: 13, color: status === "muted" ? "var(--ink-4)" : `var(--${status})`, fontWeight: 500 }}>
                          {tMargin != null ? `${tMargin.toFixed(1)}%` : "—"}
                        </div>
                      </div>
                    </div>
                    <MarginMeter value={tMargin} compact />
                    {t.client_target_price_per_unit != null && stage !== "empty" && (
                      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-4)", marginTop: 4, letterSpacing: "0.04em" }}>
                        client target · ${t.client_target_price_per_unit.toFixed(2)}/u
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* SKU jumper — no completion dots; just labels + filled count */}
          <div className="card">
            <div className="card-head"><h3>SKUs · {D.skus.length}</h3></div>
            <div style={{ padding: 8 }}>
              {D.skus.map(s => {
                const isActive = s.id === activeSku;
                return (
                  <button key={s.id}
                    style={{
                      width: "100%", textAlign: "left",
                      padding: "7px 10px",
                      borderRadius: 6,
                      background: isActive ? "var(--paper-4)" : "transparent",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      gap: 8, marginBottom: 1,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12.5 }}>{s.label}</div>
                      <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{s.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* CENTER — cost groups + persistent stack */}
        <div>
          <CostGroup
            title="Packaging"
            accent="oklch(0.55 0.10 250)"
            owner="Purchasing"
            ownerRole="u_tomas"
            viewer={viewer}
            rows={stagedRows.pkg}
            columnHelp={{ label: "Component · category · supplier", markup: "markup", cost: "cost / unit" }}
            focusedKey={focusedKey}
            setFocusedKey={setFocusedKey}
          />
          <CostGroup
            title="Production"
            accent="oklch(0.50 0.10 215)"
            owner="Production"
            ownerRole="u_jin"
            viewer={viewer}
            rows={stagedRows.prod}
            columnHelp={{ label: "Fee · category", markup: "markup", cost: "cost / unit" }}
            focusedKey={focusedKey}
            setFocusedKey={setFocusedKey}
          />
          <CostGroup
            title="Freight"
            accent="oklch(0.55 0.10 195)"
            owner="Logistics"
            ownerRole="u_freight"
            viewer={viewer}
            rows={stagedRows.frt}
            columnHelp={{ label: "Line · category · treatment", markup: "markup", cost: "cost / unit" }}
            focusedKey={focusedKey}
            setFocusedKey={setFocusedKey}
          />

          {/* INTERNAL ZONE — duty + tariff + CBM */}
          {stage !== "empty" && stagedRows.frt.some(r => r.freight_treatment === "bundled" && r.unit_cost != null) && (
            <div className="internal-zone" style={{ marginBottom: 12 }}>
              <span className="ribbon">Internal · never on customer quote</span>
              <div style={{ marginTop: 4 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--internal)" }}>
                  Customs &amp; landed cost · math only
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 16, alignItems: "baseline", fontSize: 12 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--internal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>SKU CBM share</div>
                    <div className="mono" style={{ fontSize: 13, marginTop: 2 }}>{stagedRows.frt[0]?.sku_total_cbm?.toFixed(4) ?? "—"} m³</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--internal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Duty · HS auto</div>
                    <div className="mono" style={{ fontSize: 13, marginTop: 2 }}>{sku.duty_pct.toFixed(1)}% → ${math.dutyAmt.toFixed(2)}/u</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--internal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Tariff</div>
                    <div className="mono" style={{ fontSize: 13, marginTop: 2 }}>{sku.tariff_pct.toFixed(1)}% → ${math.tariffAmt.toFixed(2)}/u</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--internal)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Landed freight w/ markup</div>
                    <div className="mono" style={{ fontSize: 13, marginTop: 2, color: "var(--ink)" }}>${math.landedFrt.toFixed(2)}/u</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--internal)", marginTop: 10, fontStyle: "italic", lineHeight: 1.5 }}>
                  Bundled-freight lines roll into the unit price the customer sees. Pass-through lines surface as their own line on the customer quote. Duty, tariff, and CBM never leave this page.
                </div>
              </div>
            </div>
          )}

          {/* PERSISTENT COST STACK */}
          <div className="card" style={{ position: "sticky", bottom: 12 }}>
            <div className="card-head" style={{ padding: "10px 16px" }}>
              <h3>How this number is built</h3>
              <span className="meta">live · {math.margin > 0 ? `margin ${math.margin.toFixed(1)}%` : "awaiting inputs"}</span>
            </div>
            <div style={{ padding: 16 }}>
              {stage === "empty" || math.requiredSell === 0 ? (
                <div style={{
                  height: 36,
                  border: "1px dashed var(--rule-2)",
                  borderRadius: 6,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-4)",
                  letterSpacing: "0.06em",
                }}>
                  Pkg + Prod + Frt + Customs + Markup + Adj → Required sell
                </div>
              ) : (
                <>
                  <p style={{
                    fontSize: 11.5, color: "var(--ink-3)", margin: "0 0 12px",
                    fontStyle: "italic", lineHeight: 1.5,
                  }}>
                    One row per component: <strong style={{ color: "var(--ink-2)", fontStyle: "normal" }}>solid bar</strong> = contribution cost,
                    <strong style={{ color: "var(--ink-2)", fontStyle: "normal" }}> hatched extension</strong> = that component's markup.
                    The global adjustment is the only thing that applies to the whole stack.
                  </p>
                  {(() => {
                    // Build per-component rows. Each row's bar is sized within its own row,
                    // so labels never collide. Width of (cost + markup) is normalized to the
                    // largest "withMarkup" value across rows so visual proportions read true.
                    const segments = [
                      { key: "pkg",  label: "Pkg",  cost: math.pkgCost,        withMarkup: math.pkgCost * 1.35,  markupPct: 35 },
                      { key: "prod", label: "Prod", cost: math.prodCost,       withMarkup: math.prodCost * 1.27, markupPct: 27 },
                      { key: "frt",  label: "Frt",  cost: math.containerFrt,   withMarkup: math.landedFrt - math.dutyAmt - math.tariffAmt, markupPct: math.frtMarkup },
                      { key: "duty", label: "D+T",  cost: math.dutyAmt + math.tariffAmt, withMarkup: (math.dutyAmt + math.tariffAmt) * (1 + math.frtMarkup / 100), markupPct: math.frtMarkup, internal: true },
                      { key: "pass", label: "Pass", cost: math.passFrt,        withMarkup: math.passFrt, markupPct: 0, noMarkup: true },
                    ].filter(s => s.cost > 0);

                    const maxWith = Math.max(...segments.map(s => s.withMarkup), 0.01);
                    const totalCost = segments.reduce((a, s) => a + s.cost, 0);
                    const totalWith = segments.reduce((a, s) => a + s.withMarkup, 0);
                    const adjAmt = math.requiredSell - totalWith;

                    return (
                      <div className="cstack">
                        {segments.map((s, i) => {
                          const totalRowPct = (s.withMarkup / maxWith) * 100;
                          const baseRatio = s.withMarkup > 0 ? s.cost / s.withMarkup : 1;
                          const isTiny = totalRowPct < 12; // bars under ~12% of max width can't fit labels legibly
                          return (
                            <React.Fragment key={i}>
                              <div className={"row-label" + (s.key === "pass" ? " pass" : "")}>
                                {s.key === "duty" ? "D + T" : s.label}
                                {s.internal && <span style={{ color: "var(--internal)", marginLeft: 3 }}>•</span>}
                              </div>
                              <div className={`bar ${s.key}${isTiny ? " tiny" : ""}`} style={{ width: `${Math.max(totalRowPct, 4)}%` }}>
                                <div className="seg-base" style={{ flex: baseRatio }}>
                                  <span>${s.cost.toFixed(2)}</span>
                                </div>
                                {!s.noMarkup && s.withMarkup > s.cost && (
                                  <div className="seg-markup" style={{ flex: 1 - baseRatio }}>
                                    <span>+{s.markupPct.toFixed(0)}%</span>
                                  </div>
                                )}
                              </div>
                              <div className="row-amount">
                                ${s.withMarkup.toFixed(2)}
                                {!s.noMarkup && s.withMarkup > s.cost && isTiny && (
                                  <span className="muted" style={{ fontSize: 9.5, marginLeft: 4 }}>
                                    (${s.cost.toFixed(2)} +{s.markupPct.toFixed(0)}%)
                                  </span>
                                )}
                              </div>
                            </React.Fragment>
                          );
                        })}

                        {/* Subtotal before adjustment */}
                        <div className="row-divider"></div>
                        <div className="row-label" style={{ fontSize: 9.5 }}>Subtotal</div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
                          contribution ${totalCost.toFixed(2)} + markup ${(totalWith - totalCost).toFixed(2)}
                        </div>
                        <div className="row-amount" style={{ color: "var(--ink-2)" }}>${totalWith.toFixed(2)}</div>

                        {/* Global/tier adjustment row — the only legitimate "tail" */}
                        {Math.abs(adjAmt) > 0.005 && (
                          <>
                            <div className="row-label" style={{ color: "var(--accent-ink)" }}>× ADJ</div>
                            <div className={`bar adj`} style={{ width: `${Math.min(Math.abs(adjAmt) / maxWith * 100, 100)}%` }}>
                              <div className="seg-base">
                                {math.tierAdj != null ? `tier ${math.effectiveAdj > 0 ? "+" : ""}${math.effectiveAdj}%` : `global ${math.effectiveAdj > 0 ? "+" : ""}${math.effectiveAdj}%`} · whole stack
                              </div>
                            </div>
                            <div className="row-amount" style={{ color: "var(--accent-ink)" }}>{adjAmt > 0 ? "+" : ""}${adjAmt.toFixed(2)}</div>
                          </>
                        )}

                        {/* Total */}
                        <div className="row-divider"></div>
                        <div className="row-label row-total">Sell /u</div>
                        <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
                          margin <span style={{ color: math.margin >= 35 ? "var(--good)" : math.margin >= 25 ? "var(--warn)" : "var(--bad)" }}>{math.margin.toFixed(1)}%</span>
                        </div>
                        <div className="row-amount row-total">${math.requiredSell.toFixed(2)}</div>
                      </div>
                    );
                  })()}
                  <div className="row" style={{ justifyContent: "flex-start", gap: 18, marginTop: 12, fontSize: 10, color: "var(--ink-4)", fontFamily: "var(--mono)", letterSpacing: "0.04em", flexWrap: "wrap" }}>
                    <span>▰ contribution cost</span>
                    <span>▱ component markup (hatched)</span>
                    <span style={{ color: "var(--internal)" }}>• internal-only (D+T not on customer quote)</span>
                    <span style={{ color: "var(--accent-ink)" }}>× adjustment (whole stack)</span>
                  </div>
                </>
              )}

              {/* Totals row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16, marginTop: 16, borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
                <div>
                  <p className="eyebrow" style={{ fontSize: 9.5 }}>Contribution cost</p>
                  <div className="mono" style={{ fontSize: 16, marginTop: 2 }}>{stage === "empty" ? "—" : `$${math.contributionCost.toFixed(2)}`}</div>
                </div>
                <div>
                  <p className="eyebrow" style={{ fontSize: 9.5 }}>+ markup</p>
                  <div className="mono" style={{ fontSize: 16, marginTop: 2 }}>{stage === "empty" ? "—" : `$${(math.beforeAdj - math.contributionCost).toFixed(2)}`}</div>
                </div>
                <div>
                  <p className="eyebrow" style={{ fontSize: 9.5 }}>{math.tierAdj != null ? "Tier adj" : "Global adj"}</p>
                  <div className="mono" style={{ fontSize: 16, marginTop: 2, color: "var(--accent-ink)" }}>{stage === "empty" ? "—" : `+${math.effectiveAdj}%`}</div>
                </div>
                <div>
                  <p className="eyebrow" style={{ fontSize: 9.5 }}>Required sell · /unit</p>
                  <div style={{ fontFamily: "var(--display)", fontSize: 22, marginTop: 0, color: "var(--ink)", letterSpacing: "-0.015em" }}>
                    {stage === "empty" ? "—" : `$${math.requiredSell.toFixed(2)}`}
                  </div>
                </div>
              </div>

              {/* Margin verdict strip */}
              {stage !== "empty" && math.margin > 0 && (
                <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--paper-3)", borderRadius: 6 }}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <span className="eyebrow">Margin · this tier</span>
                    <span className="mono" style={{ fontSize: 13, color: math.margin >= 35 ? "var(--good)" : math.margin >= 25 ? "var(--warn)" : "var(--bad)", fontWeight: 500 }}>
                      {math.margin.toFixed(1)}% · {math.margin >= 35 ? "GOOD" : math.margin >= 25 ? "BELOW TARGET" : "BELOW FLOOR"}
                    </span>
                  </div>
                  <MarginMeter value={math.margin} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — presence + open Nexus, type, leave */}
        <div className="col gap-3" style={{ position: "sticky", top: 76 }}>
          <div className="card">
            <div className="card-head" style={{ padding: "10px 14px" }}>
              <h3>Live · {presenceHere.length} here</h3>
            </div>
            <div className="card-body" style={{ paddingTop: 10 }}>
              {presenceHere.length === 0 && (
                <div className="muted" style={{ fontSize: 12 }}>Just you.</div>
              )}
              {presenceHere.map(u => (
                <div key={u.id} className="row gap-3" style={{ marginBottom: 8 }}>
                  <span className="avatar sm">{u.initials}</span>
                  <div>
                    <div style={{ fontSize: 12.5 }}>{u.name}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{u.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head" style={{ padding: "10px 14px" }}>
              <h3>Open Nexus · type · leave</h3>
            </div>
            <div className="card-body" style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55 }}>
              <div style={{ marginBottom: 10 }}>
                Every cell is a deep link. The notification email Tomás gets when his ocean freight quote arrives lands him directly here — focused on the cell, ready to type.
              </div>
              <button className="btn sm ghost" style={{ width: "100%", justifyContent: "center", marginBottom: 6 }}
                onClick={() => setFocusedKey(`pkg-s2-t2-Alu:cost`)}>
                ⚡ Demo · focus aluminum collar
              </button>
              <button className="btn sm ghost" style={{ width: "100%", justifyContent: "center" }}
                onClick={() => setFocusedKey(null)}>
                Clear focus
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.CostBuild = CostBuild;
window.MarginMeter = MarginMeter;
