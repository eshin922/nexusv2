// Two-tier navigation rail.
// Outer rail (56px): cross-project nav — pinned + recents + admin (role-gated).
//   Cross-project work is rare (a few/day); the outer rail is intentionally
//   narrow so the inner rail and content get the room. Project squares are
//   clickable color-coded glyphs; pinned ones get a small pip.
// Inner rail (240px): within-project structure — scenarios + version chains
//   + per-scenario surfaces. Scenarios live HERE (not as page-level tabs) —
//   one-click switch from anywhere, and it scales to 3-5 scenarios per project
//   without re-flowing the page.
// ⌘K is committed but post-MVP; until then, pinned + recents + the deal
// organizer carry cross-project nav.

const Rail = ({ project, activeScenario, onSwitchScenario, onGoToOrganizer, currentSurface }) => {
  const D = window.NXR4;
  return (
    <React.Fragment>
      {/* Outer rail */}
      <nav className="r4-outer" aria-label="Workspace navigation">
        <div className="r4-outer-mark" title="Nexus">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 19V5l16 14V5" />
          </svg>
        </div>

        <div className="r4-outer-section">
          <button className="r4-outer-btn active" title="My deals" onClick={onGoToOrganizer}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="11" width="18" height="4" rx="1" /><rect x="3" y="18" width="18" height="3" rx="1" />
            </svg>
            <span className="badge-dot" title="3 signals need you" />
          </button>
          <button className="r4-outer-btn" title="Search (⌘K — coming)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="11" cy="11" r="6" /><path d="m20 20-3-3" />
            </svg>
          </button>
        </div>

        <div className="r4-outer-section">
          <span className="r4-outer-label">Pinned</span>
          {D.recents.filter(r => r.pinned).map(r => (
            <div key={r.project_id}
              className={`r4-recent ${r.accent} ${project && project.id === r.project_id ? "active" : ""}`}
              title={`${r.client} · ${r.deal_name}`}>
              {r.client.split(/\s/).map(w => w[0]).join("").slice(0,2)}
              <span className="pin">·</span>
            </div>
          ))}
        </div>

        <div className="r4-outer-section">
          <span className="r4-outer-label">Recent</span>
          {D.recents.filter(r => !r.pinned).map(r => (
            <div key={r.project_id}
              className={`r4-recent ${r.accent}`}
              title={`${r.client} · ${r.deal_name} · ${r.last_visit}`}>
              {r.client.split(/\s/).map(w => w[0]).join("").slice(0,2)}
            </div>
          ))}
        </div>

        <div className="r4-outer-foot">
          {/* admin gear is role-gated; Maya is PM so it's hidden here */}
          <button className="r4-outer-btn" title="Settings">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
          </button>
          <div className="r4-outer-avatar" title="Maya Okafor">MO</div>
        </div>
      </nav>

      {/* Inner rail — only when in a project */}
      {project && (
        <aside className="r4-inner" aria-label={`${project.client} navigation`}>
          <button className="r4-inner-back" onClick={onGoToOrganizer}>← All deals</button>

          <div className="r4-inner-project">
            <div className="client">{project.client}</div>
            <div className="deal">{project.deal_name}</div>
            <div className="meta">
              <span>{project.hubspot_stage.toUpperCase()}</span>
              <span>·</span>
              <span>SYNCED {project.hubspot_synced_at}</span>
            </div>
          </div>

          <div className="r4-inner-section">
            <h6>Scenarios <span className="add" title="New scenario">+ New</span></h6>
            {project.scenarios.map(sc => {
              const v = sc.versions[0];
              const isActive = activeScenario === sc.id;
              const pip = v.margin_state === "good" ? "good" : v.margin_state === "below_target" ? "warn" : v.margin_state === "below_floor" ? "bad" : "draft";
              return (
                <div key={sc.id}
                  className={`r4-scenario ${isActive ? "active" : ""} ${sc.status === "dropped" ? "dropped" : ""}`}
                  onClick={() => onSwitchScenario && onSwitchScenario(sc.id)}>
                  <div className="row">
                    <div className={`label ${sc.status === "dropped" ? "dropped" : ""}`}>{sc.label}</div>
                    <div className="v">v{v.v}</div>
                  </div>
                  <div className="meta">
                    <span className={`pip ${pip}`} />
                    <span>{v.margin_state === "incomplete" ? "draft" : `${v.blended_margin}% · ${v.tier}`}</span>
                    {sc.draft_after_send && <span style={{ color: "var(--warn)" }}>· draft +{sc.draft_after_send.edits}</span>}
                  </div>

                  {isActive && (
                    <div style={{ marginTop: 6, marginLeft: -6, marginRight: -6 }}>
                      <div className={`r4-surf ${currentSurface === "setup" ? "active" : ""}`}>Setup</div>
                      <div className={`r4-surf ${currentSurface === "build" ? "active" : ""}`}>Cost build
                        {sc.draft_after_send && <span className="badge">+6</span>}
                      </div>
                      <div className={`r4-surf ${currentSurface === "sheet" ? "active" : ""}`}>Costing sheet</div>
                      <div className={`r4-surf ${currentSurface === "customer" ? "active" : ""}`}>Customer view</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="r4-inner-section">
            <h6>Activity</h6>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "0 4px", lineHeight: 1.5 }}>
              <div><span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 10 }}>2h</span> · v3 sent</div>
              <div><span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 10 }}>2h</span> · override DM @nina</div>
              <div><span style={{ fontFamily: "var(--mono)", color: "var(--ink-4)", fontSize: 10 }}>12m</span> · WC viewing freight</div>
            </div>
          </div>
        </aside>
      )}
    </React.Fragment>
  );
};

window.NXRail = Rail;
