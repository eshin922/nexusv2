// Copy operations — Copy Scenario (within project) is the priority flow.
// Cross-project picker shown as a second flow.
// Field-bucket transparency: SPEC FR-12 buckets shown side-by-side as
// the *commit screen*, never buried. Tier-handle communicates the
// "preserve excess tier data hidden" rule honestly.

const CopyOps = ({ kind, onClose }) => {
  const D = window.NXR4;
  const isCross = kind === "cross";
  const [step, setStep] = React.useState(1);
  const [pickedSource, setPickedSource] = React.useState(isCross ? null : "q_p_v2");
  const [pickedProject, setPickedProject] = React.useState(isCross ? "P-2401" : null);
  const [decision, setDecision] = React.useState("keep_both");
  const [tierHandle, setTierHandle] = React.useState("source");

  const totalSteps = isCross ? 4 : 3;

  return (
    <div className="r4-modal-backdrop" onClick={onClose}>
      <div className="r4-modal" onClick={e => e.stopPropagation()} data-screen-label={`C · ${isCross ? "Copy Quote (cross-project)" : "Copy Scenario"}`}>
        <div className="r4-modal-head">
          <div>
            <h2>{isCross ? "Copy quote into this project" : "Copy scenario"}</h2>
            <p className="sub">{isCross
              ? "Pick a source quote from anywhere in your history. Cost recipe travels; deal context stays Lumen & Co."
              : "Fork an existing scenario in Lumen & Co. into a new active scenario."}</p>
          </div>
          <button className="close" onClick={onClose}>✕</button>
        </div>

        <div className="r4-modal-body">
          <div className="r4-stepper">
            {isCross ? (
              <React.Fragment>
                <span className={`step ${step === 1 ? "active" : step > 1 ? "done" : ""}`}>① Project</span>
                <span className="sep">→</span>
                <span className={`step ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>② Quote</span>
                <span className="sep">→</span>
                <span className={`step ${step === 3 ? "active" : step > 3 ? "done" : ""}`}>③ Preview</span>
                <span className="sep">→</span>
                <span className={`step ${step === 4 ? "active" : ""}`}>④ Confirm</span>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <span className={`step ${step === 1 ? "active" : step > 1 ? "done" : ""}`}>① Source</span>
                <span className="sep">→</span>
                <span className={`step ${step === 2 ? "active" : step > 2 ? "done" : ""}`}>② Preview</span>
                <span className="sep">→</span>
                <span className={`step ${step === 3 ? "active" : ""}`}>③ Confirm</span>
              </React.Fragment>
            )}
          </div>

          {/* === Within-project: step 1 — pick source === */}
          {!isCross && step === 1 && (
            <React.Fragment>
              <h4 style={sectionH4}>Pick a quote in <em style={italicized}>Lumen & Co.</em></h4>
              <div className="r4-source-list">
                {D.copy_within_sources.map(s => (
                  <div key={s.id}
                    className={`r4-source-item ${pickedSource === s.id ? "selected" : ""}`}
                    onClick={() => setPickedSource(s.id)}>
                    <div className="radio" />
                    <div className="label">
                      <div className="name">{s.scenario} <span className="v">v{s.v} · {s.status}</span></div>
                      <div className="meta">{s.sku_count} SKUs · {s.tier_count} tiers</div>
                    </div>
                    <div className="margin">{s.margin}%</div>
                    <div className="when">{s.when}</div>
                  </div>
                ))}
              </div>
            </React.Fragment>
          )}

          {/* === Cross-project: step 1 — pick project === */}
          {isCross && step === 1 && (
            <React.Fragment>
              <div className="r4-cross-search">
                <span className="icon">⌕</span>
                <input placeholder="Search projects by name, client, or SKU label…" defaultValue="" />
                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)" }}>
                  <input type="checkbox" style={{ marginRight: 4 }} /> Show archived
                </span>
              </div>
              <div className="r4-cross-pane">
                <div className="r4-cross-col">
                  <h6>Projects · {D.copy_cross_projects.length}</h6>
                  {D.copy_cross_projects.map(prj => (
                    <div key={prj.id}
                      className={`r4-cross-item ${pickedProject === prj.id ? "selected" : ""}`}
                      onClick={() => setPickedProject(prj.id)}>
                      <div className="name italic">
                        {prj.accepted && <span className="accepted-pip" title="Accepted" />}
                        {prj.client}
                      </div>
                      <div className="meta">{prj.deal_name} · v{prj.latest.v} {prj.latest.when}</div>
                    </div>
                  ))}
                </div>
                <div className="r4-cross-col">
                  <h6>Quotes in selected project</h6>
                  {pickedProject ? (
                    <React.Fragment>
                      <div className="r4-cross-item selected">
                        <div className="name">Primary <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>· v4</span></div>
                        <div className="meta">accepted · 4 SKUs · 4 tiers · 31.8%</div>
                      </div>
                      <div className="r4-cross-item">
                        <div className="name">Primary <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>· v3</span></div>
                        <div className="meta">superseded · 4 SKUs · 4 tiers · 30.4%</div>
                      </div>
                    </React.Fragment>
                  ) : (
                    <div style={{ padding: 24, color: "var(--ink-4)", fontSize: 12.5, textAlign: "center" }}>
                      Pick a project on the left to see quotes
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          )}

          {isCross && step === 2 && (
            <div style={{ padding: "8px 0 14px" }}>
              <h4 style={sectionH4}>Confirm source quote</h4>
              <div className="r4-source-list">
                <div className="r4-source-item selected">
                  <div className="radio" />
                  <div className="label">
                    <div className="name">Beija Flor · Primary <span className="v">v4 · accepted</span></div>
                    <div className="meta">4 SKUs · 4 tiers · 50ml glass dropper line · accepted Apr 28</div>
                  </div>
                  <div className="margin">31.8%</div>
                  <div className="when">3d ago</div>
                </div>
              </div>
            </div>
          )}

          {/* === Field-bucket preview (step 2 within / step 3 cross) === */}
          {((!isCross && step === 2) || (isCross && step === 3)) && (
            <React.Fragment>
              <h4 style={sectionH4}>What's coming with you</h4>
              <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 14px", lineHeight: 1.5, maxWidth: 60 + "ch" }}>
                {isCross
                  ? "From Beija Flor v4 (50ml glass dropper × 4 tiers): we'll bring SKUs and cost recipes into Lumen & Co.; deal context stays Lumen's; prices, shipment data, and notes reset."
                  : "From Primary v2 (5 SKUs × 4 tiers): we'll bring SKUs and cost recipes into a new scenario; deal context is unchanged; prices, shipment data, notes, and tier qty values reset."}
              </p>

              <div className="r4-buckets">
                <div className="r4-bucket cloneable">
                  <div className="r4-bucket-head">
                    <span className="icon">→</span>
                    <span className="name">Cloneable · 6</span>
                  </div>
                  <div className="r4-bucket-list">
                    {D.field_buckets.cloneable.map(f => (
                      <div key={f.field} className="field">
                        <span>{f.field}</span>
                        <span className="v">{f.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="r4-bucket inherited">
                  <div className="r4-bucket-head">
                    <span className="icon">⌂</span>
                    <span className="name">Inherited · this project</span>
                  </div>
                  <div className="r4-bucket-list">
                    {D.field_buckets.inherited.map(f => (
                      <div key={f.field} className="field">
                        <span>{f.field}</span>
                        <span className="v">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="r4-bucket reset">
                  <div className="r4-bucket-head">
                    <span className="icon">∅</span>
                    <span className="name">Reset · 8</span>
                  </div>
                  <div className="r4-bucket-list">
                    {D.field_buckets.reset.map(f => (
                      <div key={f.field} className="field">
                        <span>{f.field}</span>
                        <span className="v">{f.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {isCross && (
                <div className="r4-tier-handle">
                  <h6>Tier shape · source 4 tiers → target 3 tiers</h6>
                  <div className="row">
                    <span>Source has 4 tiers; this project's last quote had 3.</span>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <span>What to do with Tier 4 cost data:</span>
                    <select value={tierHandle} onChange={e => setTierHandle(e.target.value)}>
                      <option value="source">Preserve hidden · add 4th tier later to reveal</option>
                      <option value="drop">Discard Tier 4 inputs</option>
                      <option value="match">Bring 4 tiers · use source tier qty values</option>
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 8, fontStyle: "italic" }}>
                    Default preserves data — cost recipes are hard-won. Add a 4th tier on Setup later and Tier 4 inputs reappear in their slots.
                  </div>
                </div>
              )}
            </React.Fragment>
          )}

          {/* === Confirm step — drop-or-keep modal pattern === */}
          {((!isCross && step === 3) || (isCross && step === 4)) && (
            <React.Fragment>
              <h4 style={sectionH4}>Lumen & Co. has an active scenario already</h4>
              <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 14px", lineHeight: 1.5 }}>
                Pick whether the new scenario joins Primary as a sibling, or replaces it.
                <span style={{ color: "var(--ink-4)" }}> Default: keep both.</span>
              </p>
              <div className={`r4-radio-card ${decision === "keep_both" ? "selected" : ""}`} onClick={() => setDecision("keep_both")}>
                <div className="radio" />
                <div>
                  <div className="head">Keep both active</div>
                  <div className="body">Primary stays as the recommended scenario. The new copy lands as a sibling. Best when you're branching to explore a what-if.</div>
                </div>
              </div>
              <div className={`r4-radio-card ${decision === "drop_current" ? "selected" : ""}`} onClick={() => setDecision("drop_current")}>
                <div className="radio" />
                <div>
                  <div className="head">Drop current Primary, make this the new Primary</div>
                  <div className="body">Primary becomes <code style={{ fontSize: 11.5, fontFamily: "var(--mono)" }}>status='dropped' · drop_reason='superseded_by_copy'</code>. Best when the copy supersedes prior work.</div>
                </div>
              </div>

              <div style={{ marginTop: 18, padding: 14, background: "var(--paper-2)", border: "1px solid var(--rule)", borderRadius: 8 }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 8 }}>Lineage will read</div>
                <div style={{ fontFamily: "var(--display)", fontStyle: "italic", fontSize: 14 }}>
                  {isCross
                    ? "← copied from Beija Flor · Primary v4 (3d ago)"
                    : "← copied from Lumen & Co. · Primary v2 (yesterday)"}
                </div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-4)", marginTop: 4 }}>
                  copied_from_quote_id stamped on new draft
                </div>
              </div>
            </React.Fragment>
          )}
        </div>

        <div className="r4-modal-foot">
          <div className="left">
            Step {step} of {totalSteps}
          </div>
          <div className="right">
            <button style={window.NXBtnStyle("subtle")} onClick={onClose}>Cancel</button>
            {step > 1 && <button style={window.NXBtnStyle("subtle")} onClick={() => setStep(step - 1)}>← Back</button>}
            {step < totalSteps
              ? <button style={window.NXBtnStyle("primary")} onClick={() => setStep(step + 1)}>Continue →</button>
              : <button style={window.NXBtnStyle("primary")} onClick={onClose}>Create scenario</button>
            }
          </div>
        </div>
      </div>
    </div>
  );
};

const sectionH4 = {
  fontFamily: "var(--display)", fontWeight: 500, fontSize: 15,
  margin: "4px 0 10px", letterSpacing: "-0.005em"
};
const italicized = { fontStyle: "italic", color: "var(--ink-2)" };

window.NXCopyOps = CopyOps;
