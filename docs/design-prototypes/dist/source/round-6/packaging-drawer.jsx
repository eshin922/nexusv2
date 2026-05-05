// Packaging drawer — relatively light. A flat table of components, one row
// per line, with per-tier columns. Markup% is per-component (not per-tier),
// shown as a chip. Inventory-eligible badge shown on raws that can be reused
// across projects (informational only — not editable here).
//
// On EMPTY, we show a single CTA card; the section row itself stays one line.

function PackagingDrawer({ data, tiers }) {
  if (data.status === "empty" || data.lines.length === 0) {
    return (
      <div className="r6-empty-drawer">
        <div className="glyph">∅</div>
        <h4>No packaging components yet</h4>
        <p>Add the bottle, dropper, label, and any cartons. Markup defaults will fill in from the firm's category rates — adjust per-line if needed.</p>
        <div className="actions">
          <button className="btn primary">+ Add packaging line</button>
          <button className="btn">Pull from inventory</button>
          <button className="btn ghost">Copy from another quote</button>
        </div>
      </div>
    );
  }

  const lineTotalForTier = (tierKey) => data.lines.reduce((s, l) => s + (l[tierKey] || 0), 0);

  return (
    <React.Fragment>
      <div className="drawer-toolbar">
        <div className="lhs">
          <span><strong>{data.lines.length}</strong> components</span>
          <span>·</span>
          <span>Markup defaults: <strong>per category</strong></span>
          <span>·</span>
          <span>Inventory-eligible items reusable across projects</span>
        </div>
        <div className="rhs">
          <button className="btn sm">+ Line</button>
          <button className="btn sm ghost">From inventory</button>
        </div>
      </div>

      <div className="r6-dt pkg" style={{ "--cols": tiers.length }}>
        <div className="r6-dt-head">
          <span>Component</span>
          <span>Category</span>
          <span>Supplier</span>
          <span className="num">Markup</span>
          {tiers.map((t) => (
            <span key={t.id} className="num">{t.label}<br /><span style={{ fontSize: "9px", letterSpacing: "0.04em", opacity: 0.7 }}>{t.units.toLocaleString()}</span></span>
          ))}
          <span></span>
        </div>

        {data.lines.map((line) => (
          <div key={line.id} className="r6-dt-row">
            <div className="name">
              <span className="lab">{line.name}</span>
              {line.notes && <span className="sub">{line.notes}</span>}
              {line.inventory_eligible && (
                <div className="r6-badges" style={{ marginTop: 4 }}>
                  <span className="r6-badge accent">inventory-eligible</span>
                </div>
              )}
            </div>
            <div className="cat">
              {line.category}
            </div>
            <div className="sup">{line.supplier}</div>
            <div className="num"><span className="markup">{(line.markup_pct * 100).toFixed(0)}%</span></div>
            {tiers.map((t) => {
              const v = line[t.id.toLowerCase()];
              return (
                <span key={t.id} className={`cell-num ${v == null ? "empty" : ""}`}>
                  {v == null ? "—" : `$${v.toFixed(2)}`}
                </span>
              );
            })}
            <div className="actions">···</div>
          </div>
        ))}

        <div className="r6-dt-foot">
          <span className="total-lab">Total — packaging</span>
          <span></span>
          <span></span>
          <span></span>
          {tiers.map((t) => {
            const v = lineTotalForTier(t.id.toLowerCase());
            const allMissing = data.lines.every((l) => l[t.id.toLowerCase()] == null);
            return (
              <span key={t.id} className={`num ${allMissing ? "empty" : ""}`}>
                {allMissing ? "—" : `$${v.toFixed(2)}`}
              </span>
            );
          })}
          <span></span>
        </div>
      </div>
    </React.Fragment>
  );
}

window.NXR6Packaging = PackagingDrawer;
