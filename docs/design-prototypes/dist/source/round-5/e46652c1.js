// Round 5 — Firm settings page.
// Two states (read + edit) on a single page that you can toggle.
//
// Why one page, not two:
// - Read view is the "truth" of current policy + history; edit is a panel that
//   appears in place above. The portfolio-effect strip is the bridge: in read
//   view it shows live state; in edit view it becomes a re-banding preview.
// - Single page also matches how Edward actually does this — peeks at history,
//   then opens edit, then watches the preview, then commits. Two URLs would
//   waste the context handoff.
//
// What this is NOT trying to be:
// - Not a margin analytics dashboard. We resist the urge to add charts.
// - Not a per-category override surface (that's Markup defaults).
// - Not a role-permissions UI (that's a separate admin page Maya doesn't see).
//
// What stays placeholder:
// - "Effective immediately / Schedule" pickers — drawn but inert.
// - History pagination beyond the visible 4 entries.

const FirmSettings = ({ state, onToggle }) => {
  const D = window.NXR5;
  const cur = D.firm_settings.current;
  const port = D.firm_settings.portfolio_effect;
  const isEdit = state === "edit";

  return (
    <div className="r5-page">
      <div className="r5-page-head">
        <div className="eyebrow">Admin · Firm policy</div>
        <h1>Firm <em>margin policy</em></h1>
        <p className="sub">
          Two numbers govern every quote: the <strong style={{ color: "var(--ink)" }}>target</strong> we
          aim to exceed, and the <strong style={{ color: "var(--ink)" }}>floor</strong> below which an
          override DM to the firm owner is required. Changes apply to all open quotes in real time and are
          recorded in the audit log.
        </p>
      </div>

      <div className="r5-fs-grid">
        <div>
          {isEdit && (
            <div className="r5-fs-edit">
              <h2>Edit policy</h2>
              <p className="lead">
                You're proposing <strong style={{ color: "var(--ink)" }}>target 35% → 40%</strong>. The
                floor is unchanged. We re-band live quotes against the new policy when you save — preview is
                below.
              </p>
              <div className="inputs">
                <div className="field">
                  <div className="lbl">Target margin</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <input defaultValue="40.0" />
                    <span style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 24, color: "var(--ink-3)" }}>%</span>
                  </div>
                  <div className="delta up">▲ +5.0 pts vs. current 35%</div>
                </div>
                <div className="field">
                  <div className="lbl">Floor margin</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                    <input defaultValue="25.0" />
                    <span style={{ fontFamily: "var(--display)", fontWeight: 500, fontSize: 24, color: "var(--ink-3)" }}>%</span>
                  </div>
                  <div className="delta same">— unchanged</div>
                </div>
              </div>
              <div className="foot">
                <div className="effective-pick">
                  Effective <strong style={{ color: "var(--ink)" }}>immediately</strong>
                  <a href="#" style={{ marginLeft: 8, color: "var(--accent-ink)", fontFamily: "var(--mono)", fontSize: 11 }}>schedule…</a>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn ghost" onClick={onToggle}>Cancel</button>
                  <button className="btn primary">Save & re-band 24 quotes</button>
                </div>
              </div>
            </div>
          )}

          <div className="r5-fs-card">
            <div className="row-head">
              <h2>Current policy</h2>
              <span className="effective">EFFECTIVE {cur.effective_from.toUpperCase()} · 29D</span>
            </div>
            <div className="r5-fs-values">
              <div className="r5-fs-value target">
                <div className="lbl">Target margin</div>
                <div className="num">{(cur.target_margin_pct * 100).toFixed(0)}<span className="pct">%</span></div>
                <div className="meta">
                  Quotes at or above target are <span className="strong">healthy green</span> in the
                  margin gate. Edward cleared this above target last quarter.
                </div>
              </div>
              <div className="r5-fs-value floor">
                <div className="lbl">Floor margin</div>
                <div className="num">{(cur.floor_margin_pct * 100).toFixed(0)}<span className="pct">%</span></div>
                <div className="meta">
                  Below this, sending requires an override DM to the firm owner. <span className="strong">Maya cleared this twice this month.</span>
                </div>
              </div>
            </div>

            {!isEdit && (
              <div className="r5-fs-portfolio">
                <div className="lhs">
                  <strong>Portfolio effect — live.</strong> Across {port.total_quotes} sent quotes against today's policy:
                </div>
                <div className="nums">
                  <span className="good"><span className="pip" />{port.good} ≥35%</span>
                  <span className="warn"><span className="pip" />{port.below_target} 25–35%</span>
                  <span className="bad"><span className="pip" />{port.below_floor} &lt;25%</span>
                </div>
                <a href="#">view →</a>
              </div>
            )}

            {isEdit && (
              <div className="r5-fs-preview">
                <div className="eyebrow">Re-band preview · target 35 → 40</div>
                <h3>4 quotes change band. 0 newly drop below floor.</h3>
                <p>
                  Live quotes are re-evaluated against the new bands the moment you save. The blended margin
                  itself doesn't change — only what colour it earns and whether the gate trips.
                </p>
                <div className="reband">
                  <div className="col">
                    <div className="delta">≥ Target</div>
                    <div className="nums"><span className="from">14</span><span className="arrow">→</span><span className="to good">10</span></div>
                  </div>
                  <div className="col">
                    <div className="delta">Below target</div>
                    <div className="nums"><span className="from">8</span><span className="arrow">→</span><span className="to warn">12</span></div>
                  </div>
                  <div className="col">
                    <div className="delta">Below floor</div>
                    <div className="nums"><span className="from">2</span><span className="arrow">→</span><span className="to bad">2</span></div>
                  </div>
                </div>
                <div className="affected">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span>NEWLY BELOW TARGET — 4 QUOTES</span>
                    <a href="#" style={{ color: "var(--accent-ink)", letterSpacing: 0.04, textTransform: "uppercase", fontSize: 10 }}>view all</a>
                  </div>
                  <ul>
                    {D.preview_diff.affected_quotes.map((q, i) => (
                      <li key={i}>
                        <div className="nm"><em>{q.project}</em> · {q.scenario} v{q.v}</div>
                        <div className="m">{q.margin}%</div>
                        <div className="arrow">good → warn</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="r5-dn">
            <span className="lbl">Designer note</span>
            The "Save & re-band" button names the side effect plainly. We considered a soft "Save" with a
            silent recompute — that hides what happens. Naming the consequence on the button is how we make
            this safe to use without a confirm modal.
          </div>
        </div>

        <div>
          <div className="r5-history">
            <h3>Policy history <span className="meta">{D.firm_settings.history.length} CHANGES</span></h3>
            {D.firm_settings.history.map((h, i) => (
              <div key={i} className={`item ${h.current ? "current" : ""}`}>
                <div>
                  <div className="vals">
                    <span className="target">target {(h.target * 100).toFixed(0)}%</span>
                    <span className="sep">·</span>
                    <span className="floor">floor {(h.floor * 100).toFixed(0)}%</span>
                  </div>
                  <div className="who">{h.by}{h.current && <span style={{ color: "var(--good)", marginLeft: 8 }}>· current</span>}</div>
                </div>
                <div>
                  <div className="when">{h.from}</div>
                  <div className="when" style={{ color: "var(--ink-3)" }}>{h.at}</div>
                </div>
              </div>
            ))}
            <a href="#" style={{ display: "block", marginTop: 10, fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: 0.04, textTransform: "uppercase", textAlign: "center" }}>full audit log →</a>
          </div>

          {!isEdit && (
            <button className="btn primary" style={{ width: "100%", marginTop: 14 }} onClick={onToggle}>
              Edit policy
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

window.NXFirmSettings = FirmSettings;
