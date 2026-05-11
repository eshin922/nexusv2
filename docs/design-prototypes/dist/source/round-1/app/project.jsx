/* global React, NX_DATA, MarginVerdict */

function ProjectView({ onOpenQuote }) {
  const D = window.NX_DATA;
  const p = D.project;

  // Consolidated blockers — fold "what's blocking send" + "open blockers by SKU" into one
  const blockers = [
    { sku: "GLW-50", tier: "Tier 4", what: "CM/assembly fees TBD", role: "Production", who: "JK", mine: false },
    { sku: "RPL-400", tier: "Tier 3", what: "Freight not yet quoted", role: "Freight desk", who: "FW", mine: true },
    { sku: "CAP-60", tier: "Tier 2", what: "Bulk raws cost missing", role: "Purchasing", who: "TB", mine: false },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Project · {p.id}</p>
          <h1 className="page-title">{p.client} <em>— {p.deal}</em></h1>
          <p className="page-sub">Created {p.createdDays} days ago · last activity {p.lastActivityHrs}h ago · {p.salesRep} (sales) · {p.pmName} (PM)</p>
        </div>
        <div className="row gap-2">
          <a className="hub-link">↗ HubSpot · {p.hubspotId}</a>
          <button className="btn">Refresh from HubSpot</button>
        </div>
      </div>

      {/* ── ANCHOR 1 — Next action (loudest) ──────────────────────── */}
      <div className="next-action" style={{ marginBottom: 20 }}>
        <span className="glyph-circle">!</span>
        <div className="body">
          <p className="lead">Freight is <em>your</em> move on 3 SKU/tier combos.</p>
          <p className="meta">Tomás finished packaging on GLW-50 yesterday. Production fees are in for Tier 1–2. Once you confirm freight you can pull the costing sheet and tune for margin.</p>
        </div>
        <button className="btn primary" onClick={onOpenQuote}>Resume cost build →</button>
      </div>

      {/* ── ANCHOR 2 — Margin verdict (second-loudest), inside the active quote frame ── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <h3>Active quote · v3</h3>
          <div className="row gap-2">
            <span className="chip muted"><span className="dot" />Draft · not sent</span>
            <button className="btn ghost sm" onClick={onOpenQuote}>Open quote →</button>
          </div>
        </div>
        <div className="card-body">
          <MarginVerdict value={34.1} floor={25} target={35} label="Blended margin · all tiers · current state" />
        </div>
      </div>

      {/* ── SUBORDINATE substrate ─────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <h3>Blockers · {blockers.length} open</h3>
            <span className="meta">consolidated</span>
          </div>
          <div className="card-body" style={{ paddingTop: 6 }}>
            {blockers.map((b, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "auto auto 1fr auto auto",
                alignItems: "center", gap: 12, padding: "10px 0",
                borderBottom: i === blockers.length - 1 ? "none" : "1px solid var(--rule)"
              }}>
                <span className="chip muted mono">{b.sku} / {b.tier}</span>
                <span style={{ fontSize: 13, color: "var(--ink)" }}>{b.what}</span>
                <span></span>
                <span className="row gap-2" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  <span className="avatar xs">{b.who}</span>{b.role}
                </span>
                {b.mine ? <span className="chip accent">Your move</span> : <span className="chip muted" style={{fontSize:10}}>Waiting</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Reference · context</h3>
          </div>
          <div className="card-body">
            <dl className="kv">
              <dt>Stage</dt><dd>{p.stage}</dd>
              <dt>Tiers</dt><dd>10k · 25k · 50k · 100k</dd>
              <dt>SKUs</dt><dd>5 defined</dd>
              <dt>Valid until</dt><dd className="muted">Set on first send</dd>
            </dl>
            <div style={{ borderTop: "1px solid var(--rule)", marginTop: 12, paddingTop: 12 }}>
              <p className="eyebrow" style={{ marginBottom: 8 }}>Live · 2 editing</p>
              <div className="col gap-2">
                {D.presence.map(u => (
                  <div className="row gap-2" key={u.id} style={{ fontSize: 12.5 }}>
                    <span className="avatar xs">{u.id}</span>
                    <span style={{ color: "var(--ink)" }}>{u.name}</span>
                    <span className="muted">· {u.viewing}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Activity, collapsed ───────────────────────────────── */}
      <details style={{ marginTop: 16 }}>
        <summary style={{
          cursor: "pointer", padding: "12px 16px", background: "var(--paper)",
          border: "1px solid var(--rule)", borderRadius: 8,
          fontSize: 13, color: "var(--ink-2)", listStyle: "none",
          display: "flex", alignItems: "center", gap: 8
        }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>▸</span>
          Since you were last here · 3 days ago — Tomás added 2 supplier costs · Jin set production fees · Freight desk submitted ocean quote
        </summary>
        <div className="card" style={{ marginTop: 8 }}>
          <div className="card-body">
            <div className="activity">
              {D.activity.map((a, i) => (
                <div className="activity-item" key={i}>
                  <span className="who"><span className="avatar sm">{a.who}</span></span>
                  <div className="what">
                    <span className="actor">{a.whoName}</span> {a.verb} <span className="obj">{a.obj}</span>
                  </div>
                  <span className="when">{a.when}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

window.ProjectView = ProjectView;
