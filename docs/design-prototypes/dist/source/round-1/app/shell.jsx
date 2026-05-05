/* global React */

// ─── Brand ─────────────────────────────────────────────
function Brand() {
  return (
    <div className="brand">
      <svg className="mark" width="22" height="22" viewBox="0 0 78 78" fill="none" aria-hidden="true">
        <path d="M 8 8 L 8 70 L 14 70 L 14 22 L 64 70 L 70 70 L 70 8 L 64 8 L 64 56 L 14 8 Z" fill="currentColor" />
        <rect x="34" y="36" width="10" height="2" fill="var(--accent)" />
      </svg>
      <span className="name">Nexus</span>
      <span className="ver">v2 · concept</span>
    </div>
  );
}

// ─── Sidebar ───────────────────────────────────────────
function Sidebar({ route, onRoute }) {
  const D = window.NX_DATA;
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="side-section">
        <h6>Workspace</h6>
        <button className="side-link"><span className="glyph">◇</span>Pipeline</button>
        <button className="side-link"><span className="glyph">○</span>My deals<span className="badge">7</span></button>
        <button className="side-link"><span className="glyph">⌗</span>Scenarios</button>
      </nav>
      <nav className="side-section">
        <h6>This project · Lumen &amp; Co.</h6>
        <button className={"side-link" + (route === "project" ? " active" : "")} onClick={() => onRoute("project")}>
          <span className="glyph">◆</span>Overview
        </button>
        <button className={"side-link" + (route === "setup" ? " active" : "")} onClick={() => onRoute("setup")}>
          <span className="glyph">┃</span>Quote setup
        </button>
        <button className={"side-link" + (route === "build" ? " active" : "")} onClick={() => onRoute("build")}>
          <span className="glyph">▤</span>Cost build<span className="badge">2 todo</span>
        </button>
        <button className={"side-link" + (route === "costing" ? " active" : "")} onClick={() => onRoute("costing")}>
          <span className="glyph">∑</span>Costing sheet
        </button>
      </nav>
      <nav className="side-section">
        <h6>Round 2</h6>
        <button className={"side-link" + (route === "notes" ? " active" : "")} onClick={() => onRoute("notes")}>
          <span className="glyph">✎</span>Designer notes
        </button>
      </nav>
      <div className="side-foot">
        <span className="avatar sm">{D.project.pmInitials}</span>
        <div>
          {D.project.pmName}<br />
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>PM · Sales</span>
        </div>
      </div>
    </aside>
  );
}

// ─── Topbar ────────────────────────────────────────────
function Topbar({ crumbs, presence }) {
  return (
    <header className="topbar">
      <nav className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {c.here ? <span className="here">{c.label}</span> : <a>{c.label}</a>}
          </React.Fragment>
        ))}
      </nav>
      <div className="right">
        {presence && (
          <div className="presence">
            <span className="live"></span>
            <span>Live · {presence.length} editing</span>
            <span className="dots">
              {presence.map(p => (
                <span key={p.id} className="avatar sm" title={`${p.name} — ${p.viewing}`}>{p.id}</span>
              ))}
            </span>
          </div>
        )}
        <button className="btn ghost sm">⌘K Search</button>
        <button className="btn sm">Share</button>
      </div>
    </header>
  );
}

// ─── Designer note (call-outs) ─────────────────────────
function DN({ children }) {
  return <div className="designer-note">{children}</div>;
}

// ─── Margin verdict ────────────────────────────────────
// floor and target are %; value is %; range visualized 0..50
function MarginVerdict({ value, floor, target, label = "Blended margin", maxR = 50 }) {
  const status = value >= target ? "good" : value >= floor ? "warn" : "bad";
  const tag = status === "good" ? "Good — above target" : status === "warn" ? "Below target — soft warning" : "Below floor — admin override required";
  const pos = Math.min(Math.max((value / maxR) * 100, 4), 96);
  const floorPos = (floor / maxR) * 100;
  const targetPos = (target / maxR) * 100;

  return (
    <div className={`verdict ${status}`}>
      <div>
        <div className="label">{label}</div>
        <div className="num">{value.toFixed(1)}<span className="pct">%</span></div>
        <div className="status-tag">
          <span className="dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
          {tag}
        </div>
      </div>
      <div>
        <div className="range">
          <div className="track" style={{
            background: `linear-gradient(to right,
              var(--bad-soft) 0%, var(--bad-soft) ${floorPos}%,
              var(--warn-soft) ${floorPos}%, var(--warn-soft) ${targetPos}%,
              var(--good-soft) ${targetPos}%, var(--good-soft) 100%)`
          }} />
          <div className="gate" style={{ left: `${floorPos}%` }} />
          <div className="gate-label" style={{ left: `${floorPos}%` }}>Floor {floor}%</div>
          <div className="gate" style={{ left: `${targetPos}%` }} />
          <div className="gate-label" style={{ left: `${targetPos}%` }}>Target {target}%</div>
          <div className="marker" style={{ left: `${pos}%` }}>
            <span className="pin">{value.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tier rail ─────────────────────────────────────────
function TierRail({ tiers, active, onPick }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>Tiers</h3>
        <span className="meta">switch view</span>
      </div>
      <div className="tier-rail">
        {tiers.map(t => (
          <div
            key={t.id}
            className={"tier-pill" + (t.id === active ? " active" : "")}
            onClick={() => onPick(t.id)}
          >
            <span className="tier-label">{t.label}</span>
            <span className="tier-qty">{(t.qty / 1000)}k <span style={{ fontSize: 11, opacity: 0.6, fontFamily: "var(--ui)" }}>units</span></span>
            <span className="tier-margin">
              margin <strong style={{ color: t.id === active ? "var(--paper)" : `var(--${t.status})` }}>{t.margin.toFixed(1)}%</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Export
Object.assign(window, {
  Brand, Sidebar, Topbar, DN, MarginVerdict, TierRail,
});
