/* global React, PSR */
// ─────────────────────────────────────────────────────────────────────
// Pricing Surface Redesign · mode-aware components
//
// Page shape: STATE → ACTION → DETAIL.
// Each zone consumes the same classifier output object; no surface
// derives its own state.
//
// Sendable        → state line + summary card + Preview CTA + collapsed DETAIL
// Suggestion-led  → state line + state callout + recommended action + demoted CTA + collapsed DETAIL
// Blocked         → state line + state CARD + ranked actions + (accept-risk banner) + collapsed DETAIL
// ─────────────────────────────────────────────────────────────────────

const { useState: useStatePS, useMemo: useMemoPS } = React;

const fmtPct  = v => v == null ? "—" : (v * 100).toFixed(1);
const fmtPct0 = v => v == null ? "—" : (v * 100).toFixed(0);
const fmtUsd  = v => v == null ? "—" : "$" + Math.round(v).toLocaleString();
const fmtUsd2 = v => v == null ? "—" : "$" + v.toFixed(2);
const fmtQty  = v => v == null ? "—" : v.toLocaleString();

// ── Scenario picker strip ──────────────────────────────────────────
function ScenarioStrip({ scenarioKey, onChange, theme, onTheme }) {
  const order = window.PSR.scenario_order;
  const scenarios = window.PSR.scenarios;
  const byCluster = {};
  for (const k of order) {
    const c = scenarios[k].cluster.split(" ·")[0];
    if (!byCluster[c]) byCluster[c] = { label: scenarios[k].cluster, items: [] };
    byCluster[c].items.push([k, scenarios[k]]);
  }
  return (
    <div className="psr-strip">
      <span className="lbl">Scenario</span>
      {Object.values(byCluster).map(g => (
        <React.Fragment key={g.label}>
          <span className="group-label">│ {g.label}</span>
          {g.items.map(([key, sc]) => (
            <button key={key}
                    className={scenarioKey === key ? "active" : ""}
                    onClick={() => onChange(key)}
                    title={sc.label}>
              {sc.label.match(/^[①-㊱]/)?.[0] || sc.label.slice(0, 2)}
            </button>
          ))}
        </React.Fragment>
      ))}
      <span className="right">
        <a href="docs/cd-pricing-surface-redesign-designer-notes.md">Designer notes</a>
        <a href="docs/cd-pricing-surface-redesign-data-source-map.md">Data-source map</a>
        <button className="theme-tog" onClick={onTheme}>
          {theme === "dark" ? "☾ Dark" : "☀ Light"}
        </button>
      </span>
    </div>
  );
}

// ── State line ─────────────────────────────────────────────────────
function StateLine({ state, scenario, justUpdated }) {
  const sl = state.state_line;
  const pillClass =
    sl.status === "sendable"    ? "sendable"    :
    sl.status === "review"      ? "review"      :
    sl.status === "blocked"     ? "blocked"     :
    sl.status === "provisional" ? "provisional" : "review";
  return (
    <div className="psr-state-line">
      <span className={"pill " + pillClass}>
        <span className="dot" />
        {sl.status}{sl.status === "provisional" ? " *" : ""}
      </span>
      <span className="lead">{sl.lead}</span>
      {sl.qualifiers.map((q, i) => (
        <span key={i} className="qualifier">{q}</span>
      ))}
      {justUpdated && (
        <span className="psr-just-updated" title="State recomputed after most recent change">
          <span className="glyph">↻</span>
          just updated
        </span>
      )}
    </div>
  );
}

// ── State callout (suggestion-led) ─────────────────────────────────
function StateCallout({ state }) {
  const blended = fmtPct(state.blended_margin_pct);
  const target = fmtPct0(state.policy.target_margin_pct);
  const floor = fmtPct0(state.policy.floor_margin_pct);
  const worstTier = state.tiers
    .filter(t => t.status === "below_target" || t.status === "below_floor")
    .reduce((a, b) => (a == null || b.min_margin_pct < a.min_margin_pct) ? b : a, null);
  return (
    <div className="psr-state-callout">
      <div className="glyph">!</div>
      <div className="body">
        <div className="head">
          {worstTier ? <>Tier {worstTier.id} at <span className="pct">{fmtPct(worstTier.min_margin_pct)}%</span></> : "Below target"}
        </div>
        <div className="sub">
          Blended <strong style={{color:"var(--ink)"}}>{blended}%</strong> — under the {target}% target. Apply the recommended lift below, or preview &amp; send acknowledging the risk.
        </div>
      </div>
      <div className="meta">
        Target {target}% · Floor {floor}%
      </div>
    </div>
  );
}

// ── State card (blocked) ───────────────────────────────────────────
function StateCard({ state }) {
  const blended = fmtPct(state.blended_margin_pct);
  const target = fmtPct0(state.policy.target_margin_pct);
  const floor = fmtPct0(state.policy.floor_margin_pct);
  const worstTier = state.tiers
    .filter(t => t.status === "below_floor")
    .reduce((a, b) => (a == null || b.min_margin_pct < a.min_margin_pct) ? b : a, null);
  const gap = worstTier ? (state.policy.floor_margin_pct - worstTier.min_margin_pct) * 100 : 0;
  return (
    <div className="psr-state-card">
      <div className="head">
        <div className="seal">!</div>
        <div className="body">
          <span className="pill"><span className="dot" />Cannot send</span>
          <div className="lead">
            {worstTier ? <>Tier {worstTier.id} at <span style={{fontFamily:"var(--mono)", fontStyle:"normal"}}>{fmtPct(worstTier.min_margin_pct)}%</span></> : "Below floor"}
          </div>
          <div className="sub">
            {gap.toFixed(1)}pp below the {floor}% floor · {state.below_floor.length} cell{state.below_floor.length === 1 ? "" : "s"} affected.
            {" "}Resolve below — admin override or surgical lift.
          </div>
        </div>
        <div className="right">
          <span className="num">{blended}<span className="pct">%</span></span>
          Blended margin
        </div>
      </div>
      <div className="meta-row">
        <span>Target {target}%</span><span className="sep">·</span>
        <span>Floor {floor}%</span>
        {state.flags.over_client_target && (
          <><span className="sep">·</span><span>{state.flags.over_client_target_count} over client target</span></>
        )}
        {state.flags.override_applied && (
          <><span className="sep">·</span><span>override applied on one tier</span></>
        )}
      </div>
    </div>
  );
}

// ── Summary card (sendable only) ───────────────────────────────────
function SummaryCard({ state }) {
  const sc = state.summary_card;
  if (!sc) return null;
  const recTier = state.tiers.find(t => t.id === sc.recommended_tier);
  return (
    <div className="psr-summary-card">
      <h3>What you're sending</h3>
      <div className="psr-summary-grid">
        <div className="psr-summary-cell">
          <span className="lab">Scope</span>
          <span className="val">{sc.sku_count}<span className="unit">SKUs</span></span>
          <span className="sub">{sc.tier_count} tiers</span>
        </div>
        <div className="psr-summary-cell">
          <span className="lab">Recommended tier</span>
          <span className="val numeric">T{sc.recommended_tier} · {fmtQty(recTier?.qty)}</span>
          <span className="sub">order value at this tier</span>
        </div>
        <div className="psr-summary-cell">
          <span className="lab">Order value · T{sc.recommended_tier}</span>
          <span className="val numeric">{fmtUsd(sc.recommended_tier_value)}</span>
          <span className="sub">across all SKUs</span>
        </div>
        <div className="psr-summary-cell">
          <span className="lab">Blended margin</span>
          <span className="val numeric">{fmtPct(sc.blended_margin_pct)}%</span>
          <span className="sub">target {fmtPct0(state.policy.target_margin_pct)}% · floor {fmtPct0(state.policy.floor_margin_pct)}%</span>
        </div>
      </div>
    </div>
  );
}

// ── Action cards ───────────────────────────────────────────────────
function ActionCard({ action }) {
  const cls = [
    "psr-action-card",
    action.primary ? "primary" : "",
    action.recommended ? "recommended" : "",
    action.demoted ? "demoted" : "",
    action.soft ? "soft" : "",
    action.disabled ? "disabled" : "",
    action.kind === "override_unavailable" ? "override-unavailable" : "",
    action.kind === "calculating_suggestion" ? "calculating" : "",
  ].filter(Boolean).join(" ");
  const glyph =
    action.kind === "preview_pdf"            ? "↗" :
    action.kind === "apply_surgical"         ? "✦" :
    action.kind === "apply_global"           ? "≡" :
    action.kind === "request_override"       ? "⌧" :
    action.kind === "override_unavailable"   ? "⊘" :
    action.kind === "tighten_to_target"      ? "⇣" :
    action.kind === "calculating_suggestion" ? "···" : "→";
  // Inert action kinds (no CTA button) — render the explainer only.
  const inert = action.kind === "override_unavailable" || action.kind === "calculating_suggestion";
  return (
    <div className={cls}>
      <div className="glyph">{glyph}</div>
      <div className="body">
        <div className="head">{action.label}</div>
        {action.sublabel && <div className="sub">{action.sublabel}</div>}
        {action.disabled && action.disabled_reason && (
          <div className="disabled-reason">⚠ {action.disabled_reason}</div>
        )}
      </div>
      {!inert && (
        <button className="cta" disabled={action.disabled}>
          {action.kind === "preview_pdf"      ? "Preview PDF →" :
           action.kind === "apply_surgical"   ? "Apply →" :
           action.kind === "apply_global"     ? "Apply →" :
           action.kind === "request_override" ? "Request →" :
           action.kind === "tighten_to_target"? "Tighten →" :
           "Go →"}
        </button>
      )}
    </div>
  );
}

// ── Suggestion card (suggestion-led detail) ────────────────────────
function SuggestionCard({ scenario, state }) {
  // Pull the recommended action from classifier; consume its projection.
  // No re-derivation — the post-apply blended is classifier-owned.
  const rec = state.actions.find(a => a.recommended);
  if (!rec || rec.kind === "calculating_suggestion") {
    return (
      <div className="psr-suggestion-card calculating">
        <div className="head">
          <div>
            <div className="title">Calculating suggestion…</div>
            <div className="sub">
              The suggestion engine is computing a lift path for this quote. The recommended action will appear here in a moment; refresh if it doesn't.
            </div>
          </div>
          <button className="cta" disabled>Pending</button>
        </div>
      </div>
    );
  }
  const surgical = scenario.quote.suggestions?.surgical;
  const global = scenario.quote.suggestions?.global;
  const projected = rec.projected_blended_after_apply;
  const projectedDelta = (projected != null && state.blended_margin_pct != null)
    ? (projected - state.blended_margin_pct) * 100 : null;
  if (rec.kind === "apply_surgical" && surgical) {
    return (
      <div className="psr-suggestion-card">
        <div className="head">
          <div>
            <div className="title">Lift Tier {surgical.tier_id} by +{(surgical.lift_pct * 100).toFixed(0)}% sell price</div>
            <div className="sub">
              Surgical adjustment — only Tier {surgical.tier_id} sell price changes. Other tiers stay where they are.
              Brings the worst SKU on Tier {surgical.tier_id} to {fmtPct(surgical.new_margin)}% margin (above target).
            </div>
          </div>
          <button className="cta">Apply Surgical →</button>
        </div>
        <div className="preview">
          <div className="stat"><span className="lab">Tier {surgical.tier_id} margin</span><span className="val">{fmtPct(state.tiers.find(t => t.id === surgical.tier_id)?.min_margin_pct)}% <span className="delta">→ {fmtPct(surgical.new_margin)}%</span></span></div>
          <div className="stat"><span className="lab">Other tiers</span><span className="val">unchanged</span></div>
          <div className="stat"><span className="lab">Blended after apply</span><span className="val">{fmtPct(projected)}% {projectedDelta != null && <span className="delta">+{projectedDelta.toFixed(1)}pp</span>}</span></div>
        </div>
      </div>
    );
  }
  if (rec.kind === "apply_global" && global) {
    return (
      <div className="psr-suggestion-card">
        <div className="head">
          <div>
            <div className="title">Lift all tiers by +{(global.lift_pct * 100).toFixed(0)}% sell price</div>
            <div className="sub">
              Global adjustment — proportional lift across all tiers preserves the volume curve. Use when multiple tiers are below target;
              surgical would compound the curve and likely produce inverted volume incentives.
            </div>
          </div>
          <button className="cta">Apply Global →</button>
        </div>
        <div className="preview">
          <div className="stat"><span className="lab">All tiers</span><span className="val">+{(global.lift_pct * 100).toFixed(0)}% sell price</span></div>
          <div className="stat"><span className="lab">Curve shape</span><span className="val">preserved</span></div>
          <div className="stat"><span className="lab">Blended after apply</span><span className="val">{fmtPct(state.blended_margin_pct)}% <span className="delta">→ {fmtPct(projected ?? global.new_blended)}%</span></span></div>
        </div>
      </div>
    );
  }
  return null;
}

// ── DETAIL zone ────────────────────────────────────────────────────
function DetailZone({ state, scenario }) {
  const [open, setOpen] = useStatePS(false);
  return (
    <div className="psr-detail">
      <button className={"psr-detail-toggle " + (open ? "open" : "")} onClick={() => setOpen(o => !o)}>
        <span><span className="twirl">▸</span>Show pricing detail</span>
        <span className="lab"></span>
        <span className="meta">
          {state.quote.skus.length} SKUs · {state.quote.tiers.length} tiers · cost stack · per-SKU breakdown
        </span>
      </button>
      {open && (
        <div className="psr-detail-body">
          <DetailGlobalAdjust state={state} />
          <DetailTierTable state={state} />
          <DetailCostStack state={state} />
          <DetailPerSku state={state} />
          <DetailMetaTiles state={state} />
        </div>
      )}
    </div>
  );
}

function DetailGlobalAdjust({ state }) {
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Global price adjustment</h4>
        <span className="meta">Tuning lever · applies across all tiers</span>
      </div>
      <div className="psr-global-adjust">
        <div className="lab">
          Lift all tiers proportionally to recover margin without distorting the volume curve.
          <span className="hint">Surgical (single-tier) lives on the per-tier table below.</span>
        </div>
        <div className="input-cluster">
          <input type="text" defaultValue="0" />
          <span className="unit">% sell-price lift</span>
          <button className="cta" style={{padding:"6px 12px", borderRadius:6, background:"var(--ink)", color:"var(--paper)", border:"1px solid var(--ink)", fontSize:12, fontWeight:500, cursor:"pointer"}}>Preview →</button>
        </div>
      </div>
    </div>
  );
}

function DetailTierTable({ state }) {
  const target = state.policy.target_margin_pct;
  const floor = state.policy.floor_margin_pct;
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Per-tier compliance</h4>
        <span className="meta">Worst margin across SKUs · {state.quote.tiers.length} tiers</span>
      </div>
      <table className="psr-tier-table">
        <thead>
          <tr>
            <th>Tier</th><th>Qty</th><th>Worst margin</th><th>Blended</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {state.tiers.map(t => (
            <tr key={t.id}>
              <td><strong>T{t.id}</strong></td>
              <td className="num">{fmtQty(t.qty)}</td>
              <td className="num">{t.min_margin_pct == null ? "—" : fmtPct(t.min_margin_pct) + "%"}</td>
              <td className="num">{t.blended_margin_pct == null ? "—" : fmtPct(t.blended_margin_pct) + "%"}</td>
              <td>
                <span className={"row-pill " + t.status}>
                  <span className="dot" />
                  {t.status.replace(/_/g, " ")}
                </span>
                {t.has_override && <span className="ovr-chip">OVR</span>}
              </td>
              <td style={{textAlign:"right", color:"var(--ink-4)", fontFamily:"var(--mono)", fontSize:10}}>
                tgt {fmtPct0(target)}% · flr {fmtPct0(floor)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailCostStack({ state }) {
  // Adapt classifier output → NXR6CostStack tier shape.
  // R6 cost stack is the canonical component from previous round; we don't
  // reinvent it. Per-tier rollup averages component costs across SKUs and
  // distributes markup (sell − cost) proportionally across components so the
  // R6 bar grammar holds.
  const stateToR6 = s =>
    s === "above_target" ? "good" :
    s === "below_target" ? "below_target" :
    s === "below_floor"  ? "bad"  :
    "incomplete";

  const tiers = state.tiers.map(t => {
    const tierCells = state.cells.filter(c => c.tier_id === t.id);
    const known = tierCells.filter(c => !c.missing && c.cost_stack);
    if (known.length === 0) {
      return {
        id: "T" + t.id,
        label: "T" + t.id,
        units: t.qty,
        subtotal: null,
        adjustment: 0,
        sell: null,
        margin_pct: null,
        margin_state: "incomplete",
        components: [],
      };
    }
    // Avg cost components across SKUs at this tier
    const avg = k => known.reduce((s, c) => s + (c.cost_stack[k] ?? 0), 0) / known.length;
    const pkg = avg("pkg"), prod = avg("prod"), frt = avg("frt"), dt = avg("dt");
    const costTotal = pkg + prod + frt + dt;
    const sell = known.reduce((s, c) => s + (c.sell_unit ?? 0), 0) / known.length;
    const markupTotal = Math.max(0, sell - costTotal);
    // Distribute markup proportionally to component cost (D+T is internal,
    // doesn't carry markup; allocate across PKG/PROD/FRT only — preserves
    // the R6 cost-stack convention that D+T is the firm's internal layer).
    const customerCost = pkg + prod + frt;
    const mkShare = k => customerCost > 0 ? (avg(k) / customerCost) * markupTotal : 0;
    return {
      id: "T" + t.id,
      label: "T" + t.id,
      units: t.qty,
      subtotal: costTotal,
      adjustment: 0,
      sell,
      margin_pct: t.min_margin_pct,
      margin_state: stateToR6(t.status),
      components: [
        { key: "pkg",  label: "PKG",  cost: pkg,  markup: mkShare("pkg") },
        { key: "prod", label: "PROD", cost: prod, markup: mkShare("prod") },
        { key: "frt",  label: "FRT",  cost: frt,  markup: mkShare("frt") },
        { key: "dt",   label: "D+T",  cost: dt,   markup: 0, internal: true },
        { key: "pass", label: "PASS", cost: null, markup: null },
      ],
    };
  });

  const CostStack = window.NXR6CostStack;
  return (
    <div className="psr-detail-section psr-detail-section--cost-stack">
      {CostStack ? (
        <div className="psr-cs-embed">
          <CostStack tiers={tiers} activeTierId={null} onPickTier={() => {}} rawsMode={null} rawTotalT2={null} />
        </div>
      ) : (
        <div className="psr-placeholder">Cost stack component not loaded</div>
      )}
    </div>
  );
}

function DetailPerSku({ state }) {
  const [open, setOpen] = useStatePS({}); // keyed by sku.id
  const toggle = id => setOpen(o => ({ ...o, [id]: !o[id] }));
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Per-SKU breakdown</h4>
        <span className="meta">{state.skus.length} SKUs · expand to see per-tier numbers</span>
      </div>
      <div className="psr-sku-grid">
        {state.skus.map((sku, i) => {
          const isOpen = !!open[sku.id];
          return (
            <div key={sku.id} className={"psr-sku-card " + (isOpen ? "expanded" : "")}>
              <button
                className="psr-sku-summary"
                onClick={() => toggle(sku.id)}
                aria-expanded={isOpen}
              >
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="name-cell">
                  <span className="name">{sku.name}</span>
                  <span className="meta">
                    <span>{sku.id}</span><span className="sep">·</span>
                    <span>worst tier: {fmtPct(sku.min_margin_pct)}%</span>
                    {sku.client_target_unit != null && (
                      <><span className="sep">·</span><span>client target ${sku.client_target_unit.toFixed(2)}/unit</span></>
                    )}
                    {sku.over_client_target && (
                      <><span className="sep">·</span><span className="over-target">over client target</span></>
                    )}
                  </span>
                </span>
                <span className="psr-tier-strip">
                  {sku.all_tiers.map(at => {
                    // Consume classifier-assigned status — no re-derivation.
                    const status = at.status || "unknown";
                    const h = at.margin_pct == null ? 4 : Math.max(4, at.margin_pct * 40);
                    return (
                      <span key={at.tier_id} className={"bar " + status} style={{height: h + "px"}} title={"T" + at.tier_id + " · " + fmtPct(at.margin_pct) + "%"}>
                        <span className="lab">T{at.tier_id}</span>
                      </span>
                    );
                  })}
                </span>
                <span className={"status-pill " + sku.status}>
                  <span className="dot" />
                  {sku.status.replace(/_/g, " ")}
                </span>
                <span className="psr-show-breakdown">
                  <span className="twirl">▸</span>
                  {isOpen ? "Hide breakdown" : "Show breakdown"}
                </span>
              </button>

              {isOpen && <SkuBreakdown sku={sku} state={state} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SkuBreakdown({ sku, state }) {
  // Per-tier rows for this SKU only. Pull cells from classifier output —
  // single source of truth (status, over-target, override are all classifier-owned).
  const rows = state.quote.tiers.map(t => {
    const cell = state.cells.find(c => c.sku_id === sku.id && c.tier_id === t.id);
    return { tier: t, cell };
  });
  return (
    <div className="psr-sku-breakdown">
      <div className="bd-head">
        <span>Tier</span>
        <span className="num">Qty</span>
        <span className="num">Unit cost</span>
        <span className="num">Sell · unit</span>
        <span className="num">Margin</span>
        <span className="num">vs client target</span>
        <span>Status</span>
      </div>
      {rows.map(({ tier, cell }) => {
        if (!cell || cell.missing) {
          return (
            <div key={tier.id} className="bd-row unknown">
              <span className="tier-cell"><strong>T{tier.id}</strong></span>
              <span className="num">{fmtQty(tier.qty)}</span>
              <span className="num">—</span>
              <span className="num">—</span>
              <span className="num">—</span>
              <span className="num">—</span>
              <span><span className="row-pill unknown"><span className="dot" />awaiting raws</span></span>
            </div>
          );
        }
        // status + client_target_delta are classifier-assigned— read, don't compute.
        const delta = cell.client_target_delta;
        return (
          <div key={tier.id} className={"bd-row " + cell.status}>
            <span className="tier-cell">
              <strong>T{tier.id}</strong>
              {cell.override_applied && <span className="ovr-chip">OVR</span>}
            </span>
            <span className="num">{fmtQty(tier.qty)}</span>
            <span className="num">{fmtUsd2(cell.cost_unit)}</span>
            <span className="num">{fmtUsd2(cell.sell_unit)}</span>
            <span className="num strong">{fmtPct(cell.margin_pct)}%</span>
            <span className={"num " + (delta == null ? "" : delta > 0 ? "over" : delta < 0 ? "under" : "")}>
              {delta == null ? "—" : (delta > 0 ? "+" : "") + "$" + delta.toFixed(2)}
            </span>
            <span>
              <span className={"row-pill " + cell.status}>
                <span className="dot" />
                {cell.status.replace(/_/g, " ")}
              </span>
            </span>
          </div>
        );
      })}
      {sku.client_target_unit == null && (
        <div className="bd-note">No client target on file for this SKU — vs-target column shows —.</div>
      )}
    </div>
  );
}

function DetailMetaTiles({ state }) {
  // most headroom = tier with highest min_margin across SKUs
  const headroom = state.tiers
    .filter(t => t.min_margin_pct != null)
    .reduce((a, b) => (a == null || b.min_margin_pct > a.min_margin_pct) ? b : a, null);
  // client benchmark count
  const benchmarked = state.skus.filter(s => s.client_target_unit != null).length;
  return (
    <div className="psr-detail-section">
      <div className="section-head">
        <h4>Reference</h4>
        <span className="meta">Diagnostic context · not action-adjacent</span>
      </div>
      <div className="psr-meta-tiles">
        <div className="psr-meta-tile">
          <div className="lab">Most headroom</div>
          <div className="val">{headroom ? `Tier ${headroom.id} · ${fmtPct(headroom.min_margin_pct)}%` : "—"}</div>
          <div className="sub">Highest worst-case margin across tiers</div>
        </div>
        <div className="psr-meta-tile">
          <div className="lab">Client benchmark</div>
          <div className="val">{benchmarked} of {state.skus.length} SKUs priced against target</div>
          <div className="sub">Stated unit-price ceilings from client RFP</div>
        </div>
      </div>
    </div>
  );
}

// ── Mode-aware page ────────────────────────────────────────────────
function PricingSurface({ scenarioKey }) {
  const scenario = window.PSR.scenarios[scenarioKey];
  const state = useMemoPS(() => window.PSR.classify(scenario.quote), [scenarioKey]);

  const pageCls =
    state.mode === "sendable"       ? "psr-page psr-page--sendable" :
    state.mode === "suggestion_led" ? "psr-page psr-page--suggestion" :
                                      "psr-page psr-page--blocked";

  const isTransition = scenario.quote.transition != null;

  // Edward §8 fix: persistent post-transition state-line hint (~30s).
  // The flash banner is one-shot; the state-line hint stays so a PM who
  // walked away momentarily still sees that the surface re-rendered.
  const [justUpdated, setJustUpdated] = useStatePS(isTransition);
  React.useEffect(() => {
    if (!isTransition) { setJustUpdated(false); return; }
    setJustUpdated(true);
    const id = setTimeout(() => setJustUpdated(false), 30000);
    return () => clearTimeout(id);
  }, [scenarioKey, isTransition]);

  const transition = scenario.quote.transition;
  const transitionCopy = transition ? (() => {
    if (transition.via === "apply_surgical") {
      return <><strong>Applied Surgical · T1 lifted +{transition.t1_lifted_pp}pp.</strong>{" "}
        Mode transitioned <code>{transition.from}</code> → <code>{transition.to}</code> in place. DETAIL state preserved.</>;
    }
    if (transition.via === "global_adjust_keystroke") {
      return <><strong>Global adjustment dropped {transition.adj_pp}pp below floor mid-edit.</strong>{" "}
        Mode escalated <code>{transition.from}</code> → <code>{transition.to}</code> in place. DETAIL kept its prior expanded state — no surprise expansion.</>;
    }
    return <><strong>Quote re-rendered.</strong>{" "}
      Mode transitioned <code>{transition.from}</code> → <code>{transition.to}</code> in place.</>;
  })() : null;
  const transitionDirection = transition && (
    (transition.from === "sendable" && (transition.to === "suggestion_led" || transition.to === "blocked")) ||
    (transition.from === "suggestion_led" && transition.to === "blocked")
  ) ? "escalation" : "recovery";

  return (
    <>
      <div className="psr-scenario-head">
        <div className="cluster">{scenario.cluster_label}</div>
        <h1>{scenario.label}</h1>
        <p className="blurb">{scenario.blurb}</p>
      </div>

      <div className="psr-topbar">
        <div className="crumbs">
          <span>Quote</span><span className="sep">›</span>
          <span>{scenario.quote.client}</span><span className="sep">›</span>
          <span className="here">Tune price & review</span>
        </div>
        <div className="quote-meta">
          <strong>{scenario.quote.qid}</strong> · {scenario.quote.skus.length} SKUs · {scenario.quote.tiers.length} tiers
        </div>
      </div>

      <main className={pageCls}>

        {/* STATE ZONE */}
        <StateLine state={state} scenario={scenario} justUpdated={justUpdated} />

        {state.mode === "suggestion_led" && <StateCallout state={state} />}
        {state.mode === "blocked" && <StateCard state={state} />}

        {isTransition && (
          <div className={"psr-transition-note psr-flash psr-flash--" + transitionDirection}>
            <span>{transitionDirection === "escalation" ? "⚠" : "↪"}</span>
            <span>{transitionCopy}</span>
          </div>
        )}

        {/* ACTION ZONE */}
        <div className="psr-action-zone">
          {state.mode === "sendable" && <SummaryCard state={state} />}

          {state.mode === "suggestion_led" && (
            <SuggestionCard scenario={scenario} state={state} />
          )}

          {state.actions.map((a, i) => (
            state.mode === "suggestion_led" && a.recommended ? null /* suggestion card handles it */
              : <ActionCard key={i} action={a} />
          ))}

          {state.flags.accept_risk_unavailable && scenario.quote.policy.allow_accept_risk === false && (
            <div className="psr-accept-risk-banner">
              <span className="glyph">⌧</span>
              <span>
                <strong>Accept-risk is unavailable on this quote.</strong>{" "}
                Firm policy prohibits below-floor sends on margin-protected accounts. Use admin override or apply the recommended lift.
              </span>
            </div>
          )}
        </div>

        {/* DETAIL ZONE — collapsed by default */}
        <DetailZone state={state} scenario={scenario} />

      </main>
    </>
  );
}

window.PSR.App = PricingSurface;
window.PSR.ScenarioStrip = ScenarioStrip;
