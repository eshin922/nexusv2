// Freight drawer — multi-line because real shipments aren't monolithic.
// A typical run has bulk inbound (Verre → Marin) and outbound (Marin →
// customer warehouse), often with different incoterms. Each line carries
// its own treatment: bundled (rolled into FRT on the cost stack) vs.
// pass_through (shown to the customer as a separate billable). Putting
// treatment on the LINE — not the section — is the correct grain.
//
// Customs uses the same blue family as freight, deliberately, so the
// section reads as one cohesive cluster instead of three competing colors.
// The customs sub-card shows CBM, duty, tariff: the three numbers that
// usually live in someone's spreadsheet head.

function FreightDrawer({ data, tiers, onChangeTreatment }) {
  if (data.status === "empty" || data.lines.length === 0) {
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No freight lines yet</h4>
        <p>Add inbound (raws → CM) and outbound (CM → customer) shipments. Each line can be bundled into the unit cost or passed through as a separate billable.</p>
        <div className="actions">
          <button className="btn primary">+ Add freight line</button>
          <button className="btn ghost">Skip — customer arranges</button>
        </div>
      </div>
    );
  }

  return (
    <React.Fragment>
      <div className="drawer-toolbar">
        <div className="lhs">
          <span><strong>{data.lines.length}</strong> freight line{data.lines.length === 1 ? "" : "s"}</span>
          <span>·</span>
          <span>Treatment is per-line, not section-wide</span>
          <span>·</span>
          <span>Customs (duty + tariff) on DDP lines only</span>
        </div>
        <div className="rhs">
          <button className="btn sm">+ Line</button>
        </div>
      </div>

      {data.lines.map((line) => (
        <FreightLine key={line.id} line={line} tiers={tiers} onChangeTreatment={onChangeTreatment} />
      ))}

      <button className="r6-fr-add">+ Add another freight line</button>
    </React.Fragment>
  );
}

function FreightLine({ line, tiers, onChangeTreatment }) {
  return (
    <div className="r6-fr-line">
      <div className="r6-fr-line-head">
        <div className="lhs">
          <div className="lab">{line.label}</div>
          <div className="meta">
            <span>{line.mode}</span>
            <span className="sep">·</span>
            <span>{line.supplier}</span>
            <span className="sep">·</span>
            <span>{line.incoterm}</span>
          </div>
        </div>

        <div className="r6-fr-treat">
          <button
            className={`${line.treatment === "bundled" ? "on bundled" : ""}`}
            onClick={() => onChangeTreatment && onChangeTreatment(line.id, "bundled")}
          >Bundled</button>
          <button
            className={`${line.treatment === "pass_through" ? "on pass_through" : ""}`}
            onClick={() => onChangeTreatment && onChangeTreatment(line.id, "pass_through")}
          >Passthrough</button>
        </div>

        <div className="actions">···</div>
      </div>

      <div
        className="r6-fr-tiers"
        style={{ gridTemplateColumns: `1.4fr ${tiers.map(() => "1fr").join(" ")}` }}
      >
        <span className="lab">{line.treatment === "bundled" ? "Per-unit (rolls into FRT)" : "Per-unit (shown to customer)"}</span>
        {tiers.map((t) => {
          const tierData = line.tiers.find((tl) => tl.id === t.id);
          const v = tierData ? tierData.per_unit : null;
          return (
            <span key={t.id} className={`num ${v == null ? "empty" : ""}`}>
              {v == null ? "—" : `$${v.toFixed(2)}`}
              {tierData && tierData.total_freight != null && (
                <span className="raw">${tierData.total_freight.toLocaleString()} ÷ {t.units.toLocaleString()}</span>
              )}
            </span>
          );
        })}
      </div>

      {line.customs && (
        <div className="r6-fr-customs">
          <div className="head">
            <span className="lab">Customs · {line.incoterm}</span>
            <span className="desc">Duty + tariff land on freight at port of entry</span>
          </div>
          <div className="grid">
            <div className="cell">
              <div className="ck">CBM / unit</div>
              <div className="cv">{line.customs.cbm_per_unit.toFixed(4)} m³</div>
            </div>
            <div className="cell">
              <div className="ck">Duty rate</div>
              <div className="cv">{(line.customs.duty_pct * 100).toFixed(1)}%</div>
            </div>
            <div className="cell">
              <div className="ck">Tariff (Section 301)</div>
              <div className="cv">{(line.customs.tariff_pct * 100).toFixed(1)}%</div>
            </div>
          </div>
          <div className="desc-foot">
            On DDP, duty and tariff are our cost — landed and rolled into the bundled per-unit above. Switch to FOB or DAP and the customer pays them at port; the freight per-unit drops accordingly.
          </div>
        </div>
      )}
    </div>
  );
}

window.NXR6Freight = FreightDrawer;
