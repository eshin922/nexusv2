/* global React, NXPR */
// Pricing Reframe v1 — components
// Path 3 hybrid: blended preserved as primary; tier compliance + tier-aware
// suggestions + risk callouts + ROOM-state recompute as equal-weight secondary.

const { useState: useStatePR, useEffect: useEffectPR, useMemo: useMemoPR } = React;

const fmtPct = (v) => v == null ? "—" : (v * 100).toFixed(1);
const fmtDelta = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "pp";

// ─── BlendedHeadline ─────────────────────────────────────────────────

function BlendedHeadline({ scenario }) {
  const state = scenario.blended_state;
  const has = scenario.blended_margin != null;

  // Tier-level counts drive the ROOM state copy (Component 4.e)
  const tiers = scenario.tiers;
  const belowTarget = tiers.filter(t => t.margin_pct != null && t.margin_pct < window.NXPR.policy.target_margin_pct).length;
  const belowFloor  = tiers.filter(t => t.margin_pct != null && t.margin_pct < window.NXPR.policy.floor_margin_pct).length;

  // Verdict pill + room copy follow Q5/Q7 dispositions: copy adapts per state.
  const { pillCopy, roomCopy } = (() => {
    if (state === "empty") return { pillCopy: "AWAITING INPUT", roomCopy: <>Quote has no tier data yet. Pricing surface waits for cost entries.</> };
    if (belowFloor > 0)    return { pillCopy: "BLOCKED · BELOW FLOOR", roomCopy: <><strong>{belowFloor} tier{belowFloor === 1 ? "" : "s"} below floor</strong> · sends require admin override</> };
    if (scenario.blended_margin != null && scenario.blended_margin < window.NXPR.policy.target_margin_pct) {
      return { pillCopy: `BLENDED BELOW TARGET · ${belowTarget} TIER RISK`, roomCopy: <><strong>Blended {(scenario.blended_margin * 100).toFixed(1)}% under {(window.NXPR.policy.target_margin_pct * 100).toFixed(0)}% target</strong> · {belowTarget} tier{belowTarget === 1 ? "" : "s"} below target · review before sending</> };
    }
    if (belowTarget > 0)   return { pillCopy: `BLENDED SENDABLE · ${belowTarget} TIER RISK`, roomCopy: <><strong>{belowTarget} tier{belowTarget === 1 ? "" : "s"} below target</strong> · review per-tier risk before sending</> };
    return { pillCopy: "ALL TIERS AT TARGET · SENDABLE", roomCopy: <>All tiers at or above {(window.NXPR.policy.target_margin_pct * 100).toFixed(0)}% target · sendable</> };
  })();

  const pillClass = state === "empty" ? "empty"
                  : belowFloor > 0 ? "bad"
                  : belowTarget > 0 ? "warn"
                  : "good";

  return (
    <div className={`pr-blended ${pillClass}`}>
      <div className="value-block">
        <div className="v-eyebrow">Blended margin</div>
        <div className="v-number">
          {has ? fmtPct(scenario.blended_margin) : "—"}<span className="pct">%</span>
        </div>
        <div className="v-caption">Blended is the per-tier average — your realized margin is the tier the customer picks.</div>
      </div>

      <div className="room-state">
        <span className="verdict-pill">
          <span className="dot" />
          {pillCopy}
        </span>
        <div className="room-line">{roomCopy}</div>
      </div>

      <div className="meta">
        <span>Target {(window.NXPR.policy.target_margin_pct * 100).toFixed(0)}% · Floor {(window.NXPR.policy.floor_margin_pct * 100).toFixed(0)}%</span>
        <span className="recompute">↻ Recomputed live</span>
      </div>
    </div>
  );
}

// ─── TierComplianceBlock ─────────────────────────────────────────────

function TierComplianceBlock({ scenario }) {
  const tiers = scenario.tiers;
  if (!tiers || tiers.length === 0) return null;

  const target = window.NXPR.policy.target_margin_pct;
  const floor  = window.NXPR.policy.floor_margin_pct;

  const belowTarget = tiers.filter(t => t.margin_pct < target).length;
  const belowFloor  = tiers.filter(t => t.margin_pct < floor).length;
  const allHealthy  = belowTarget === 0 && belowFloor === 0;

  // Q4: collapse when all at target
  if (allHealthy) {
    return (
      <div className="pr-tcb collapsed">
        <div className="pr-tcb-head">
          <h3>Per-tier compliance</h3>
          <span className="summary good">
            <span className="r62-phase-tag" style={{ display: "none" }} />
            ✓ All {tiers.length} tiers at target · {tiers.map(t => `${t.id} ${(t.margin_pct * 100).toFixed(1)}%`).join(" · ")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pr-tcb">
      <div className="pr-tcb-head">
        <h3>Per-tier compliance</h3>
        <span className={`summary ${belowFloor > 0 ? "bad" : "warn"}`}>
          {belowTarget} of {tiers.length} below target{belowFloor > 0 ? ` · ${belowFloor} below floor` : ""}
        </span>
      </div>

      {tiers.map(t => {
        const state = t.margin_pct < floor ? "bad"
                    : t.margin_pct < target ? "warn"
                    : "good";
        const chipCopy = state === "good" ? "AT TARGET"
                       : state === "warn" ? "BELOW TARGET"
                       : "BELOW FLOOR";

        // Q5: inline callout for below-target; floor breach gets the separate
        // floor block (rendered above the TCB by the parent) AND a row tint.
        const showInlineCallout = state === "warn" && t.risk_callout;
        const showFloorRow = state === "bad";

        return (
          <div key={t.id} className={`pr-tier-row ${state}`}>
            <div className="tier-label">
              {t.id}
              {t.recommended && <span className="recommended-star" title="Recommended tier">★</span>}
              {t.applying && <span style={{
                fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--accent-ink)",
                letterSpacing: "0.06em", marginLeft: 6,
              }}>APPLYING…</span>}
            </div>
            <div className="units">{t.units.toLocaleString()} units</div>
            <div className="callout">
              {showInlineCallout && (
                <React.Fragment>
                  <span className="glyph">!</span>
                  <span>{t.risk_callout}</span>
                </React.Fragment>
              )}
              {showFloorRow && (
                <React.Fragment>
                  <span className="glyph" style={{ color: "var(--bad)" }}>■</span>
                  <span style={{ color: "var(--bad)" }}>{t.risk_callout}</span>
                </React.Fragment>
              )}
              {t.just_changed && (
                <React.Fragment>
                  <span className="glyph" style={{ color: "var(--good)" }}>✓</span>
                  <span style={{ color: "var(--good)" }}>Lifted to {fmtPct(t.margin_pct)}% · within target</span>
                </React.Fragment>
              )}
            </div>
            <div className={`margin ${state}`}>
              <span className="num">{fmtPct(t.margin_pct)}</span><span className="pct">%</span>
              {t.just_changed && <span className="delta-chip">{fmtDelta(t.change_delta_pp)}</span>}
            </div>
            <div className="sell">
              ${t.sell_per_unit.toFixed(2)}
              <span className="lbl">sell · unit</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Floor block — separate, prominent (Q5: scales with severity)
function FloorBlock({ scenario }) {
  const floor = window.NXPR.policy.floor_margin_pct;
  const breach = scenario.tiers.find(t => t.margin_pct != null && t.margin_pct < floor);
  if (!breach) return null;
  return (
    <div className="pr-floor-block">
      <div className="icon">!</div>
      <div className="body">
        <div className="eyebrow">Below floor · deal-blocking</div>
        <h3 className="head">{breach.id} below the {(floor * 100).toFixed(0)}% floor by {((floor - breach.margin_pct) * 100).toFixed(1)}pp</h3>
        <p className="desc">{breach.risk_callout}. Sending requires firm-owner override per Round 5 firm-policy gate.</p>
      </div>
      <button className="cta">Request override</button>
    </div>
  );
}

// ─── Suggestion engine ───────────────────────────────────────────────

function SuggestionEngine({ scenario, onApply }) {
  const s = scenario.suggestions;
  if (!s) return null;

  const isBelowFloor = scenario.tiers.some(t => t.margin_pct != null && t.margin_pct < window.NXPR.policy.floor_margin_pct);

  return (
    <div className={`pr-suggestions ${isBelowFloor ? "below-floor" : ""}`}>
      <div className="pr-suggestions-head">
        <h3>Tier-aware suggestions</h3>
        <span className="auto">↻ Auto-fired · context-aware ranking</span>
      </div>
      <div className="pr-suggestions-list">
        {s.options.map((opt, i) => (
          <SuggestionOption key={opt.id} option={opt} onApply={onApply} />
        ))}
        {s.accept_risk_unavailable_reason && (
          <div className="pr-accept-risk-unavailable">
            <strong style={{ color: "var(--ink-3)" }}>Accept-risk unavailable:</strong> {s.accept_risk_unavailable_reason}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionOption({ option, onApply }) {
  return (
    <div className={`pr-suggestion ${option.recommended ? "recommended" : ""}`}>
      <div className="lhs">
        <div className="label-row">
          <span className="label">{option.label}</span>
          {option.recommended && <span className="ranked-chip">★ Recommended</span>}
        </div>
        <div className="description">{option.description}</div>
        {option.warning && (
          <div style={{
            fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--warn)",
            letterSpacing: "0.04em", marginTop: 2,
          }}>⚠ {option.warning}</div>
        )}
        {option.preview && (
          <div className="preview">
            {option.preview.map(p => (
              <div key={p.id} className="ptile">
                <span className="pt-tier">{p.id}</span>
                <span className="pt-margin">{fmtPct(p.new_margin)}%</span>
                <span className={`pt-delta ${p.delta_pp === 0 ? "zero" : ""}`}>
                  {p.delta_pp === 0 ? "·" : fmtDelta(p.delta_pp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="apply" onClick={() => onApply && onApply(option.id)}>
        {option.id === "accept_risk" ? "Send as-is" : "Apply"}
      </button>
    </div>
  );
}

// ─── Post-apply toast ───────────────────────────────────────────────

function ApplyToast({ scenario }) {
  if (!scenario.toast) return null;
  return (
    <div className="pr-toast">
      <span className="glyph">✓</span>
      <span className="msg">
        <strong>Applied · </strong>{scenario.toast.message}
      </span>
      <span className="audit">{scenario.toast.audit_ref}</span>
    </div>
  );
}

// ─── Empty-state ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="pr-empty">
      <div className="glyph">∅</div>
      <h4>Pricing waits on cost data</h4>
      <p>This quote has no tier costs yet. Once cost build is in progress, blended margin computes and per-tier compliance appears here. Return to Cost build to enter costs.</p>
    </div>
  );
}

// ─── Page head ──────────────────────────────────────────────────────

function PageHead({ scenarioKey, scenario }) {
  const proj = window.NXPR.project;
  return (
    <div className="pr-head">
      <div className="lhs">
        <div className="eyebrow">
          {proj.client}
          <span className="sep">·</span>
          {proj.scenario}
          <span className="sep">·</span>
          v{proj.version} draft
        </div>
        <h1>Pricing <em>· {scenario.label}</em></h1>
        <p className="scenario-desc">{scenario.description}</p>
      </div>
      <div className="actions">
        <button style={btnSm()}>← Costs</button>
        <button style={btnSmGhost()}>Preview</button>
        <button style={btnSmPrimary()}>Send to customer</button>
      </div>
    </div>
  );
}

function btnSm() {
  return { padding: "7px 12px", borderRadius: 6, fontSize: 12.5, background: "var(--paper-2)", border: "1px solid var(--rule)", color: "var(--ink-2)", cursor: "pointer", whiteSpace: "nowrap" };
}
function btnSmGhost() {
  return { padding: "7px 12px", borderRadius: 6, fontSize: 12.5, background: "var(--paper)", border: "1px solid var(--rule)", color: "var(--ink-2)", cursor: "pointer", whiteSpace: "nowrap" };
}
function btnSmPrimary() {
  return { padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 500, background: "var(--ink)", color: "var(--paper)", border: "1px solid var(--ink)", cursor: "pointer", whiteSpace: "nowrap" };
}

// ─── Main page ──────────────────────────────────────────────────────

function PricingPage({ scenarioKey }) {
  const scenario = window.NXPR.scenarios[scenarioKey];
  const isEmpty = scenario.tiers.length === 0;
  const isBelowFloor = scenario.tiers.some(t => t.margin_pct != null && t.margin_pct < window.NXPR.policy.floor_margin_pct);

  const onApply = (optionId) => {
    // Stub — in real flow, this writes price_adj_pct and recomputes
    console.log("Apply suggestion:", optionId);
  };

  return (
    <div className="pr-page" data-screen-label={`Pricing · ${scenario.label}`}>
      <PageHead scenarioKey={scenarioKey} scenario={scenario} />

      <div className="pr-dn">
        <span className="lbl">DN · Path 3</span>
        Blended preserved as primary verdict; <strong>per-tier compliance</strong> sits below with equal visual weight. Suggestion engine is context-aware (<code>surgical</code> when one tier below, <code>global</code> when multiple, <code>accept-risk</code> only when recommended tier healthy). Risk callouts inline below-target; below-floor escalates to a separate block. ROOM-state copy recomputes from tier-level counts.
      </div>

      {scenario.toast && <ApplyToast scenario={scenario} />}

      {!isEmpty && <BlendedHeadline scenario={scenario} />}

      {isBelowFloor && <FloorBlock scenario={scenario} />}

      {isEmpty
        ? <EmptyState />
        : <TierComplianceBlock scenario={scenario} />
      }

      {scenario.suggestions && <SuggestionEngine scenario={scenario} onApply={onApply} />}
    </div>
  );
}

window.NXPRPage = PricingPage;
