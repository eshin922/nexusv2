/* global React, NXR6_2 */
// R6.2 Freight Panel — REVISION 1
// Changes vs original:
// - CBM/unit removed from customs cluster
// - Insurance toggle + rollup badges removed
// - transit_lead_weeks replaced by cargo_ready_date + vessel_etd (P1)
// - Multi-leg P1 (active +Add leg)
// - Per-component markup (freight/duty/tariff) as inline pills (P1)
// - crosses_international_border drives customs visibility (widened rule)
// - customer_arranges.ready_date renamed cargo_ready_date, promoted to leg head
// - PDF slot rendered P1, upload mechanism P2
// - Total transit caption in leg-group header

const { useState: useStateR62 } = React;

const fmtPctIn = (v) => (v * 100).toFixed(1) + "%";
const fmtDate = (d) => d ? d : "—";

function FreightPanel({ mode, onChangeMode, scenario }) {
  const [drawerOpen, setDrawerOpen] = useStateR62(false);

  return (
    <div className="r62-page" data-screen-label="R6.2 Freight">
      <PageHead onAddLeg={() => setDrawerOpen(true)} />

      <div className="r62-dn">
        <span className="lbl">DN · R6.2 rev 1</span>
        Multi-leg active in P1 — Shenzhen → Korea → US is now a real journey, not a v1.1 deferral. CBM and insurance removed from P1; <code>cargo_ready_date</code> + <code>vessel_etd</code> replace <code>transit_lead_weeks</code>. <strong>Per-component markup</strong> (freight / duty / tariff) lands as inline pills — default 0.30, click a pill to override. Customs cluster widens: any leg that crosses a border with DPS-customs obligation shows the cluster.
      </div>

      <div className="r62-card">
        <ModeChooser mode={mode} onChangeMode={onChangeMode} />
        {scenario && scenario.leg_group && (
          <LegGroup legGroup={scenario.leg_group} mode={mode} onAddLeg={() => setDrawerOpen(true)} />
        )}
        {mode === "empty" && <EmptyState onChangeMode={onChangeMode} onAddLeg={() => setDrawerOpen(true)} />}
      </div>

      <DownstreamRollup mode={mode} scenario={scenario} />

      {drawerOpen && <AddLegDrawer onClose={() => setDrawerOpen(false)} mode={mode} />}
    </div>
  );
}

function PageHead({ onAddLeg }) {
  return (
    <div className="r62-head">
      <div className="lhs">
        <div className="eyebrow">Lumen &amp; Co.<span className="sep">·</span>Primary<span className="sep">·</span>v4 draft</div>
        <h1>Freight <em>· complete panel · rev 1</em></h1>
        <p className="sub">Multi-leg journeys, per-component markup, dual date fields, widened customs visibility.</p>
      </div>
      <div className="actions">
        <button className="btn ghost sm" onClick={onAddLeg}>+ Add leg</button>
        <button className="btn primary">Save draft</button>
      </div>
    </div>
  );
}

function ModeChooser({ mode, onChangeMode }) {
  return (
    <div className="r62-mode">
      <div className={`opt ${mode === "dps_arranges" ? "on" : ""}`} onClick={() => onChangeMode("dps_arranges")}>
        <div className="lab">DPS arranges</div>
        <div className="desc">We book the forwarder. Bundled or pass-through per leg.</div>
        <div className="consequence">→ Full freight line(s) + customs where border-crossing</div>
      </div>
      <div className={`opt ${mode === "multi_leg" ? "on" : ""}`} onClick={() => onChangeMode("multi_leg")}>
        <div className="lab">Multi-leg journey</div>
        <div className="desc">Shenzhen → Busan → Long Beach. Two carriers, summed costs.</div>
        <div className="consequence">→ Each border-crossing leg accrues customs</div>
      </div>
      <div className={`opt ${mode === "customer_arranges" ? "on" : ""}`} onClick={() => onChangeMode("customer_arranges")}>
        <div className="lab">Customer arranges</div>
        <div className="desc">EXW / FCA / CIF — customer handles the shipment.</div>
        <div className="consequence">→ Zero freight cost, persistent metadata</div>
      </div>
    </div>
  );
}

function EmptyState({ onChangeMode, onAddLeg }) {
  return (
    <div className="r62-empty">
      <div className="glyph">∅</div>
      <h4>No freight entered yet</h4>
      <p>Pick a mode above, add the first leg directly, or skip if freight isn't known yet.</p>
      <div className="actions">
        <button className="btn primary" onClick={onAddLeg}>+ Add first leg</button>
        <button className="btn" onClick={() => onChangeMode("customer_arranges")}>Customer arranges</button>
      </div>
    </div>
  );
}

function LegGroup({ legGroup, mode, onAddLeg }) {
  return (
    <div className="r62-leg-group">
      <div className="r62-leg-group-head">
        <span className="label">{legGroup.label}</span>
        <span className="meta">· {legGroup.legs.length} leg{legGroup.legs.length === 1 ? "" : "s"}
          {legGroup.journey_transit_weeks != null && <span style={{ marginLeft: 12, color: "var(--ink-2)" }}>· {legGroup.journey_transit_weeks}w total transit <span className="r62-phase-tag p1" style={{ marginLeft: 4 }}>P1</span></span>}
        </span>
        <button className="add-leg" onClick={onAddLeg}>+ Add leg</button>
      </div>
      {legGroup.legs.map(leg => <Leg key={leg.id} leg={leg} mode={mode} />)}
    </div>
  );
}

// Markup pill — inline override (P1)
function MarkupPill({ value, onChange }) {
  const [open, setOpen] = useStateR62(false);
  const isDefault = Math.abs(value - 0.30) < 0.0001;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
      {open ? (
        <input
          autoFocus
          defaultValue={(value * 100).toFixed(0)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => e.key === "Enter" && setOpen(false)}
          style={{
            width: 48, padding: "2px 6px",
            border: "1px solid var(--accent)", borderRadius: 4,
            fontFamily: "var(--mono)", fontSize: 11, background: "var(--paper)",
            color: "var(--ink)", textAlign: "right",
          }}
        />
      ) : (
        <button
          onClick={() => setOpen(true)}
          title={isDefault ? "Default · click to override" : "Override · click to edit"}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            padding: "1px 6px", borderRadius: 4,
            fontFamily: "var(--mono)", fontSize: 10,
            background: isDefault ? "var(--paper-3)" : "oklch(from var(--accent) l c h / 0.12)",
            color: isDefault ? "var(--ink-3)" : "var(--accent-ink)",
            border: `1px solid ${isDefault ? "var(--rule)" : "oklch(from var(--accent) l c h / 0.30)"}`,
            cursor: "pointer", lineHeight: 1.4, letterSpacing: 0.02,
          }}
        >
          × {(1 + value).toFixed(2)}
          {!isDefault && <span style={{ fontSize: 9, opacity: 0.7 }}>OVR</span>}
        </button>
      )}
    </span>
  );
}

function Leg({ leg, mode }) {
  const D = window.NXR6_2;
  const [treatment, setTreatment] = useStateR62(leg.treatment || "bundled");
  const isCustomerArranges = mode === "customer_arranges";

  // REVISED visibility: international border crossing + DPS-customs obligation
  const showCustoms = !isCustomerArranges
    && leg.crosses_international_border
    && leg.incoterm === "DDP"
    && leg.customs;

  // Transit lead derived from dates (P1)
  const computedTransit = (() => {
    if (!leg.cargo_ready_date || !leg.vessel_etd) return null;
    const ms = new Date(leg.vessel_etd) - new Date(leg.cargo_ready_date);
    return Math.round(ms / (1000 * 60 * 60 * 24 * 7) * 10) / 10;
  })();

  return (
    <div className="r62-leg">
      <div className="r62-leg-head">
        <span className={`direction ${leg.direction}`}>{leg.direction}</span>
        <div className="lhs">
          <span className="lab">{leg.label}</span>
          <span className="route">
            <span>{leg.origin || "—"}</span>
            <span className="arrow">→</span>
            <span>{leg.destination || (isCustomerArranges ? "(customer's destination)" : "—")}</span>
            {leg.crosses_international_border && (
              <span style={{
                fontFamily: "var(--mono)", fontSize: 9, letterSpacing: 0.06,
                padding: "1px 6px", borderRadius: 3, marginLeft: 6,
                background: "oklch(0.55 0.07 215 / 0.12)", color: "oklch(0.45 0.10 215)",
                textTransform: "uppercase",
              }}>↔ border</span>
            )}
            <span className="r62-phase-tag p2">P2</span>
          </span>
        </div>
        {!isCustomerArranges && (
          <div className="r62-treat">
            <button className={treatment === "bundled" ? "on bundled" : ""} onClick={() => setTreatment("bundled")}>Bundled</button>
            <button className={treatment === "passthrough" ? "on passthrough" : ""} onClick={() => setTreatment("passthrough")}>Passthrough</button>
          </div>
        )}
        {isCustomerArranges && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.05em" }}>
            COST = $0 · METADATA ONLY
          </span>
        )}
        <div className="actions">···</div>
      </div>

      {/* Leg body */}
      <div className="r62-leg-body">
        <div className="field">
          <div className="lbl">Mode <span className="r62-phase-tag p1">P1</span></div>
          {isCustomerArranges ? <div className="display">{leg.mode}</div> : <select defaultValue={leg.mode}>{D.modes.map(m => <option key={m} value={m}>{m}</option>)}</select>}
        </div>
        <div className="field">
          <div className="lbl">Carrier / forwarder <span className="r62-phase-tag p1">P1</span></div>
          {isCustomerArranges ? <div className="display" style={{ color: "var(--ink-4)", fontStyle: "italic" }}>(customer's choice)</div> : <input defaultValue={leg.carrier || ""} />}
        </div>
        <div className="field">
          <div className="lbl">Incoterm <span className="r62-phase-tag p1">P1</span></div>
          {isCustomerArranges ? <div className="display">{leg.incoterm}</div> : <select defaultValue={leg.incoterm}>{D.incoterms.map(t => <option key={t.value} value={t.value}>{t.value} — {t.desc}</option>)}</select>}
        </div>
        {/* REVISED: cargo_ready_date (P1, all modes) */}
        <div className="field">
          <div className="lbl">Cargo ready <span className="r62-phase-tag p1">P1</span></div>
          <input defaultValue={leg.cargo_ready_date || ""} placeholder="YYYY-MM-DD" />
        </div>
        {/* REVISED: vessel_etd (P1, always-show per Q2; optional on FOB/EXW) */}
        {!isCustomerArranges && (
          <div className="field">
            <div className="lbl">
              Vessel ETD <span className="r62-phase-tag p1">P1</span>
              {(leg.incoterm === "FOB" || leg.incoterm === "EXW") && (
                <span style={{ marginLeft: 4, fontSize: 9, color: "var(--ink-4)", fontStyle: "italic", letterSpacing: 0 }}>· optional</span>
              )}
            </div>
            <input defaultValue={leg.vessel_etd || ""} placeholder="YYYY-MM-DD" />
          </div>
        )}
        {/* REVISED: freight markup pill inline with the freight cost context */}
        {!isCustomerArranges && (
          <div className="field">
            <div className="lbl">Freight markup <span className="r62-phase-tag p1">P1</span></div>
            <div style={{ display: "flex", alignItems: "center", padding: "4px 0" }}>
              <MarkupPill value={leg.freight_markup_pct} />
              {computedTransit != null && (
                <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", letterSpacing: 0.04 }}>
                  · {computedTransit}w in transit
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Customer-arranges populated state — ready_date now on leg head, only contact + audit here */}
      {isCustomerArranges && leg.customer_arranges_meta && (
        <div className="r62-customer-meta">
          <div className="field">
            <div className="lbl">Customer freight contact <span className="r62-phase-tag p1">P1</span></div>
            <input defaultValue={leg.customer_arranges_meta.customer_contact} />
          </div>
          <div className="field audit-note-field">
            <div className="lbl">Audit note <span className="r62-phase-tag p1">P1</span></div>
            <textarea defaultValue={leg.customer_arranges_meta.audit_note} />
          </div>
        </div>
      )}

      {/* Per-tier rate table */}
      {!isCustomerArranges && (
        <div className="r62-tier-table">
          <div className="r62-tier-thead">
            <span>Tier</span>
            <span>Units</span>
            <span className="num">Total freight (cost)</span>
            <span className="num">Per unit (billable)</span>
            <span></span>
          </div>
          {leg.tiers.map(t => {
            const cost = t.total_freight;
            const billablePerUnit = cost != null ? (cost * (1 + leg.freight_markup_pct)) / t.units : null;
            return (
              <div key={t.id} className="r62-tier-row">
                <span className="tier-label">{t.id}</span>
                <span className="units">{t.units.toLocaleString()}</span>
                <span className="num">
                  {cost == null ? <input placeholder="—" /> : <input defaultValue={`$${cost.toLocaleString()}`} />}
                </span>
                <span className="num per-unit">
                  {billablePerUnit == null
                    ? <span style={{ color: "var(--ink-4)", fontStyle: "italic", fontFamily: "var(--ui)", fontSize: 11 }}>—</span>
                    : <React.Fragment>
                        ${billablePerUnit.toFixed(2)}
                        <span className="raw">${cost.toLocaleString()} × 1.{(leg.freight_markup_pct * 100).toFixed(0).padStart(2, "0")} ÷ {t.units.toLocaleString()}</span>
                      </React.Fragment>
                  }
                </span>
                <span></span>
              </div>
            );
          })}
        </div>
      )}

      {/* Customs cluster — REVISED visibility rule + per-component markup pills */}
      {showCustoms && (
        <div className="r62-customs">
          <div className="r62-customs-head">
            <span className="lab">Customs · {leg.incoterm} · border crossing <span className="r62-phase-tag p1">P1</span></span>
            <span className="desc">Duty + tariff land on freight at port of entry · markup applied to amount, not rate</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div className="cell">
              <div className="ck">Duty rate</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <input defaultValue={fmtPctIn(leg.customs.duty_pct)} style={{ flex: "0 0 60px" }} />
                <MarkupPill value={leg.duty_markup_pct} />
              </div>
            </div>
            <div className="cell">
              <div className="ck">Tariff (Section 301)</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <input defaultValue={fmtPctIn(leg.customs.tariff_pct)} style={{ flex: "0 0 60px" }} />
                <MarkupPill value={leg.tariff_markup_pct} />
              </div>
            </div>
          </div>
          <div style={{
            marginTop: 8, paddingTop: 8, borderTop: "1px dashed oklch(0.55 0.07 215 / 0.25)",
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", letterSpacing: 0.04,
            textTransform: "uppercase",
          }}>
            Math: duty_billable = duty_pct × goods_cost × (1 + duty_markup) · tariff same · feeds D+T row
          </div>
        </div>
      )}

      {/* PDF slot — RENDERED P1, upload mechanism P2 */}
      {!isCustomerArranges && (
        leg.forwarder_quote_pdf ? (
          <div className="r62-pdf">
            <span className="icon">PDF</span>
            <div className="info">
              <div className="fname">{leg.forwarder_quote_pdf.filename}</div>
              <div className="meta">uploaded {leg.forwarder_quote_pdf.uploaded_at} · {leg.forwarder_quote_pdf.size_kb} KB · per-leg attachment</div>
            </div>
            <div className="actions">
              <a href="#">View</a>
              <a href="#">Replace</a>
              <span className="r62-phase-tag p2">upload · P2</span>
            </div>
          </div>
        ) : (
          <div className="r62-pdf empty">
            ↑ Attach forwarder quote PDF <span className="r62-phase-tag p2" style={{ marginLeft: 8 }}>upload · P2</span>
          </div>
        )
      )}
    </div>
  );
}

function DownstreamRollup({ mode, scenario }) {
  if (mode === "empty" || !scenario || !scenario.leg_group) return null;
  const legs = scenario.leg_group.legs;
  // Per-tier freight billable = sum across legs of (total_freight × (1+markup) ÷ units)
  const freightT2 = legs.reduce((s, leg) => {
    const t = leg.tiers.find(t => t.id === "T2");
    if (!t || t.total_freight == null) return s;
    return s + (t.total_freight * (1 + leg.freight_markup_pct)) / t.units;
  }, 0);
  const customsCount = legs.filter(l => l.crosses_international_border && l.incoterm === "DDP").length;

  return (
    <div className="r62-card">
      <div className="r62-card-head">
        <h3>Downstream rollup</h3>
        <span className="meta">→ how this lands in the cost stack at T2</span>
      </div>
      <div style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
        {mode === "customer_arranges" ? (
          <React.Fragment>
            Customer-arranges → <strong style={{ color: "var(--ink)" }}>FRT row hidden</strong> in the cost stack. Persistent metadata (<code>cargo_ready_date</code>, contact, audit) carries forward to Mark-Accepted and the customer-facing quote PDF.
          </React.Fragment>
        ) : (
          <React.Fragment>
            <strong style={{ color: "var(--ink)" }}>FRT row at T2: ${freightT2.toFixed(2)} / unit</strong> — sum across {legs.length} {legs.length === 1 ? "leg" : "legs"}, each leg's <code>total_freight × (1 + freight_markup)</code> ÷ units.
            <br />
            <strong style={{ color: "var(--ink)" }}>D+T row:</strong> {customsCount > 0 ? <>sum of <code>duty_billable + tariff_billable</code> across {customsCount} border-crossing {customsCount === 1 ? "leg" : "legs"} · rolls into internal-only D+T (purple hatch)</> : "no customs legs"}.
            <br />
            <span style={{ color: "var(--ink-3)" }}>Pass-through legs would surface separately on the customer quote PDF as a billable. Forwarder identity stays internal-only.</span>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

// Add-leg drawer — REVISED with dates + markup pills + widened customs rule
function AddLegDrawer({ onClose, mode }) {
  const D = window.NXR6_2;
  const [direction, setDirection] = useStateR62("outbound");
  const [incoterm, setIncoterm] = useStateR62("DDP");
  const [crossesBorder, setCrossesBorder] = useStateR62(true);
  const [freightMk, setFreightMk] = useStateR62(0.30);
  const [dutyMk, setDutyMk] = useStateR62(0.30);
  const [tariffMk, setTariffMk] = useStateR62(0.30);
  const isCustomerArranges = mode === "customer_arranges";
  const showCustoms = crossesBorder && incoterm === "DDP" && !isCustomerArranges;
  const demoTiers = [{ id: "T1", units: 5000 }, { id: "T2", units: 10000 }, { id: "T3", units: 25000 }];

  return (
    <div className="r62-drawer-backdrop" onClick={onClose}>
      <div className="r62-drawer" onClick={e => e.stopPropagation()}>
        <div className="r62-drawer-head">
          <div>
            <h2>Add freight leg</h2>
            <p className="sub">Customs cluster appears when this leg crosses an international border with DPS-customs obligation.</p>
          </div>
          <button className="close" onClick={onClose}>✕</button>
        </div>

        <div className="r62-drawer-body">
          <div className="row-pair">
            <div className="field">
              <div className="lbl">Direction</div>
              <select value={direction} onChange={e => setDirection(e.target.value)}>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
            </div>
            <div className="field">
              <div className="lbl">Incoterm</div>
              <select value={incoterm} onChange={e => setIncoterm(e.target.value)}>
                {D.incoterms.map(t => <option key={t.value} value={t.value}>{t.value} — {t.desc}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <div className="lbl">Label</div>
            <input placeholder="e.g., Shenzhen → Busan · Bulk container" />
          </div>

          <div className="row-pair">
            <div className="field">
              <div className="lbl">Mode</div>
              <select defaultValue="Ocean FCL">{D.modes.map(m => <option key={m} value={m}>{m}</option>)}</select>
            </div>
            <div className="field">
              <div className="lbl">Carrier</div>
              <input placeholder="Sino Logistics" />
            </div>
          </div>

          <div className="row-route">
            <div className="field">
              <div className="lbl">Origin</div>
              <input placeholder="Shenzhen Yantian Port" />
            </div>
            <span className="arrow">→</span>
            <div className="field">
              <div className="lbl">Destination</div>
              <input placeholder="Long Beach Port" />
            </div>
          </div>

          <div className="row-pair">
            <div className="field">
              <div className="lbl">Cargo ready date</div>
              <input placeholder="YYYY-MM-DD" />
            </div>
            <div className="field">
              <div className="lbl">
                Vessel ETD
                {(incoterm === "FOB" || incoterm === "EXW") && (
                  <span style={{ marginLeft: 4, fontSize: 9, color: "var(--ink-4)", fontStyle: "italic" }}>· optional</span>
                )}
              </div>
              <input placeholder="YYYY-MM-DD" />
            </div>
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", background: "var(--paper-2)",
            border: "1px solid var(--rule)", borderRadius: 6,
            fontSize: 12,
          }}>
            <input type="checkbox" checked={crossesBorder} onChange={e => setCrossesBorder(e.target.checked)} />
            <span>Crosses international border with DPS-customs obligation</span>
            <span style={{
              marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9.5,
              color: "var(--ink-4)", letterSpacing: 0.06, textTransform: "uppercase",
            }}>drives customs visibility</span>
          </div>

          <div style={{
            padding: "10px 14px", background: "var(--paper-2)",
            border: "1px solid var(--rule)", borderRadius: 6,
          }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: 0.10, textTransform: "uppercase", color: "var(--ink-4)", marginBottom: 8 }}>Markup pcts · per-component · default 0.30</div>
            <div style={{ display: "flex", gap: 18, alignItems: "center", fontSize: 12 }}>
              <span>Freight <MarkupPill value={freightMk} /></span>
              <span>Duty <MarkupPill value={dutyMk} /></span>
              <span>Tariff <MarkupPill value={tariffMk} /></span>
            </div>
          </div>

          {!isCustomerArranges && (
            <div className="r62-drawer-section">
              <h4>Rates per tier</h4>
              <div className="r62-drawer-rates">
                <span className="h">Tier</span>
                <span className="h num">Total freight</span>
                <span className="h num">Per unit (billable)</span>
                {demoTiers.map(t => (
                  <React.Fragment key={t.id}>
                    <span className="t-lab">{t.id}</span>
                    <input placeholder="$ — " />
                    <span className="per-unit">—</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {showCustoms && (
            <div className="r62-drawer-section">
              <h4>Customs · {incoterm} · border</h4>
              <div className="grid3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div className="field">
                  <div className="lbl">Duty %</div>
                  <input placeholder="5.8%" />
                </div>
                <div className="field">
                  <div className="lbl">Tariff %</div>
                  <input placeholder="7.5%" />
                </div>
              </div>
            </div>
          )}

          <div className="r62-drawer-pdf">
            ↑ Attach forwarder quote PDF <span className="r62-phase-tag p2" style={{ marginLeft: 8 }}>upload · P2</span>
          </div>
        </div>

        <div className="r62-drawer-foot">
          <span className="left">⌥ Border + incoterm drive customs visibility · markup applied to amount</span>
          <div className="right">
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={onClose}>Add leg</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.NXR62Panel = FreightPanel;
