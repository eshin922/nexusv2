/* global React, NX_DATA, MarginVerdict, TierRail */

function QuoteSetup({ onContinue }) {
  const D = window.NX_DATA;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Quote setup · v3</p>
          <h1 className="page-title">Define <em>SKUs &amp; volume tiers</em></h1>
          <p className="page-sub">Done once per quote. Tiers become first-class views — not duplicate columns of inputs.</p>
        </div>
        <div className="row gap-2">
          <button className="btn">Save draft</button>
          <button className="btn primary" onClick={onContinue}>Continue to cost build →</button>
        </div>
      </div>

      <div className="setup-grid">
        {/* Left — SKUs */}
        <div className="card">
          <div className="card-head">
            <h3>SKUs · 5 defined</h3>
            <button className="btn ghost sm">+ Add SKU</button>
          </div>
          <div className="card-body">
            <div className="col gap-2">
              <div className="row gap-2 muted mono" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 12px" }}>
                <span style={{ width: 36 }}>#</span>
                <span style={{ flex: 2 }}>Label · product</span>
                <span style={{ flex: 1 }}>Category</span>
                <span style={{ width: 90, textAlign: "right" }}>Units / pack</span>
                <span style={{ width: 90, textAlign: "right" }}>Retail $</span>
                <span style={{ width: 36 }}></span>
              </div>
              {D.skus.map((s, i) => (
                <div className="sku-table-row" key={s.id}>
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <div style={{ fontSize: 13.5, color: "var(--ink)" }}>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", marginRight: 8 }}>{s.label}</span>
                      {s.name}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{s.pack}</div>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>{s.category}</span>
                  <input className="input mono" defaultValue="1" style={{ padding: "5px 8px", fontSize: 12.5 }} />
                  <input className="input mono" defaultValue={s.retail} style={{ padding: "5px 8px", fontSize: 12.5 }} />
                  <button className="x" style={{ background: "transparent", border: "none", color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 14 }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 14, background: "var(--paper-2)", borderRadius: 8, fontSize: 12.5, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 12 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Tip</span>
              Recall a SKU template from a previous Lumen &amp; Co. quote? <a>Browse templates →</a>
            </div>
          </div>
        </div>

        {/* Right — Tiers */}
        <div className="col gap-4">
          <div className="card">
            <div className="card-head">
              <h3>Volume tiers</h3>
              <button className="btn ghost sm">+ Add tier</button>
            </div>
            <div className="card-body">
              <div className="tier-builder">
                {D.tiers.map((t, i) => (
                  <div className="tier-row" key={t.id}>
                    <span className="idx">T{i + 1}</span>
                    <input className="input" defaultValue={t.label + " — " + (t.qty / 1000) + "k"} style={{ padding: "6px 10px", fontSize: 13 }} />
                    <input className="input mono" defaultValue={t.qty.toLocaleString()} style={{ padding: "6px 10px", fontSize: 12.5 }} />
                    <button className="x">×</button>
                  </div>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.5 }}>
                Tiers will appear as switchable views on the cost build. The active tier is the one you're
                editing; the others live in the rail with margin-at-a-glance.
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Margin policy · auto-applied</h3>
              <span className="chip muted">From admin</span>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>Floor</dt><dd>25.0% <span className="muted" style={{ fontSize: 11 }}>· hard block, admin override</span></dd>
                <dt>Target</dt><dd>35.0% <span className="muted" style={{ fontSize: 11 }}>· soft warning below</span></dd>
                <dt>Default markup</dt><dd>40% packaging · 30% production · 15% freight</dd>
              </dl>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>From HubSpot · read-only</h3>
              <a className="hub-link">↗ Sync now</a>
            </div>
            <div className="card-body">
              <dl className="kv">
                <dt>Client</dt><dd>Lumen &amp; Co.</dd>
                <dt>Deal</dt><dd>Q3 Replenish + Glow Capsule Launch</dd>
                <dt>Sales rep</dt><dd>Tomás Beck</dd>
                <dt>Owner</dt><dd>Maya Okafor</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.QuoteSetup = QuoteSetup;
