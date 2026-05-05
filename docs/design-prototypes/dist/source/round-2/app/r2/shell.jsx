/* global React */
const { useState: useStateS } = React;

// ─── Brand (Logo 05 — engineered N) ──────────────────
function Brand() {
  return (
    <div className="brand">
      <svg className="mark" width="22" height="22" viewBox="0 0 78 78" fill="none" aria-hidden="true">
        <path d="M 8 8 L 8 70 L 14 70 L 14 22 L 64 70 L 70 70 L 70 8 L 64 8 L 64 56 L 14 8 Z" fill="currentColor" />
        <rect x="34" y="36" width="10" height="2" fill="var(--accent)" />
      </svg>
      <span className="name">Nexus</span>
      <span className="ver">round 2</span>
    </div>
  );
}

function Sidebar({ route, onRoute }) {
  const D = window.NXR2;
  return (
    <aside className="sidebar">
      <Brand />

      <nav className="side-section">
        <h6>Round 2 · two surfaces</h6>
        <button className={"side-link" + (route === "build" ? " active" : "")} onClick={() => onRoute("build")}>
          <span className="glyph">▤</span>Cost Build
        </button>
        <button className={"side-link" + (route === "costing" ? " active" : "")} onClick={() => onRoute("costing")}>
          <span className="glyph">∑</span>Costing Sheet
        </button>
      </nav>

      <nav className="side-section">
        <h6>Round 2 deliverables</h6>
        <button className={"side-link" + (route === "notes" ? " active" : "")} onClick={() => onRoute("notes")}>
          <span className="glyph">✎</span>Designer notes
        </button>
        <button className={"side-link" + (route === "datamap" ? " active" : "")} onClick={() => onRoute("datamap")}>
          <span className="glyph">⌗</span>Data-source map
        </button>
      </nav>

      <div className="side-foot">
        <span className="avatar sm">{D.users.u_maya.initials}</span>
        <div>
          {D.users.u_maya.name}<br />
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>PM · Sales</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ crumbs, presence }) {
  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={c.here ? "here" : ""}>{c.label}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="topbar-right">
        {presence && presence.length > 0 && (
          <div className="presence-chip">
            <div className="stack">
              {presence.map(u => <span key={u.id} className="avatar sm">{u.initials}</span>)}
            </div>
            <span>· {presence.length} here</span>
          </div>
        )}
        <button className="btn ghost sm" title="Search · ⌘K">⌘K</button>
      </div>
    </header>
  );
}

window.Brand = Brand;
window.Sidebar = Sidebar;
window.Topbar = Topbar;
